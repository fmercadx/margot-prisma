package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import io.github.fmercadx.carmirror.core.GlobalAction
import io.github.fmercadx.carmirror.core.HeatGuard
import io.github.fmercadx.carmirror.core.MirrorControl
import io.github.fmercadx.carmirror.core.MirrorServer
import io.github.fmercadx.carmirror.core.Pairing
import io.github.fmercadx.carmirror.core.Pauses
import io.github.fmercadx.carmirror.core.Quality
import io.github.fmercadx.carmirror.core.VideoHub
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
 * The picture is withheld (see [Pauses]) when the user taps Pause, while the phone is locked,
 * when it is too hot, and, if the user wants, while GPS says the car is moving. While paused
 * the car gets no frames and no taps. A warm phone also gets fewer, smaller frames.
 */
class MirrorService : VpnService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var capture: ScreenCapture? = null
    private var hub: FrameHub? = null
    private var video: VideoHub? = null
    private var server: MirrorServer? = null
    private var tunnel: ParcelFileDescriptor? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var motion: MotionWatcher? = null

    /** The hotspot's addresses, looked up at most every few seconds by the server threads. */
    @Volatile private var hotspotIps: Pair<Long, List<String>> = 0L to emptyList()

    private val pauses = Pauses()
    private var lockWatching = false
    private var heatWatching = false

    /**
     * Blanks the car while the phone's screen is off or on the lock screen. Mirroring shows
     * the lock screen too, and an unlock pattern or PIN taps would be drawn on the car's
     * screen for the passengers to see.
     */
    private val lockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            pauses.locked = when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> true
                Intent.ACTION_USER_PRESENT -> false
                // With no lock screen set, the screen comes on unlocked.
                Intent.ACTION_SCREEN_ON -> service<KeyguardManager>().isKeyguardLocked
                else -> return
            }
            applyPause()
        }
    }

    /**
     * A screen on the hotspot asking to be paired: ask the user, with the code the car shows.
     * Nothing is shown to that screen unless they tap Allow. Called on server threads.
     */
    private val pairingListener = object : Pairing.Listener {
        override fun onRequest(request: Pairing.Request) {
            mainHandler.post { refreshPairing() }
        }

        override fun onSettled(id: String) {
            mainHandler.post { refreshPairing() }
        }
    }

    /** Eases off, then pauses, as the phone heats up; see [HeatGuard]. Called on the main thread. */
    private val thermalListener = PowerManager.OnThermalStatusChangedListener { status -> applyHeat(status) }

    /** Whether a car was watching at the last check, and when one last was. */
    private var carConnected = false
    private var lastCarAt = 0L

    /**
     * Every few seconds: keep the notification's car status current, remember which kind of
     * address the car used, and stop if no car has been watching for a long while, so a
     * forgotten session doesn't keep the phone's screen on and the battery draining.
     */
    private val carCheck = object : Runnable {
        override fun run() {
            checkCar()
            mainHandler.postDelayed(this, CAR_CHECK_MS)
        }
    }

    /** Taps, gestures and button presses from the car, performed by [TouchService] when the user has turned it on. */
    private val touch = object : MirrorControl {
        override val touchAvailable: Boolean get() = TouchService.instance != null

        override fun perform(gesture: Gesture): Boolean {
            val service = TouchService.instance ?: return false
            service.perform(gesture)
            return true
        }

        override fun perform(action: GlobalAction): Boolean {
            val service = TouchService.instance ?: return false
            service.perform(action)
            return true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(intent)
            ACTION_STOP -> stopMirroring(problem = null)
            ACTION_PAUSE -> setPausedByUser(true)
            ACTION_RESUME -> setPausedByUser(false)
            ACTION_PAIR_ALLOW -> intent.getStringExtra(EXTRA_PAIR_ID)?.let { server?.pairing?.approve(it) }
            ACTION_PAIR_DENY -> intent.getStringExtra(EXTRA_PAIR_ID)?.let { server?.pairing?.deny(it) }
            ACTION_DIM -> if (projection != null) {
                if (intent.getBooleanExtra(EXTRA_DIM, false)) Brightness.dim(this) else Brightness.restore(this)
            }
            // Started some other way, e.g. by "always-on VPN" in settings: nothing to do.
            else -> if (projection == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onRevoke() {
        stopMirroring(getString(R.string.problem_vpn_revoked))
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
        startForeground(NOTIFICATION_ID, notification(getString(R.string.notif_starting)), types)

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data = intent.resultData()
        if (resultCode != Activity.RESULT_OK || data == null) {
            stopMirroring(getString(R.string.problem_no_permission))
            return
        }
        val quality = Quality.entries.firstOrNull { it.name == intent.getStringExtra(EXTRA_QUALITY) } ?: Quality.BALANCED
        val wantTunnel = intent.getBooleanExtra(EXTRA_TUNNEL, true)
        val wantVideo = intent.getBooleanExtra(EXTRA_VIDEO, false)

        try {
            val manager = service<MediaProjectionManager>()
            val mp = manager.getMediaProjection(resultCode, data)
                ?: throw IllegalStateException(getString(R.string.problem_android_refused))
            projection = mp
            mp.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    // Ignore the callback for a projection we already stopped ourselves.
                    if (projection === mp) stopMirroring(getString(R.string.problem_capture_stopped))
                }
            }, mainHandler)

            val vpn = if (wantTunnel) establishTunnel() else null
            tunnel = vpn
            val frames = FrameHub()
            hub = frames
            val autoQuality = AutoQuality(max = quality.jpegQuality)
            val videoHub = if (wantVideo) VideoHub() else null
            video = videoHub
            // Answer only on the VPN address and the hotspot's own addresses: devices that use
            // this phone as their gateway. Someone sharing a café Wi-Fi network with the phone
            // reaches it on its Wi-Fi address, and that connection is closed unanswered.
            val ourIps = { listOfNotNull(if (vpn != null) CarUrls.VIRTUAL_IP else null) + currentHotspotIps() }
            val pairing = Pairing(PhonePairingStore(this)).also { it.listener = pairingListener }
            val httpServer = MirrorServer(
                frames,
                hostAllowed = { CarUrls.isOurHost(it, ourIps()) },
                control = touch,
                autoQuality = autoQuality,
                acceptLocal = { local -> local.hostAddress in ourIps() },
                pairing = pairing,
                video = videoHub,
            )
            httpServer.onVideoRefused = { capture?.refuseVideo() }
            // IPv4 wildcard: the hotspot may come up, or change address, after mirroring starts.
            val port = bind(httpServer, InetAddress.getByName("0.0.0.0"))
            server = httpServer

            MirrorState.videoOff = null // before the capture starts: its encoder may fail at once
            capture = ScreenCapture(this, mp, frames, quality, autoQuality, videoHub) { reason ->
                MirrorState.videoOff = reason
            }.also { it.start() }
            videoHub?.onKeyframeWanted = { capture?.requestKeyframe() }
            watchLock()
            watchHeat()
            keepScreenOn()
            if (intent.getBooleanExtra(EXTRA_DIM, false)) Brightness.dim(this)

            val problem = when {
                vpn != null -> null
                wantTunnel -> getString(R.string.problem_vpn_failed)
                else -> getString(R.string.problem_no_vpn)
            }
            MirrorState.started(tunnelUp = vpn != null, port = port, server = httpServer, problem = problem, video = wantVideo)

            if (watchMotion) {
                val watcher = MotionWatcher(this) { moving ->
                    pauses.driving = moving
                    applyPause()
                }
                if (watcher.start()) {
                    motion = watcher
                    MirrorState.watchingMotion = true
                }
            }
            lastCarAt = android.os.SystemClock.elapsedRealtime()
            carConnected = false
            mainHandler.postDelayed(carCheck, CAR_CHECK_MS)
            applyPause()
            MirrorTileService.refresh(this)
        } catch (e: Exception) {
            stopMirroring(getString(R.string.problem_could_not_start, e.message ?: e.javaClass.simpleName))
        }
    }

    private fun setPausedByUser(value: Boolean) {
        if (projection == null) return
        pauses.byUser = value
        applyPause()
    }

    private fun watchLock() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(lockReceiver, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(lockReceiver, filter)
        lockWatching = true
        pauses.locked = service<KeyguardManager>().isKeyguardLocked
    }

    private fun watchHeat() {
        val power = service<PowerManager>()
        power.addThermalStatusListener(mainExecutor, thermalListener)
        heatWatching = true
        applyHeat(power.currentThermalStatus)
    }

    private fun applyHeat(status: Int) {
        if (projection == null) return
        val limit = HeatGuard.limitFor(status)
        pauses.hot = limit.pause
        capture?.setLimits(limit.maxFps, limit.maxJpegQuality)
        MirrorState.heatEasing = limit.easing && !limit.pause
        applyPause()
    }

    /** Pushes the combined pause state to the car, the encoder, the screen and the notification. */
    private fun applyPause() {
        val reason = pauses.reason
        // The hubs first: from this moment nothing new reaches the car, even frames the
        // encoder is still finishing.
        hub?.setPaused(reason)
        video?.setPaused(reason)
        capture?.setPaused(reason != null)
        MirrorState.paused = reason
        updateNotification()
        MirrorTileService.refresh(this)
    }

    /** Shows the newest pairing request as a heads-up notification, or clears it. */
    private fun refreshPairing() {
        val waiting = server?.pairing?.waiting().orEmpty()
        MirrorState.pairingRequests = waiting
        val manager = service<NotificationManager>()
        val request = waiting.lastOrNull()
        if (request == null) {
            manager.cancel(PAIRING_NOTIFICATION_ID)
            return
        }
        val code = request.code.chunked(3).joinToString(" ")
        val open = PendingIntent.getActivity(
            this, 10,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        fun answer(label: String, action: String, requestCode: Int) = Notification.Action.Builder(
            null as Icon?, label,
            PendingIntent.getService(
                this, requestCode,
                Intent(this, MirrorService::class.java).setAction(action).putExtra(EXTRA_PAIR_ID, request.id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        ).build()
        val notification = Notification.Builder(this, PAIRING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.pairing_notif_title, code))
            .setContentText(getString(R.string.pairing_notif_text, code))
            .setStyle(Notification.BigTextStyle().bigText(getString(R.string.pairing_notif_text, code)))
            .setContentIntent(open)
            .setCategory(Notification.CATEGORY_STATUS)
            .setAutoCancel(true)
            .addAction(answer(getString(R.string.action_allow), ACTION_PAIR_ALLOW, 11))
            .addAction(answer(getString(R.string.action_deny), ACTION_PAIR_DENY, 12))
            .build()
        manager.notify(PAIRING_NOTIFICATION_ID, notification)
    }

    private fun updateNotification() {
        val text = when (MirrorState.paused) {
            Pauses.PRIVACY -> getString(R.string.notif_paused_privacy)
            Pauses.LOCKED -> getString(R.string.notif_paused_locked)
            Pauses.HOT -> getString(R.string.notif_paused_hot)
            Pauses.DRIVING -> getString(R.string.notif_paused_driving)
            else -> null
        } ?: when {
            carConnected && MirrorState.heatEasing -> getString(R.string.notif_connected_warm)
            carConnected -> getString(R.string.notif_connected)
            else -> MirrorState.urls(this).firstOrNull()?.let { getString(R.string.notif_waiting, CarUrls.typed(it)) }
                ?: getString(R.string.notif_no_hotspot)
        }
        service<NotificationManager>().notify(NOTIFICATION_ID, notification(text))
    }

    private fun checkCar() {
        val httpServer = server ?: return
        val now = android.os.SystemClock.elapsedRealtime()
        val viewer = httpServer.recentViewers(CAR_GONE_MS).firstOrNull()
        val connected = viewer != null
        if (connected) {
            lastCarAt = now
            CarUrls.kindOf(viewer!!.host, if (tunnel != null) CarUrls.VIRTUAL_IP else null, currentHotspotIps())
                ?.let { WorkingAddress.remember(this, it) }
        }
        if (connected != carConnected) {
            carConnected = connected
            updateNotification()
        }
        if (now - lastCarAt >= AUTO_STOP_MS) {
            stopMirroring(getString(R.string.problem_auto_stopped, (AUTO_STOP_MS / 60_000).toInt()))
        }
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
        mainHandler.removeCallbacks(carCheck)
        if (lockWatching) {
            try {
                unregisterReceiver(lockReceiver)
            } catch (_: IllegalArgumentException) {
            }
            lockWatching = false
        }
        if (heatWatching) {
            service<PowerManager>().removeThermalStatusListener(thermalListener)
            heatWatching = false
        }
        motion?.stop()
        motion = null
        capture?.stop()
        capture = null
        video?.close()
        video = null
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
        Brightness.restore(this)
        pauses.clear()
        MirrorState.pairingRequests = emptyList()
        service<NotificationManager>().cancel(PAIRING_NOTIFICATION_ID)
    }

    private fun stopMirroring(problem: String?) {
        release()
        MirrorState.stopped(problem)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        MirrorTileService.refresh(this)
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.channel_mirroring), NotificationManager.IMPORTANCE_LOW)
        channel.description = getString(R.string.channel_mirroring_desc)
        service<NotificationManager>().createNotificationChannel(channel)
        val pairing = NotificationChannel(PAIRING_CHANNEL_ID, getString(R.string.channel_pairing), NotificationManager.IMPORTANCE_HIGH)
        pairing.description = getString(R.string.channel_pairing_desc)
        service<NotificationManager>().createNotificationChannel(pairing)
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
            .setContentTitle(if (MirrorState.paused != null) getString(R.string.notif_title_paused) else getString(R.string.notif_title))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
        if (projection != null) {
            builder.addAction(
                if (pauses.byUser) action(getString(R.string.action_resume), ACTION_RESUME, 2) else action(getString(R.string.action_pause), ACTION_PAUSE, 3),
            )
        }
        return builder.addAction(action(getString(R.string.action_stop), ACTION_STOP, 1)).build()
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
        const val ACTION_DIM = "io.github.fmercadx.carmirror.DIM"
        const val ACTION_PAIR_ALLOW = "io.github.fmercadx.carmirror.PAIR_ALLOW"
        const val ACTION_PAIR_DENY = "io.github.fmercadx.carmirror.PAIR_DENY"
        const val EXTRA_PAIR_ID = "pairId"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_QUALITY = "quality"
        const val EXTRA_TUNNEL = "tunnel"
        const val EXTRA_PAUSE_WHILE_MOVING = "pauseWhileMoving"
        const val EXTRA_DIM = "dim"
        const val EXTRA_VIDEO = "video"

        private const val CHANNEL_ID = "mirroring"
        private const val NOTIFICATION_ID = 1
        private const val PAIRING_CHANNEL_ID = "pairing"
        private const val PAIRING_NOTIFICATION_ID = 2
        private const val WAKE_LOCK_MAX_MS = 6 * 60 * 60 * 1000L
        private const val HOTSPOT_LOOKUP_MS = 3_000L
        private const val CAR_CHECK_MS = 5_000L
        /** A car whose page hasn't asked for anything for this long has gone. */
        private const val CAR_GONE_MS = 15_000L
        private const val AUTO_STOP_MS = 10 * 60_000L
    }
}
