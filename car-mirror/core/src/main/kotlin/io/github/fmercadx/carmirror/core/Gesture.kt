package io.github.fmercadx.carmirror.core

/** Something the car asks the phone to do: a [Gesture] on the screen, or a [GlobalAction]. */
sealed interface Input {
    companion object {
        /**
         * Parses the body of POST /input: `a=<action>` for a [GlobalAction], otherwise a
         * [Gesture]. Returns null for anything malformed or out of range rather than guessing.
         */
        fun parse(body: String): Input? {
            val fields = fields(body)
            fields["a"]?.let { return GlobalAction.fromWire(it) }
            return Gesture.parse(body)
        }

        internal fun fields(body: String): Map<String, String> =
            body.trim().split('&').associate { it.substringBefore('=') to it.substringAfter('=', "") }
    }
}

/** The phone's navigation buttons, pressed from the car's screen. */
enum class GlobalAction(val wire: String) : Input {
    BACK("back"),
    HOME("home"),
    RECENTS("recents");

    companion object {
        fun fromWire(value: String): GlobalAction? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * A touch on the car's screen, to be performed on the phone.
 *
 * Each of [strokes] is one finger's path, in fractions of the phone screen (0..1 on each
 * axis), so the car never needs to know the phone's resolution. One point is a tap, or a long
 * press if [durationMs] is long; several are a swipe along them. Two strokes performed
 * together are a two-finger gesture: a pinch to zoom, or a two-finger scroll.
 */
class Gesture(val strokes: List<List<Point>>, val durationMs: Long) : Input {
    class Point(val x: Float, val y: Float)

    /** The first finger's path; most gestures have only one. */
    val points: List<Point> get() = strokes.first()

    companion object {
        const val MAX_POINTS = 64
        const val MAX_STROKES = 2
        const val MAX_DURATION_MS = 10_000L

        /**
         * Parses the viewer's compact form, `d=<ms>&p=<x>,<y>;<x>,<y>;...`, with a second
         * finger's path after a `|`. Returns null for anything malformed or out of range.
         */
        fun parse(body: String): Gesture? {
            val fields = Input.fields(body)
            val duration = fields["d"]?.toLongOrNull() ?: return null
            if (duration !in 1..MAX_DURATION_MS) return null
            val paths = fields["p"]?.split('|') ?: return null
            if (paths.isEmpty() || paths.size > MAX_STROKES) return null
            val strokes = paths.map { parseStroke(it) ?: return null }
            return Gesture(strokes, duration)
        }

        private fun parseStroke(text: String): List<Point>? {
            val pairs = text.split(';').filter { it.isNotEmpty() }
            if (pairs.isEmpty() || pairs.size > MAX_POINTS) return null
            return pairs.map { pair ->
                val parts = pair.split(',')
                if (parts.size != 2) return null
                val x = parts[0].toFloatOrNull() ?: return null
                val y = parts[1].toFloatOrNull() ?: return null
                if (x !in 0f..1f || y !in 0f..1f) return null // also rejects NaN
                Point(x, y)
            }
        }
    }
}

/** What the phone side offers the car beyond the picture. */
interface MirrorControl {
    /** Whether taps from the car can be performed right now (the user turned it on). */
    val touchAvailable: Boolean

    /** Performs [gesture] on the phone. Returns false if it could not be performed. */
    fun perform(gesture: Gesture): Boolean

    /** Presses Back, Home or Recent apps on the phone. Returns false if it could not. */
    fun perform(action: GlobalAction): Boolean
}
