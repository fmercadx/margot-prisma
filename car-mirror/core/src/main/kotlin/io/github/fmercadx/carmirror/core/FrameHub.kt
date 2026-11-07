package io.github.fmercadx.carmirror.core

/** One encoded screen frame. [seq] increases by one for every frame published to a hub. */
class Frame(val seq: Long, val jpeg: ByteArray, val width: Int, val height: Int)

/**
 * What a viewer is told: a frame to draw, or (with [frame] null) the current pause state.
 * [paused] is null while live, otherwise why the picture is withheld ("privacy", "driving").
 */
class Update(val frame: Frame?, val paused: String?)

/**
 * Holds the newest frame and lets any number of viewers wait for the next one.
 *
 * Only the latest frame is kept: a viewer that falls behind skips straight to the
 * newest picture instead of replaying a backlog, which is what keeps latency low.
 *
 * While paused, no frame is handed out at all, so the car cannot show what is on the
 * phone; viewers are told the pause state instead.
 */
class FrameHub {
    private val lock = Object()
    private var latest: Frame? = null
    private var nextSeq = 1L
    private var paused: String? = null
    private var closed = false

    fun publish(jpeg: ByteArray, width: Int, height: Int): Frame = synchronized(lock) {
        val frame = Frame(nextSeq++, jpeg, width, height)
        latest = frame
        lock.notifyAll()
        frame
    }

    fun latest(): Frame? = synchronized(lock) { latest }

    val isClosed: Boolean get() = synchronized(lock) { closed }

    val pausedReason: String? get() = synchronized(lock) { paused }

    /** Withholds frames from every viewer while [reason] is non-null. Wakes waiting viewers. */
    fun setPaused(reason: String?) = synchronized(lock) {
        if (paused != reason) {
            paused = reason
            lock.notifyAll()
        }
    }

    /**
     * Waits up to [timeoutMs] for something the viewer has not seen yet, and returns it:
     * a pause state different from [viewerPaused], or, while live, a frame whose seq is
     * greater than [after]. Returns null on timeout or once the hub is closed.
     *
     * An [after] the hub has never issued comes from a viewer that saw an earlier capture
     * session; it is treated as "nothing seen yet" so the viewer is not stuck waiting for a
     * sequence number this session will take a long time to reach.
     */
    fun awaitUpdate(after: Long, viewerPaused: String?, timeoutMs: Long): Update? {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        synchronized(lock) {
            val seen = if (after >= nextSeq) 0 else after
            while (true) {
                if (closed) return null
                if (paused != viewerPaused) return Update(null, paused)
                val frame = latest
                if (paused == null && frame != null && frame.seq > seen) return Update(frame, null)
                val remainingMs = (deadline - System.nanoTime()) / 1_000_000
                if (remainingMs <= 0) return null
                lock.wait(remainingMs)
            }
        }
    }

    /** Wakes every waiting viewer; later waits return immediately. */
    fun close() = synchronized(lock) {
        closed = true
        lock.notifyAll()
    }
}
