package io.github.fmercadx.carmirror

import android.content.Context
import android.net.ConnectivityManager
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * The phone's own addresses on networks it serves (its hotspot, or USB tethering), which is
 * where the car's packets arrive.
 *
 * Android has no public API for the hotspot's address, so this takes every address the
 * phone has and removes those belonging to networks it is a client of (Wi-Fi, cellular), as
 * ConnectivityManager reports them. Interface names vary by phone (ap0, swlan0, wlan1...),
 * so they are only a fallback.
 */
internal object Hotspot {
    private val NAME_PREFIXES = listOf("ap", "swlan", "softap")

    /** Set by tests to stand in for the phone's real interfaces. */
    @Volatile internal var override: List<String>? = null

    /** IPv4 addresses the car can reach the phone on. Empty when the hotspot is off. */
    fun ipv4(context: Context): List<String> = override ?: try {
        val clients = clientInterfaces(context)
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { iface ->
                iface.isUp && !iface.isLoopback && iface.name !in IGNORED &&
                    IGNORED_PREFIXES.none { iface.name.startsWith(it) } &&
                    if (clients != null) iface.name !in clients else NAME_PREFIXES.any { iface.name.startsWith(it) }
            }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { !it.isLoopbackAddress && !it.isLinkLocalAddress }
            .mapNotNull { it.hostAddress }
            .filter { !it.startsWith("192.0.0.") } // the 464XLAT translator's address, not a real network
            .distinct()
    } catch (_: Exception) {
        emptyList()
    }

    fun looksOn(context: Context): Boolean = ipv4(context).isNotEmpty()

    /** Interfaces of networks the phone is a client of, or null if Android won't say. */
    @Suppress("DEPRECATION") // allNetworks: the one synchronous way to list them
    private fun clientInterfaces(context: Context): Set<String>? = try {
        val connectivity = context.service<ConnectivityManager>()
        connectivity.allNetworks.mapNotNull { connectivity.getLinkProperties(it)?.interfaceName }.toSet()
    } catch (_: Exception) {
        null
    }

    private val IGNORED = setOf("dummy0", "lo")
    /** VPN tunnels (including our own), the 464XLAT translator, and kernel helpers. */
    private val IGNORED_PREFIXES = listOf("tun", "v4-", "ifb", "ip6tnl", "sit")
}
