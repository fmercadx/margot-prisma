package io.github.fmercadx.carmirror

import android.Manifest
import android.app.NotificationManager
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Intent
import io.github.fmercadx.carmirror.core.CarUrls
import io.github.fmercadx.carmirror.core.FrameHub
import io.github.fmercadx.carmirror.core.MirrorServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** "Start from your car's Bluetooth": the prompt appears only for the chosen car, only when idle. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CarBluetoothTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val car = CarBluetooth.Device("00:11:22:33:44:55", "Model Y")

    @Before
    fun setUp() {
        shadowOf(app).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.POST_NOTIFICATIONS)
    }

    @After
    fun tearDown() {
        MirrorState.stopped(null)
        CarBluetooth.choose(app, null)
    }

    private fun connect(address: String) {
        val device: BluetoothDevice = app.getSystemService(BluetoothManager::class.java).adapter.getRemoteDevice(address)
        CarBluetoothReceiver().onReceive(app, Intent(BluetoothDevice.ACTION_ACL_CONNECTED).putExtra(BluetoothDevice.EXTRA_DEVICE, device))
    }

    private fun notifications() = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications

    @Test
    fun offersToStartWhenTheChosenCarConnects() {
        CarBluetooth.choose(app, car)
        connect(car.address)
        val offer = notifications().single()
        assertTrue(offer.extras.getString("android.title")!!.contains("Model Y"))
        assertEquals(MainActivity.ACTION_QUICK_START, shadowOf(offer.contentIntent).savedIntent.action)
    }

    @Test
    fun ignoresOtherBluetoothDevices() {
        CarBluetooth.choose(app, car)
        connect("66:77:88:99:AA:BB")
        assertTrue(notifications().isEmpty())
    }

    @Test
    fun staysQuietWithNoCarChosen() {
        connect(car.address)
        assertTrue(notifications().isEmpty())
    }

    @Test
    fun staysQuietWhileAlreadyMirroring() {
        CarBluetooth.choose(app, car)
        MirrorState.started(tunnelUp = true, port = CarUrls.DEFAULT_PORT, server = MirrorServer(FrameHub()), problem = null)
        connect(car.address)
        assertTrue(notifications().isEmpty())
    }

    @Test
    fun remembersTheChoiceAndForgetsIt() {
        CarBluetooth.choose(app, car)
        assertEquals("Model Y", CarBluetooth.chosen(app)!!.name)
        CarBluetooth.choose(app, null)
        assertEquals(null, CarBluetooth.chosen(app))
    }
}
