package io.github.fmercadx.carmirror

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.ScrollView
import android.widget.TextView
import io.github.fmercadx.carmirror.core.CarUrls
import io.github.fmercadx.carmirror.core.FrameHub
import io.github.fmercadx.carmirror.core.MirrorServer
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.net.InetAddress
import java.net.Socket

/**
 * Google Play listing screenshots: the real screen, exactly 1080 x 1920 (Play refuses images
 * more than twice as tall as wide, which the full-page previews are). CI attaches them to the
 * release as store-*.png, ready to upload.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w360dp-h640dp-xxhdpi")
class StoreScreenshotTest {
    private val outDir = File(System.getProperty("screenshotDir") ?: "build/screenshots").apply { mkdirs() }
    private var server: MirrorServer? = null
    private var car: Socket? = null

    @Before
    fun fakeHotspot() {
        Hotspot.override = listOf("192.168.43.1")
    }

    @After
    fun reset() {
        car?.close()
        server?.stop()
        MirrorState.stopped(null)
        Hotspot.override = null
    }

    @Test
    fun connected() {
        // A real server and a real request from "the car", so the screen shows what it would.
        val hub = FrameHub()
        val httpServer = MirrorServer(hub).also { server = it }
        val port = httpServer.start(0, InetAddress.getLoopbackAddress())
        MirrorState.started(tunnelUp = true, port = CarUrls.DEFAULT_PORT, server = httpServer, problem = null)
        car = Socket(InetAddress.getLoopbackAddress(), port).apply {
            getOutputStream().write("GET /frame?after=0 HTTP/1.1\r\nHost: 169-254-73-1.sslip.io:8080\r\n\r\n".toByteArray())
            getOutputStream().flush()
        }
        val deadline = System.currentTimeMillis() + 3_000
        while (httpServer.recentViewers().isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(20)
        shoot("store-1-connected") { page -> assertShown(page, "Connected to your car") }
    }

    @Test
    fun waiting() {
        mirroring()
        shoot("store-2-waiting") { page -> assertShown(page, "Waiting for your car") }
    }

    @Test
    fun ready() = shoot("store-3-ready") { page -> assertShown(page, "Ready to mirror") }

    @Test
    fun settings() {
        mirroring()
        shoot("store-4-settings", scrollTo = "Settings") { page -> assertShown(page, "Touch control") }
    }

    private fun mirroring() {
        MirrorState.started(tunnelUp = true, port = CarUrls.DEFAULT_PORT, server = MirrorServer(FrameHub()), problem = null)
    }

    /** Opens the screen, optionally scrolls to a heading, and saves exactly one screenful. */
    private fun shoot(name: String, scrollTo: String? = null, check: (View) -> Unit) {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        shadowOf(Looper.getMainLooper()).idle()
        val activity = controller.get()
        val scroll = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ScrollView
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        scroll.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        scroll.layout(0, 0, width, height)
        val page = scroll.getChildAt(0)
        check(page)
        if (scrollTo != null) {
            val heading = findText(page) { it.equals(scrollTo, ignoreCase = true) } ?: error("no \"$scrollTo\" heading")
            scroll.scrollTo(0, heading.top - (16 * activity.resources.displayMetrics.density).toInt())
            assertTrue("scrolling to \"$scrollTo\" did nothing", scroll.scrollY > 0)
        }
        scroll.isVerticalScrollBarEnabled = false // on a phone it fades away; in a still it doesn't
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(activity.getColor(R.color.background))
        // A view's own scroll offset is applied by its parent when drawing it, so drawing the
        // scroll view directly has to apply it here.
        canvas.translate(-scroll.scrollX.toFloat(), -scroll.scrollY.toFloat())
        scroll.draw(canvas)
        File(outDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue("store screenshots must be 1080 x 1920, got ${bitmap.width} x ${bitmap.height}",
            bitmap.width == 1080 && bitmap.height == 1920)
        controller.pause().stop().destroy()
    }

    private fun findText(root: View, match: (String) -> Boolean): View? {
        if (root is TextView && match(root.text.toString())) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) findText(root.getChildAt(i), match)?.let { return it }
        return null
    }

    private fun assertShown(page: View, text: String) {
        val view = findText(page) { it == text }
        assertTrue("\"$text\" should be on screen", view != null && view.isShown)
    }
}
