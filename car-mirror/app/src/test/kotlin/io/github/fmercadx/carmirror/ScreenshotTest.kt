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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Opens the real screen in each state it can be in and saves a picture of the whole page,
 * light and dark, on a typical phone (393 x 852 dp). CI attaches the pictures to the
 * release as preview-*.png, so the layout can be checked without a phone.
 *
 * It also checks that the screen opens at all and that each state shows the right controls.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class ScreenshotTest {
    private val outDir = File(System.getProperty("screenshotDir") ?: "build/screenshots").apply { mkdirs() }

    @After
    fun reset() = MirrorState.stopped(null)

    @Test
    fun readyLight() = shoot("1-ready-light") { page ->
        assertVisible(page, "Start mirroring")
        assertVisible(page, "Before you start")
        assertHidden(page, "Stop")
    }

    @Test
    @Config(qualifiers = "+night")
    fun readyDark() = shoot("2-ready-dark")

    @Test
    fun waitingLight() {
        mirroring()
        shoot("3-waiting-light") { page ->
            assertVisible(page, "100-73-0-1.sslip.io:8080")
            assertVisible(page, "Stop")
            assertHidden(page, "Start mirroring")
            assertHidden(page, "Before you start")
        }
    }

    @Test
    @Config(qualifiers = "+night")
    fun waitingDark() {
        mirroring()
        shoot("4-waiting-dark")
    }

    @Test
    fun troubleshootingOpen() {
        mirroring()
        shoot("5-page-wont-load-light") { page ->
            click(page, "Page won't load?")
            assertTrue("troubleshooting tips did not open", findText(page) { it.startsWith("• Type the address") }?.isShown == true)
        }
    }

    @Test
    fun pausedLight() {
        mirroring()
        MirrorState.paused = "privacy"
        shoot("6-paused-light") { page ->
            assertVisible(page, "Resume")
            assertVisible(page, "Paused")
        }
    }

    @Test
    fun cancelledLight() {
        MirrorState.stopped("Screen sharing was cancelled. Tap Start mirroring to try again.")
        shoot("7-cancelled-light") { page ->
            assertVisible(page, "Screen sharing was cancelled. Tap Start mirroring to try again.")
        }
    }

    private fun mirroring() {
        MirrorState.started(
            tunnelUp = true,
            urls = CarUrls.forVirtualIp(CarUrls.DEFAULT_PORT),
            server = MirrorServer(FrameHub()),
            problem = null,
        )
    }

    /** Opens the screen, runs [check] on it, then saves the full scrolling page as a PNG. */
    private fun shoot(name: String, check: (View) -> Unit = {}) {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        shadowOf(Looper.getMainLooper()).idle()
        val activity = controller.get()
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        val scroll = content.getChildAt(0) as ScrollView
        val page = scroll.getChildAt(0)
        check(page)
        shadowOf(Looper.getMainLooper()).idle()

        val width = activity.resources.displayMetrics.widthPixels
        page.measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
        )
        page.layout(0, 0, page.measuredWidth, page.measuredHeight)
        val bitmap = Bitmap.createBitmap(page.measuredWidth, page.measuredHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(activity.getColor(R.color.background))
        page.draw(canvas)
        File(outDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertEquals(width, bitmap.width)
        controller.pause().stop().destroy()
    }

    private fun findText(root: View, match: (String) -> Boolean): View? {
        if (root is TextView && match(root.text.toString())) return root
        if (root is ViewGroup) {
            for (i in 0 until root.childCount) findText(root.getChildAt(i), match)?.let { return it }
        }
        return null
    }

    private fun assertVisible(page: View, text: String) {
        val view = findText(page) { it == text }
        assertTrue("\"$text\" should be on screen", view != null && view.isShown)
    }

    private fun assertHidden(page: View, text: String) {
        val view = findText(page) { it == text }
        assertTrue("\"$text\" should not be on screen", view == null || !view.isShown)
    }

    private fun click(page: View, text: String) {
        val view = findText(page) { it == text } ?: error("no \"$text\" on screen")
        view.performClick()
    }
}
