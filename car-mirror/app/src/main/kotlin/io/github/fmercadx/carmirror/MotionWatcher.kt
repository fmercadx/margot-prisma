package io.github.fmercadx.carmirror

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import io.github.fmercadx.carmirror.core.MotionGate

/**
 * Tells [onChange] when the car starts and stops moving, from GPS speed. Only used when the
 * user turns on "Pause the picture while the car is moving". Readings stay on the phone:
 * nothing is stored or sent anywhere.
 */
class MotionWatcher(private val context: Context, private val onChange: (moving: Boolean) -> Unit) {
    private val locations = context.service<LocationManager>()
    private val handler = Handler(Looper.getMainLooper())
    private val gate = MotionGate()
    private var moving = false

    // Every method spelled out: on Android 10 the last three are abstract, not defaults.
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val speed = if (location.hasSpeed()) location.speed else null
            publish(gate.onSpeed(speed, SystemClock.elapsedRealtime()))
        }

        override fun onProviderEnabled(provider: String) {}

        override fun onProviderDisabled(provider: String) {}

        @Suppress("OVERRIDE_DEPRECATION") // deprecated, but abstract on Android 10, so it must exist
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    private val tick = object : Runnable {
        override fun run() {
            publish(gate.onTick(SystemClock.elapsedRealtime()))
            handler.postDelayed(this, TICK_MS)
        }
    }

    /** Starts listening. Returns false when location permission is missing or there is no GPS. */
    @SuppressLint("MissingPermission") // checked on the first line
    fun start(): Boolean {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false
        if (LocationManager.GPS_PROVIDER !in locations.allProviders) return false
        locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000L, 0f, listener, Looper.getMainLooper())
        handler.postDelayed(tick, TICK_MS)
        return true
    }

    fun stop() {
        locations.removeUpdates(listener)
        handler.removeCallbacks(tick)
    }

    private fun publish(now: Boolean) {
        if (now != moving) {
            moving = now
            onChange(now)
        }
    }

    private companion object {
        const val TICK_MS = 5_000L
    }
}
