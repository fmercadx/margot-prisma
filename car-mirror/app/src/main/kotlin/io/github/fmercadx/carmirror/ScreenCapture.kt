package io.github.fmercadx.carmirror

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Display
import io.github.fmercadx.carmirror.core.AutoQuality
import io.github.fmercadx.carmirror.core.FrameHub
import io.github.fmercadx.carmirror.core.Quality
import io.github.fmercadx.carmirror.core.VideoHub
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * Mirrors the phone screen into an [ImageReader] and publishes JPEG frames to [hub].
 *
 * The virtual display only produces an image when something on screen changes, so a still
 * screen costs nothing. Encoding is capped at [Quality.fps]; the newest image is always the
 * one encoded, including the last one before the screen goes still.
 *
 * JPEG quality comes from [autoQuality], which lowers it when the car can't keep up. While
 * paused, or while no car is watching, images are still copied (cheap) but not compressed
 * (the expensive part); the newest one is compressed as soon as someone wants it.
 *
 * In video mode ([video] given), the display feeds the phone's hardware H.264 encoder instead
 * ([VideoEncoder]), and nothing passes through the image reader. It feeds it only while live
 * and watched; otherwise the encoder gets nothing at all. If the encoder can't start or
 * breaks, or the car can't play the video, it falls back to JPEG for the rest of the session
 * and tells [onVideoOff]. Android lets a projection make only one virtual display, which is
 * why both modes live here and switch the display's surface.
 *
 * Everything after [start] runs on one background thread, so none of the state below needs
 * locking.
 */
class ScreenCapture(
    context: Context,
    private val projection: MediaProjection,
    private val hub: FrameHub,
    private val quality: Quality,
    private val autoQuality: AutoQuality,
    private val video: VideoHub? = null,
    private val onVideoOff: (VideoOff) -> Unit = {},
) {
    private val displayManager = context.service<DisplayManager>()
    private val thread = HandlerThread("screen-capture").apply { start() }
    private val handler = Handler(thread.looper)
    private val jpeg = ByteArrayOutputStream(256 * 1024)

    private var reader: ImageReader? = null
    private var display: VirtualDisplay? = null
    private var captureWidth = 0
    private var captureHeight = 0

    /** Latest image, including any row padding the image buffer carries. */
    private var raw: Bitmap? = null
    private var rawWidth = 0
    private var rawHeight = 0
    private var scratch: ByteBuffer? = null

    /** [raw] with the padding cut off, when there is padding. */
    private var cropped: Bitmap? = null
    private var croppedCanvas: Canvas? = null

    private var encoder: VideoEncoder? = null
    private var videoOn = video != null    // false once fallen back to pictures
    private var videoFeeding = false       // the display draws into the encoder right now
    private var encoderGeneration = 0      // so a failure reported by a replaced encoder is ignored

    private var dirty = false
    private var paused = false
    private var encodeScheduled = false
    private var lastEncodeAt = 0L

    private val encodeTask = Runnable {
        encodeScheduled = false
        if (dirty) {
            dirty = false
            encode()
            lastEncodeAt = SystemClock.uptimeMillis()
        }
    }

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {}
        override fun onDisplayRemoved(displayId: Int) {}
        override fun onDisplayChanged(displayId: Int) {
            if (displayId == Display.DEFAULT_DISPLAY) matchScreenSize()
        }
    }

    /** Must be called after [MediaProjection.registerCallback]; Android 14 requires that order. */
    fun start() {
        val (width, height, dpi) = targetSize()
        val imageReader = newReader(width, height)
        reader = imageReader
        captureWidth = width
        captureHeight = height
        display = projection.createVirtualDisplay(
            "CarMirror", width, height, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.surface, null, handler,
        )
        displayManager.registerDisplayListener(displayListener, handler)
        if (videoOn) handler.post { startVideo() }
        handler.postDelayed(viewerCheck, VIEWER_CHECK_MS)
    }

    /**
     * Compresses a frame held back while nobody was watching, once a car shows up. In video
     * mode, starts and stops feeding the encoder as cars come and go.
     */
    private val viewerCheck = object : Runnable {
        override fun run() {
            if (encoder != null) updateVideoFeed() else scheduleEncode()
            handler.postDelayed(this, VIEWER_CHECK_MS)
        }
    }

    // ---- Video mode ----

    /** (Re)starts the encoder at the current screen size and frame rate. */
    private fun startVideo() {
        val virtualDisplay = display ?: return
        val hub = video ?: return
        val (width, height, dpi) = targetSize()
        val fps = currentFps
        virtualDisplay.surface = null
        encoder?.release()
        encoder = null
        videoFeeding = false
        val generation = ++encoderGeneration
        val next = VideoEncoder.create(width, height, fps, hub, handler) {
            if (generation == encoderGeneration) videoOff(VideoOff.PHONE)
        }
        if (next == null) {
            videoOff(VideoOff.PHONE)
            return
        }
        encoder = next
        captureWidth = width // the screen size this encoder was made for
        captureHeight = height
        virtualDisplay.resize(next.width, next.height, dpi)
        updateVideoFeed()
    }

    /** Feeds the encoder while the picture is live and a car is watching; nothing otherwise. */
    private fun updateVideoFeed() {
        val current = encoder ?: return
        val virtualDisplay = display ?: return
        val feed = !paused && video?.hasViewers() == true
        if (feed == videoFeeding) return
        videoFeeding = feed
        if (feed) {
            current.setSuspended(false)
            current.requestKeyframe(force = true) // a car joined, or the picture is back: start it clean
            virtualDisplay.surface = current.inputSurface // a new surface gets a freshly drawn frame
        } else {
            virtualDisplay.surface = null
            current.setSuspended(true)
        }
    }

    /** Ends video mode for this session and goes back to JPEG pictures. */
    private fun videoOff(reason: VideoOff) {
        if (!videoOn) return
        videoOn = false
        val virtualDisplay = display
        virtualDisplay?.surface = null
        encoder?.release()
        encoder = null
        videoFeeding = false
        video?.close() // the car's video streams end; it reconnects and gets pictures
        onVideoOff(reason)
        if (virtualDisplay == null) return
        val (width, height, dpi) = targetSize()
        val old = reader
        val imageReader = newReader(width, height)
        virtualDisplay.resize(width, height, dpi)
        virtualDisplay.surface = imageReader.surface
        reader = imageReader
        captureWidth = width
        captureHeight = height
        old?.close()
    }

    /** The car's browser can't play the video. Safe to call from any thread. */
    fun refuseVideo() {
        handler.post { videoOff(VideoOff.CAR) }
    }

    /** A car needs a keyframe sooner than the encoder would make one. Safe to call from any thread. */
    fun requestKeyframe() {
        handler.post { encoder?.requestKeyframe() }
    }

    @Volatile private var maxFps: Int? = null
    @Volatile private var maxJpegQuality: Int? = null

    /**
     * Caps the frame rate and JPEG quality below the user's setting, e.g. while the phone is
     * hot. Null lifts a cap. Safe to call from any thread.
     */
    fun setLimits(fps: Int?, jpegQuality: Int?) {
        maxFps = fps
        maxJpegQuality = jpegQuality
        handler.post {
            // The encoder's rate is fixed when it starts (and its bitrate follows it), so a new
            // cap means a new encoder. Thermal status changes rarely; the car barely notices.
            val current = encoder
            if (current != null && current.fps != currentFps) startVideo()
        }
    }

    private val currentFps: Int get() = minOf(quality.fps, maxFps ?: quality.fps)

    private val frameIntervalMs: Long get() = 1000L / currentFps

    /** Stops or resumes encoding. Safe to call from any thread. */
    fun setPaused(value: Boolean) {
        handler.post {
            paused = value
            if (encoder != null) updateVideoFeed() else if (!paused) scheduleEncode()
        }
    }

    fun stop() {
        handler.post {
            displayManager.unregisterDisplayListener(displayListener)
            handler.removeCallbacks(encodeTask)
            handler.removeCallbacks(viewerCheck)
            videoOn = false
            display?.surface = null
            encoder?.release()
            encoder = null
            display?.release()
            display = null
            reader?.close()
            reader = null
            raw?.recycle()
            raw = null
            cropped?.recycle()
            cropped = null
            croppedCanvas = null
        }
        thread.quitSafely()
    }

    private fun targetSize(): Triple<Int, Int, Int> {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION") // still the one call that gives the full, rotated size from a service
        displayManager.getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(metrics)
        val (width, height) = quality.captureSize(metrics.widthPixels, metrics.heightPixels)
        return Triple(width, height, metrics.densityDpi)
    }

    private fun newReader(width: Int, height: Int): ImageReader =
        ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3).apply {
            setOnImageAvailableListener({ onImageAvailable(it) }, handler)
        }

    /** The phone rotated: resize the capture so the picture is not squeezed into the old shape. */
    private fun matchScreenSize() {
        val virtualDisplay = display ?: return
        val (width, height, dpi) = targetSize()
        if (width == captureWidth && height == captureHeight) return
        if (encoder != null) return startVideo() // a new encoder in the new shape; the car gets a new init
        val old = reader
        val imageReader = newReader(width, height)
        virtualDisplay.resize(width, height, dpi)
        virtualDisplay.surface = imageReader.surface
        reader = imageReader
        captureWidth = width
        captureHeight = height
        old?.close()
    }

    private fun onImageAvailable(source: ImageReader) {
        val image = try {
            source.acquireLatestImage()
        } catch (e: IllegalStateException) {
            null // the reader was replaced or closed under us
        } ?: return
        try {
            copy(image)
        } finally {
            image.close()
        }
        dirty = true
        scheduleEncode()
    }

    private fun scheduleEncode() {
        if (paused || !dirty || encodeScheduled || !hub.hasViewers()) return
        encodeScheduled = true
        val wait = (lastEncodeAt + frameIntervalMs - SystemClock.uptimeMillis()).coerceAtLeast(0)
        handler.postDelayed(encodeTask, wait)
    }

    private fun copy(image: Image) {
        val plane = image.planes[0]
        val rowPixels = plane.rowStride / plane.pixelStride
        val height = image.height
        var bitmap = raw
        if (bitmap == null || bitmap.width != rowPixels || bitmap.height != height) {
            bitmap?.recycle()
            bitmap = Bitmap.createBitmap(rowPixels, height, Bitmap.Config.ARGB_8888)
            raw = bitmap
        }
        val buffer = plane.buffer
        buffer.rewind()
        val needed = bitmap.byteCount
        if (buffer.remaining() >= needed) {
            bitmap.copyPixelsFromBuffer(buffer)
        } else {
            // Some phones leave the padding off the last row, which makes the buffer a few
            // bytes shorter than copyPixelsFromBuffer insists on. Pad it out.
            var padded = scratch
            if (padded == null || padded.capacity() < needed) {
                padded = ByteBuffer.allocateDirect(needed)
                scratch = padded
            }
            padded.clear()
            padded.put(buffer)
            padded.rewind()
            bitmap.copyPixelsFromBuffer(padded)
        }
        rawWidth = image.width
        rawHeight = height
    }

    private fun encode() {
        val source = raw ?: return
        val width = rawWidth
        val height = rawHeight
        val frame = if (source.width == width) source else {
            var target = cropped
            if (target == null || target.width != width || target.height != height) {
                target?.recycle()
                target = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                cropped = target
                croppedCanvas = Canvas(target)
            }
            croppedCanvas?.drawBitmap(source, 0f, 0f, null) // the padding falls outside target and is dropped
            target
        }
        jpeg.reset()
        frame.compress(Bitmap.CompressFormat.JPEG, minOf(autoQuality.current, maxJpegQuality ?: 100), jpeg)
        hub.publish(jpeg.toByteArray(), width, height)
    }

    private companion object {
        const val VIEWER_CHECK_MS = 300L
    }
}
