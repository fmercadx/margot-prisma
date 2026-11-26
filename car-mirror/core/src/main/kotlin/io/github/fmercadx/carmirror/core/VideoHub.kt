package io.github.fmercadx.carmirror.core

/**
 * Hands the encoder's video to the car's streams: the current init segment and every media
 * segment since the last keyframe. A car that connects starts from that keyframe, so it never
 * waits for the next one or decodes a frame whose reference it missed. One that falls behind
 * catches up at the next keyframe (the older group is gone by then), and asks for it sooner.
 * A pause drops the group, and nothing published while paused is kept: after it the car waits
 * for a keyframe made after the pause, so nothing from during the pause is ever sent.
 */
class VideoHub(private val clock: () -> Long = System::currentTimeMillis) {
    class Init(val generation: Int, val codec: String, val segment: ByteArray)
    class Segment(val index: Long, val bytes: ByteArray, val keyframe: Boolean)

    /** What a stream should send next. Exactly one of the parts is meaningful. */
    class Update(val paused: String?, val init: Init?, val segments: List<Segment>)

    private val lock = Object()
    private var init: Init? = null
    private var generation = 0
    private val gop = ArrayList<Segment>() // since the last keyframe
    private var nextIndex = 1L
    private var paused: String? = null
    private var closed = false
    private var waiting = 0
    private var lastViewerAt = 0L

    /** Called when the car first needs a keyframe sooner than the encoder would make one. */
    @Volatile var onKeyframeWanted: (() -> Unit)? = null

    val pausedReason: String? get() = synchronized(lock) { paused }

    fun setInit(codec: String, segment: ByteArray) = synchronized(lock) {
        generation++
        init = Init(generation, codec, segment)
        gop.clear() // segments made for the old configuration can't follow the new init
        lock.notifyAll()
    }

    fun publish(segment: ByteArray, keyframe: Boolean) = synchronized(lock) {
        // While paused, even a keyframe is dropped: the encoder may still be finishing frames of
        // whatever the user paused to hide.
        if (closed || init == null || paused != null) return@synchronized
        if (keyframe) gop.clear()
        if (gop.isEmpty() && !keyframe) return@synchronized // nothing to decode it against
        if (gop.size >= MAX_GOP) gop.clear()
        gop += Segment(nextIndex++, segment, keyframe)
        lock.notifyAll()
    }

    fun setPaused(reason: String?) {
        val resumed = synchronized(lock) {
            if (paused == reason) return
            val wasPaused = paused != null
            paused = reason
            if (reason != null) gop.clear()
            lock.notifyAll()
            wasPaused && reason == null
        }
        if (resumed) onKeyframeWanted?.invoke()
    }

    fun close() = synchronized(lock) {
        closed = true
        lock.notifyAll()
    }

    val isClosed: Boolean get() = synchronized(lock) { closed }

    /** Whether a car is streaming, or was within [withinMs]: worth encoding for. */
    fun hasViewers(withinMs: Long = 2_000): Boolean = synchronized(lock) { waiting > 0 || clock() - lastViewerAt < withinMs }

    /**
     * Waits up to [timeoutMs] for something to send to a stream that has sent init
     * [generation] (0 for none) and segments up to [after], and that believes the pause state
     * is [viewerPaused]. Returns null on timeout (send a ping).
     */
    fun await(generation: Int, after: Long, viewerPaused: String?, timeoutMs: Long): Update? {
        val deadline = clock() + timeoutMs
        var askedForKeyframe = false
        synchronized(lock) {
            waiting++
            try {
                while (!closed) {
                    lastViewerAt = clock()
                    if (paused != viewerPaused) return Update(paused, null, emptyList())
                    val current = init
                    if (paused == null && current != null) {
                        if (current.generation != generation) {
                            if (gop.isNotEmpty()) return Update(null, current, ArrayList(gop))
                            if (!askedForKeyframe) {
                                askedForKeyframe = true
                                onKeyframeWanted?.invoke()
                            }
                        } else {
                            // The group restarts at every keyframe, so a stream that fell behind
                            // lands on the newest keyframe by itself; a lagging one asks for it sooner.
                            val newer = gop.filter { it.index > after }
                            if (newer.isNotEmpty()) {
                                if (newer.size > MAX_BEHIND) onKeyframeWanted?.invoke()
                                return Update(null, null, newer)
                            }
                        }
                    }
                    val left = deadline - clock()
                    if (left <= 0) return null
                    lock.wait(left)
                }
                return null
            } finally {
                waiting--
                lastViewerAt = clock()
            }
        }
    }

    private companion object {
        /** About two seconds at 30 fps: the encoder's keyframe interval. */
        const val MAX_GOP = 300
        /** A stream more than this many frames behind asks for a keyframe to catch up at. */
        const val MAX_BEHIND = 45
    }
}
