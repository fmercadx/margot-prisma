package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.system.OsConstants
import io.github.fmercadx.carmirror.core.AutoQuality
import io.github.fmercadx.carmirror.core.CarUrls
import io.github.fmercadx.carmirror.core.FrameHub
import io.github.fmercadx.carmirror.core.Gesture
import io.github.fmercadx.carmirror.core.MirrorControl
import io.github.fmercadx.carmirror.core.MirrorServer
import io.github.fmercadx.carmirror.core.Quality
import java.io.IOException
import java.net.InetAddress

/**
 * Captures the screen and serves it to the car's browser.
 *
 * It is a [VpnService] only to get [CarUrls.VIRTUAL_IP] onto the phone, as a second way in
 * besides the hotspot's own address, which is private and which the Tesla browser may
 * refuse. The car's packets for it come to the phone because the phone is the car's gateway.
 * The address is link-local because Android 13+ drops packets from outside a VPN addressed to
 * any other kind of VPN address (see [CarUrls]). The VPN is limited to this app, routes
 * nothing but that one address, and is bypassable, so every app's traffic, this one's
 * included, flows as if it were not there.
 *
 * The picture can be paused two ways: by the user (privacy) or, when they opted in, by GPS
 * while the car is moving (driving). While paused the car gets no frames and no taps.
 */
class MirrorService : VpnService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var capture: ScreenCapture? = null
    private var hub: FrameHub? = null
    private var server: MirrorServer? = null
    private var tunnel: ParcelFileDescriptor? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var motion: MotionWatcher? = null

    /** The hotspot's addresses, looked up at most every few seconds by the server threads. */
    @Volatile private var hotspotIps: Pair<Long, List<String>> = 0L to emptyList()

    private var pausedByUser = false
    private var pausedByDriving = false

    /** Taps from the car, performed by [TouchService] when the user has turned it on. */
    private val touch = object : MirrorControl {
        override val touchAvailable: Boolean get() = TouchService.instance != null

        override fun perform(gesture: Gesture): Boolean {
            val service = TouchService.instance ?: return false
            service.perform(gesture)
            return true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(intent)
            ACTION_STOP -> stopMirroring(problem = null)
            ACTION_PAUSE -> setPausedByUser(true)
            ACTION_RESUME -> setPausedByUser(false)
            // Started some other way, e.g. by "always-on VPN" in settings: nothing to do.
            else -> if (projection == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onRevoke() {
        stopMirroring("Another VPN took over, or the VPN was turned off in settings. Tap Start to mirror again.")
    }

    override fun onDestroy() {
        release()
        super.onDestroy()
    }

    private fun start(intent: Intent) {
        if (projection != null) return
        createChannel()
        val watchMotion = intent.getBooleanExtra(EXTRA_PAUSE_WHILE_MOVING, false) &&
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        // Android 14 requires the foreground service to be running before the projection is
        // created, and it may only claim the location type if location permission is held.
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (watchMotion) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        startForeground(NOTIFICATION_ID, notification("Starting…"), types)

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data = intent.resultData()
        if (resultCode != Activity.RESULT_OK || data == null) {
            stopMirroring("Screen sharing permission was not given.")
            return
        }
        val quality = Quality.entries.firstOrNull { it.name == intent.getStringExtra(EXTRA_QUALITY) } ?: Quality.BALANCED
        val wantTunnel = intent.getBooleanExtra(EXTRA_TUNNEL, true)

        try {
            val manager = service<MediaProjectionManager>()
            val mp = manager.getMediaProjection(resultCode, data)
                ?: throw IllegalStateException("Android did not allow screen sharing.")
            projection = mp
            mp.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    // Ignore the callback for a projection we already stopped ourselves.
                    if (projection === mp) stopMirroring("Screen sharing was stopped.")
                }
            }, mainHandler)

            val vpn = if (wantTunnel) establishTunnel() else null
            tunnel = vpn
            val frames = FrameHub()
            hub = frames
            val autoQuality = AutoQuality(max = quality.jpegQuality)
            // Answer only on the VPN address and the hotspot's own addresses: devices that use
            // this phone as their gateway. Someone sharing a café Wi-Fi network with the phone
            // reaches it on its Wi-Fi address, and that connection is closed unanswered.
            val ourIps = { listOfNotNull(if (vpn != null) CarUrls.VIRTUAL_IP else null) + currentHotspotIps() }
            val httpServer = MirrorServer(
                frames,
                hostAllowed = { CarUrls.isOurHost(it, ourIps()) },
                control = touch,
                autoQuality = autoQuality,
                acceptLocal = { local -> local.hostAddress in ourIps() },
            )
            // IPv4 wildcard: the hotspot may come up, or change address, after mirroring starts.
            val port = bind(httpServer, InetAddress.getByName("0.0.0.0"))
            server = httpServer

            capture = ScreenCapture(this, mp, frames, quality, autoQuality).also { it.start() }
            keepScreenOn()

            val problem = when {
                vpn != null -> null
                wantTunnel -> "The VPN didn't start (is another VPN app on?), so only your hotspot's own " +
                    "address is offered. If the car won't open it, turn off the other VPN, then Stop and Start."
                else -> "Without the VPN, only your hotspot's own address is offered. If the car won't open " +
                    "it, tap Stop, then Start, and allow the VPN."
            }
            MirrorState.started(tunnelUp = vpn != null, port = port, server = httpServer, problem = problem)

            if (watchMotion) {
                val watcher = MotionWatcher(this) { moving ->
                    pausedByDriving = moving
                    applyPause()
                }
                if (watcher.start()) {
                    motion = watcher
                    MirrorState.watchingMotion = true
                }
            }
            applyPause()
            MirrorTileService.refresh(this)
        } catch (e: Exception) {
            stopMirroring("Could not start: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun setPausedByUser(value: Boolean) {
        if (projection == null) return
        pausedByUser = value
        applyPause()
    }

    /** Pushes the combined pause state to the car, the encoder, the screen and the notification. */
    private fun applyPause() {
        val reason = when {
            pausedByUser -> "privacy"
            pausedByDriving -> "driving"
            else -> null
        }
        hub?.setPaused(reason)
        capture?.setPaused(reason != null)
        MirrorState.paused = reason
        val text = when (reason) {
            "privacy" -> "Paused. The car's screen is blank."
            "driving" -> "Paused while the car is moving."
            else -> MirrorState.urls(this).firstOrNull()?.let { "In the car's browser: ${CarUrls.typed(it)}" }
                ?: "Turn on your hotspot, then connect the car to it."
        }
        service<NotificationManager>().notify(NOTIFICATION_ID, notification(text))
        MirrorTileService.refresh(this)
    }

    private fun establishTunnel(): ParcelFileDescriptor? = try {
        Builder()
            .setSession(getString(R.string.app_name))
            .addAddress(CarUrls.VIRTUAL_IP, 32)
            .addRoute(CarUrls.VIRTUAL_IP, 32)
            // Only this app is "in" the VPN, and it may bypass it; nothing else is affected.
            .addAllowedApplication(packageName)
            .allowBypass()
            .allowFamily(OsConstants.AF_INET6)
            .setBlocking(false)
            .setMetered(false)
            .establish()
    } catch (e: Exception) {
        null
    }

    /** The address may take a moment to appear after the VPN comes up. */
    private fun bind(httpServer: MirrorServer, address: InetAddress?): Int {
        var lastError: IOException? = null
        repeat(10) {
            try {
                return httpServer.start(CarUrls.DEFAULT_PORT, address)
            } catch (e: IOException) {
                lastError = e
                Thread.sleep(100)
            }
        }
        throw lastError ?: IOException("could not listen for the car")
    }

    private fun currentHotspotIps(): List<String> {
        val (at, ips) = hotspotIps
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - at < HOTSPOT_LOOKUP_MS) return ips
        return Hotspot.ipv4(this).also { hotspotIps = now to it }
    }

    @Suppress("DEPRECATION") // FLAG_KEEP_SCREEN_ON needs a window; a background service has none.
    private fun keepScreenOn() {
        val power = service<PowerManager>()
        wakeLock = power.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK, "CarMirror:screen").apply {
            setReferenceCounted(false)
            acquire(WAKE_LOCK_MAX_MS)
        }
    }

    /** Tears everything down. Safe to call more than once. */
    private fun release() {
        motion?.stop()
        motion = null
        capture?.stop()
        capture = null
        hub?.close()
        hub = null
        server?.stop()
        server = null
        val mp = projection
        projection = null // first, so the onStop callback this triggers is ignored
        mp?.stop()
        try {
            tunnel?.close()
        } catch (_: IOException) {
        }
        tunnel = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        pausedByUser = false
        pausedByDriving = false
    }

    private fun stopMirroring(problem: String?) {
        release()
        MirrorState.stopped(problem)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        MirrorTileService.refresh(this)
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "Mirroring", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Shown while your screen is being sent to the car"
        service<NotificationManager>().createNotificationChannel(channel)
    }

    private fun action(label: String, action: String, requestCode: Int): Notification.Action {
        val intent = PendingIntent.getService(
            this, requestCode,
            Intent(this, MirrorService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Action.Builder(null as Icon?, label, intent).build()
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (MirrorState.paused != null) "Mirroring paused" else "Mirroring to your car")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
        if (projection != null) {
            builder.addAction(
                if (pausedByUser) action("Resume", ACTION_RESUME, 2) else action("Pause", ACTION_PAUSE, 3),
            )
        }
        return builder.addAction(action("Stop", ACTION_STOP, 1)).build()
    }

    private fun Intent.resultData(): Intent? =
        if (Build.VERSION.SDK_INT >= 33) {
            getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            getParcelableExtra(EXTRA_RESULT_DATA)
        }

    companion object {
        const val ACTION_START = "io.github.fmercadx.carmirror.START"
        const val ACTION_STOP = "io.github.fmercadx.carmirror.STOP"
        const val ACTION_PAUSE = "io.github.fmercadx.carmirror.PAUSE"
        const val ACTION_RESUME = "io.github.fmercadx.carmirror.RESUME"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_QUALITY = "quality"
        const val EXTRA_TUNNEL = "tunnel"
        const val EXTRA_PAUSE_WHILE_MOVING = "pauseWhileMoving"

        private const val CHANNEL_ID = "mirroring"
        private const val NOTIFICATION_ID = 1
        private const val WAKE_LOCK_MAX_MS = 6 * 60 * 60 * 1000L
        private const val HOTSPOT_LOOKUP_MS = 3_000L
    }
}
