package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import io.github.fmercadx.carmirror.core.Quality

/**
 * One screen: a Start button, the address to type in the car, and what is happening.
 * Built in code with platform widgets only, so the app has no dependencies.
 */
class MainActivity : Activity() {

    private lateinit var statusView: TextView
    private lateinit var problemView: TextView
    private lateinit var toggleButton: Button
    private lateinit var urlView: TextView
    private lateinit var alternativesView: TextView
    private lateinit var carView: TextView
    private lateinit var qualityGroup: RadioGroup
    private lateinit var pauseButton: Button
    private lateinit var touchView: TextView
    private lateinit var touchButton: Button
    private lateinit var motionSwitch: Switch
    private lateinit var motionNote: TextView

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
        setContentView(buildLayout())
        if (savedInstanceState == null) handleQuickStart(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleQuickStart(intent)
    }

    /** From the Quick Settings tile or the home-screen shortcut: go straight into starting. */
    private fun handleQuickStart(intent: Intent?) {
        if (intent?.action != ACTION_QUICK_START) return
        intent.action = null // only once, not again on the next resume
        if (!MirrorState.running) onToggle()
    }

    override fun onStart() {
        super.onStart()
        handler.post(refresh)
    }

    override fun onStop() {
        handler.removeCallbacks(refresh)
        super.onStop()
    }

    // ---- Start sequence: notifications -> VPN -> screen capture -> service ----

    private fun onToggle() {
        if (MirrorState.running) {
            startService(Intent(this, MirrorService::class.java).setAction(MirrorService.ACTION_STOP))
            return
        }
        MirrorState.problem = null
        askForNotificationsThenContinue()
    }

    private fun askForNotificationsThenContinue() {
        if (Build.VERSION.SDK_INT >= 33 && !askedForNotifications &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            askedForNotifications = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
            return
        }
        askForVpn()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            // Mirroring works without the notification; it is only the easy way to stop.
            REQUEST_NOTIFICATIONS -> askForVpn()
            REQUEST_LOCATION -> {
                val granted = hasLocationPermission()
                settings().edit().putBoolean(KEY_PAUSE_WHILE_MOVING, granted).apply()
                motionSwitch.isChecked = granted
                render()
            }
        }
    }

    private fun settings() = getSharedPreferences(SETTINGS, MODE_PRIVATE)

    private fun hasLocationPermission() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** On only if the user opted in and location permission is still granted. */
    private fun pauseWhileMoving() = settings().getBoolean(KEY_PAUSE_WHILE_MOVING, false) && hasLocationPermission()

    private fun onMotionSwitch(checked: Boolean) {
        if (checked && !hasLocationPermission()) {
            requestPermissions(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                REQUEST_LOCATION,
            )
            return // saved once the user answers
        }
        settings().edit().putBoolean(KEY_PAUSE_WHILE_MOVING, checked).apply()
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
            openAccessibilitySettings() // already on; this button turns it off
            return
        }
        val restrictedNote = if (Build.VERSION.SDK_INT >= 33) {
            "\n\nIf Android says it's a restricted setting: open Settings → Apps → Car Mirror, " +
                "tap ⋮ (top right) → Allow restricted settings, then try again."
        } else {
            ""
        }
        AlertDialog.Builder(this)
            .setTitle("Turn on touch control")
            .setMessage(TOUCH_EXPLANATION + restrictedNote)
            .setPositiveButton("Open settings") { _, _ -> openAccessibilitySettings() }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun openAccessibilitySettings() {
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
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
                MirrorState.problem = "Mirroring needs the VPN step so the car can reach your phone."
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
                            .putExtra(MirrorService.EXTRA_QUALITY, selectedQuality().name)
                            .putExtra(MirrorService.EXTRA_TUNNEL, tunnelAllowed)
                            .putExtra(MirrorService.EXTRA_PAUSE_WHILE_MOVING, pauseWhileMoving()),
                    )
                } else {
                    MirrorState.problem = "Screen sharing was cancelled."
                    render()
                }
        }
    }

    private fun selectedQuality(): Quality =
        Quality.entries.firstOrNull { it.ordinal == qualityGroup.checkedRadioButtonId - QUALITY_ID_BASE }
            ?: Quality.BALANCED

    private fun openHotspotSettings() {
        val candidates = listOf(
            Intent().setClassName("com.android.settings", "com.android.settings.TetherSettings"),
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (intent in candidates) {
            try {
                startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
            } catch (_: SecurityException) {
            }
        }
    }

    // ---- Rendering ----

    private fun render() {
        val running = MirrorState.running
        toggleButton.text = if (running) "Stop mirroring" else "Start mirroring"
        for (i in 0 until qualityGroup.childCount) qualityGroup.getChildAt(i).isEnabled = !running

        val paused = MirrorState.paused
        statusView.text = when {
            running && paused == "privacy" -> "❚❚ Paused: the car's screen is blank"
            running && paused == "driving" -> "❚❚ Paused while the car is moving"
            running && MirrorState.tunnelUp -> "● Mirroring"
            running -> "● Mirroring (test mode)"
            else -> "Not mirroring"
        }
        pauseButton.visibility = if (running) View.VISIBLE else View.GONE
        pauseButton.text = if (paused == "privacy") "Resume" else "Pause (blank the car's screen)"

        val touchOn = TouchService.instance != null
        touchView.text = if (touchOn) {
            "✓ On. Tap and swipe on the car's screen to control this phone."
        } else {
            "Off. The car's screen only shows your phone."
        }
        touchButton.text = if (touchOn) "Turn off in settings" else "Turn on touch control"

        val wantsMotion = settings().getBoolean(KEY_PAUSE_WHILE_MOVING, false)
        if (motionSwitch.isChecked != pauseWhileMoving()) motionSwitch.isChecked = pauseWhileMoving()
        motionNote.text = when {
            running && wantsMotion != MirrorState.watchingMotion -> "Takes effect the next time you start mirroring."
            wantsMotion && !hasLocationPermission() -> "Needs location permission."
            else -> "Uses GPS speed. This also pauses maps while you drive. Location stays on your phone."
        }

        val problem = MirrorState.problem
        problemView.visibility = if (problem == null) View.GONE else View.VISIBLE
        problemView.text = problem.orEmpty()

        val urls = MirrorState.urls
        urlView.text = urls.firstOrNull() ?: "Tap Start to get the address"
        alternativesView.visibility = if (urls.size > 1) View.VISIBLE else View.GONE
        alternativesView.text = "If that page doesn't load, try:\n" + urls.drop(1).joinToString("\n")

        val viewer = MirrorState.server?.recentViewers()?.firstOrNull()
        carView.text = when {
            !running -> ""
            viewer != null -> "✓ Car connected — it opened ${viewer.host.ifEmpty { viewer.remoteAddress }}"
            else -> "Waiting for the car's browser…"
        }
    }

    private fun buildLayout(): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(16), dp(24), dp(32))
        }

        column += text("Car Mirror", 28f, bold = true)
        column += text("Shows your phone's screen in your Tesla's web browser.", 16f, top = 4)

        statusView = text("", 18f, bold = true, top = 24)
        column += statusView
        problemView = text("", 15f, top = 8).apply { setTextColor(0xFFD97706.toInt()) }
        column += problemView

        toggleButton = Button(this).apply {
            textSize = 18f
            setOnClickListener { onToggle() }
        }
        column.addView(toggleButton, LinearLayout.LayoutParams(MATCH_PARENT, dp(64)).apply { topMargin = dp(16) })
        pauseButton = Button(this).apply {
            textSize = 16f
            setOnClickListener { onPauseToggle() }
        }
        column.addView(pauseButton, LinearLayout.LayoutParams(MATCH_PARENT, dp(52)).apply { topMargin = dp(8) })

        column += text("In the car, open the browser and go to:", 15f, top = 24)
        urlView = text("", 22f, bold = true, top = 6).apply {
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        column += urlView
        alternativesView = text("", 14f, top = 8).apply {
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        column += alternativesView
        carView = text("", 16f, top = 12)
        column += carView

        column += text("Picture", 18f, bold = true, top = 28)
        qualityGroup = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        for (q in Quality.entries) {
            qualityGroup.addView(RadioButton(this).apply {
                id = QUALITY_ID_BASE + q.ordinal
                text = "${q.label} — up to ${q.maxEdge}px, ${q.fps} fps"
                textSize = 16f
            })
        }
        val settings = settings()
        val saved = Quality.entries.firstOrNull { it.name == settings.getString(KEY_QUALITY, null) } ?: Quality.BALANCED
        qualityGroup.check(QUALITY_ID_BASE + saved.ordinal)
        qualityGroup.setOnCheckedChangeListener { _, _ ->
            settings.edit().putString(KEY_QUALITY, selectedQuality().name).apply()
        }
        column += qualityGroup
        column += text("The picture gets a little softer on its own when the Wi-Fi can't keep up.", 14f, top = 4)

        column += text("Touch control", 18f, bold = true, top = 28)
        touchView = text("", 15f, top = 4)
        column += touchView
        touchButton = Button(this).apply { setOnClickListener { setUpTouchControl() } }
        column.addView(touchButton, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(8) })

        column += text("While driving", 18f, bold = true, top = 28)
        motionSwitch = Switch(this).apply {
            text = "Pause the picture while the car is moving"
            textSize = 16f
            isChecked = pauseWhileMoving()
            setOnClickListener { onMotionSwitch(isChecked) }
        }
        column += motionSwitch
        motionNote = text("", 14f, top = 4)
        column += motionNote

        column += text("Setting up", 18f, bold = true, top = 28)
        column += text(
            "1. Turn on your phone's hotspot.\n" +
                "2. In the car: Wi-Fi → join your phone's hotspot.\n" +
                "3. Tap Start mirroring, then allow the VPN and screen sharing.\n" +
                "4. In the car's browser, type the address above.\n\n" +
                "Quicker next time: add the Car Mirror tile to Quick Settings, or long-press the app " +
                "icon and choose Start mirroring.\n\n" +
                "The VPN only gives your phone an address the car will open. It carries no traffic.\n\n" +
                "Sound: pair the phone with the car over Bluetooth as usual.\n\n" +
                "Don't watch video while driving. Treat this like a phone on a dash mount.",
            15f, top = 8,
        )
        val hotspotButton = Button(this).apply {
            text = "Open hotspot settings"
            setOnClickListener { openHotspotSettings() }
        }
        column.addView(hotspotButton, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(12) })

        val scroll = ScrollView(this).apply {
            addView(column, MATCH_PARENT, WRAP_CONTENT)
            // Android 15 draws apps edge to edge; keep content clear of the status and nav bars.
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
        return scroll
    }

    private fun text(value: String, sizeSp: Float, bold: Boolean = false, top: Int = 0) = TextView(this).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.START
        setPadding(0, dp(top), 0, 0)
    }

    private operator fun LinearLayout.plusAssign(view: View) {
        addView(view, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    companion object {
        /** Sent by the Quick Settings tile and the home-screen shortcut. */
        const val ACTION_QUICK_START = "io.github.fmercadx.carmirror.QUICK_START"

        private const val REQUEST_NOTIFICATIONS = 1
        private const val REQUEST_VPN = 2
        private const val REQUEST_SCREEN = 3
        private const val REQUEST_LOCATION = 4
        private const val QUALITY_ID_BASE = 1000
        private const val SETTINGS = "settings"
        private const val KEY_QUALITY = "quality"
        private const val KEY_PAUSE_WHILE_MOVING = "pauseWhileMoving"

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
    }
}
