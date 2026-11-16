package io.github.fmercadx.carmirror.core

/**
 * A touch on the car's screen, to be performed on the phone.
 *
 * [points] are fractions of the phone screen (0..1 on each axis), so the car never needs to
 * know the phone's resolution. One point is a tap, or a long press if [durationMs] is long;
 * several points are a swipe along them.
 */
class Gesture(val points: List<Point>, val durationMs: Long) {
    class Point(val x: Float, val y: Float)

    companion object {
        const val MAX_POINTS = 64
        const val MAX_DURATION_MS = 10_000L

        /**
         * Parses the viewer's compact form, `d=<ms>&p=<x>,<y>;<x>,<y>;...`. Returns null for
         * anything malformed or out of range rather than guessing.
         */
        fun parse(body: String): Gesture? {
            val fields = body.trim().split('&').associate { it.substringBefore('=') to it.substringAfter('=', "") }
            val duration = fields["d"]?.toLongOrNull() ?: return null
            if (duration !in 1..MAX_DURATION_MS) return null
            val pairs = fields["p"]?.split(';')?.filter { it.isNotEmpty() } ?: return null
            if (pairs.isEmpty() || pairs.size > MAX_POINTS) return null
            val points = pairs.map { pair ->
                val parts = pair.split(',')
                if (parts.size != 2) return null
                val x = parts[0].toFloatOrNull() ?: return null
                val y = parts[1].toFloatOrNull() ?: return null
                if (x !in 0f..1f || y !in 0f..1f) return null // also rejects NaN
                Point(x, y)
            }
            return Gesture(points, duration)
        }
    }
}

/** What the phone side offers the car beyond the picture. */
interface MirrorControl {
    /** Whether taps from the car can be performed right now (the user turned it on). */
    val touchAvailable: Boolean

    /** Performs [gesture] on the phone. Returns false if it could not be performed. */
    fun perform(gesture: Gesture): Boolean
}
