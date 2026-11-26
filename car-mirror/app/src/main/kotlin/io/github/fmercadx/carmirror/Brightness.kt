package io.github.fmercadx.carmirror

import android.content.Context
import android.provider.Settings

/**
 * Turns the phone's own screen right down while mirroring, so it isn't glowing next to the
 * car's screen. Covering the screen would black out the car's picture too, since the car
 * shows exactly what is on the phone; brightness doesn't change the picture sent to the car.
 *
 * Needs "Modify system settings" (Settings.System.canWrite). The user's own brightness and
 * auto-brightness are saved before dimming and put back afterwards, including on the next
 * launch if the app died while mirroring.
 */
internal object Brightness {
    private const val PREFS = "brightness"
    private const val KEY_LEVEL = "level"
    private const val KEY_MODE = "mode"

    /** The lowest level Android accepts without turning the screen off on some phones. */
    private const val DIMMEST = 1

    fun allowed(context: Context): Boolean = Settings.System.canWrite(context)

    /** Dims the screen. Returns false if the permission is missing. */
    fun dim(context: Context): Boolean {
        if (!allowed(context)) return false
        val resolver = context.contentResolver
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return try {
            // Keep the first saved value: a second dim must not save the dimmed level as "normal".
            if (!saved.contains(KEY_LEVEL)) {
                saved.edit()
                    .putInt(KEY_LEVEL, Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, 128))
                    .putInt(KEY_MODE, Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE,
                        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL))
                    .commit() // on disk before changing anything, so a crash can't lose it
            }
            Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, DIMMEST)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    /** Puts back what [dim] saved, if anything. Safe to call any number of times. */
    fun restore(context: Context) {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!saved.contains(KEY_LEVEL)) return
        if (allowed(context)) {
            try {
                val resolver = context.contentResolver
                Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, saved.getInt(KEY_LEVEL, 128))
                Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE,
                    saved.getInt(KEY_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL))
            } catch (_: SecurityException) {
            }
        }
        saved.edit().clear().commit()
    }
}
