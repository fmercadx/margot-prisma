package io.github.fmercadx.carmirror.core

import org.jcodec.codecs.h264.H264Encoder
import org.jcodec.common.model.ColorSpace
import org.jcodec.scale.AWTUtil
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.BufferedInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.Socket
import java.nio.ByteBuffer
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Video mode: H.264 packed as fragmented MP4, handed out by VideoHub, streamed encrypted. */
class VideoTest {
    /** A few frames from jcodec, as the phone's encoder would hand them over (Annex B). */
    private fun encode(frames: Int, width: Int = 160, height: Int = 96): List<ByteArray> {
        val encoder = H264Encoder.createH264Encoder().apply { keyInterval = 10 }
        val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
        return List(frames) { n ->
            val g = image.createGraphics()
            g.color = Color(30, 60, 160)
            g.fillRect(0, 0, width, height)
            g.color = Color.ORANGE
            g.fillOval(n * 4 % width, 20, 30, 30)
            g.dispose()
            val picture = AWTUtil.fromBufferedImage(image, ColorSpace.YUV420J)
            val data = encoder.encodeFrame(picture, ByteBuffer.allocate(encoder.estimateBufferSize(picture))).data
            ByteArray(data.remaining()).also { data.get(it) }
        }
    }

    private fun boxTypes(bytes: ByteArray, from: Int = 0, to: Int = bytes.size): List<String> {
        val types = ArrayList<String>()
        var i = from
        while (i + 8 <= to) {
            val size = ((bytes[i].toInt() and 0xff) shl 24) or ((bytes[i + 1].toInt() and 0xff) shl 16) or
                ((bytes[i + 2].toInt() and 0xff) shl 8) or (bytes[i + 3].toInt() and 0xff)
            types += String(bytes, i + 4, 4, Charsets.ISO_8859_1)
            i += size
        }
        return types
    }

    // ---- Fmp4 ----

    @Test
    fun `splits annex b on both start code lengths and packs a sample with lengths`() {
        val stream = byteArrayOf(0, 0, 0, 1, 0x67, 1, 2, 3, 4, 0, 0, 1, 0x68, 5, 0, 0, 1, 0x65, 9, 8, 7)
        val nals = Fmp4.nalUnits(stream)
        assertEquals(listOf(7, 8, 5), nals.map(Fmp4::nalType))
        val sets = assertNotNull(Fmp4.parameterSets(stream))
        assertContentEquals(byteArrayOf(0x67, 1, 2, 3, 4), sets.sps)
        assertEquals("avc1.010203", sets.codec)
        assertTrue(Fmp4.isKeyframe(stream))
        // Parameter sets stay out of the sample; the IDR slice gets a 4-byte length.
        assertContentEquals(byteArrayOf(0, 0, 0, 4, 0x65, 9, 8, 7), Fmp4.sample(stream))
    }

    @Test
    fun `init and media segments have the boxes MSE expects`() {
        val frames = encode(2)
        val sets = assertNotNull(Fmp4.parameterSets(frames[0]), "jcodec's first frame carries SPS and PPS")
        val init = Fmp4.initSegment(sets, 160, 96)
        assertEquals(listOf("ftyp", "moov"), boxTypes(init))
        val segment = Fmp4.mediaSegment(1, 0, 3000, Fmp4.sample(frames[0]), keyframe = true)
        assertEquals(listOf("moof", "mdat"), boxTypes(segment))
        // trun's data offset points from the start of moof to the first sample byte.
        val moofSize = ((segment[0].toInt() and 0xff) shl 24) or ((segment[1].toInt() and 0xff) shl 16) or
            ((segment[2].toInt() and 0xff) shl 8) or (segment[3].toInt() and 0xff)
        val sample = Fmp4.sample(frames[0])
        assertContentEquals(sample, segment.copyOfRange(moofSize + 8, segment.size))
    }

    @Test
    fun `ffmpeg decodes what Fmp4 packs`() {
        val ffmpeg = System.getenv("FFMPEG")?.takeIf { File(it).canExecute() } ?: return // only where ffmpeg is installed
        val frames = encode(30)
        val sets = Fmp4.parameterSets(frames[0])!!
        val file = File.createTempFile("car-mirror", ".mp4")
        file.outputStream().use { out ->
            out.write(Fmp4.initSegment(sets, 160, 96))
            frames.forEachIndexed { n, frame ->
                out.write(Fmp4.mediaSegment(n + 1, n * 3000L, 3000, Fmp4.sample(frame), Fmp4.isKeyframe(frame)))
            }
        }
        val process = ProcessBuilder(ffmpeg, "-v", "error", "-i", file.path, "-f", "framemd5", "-")
            .redirectErrorStream(false).start()
        val decoded = process.inputStream.bufferedReader().readLines().count { !it.startsWith("#") && it.isNotBlank() }
        val errors = process.errorStream.bufferedReader().readText()
        assertEquals(0, process.waitFor(), errors)
        assertEquals(30, decoded, "ffmpeg should decode every frame; errors: $errors")
        file.delete()
    }

    // ---- VideoHub ----

    private fun seg(n: Int) = byteArrayOf(n.toByte())

    @Test
    fun `a new viewer gets the init and everything since the last keyframe`() {
        val hub = VideoHub()
        hub.publish(seg(0), keyframe = true) // before any init: dropped
        hub.setInit("avc1.42e01f", seg(99))
        hub.publish(seg(1), keyframe = false) // no keyframe yet: nothing to decode it against
        hub.publish(seg(2), keyframe = true)
        hub.publish(seg(3), keyframe = false)
        val update = assertNotNull(hub.await(0, 0, null, 100))
        assertEquals("avc1.42e01f", update.init!!.codec)
        assertEquals(listOf(2, 3), update.segments.map { it.bytes[0].toInt() })
        assertTrue(update.segments.first().keyframe)
        // Caught up: only what comes next.
        hub.publish(seg(4), keyframe = false)
        val next = assertNotNull(hub.await(update.init!!.generation, update.segments.last().index, null, 100))
        assertNull(next.init)
        assertEquals(listOf(4), next.segments.map { it.bytes[0].toInt() })
    }

    @Test
    fun `a viewer behind a new keyframe starts at it, and a lagging one asks for one`() {
        val hub = VideoHub()
        var wanted = 0
        hub.onKeyframeWanted = { wanted++ }
        hub.setInit("c", seg(99))
        hub.publish(seg(1), keyframe = true)
        val first = hub.await(0, 0, null, 100)!!
        val generation = first.init!!.generation
        val sent = first.segments.last().index
        repeat(50) { hub.publish(seg(2), keyframe = false) }
        assertEquals(50, hub.await(generation, sent, null, 100)!!.segments.size)
        assertEquals(1, wanted, "50 frames behind should ask for a keyframe")
        hub.publish(seg(3), keyframe = true)
        hub.publish(seg(4), keyframe = false)
        val caughtUp = hub.await(generation, sent, null, 100)!!
        assertEquals(listOf(3, 4), caughtUp.segments.map { it.bytes[0].toInt() }, "the old group is skipped")
    }

    @Test
    fun `a pause drops the group, and resuming waits for a fresh keyframe`() {
        val hub = VideoHub()
        var wanted = 0
        hub.onKeyframeWanted = { wanted++ }
        hub.setInit("c", seg(99))
        hub.publish(seg(1), keyframe = true)
        hub.setPaused("privacy")
        assertEquals("privacy", hub.await(1, 1, null, 100)!!.paused)
        assertNull(hub.await(1, 1, "privacy", 50), "nothing to send while paused")
        hub.setPaused(null)
        assertEquals(1, wanted, "resuming asks for a keyframe")
        assertEquals(null, hub.await(1, 1, "privacy", 100)!!.paused)
        hub.publish(seg(2), keyframe = false) // from before the keyframe arrived: dropped
        assertNull(hub.await(0, 0, null, 50), "the pre-pause frame is gone and nothing replaces it yet")
        hub.publish(seg(3), keyframe = true)
        assertEquals(listOf(3), hub.await(0, 0, null, 100)!!.segments.map { it.bytes[0].toInt() })
    }

    @Test
    fun `nothing encoded during a pause is ever sent, not even a keyframe`() {
        val hub = VideoHub()
        hub.setInit("c", seg(99))
        hub.publish(seg(1), keyframe = true)
        hub.setPaused("privacy")
        hub.publish(seg(2), keyframe = true) // the encoder's periodic keyframe, of what the user hid
        hub.publish(seg(3), keyframe = false)
        hub.setPaused(null)
        assertNull(hub.await(0, 0, null, 50), "the keyframe from during the pause must not be handed out")
        hub.publish(seg(4), keyframe = true)
        assertEquals(listOf(4), hub.await(0, 0, null, 100)!!.segments.map { it.bytes[0].toInt() })
    }

    // ---- The encrypted video stream ----

    private var server: MirrorServer? = null

    @AfterTest
    fun stop() {
        server?.stop()
    }

    /** Opens /frames[query] for [car] and returns the stream past the response head. */
    private fun openStream(port: Int, car: TestCar, query: String = ""): Pair<Socket, InputStream> {
        val socket = Socket(InetAddress.getLoopbackAddress(), port)
        socket.soTimeout = 5_000
        socket.getOutputStream().write("GET /frames?s=${car.sessionId}$query HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray())
        val input = BufferedInputStream(socket.getInputStream())
        while (true) {
            val line = StringBuilder()
            while (true) { val b = input.read(); if (b < 0 || b == '\n'.code) break; line.append(b.toChar()) }
            if (line.trim().isEmpty()) break
        }
        return socket to input
    }

    private fun status(port: Int, car: TestCar): String = String(car.open(Crypto.utf8("status"),
        Socket(InetAddress.getLoopbackAddress(), port).use { sock ->
            sock.getOutputStream().write("GET /status?s=${car.sessionId} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n".toByteArray())
            val all = sock.getInputStream().readBytes()
            val body = String(all, Charsets.ISO_8859_1).indexOf("\r\n\r\n") + 4
            all.copyOfRange(body, all.size)
        })!!)

    @Test
    fun `a car that can't play video asks for pictures, and the phone is told to switch`() {
        val hub = FrameHub()
        val video = VideoHub()
        val s = MirrorServer(hub, video = video, streamPingMs = 200)
        server = s
        var refused = 0
        s.onVideoRefused = { refused++; video.close() } // what the phone does: stop video, send JPEG
        val port = s.start(0, InetAddress.getLoopbackAddress())
        val car = TestCar().also { it.pairAndOpen(s.pairing, "127.0.0.1") }
        val frames = encode(1)
        video.setInit(Fmp4.parameterSets(frames[0])!!.codec, ByteArray(8))

        val (socket, input) = openStream(port, car, "&jpeg=1")
        socket.use {
            hub.publish(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2), 4, 2)
            var record = readRecord(input)
            while (record.first == 3) record = readRecord(input) // pings until the first frame
            assertEquals(1, record.first, "pictures, not video")
            assertEquals(1, refused)
        }
        // Video is off now: a car that doesn't ask gets pictures too, and status says so.
        val (again, againInput) = openStream(port, car)
        again.use {
            hub.publish(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 3, 4), 4, 2)
            var record = readRecord(againInput)
            while (record.first == 3) record = readRecord(againInput)
            assertEquals(1, record.first)
        }
        assertEquals(1, refused, "asked once")
        assertTrue("\"video\":false" in status(port, car))
    }

    @Test
    fun `a video stream ends when the phone falls back to pictures`() {
        val video = VideoHub()
        val s = MirrorServer(FrameHub(), video = video, streamPingMs = 100)
        server = s
        val port = s.start(0, InetAddress.getLoopbackAddress())
        val car = TestCar().also { it.pairAndOpen(s.pairing, "127.0.0.1") }
        val (socket, input) = openStream(port, car)
        socket.use {
            assertEquals(3, readRecord(input).first, "a ping while there is no video yet")
            video.close() // the encoder failed
            val ended = try {
                while (true) readRecord(input)
                @Suppress("UNREACHABLE_CODE") false
            } catch (e: IOException) { true }
            assertTrue(ended, "the car should reconnect and get pictures")
        }
    }

    private fun readRecord(input: InputStream): Pair<Int, ByteArray> {
        val head = ByteArray(5)
        var read = 0
        while (read < 5) read += input.read(head, read, 5 - read).also { if (it < 0) throw IOException("ended") }
        val length = ((head[1].toInt() and 0xFF) shl 24) or ((head[2].toInt() and 0xFF) shl 16) or
            ((head[3].toInt() and 0xFF) shl 8) or (head[4].toInt() and 0xFF)
        val payload = ByteArray(length)
        read = 0
        while (read < length) read += input.read(payload, read, length - read).also { if (it < 0) throw IOException("ended") }
        return head[0].toInt() to payload
    }

    @Test
    fun `video mode streams the init and segments, encrypted`() {
        val hub = FrameHub()
        val video = VideoHub()
        val s = MirrorServer(hub, video = video, streamPingMs = 200)
        server = s
        val port = s.start(0, InetAddress.getLoopbackAddress())
        val car = TestCar().also { it.pairAndOpen(s.pairing, "127.0.0.1") }
        val frames = encode(3)
        val sets = Fmp4.parameterSets(frames[0])!!
        val init = Fmp4.initSegment(sets, 160, 96)
        video.setInit(sets.codec, init)
        video.publish(Fmp4.mediaSegment(1, 0, 3000, Fmp4.sample(frames[0]), true), true)

        Socket(InetAddress.getLoopbackAddress(), port).use { socket ->
            socket.soTimeout = 5_000
            socket.getOutputStream().write("GET /frames?s=${car.sessionId} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray())
            val input = BufferedInputStream(socket.getInputStream())
            while (true) { // skip the response head
                val line = StringBuilder()
                while (true) { val b = input.read(); if (b == '\n'.code) break; line.append(b.toChar()) }
                if (line.trim().isEmpty()) break
            }
            val (type, sealed) = readRecord(input)
            assertEquals(4, type)
            assertFalse(String(sealed, Charsets.ISO_8859_1).contains("ftyp"), "the init segment crossed in the clear")
            val plain = car.open(byteArrayOf(4), sealed)!!
            val codec = String(plain, 1, plain[0].toInt(), Charsets.ISO_8859_1)
            assertEquals(sets.codec, codec)
            assertContentEquals(init, plain.copyOfRange(1 + plain[0].toInt(), plain.size))

            val (segType, segSealed) = readRecord(input)
            assertEquals(5, segType)
            val segment = car.open(byteArrayOf(5), segSealed)!!
            assertEquals(1, segment[0].toInt(), "flagged as a keyframe")

            video.publish(Fmp4.mediaSegment(2, 3000, 3000, Fmp4.sample(frames[1]), false), false)
            val (nextType, nextSealed) = readRecord(input)
            assertEquals(5, nextType)
            assertEquals(0, car.open(byteArrayOf(5), nextSealed)!![0].toInt())
        }
        val status = String(car.open(Crypto.utf8("status"),
            Socket(InetAddress.getLoopbackAddress(), port).use { sock ->
                sock.getOutputStream().write("GET /status?s=${car.sessionId} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n".toByteArray())
                val all = sock.getInputStream().readBytes()
                val body = String(all, Charsets.ISO_8859_1).indexOf("\r\n\r\n") + 4
                all.copyOfRange(body, all.size)
            })!!)
        assertTrue("\"video\":true" in status, status)
    }
}
