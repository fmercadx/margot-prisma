package io.github.fmercadx.carmirror.core

/**
 * Addresses to type into the car's browser.
 *
 * The Tesla browser refuses private addresses such as 192.168.x.x, which is exactly what a
 * phone hotspot hands out. So the phone also answers on [VIRTUAL_IP], an address outside the
 * private ranges that exists only on the phone, and the car reaches it because the phone is
 * the car's gateway while the car is on the hotspot.
 *
 * Wildcard DNS services turn the address into a hostname (100-73-0-1.sslip.io resolves to
 * 100.73.0.1), for browsers that refuse bare IP addresses. Lookups need internet, which the
 * hotspot provides.
 */
object CarUrls {
    /** Not in any private range, so the car's browser does not block it. */
    const val VIRTUAL_IP = "100.73.0.1"

    const val DEFAULT_PORT = 8080

    /** Most likely to work first; later entries are fallbacks to try in order. */
    fun forVirtualIp(port: Int, ip: String = VIRTUAL_IP): List<String> {
        val dashed = ip.replace('.', '-')
        return listOf(
            "http://$dashed.sslip.io:$port/",
            "http://$dashed.nip.io:$port/",
            "http://$ip:$port/",
        )
    }

    /** For checking from a laptop or tablet on the same hotspot; the car will refuse these. */
    fun forLocalAddresses(port: Int, ips: List<String>): List<String> = ips.map { "http://$it:$port/" }

    /**
     * True when a request's Host header names one of [ips] directly or through the wildcard
     * DNS names above. Anything else is refused, so a web page that points its own domain at
     * the phone (DNS rebinding) cannot read the screen.
     */
    fun isOurHost(hostHeader: String, ips: Collection<String>): Boolean {
        val host = hostHeader.trim().lowercase().let { h ->
            if (h.startsWith("[")) h else h.substringBeforeLast(':')
        }
        if (host.isEmpty()) return false
        return ips.any { ip ->
            val dashed = ip.replace('.', '-')
            host == ip || host == "$dashed.sslip.io" || host == "$dashed.nip.io"
        }
    }
}
