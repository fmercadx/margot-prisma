package io.github.fmercadx.carmirror

import io.github.fmercadx.carmirror.core.MirrorServer

/** What the screen shows. Written by [MirrorService], read by [MainActivity] once a second. */
object MirrorState {
    @Volatile var running: Boolean = false
        private set

    /** False in test mode: the car's browser cannot reach the phone without the tunnel. */
    @Volatile var tunnelUp: Boolean = false
        private set

    /** Addresses to type in the car, best first. */
    @Volatile var urls: List<String> = emptyList()
        private set

    @Volatile var server: MirrorServer? = null
        private set

    /** Why mirroring stopped or is degraded; null when all is well. */
    @Volatile var problem: String? = null

    fun started(tunnelUp: Boolean, urls: List<String>, server: MirrorServer, problem: String?) {
        this.tunnelUp = tunnelUp
        this.urls = urls
        this.server = server
        this.problem = problem
        running = true
    }

    fun stopped(problem: String?) {
        running = false
        tunnelUp = false
        urls = emptyList()
        server = null
        this.problem = problem
    }
}
