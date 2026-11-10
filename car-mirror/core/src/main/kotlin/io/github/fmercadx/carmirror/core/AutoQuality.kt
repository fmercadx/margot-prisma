package io.github.fmercadx.carmirror.core

import kotlin.math.max
import kotlin.math.min

/**
 * Lowers JPEG quality when the car can't keep up, and raises it back when it can.
 *
 * The signal is frames the car never got. On the frame stream those are frames made while a
 * send was stuck because the link was full; when the car asks for one frame at a time, it is
 * the gap between the frame it last drew and the one it gets. Either way the link can't
 * carry frames as fast as the phone makes them, and a smaller JPEG helps. Over each [windowMs], if more than 30% of frames were skipped the
 * quality drops a step; after [calmMs] with almost no skips it climbs back toward [max].
 */
class AutoQuality(
    val max: Int,
    val min: Int = 40, // below this JPEG blocks show; dropping frames looks better
    private val windowMs: Long = 2_000,
    private val calmMs: Long = 4_000,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Volatile var current: Int = max
        private set

    private var windowStart = clock()
    private var lastChange = windowStart
    private var drawn = 0
    private var skipped = 0

    init {
        require(min in 1..max && max <= 100) { "need 1 <= min <= max <= 100, got $min..$max" }
    }

    /** Call for every frame sent to a viewer, with how many frames that viewer skipped. */
    @Synchronized
    fun onFrameServed(skippedBefore: Int) {
        drawn += 1
        skipped += skippedBefore.coerceAtLeast(0)
        val now = clock()
        if (now - windowStart < windowMs) return
        val missRatio = skipped.toDouble() / (drawn + skipped)
        if (missRatio > 0.30) {
            current = max(min, current - 10)
            lastChange = now
        } else if (missRatio < 0.05 && now - lastChange >= calmMs && current < max) {
            current = min(max, current + 5)
            lastChange = now
        }
        windowStart = now
        drawn = 0
        skipped = 0
    }
}
