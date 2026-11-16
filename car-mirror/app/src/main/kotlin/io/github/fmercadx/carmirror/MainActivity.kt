package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import io.github.fmercadx.carmirror.core.CarUrls
import io.github.fmercadx.carmirror.core.Pauses
import io.github.fmercadx.carmirror.core.Quality

/**
 * The app's one screen. It is built around what the user is doing right now:
 *
 *   not mirroring  ->  a big Start button, and a short checklist for getting the car ready
 *   mirroring      ->  the address to type in the car, whether the car is connected, and
 *                      Pause / Stop
 *
 * Settings sit below, out of the way. Built in code with platform widgets only (see [Ui]).
 */
class MainActivity : Activity() {

    private lateinit var ui: Ui

    // Status card
    private lateinit var statusDot: View
    private lateinit var statusTitle: TextView
    private lateinit var statusDetail: TextView
    private lateinit var problemView: TextView
    private lateinit var startButton: Button
    private lateinit var runningBlock: LinearLayout
    private lateinit var addressView: TextView
    private lateinit var alternativesBox: LinearLayout
    private var alternativesShownFor: List<String>? = null
    private lateinit var pauseButton: Button
    private lateinit var troubleBox: LinearLayout
    private var troubleShownFor: List<String>? = null
    private var pauseShownAsResume: Boolean? = null

    // Checklist card (only before starting)
    private lateinit var checklistCard: LinearLayout
    private lateinit var hotspotBadge: TextView
    private lateinit var hotspotDetail: TextView
    private lateinit var hotspotButton: Button

    // Settings card
    private lateinit var picture: Ui.Segmented
    private lateinit var pictureDetail: TextView
    private lateinit var touchDetail: TextView
    private lateinit var touchButton: Button
    private lateinit var motionSwitch: Switch
    private lateinit var motionDetail: TextView
    private lateinit var dimSwitch: Switch
    private lateinit var dimDetail: TextView
    private lateinit var touchPrompt: Button
    private lateinit var pairingCard: LinearLayout
    private lateinit var pairingCode: TextView
    private var pairingShownFor: String? = null
    private lateinit var bluetoothDetail: TextView
    private lateinit var bluetoothButton: Button
    private lateinit var pairedDetail: TextView
    private lateinit var forgetButton: Button

    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1000)
        }
    }

    /** Whether the user allowed the VPN, carried from that dialog to the screen-capture one. */
    private var tunnelAllowed = true
    private var askedForNotifications = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        actionBar?.hide() // the screen has its own title
        ui = Ui(this)
        // If the app died while mirroring with the phone dimmed, put the brightness back.
        if (!MirrorState.running) Brightness.restore(this)
        setContentView(buildLayout())
        matchSystemBarsToTheme()
        if (savedInstanceState == null) handleQuickStart(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleQuickStart(intent)
    }

    override fun onStart() {
        super.onStart()
        handler.post(refresh)
    }

    override fun onResume() {
        super.onResume()
        // Back from "Modify system settings": keep the dim switch on only if it was allowed.
        if (settings().getBoolean(KEY_DIM, false) && !Brightness.allowed(this)) {
            settings().edit().putBoolean(KEY_DIM, false).apply()
        }
    }

    override fun onStop() {
        handler.removeCallbacks(refresh)
        super.onStop()
    }

    /** From the Quick Settings tile or the home-screen shortcut: go straight into starting. */
    private fun handleQuickStart(intent: Intent?) {
        if (intent?.action != ACTION_QUICK_START) return
        intent.action = null // only once, not again on the next resume
        if (!MirrorState.running) beginMirroring()
    }

    // ---- Start sequence: notifications -> location (driving pause) -> VPN -> screen capture -> service ----

    private fun beginMirroring() {
        MirrorState.problem = null
        askForNotificationsThenContinue()
    }

    private fun onStopMirroring() {
        startService(Intent(this, MirrorService::class.java).setAction(MirrorService.ACTION_STOP))
        handler.postDelayed({ render() }, 150)
    }

    private fun askForNotificationsThenContinue() {
        if (Build.VERSION.SDK_INT >= 33 && !askedForNotifications &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            askedForNotifications = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
            return
        }
        askForLocationThenContinue()
    }

    /**
     * Pause while driving is on by default, so the first start explains it before Android asks
     * for location. Declining, here or in Android's prompt, switches the setting off rather than
     * asking again at every start; mirroring then goes ahead without it.
     */
    private fun askForLocationThenContinue() {
        if (!wantsPauseWhileMoving() || hasLocationPermission()) {
            askForVpn()
            return
        }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.pause_while_driving))
            .setMessage(getString(R.string.location_explanation))
            .setPositiveButton(getString(R.string.action_continue)) { _, _ -> requestPermissions(LOCATION_PERMISSIONS, REQUEST_LOCATION_AT_START) }
            .setNegativeButton(getString(R.string.action_turn_it_off)) { _, _ ->
                setPauseWhileMoving(false)
                askForVpn()
            }
            .setCancelable(false)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            // Mirroring works without the notification; it is only the easy way to pause and stop.
            REQUEST_NOTIFICATIONS -> askForLocationThenContinue()
            REQUEST_LOCATION -> setPauseWhileMoving(hasLocationPermission())
            REQUEST_BLUETOOTH -> if (CarBluetooth.permitted(this)) chooseCar() else {
                AlertDialog.Builder(this)
                    .setTitle(getString(R.string.nearby_off_title))
                    .setMessage(getString(R.string.nearby_off_message))
                    .setPositiveButton(getString(R.string.action_ok), null)
                    .show()
            }
            REQUEST_LOCATION_AT_START -> {
                setPauseWhileMoving(hasLocationPermission())
                askForVpn()
            }
        }
    }

    private fun askForVpn() {
        val consent = VpnService.prepare(this)
        if (consent == null) {
            askForScreen(tunnel = true)
            return
        }
        // Android's own VPN prompt says nothing about why. Explain first, so the user can
        // make an informed choice; Google Play also expects VPN use to be disclosed in-app.
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.vpn_title))
            .setMessage(getString(R.string.vpn_explanation))
            .setPositiveButton(getString(R.string.action_continue)) { _, _ ->
                try {
                    startActivityForResult(consent, REQUEST_VPN)
                } catch (e: ActivityNotFoundException) {
                    askForScreen(tunnel = false)
                }
            }
            .setNegativeButton(getString(R.string.action_cancel)) { _, _ ->
                MirrorState.problem = getString(R.string.problem_vpn_needed)
                render()
            }
            .setCancelable(false)
            .show()
    }

    private fun askForScreen(tunnel: Boolean) {
        tunnelAllowed = tunnel
        val manager = service<MediaProjectionManager>()
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_SCREEN)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_VPN -> askForScreen(tunnel = resultCode == RESULT_OK)
            REQUEST_SCREEN ->
                if (resultCode == RESULT_OK && data != null) {
                    startForegroundService(
                        Intent(this, MirrorService::class.java)
                            .setAction(MirrorService.ACTION_START)
                            .putExtra(MirrorService.EXTRA_RESULT_CODE, resultCode)
                            .putExtra(MirrorService.EXTRA_RESULT_DATA, data)
                            .putExtra(MirrorService.EXTRA_QUALITY, savedQuality().name)
                            .putExtra(MirrorService.EXTRA_TUNNEL, tunnelAllowed)
                            .putExtra(MirrorService.EXTRA_PAUSE_WHILE_MOVING, pauseWhileMoving())
                            .putExtra(MirrorService.EXTRA_DIM, dimPhone()),
                    )
                    handler.postDelayed({ render() }, 300)
                } else {
                    MirrorState.problem = getString(R.string.problem_capture_cancelled)
                    render()
                }
        }
    }

    // ---- Settings ----

    private fun settings() = getSharedPreferences(SETTINGS, MODE_PRIVATE)

    private fun savedQuality(): Quality =
        Quality.entries.firstOrNull { it.name == settings().getString(KEY_QUALITY, null) } ?: Quality.BALANCED

    private fun hasLocationPermission() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** The setting: on unless the user switched it off or declined location. */
    private fun wantsPauseWhileMoving() = settings().getBoolean(KEY_PAUSE_WHILE_MOVING, true)

    /** Whether this start can actually watch GPS: the setting is on and location is granted. */
    private fun pauseWhileMoving() = wantsPauseWhileMoving() && hasLocationPermission()

    private fun setPauseWhileMoving(on: Boolean) {
        settings().edit().putBoolean(KEY_PAUSE_WHILE_MOVING, on).apply()
        motionSwitch.isChecked = on
        render()
    }

    private fun onMotionSwitch(checked: Boolean) {
        if (checked && !hasLocationPermission()) {
            requestPermissions(LOCATION_PERMISSIONS, REQUEST_LOCATION)
            return // saved once the user answers
        }
        setPauseWhileMoving(checked)
    }

    private fun dimPhone() = settings().getBoolean(KEY_DIM, false) && Brightness.allowed(this)

    private fun onDimSwitch(checked: Boolean) {
        if (checked && !Brightness.allowed(this)) {
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.dim_title))
                .setMessage(getString(R.string.dim_explanation))
                .setPositiveButton(getString(R.string.action_continue)) { _, _ ->
                    settings().edit().putBoolean(KEY_DIM, true).apply()
                    openFirst(
                        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, android.net.Uri.parse("package:$packageName")),
                        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS),
                    )
                }
                .setNegativeButton(getString(R.string.action_cancel)) { _, _ -> render() }
                .setOnCancelListener { render() }
                .show()
            return
        }
        settings().edit().putBoolean(KEY_DIM, checked).apply()
        if (MirrorState.running) {
            startService(Intent(this, MirrorService::class.java)
                .setAction(MirrorService.ACTION_DIM)
                .putExtra(MirrorService.EXTRA_DIM, checked))
        }
        render()
    }

    private fun onPauseToggle() {
        val action = if (MirrorState.paused == Pauses.PRIVACY) MirrorService.ACTION_RESUME else MirrorService.ACTION_PAUSE
        startService(Intent(this, MirrorService::class.java).setAction(action))
        handler.postDelayed({ render() }, 150)
    }

    /**
     * Touch control needs Android's Accessibility permission, which only the user can turn on,
     * in Settings. Say plainly what it does and doesn't do before sending them there.
     */
    private fun setUpTouchControl() {
        if (TouchService.instance != null) {
            openAccessibilitySettings() // already on; this button is for turning it off
            return
        }
        val restrictedNote = if (Build.VERSION.SDK_INT >= 33) getString(R.string.touch_restricted_note) else ""
        val dialog = AlertDialog.Builder(this)
            .setTitle(getString(R.string.turn_on_touch_control))
            .setMessage(getString(R.string.touch_explanation) + restrictedNote)
            .setPositiveButton(getString(R.string.action_open_settings)) { _, _ -> openAccessibilitySettings() }
            .setNegativeButton(getString(R.string.action_not_now), null)
        if (Build.VERSION.SDK_INT >= 33) {
            // For "App was denied access": the Allow restricted settings switch is on this page.
            dialog.setNeutralButton(getString(R.string.action_app_info)) { _, _ ->
                openFirst(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
            }
        }
        dialog.show()
    }

    private fun openAccessibilitySettings() = openFirst(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
        Intent(Settings.ACTION_SETTINGS),
    )

    private fun openHotspotSettings() = openFirst(
        Intent().setClassName("com.android.settings", "com.android.settings.TetherSettings"),
        Intent(Settings.ACTION_WIRELESS_SETTINGS),
        Intent(Settings.ACTION_SETTINGS),
    )

    private fun openFirst(vararg intents: Intent) {
        for (intent in intents) {
            try {
                startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
            } catch (_: SecurityException) {
            }
        }
    }

    // ---- Rendering ----

    private enum class Tone(val dot: Int, val title: Int) {
        IDLE(R.color.muted, R.color.on_surface),
        WAITING(R.color.accent, R.color.on_surface),
        GOOD(R.color.success, R.color.success),
        ATTENTION(R.color.warning, R.color.warning),
    }

    private fun render() {
        val running = MirrorState.running
        val paused = MirrorState.paused
        val viewer = MirrorState.server?.recentViewers()?.firstOrNull()
        val urls = MirrorState.urls(this)

        // Status: one line that says what is going on, and one that says what to do next.
        val (tone, title, detail) = when {
            !running -> Triple(Tone.IDLE, getString(R.string.status_ready_title), getString(R.string.status_ready_detail))
            paused == Pauses.PRIVACY -> Triple(Tone.ATTENTION, getString(R.string.paused), getString(R.string.status_paused_detail))
            paused == Pauses.LOCKED -> Triple(Tone.ATTENTION, getString(R.string.status_locked_title), getString(R.string.status_locked_detail))
            paused == Pauses.HOT -> Triple(Tone.ATTENTION, getString(R.string.status_hot_title),
                getString(R.string.status_hot_detail))
            paused == Pauses.DRIVING -> Triple(Tone.ATTENTION, getString(R.string.status_driving_title), getString(R.string.status_driving_detail))
            viewer != null -> Triple(Tone.GOOD, getString(R.string.status_connected_title),
                getString(if (MirrorState.heatEasing) R.string.status_connected_warm_detail else R.string.status_connected_detail,
                    viewer.host.ifEmpty { viewer.remoteAddress }))
            urls.isEmpty() -> Triple(Tone.ATTENTION, getString(R.string.status_no_hotspot_title),
                getString(R.string.status_no_hotspot_detail))
            else -> Triple(Tone.WAITING, getString(R.string.status_waiting_title), getString(R.string.status_waiting_detail))
        }
        (statusDot.background as android.graphics.drawable.GradientDrawable).setColor(ui.color(tone.dot))
        statusTitle.text = title
        statusTitle.setTextColor(ui.color(tone.title))
        statusDetail.text = detail

        val problem = MirrorState.problem
        problemView.visibility = if (problem == null) View.GONE else View.VISIBLE
        problemView.text = problem.orEmpty()

        startButton.visibility = if (running) View.GONE else View.VISIBLE
        runningBlock.visibility = if (running) View.VISIBLE else View.GONE
        checklistCard.visibility = if (running) View.GONE else View.VISIBLE

        addressView.visibility = if (urls.isEmpty()) View.GONE else View.VISIBLE
        addressView.text = urls.firstOrNull()?.let { CarUrls.typed(it) }.orEmpty()
        addressView.alpha = if (paused != null) 0.45f else 1f
        // Until the car connects, show every other address too: which one the car's browser
        // accepts isn't known in advance, and the first that loads is the one to use.
        // Once the car has shown which kind of address it accepts, offer only that one.
        val knownGood = WorkingAddress.known(this) != null
        val alternatives = if (viewer == null && paused == null && !knownGood) urls.drop(1) else emptyList()
        if (alternativesShownFor != alternatives) {
            alternativesShownFor = alternatives
            alternativesBox.removeAllViews()
            if (alternatives.isNotEmpty()) {
                alternativesBox.addView(ui.text(getString(R.string.alternatives_title), 14f, R.color.muted))
                alternatives.forEachIndexed { i, url ->
                    // Number and address side by side; the address shrinks to fit rather than
                    // wrapping onto a second line on narrow phones.
                    alternativesBox.addView(ui.horizontal().apply {
                        addView(ui.text("${i + 2}.", 16f).apply { typeface = Typeface.MONOSPACE },
                            LinearLayout.LayoutParams(ui.dp(32), WRAP_CONTENT))
                        addView(ui.text(CarUrls.typed(url), 16f).apply {
                            typeface = Typeface.MONOSPACE
                            maxLines = 1
                            setAutoSizeTextTypeUniformWithConfiguration(10, 16, 1, TypedValue.COMPLEX_UNIT_SP)
                            setTextIsSelectable(true)
                        }, LinearLayout.LayoutParams(0, ui.dp(24), 1f))
                    }, ui.matchWidth(topDp = 6))
                }
            }
            alternativesBox.visibility = if (alternatives.isEmpty()) View.GONE else View.VISIBLE
        }
        val resume = paused == Pauses.PRIVACY
        if (pauseShownAsResume != resume) {
            pauseShownAsResume = resume
            pauseButton.text = if (resume) getString(R.string.action_resume) else getString(R.string.action_pause)
            ui.restyle(pauseButton, if (resume) Ui.Style.PRIMARY else Ui.Style.SECONDARY)
        }
        if (troubleShownFor != urls) {
            troubleShownFor = urls
            troubleBox.removeAllViews()
            val tips = troubleTips().toMutableList()
            if (knownGood && urls.size > 1) {
                tips += getString(R.string.other_addresses, urls.drop(1).joinToString("\n") { CarUrls.typed(it) })
            }
            troubleBox.addView(ui.bullets(tips, sizeSp = 14f, colorId = R.color.muted, gapDp = 8))
        }

        // Checklist: tick the hotspot step when the phone can tell it is on.
        val hotspotOn = Hotspot.looksOn(this)
        hotspotBadge.text = if (hotspotOn) "✓" else "1"
        hotspotBadge.setTextColor(ui.color(if (hotspotOn) R.color.on_accent else R.color.accent))
        hotspotBadge.background = ui.rounded(ui.color(if (hotspotOn) R.color.success else R.color.accent_container), 14)
        hotspotDetail.text = if (hotspotOn) getString(R.string.hotspot_on) else getString(R.string.hotspot_off_hint)
        hotspotButton.visibility = if (hotspotOn) View.GONE else View.VISIBLE

        // A screen asking to pair: show its code until it is answered.
        val request = MirrorState.pairingRequests.lastOrNull()
        pairingCard.visibility = if (request != null && running) View.VISIBLE else View.GONE
        if (request?.id != pairingShownFor) {
            pairingShownFor = request?.id
            pairingCode.text = request?.code?.chunked(3)?.joinToString(" ").orEmpty()
        }

        // Settings
        val car = CarBluetooth.chosen(this)
        bluetoothDetail.text = if (car != null) {
            getString(R.string.bluetooth_on, car.name)
        } else {
            getString(R.string.bluetooth_off)
        }
        bluetoothButton.text = if (car != null) getString(R.string.action_change) else getString(R.string.action_choose)
        val paired = pairedCount()
        pairedDetail.text = when (paired) {
            0 -> getString(R.string.paired_none)
            1 -> getString(R.string.paired_one)
            else -> getString(R.string.paired_many, paired)
        }
        forgetButton.isEnabled = paired > 0
        forgetButton.alpha = if (paired > 0) 1f else 0.5f
        val quality = savedQuality()
        picture.select(quality.ordinal)
        picture.setEnabled(!running)
        pictureDetail.text = if (running) getString(R.string.picture_detail_running, qualityHelp(quality)) else qualityHelp(quality)

        val touchOn = TouchService.instance != null
        touchPrompt.visibility = if (running && !touchOn) View.VISIBLE else View.GONE
        touchDetail.text = if (touchOn) {
            getString(R.string.touch_on_detail)
        } else {
            getString(R.string.touch_off_detail)
        }
        touchButton.text = if (touchOn) getString(R.string.settings) else getString(R.string.action_turn_on)

        if (dimSwitch.isChecked != dimPhone()) dimSwitch.isChecked = dimPhone()
        dimDetail.text = getString(R.string.dim_detail)

        val wantsMotion = wantsPauseWhileMoving()
        if (motionSwitch.isChecked != wantsMotion) motionSwitch.isChecked = wantsMotion
        motionDetail.text = when {
            running && wantsMotion != MirrorState.watchingMotion -> getString(R.string.motion_takes_effect)
            wantsMotion && !hasLocationPermission() ->
                getString(R.string.motion_needs_location)
            else -> getString(R.string.motion_detail)
        }
    }

    // ---- Layout ----

    private fun buildLayout(): View {
        val page = ui.vertical().apply { setPadding(ui.dp(18), ui.dp(12), ui.dp(18), ui.dp(32)) }

        page.addView(ui.text(getString(R.string.app_name), 30f, bold = true))
        page.addView(ui.text(getString(R.string.tagline), 16f, R.color.muted, topDp = 2))

        pairingCard = pairingCard()
        page.addView(pairingCard, ui.matchWidth(topDp = 20))
        page.addView(statusCard(), ui.matchWidth(topDp = 20))
        checklistCard = checklistCard()
        page.addView(checklistCard, ui.matchWidth(topDp = 14))

        page.addView(sectionTitle(getString(R.string.settings)))
        page.addView(settingsCard(), ui.matchWidth(topDp = 8))

        page.addView(sectionTitle(getString(R.string.good_to_know)))
        page.addView(tipsCard(), ui.matchWidth(topDp = 8))

        return ScrollView(this).apply {
            setBackgroundColor(ui.color(R.color.background))
            isFillViewport = true
            addView(page, MATCH_PARENT, WRAP_CONTENT)
            // Android 15+ draws apps edge to edge; keep content clear of the status and nav bars.
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= 30) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                        insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                }
                insets
            }
        }
    }

    private fun sectionTitle(value: String) = ui.text(value, 14f, R.color.muted, bold = true, topDp = 26).apply {
        isAllCaps = true
        letterSpacing = 0.06f
        setPadding(ui.dp(4), paddingTop, 0, 0)
    }

    /** A screen asking to be paired: the code to compare, and Allow or Deny. */
    private fun pairingCard(): LinearLayout = ui.card().apply {
        visibility = View.GONE
        background = ui.rounded(ui.color(R.color.accent_container), 22)
        addView(ui.text(getString(R.string.pairing_title), 22f, bold = true))
        addView(ui.text(getString(R.string.pairing_detail),
            16f, R.color.on_surface, topDp = 6))
        pairingCode = ui.text("", 40f, bold = true, topDp = 12).apply {
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            letterSpacing = 0.08f
        }
        addView(pairingCode)
        addView(ui.horizontal().apply {
            addView(ui.button(getString(R.string.action_deny), Ui.Style.SECONDARY) { answerPairing(MirrorService.ACTION_PAIR_DENY) }, ui.weighted())
            addView(ui.button(getString(R.string.action_allow), Ui.Style.PRIMARY) { answerPairing(MirrorService.ACTION_PAIR_ALLOW) }, ui.weighted(startDp = 12))
        }, ui.matchWidth(topDp = 16))
    }

    private fun answerPairing(action: String) {
        val id = pairingShownFor ?: return
        startService(Intent(this, MirrorService::class.java).setAction(action).putExtra(MirrorService.EXTRA_PAIR_ID, id))
        pairingCard.visibility = View.GONE
        handler.postDelayed({ render() }, 200)
    }

    /** Picks the car's Bluetooth device from the phone's paired ones, after the permission. */
    private fun chooseCar() {
        if (!CarBluetooth.permitted(this)) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQUEST_BLUETOOTH)
            return
        }
        val devices = CarBluetooth.pairedDevices(this)
        if (devices.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.no_bluetooth_title))
                .setMessage(getString(R.string.no_bluetooth_message))
                .setPositiveButton(getString(R.string.action_ok), null)
                .show()
            return
        }
        val current = CarBluetooth.chosen(this)?.address
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.bluetooth_pick_title))
            .setSingleChoiceItems(devices.map { it.name }.toTypedArray(), devices.indexOfFirst { it.address == current }) { dialog, which ->
                CarBluetooth.choose(this, devices[which])
                dialog.dismiss()
                render()
            }
            .setNeutralButton(getString(R.string.action_turn_off)) { _, _ ->
                CarBluetooth.choose(this, null)
                render()
            }
            .setNegativeButton(getString(R.string.action_cancel), null)
            .show()
    }

    private fun troubleTips(): List<String> = listOf(
        R.string.trouble_wifi, R.string.trouble_5ghz, R.string.trouble_exact, R.string.trouble_http, R.string.trouble_vpn,
    ).map(::getString)

    private fun qualityLabel(quality: Quality): String = getString(when (quality) {
        Quality.SMOOTH -> R.string.quality_smooth
        Quality.BALANCED -> R.string.quality_balanced
        Quality.SHARP -> R.string.quality_sharp
    })

    private fun qualityHelp(quality: Quality): String = getString(when (quality) {
        Quality.SMOOTH -> R.string.quality_smooth_help
        Quality.BALANCED -> R.string.quality_balanced_help
        Quality.SHARP -> R.string.quality_sharp_help
    })

    private fun pairedCount(): Int = MirrorState.server?.pairing?.pairedCount ?: PhonePairingStore(this).load().size

    private fun forgetPairedScreens() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.forget_title))
            .setMessage(getString(R.string.forget_message))
            .setPositiveButton(getString(R.string.action_forget)) { _, _ ->
                MirrorState.server?.pairing?.forgetAll() ?: PhonePairingStore(this).save(emptyMap())
                render()
            }
            .setNegativeButton(getString(R.string.action_cancel), null)
            .show()
    }

    private fun statusCard(): View = ui.card().apply {
        statusDot = ui.dot(12, R.color.muted)
        statusTitle = ui.text("", 22f, bold = true)
        addView(ui.horizontal().apply {
            addView(statusDot)
            addView(statusTitle, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginStart = ui.dp(10) })
        })
        statusDetail = ui.text("", 16f, R.color.muted, topDp = 6)
        addView(statusDetail)

        problemView = ui.text("", 15f, R.color.warning).apply {
            background = ui.rounded(ui.color(R.color.warning_container), 12)
            setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12))
            visibility = View.GONE
        }
        addView(problemView, ui.matchWidth(topDp = 14))

        startButton = ui.button(getString(R.string.start_mirroring), Ui.Style.PRIMARY, heightDp = 60) { beginMirroring() }
        addView(startButton, ui.matchWidth(topDp = 18, heightDp = 60))

        runningBlock = ui.vertical().apply {
            addressView = ui.text("", 28f, bold = true).apply {
                typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                // Shrinks to fit narrow phones instead of wrapping mid-address.
                setAutoSizeTextTypeUniformWithConfiguration(14, 28, 1, TypedValue.COMPLEX_UNIT_SP)
                setTextIsSelectable(true)
                background = ui.rounded(ui.color(R.color.surface_variant), 14)
                setPadding(ui.dp(12), ui.dp(16), ui.dp(12), ui.dp(16))
            }
            addView(addressView, ui.matchWidth(topDp = 14))
            alternativesBox = ui.vertical().apply { visibility = View.GONE }
            addView(alternativesBox, ui.matchWidth(topDp = 12))

            addView(ui.horizontal().apply {
                pauseButton = ui.button(getString(R.string.action_pause), Ui.Style.SECONDARY) { onPauseToggle() }
                addView(pauseButton, ui.weighted())
                addView(ui.button(getString(R.string.action_stop), Ui.Style.DANGER) { onStopMirroring() }, ui.weighted(startDp = 10))
            }, ui.matchWidth(topDp = 16))

            touchPrompt = ui.button(getString(R.string.turn_on_touch_control), Ui.Style.QUIET, heightDp = 44) { setUpTouchControl() }
            addView(touchPrompt, ui.matchWidth(topDp = 6))

            troubleBox = ui.vertical().apply {
                visibility = View.GONE
                setPadding(0, ui.dp(4), 0, 0)
            }
            addView(ui.button(getString(R.string.page_wont_load), Ui.Style.QUIET, heightDp = 44) {
                troubleBox.visibility = if (troubleBox.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            }, ui.matchWidth(topDp = 6))
            addView(troubleBox, ui.matchWidth())
        }
        addView(runningBlock, ui.matchWidth())
    }

    private fun checklistCard(): LinearLayout = ui.card().apply {
        addView(ui.text(getString(R.string.before_you_start), 18f, bold = true))

        val hotspot = step("1", getString(R.string.step_hotspot), "")
        hotspotBadge = hotspot.badge
        hotspotDetail = hotspot.detail
        hotspotButton = ui.button(getString(R.string.open_hotspot_settings), Ui.Style.SECONDARY, heightDp = 44) { openHotspotSettings() }
        hotspot.body.addView(hotspotButton, LinearLayout.LayoutParams(WRAP_CONTENT, ui.dp(44)).apply { topMargin = ui.dp(10) })
        addView(hotspot.row, ui.matchWidth(topDp = 14))

        addView(step("2", getString(R.string.step_connect_title),
            getString(R.string.step_connect_detail)).row, ui.matchWidth(topDp = 16))

        addView(step("3", getString(R.string.step_start_title),
            getString(R.string.step_start_detail)).row,
            ui.matchWidth(topDp = 16))
    }

    private class Step(val row: LinearLayout, val badge: TextView, val body: LinearLayout, val detail: TextView)

    private fun step(number: String, title: String, detail: String): Step {
        val badge = ui.text(number, 14f, R.color.accent, bold = true).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(ui.color(R.color.accent_container), 14)
        }
        val detailView = ui.text(detail, 15f, R.color.muted, topDp = 2)
        val body = ui.vertical().apply {
            addView(ui.text(title, 16f, bold = true))
            addView(detailView)
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(badge, LinearLayout.LayoutParams(ui.dp(28), ui.dp(28)))
            addView(body, ui.weighted(startDp = 14))
        }
        return Step(row, badge, body, detailView)
    }

    private fun settingsCard(): View = ui.card().apply {
        addView(ui.text(getString(R.string.setting_picture), 16f, bold = true))
        picture = ui.Segmented(Quality.entries.map { qualityLabel(it) }) { index ->
            settings().edit().putString(KEY_QUALITY, Quality.entries[index].name).apply()
            render()
        }
        addView(picture.view, ui.matchWidth(topDp = 10))
        pictureDetail = ui.text("", 14f, R.color.muted, topDp = 8)
        addView(pictureDetail)

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        addView(ui.horizontal().apply {
            addView(ui.vertical().apply {
                addView(ui.text(getString(R.string.setting_touch), 16f, bold = true))
                touchDetail = ui.text("", 14f, R.color.muted, topDp = 2)
                addView(touchDetail)
            }, ui.weighted())
            touchButton = ui.button(getString(R.string.action_turn_on), Ui.Style.SECONDARY, heightDp = 44) { setUpTouchControl() }
            addView(touchButton, LinearLayout.LayoutParams(WRAP_CONTENT, ui.dp(44)).apply { marginStart = ui.dp(12) })
        }, ui.matchWidth(topDp = 18))

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        motionSwitch = Switch(this@MainActivity).apply {
            text = getString(R.string.pause_while_driving)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(ui.color(R.color.on_surface))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            isChecked = wantsPauseWhileMoving()
            setOnClickListener { onMotionSwitch(isChecked) }
        }
        addView(motionSwitch, ui.matchWidth(topDp = 14))
        motionDetail = ui.text("", 14f, R.color.muted, topDp = 2)
        addView(motionDetail)

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        dimSwitch = Switch(this@MainActivity).apply {
            text = getString(R.string.setting_dim)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(ui.color(R.color.on_surface))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            isChecked = dimPhone()
            setOnClickListener { onDimSwitch(isChecked) }
        }
        addView(dimSwitch, ui.matchWidth(topDp = 14))
        dimDetail = ui.text("", 14f, R.color.muted, topDp = 2)
        addView(dimDetail)

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        addView(ui.horizontal().apply {
            addView(ui.vertical().apply {
                addView(ui.text(getString(R.string.setting_bluetooth), 16f, bold = true))
                bluetoothDetail = ui.text("", 14f, R.color.muted, topDp = 2)
                addView(bluetoothDetail)
            }, ui.weighted())
            bluetoothButton = ui.button(getString(R.string.action_choose), Ui.Style.SECONDARY, heightDp = 44) { chooseCar() }
            addView(bluetoothButton, LinearLayout.LayoutParams(WRAP_CONTENT, ui.dp(44)).apply { marginStart = ui.dp(12) })
        }, ui.matchWidth(topDp = 18))

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        addView(ui.horizontal().apply {
            addView(ui.vertical().apply {
                addView(ui.text(getString(R.string.setting_paired), 16f, bold = true))
                pairedDetail = ui.text("", 14f, R.color.muted, topDp = 2)
                addView(pairedDetail)
            }, ui.weighted())
            forgetButton = ui.button(getString(R.string.action_forget), Ui.Style.SECONDARY, heightDp = 44) { forgetPairedScreens() }
            addView(forgetButton, LinearLayout.LayoutParams(WRAP_CONTENT, ui.dp(44)).apply { marginStart = ui.dp(12) })
        }, ui.matchWidth(topDp = 18))
    }

    private fun tipsCard(): View = ui.card().apply {
        val tips = listOf(
            R.string.tip_full_screen, R.string.tip_5ghz, R.string.tip_sound,
            R.string.tip_quick_start, R.string.tip_battery, R.string.tip_safety,
        ).map(::getString)
        addView(ui.bullets(tips))
    }

    /** Dark status-bar icons on the light theme, light icons on the dark one. */
    private fun matchSystemBarsToTheme() {
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        @Suppress("DEPRECATION") // no effect from Android 15, where the app draws behind the bars anyway
        run {
            window.statusBarColor = ui.color(R.color.background)
            window.navigationBarColor = ui.color(R.color.background)
        }
        if (Build.VERSION.SDK_INT >= 30) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (night) 0 else light, light)
        } else if (!night) {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
    }

    companion object {
        /** Sent by the Quick Settings tile and the home-screen shortcut. */
        const val ACTION_QUICK_START = "io.github.fmercadx.carmirror.QUICK_START"

        private const val REQUEST_NOTIFICATIONS = 1
        private const val REQUEST_VPN = 2
        private const val REQUEST_SCREEN = 3
        private const val REQUEST_LOCATION = 4
        private const val REQUEST_LOCATION_AT_START = 5
        private const val REQUEST_BLUETOOTH = 6
        private val LOCATION_PERMISSIONS =
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        private const val SETTINGS = "settings"
        private const val KEY_QUALITY = "quality"
        private const val KEY_PAUSE_WHILE_MOVING = "pauseWhileMoving"
        private const val KEY_DIM = "dimPhone"
    }
}
