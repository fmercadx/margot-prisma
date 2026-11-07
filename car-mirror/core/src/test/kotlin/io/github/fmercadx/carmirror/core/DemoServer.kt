package io.github.fmercadx.carmirror.core

import java.awt.BasicStroke
import java.awt.Color
import java.awt.Font
import java.awt.GradientPaint
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import javax.imageio.ImageIO
import kotlin.math.cos
import kotlin.math.sin

/**
 * Stands in for the phone: draws a moving test pattern, JPEG-encodes it and serves it
 * through the real [MirrorServer], so the viewer page can be checked in a desktop browser.
 *
 * Args: [port] [portrait|landscape]
 */
fun main(args: Array<String>) {
    System.setProperty("java.awt.headless", "true")
    val port = args.getOrNull(0)?.toInt() ?: CarUrls.DEFAULT_PORT
    val landscape = args.getOrNull(1) == "landscape"
    val (width, height) = if (landscape) 1280 to 576 else 576 to 1280

    val hub = FrameHub()
    val server = MirrorServer(hub)
    val bound = server.start(port, InetAddress.getLoopbackAddress())
    println("READY http://127.0.0.1:$bound/")
    System.out.flush()

    val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    val out = ByteArrayOutputStream()
    var n = 0
    while (true) {
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
        g.dispose()

        out.reset()
        ImageIO.write(image, "jpg", out)
        hub.publish(out.toByteArray(), width, height)
        n++
        Thread.sleep(1000L / 24)
    }
}
