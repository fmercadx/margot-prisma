package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.DialogInterface
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Switch
import android.widget.TextView
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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
import org.robolectric.shadows.ShadowAlertDialog
import org.robolectric.shadows.ShadowVpnService

/**
 * "Pause while driving" is on for a new install. The first start explains it and asks for
 * location; declining switches it off and mirroring carries on without it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DrivingPauseTest {
    private var controller: ActivityController<MainActivity>? = null

    @Before
    fun setUp() {
        Hotspot.override = listOf("192.168.43.1")
        // Notifications already allowed, so Start goes straight to the location step.
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        // Stop the start sequence at the VPN explanation, the step after location.
        ShadowVpnService.setPrepareResult(Intent("test.VPN_CONSENT"))
    }

    @After
    fun tearDown() {
        controller?.pause()?.stop()?.destroy()
        ShadowVpnService.reset()
        MirrorState.stopped(null)
        Hotspot.override = null
    }

    @Test
    fun onForANewInstall() {
        val activity = open()
        assertTrue("Pause while driving should be on for a new install", motionSwitch(activity).isChecked)
    }

    @Test
    fun firstStartExplainsThenAsksForLocation() {
        val activity = open()
        click(activity, "Start mirroring")
        val dialog = latestDialog()
        assertEquals("Pause while driving", title(dialog))
        press(dialog, DialogInterface.BUTTON_POSITIVE)

        val request = shadowOf(activity).lastRequestedPermission
        assertNotNull("Continue should ask Android for location", request)
        assertTrue(request.requestedPermissions.contains(Manifest.permission.ACCESS_FINE_LOCATION))
    }

    @Test
    fun allowingLocationKeepsItOnAndCarriesOn() {
        val activity = open()
        click(activity, "Start mirroring")
        press(latestDialog(), DialogInterface.BUTTON_POSITIVE)
        val request = shadowOf(activity).lastRequestedPermission
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(*request.requestedPermissions)
        answer(activity, request.requestCode, request.requestedPermissions, PackageManager.PERMISSION_GRANTED)

        assertTrue(motionSwitch(activity).isChecked)
        assertEquals("Why Car Mirror uses a VPN", title(latestDialog()))
    }

    @Test
    fun decliningLocationTurnsItOffAndCarriesOn() {
        val activity = open()
        click(activity, "Start mirroring")
        press(latestDialog(), DialogInterface.BUTTON_POSITIVE)
        val request = shadowOf(activity).lastRequestedPermission
        answer(activity, request.requestCode, request.requestedPermissions, PackageManager.PERMISSION_DENIED)

        assertFalse("declining location should switch the setting off", motionSwitch(activity).isChecked)
        assertEquals("Why Car Mirror uses a VPN", title(latestDialog()))
    }

    @Test
    fun turnItOffSkipsLocationEntirely() {
        val activity = open()
        click(activity, "Start mirroring")
        press(latestDialog(), DialogInterface.BUTTON_NEGATIVE)

        assertFalse(motionSwitch(activity).isChecked)
        assertEquals("location should not be requested", null, shadowOf(activity).lastRequestedPermission)
        assertEquals("Why Car Mirror uses a VPN", title(latestDialog()))

        // And it stays off: the next start doesn't ask again.
        click(activity, "Start mirroring")
        assertEquals("Why Car Mirror uses a VPN", title(latestDialog()))
    }

    @Test
    fun locationAlreadyAllowedSkipsTheQuestion() {
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        val activity = open()
        click(activity, "Start mirroring")
        assertEquals("Why Car Mirror uses a VPN", title(latestDialog()))
        assertTrue(motionSwitch(activity).isChecked)
    }

    private fun open(): MainActivity {
        val c = Robolectric.buildActivity(MainActivity::class.java).setup().also { controller = it }
        idle()
        return c.get()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun latestDialog(): AlertDialog =
        ShadowAlertDialog.getLatestAlertDialog()?.takeIf { it.isShowing } ?: error("no dialog showing")

    private fun title(dialog: AlertDialog) = shadowOf(dialog).title.toString()

    private fun press(dialog: AlertDialog, which: Int) {
        dialog.getButton(which).performClick()
        idle()
    }

    private fun answer(activity: Activity, requestCode: Int, permissions: Array<String>, result: Int) {
        activity.onRequestPermissionsResult(requestCode, permissions, IntArray(permissions.size) { result })
        idle()
    }

    private fun page(activity: Activity): View =
        (activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup).getChildAt(0)

    private fun motionSwitch(activity: Activity): Switch =
        findText(page(activity)) { it == "Pause while driving" } as? Switch ?: error("no Pause while driving switch")

    private fun click(activity: Activity, text: String) {
        val view = findText(page(activity)) { it == text } ?: error("no \"$text\" on screen")
        view.performClick()
        idle()
    }

    private fun findText(root: View, match: (String) -> Boolean): View? {
        if (root is TextView && match(root.text.toString())) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) findText(root.getChildAt(i), match)?.let { return it }
        return null
    }
}
