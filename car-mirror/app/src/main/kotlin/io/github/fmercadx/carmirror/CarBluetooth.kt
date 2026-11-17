package io.github.fmercadx.carmirror

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * One-tap start when the phone connects to the car's Bluetooth.
 *
 * The user picks their car from the phone's paired Bluetooth devices once. When the phone
 * connects to it, a notification offers Start. Android still asks to share the screen each
 * time, so this saves finding the app and tapping through, not that prompt. Only the chosen
 * device's address and name are kept, on the phone.
 */
object CarBluetooth {
    class Device(val address: String, val name: String)

    /** Android 12+ needs "Nearby devices" to list paired devices and see connections. */
    fun permitted(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    /** The phone's paired Bluetooth devices, by name; empty without permission or Bluetooth. */
    fun pairedDevices(context: Context): List<Device> {
        if (!permitted(context)) return emptyList()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return try {
            adapter.bondedDevices.orEmpty()
                .map { Device(it.address, it.name?.takeIf(String::isNotBlank) ?: it.address) }
                .sortedBy { it.name.lowercase() }
        } catch (_: SecurityException) {
            emptyList()
        }
    }

    fun chosen(context: Context): Device? {
        val prefs = prefs(context)
        val address = prefs.getString(KEY_ADDRESS, null) ?: return null
        return Device(address, prefs.getString(KEY_NAME, null) ?: address)
    }

    fun choose(context: Context, device: Device?) {
        val editor = prefs(context).edit()
        if (device == null) editor.remove(KEY_ADDRESS).remove(KEY_NAME)
        else editor.putString(KEY_ADDRESS, device.address).putString(KEY_NAME, device.name)
        editor.apply()
    }

    /** The "you're in your car" notification; tapping it goes straight into starting. */
    fun offerStart(context: Context, car: Device) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.channel_car), NotificationManager.IMPORTANCE_HIGH)
        channel.description = context.getString(R.string.channel_car_desc)
        manager.createNotificationChannel(channel)
        val start = PendingIntent.getActivity(
            context, 20,
            Intent(context, MainActivity::class.java)
                .setAction(MainActivity.ACTION_QUICK_START)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.car_notif_title, car.name))
            .setContentText(context.getString(R.string.car_notif_text))
            .setContentIntent(start)
            .setAutoCancel(true)
            .setTimeoutAfter(OFFER_MS)
            .setCategory(Notification.CATEGORY_RECOMMENDATION)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private const val PREFS = "car_bluetooth"
    private const val KEY_ADDRESS = "address"
    private const val KEY_NAME = "name"
    private const val CHANNEL_ID = "car"
    const val NOTIFICATION_ID = 3
    private const val OFFER_MS = 5 * 60_000L
}

/** Hears the phone connect to a Bluetooth device, and offers to start if it's the chosen car. */
class CarBluetoothReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != BluetoothDevice.ACTION_ACL_CONNECTED) return
        val car = CarBluetooth.chosen(context) ?: return
        val device = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
        if (device?.address != car.address || MirrorState.running) return
        CarBluetooth.offerStart(context, car)
    }
}
