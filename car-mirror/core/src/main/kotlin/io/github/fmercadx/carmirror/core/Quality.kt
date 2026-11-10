package io.github.fmercadx.carmirror.core

import kotlin.math.max
import kotlin.math.roundToInt

/** Trade-off between sharpness and smoothness. Every frame is a JPEG, so size drives speed. */
enum class Quality(val label: String, val maxEdge: Int, val fps: Int, val jpegQuality: Int) {
    // Frame rates are caps; the phone sends a frame only when the screen changes. Now that
    // frames are pushed over one stream, a hotspot's round trip no longer limits them.
    SMOOTH("Smooth", 960, 30, 60),
    BALANCED("Balanced", 1280, 30, 70),
    SHARP("Sharp", 1920, 20, 80);

    val frameIntervalMs: Long get() = 1000L / fps

    /**
     * Scales a [width] x [height] screen down so its longer edge is at most [maxEdge],
     * keeping the aspect ratio. Never scales up. Both results are even and at least 2,
     * which video surfaces on some phones require.
     */
    fun captureSize(width: Int, height: Int): Pair<Int, Int> {
        require(width > 0 && height > 0) { "screen size must be positive: ${width}x$height" }
        val scale = minOf(1.0, maxEdge.toDouble() / max(width, height))
        fun even(v: Double) = max(2, (v.roundToInt() / 2) * 2)
        return even(width * scale) to even(height * scale)
    }
}
