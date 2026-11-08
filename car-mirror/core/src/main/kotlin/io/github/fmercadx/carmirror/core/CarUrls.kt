package io.github.fmercadx.carmirror.core

/**
 * Addresses to type into the car's browser, and the rules for which ones the phone answers.
 *
 * The car reaches the phone over the phone's hotspot. Two kinds of address can work, and
 * which ones the Tesla browser accepts is not documented, so the app offers both:
 *
 *  - The hotspot's own address (192.168.x.1 or similar). Simple, but it is a private
 *    address, and the Tesla browser has been reported to refuse those.
 *  - [VIRTUAL_IP], which the app adds to the phone through a VPN. It is link-local, not
 *    private, and it must be link-local: since Android 13 the system drops packets that
 *    arrive from outside a VPN addressed to the VPN's own address, *except* for link-local
 *    addresses (ConnectivityService.generateIngressDiscardRules). 100.73.0.1, used before,
 *    was dropped that way.
 *
 * Each is offered as a hostname too (169-254-73-1.sslip.io resolves to 169.254.73.1), for
 * a browser that refuses bare IP addresses. Lookups need internet, which the hotspot provides.
 */
object CarUrls {
    /** Link-local, so Android delivers the car's packets to it (see above). */
    const val VIRTUAL_IP = "169.254.73.1"

    const val DEFAULT_PORT = 8080

    /**
     * Every address the car could use, most likely to work first: hostnames before bare IPs,
     * and the VPN address (not private) before the hotspot's (private).
     */
    fun toTry(port: Int, virtualIp: String?, hotspotIps: List<String>): List<String> {
        val ips = listOfNotNull(virtualIp) + hotspotIps
        return ips.map { "http://${it.replace('.', '-')}.sslip.io:$port/" } +
            ips.map { "http://$it:$port/" }
    }

    /** "http://169-254-73-1.sslip.io:8080/" as the user types it: "169-254-73-1.sslip.io:8080". */
    fun typed(url: String): String = url.removePrefix("http://").removeSuffix("/")

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

    /** Whether [ip] is in 169.254.0.0/16. */
    fun isLinkLocal(ip: String): Boolean = ip.startsWith("169.254.")
}
