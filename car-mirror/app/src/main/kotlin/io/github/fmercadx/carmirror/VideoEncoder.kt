package io.github.fmercadx.carmirror

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.SystemClock
import android.view.Surface
import io.github.fmercadx.carmirror.core.Fmp4
import io.github.fmercadx.carmirror.core.VideoHub
import java.nio.ByteBuffer

/** Why video mode ended early and the car gets pictures instead. */
enum class VideoOff {
    /** This phone has no hardware H.264 encoder that would take the screen, or it failed. */
    PHONE,

    /** The car's browser can't play the video and asked for pictures. */
    CAR,
}

/**
 * The phone's hardware H.264 encoder, fed straight from the virtual display through
 * [inputSurface], so the screen never passes through app memory. Each encoded frame becomes a
 * fragmented MP4 segment in [video], which the car's streams read.
 *
 * Decode times count frames rather than follow the clock. The car's player then never meets a
 * gap: when the screen is still it simply waits at the newest frame, and the next one plays
 * the moment it arrives. The encoder is capped at [fps] so frames never come faster than they
 * play, and it repeats the last frame after a quarter second of stillness, so a keyframe
 * asked for on a still screen still arrives.
 *
 * Everything runs on [handler]'s thread (ScreenCapture's). [onFailed] runs there once if the
 * encoder breaks; the caller then falls back to pictures.
 */
class VideoEncoder private constructor(
    private val codec: MediaCodec,
    val width: Int,
    val height: Int,
    val fps: Int,
    private val bitrate: Int,
    private val video: VideoHub,
    private val handler: Handler,
    private val onFailed: (Exception) -> Unit,
) {
    lateinit var inputSurface: Surface
        private set

    private var sets: Fmp4.ParameterSets? = null
    private var sequence = 0
    private var frames = 0L
    private val frameTicks = Fmp4.TIMESCALE / fps
    private var released = false
    private var failed = false
    private var lastSyncRequestAt = 0L

    private val callback = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(codec: MediaCodec, index: Int) = Unit // the surface feeds it

        override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
            if (released) return
            try {
                val buffer = codec.getOutputBuffer(index)
                if (buffer != null && info.size > 0) {
                    val bytes = ByteArray(info.size)
                    buffer.position(info.offset)
                    buffer.get(bytes)
                    onOutput(bytes, info.flags)
                }
                codec.releaseOutputBuffer(index, false)
            } catch (e: IllegalStateException) {
                fail(e)
            }
        }

        override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
            // Some encoders announce SPS and PPS here rather than in a codec-config buffer.
            val sps = format.getByteBuffer("csd-0") ?: return
            val pps = format.getByteBuffer("csd-1") ?: return
            Fmp4.parameterSets(bytesOf(sps) + bytesOf(pps))?.let(::useParameterSets)
        }

        override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) = fail(e)
    }

    private fun start() {
        val format = MediaFormat.createVideoFormat(MIME, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER, fps.toFloat())
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, KEYFRAME_SECONDS)
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, REPEAT_AFTER_US)
            setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0) // decode order = display order; Fmp4 writes no reordering
            setInteger(MediaFormat.KEY_PRIORITY, 0)     // real time
            if (Build.VERSION.SDK_INT >= 30) setInteger(MediaFormat.KEY_LATENCY, 1)
        }
        codec.setCallback(callback, handler) // before configure, or the codec runs synchronously
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = codec.createInputSurface()
        codec.start()
    }

    private fun onOutput(annexB: ByteArray, flags: Int) {
        if (flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
            Fmp4.parameterSets(annexB)?.let(::useParameterSets)
            return
        }
        Fmp4.parameterSets(annexB)?.let(::useParameterSets) // some encoders repeat them before keyframes
        if (sets == null) return // nothing to describe the track with yet
        val keyframe = flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0 || Fmp4.isKeyframe(annexB)
        val sample = Fmp4.sample(annexB)
        if (sample.isEmpty()) return
        video.publish(Fmp4.mediaSegment(++sequence, frames * frameTicks, frameTicks, sample, keyframe), keyframe)
        frames++
    }

    private fun useParameterSets(new: Fmp4.ParameterSets) {
        val current = sets
        if (current != null && current.sps.contentEquals(new.sps) && current.pps.contentEquals(new.pps)) return
        sets = new
        video.setInit(new.codec, Fmp4.initSegment(new, width, height))
    }

    /**
     * Asks for the next frame to be a keyframe: a car joined, fell behind, or the picture is
     * back after a pause. Requests closer together than a few frames are merged unless [force].
     */
    fun requestKeyframe(force: Boolean = false) {
        if (released) return
        val now = SystemClock.uptimeMillis()
        if (!force && now - lastSyncRequestAt < SYNC_REQUEST_GAP_MS) return
        lastSyncRequestAt = now
        setParameter(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
    }

    /** Stops or resumes encoding (paused, or nobody watching). */
    fun setSuspended(suspended: Boolean) = setParameter(MediaCodec.PARAMETER_KEY_SUSPEND, if (suspended) 1 else 0)

    private fun setParameter(key: String, value: Int) {
        if (released) return
        try {
            codec.setParameters(Bundle().apply { putInt(key, value) })
        } catch (e: IllegalStateException) {
            fail(e)
        }
    }

    private fun fail(e: Exception) {
        if (released || failed) return
        failed = true
        handler.post { onFailed(e) } // not from inside the codec's own callback
    }

    fun release() {
        if (released) return
        released = true
        try {
            codec.stop()
        } catch (_: IllegalStateException) {
        }
        codec.release()
        if (::inputSurface.isInitialized) inputSurface.release()
    }

    companion object {
        private const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
        private const val KEYFRAME_SECONDS = 2
        private const val REPEAT_AFTER_US = 250_000L
        private const val SYNC_REQUEST_GAP_MS = 250L

        /** Bits per pixel per frame: enough for sharp text on a phone screen at these sizes. */
        private const val BITS_PER_PIXEL = 0.12
        private const val MIN_BITRATE = 1_000_000
        private const val MAX_BITRATE = 10_000_000

        /**
         * Starts a hardware encoder for a [width] x [height] screen at [fps], or returns null if
         * this phone has none that will take it. The size may come out a little smaller: what
         * the chip supports, in multiples of 16.
         */
        fun create(width: Int, height: Int, fps: Int, video: VideoHub, handler: Handler, onFailed: (Exception) -> Unit): VideoEncoder? {
            val info = hardwareEncoder() ?: return null
            val caps = info.getCapabilitiesForType(MIME).videoCapabilities ?: return null
            val (w, h) = fit(caps, width, height, fps) ?: return null
            val bitrate = caps.bitrateRange.clamp((w.toDouble() * h * fps * BITS_PER_PIXEL).toInt().coerceIn(MIN_BITRATE, MAX_BITRATE))
            val codec = try {
                MediaCodec.createByCodecName(info.name)
            } catch (e: Exception) {
                return null
            }
            val encoder = VideoEncoder(codec, w, h, fps, bitrate, video, handler, onFailed)
            return try {
                encoder.start()
                encoder
            } catch (e: Exception) { // configure refused the format, or the codec is busy elsewhere
                encoder.release()
                null
            }
        }

        private fun hardwareEncoder(): MediaCodecInfo? =
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { info ->
                info.isEncoder && info.isHardwareAccelerated && !info.isAlias &&
                    info.supportedTypes.any { it.equals(MIME, ignoreCase = true) }
            }

        /** The largest size at most [width] x [height], same shape, that the encoder takes at [fps]. */
        private fun fit(caps: MediaCodecInfo.VideoCapabilities, width: Int, height: Int, fps: Int): Pair<Int, Int>? {
            var scale = 1.0
            repeat(16) {
                val w = align((width * scale).toInt(), caps.widthAlignment)
                val h = align((height * scale).toInt(), caps.heightAlignment)
                if (w > 0 && h > 0 && caps.areSizeAndRateSupported(w, h, fps.toDouble())) return w to h
                scale *= 0.9
            }
            return null
        }

        private fun align(value: Int, alignment: Int): Int {
            val step = maxOf(16, alignment) // 16 even where the chip claims less: some draw green edges otherwise
            return value / step * step
        }

        private fun bytesOf(buffer: ByteBuffer): ByteArray {
            val copy = buffer.duplicate()
            copy.rewind()
            return ByteArray(copy.remaining()).also { copy.get(it) }
        }
    }
}
