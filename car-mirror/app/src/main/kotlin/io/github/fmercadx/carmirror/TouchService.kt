package io.github.fmercadx.carmirror

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import io.github.fmercadx.carmirror.core.Gesture

/**
 * Touch control: performs taps and swipes from the car's screen on the phone.
 *
 * Android only lets an app inject touches through an Accessibility service, which the user
 * turns on in Settings. This one is configured (res/xml/touch_service.xml) to perform
 * gestures and nothing else: it cannot read window content and asks for no events, so it
 * sees neither what is on screen nor what is typed.
 */
class TouchService : AccessibilityService() {

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    /** Performs [gesture], whose points are fractions of the screen. Safe to call from any thread. */
    fun perform(gesture: Gesture) {
        mainHandler.post {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION") // the full, rotated screen size; what the car's picture shows
            service<DisplayManager>().getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(metrics)
            val maxX = (metrics.widthPixels - 1).toFloat()
            val maxY = (metrics.heightPixels - 1).toFloat()
            val path = Path()
            gesture.points.forEachIndexed { i, p ->
                if (i == 0) path.moveTo(p.x * maxX, p.y * maxY) else path.lineTo(p.x * maxX, p.y * maxY)
            }
            // A path with one point is a tap, or a long press when the duration is long.
            val duration = gesture.durationMs.coerceIn(1L, GestureDescription.getMaxGestureDuration())
            try {
                dispatchGesture(
                    GestureDescription.Builder()
                        .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
                        .build(),
                    null, null,
                )
            } catch (_: IllegalArgumentException) {
                // A gesture Android won't accept; dropping one touch is better than crashing.
            }
        }
    }

    companion object {
        /** The running service, or null while touch control is turned off in Settings. */
        @Volatile var instance: TouchService? = null
            private set
    }
}
