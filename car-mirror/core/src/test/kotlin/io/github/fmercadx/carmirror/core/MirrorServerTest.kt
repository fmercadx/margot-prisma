package io.github.fmercadx.carmirror.core

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

class MirrorServerTest {
    private val loopback = InetAddress.getLoopbackAddress()
    private val hub = FrameHub()
    private var server: MirrorServer? = null

    private fun startServer(
        hostAllowed: (String) -> Boolean = { true },
        longPollMs: Long = 200,
        maxConnections: Int = 16,
        control: MirrorControl? = null,
        autoQuality: AutoQuality? = null,
    ): Int {
        val s = MirrorServer(hub, hostAllowed, control, autoQuality, longPollMs = longPollMs, maxConnections = maxConnections)
        server = s
        return s.start(0, loopback)
    }

    /** Stands in for the phone's touch service. */
    private class FakePhone(var touchOn: Boolean = true, var succeeds: Boolean = true) : MirrorControl {
        val performed = mutableListOf<Gesture>()
        override val touchAvailable get() = touchOn
        override fun perform(gesture: Gesture): Boolean {
            performed += gesture
            return succeeds
        }
    }

    @AfterTest
    fun tearDown() {
        server?.stop()
        hub.close()
    }

    /** A response read off the wire with no client library in between. */
    class Response(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
        val text get() = String(body, Charsets.UTF_8)
    }

    private fun connect(port: Int) = Socket(loopback, port).apply { soTimeout = 5_000 }

    private fun send(socket: Socket, path: String, host: String = "127.0.0.1", extra: String = "", method: String = "GET") {
        socket.getOutputStream().write("$method $path HTTP/1.1\r\nHost: $host\r\n$extra\r\n".toByteArray())
        socket.getOutputStream().flush()
    }

    private fun readLine(input: InputStream): String {
        val out = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) throw IOException("closed after: $out")
            if (b == '\n'.code) break
            out.write(b)
        }
        return out.toString(Charsets.ISO_8859_1).trimEnd('\r')
    }

    private fun readHead(input: InputStream): Pair<Int, Map<String, String>> {
        val status = readLine(input).split(' ')[1].toInt()
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = readLine(input)
            if (line.isEmpty()) break
            val colon = line.indexOf(':')
            headers[line.substring(0, colon).lowercase()] = line.substring(colon + 1).trim()
        }
        return status to headers
    }

    private fun readResponse(input: InputStream): Response {
        val (status, headers) = readHead(input)
        val length = headers["content-length"]?.toInt() ?: 0
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) fail("body cut short")
            read += n
        }
        return Response(status, headers, body)
    }

    private fun get(port: Int, path: String, host: String = "127.0.0.1"): Response =
        connect(port).use { socket ->
            send(socket, path, host, "Connection: close\r\n")
            readResponse(BufferedInputStream(socket.getInputStream()))
        }

    @Test
    fun `serves the viewer page, which loads nothing from elsewhere`() {
        val port = startServer()
        val response = get(port, "/")
        assertEquals(200, response.status)
        assertTrue(response.headers["content-type"]!!.startsWith("text/html"))
        assertTrue("<canvas" in response.text)
        val csp = assertNotNull(response.headers["content-security-policy"])
        assertTrue("default-src 'none'" in csp && "connect-src 'self'" in csp, csp)
        assertEquals("no-store", response.headers["cache-control"])
    }

    @Test
    fun `answers 204 when the screen has not changed`() {
        val port = startServer(longPollMs = 150)
        val response = get(port, "/frame?after=0")
        assertEquals(204, response.status)
        assertEquals(null, response.headers["content-length"], "204 must not carry a Content-Length")
    }

    @Test
    fun `returns the newest frame with its sequence number and size`() {
        val port = startServer()
        hub.publish(byteArrayOf(1, 2, 3), 640, 480)
        val response = get(port, "/frame?after=0")
        assertEquals(200, response.status)
        assertEquals("image/jpeg", response.headers["content-type"])
        assertEquals("1", response.headers["x-frame-seq"])
        assertEquals("640", response.headers["x-frame-width"])
        assertEquals("480", response.headers["x-frame-height"])
        assertContentEquals(byteArrayOf(1, 2, 3), response.body)
    }

    @Test
    fun `a waiting request is answered as soon as a new frame arrives`() {
        val port = startServer(longPollMs = 5_000)
        hub.publish(byteArrayOf(1), 1, 1)
        thread {
            Thread.sleep(150)
            hub.publish(byteArrayOf(2), 1, 1)
        }
        val started = System.nanoTime()
        val response = get(port, "/frame?after=1")
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertEquals(200, response.status)
        assertEquals("2", response.headers["x-frame-seq"])
        assertTrue(elapsedMs in 100..2_000, "took $elapsedMs ms")
    }

    @Test
    fun `keeps the connection open between frame requests`() {
        val port = startServer()
        connect(port).use { socket ->
            val input = BufferedInputStream(socket.getInputStream())
            for (n in 1..3) {
                hub.publish(byteArrayOf(n.toByte()), 1, 1)
                send(socket, "/frame?after=${n - 1}")
                val response = readResponse(input)
                assertEquals(200, response.status)
                assertEquals("keep-alive", response.headers["connection"])
                assertEquals(n.toString(), response.headers["x-frame-seq"])
            }
        }
    }

    @Test
    fun `refuses a Host it does not recognise`() {
        val port = startServer(hostAllowed = { CarUrls.isOurHost(it, listOf("127.0.0.1")) })
        assertEquals(403, get(port, "/", host = "attacker.example").status)
        assertEquals(200, get(port, "/", host = "127.0.0.1:$port").status)
    }

    @Test
    fun `rejects other methods, bodies, malformed requests and unknown paths`() {
        val port = startServer()
        assertEquals(404, get(port, "/nope").status)
        connect(port).use { socket ->
            send(socket, "/", method = "POST", extra = "Content-Length: 0\r\n")
            val response = readResponse(BufferedInputStream(socket.getInputStream()))
            assertEquals(405, response.status)
            assertEquals("close", response.headers["connection"])
        }
        connect(port).use { socket ->
            send(socket, "/", extra = "Content-Length: 5\r\n")
            assertEquals(400, readResponse(BufferedInputStream(socket.getInputStream())).status)
        }
        connect(port).use { socket ->
            socket.getOutputStream().write("NONSENSE\r\n\r\n".toByteArray())
            assertEquals(400, readResponse(BufferedInputStream(socket.getInputStream())).status)
        }
    }

    @Test
    fun `hangs up at once on a browser trying HTTPS, so it falls back to HTTP quickly`() {
        val port = startServer()
        connect(port).use { socket ->
            // The start of a TLS ClientHello: no line break anywhere.
            socket.getOutputStream().write(byteArrayOf(0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0xfc.toByte()))
            socket.getOutputStream().flush()
            val started = System.nanoTime()
            val result = try {
                socket.getInputStream().read()
            } catch (_: IOException) {
                -1
            }
            assertEquals(-1, result)
            assertTrue((System.nanoTime() - started) / 1_000_000 < 1_000, "waited instead of hanging up")
        }
        assertEquals(200, get(port, "/").status, "plain HTTP still works afterwards")
    }

    @Test
    fun `HEAD returns headers without a body`() {
        val port = startServer()
        connect(port).use { socket ->
            send(socket, "/", method = "HEAD", extra = "Connection: close\r\n")
            val input = BufferedInputStream(socket.getInputStream())
            val (status, headers) = readHead(input)
            assertEquals(200, status)
            assertTrue(headers["content-length"]!!.toInt() > 0)
            assertEquals(-1, input.read(), "HEAD response carried a body")
        }
    }

    @Test
    fun `streams MJPEG parts for browsers without fetch`() {
        val port = startServer()
        hub.publish(byteArrayOf(9, 8, 7), 2, 2)
        connect(port).use { socket ->
            send(socket, "/stream.mjpeg")
            val input = BufferedInputStream(socket.getInputStream())
            val (status, headers) = readHead(input)
            assertEquals(200, status)
            assertTrue(headers["content-type"]!!.startsWith("multipart/x-mixed-replace; boundary="))
            val boundary = headers["content-type"]!!.substringAfter("boundary=")
            assertEquals("--$boundary", readLine(input))
            val part = readResponseBodyOfPart(input)
            assertContentEquals(byteArrayOf(9, 8, 7), part)
        }
    }

    private fun readResponseBodyOfPart(input: InputStream): ByteArray {
        var length = -1
        while (true) {
            val line = readLine(input)
            if (line.isEmpty()) break
            if (line.lowercase().startsWith("content-length:")) length = line.substringAfter(':').trim().toInt()
        }
        val body = ByteArray(length)
        var read = 0
        while (read < length) read += input.read(body, read, length - read)
        return body
    }

    @Test
    fun `remembers which address each viewer typed`() {
        val port = startServer(longPollMs = 50)
        get(port, "/frame?after=0", host = "100-73-0-1.sslip.io:$port")
        val viewer = server!!.recentViewers().single()
        assertEquals("100-73-0-1.sslip.io:$port", viewer.host)
        assertEquals("127.0.0.1", viewer.remoteAddress)
    }

    @Test
    fun `turns away connections beyond the limit`() {
        val port = startServer(longPollMs = 5_000, maxConnections = 1)
        connect(port).use { held ->
            send(held, "/frame?after=0") // parks in a long poll
            Thread.sleep(150)
            assertEquals(503, get(port, "/").status)
        }
    }

    @Test
    fun `stop ends connections that are waiting for a frame`() {
        val port = startServer(longPollMs = 30_000)
        connect(port).use { socket ->
            send(socket, "/frame?after=0")
            Thread.sleep(150)
            val started = System.nanoTime()
            server!!.stop()
            hub.close()
            val input = socket.getInputStream()
            try {
                // Either the connection closes or the waiting request is answered; it must not hang.
                input.read()
            } catch (_: IOException) {
            }
            assertTrue((System.nanoTime() - started) / 1_000_000 < 3_000, "stop did not release the waiting request")
        }
    }

    @Test
    fun `moves to the next port when the preferred one is taken`() {
        val first = startServer()
        val second = MirrorServer(hub)
        try {
            val port = second.start(first, loopback)
            assertTrue(port in (first + 1)..(first + 9), "bound $port")
        } finally {
            second.stop()
        }
    }

    // ---- Touch control ----

    private fun post(port: Int, body: String, token: String?, extraHeaders: String = ""): Response =
        connect(port).use { socket ->
            val tokenHeader = if (token == null) "" else "X-Car-Mirror-Token: $token\r\n"
            val bytes = body.toByteArray()
            socket.getOutputStream().write(
                ("POST /input HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n$tokenHeader" +
                    "Content-Length: ${bytes.size}\r\n$extraHeaders\r\n").toByteArray() + bytes,
            )
            readResponse(BufferedInputStream(socket.getInputStream()))
        }

    @Test
    fun `a tap reaches the phone only with this session's token`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val token = server!!.token
        assertEquals(403, post(port, "d=60&p=0.5,0.5", token = null).status)
        assertEquals(403, post(port, "d=60&p=0.5,0.5", token = "from-an-earlier-session").status)
        assertTrue(phone.performed.isEmpty(), "performed a gesture without the token")

        assertEquals(204, post(port, "d=60&p=0.5,0.25", token).status)
        assertEquals(0.25f, phone.performed.single().points.single().y)
        assertTrue(MirrorServer(hub).token != token, "tokens must differ between sessions")
    }

    @Test
    fun `refuses taps while paused, while touch is off, or when the phone can't`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val token = server!!.token

        hub.setPaused("privacy")
        assertEquals(409, post(port, "d=60&p=0.5,0.5", token).status)
        hub.setPaused(null)

        phone.touchOn = false
        assertEquals(409, post(port, "d=60&p=0.5,0.5", token).status)
        phone.touchOn = true

        phone.succeeds = false
        assertEquals(409, post(port, "d=60&p=0.5,0.5", token).status)
        assertEquals(1, phone.performed.size, "only the last attempt should have reached the phone")
    }

    @Test
    fun `rejects malformed, oversized and unlengthed input`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val token = server!!.token
        assertEquals(400, post(port, "d=60&p=2,2", token).status)
        assertEquals(413, post(port, "d=60&p=" + "0.5,0.5;".repeat(1000), token).status)
        connect(port).use { socket ->
            socket.getOutputStream().write("POST /input HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Car-Mirror-Token: $token\r\n\r\n".toByteArray())
            assertEquals(411, readResponse(BufferedInputStream(socket.getInputStream())).status)
        }
        assertTrue(phone.performed.isEmpty())
    }

    @Test
    fun `without touch support the endpoint does not exist`() {
        val port = startServer(control = null)
        assertEquals(404, post(port, "d=60&p=0.5,0.5", server!!.token).status)
    }

    @Test
    fun `refuses a cross-site preflight, so other pages cannot send taps`() {
        val port = startServer(control = FakePhone())
        connect(port).use { socket ->
            send(socket, "/input", method = "OPTIONS",
                extra = "Origin: http://evil.example\r\nAccess-Control-Request-Method: POST\r\n" +
                    "Access-Control-Request-Headers: x-car-mirror-token\r\n")
            val response = readResponse(BufferedInputStream(socket.getInputStream()))
            assertEquals(405, response.status)
            assertTrue(response.headers.keys.none { it.startsWith("access-control-") }, "sent CORS headers")
        }
    }

    @Test
    fun `status reports touch, quality and the session token`() {
        val port = startServer(control = FakePhone(), autoQuality = AutoQuality(max = 70))
        val json = get(port, "/status").text
        assertTrue("\"touch\":true" in json, json)
        assertTrue("\"jpegQuality\":70" in json, json)
        assertTrue("\"token\":\"${server!!.token}\"" in json, json)
        assertTrue("\"paused\":null" in json, json)
    }

    // ---- Pause ----

    @Test
    fun `a paused viewer gets the pause, never the frame`() {
        val port = startServer(longPollMs = 150)
        hub.publish(byteArrayOf(1, 2, 3), 2, 2)
        hub.setPaused("privacy")

        val first = get(port, "/frame?after=0")
        assertEquals(204, first.status)
        assertEquals("privacy", first.headers["x-mirror-paused"])

        // Knowing it is paused, the viewer waits the full poll and still gets nothing.
        val started = System.nanoTime()
        val waiting = get(port, "/frame?after=0&paused=privacy")
        assertEquals(204, waiting.status)
        assertTrue((System.nanoTime() - started) / 1_000_000 >= 100, "did not wait while paused")

        hub.setPaused(null)
        val resumed = get(port, "/frame?after=0&paused=privacy")
        assertEquals(204, resumed.status)
        assertEquals("", resumed.headers["x-mirror-paused"])

        val live = get(port, "/frame?after=0")
        assertEquals(200, live.status)
        assertEquals("", live.headers["x-mirror-paused"])
    }

    @Test
    fun `the MJPEG fallback goes black while paused`() {
        val port = startServer()
        hub.publish(byteArrayOf(9, 8, 7), 2, 2)
        connect(port).use { socket ->
            send(socket, "/stream.mjpeg")
            val input = BufferedInputStream(socket.getInputStream())
            val (_, headers) = readHead(input)
            val boundary = headers["content-type"]!!.substringAfter("boundary=")
            assertEquals("--$boundary", readLine(input))
            assertContentEquals(byteArrayOf(9, 8, 7), readResponseBodyOfPart(input))

            hub.setPaused("privacy")
            readLine(input) // CRLF after the previous part
            assertEquals("--$boundary", readLine(input))
            val black = readResponseBodyOfPart(input)
            assertEquals(0xFF.toByte(), black[0])
            assertEquals(0xD8.toByte(), black[1], "not a JPEG")
            assertTrue(black.size > 100, "too small to be the black frame")
        }
    }

    @Test
    fun `tells auto quality how many frames the car skipped`() {
        val quality = AutoQuality(max = 70, min = 40, windowMs = 0)
        val port = startServer(autoQuality = quality)
        repeat(5) { hub.publish(byteArrayOf(it.toByte()), 1, 1) }
        // The car drew frame 1 and now gets frame 5: it skipped 2, 3 and 4.
        assertEquals("5", get(port, "/frame?after=1").headers["x-frame-seq"])
        assertEquals(60, quality.current)
    }
}
