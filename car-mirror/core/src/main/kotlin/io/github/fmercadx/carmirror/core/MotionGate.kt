package io.github.fmercadx.carmirror.core

/**
 * Decides from GPS speed whether the car is moving, with hysteresis so a red light or a
 * noisy reading doesn't flicker the picture on and off.
 *
 * Moving starts at [startMps] (about 10 mph). It ends only after the speed has stayed below
 * [stopMps] (about 3 mph) for [stopHoldMs], or when there has been no reading for
 * [staleMs] (parked in a garage after driving, so the picture is not stuck paused).
 */
class MotionGate(
    private val startMps: Float = 4.5f,
    private val stopMps: Float = 1.5f,
    private val stopHoldMs: Long = 5_000,
    private val staleMs: Long = 60_000,
) {
    var moving = false
        private set

    private var slowSince: Long? = null
    private var lastReadingAt: Long? = null

    /** A GPS reading. [speedMps] is null when the fix carries no speed. Returns [moving]. */
    fun onSpeed(speedMps: Float?, nowMs: Long): Boolean {
        lastReadingAt = nowMs
        if (speedMps == null) return moving
        if (!moving) {
            if (speedMps >= startMps) {
                moving = true
                slowSince = null
            }
        } else if (speedMps < stopMps) {
            val since = slowSince ?: nowMs.also { slowSince = it }
            if (nowMs - since >= stopHoldMs) {
                moving = false
                slowSince = null
            }
        } else {
            slowSince = null
        }
        return moving
    }

    /** Call periodically. Returns [moving] after expiring a reading that has gone stale. */
    fun onTick(nowMs: Long): Boolean {
        val last = lastReadingAt
        if (moving && last != null && nowMs - last >= staleMs) {
            moving = false
            slowSince = null
        }
        return moving
    }
}
