package io.github.fmercadx.carmirror

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
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
import io.github.fmercadx.carmirror.core.CarUrls
import io.github.fmercadx.carmirror.core.FrameHub
import io.github.fmercadx.carmirror.core.MirrorServer
import io.github.fmercadx.carmirror.core.Quality
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface

/**
 * Captures the screen and serves it to the car's browser.
 *
 * It is a [VpnService] only to get [CarUrls.VIRTUAL_IP] onto the phone: the Tesla browser
 * will not open the private address a hotspot hands out, but it will open this one, and the
 * car's packets for it come to the phone because the phone is the car's gateway. The VPN is
 * limited to this app, routes nothing but that one address, and is bypassable, so every other
 * app's traffic, and this app's, flows as if it were not there.
 */
class MirrorService : VpnService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var capture: ScreenCapture? = null
    private var hub: FrameHub? = null
    private var server: MirrorServer? = null
    private var tunnel: ParcelFileDescriptor? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(intent)
            ACTION_STOP -> stopMirroring(problem = null)
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
        // Android 14 requires the foreground service to be running before the projection is created.
        startForeground(NOTIFICATION_ID, notification("Starting…"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)

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
            val localIps = localIpv4Addresses()
            val ourIps = if (vpn != null) listOf(CarUrls.VIRTUAL_IP) else localIps
            val frames = FrameHub()
            hub = frames
            val httpServer = MirrorServer(frames, hostAllowed = { CarUrls.isOurHost(it, ourIps) })
            // With the tunnel up, listen only on the virtual address. Only devices that use
            // this phone as their gateway (the hotspot) can reach it, so someone sharing a
            // café Wi-Fi network with the phone cannot open the stream.
            val port = bind(httpServer, if (vpn != null) InetAddress.getByName(CarUrls.VIRTUAL_IP) else null)
            server = httpServer

            capture = ScreenCapture(this, mp, frames, quality).also { it.start() }
            keepScreenOn()

            val urls = if (vpn != null) CarUrls.forVirtualIp(port) else CarUrls.forLocalAddresses(port, localIps)
            val problem = when {
                vpn != null -> null
                wantTunnel -> "Test mode: the VPN could not be started (is another VPN app on?), so the car's " +
                    "browser cannot open the phone. These addresses work from a laptop on the same hotspot."
                else -> "Test mode: the VPN was not allowed, so the car's browser cannot open the phone. " +
                    "These addresses work from a laptop on the same hotspot. Tap Stop, then Start, and allow it."
            }
            MirrorState.started(tunnelUp = vpn != null, urls = urls, server = httpServer, problem = problem)
            service<NotificationManager>()
                .notify(NOTIFICATION_ID, notification(urls.firstOrNull() ?: "No network address found"))
        } catch (e: Exception) {
            stopMirroring("Could not start: ${e.message ?: e.javaClass.simpleName}")
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

    private fun localIpv4Addresses(): List<String> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback && !it.name.startsWith("tun") }
            // Hotspot interfaces first; names vary by phone.
            .sortedBy { iface -> if (HOTSPOT_PREFIXES.any { iface.name.startsWith(it) }) 0 else 1 }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .mapNotNull { it.hostAddress }
    } catch (e: Exception) {
        emptyList()
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
    }

    private fun stopMirroring(problem: String?) {
        release()
        MirrorState.stopped(problem)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "Mirroring", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Shown while your screen is being sent to the car"
        service<NotificationManager>().createNotificationChannel(channel)
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, MirrorService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Mirroring to your car")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null as Icon?, "Stop", stop).build())
            .build()
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
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_QUALITY = "quality"
        const val EXTRA_TUNNEL = "tunnel"

        private const val CHANNEL_ID = "mirroring"
        private const val NOTIFICATION_ID = 1
        private const val WAKE_LOCK_MAX_MS = 6 * 60 * 60 * 1000L
        private val HOTSPOT_PREFIXES = listOf("ap", "swlan", "softap", "wlan1", "wlan2")
    }
}
