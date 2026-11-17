package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Switch
import android.widget.TextView
import io.github.fmercadx.carmirror.core.FrameHub
import io.github.fmercadx.carmirror.core.MirrorServer
import io.github.fmercadx.carmirror.core.VideoHub
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/**
 * Video mode is a beta switch, off for a new install. While mirroring, its note says when a
 * change takes effect and why the car is getting pictures if video ended early.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VideoModeTest {
    private var controller: ActivityController<MainActivity>? = null
    private val app get() = RuntimeEnvironment.getApplication()

    @Before
    fun setUp() {
        Hotspot.override = listOf("192.168.43.1")
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    }

    @After
    fun tearDown() {
        controller?.pause()?.stop()?.destroy()
        controller = null
        MirrorState.stopped(null)
        Hotspot.override = null
    }

    @Test
    fun offForANewInstallAndRemembered() {
        var activity = open()
        assertFalse("video mode should start off", videoSwitch(activity).isChecked)
        assertNotNull(text(activity, app.getString(R.string.video_detail)))

        videoSwitch(activity).performClick()
        idle()
        assertTrue(videoSwitch(activity).isChecked)
        close()

        activity = open()
        assertTrue("the choice should survive leaving the app", videoSwitch(activity).isChecked)
    }

    @Test
    fun aChangeWhileMirroringTakesEffectNextTime() {
        running(video = false)
        val activity = open()
        videoSwitch(activity).performClick()
        idle()
        assertNotNull(text(activity, app.getString(R.string.motion_takes_effect)))
    }

    @Test
    fun saysWhyTheCarGetsPictures() {
        app.getSharedPreferences("settings", 0).edit().putBoolean("videoMode", true).apply()
        running(video = true)
        MirrorState.videoOff = VideoOff.CAR
        var activity = open()
        assertNotNull("the car couldn't play it", text(activity, app.getString(R.string.video_fell_back_car)))
        close()

        MirrorState.videoOff = VideoOff.PHONE
        activity = open()
        assertNotNull("the phone couldn't encode it", text(activity, app.getString(R.string.video_fell_back_phone)))
    }

    @Test
    fun noHardwareEncoderMeansPicturesNotACrash() {
        // Robolectric's codec list is empty: like a phone with no H.264 encoder for the screen.
        val encoder = VideoEncoder.create(576, 1280, 30, VideoHub(), Handler(Looper.getMainLooper())) {}
        assertNull(encoder)
    }

    private fun running(video: Boolean) {
        MirrorState.started(tunnelUp = false, port = 8080, server = MirrorServer(FrameHub()), problem = null, video = video)
    }

    private fun open(): MainActivity {
        val c = Robolectric.buildActivity(MainActivity::class.java).setup().also { controller = it }
        idle()
        return c.get()
    }

    private fun close() {
        controller?.pause()?.stop()?.destroy()
        controller = null
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun page(activity: Activity): View =
        (activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup).getChildAt(0)

    private fun videoSwitch(activity: Activity): Switch =
        text(activity, app.getString(R.string.setting_video)) as? Switch ?: error("no Video mode switch")

    private fun text(activity: Activity, wanted: String): View? = findText(page(activity)) { it == wanted }

    private fun findText(root: View, match: (String) -> Boolean): View? {
        if (root is TextView && match(root.text.toString())) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) findText(root.getChildAt(i), match)?.let { return it }
        return null
    }
}
