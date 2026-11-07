package io.github.fmercadx.carmirror

import java.net.Inet4Address
import java.net.NetworkInterface

/** A best guess at whether the phone's hotspot is on, for ticking the setup checklist. */
internal object Hotspot {
    /**
     * Names phones give their hotspot interface. wlan1 is left out on purpose: on some phones
     * it is a second Wi-Fi connection, and a wrong tick is worse than a missing one.
     */
    private val PREFIXES = listOf("ap", "swlan", "softap")

    fun looksOn(): Boolean = try {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().any { iface ->
            iface.isUp && PREFIXES.any { iface.name.startsWith(it) } &&
                iface.inetAddresses.toList().any { it is Inet4Address }
        }
    } catch (_: Exception) {
        false
    }
}
