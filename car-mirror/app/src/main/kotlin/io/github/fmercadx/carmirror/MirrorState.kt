package io.github.fmercadx.carmirror

import android.content.Context
import io.github.fmercadx.carmirror.core.CarUrls
import io.github.fmercadx.carmirror.core.MirrorServer

/** What the screen shows. Written by [MirrorService], read by [MainActivity] once a second. */
object MirrorState {
    @Volatile var running: Boolean = false
        private set

    /** Whether the VPN address is up. Without it only the hotspot's own address is offered. */
    @Volatile var tunnelUp: Boolean = false
        private set

    @Volatile var port: Int = CarUrls.DEFAULT_PORT
        private set

    @Volatile var server: MirrorServer? = null
        private set

    /** Null while live; otherwise why the picture is withheld: "privacy" or "driving". */
    @Volatile var paused: String? = null

    /** Whether "pause while moving" is actually watching GPS this session. */
    @Volatile var watchingMotion: Boolean = false

    /** Why mirroring stopped or is degraded; null when all is well. */
    @Volatile var problem: String? = null

    /**
     * Addresses to type in the car, best first. Worked out fresh each time, because the
     * hotspot can be turned on, off or given a new address while mirroring.
     */
    fun urls(context: Context): List<String> =
        if (!running) emptyList()
        else CarUrls.toTry(port, if (tunnelUp) CarUrls.VIRTUAL_IP else null, Hotspot.ipv4(context))

    fun started(tunnelUp: Boolean, port: Int, server: MirrorServer, problem: String?) {
        this.tunnelUp = tunnelUp
        this.port = port
        this.server = server
        this.problem = problem
        paused = null
        running = true
    }

    fun stopped(problem: String?) {
        running = false
        tunnelUp = false
        server = null
        paused = null
        watchingMotion = false
        this.problem = problem
    }
}
