package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Activity
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
        // Mirroring works without the notification; it is only the easy way to stop.
        if (requestCode == REQUEST_NOTIFICATIONS) askForVpn()
    }

    private fun askForVpn() {
        val consent = VpnService.prepare(this)
        if (consent == null) {
            askForScreen(tunnel = true)
        } else {
            try {
                startActivityForResult(consent, REQUEST_VPN)
            } catch (e: ActivityNotFoundException) {
                askForScreen(tunnel = false)
            }
        }
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
                            .putExtra(MirrorService.EXTRA_TUNNEL, tunnelAllowed),
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

        statusView.text = when {
            running && MirrorState.tunnelUp -> "● Mirroring"
            running -> "● Mirroring (test mode)"
            else -> "Not mirroring"
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
        qualityGroup.check(QUALITY_ID_BASE + Quality.BALANCED.ordinal)
        column += qualityGroup

        column += text("Setting up", 18f, bold = true, top = 28)
        column += text(
            "1. Turn on your phone's hotspot.\n" +
                "2. In the car: Wi-Fi → join your phone's hotspot.\n" +
                "3. Tap Start mirroring, then allow the VPN and screen sharing.\n" +
                "4. In the car's browser, type the address above.\n\n" +
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

    private companion object {
        const val REQUEST_NOTIFICATIONS = 1
        const val REQUEST_VPN = 2
        const val REQUEST_SCREEN = 3
        const val QUALITY_ID_BASE = 1000
    }
}
