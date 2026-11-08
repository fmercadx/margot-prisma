package io.github.fmercadx.carmirror.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QualityAndUrlsTest {
    @Test
    fun `scales a phone screen so the long edge fits`() {
        assertEquals(576 to 1280, Quality.BALANCED.captureSize(1080, 2400))
        assertEquals(1280 to 576, Quality.BALANCED.captureSize(2400, 1080))
    }

    @Test
    fun `never scales up`() {
        assertEquals(800 to 600, Quality.SHARP.captureSize(800, 600))
    }

    @Test
    fun `sizes are even and at least 2`() {
        val (w, h) = Quality.SMOOTH.captureSize(1081, 2401)
        assertEquals(0, w % 2)
        assertEquals(0, h % 2)
        assertEquals(2 to 960, Quality.SMOOTH.captureSize(1, 5000))
    }

    @Test
    fun `offers hostnames first, the VPN address before the hotspot, and bare IPs last`() {
        val urls = CarUrls.toTry(8080, CarUrls.VIRTUAL_IP, listOf("192.168.43.1"))
        assertEquals(
            listOf(
                "http://169-254-73-1.sslip.io:8080/",
                "http://192-168-43-1.sslip.io:8080/",
                "http://169.254.73.1:8080/",
                "http://192.168.43.1:8080/",
            ),
            urls,
        )
        assertEquals("169-254-73-1.sslip.io:8080", CarUrls.typed(urls.first()))
    }

    @Test
    fun `without the VPN, only the hotspot addresses are offered`() {
        assertEquals(
            listOf("http://10-1-2-1.sslip.io:8080/", "http://10.1.2.1:8080/"),
            CarUrls.toTry(8080, virtualIp = null, hotspotIps = listOf("10.1.2.1")),
        )
    }

    @Test
    fun `the VPN address is link-local, which Android 13+ still delivers, and not private`() {
        // Android drops packets from outside a VPN addressed to the VPN's own address unless
        // the address is link-local (ConnectivityService.generateIngressDiscardRules).
        assertTrue(CarUrls.isLinkLocal(CarUrls.VIRTUAL_IP))
        val octets = CarUrls.VIRTUAL_IP.split('.').map { it.toInt() }
        val rfc1918 = octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
        assertFalse(rfc1918, "${CarUrls.VIRTUAL_IP} is in a private (RFC 1918) range")
    }

    @Test
    fun `accepts only hosts that name the phone`() {
        val ips = listOf(CarUrls.VIRTUAL_IP, "192.168.43.1")
        for (host in listOf(
            "169-254-73-1.sslip.io:8080", "169-254-73-1.SSLIP.io", "169-254-73-1.nip.io:8081",
            "169.254.73.1:8080", "169.254.73.1", "192.168.43.1:8080", "192-168-43-1.sslip.io:8080",
        )) assertTrue(CarUrls.isOurHost(host, ips), host)

        for (host in listOf(
            "", "evil.example:8080", "169-254-73-1.sslip.io.evil.example", "x169-254-73-1.sslip.io",
            "[::1]:8080", "10.0.0.1:8080", "100-73-0-1.sslip.io:8080",
        )) assertFalse(CarUrls.isOurHost(host, ips), host)
    }
}
