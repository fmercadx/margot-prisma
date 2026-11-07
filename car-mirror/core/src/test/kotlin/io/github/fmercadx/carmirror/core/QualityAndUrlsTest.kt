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
    fun `the first address uses a hostname, not a bare IP`() {
        val urls = CarUrls.forVirtualIp(8080)
        assertEquals("http://100-73-0-1.sslip.io:8080/", urls.first())
        assertTrue("http://100.73.0.1:8080/" in urls)
    }

    @Test
    fun `the virtual address is outside the ranges the car's browser blocks`() {
        val octets = CarUrls.VIRTUAL_IP.split('.').map { it.toInt() }
        val private = octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168) ||
            octets[0] == 127 || (octets[0] == 169 && octets[1] == 254)
        assertFalse(private, "${CarUrls.VIRTUAL_IP} is a private address")
    }

    @Test
    fun `accepts only hosts that name the phone`() {
        val ips = listOf(CarUrls.VIRTUAL_IP, "192.168.43.1")
        for (host in listOf(
            "100-73-0-1.sslip.io:8080", "100-73-0-1.SSLIP.io", "100-73-0-1.nip.io:8081",
            "100.73.0.1:8080", "100.73.0.1", "192.168.43.1:8080",
        )) assertTrue(CarUrls.isOurHost(host, ips), host)

        for (host in listOf(
            "", "evil.example:8080", "100-73-0-1.sslip.io.evil.example", "x100-73-0-1.sslip.io",
            "[::1]:8080", "10.0.0.1:8080",
        )) assertFalse(CarUrls.isOurHost(host, ips), host)
    }
}
