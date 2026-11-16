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
            .setTitle("Pause while driving")
            .setMessage(LOCATION_EXPLANATION)
            .setPositiveButton("Continue") { _, _ -> requestPermissions(LOCATION_PERMISSIONS, REQUEST_LOCATION_AT_START) }
            .setNegativeButton("Turn it off") { _, _ ->
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
            .setTitle("Why Car Mirror uses a VPN")
            .setMessage(VPN_EXPLANATION)
            .setPositiveButton("Continue") { _, _ ->
                try {
                    startActivityForResult(consent, REQUEST_VPN)
                } catch (e: ActivityNotFoundException) {
                    askForScreen(tunnel = false)
                }
            }
            .setNegativeButton("Cancel") { _, _ ->
                MirrorState.problem = "Mirroring needs the VPN step so your car can reach your phone."
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
                    MirrorState.problem = "Screen sharing was cancelled. Tap Start mirroring to try again."
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
                .setTitle("Dim this phone")
                .setMessage(
                    "To turn your phone's brightness down while mirroring, Android needs you to let " +
                        "Car Mirror modify system settings. It only changes brightness, and puts yours " +
                        "back when you stop mirroring.\n\nOn the next screen, switch on Allow.",
                )
                .setPositiveButton("Continue") { _, _ ->
                    settings().edit().putBoolean(KEY_DIM, true).apply()
                    openFirst(
                        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, android.net.Uri.parse("package:$packageName")),
                        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS),
                    )
                }
                .setNegativeButton("Cancel") { _, _ -> render() }
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
        val action = if (MirrorState.paused == "privacy") MirrorService.ACTION_RESUME else MirrorService.ACTION_PAUSE
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
        val restrictedNote = if (Build.VERSION.SDK_INT >= 33) {
            "\n\nIf it's greyed out or Android says \"App was denied access\": tap App info below, " +
                "then ⋮ (top right) → Allow restricted settings, then come back and switch it on. " +
                "Android asks this once, for apps not installed from the Play Store."
        } else {
            ""
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Turn on touch control")
            .setMessage(TOUCH_EXPLANATION + restrictedNote)
            .setPositiveButton("Open settings") { _, _ -> openAccessibilitySettings() }
            .setNegativeButton("Not now", null)
        if (Build.VERSION.SDK_INT >= 33) {
            // For "App was denied access": the Allow restricted settings switch is on this page.
            dialog.setNeutralButton("App info") { _, _ ->
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
            !running -> Triple(Tone.IDLE, "Ready to mirror", "Tap Start, then type the address it shows into your Tesla's browser.")
            paused == "privacy" -> Triple(Tone.ATTENTION, "Paused", "Your car's screen is blank. Tap Resume when you're ready.")
            paused == "driving" -> Triple(Tone.ATTENTION, "Paused while driving", "The picture comes back a few seconds after the car stops.")
            viewer != null -> Triple(Tone.GOOD, "Connected to your car",
                "Your screen is showing on the car. It opened ${viewer.host.ifEmpty { viewer.remoteAddress }}.")
            urls.isEmpty() -> Triple(Tone.ATTENTION, "Turn on your hotspot",
                "Your car connects through your phone's hotspot. Turn it on, then connect the car to it.")
            else -> Triple(Tone.WAITING, "Waiting for your car", "In your Tesla's browser, go to this address:")
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
                alternativesBox.addView(ui.text("If it doesn't load, try these in order:", 14f, R.color.muted))
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
        val resume = paused == "privacy"
        if (pauseShownAsResume != resume) {
            pauseShownAsResume = resume
            pauseButton.text = if (resume) "Resume" else "Pause"
            ui.restyle(pauseButton, if (resume) Ui.Style.PRIMARY else Ui.Style.SECONDARY)
        }
        if (troubleShownFor != urls) {
            troubleShownFor = urls
            troubleBox.removeAllViews()
            val tips = TROUBLE_TIPS.toMutableList()
            if (knownGood && urls.size > 1) {
                tips += "Other addresses that reach the same page:\n" + urls.drop(1).joinToString("\n") { CarUrls.typed(it) }
            }
            troubleBox.addView(ui.bullets(tips, sizeSp = 14f, colorId = R.color.muted, gapDp = 8))
        }

        // Checklist: tick the hotspot step when the phone can tell it is on.
        val hotspotOn = Hotspot.looksOn(this)
        hotspotBadge.text = if (hotspotOn) "✓" else "1"
        hotspotBadge.setTextColor(ui.color(if (hotspotOn) R.color.on_accent else R.color.accent))
        hotspotBadge.background = ui.rounded(ui.color(if (hotspotOn) R.color.success else R.color.accent_container), 14)
        hotspotDetail.text = if (hotspotOn) "Your hotspot is on." else "Settings → Hotspot. Note its name and password."
        hotspotButton.visibility = if (hotspotOn) View.GONE else View.VISIBLE

        // Settings
        val quality = savedQuality()
        picture.select(quality.ordinal)
        picture.setEnabled(!running)
        pictureDetail.text = QUALITY_HELP.getValue(quality) + if (running) " Stop mirroring to change this." else ""

        val touchOn = TouchService.instance != null
        touchPrompt.visibility = if (running && !touchOn) View.VISIBLE else View.GONE
        touchDetail.text = if (touchOn) {
            "On. Tap and swipe on the car's screen to use your phone."
        } else {
            "Off. Turn it on to tap and swipe on the car's screen."
        }
        touchButton.text = if (touchOn) "Settings" else "Turn on"

        if (dimSwitch.isChecked != dimPhone()) dimSwitch.isChecked = dimPhone()
        dimDetail.text = "Turns your phone's brightness right down while mirroring, so it isn't " +
            "glowing next to the car's screen. The car's picture isn't affected."

        val wantsMotion = wantsPauseWhileMoving()
        if (motionSwitch.isChecked != wantsMotion) motionSwitch.isChecked = wantsMotion
        motionDetail.text = when {
            running && wantsMotion != MirrorState.watchingMotion -> "Takes effect the next time you start."
            wantsMotion && !hasLocationPermission() ->
                "Blanks the car's screen while you drive, maps included. You'll be asked to allow " +
                    "location when you start."
            else -> "Blanks the car's screen while you drive, maps included. Uses GPS on your phone only."
        }
    }

    // ---- Layout ----

    private fun buildLayout(): View {
        val page = ui.vertical().apply { setPadding(ui.dp(18), ui.dp(12), ui.dp(18), ui.dp(32)) }

        page.addView(ui.text("Car Mirror", 30f, bold = true))
        page.addView(ui.text("Your phone, on your Tesla's screen.", 16f, R.color.muted, topDp = 2))

        page.addView(statusCard(), ui.matchWidth(topDp = 20))
        checklistCard = checklistCard()
        page.addView(checklistCard, ui.matchWidth(topDp = 14))

        page.addView(sectionTitle("Settings"))
        page.addView(settingsCard(), ui.matchWidth(topDp = 8))

        page.addView(sectionTitle("Good to know"))
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

        startButton = ui.button("Start mirroring", Ui.Style.PRIMARY, heightDp = 60) { beginMirroring() }
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
                pauseButton = ui.button("Pause", Ui.Style.SECONDARY) { onPauseToggle() }
                addView(pauseButton, ui.weighted())
                addView(ui.button("Stop", Ui.Style.DANGER) { onStopMirroring() }, ui.weighted(startDp = 10))
            }, ui.matchWidth(topDp = 16))

            touchPrompt = ui.button("Turn on touch control", Ui.Style.QUIET, heightDp = 44) { setUpTouchControl() }
            addView(touchPrompt, ui.matchWidth(topDp = 6))

            troubleBox = ui.vertical().apply {
                visibility = View.GONE
                setPadding(0, ui.dp(4), 0, 0)
            }
            addView(ui.button("Page won't load?", Ui.Style.QUIET, heightDp = 44) {
                troubleBox.visibility = if (troubleBox.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            }, ui.matchWidth(topDp = 6))
            addView(troubleBox, ui.matchWidth())
        }
        addView(runningBlock, ui.matchWidth())
    }

    private fun checklistCard(): LinearLayout = ui.card().apply {
        addView(ui.text("Before you start", 18f, bold = true))

        val hotspot = step("1", "Turn on your phone's hotspot", "")
        hotspotBadge = hotspot.badge
        hotspotDetail = hotspot.detail
        hotspotButton = ui.button("Open hotspot settings", Ui.Style.SECONDARY, heightDp = 44) { openHotspotSettings() }
        hotspot.body.addView(hotspotButton, LinearLayout.LayoutParams(WRAP_CONTENT, ui.dp(44)).apply { topMargin = ui.dp(10) })
        addView(hotspot.row, ui.matchWidth(topDp = 14))

        addView(step("2", "Connect your Tesla to it",
            "On the car's screen, tap the Wi-Fi icon at the top and pick your phone's hotspot, " +
                "not your home Wi-Fi. The car remembers it next time.").row, ui.matchWidth(topDp = 16))

        addView(step("3", "Tap Start mirroring",
            "Allow what Android asks, then type the address the app shows into the car's browser.").row,
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
        addView(ui.text("Picture", 16f, bold = true))
        picture = ui.Segmented(Quality.entries.map { it.label }) { index ->
            settings().edit().putString(KEY_QUALITY, Quality.entries[index].name).apply()
            render()
        }
        addView(picture.view, ui.matchWidth(topDp = 10))
        pictureDetail = ui.text("", 14f, R.color.muted, topDp = 8)
        addView(pictureDetail)

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        addView(ui.horizontal().apply {
            addView(ui.vertical().apply {
                addView(ui.text("Touch control", 16f, bold = true))
                touchDetail = ui.text("", 14f, R.color.muted, topDp = 2)
                addView(touchDetail)
            }, ui.weighted())
            touchButton = ui.button("Turn on", Ui.Style.SECONDARY, heightDp = 44) { setUpTouchControl() }
            addView(touchButton, LinearLayout.LayoutParams(WRAP_CONTENT, ui.dp(44)).apply { marginStart = ui.dp(12) })
        }, ui.matchWidth(topDp = 18))

        addView(ui.divider(), ui.matchWidth(topDp = 18, heightDp = 1))

        motionSwitch = Switch(this@MainActivity).apply {
            text = "Pause while driving"
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
            text = "Dim this phone while mirroring"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(ui.color(R.color.on_surface))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            isChecked = dimPhone()
            setOnClickListener { onDimSwitch(isChecked) }
        }
        addView(dimSwitch, ui.matchWidth(topDp = 14))
        dimDetail = ui.text("", 14f, R.color.muted, topDp = 2)
        addView(dimDetail)
    }

    private fun tipsCard(): View = ui.card().apply {
        val tips = listOf(
            "Full screen in the car: tap the Tesla browser's full-screen button, the two arrows " +
                "at the left of its address bar. Videos fill the screen on their own.",
            "Smoothest picture: set your phone's hotspot to 5 GHz (in hotspot settings, Band). " +
                "It carries about twice as much as 2.4 GHz.",
            "Sound plays through your car over Bluetooth, as usual.",
            "Quicker start: add the Car Mirror tile to Quick Settings, or long-press the app icon.",
            "Keep your phone plugged in. Mirroring uses battery.",
            "Don't watch video while driving. Treat it like a phone on a dash mount.",
        )
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
        private val LOCATION_PERMISSIONS =
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        private const val SETTINGS = "settings"
        private const val KEY_QUALITY = "quality"
        private const val KEY_PAUSE_WHILE_MOVING = "pauseWhileMoving"
        private const val KEY_DIM = "dimPhone"

        private val TROUBLE_TIPS = listOf(
            "Check the car is on your phone's hotspot, not your home Wi-Fi: tap the Wi-Fi icon at " +
                "the top of the car's screen.",
            "Choppy picture? Set your hotspot to 5 GHz (hotspot settings, Band), then reconnect the car.",
            "Type the address exactly, including \":8080\".",
            "Still nothing? Type http:// in front of it.",
            "Turn off any other VPN app on your phone, then Stop and Start again.",
        )

        private val QUALITY_HELP = mapOf(
            Quality.SMOOTH to "Smoothest motion, slightly softer. Good for video while parked.",
            Quality.BALANCED to "Good for most things. Recommended.",
            Quality.SHARP to "Crispest maps and small text, a little less smooth.",
        )

        private const val TOUCH_EXPLANATION =
            "Touch control lets taps and swipes on your car's screen control this phone while " +
                "Car Mirror is mirroring.\n\n" +
                "To do that, Car Mirror needs Android's Accessibility permission. It uses it only " +
                "to perform those taps. It can't read what's on your screen or what you type, and " +
                "nothing is collected or sent anywhere.\n\n" +
                "In Settings, open Car Mirror touch control (it may be under Installed apps or " +
                "Downloaded apps) and turn it on. You can turn it off there any time."

        private const val VPN_EXPLANATION =
            "Your Tesla's browser won't open the kind of address a phone hotspot uses. " +
                "Car Mirror gives your phone one extra address that the car will open, and " +
                "Android only allows that through its VPN feature.\n\n" +
                "This VPN carries no traffic. Your apps use the internet exactly as before, " +
                "nothing is sent through it, and nothing leaves your phone except the picture " +
                "going to your car over the hotspot.\n\n" +
                "Next, Android will ask you to allow the connection."

        private const val LOCATION_EXPLANATION =
            "Car Mirror blanks your car's screen while the car is moving, and brings the picture " +
                "back a few seconds after you stop. Maps are paused too.\n\n" +
                "To know when you're moving, it reads your phone's GPS speed while mirroring. " +
                "Location stays on your phone: it is never stored or sent anywhere.\n\n" +
                "Next, Android will ask for location. Choose Precise and While using the app. " +
                "You can switch this off any time under Settings."
    }
}
