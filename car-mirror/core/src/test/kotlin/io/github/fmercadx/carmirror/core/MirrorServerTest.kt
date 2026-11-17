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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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
        acceptLocal: (InetAddress) -> Boolean = { true },
        streamPingMs: Long = 2_000,
    ): Int {
        val s = MirrorServer(hub, hostAllowed, control, autoQuality, acceptLocal,
            longPollMs = longPollMs, pairWaitMs = 2_000, streamPingMs = streamPingMs, maxConnections = maxConnections)
        server = s
        return s.start(0, loopback)
    }

    /** Stands in for the phone's touch service. */
    private class FakePhone(var touchOn: Boolean = true, var succeeds: Boolean = true) : MirrorControl {
        val performed = mutableListOf<Gesture>()
        val pressed = mutableListOf<GlobalAction>()
        override val touchAvailable get() = touchOn
        override fun perform(gesture: Gesture): Boolean {
            performed += gesture
            return succeeds
        }
        override fun perform(action: GlobalAction): Boolean {
            pressed += action
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

    private fun post(port: Int, path: String, body: ByteArray, headers: String = ""): Response =
        connect(port).use { socket ->
            socket.getOutputStream().write(
                ("POST $path HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n$headers" +
                    "Content-Length: ${body.size}\r\n\r\n").toByteArray() + body,
            )
            readResponse(BufferedInputStream(socket.getInputStream()))
        }

    private fun post(port: Int, path: String, form: String) = post(port, path, form.toByteArray())

    private fun field(json: String, name: String): String =
        Regex("\"$name\":\"([^\"]*)\"").find(json)?.groupValues?.get(1) ?: fail("no $name in $json")

    /** A car paired with the phone and holding an open session, set up directly. */
    private fun pairedCar(): TestCar = TestCar().also { it.pairAndOpen(server!!.pairing, "127.0.0.1") }

    private fun TestCar.query() = "s=$sessionId"

    // ---- Frames as the car decrypts them ----

    private class Record(val type: Int, val sealed: ByteArray)

    private class Shown(val seq: Long, val width: Int, val height: Int, val jpeg: ByteArray)

    private fun readRecord(input: InputStream): Record {
        val head = ByteArray(5)
        var read = 0
        while (read < 5) {
            val n = input.read(head, read, 5 - read)
            if (n < 0) throw IOException("stream ended")
            read += n
        }
        val length = ((head[1].toInt() and 0xFF) shl 24) or ((head[2].toInt() and 0xFF) shl 16) or
            ((head[3].toInt() and 0xFF) shl 8) or (head[4].toInt() and 0xFF)
        val payload = ByteArray(length)
        read = 0
        while (read < length) {
            val n = input.read(payload, read, length - read)
            if (n < 0) throw IOException("stream ended mid-record")
            read += n
        }
        return Record(head[0].toInt(), payload)
    }

    private fun TestCar.plaintext(record: Record): ByteArray =
        open(byteArrayOf(record.type.toByte()), record.sealed) ?: fail("record ${record.type} did not decrypt")

    private fun TestCar.frame(record: Record): Shown {
        assertEquals(1, record.type, "expected a frame record")
        val p = plaintext(record)
        return Shown(Crypto.getLong(p, 0), ((p[8].toInt() and 0xFF) shl 8) or (p[9].toInt() and 0xFF),
            ((p[10].toInt() and 0xFF) shl 8) or (p[11].toInt() and 0xFF), p.copyOfRange(12, p.size))
    }

    private fun TestCar.state(record: Record): String {
        assertEquals(2, record.type, "expected a pause-state record")
        return String(plaintext(record))
    }

    private fun recordOf(response: Response): Record {
        assertEquals(200, response.status, response.text)
        return readRecord(response.body.inputStream())
    }

    private fun openStream(port: Int, car: TestCar, query: String = ""): Pair<Socket, InputStream> {
        val socket = connect(port)
        send(socket, "/frames?${car.query()}$query")
        val input = BufferedInputStream(socket.getInputStream())
        val (status, headers) = readHead(input)
        assertEquals(200, status)
        assertEquals("application/octet-stream", headers["content-type"])
        return socket to input
    }

    private fun input(port: Int, car: TestCar, text: String): Response =
        post(port, "/input", car.seal(Crypto.utf8("input"), Crypto.utf8(text)), "X-Car-Mirror-Session: ${car.sessionId}\r\n")

    // ---- The page ----

    @Test
    fun `serves the viewer page, which loads nothing from elsewhere`() {
        val port = startServer()
        val response = get(port, "/")
        assertEquals(200, response.status)
        assertTrue(response.headers["content-type"]!!.startsWith("text/html"))
        assertTrue("<canvas" in response.text)
        val csp = assertNotNull(response.headers["content-security-policy"])
        assertTrue("default-src 'none'" in csp && "connect-src 'self'" in csp && "script-src 'self'" in csp, csp)
        assertEquals("no-store", response.headers["cache-control"])
    }

    @Test
    fun `serves the page's crypto from the phone itself`() {
        val port = startServer()
        val response = get(port, "/crypto.js")
        assertEquals(200, response.status)
        assertTrue(response.headers["content-type"]!!.startsWith("text/javascript"))
        assertTrue("CarCrypto" in response.text)
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
        assertEquals(404, post(port, "/", "x=1").status)
        connect(port).use { socket ->
            send(socket, "/", method = "PUT", extra = "Content-Length: 0\r\n")
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

    // ---- Nothing without pairing ----

    @Test
    fun `nothing that shows the screen is served without a session`() {
        val port = startServer(control = FakePhone())
        hub.publish(byteArrayOf(1, 2, 3), 2, 2)
        assertEquals(401, get(port, "/frame?after=0").status)
        assertEquals(401, get(port, "/frames").status)
        assertEquals(401, get(port, "/status").status)
        assertEquals(401, get(port, "/frame?after=0&s=made-up").status)
        assertEquals(404, get(port, "/stream.mjpeg").status, "the unencrypted MJPEG fallback is gone")
        assertEquals(401, post(port, "/input", "d=60&p=0.5,0.5").status)
    }

    @Test
    fun `a car pairs over http once the user allows it, then opens a session`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val car = TestCar()
        val started = post(port, "/pair/start", "c=" + Crypto.b64(car.commitment())).text
        val id = field(started, "id")
        val phoneKey = Crypto.unb64(field(started, "pub"))!!
        assertTrue(server!!.pairing.waiting().isEmpty(), "the user isn't asked until the car reveals its key")

        assertEquals("waiting", field(post(port, "/pair/finish", "id=$id&pub=" + Crypto.b64(car.publicKey)).text, "state"))
        val asked = server!!.pairing.waiting().single()
        assertEquals(car.code(phoneKey), asked.code, "the phone and the car show the same code")
        assertEquals("waiting", field(get(port, "/pair/wait?id=$id&state=started").text, "state"))

        thread { Thread.sleep(200); server!!.pairing.approve(id) }
        assertEquals("approved", field(get(port, "/pair/wait?id=$id&state=waiting").text, "state"))
        car.paired(id, phoneKey)

        val key = car.sessionKey()
        val challenge = post(port, "/session/start", "pair=$id&pub=" + Crypto.b64(key)).text
        val sessionPhoneKey = Crypto.unb64(field(challenge, "pub"))!!
        val nonce = Crypto.unb64(field(challenge, "nonce"))!!
        val opened = post(port, "/session/finish", "pair=$id&pub=" + Crypto.b64(key) +
            "&proof=" + Crypto.b64(car.proof(sessionPhoneKey, nonce))).text
        car.opened(field(opened, "session"), sessionPhoneKey, nonce)

        val status = get(port, "/status?${car.query()}")
        val json = String(car.open(Crypto.utf8("status"), status.body)!!)
        assertTrue("\"touch\":true" in json, json)
        assertEquals(204, input(port, car, "a=home").status)
        assertEquals(listOf(GlobalAction.HOME), phone.pressed)
    }

    @Test
    fun `a denied car gets nothing`() {
        val port = startServer()
        val car = TestCar()
        val id = field(post(port, "/pair/start", "c=" + Crypto.b64(car.commitment())).text, "id")
        post(port, "/pair/finish", "id=$id&pub=" + Crypto.b64(car.publicKey))
        server!!.pairing.deny(id)
        assertEquals("denied", field(get(port, "/pair/wait?id=$id&state=waiting").text, "state"))
        assertEquals(404, post(port, "/session/start", "pair=$id&pub=" + Crypto.b64(car.sessionKey())).status)
        assertEquals(429, post(port, "/pair/start", "c=" + Crypto.b64(TestCar().commitment())).status,
            "the same address may not ask again straight away")
    }

    @Test
    fun `a session needs the pair key's proof`() {
        val port = startServer()
        val car = pairedCar()
        val key = car.sessionKey()
        post(port, "/session/start", "pair=${car.pairId}&pub=" + Crypto.b64(key))
        assertEquals(403, post(port, "/session/finish", "pair=${car.pairId}&pub=" + Crypto.b64(key) +
            "&proof=" + Crypto.b64(ByteArray(32))).status)
        assertEquals(400, post(port, "/pair/finish", "id=nope&pub=" + Crypto.b64(ByteArray(32))).status)
        assertEquals(400, post(port, "/pair/start", "c=not-base64!").status)
    }

    // ---- Frames, one at a time (the fallback) ----

    @Test
    fun `the poll fallback returns the newest frame, encrypted, with its number and size`() {
        val port = startServer()
        val car = pairedCar()
        hub.publish(byteArrayOf(1, 2, 3), 640, 480)
        val shown = car.frame(recordOf(get(port, "/frame?${car.query()}&after=0")))
        assertEquals(1, shown.seq)
        assertEquals(640, shown.width)
        assertEquals(480, shown.height)
        assertContentEquals(byteArrayOf(1, 2, 3), shown.jpeg)
    }

    @Test
    fun `the poll fallback pings when the screen has not changed`() {
        val port = startServer(longPollMs = 150)
        val car = pairedCar()
        val record = recordOf(get(port, "/frame?${car.query()}&after=0"))
        assertEquals(3, record.type)
        assertEquals(0, car.plaintext(record).size)
    }

    @Test
    fun `a waiting request is answered as soon as a new frame arrives`() {
        val port = startServer(longPollMs = 5_000)
        val car = pairedCar()
        hub.publish(byteArrayOf(1), 1, 1)
        thread {
            Thread.sleep(150)
            hub.publish(byteArrayOf(2), 1, 1)
        }
        val started = System.nanoTime()
        val shown = car.frame(recordOf(get(port, "/frame?${car.query()}&after=1")))
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertEquals(2, shown.seq)
        assertTrue(elapsedMs in 100..2_000, "took $elapsedMs ms")
    }

    @Test
    fun `keeps the connection open between frame requests`() {
        val port = startServer()
        val car = pairedCar()
        connect(port).use { socket ->
            val input = BufferedInputStream(socket.getInputStream())
            for (n in 1..3) {
                hub.publish(byteArrayOf(n.toByte()), 1, 1)
                send(socket, "/frame?${car.query()}&after=${n - 1}")
                val response = readResponse(input)
                assertEquals("keep-alive", response.headers["connection"])
                assertEquals(n.toLong(), car.frame(recordOf(response)).seq)
            }
        }
    }

    @Test
    fun `a paused viewer gets the pause, never the frame`() {
        val port = startServer(longPollMs = 150)
        val car = pairedCar()
        hub.publish(byteArrayOf(1, 2, 3), 2, 2)
        hub.setPaused("privacy")
        assertEquals("privacy", car.state(recordOf(get(port, "/frame?${car.query()}&after=0"))))

        // Knowing it is paused, the viewer waits the full poll and still gets nothing.
        val started = System.nanoTime()
        assertEquals(3, recordOf(get(port, "/frame?${car.query()}&after=0&paused=privacy")).type)
        assertTrue((System.nanoTime() - started) / 1_000_000 >= 100, "did not wait while paused")

        hub.setPaused(null)
        assertEquals("", car.state(recordOf(get(port, "/frame?${car.query()}&after=0&paused=privacy"))))
        assertEquals(1, recordOf(get(port, "/frame?${car.query()}&after=0")).type)
    }

    @Test
    fun `tells auto quality how many frames the car skipped`() {
        val quality = AutoQuality(max = 70, min = 40, windowMs = 0)
        val port = startServer(autoQuality = quality)
        val car = pairedCar()
        repeat(5) { hub.publish(byteArrayOf(it.toByte()), 1, 1) }
        // The car drew frame 1 and now gets frame 5: it skipped 2, 3 and 4.
        assertEquals(5, car.frame(recordOf(get(port, "/frame?${car.query()}&after=1"))).seq)
        assertEquals(60, quality.current)
    }

    @Test
    fun `remembers which address each viewer typed`() {
        val port = startServer(longPollMs = 50)
        val car = pairedCar()
        get(port, "/frame?${car.query()}&after=0", host = "100-73-0-1.sslip.io:$port")
        val viewer = server!!.recentViewers().single()
        assertEquals("100-73-0-1.sslip.io:$port", viewer.host)
        assertEquals("127.0.0.1", viewer.remoteAddress)
    }

    @Test
    fun `an unpaired device doesn't count as the car`() {
        val port = startServer(longPollMs = 50)
        get(port, "/frame?after=0")
        get(port, "/frames")
        assertTrue(server!!.recentViewers().isEmpty())
    }

    @Test
    fun `turns away connections beyond the limit`() {
        val port = startServer(longPollMs = 5_000, maxConnections = 1)
        val car = pairedCar()
        connect(port).use { held ->
            send(held, "/frame?${car.query()}&after=0") // parks in a long poll
            Thread.sleep(150)
            assertEquals(503, get(port, "/").status)
        }
    }

    @Test
    fun `stop ends connections that are waiting for a frame`() {
        val port = startServer(longPollMs = 30_000)
        val car = pairedCar()
        connect(port).use { socket ->
            send(socket, "/frame?${car.query()}&after=0")
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

    // ---- The frame stream ----

    @Test
    fun `the stream pushes each new frame without being asked again`() {
        val port = startServer()
        val car = pairedCar()
        val (socket, input) = openStream(port, car)
        socket.use {
            for (n in 1..3) {
                hub.publish(byteArrayOf(n.toByte(), 9), 640, 296)
                val shown = car.frame(readRecord(input))
                assertEquals(640, shown.width)
                assertEquals(296, shown.height)
                assertContentEquals(byteArrayOf(n.toByte(), 9), shown.jpeg)
            }
        }
    }

    @Test
    fun `frames are encrypted on the wire`() {
        val port = startServer()
        val car = pairedCar()
        val jpeg = Crypto.utf8("JFIF-this-is-the-phone-screen").let { byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + it }
        val (socket, input) = openStream(port, car)
        socket.use {
            hub.publish(jpeg, 2, 2)
            val record = readRecord(input)
            assertFalse(String(record.sealed, Charsets.ISO_8859_1).contains("phone-screen"), "the JPEG crossed the network in the clear")
            assertContentEquals(jpeg, car.frame(record).jpeg)
            assertNull(TestCar().also { it.pairAndOpen(server!!.pairing, "127.0.0.1") }.open(byteArrayOf(1), record.sealed),
                "another car's session can't read it")
        }
    }

    @Test
    fun `a car that falls behind gets the newest frame, not a backlog`() {
        val port = startServer()
        val car = pairedCar()
        repeat(5) { hub.publish(byteArrayOf(it.toByte()), 1, 1) }
        val (socket, input) = openStream(port, car)
        socket.use {
            assertEquals(4, car.frame(readRecord(input)).jpeg[0].toInt(), "should start from the newest frame")
        }
    }

    @Test
    fun `the stream carries pauses and sends no frames while paused`() {
        val port = startServer()
        val car = pairedCar()
        hub.publish(byteArrayOf(1), 1, 1)
        val (socket, input) = openStream(port, car)
        socket.use {
            car.frame(readRecord(input))
            hub.setPaused("privacy")
            assertEquals("privacy", car.state(readRecord(input)))
            hub.publish(byteArrayOf(2), 1, 1) // made while paused: must not be sent
            hub.setPaused(null)
            assertEquals("", car.state(readRecord(input)))
            assertEquals(2, car.frame(readRecord(input)).jpeg[0].toInt())
        }
    }

    @Test
    fun `an idle stream sends pings so a vanished car is noticed`() {
        val port = startServer(streamPingMs = 100)
        val car = pairedCar()
        val (socket, input) = openStream(port, car)
        socket.use {
            val ping = readRecord(input)
            assertEquals(3, ping.type)
            assertEquals(0, car.plaintext(ping).size)
        }
    }

    @Test
    fun `forgetting the car ends its stream`() {
        val port = startServer(streamPingMs = 100)
        val car = pairedCar()
        val (socket, input) = openStream(port, car)
        socket.use {
            readRecord(input)
            server!!.pairing.forgetAll()
            val ended = try {
                repeat(10) { readRecord(input) }
                false
            } catch (_: IOException) {
                true
            }
            assertTrue(ended, "the stream outlived the pairing")
            assertEquals(401, get(port, "/status?${car.query()}").status)
        }
    }

    @Test
    fun `when the link can't keep up, frames are skipped and auto quality steps down`() {
        val quality = AutoQuality(max = 70, min = 40, windowMs = 0)
        val port = startServer(autoQuality = quality)
        val car = pairedCar()
        // A car that reads slowly: a tiny receive buffer, and nothing read until frames pile up.
        val socket = Socket().apply {
            receiveBufferSize = 4 * 1024
            soTimeout = 5_000
            connect(java.net.InetSocketAddress(loopback, port))
        }
        socket.use {
            send(socket, "/frames?${car.query()}")
            val input = BufferedInputStream(socket.getInputStream())
            readHead(input)
            hub.publish(byteArrayOf(1), 1, 1)
            car.frame(readRecord(input)) // the stream is live
            hub.publish(ByteArray(4 * 1024 * 1024), 1, 1) // far bigger than every buffer: the write blocks
            Thread.sleep(200)
            repeat(3) { hub.publish(byteArrayOf(9), 1, 1) } // made while the write is stuck
            assertEquals(4 * 1024 * 1024, car.frame(readRecord(input)).jpeg.size)
            assertEquals(9, car.frame(readRecord(input)).jpeg[0].toInt())
            assertEquals(60, quality.current, "skipping two frames out of three should lower quality")
        }
    }

    @Test
    fun `frames withheld during a pause don't count as the car falling behind`() {
        val quality = AutoQuality(max = 70, min = 40, windowMs = 0)
        val port = startServer(autoQuality = quality)
        val car = pairedCar()
        val (socket, input) = openStream(port, car)
        socket.use {
            hub.publish(byteArrayOf(1), 1, 1)
            readRecord(input)
            hub.setPaused("privacy")
            readRecord(input)
            repeat(4) { hub.publish(byteArrayOf(2), 1, 1) }
            hub.setPaused(null)
            readRecord(input) // resumed
            assertEquals(1, readRecord(input).type)
            assertEquals(70, quality.current)
        }
    }

    // ---- Connections ----

    @Test
    fun `closes connections that arrive on an address it should not serve`() {
        val seen = mutableListOf<InetAddress>()
        val port = startServer(acceptLocal = { seen += it; false })
        connect(port).use { socket ->
            send(socket, "/")
            val result = try {
                socket.getInputStream().read()
            } catch (_: IOException) {
                -1
            }
            assertEquals(-1, result, "answered on an address it should not serve")
        }
        assertEquals(loopback, seen.single(), "the filter should see the address the connection arrived on")
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

    @Test
    fun `a tap reaches the phone only from a paired car's session`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        assertEquals(401, post(port, "/input", "d=60&p=0.5,0.5").status)
        val car = pairedCar()
        assertEquals(204, input(port, car, "d=60&p=0.5,0.25").status)
        assertEquals(0.25f, phone.performed.single().points.single().y)
    }

    @Test
    fun `a recorded tap can't be replayed, and a forged one is refused`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val car = pairedCar()
        val tap = car.seal(Crypto.utf8("input"), Crypto.utf8("a=home"))
        val header = "X-Car-Mirror-Session: ${car.sessionId}\r\n"
        assertEquals(204, post(port, "/input", tap, header).status)
        assertEquals(403, post(port, "/input", tap, header).status, "the same message again")
        val forged = TestCar().also { it.pairAndOpen(server!!.pairing, "127.0.0.1") }.seal(Crypto.utf8("input"), Crypto.utf8("a=back"))
        assertEquals(403, post(port, "/input", forged, header).status, "sealed with another session's key")
        assertEquals(403, post(port, "/input", "a=back".toByteArray(), header).status, "not encrypted at all")
        assertEquals(listOf(GlobalAction.HOME), phone.pressed)
    }

    @Test
    fun `back, home and recents reach the phone`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val car = pairedCar()
        assertEquals(204, input(port, car, "a=back").status)
        assertEquals(204, input(port, car, "a=home").status)
        assertEquals(204, input(port, car, "a=recents").status)
        assertEquals(listOf(GlobalAction.BACK, GlobalAction.HOME, GlobalAction.RECENTS), phone.pressed)
        assertEquals(400, input(port, car, "a=power").status, "only the three navigation buttons")

        hub.setPaused("privacy")
        assertEquals(409, input(port, car, "a=home").status, "no buttons while paused")
        assertEquals(3, phone.pressed.size)
    }

    @Test
    fun `a two-finger pinch reaches the phone as two strokes`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val car = pairedCar()
        assertEquals(204, input(port, car, "d=400&p=0.45,0.5;0.3,0.5|0.55,0.5;0.7,0.5").status)
        val pinch = phone.performed.single()
        assertEquals(2, pinch.strokes.size)
        assertEquals(0.3f, pinch.strokes[0].last().x)
        assertEquals(0.7f, pinch.strokes[1].last().x)
    }

    @Test
    fun `refuses taps while paused, while touch is off, or when the phone can't`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val car = pairedCar()

        hub.setPaused("privacy")
        assertEquals(409, input(port, car, "d=60&p=0.5,0.5").status)
        hub.setPaused(null)

        phone.touchOn = false
        assertEquals(409, input(port, car, "d=60&p=0.5,0.5").status)
        phone.touchOn = true

        phone.succeeds = false
        assertEquals(409, input(port, car, "d=60&p=0.5,0.5").status)
        assertEquals(1, phone.performed.size, "only the last attempt should have reached the phone")
    }

    @Test
    fun `rejects malformed, oversized and unlengthed input`() {
        val phone = FakePhone()
        val port = startServer(control = phone)
        val car = pairedCar()
        assertEquals(400, input(port, car, "d=60&p=2,2").status)
        assertEquals(413, input(port, car, "d=60&p=" + "0.5,0.5;".repeat(1000)).status)
        connect(port).use { socket ->
            socket.getOutputStream().write("POST /input HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Car-Mirror-Session: ${car.sessionId}\r\n\r\n".toByteArray())
            assertEquals(411, readResponse(BufferedInputStream(socket.getInputStream())).status)
        }
        assertTrue(phone.performed.isEmpty())
    }

    @Test
    fun `without touch support there is nothing to tap`() {
        val port = startServer(control = null)
        val car = pairedCar()
        assertEquals(404, input(port, car, "d=60&p=0.5,0.5").status)
    }

    @Test
    fun `refuses a cross-site preflight, so other pages cannot send taps`() {
        val port = startServer(control = FakePhone())
        connect(port).use { socket ->
            send(socket, "/input", method = "OPTIONS",
                extra = "Origin: http://evil.example\r\nAccess-Control-Request-Method: POST\r\n" +
                    "Access-Control-Request-Headers: x-car-mirror-session\r\n")
            val response = readResponse(BufferedInputStream(socket.getInputStream()))
            assertEquals(405, response.status)
            assertTrue(response.headers.keys.none { it.startsWith("access-control-") }, "sent CORS headers")
        }
    }

    @Test
    fun `status is encrypted and reports touch, quality and pause`() {
        val port = startServer(control = FakePhone(), autoQuality = AutoQuality(max = 70))
        val car = pairedCar()
        val response = get(port, "/status?${car.query()}")
        assertFalse("touch" in response.text, "status crossed the network in the clear")
        val json = String(car.open(Crypto.utf8("status"), response.body)!!)
        assertTrue("\"touch\":true" in json, json)
        assertTrue("\"jpegQuality\":70" in json, json)
        assertTrue("\"paused\":null" in json, json)
        assertFalse("token" in json, json)
    }
}
