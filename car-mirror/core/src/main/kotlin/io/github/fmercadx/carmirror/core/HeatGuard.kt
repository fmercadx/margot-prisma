package io.github.fmercadx.carmirror.core

/**
 * Eases off when the phone gets hot, before Android throttles it or shuts the screen off.
 *
 * A phone on a dashboard in the sun, encoding the screen and running the hotspot, heats up
 * fast. Android reports how hot it is as a thermal status (the PowerManager.THERMAL_STATUS_*
 * values, mirrored below). Fewer and smaller frames are the main lever: at "moderate" the
 * picture is capped at 20 frames a second, at "severe" at 10 with a lower JPEG quality, and
 * from "critical" on it pauses until the phone has cooled.
 */
object HeatGuard {
    const val NONE = 0
    const val LIGHT = 1
    const val MODERATE = 2
    const val SEVERE = 3
    const val CRITICAL = 4
    const val EMERGENCY = 5
    const val SHUTDOWN = 6

    /** Limits for one thermal status. Nulls mean "no limit beyond the user's own setting". */
    data class Limit(val maxFps: Int?, val maxJpegQuality: Int?, val pause: Boolean) {
        val easing: Boolean get() = maxFps != null || maxJpegQuality != null || pause
    }

    val NO_LIMIT = Limit(maxFps = null, maxJpegQuality = null, pause = false)

    fun limitFor(thermalStatus: Int): Limit = when {
        thermalStatus <= LIGHT -> NO_LIMIT
        thermalStatus == MODERATE -> Limit(maxFps = 20, maxJpegQuality = 60, pause = false)
        thermalStatus == SEVERE -> Limit(maxFps = 10, maxJpegQuality = 50, pause = false)
        else -> Limit(maxFps = null, maxJpegQuality = null, pause = true)
    }
}
