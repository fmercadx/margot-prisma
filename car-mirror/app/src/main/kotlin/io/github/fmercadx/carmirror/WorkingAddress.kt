package io.github.fmercadx.carmirror

import android.content.Context
import io.github.fmercadx.carmirror.core.CarUrls

/**
 * Which kind of address the car's browser accepted last time, so the app can show only that
 * one from then on. Which kinds a car accepts isn't documented, and differs by car software.
 */
internal object WorkingAddress {
    private const val PREFS = "settings"
    private const val KEY = "workingAddress"

    fun remember(context: Context, kind: CarUrls.Kind) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY, null) != kind.name) prefs.edit().putString(KEY, kind.name).apply()
    }

    fun known(context: Context): CarUrls.Kind? {
        val name = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        return CarUrls.Kind.entries.firstOrNull { it.name == name }
    }

    fun forget(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
    }
}
