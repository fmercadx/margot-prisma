package io.github.fmercadx.carmirror.core

/** One encoded screen frame. [seq] increases by one for every frame published to a hub. */
class Frame(val seq: Long, val jpeg: ByteArray, val width: Int, val height: Int)

/**
 * Holds the newest frame and lets any number of viewers wait for the next one.
 *
 * Only the latest frame is kept: a viewer that falls behind skips straight to the
 * newest picture instead of replaying a backlog, which is what keeps latency low.
 */
class FrameHub {
    private val lock = Object()
    private var latest: Frame? = null
    private var nextSeq = 1L
    private var closed = false

    fun publish(jpeg: ByteArray, width: Int, height: Int): Frame = synchronized(lock) {
        val frame = Frame(nextSeq++, jpeg, width, height)
        latest = frame
        lock.notifyAll()
        frame
    }

    fun latest(): Frame? = synchronized(lock) { latest }

    val isClosed: Boolean get() = synchronized(lock) { closed }

    /**
     * Returns the newest frame whose seq is greater than [after], waiting up to [timeoutMs]
     * for one to arrive. Returns null on timeout or once the hub is closed.
     *
     * An [after] the hub has never issued comes from a viewer that saw an earlier capture
     * session; it is treated as "nothing seen yet" so the viewer is not stuck waiting for a
     * sequence number this session will take a long time to reach.
     */
    fun awaitAfter(after: Long, timeoutMs: Long): Frame? {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        synchronized(lock) {
            val seen = if (after >= nextSeq) 0 else after
            while (true) {
                val frame = latest
                if (frame != null && frame.seq > seen) return frame
                if (closed) return null
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
