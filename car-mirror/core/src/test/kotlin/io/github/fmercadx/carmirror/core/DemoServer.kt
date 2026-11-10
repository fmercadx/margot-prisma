package io.github.fmercadx.carmirror.core

import java.awt.BasicStroke
import java.awt.Color
import java.awt.Font
import java.awt.GradientPaint
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import kotlin.concurrent.thread
import kotlin.math.cos
import kotlin.math.sin

/**
 * Stands in for the phone: draws a moving test pattern, JPEG-encodes it and serves it
 * through the real [MirrorServer], so the viewer page can be checked in a desktop browser.
 *
 * Args: [port] [portrait|landscape] [--control <dir>]
 *
 * With --control, the demo also behaves like a phone with touch control on: every gesture
 * the page sends is appended to <dir>/gestures.log, and writing "privacy" or "driving" to
 * <dir>/pause pauses the picture (an empty file resumes it). Writing "bars" to <dir>/scene
 * blacks out the top and bottom fifth of the picture, like a video played with black bars,
 * and writing "off" to <dir>/touch turns touch control off.
 */
fun main(args: Array<String>) {
    System.setProperty("java.awt.headless", "true")
    val positional = args.filterIndexed { i, a -> !a.startsWith("--") && args.getOrNull(i - 1) != "--control" }
    val port = positional.getOrNull(0)?.toInt() ?: CarUrls.DEFAULT_PORT
    val landscape = positional.getOrNull(1) == "landscape"
    val controlDir = args.indexOf("--control").takeIf { it >= 0 }?.let { File(args[it + 1]) }
    val (width, height) = if (landscape) 1280 to 576 else 576 to 1280

    val hub = FrameHub()
    val quality = AutoQuality(max = 80)
    var bars = false
    var touchOn = true
    val control = controlDir?.let { dir ->
        dir.mkdirs()
        val log = File(dir, "gestures.log").apply { writeText("") }
        val pauseFile = File(dir, "pause").apply { writeText("") }
        val sceneFile = File(dir, "scene").apply { writeText("") }
        thread(isDaemon = true, name = "demo-control") {
            while (true) {
                hub.setPaused(pauseFile.readText().trim().ifEmpty { null })
                bars = sceneFile.readText().trim() == "bars"
                touchOn = File(dir, "touch").let { !it.exists() || it.readText().trim() != "off" }
                Thread.sleep(100)
            }
        }
        object : MirrorControl {
            override val touchAvailable get() = touchOn
            override fun perform(gesture: Gesture): Boolean {
                val first = gesture.points.first()
                val last = gesture.points.last()
                synchronized(log) {
                    log.appendText("d=${gesture.durationMs} n=${gesture.points.size} " +
                        "first=${first.x},${first.y} last=${last.x},${last.y}\n")
                }
                return true
            }
        }
    }
    val server = MirrorServer(hub, control = control, autoQuality = quality)
    val bound = server.start(port, InetAddress.getLoopbackAddress())
    println("READY http://127.0.0.1:$bound/")
    System.out.flush()

    val writer = ImageIO.getImageWritersByFormatName("jpg").next()
    val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    val out = ByteArrayOutputStream()
    var n = 0
    val frameMs = 1000L / 30 // like the phone on its smoothest setting
    while (true) {
        val started = System.nanoTime()
        val g = image.createGraphics()
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        g.paint = GradientPaint(0f, 0f, Color(0x1E40AF), width.toFloat(), height.toFloat(), Color(0x0F172A))
        g.fillRect(0, 0, width, height)
        g.color = Color.WHITE
        g.stroke = BasicStroke(6f)
        g.drawRect(3, 3, width - 7, height - 7)
        val t = n / 24.0
        val r = minOf(width, height) / 6
        val cx = width / 2 + (cos(t) * width / 4).toInt()
        val cy = height / 2 + (sin(t * 1.3) * height / 4).toInt()
        g.color = Color(0xF59E0B)
        g.fillOval(cx - r, cy - r, 2 * r, 2 * r)
        g.color = Color.WHITE
        g.font = Font(Font.SANS_SERIF, Font.BOLD, minOf(width, height) / 10)
        g.drawString("Frame $n", 40, 40 + minOf(width, height) / 10)
        if (bars) {
            g.color = Color.BLACK
            g.fillRect(0, 0, width, height / 5)
            g.fillRect(0, height - height / 5, width, height / 5)
        }
        g.dispose()

        out.reset()
        ImageIO.createImageOutputStream(out).use { stream ->
            writer.output = stream
            val params = writer.defaultWriteParam.apply {
                compressionMode = ImageWriteParam.MODE_EXPLICIT
                compressionQuality = quality.current / 100f
            }
            writer.write(null, IIOImage(image, null, null), params)
        }
        hub.publish(out.toByteArray(), width, height)
        n++
        val spentMs = (System.nanoTime() - started) / 1_000_000
        Thread.sleep((frameMs - spentMs).coerceAtLeast(1))
    }
}
