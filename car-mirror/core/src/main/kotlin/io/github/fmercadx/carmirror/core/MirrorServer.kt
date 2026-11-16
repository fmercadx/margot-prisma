package io.github.fmercadx.carmirror.core

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicLong

/** A browser that asked for frames recently, and the address it typed to get here. */
data class Viewer(val remoteAddress: String, val host: String, val lastSeenMs: Long)

/**
 * A small HTTP/1.1 server for the car's browser. No dependencies, so it runs the same on
 * the phone and in JVM tests.
 *
 *   GET  /                          the viewer page, and /crypto.js its vendored crypto
 *   POST /pair/start, /pair/finish  pairing a car (see [Pairing]); /pair/wait?id= long-polls
 *                                   for the user's answer on the phone
 *   POST /session/start, /finish    opening an encrypted session for a paired car
 *   GET  /frames?s=&paused=R        one long response that pushes every new frame as it is made
 *                                   (see [serveFrameStream]): no round trip per frame
 *   GET  /frame?s=&after=N&paused=R long-poll fallback: one record, the newest frame with seq > N,
 *                                   or the pause state when it differs from R, or a ping
 *   GET  /status?s=                 encrypted JSON: frame size, viewers, touch, quality
 *   POST /input                     an encrypted [Input] (a one- or two-finger [Gesture], or
 *                                   Back/Home/Recents), when [control] allows touch
 *
 * Nothing that shows the screen or touches the phone is served without a session (`s`, or
 * X-Car-Mirror-Session for /input), and a session needs a car the user paired on the phone.
 * Everything in a session is encrypted and authenticated, and each message from the car
 * carries a counter the phone has never seen before, so taps can be neither forged nor
 * replayed by someone else on the hotspot. No CORS headers are ever sent, so another web page
 * open in the car can read none of this either.
 */
class MirrorServer(
    private val hub: FrameHub,
    private val hostAllowed: (String) -> Boolean = { true },
    private val control: MirrorControl? = null,
    private val autoQuality: AutoQuality? = null,
    /**
     * Which of the phone's own addresses a connection may arrive on. Connections to any other
     * address are closed unanswered, so the server can listen on all addresses and still
     * serve only the hotspot and the VPN address, never the phone's Wi-Fi or cellular side.
     */
    private val acceptLocal: (InetAddress) -> Boolean = { true },
    /** Paired cars and their sessions. The phone keeps one across restarts of mirroring. */
    val pairing: Pairing = Pairing(MemoryPairingStore()),
    /** In video mode, the encoder's H.264 as fragmented MP4; [hub] then only carries the pause state. */
    private val video: VideoHub? = null,
    private val longPollMs: Long = 10_000,
    private val pairWaitMs: Long = 25_000,
    private val streamPingMs: Long = 2_000,
    private val idleTimeoutMs: Int = 30_000,
    private val maxConnections: Int = 16,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var running = false
    private var pool: ExecutorService? = null
    private val connections: MutableSet<Socket> = ConcurrentHashMap.newKeySet()
    private val viewers = ConcurrentHashMap<String, Viewer>()
    private val framesServed = AtomicLong()
    private val viewerHtml: ByteArray by lazy {
        // Absolute path, so the lookup survives a shrinker renaming this class's package.
        val stream = MirrorServer::class.java.getResourceAsStream("/io/github/fmercadx/carmirror/core/viewer.html")
            ?: error("viewer.html is missing from the build")
        stream.use { it.readBytes() }
    }
    private val cryptoJs: ByteArray by lazy {
        val stream = MirrorServer::class.java.getResourceAsStream("/io/github/fmercadx/carmirror/core/crypto.js")
            ?: error("crypto.js is missing from the build")
        stream.use { it.readBytes() }
    }

    val port: Int get() = serverSocket?.localPort ?: -1

    /**
     * Binds [preferredPort], or the first free port among the nine after it, on [bindAddress]
     * (all addresses when null) and starts serving. Returns the port actually bound.
     */
    fun start(preferredPort: Int, bindAddress: InetAddress? = null): Int {
        check(!running) { "already started" }
        viewerHtml // fail now, not on the first request, if the page is missing
        cryptoJs
        var lastError: IOException? = null
        var bound: ServerSocket? = null
        for (candidate in preferredPort until preferredPort + 10) {
            val socket = ServerSocket()
            try {
                socket.reuseAddress = true
                socket.bind(InetSocketAddress(bindAddress, candidate), 32)
                bound = socket
                break
            } catch (e: IOException) {
                socket.close()
                lastError = e
            }
        }
        val server = bound ?: throw (lastError ?: IOException("no free port from $preferredPort"))
        serverSocket = server
        running = true
        val threads = Executors.newCachedThreadPool { task ->
            Thread(task, "mirror-http").apply { isDaemon = true }
        }
        pool = threads
        threads.execute { acceptLoop(server, threads) }
        return server.localPort
    }

    fun stop() {
        running = false
        closeQuietly(serverSocket)
        connections.forEach { closeQuietly(it) }
        pool?.shutdownNow()
    }

    /** Browsers that fetched a frame within [withinMs], most recent first. */
    fun recentViewers(withinMs: Long = 15_000): List<Viewer> {
        val cutoff = clock() - withinMs
        viewers.values.removeIf { it.lastSeenMs < cutoff }
        return viewers.values.sortedByDescending { it.lastSeenMs }
    }

    val framesSent: Long get() = framesServed.get()

    private fun acceptLoop(server: ServerSocket, threads: ExecutorService) {
        while (running) {
            val client = try {
                server.accept()
            } catch (e: IOException) {
                break
            }
            val local: InetAddress? = client.localAddress
            if (local == null || !acceptLocal(local)) {
                closeQuietly(client)
                continue
            }
            if (connections.size >= maxConnections) {
                try {
                    client.getOutputStream().let { out ->
                        writeHead(out, 503, "text/plain", 0, keepAlive = false)
                        out.flush()
                    }
                } catch (_: IOException) {
                }
                closeQuietly(client)
                continue
            }
            connections.add(client)
            try {
                threads.execute { serve(client) }
            } catch (e: RejectedExecutionException) {
                connections.remove(client)
                closeQuietly(client)
            }
        }
    }

    private fun serve(socket: Socket) {
        try {
            socket.soTimeout = idleTimeoutMs
            socket.tcpNoDelay = true
            val input = BufferedInputStream(socket.getInputStream(), 8 * 1024)
            val output = BufferedOutputStream(socket.getOutputStream(), 64 * 1024)
            while (running) {
                val request = try {
                    Request.read(input) ?: break
                } catch (e: BadRequest) {
                    respond(output, 400, TEXT, e.message.orEmpty().toByteArray(), keepAlive = false)
                    output.flush()
                    break
                }
                val keepAlive = handle(request, socket, input, output)
                output.flush()
                if (!keepAlive) break
            }
        } catch (_: IOException) {
            // The browser went away or the connection sat idle; either way we are done with it.
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            connections.remove(socket)
            closeQuietly(socket)
        }
    }

    /** Writes one response and returns whether the connection may carry another request. */
    private fun handle(request: Request, socket: Socket, input: InputStream, out: OutputStream): Boolean {
        val host = request.headers["host"].orEmpty()
        if (!hostAllowed(host)) {
            respond(out, 403, TEXT, "Open this page with the address shown in the Car Mirror app.".toByteArray(), keepAlive = false)
            return false
        }
        if (request.method == "POST") {
            return when (request.path) {
                "/input" -> handleInput(request, input, out)
                "/pair/start", "/pair/finish", "/session/start", "/session/finish" -> handleHandshake(request, socket, input, out)
                else -> {
                    respond(out, 404, TEXT, "Not found".toByteArray(), keepAlive = false)
                    false
                }
            }
        }
        val headOnly = request.method == "HEAD"
        if (request.method != "GET" && !headOnly) {
            respond(out, 405, TEXT, "Method not allowed".toByteArray(), keepAlive = false, extra = listOf("Allow" to "GET, HEAD, POST"))
            return false
        }
        if (request.hasBody) {
            respond(out, 400, TEXT, "Request bodies are not accepted here".toByteArray(), keepAlive = false)
            return false
        }
        val keepAlive = request.keepAlive
        when (request.path) {
            "/", "/index.html" -> respond(out, 200, "text/html; charset=utf-8", viewerHtml, keepAlive, headOnly, PAGE_HEADERS)
            "/crypto.js" -> respond(out, 200, "text/javascript; charset=utf-8", cryptoJs, keepAlive, headOnly)
            "/pair/wait" -> {
                val state = pairing.await(request.query["id"].orEmpty(),
                    Pairing.State.entries.firstOrNull { it.wire == request.query["state"] }, pairWaitMs)
                respond(out, 200, JSON, "{\"state\":\"${state.wire}\"}".toByteArray(), keepAlive, headOnly)
            }
            "/frame" -> {
                val session = pairing.session(request.query["s"]) ?: return unauthorized(out)
                if (video != null) {
                    respond(out, 409, TEXT, "Video mode needs a browser that can stream".toByteArray(), keepAlive, headOnly)
                } else {
                    serveFrame(request, session, socket, out, keepAlive, headOnly)
                }
            }
            "/frames" -> {
                val session = pairing.session(request.query["s"]) ?: return unauthorized(out)
                if (video != null) serveVideoStream(request, session, video, socket, out) else serveFrameStream(request, session, socket, out)
                return false
            }
            "/status" -> {
                val session = pairing.session(request.query["s"]) ?: return unauthorized(out)
                respond(out, 200, BINARY, session.seal(STATUS_AAD, statusJson().toByteArray()), keepAlive, headOnly)
            }
            "/favicon.ico" -> respond(out, 204, null, EMPTY, keepAlive, headOnly)
            else -> respond(out, 404, TEXT, "Not found".toByteArray(), keepAlive, headOnly)
        }
        return keepAlive
    }

    /** Reads a POST body of at most [max] bytes, or answers 411/413 and returns null. */
    private fun readBody(request: Request, input: InputStream, out: OutputStream, max: Int): ByteArray? {
        val length = request.headers["content-length"]?.toIntOrNull()
        if (length == null || request.headers.containsKey("transfer-encoding")) {
            respond(out, 411, TEXT, "Content-Length required".toByteArray(), keepAlive = false)
            return null
        }
        if (length !in 0..max) {
            respond(out, 413, TEXT, "Request too large".toByteArray(), keepAlive = false)
            return null
        }
        // Not InputStream.readNBytes: Android only has it from API 33, and this app runs on 29.
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) throw IOException("connection closed mid-body")
            read += n
        }
        return body
    }

    private fun unauthorized(out: OutputStream): Boolean {
        respond(out, 401, TEXT, "Pair this screen with the phone first".toByteArray(), keepAlive = false)
        return false
    }

    /** Pairing and session handshakes: small form bodies in, public values out as JSON. */
    private fun handleHandshake(request: Request, socket: Socket, input: InputStream, out: OutputStream): Boolean {
        val keepAlive = request.keepAlive
        val body = readBody(request, input, out, MAX_HANDSHAKE_BYTES) ?: return false
        val form = Input.fields(String(body, Charsets.UTF_8))
        fun json(text: String): Boolean {
            respond(out, 200, JSON, text.toByteArray(), keepAlive)
            return keepAlive
        }
        fun refuse(status: Int, why: String): Boolean {
            respond(out, status, TEXT, why.toByteArray(), keepAlive)
            return keepAlive
        }
        val remote = socket.inetAddress?.hostAddress.orEmpty()
        when (request.path) {
            "/pair/start" -> {
                val commitment = Crypto.unb64(form["c"]) ?: return refuse(400, "Malformed pairing request")
                return when (val started = pairing.start(commitment, remote)) {
                    is Pairing.Start.Started -> json("{\"id\":\"${started.id}\",\"pub\":\"${Crypto.b64(started.phoneKey)}\"}")
                    Pairing.Start.Refused -> refuse(429, "Too many pairing requests; try again shortly")
                }
            }
            "/pair/finish" -> {
                val key = Crypto.unb64(form["pub"]) ?: return refuse(400, "Malformed pairing request")
                val state = pairing.finish(form["id"].orEmpty(), key, remote) ?: return refuse(400, "Pairing request rejected")
                return json("{\"state\":\"${state.wire}\"}")
            }
            "/session/start" -> {
                val key = Crypto.unb64(form["pub"]) ?: return refuse(400, "Malformed session request")
                val challenge = pairing.challenge(form["pair"].orEmpty(), key) ?: return refuse(404, "This screen isn't paired")
                return json("{\"pub\":\"${Crypto.b64(challenge.phoneKey)}\",\"nonce\":\"${Crypto.b64(challenge.nonce)}\"}")
            }
            else -> {
                val key = Crypto.unb64(form["pub"]) ?: return refuse(400, "Malformed session request")
                val proof = Crypto.unb64(form["proof"]) ?: return refuse(400, "Malformed session request")
                val session = pairing.open(form["pair"].orEmpty(), key, proof) ?: return refuse(403, "Session refused")
                return json("{\"session\":\"${session.id}\"}")
            }
        }
    }

    private fun handleInput(request: Request, input: InputStream, out: OutputStream): Boolean {
        val keepAlive = request.keepAlive
        val body = readBody(request, input, out, MAX_INPUT_BYTES) ?: return false

        fun refuse(status: Int, why: String): Boolean {
            respond(out, status, TEXT, why.toByteArray(), keepAlive)
            return keepAlive
        }
        val session = pairing.session(request.headers["x-car-mirror-session"]) ?: return refuse(401, "No session")
        // Altered, from another session, or replayed: dropped without a hint which.
        val text = session.openFromCar(INPUT_AAD, body) ?: return refuse(403, "Refused")
        val phone = control ?: return refuse(404, "Touch control is not available")
        if (hub.pausedReason != null) return refuse(409, "Mirroring is paused")
        if (!phone.touchAvailable) return refuse(409, "Touch control is off on the phone")
        val done = when (val input = Input.parse(String(text, Charsets.UTF_8)) ?: return refuse(400, "Malformed input")) {
            is Gesture -> phone.perform(input)
            is GlobalAction -> phone.perform(input)
        }
        if (!done) return refuse(409, "The phone could not perform that")
        respond(out, 204, null, EMPTY, keepAlive)
        return keepAlive
    }

    private fun serveFrame(request: Request, session: Session, socket: Socket, out: OutputStream, keepAlive: Boolean, headOnly: Boolean) {
        noteViewer(socket, request)
        if (hub.isClosed) {
            respond(out, 503, TEXT, "Mirroring stopped".toByteArray(), keepAlive, headOnly)
            return
        }
        val after = request.query["after"]?.toLongOrNull() ?: 0L
        val viewerPaused = request.query["paused"]?.let { decode(it) }?.ifEmpty { null }
        val update = hub.awaitUpdate(after, viewerPaused, longPollMs)
        val record = java.io.ByteArrayOutputStream()
        val frame = update?.frame
        when {
            update == null -> writeRecord(record, session, RECORD_PING)
            frame == null -> writeRecord(record, session, RECORD_STATE, update.paused.orEmpty().toByteArray(Charsets.UTF_8))
            else -> writeFrameRecord(record, session, frame)
        }
        respond(out, 200, BINARY, record.toByteArray(), keepAlive, headOnly)
        noteViewer(socket, request)
        if (frame != null && !headOnly) {
            framesServed.incrementAndGet()
            // Frames between the one the viewer last drew and this one were never drawn.
            val skipped = if (after in 1 until frame.seq) (frame.seq - after - 1).toInt() else 0
            autoQuality?.onFrameServed(skipped)
        }
    }

    /**
     * Pushes frames over one response for as long as the car keeps it open. Asking for each
     * frame separately costs a full round trip over the hotspot per frame, which on a phone
     * hotspot (often 50 to 100 ms) caps the picture at 10 to 15 fps however small the frames.
     *
     * The body is a series of records, each a type byte, a 4-byte big-endian length and a
     * payload sealed for the session ([Session.seal], with the type byte as associated data),
     * whose plaintext is:
     *
     *   1  frame  seq (8 bytes), width (2), height (2), then the JPEG
     *   2  state  the pause reason in UTF-8, empty when live
     *   3  ping   nothing; sent when nothing else has been, so a dead car is noticed
     *
     * The socket's send buffer is kept small. When the link can't keep up, a write blocks,
     * frames made meanwhile are skipped, and the next write is the newest frame: the picture
     * drops frames instead of falling behind. Skipped frames also tell [autoQuality] to shrink
     * the JPEGs.
     */
    private fun serveFrameStream(request: Request, session: Session, socket: Socket, out: OutputStream) {
        noteViewer(socket, request)
        try {
            socket.sendBufferSize = STREAM_SEND_BUFFER
        } catch (_: IOException) {
        }
        val head = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: application/octet-stream\r\n" +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.flush()
        if (request.method == "HEAD") return

        var seen = 0L
        var viewerPaused: String? = request.query["paused"]?.let { decode(it) }?.ifEmpty { null }
        // Frames made during a pause were withheld on purpose; they don't mean the car fell behind.
        var countSkips = false
        // Ends when the session does: the car was forgotten, or its session dropped.
        while (running && !hub.isClosed && pairing.session(session.id) != null) {
            val update = hub.awaitUpdate(seen, viewerPaused, streamPingMs)
            when {
                update == null -> writeRecord(out, session, RECORD_PING)
                update.frame == null -> {
                    viewerPaused = update.paused
                    countSkips = false
                    writeRecord(out, session, RECORD_STATE, viewerPaused.orEmpty().toByteArray(Charsets.UTF_8))
                }
                else -> {
                    val frame = update.frame
                    val skipped = if (countSkips && seen in 1 until frame.seq) (frame.seq - seen - 1).toInt() else 0
                    countSkips = true
                    writeFrameRecord(out, session, frame)
                    seen = frame.seq
                    framesServed.incrementAndGet()
                    autoQuality?.onFrameServed(skipped)
                }
            }
            out.flush()
            noteViewer(socket, request)
        }
    }

    /**
     * The video-mode stream: the same records and encryption as [serveFrameStream], with
     *
     *   4  init     codec name length (1 byte), the codec name (e.g. avc1.640028), init segment
     *   5  segment  keyframe flag (1 byte), then one frame as a media segment (moof + mdat)
     *
     * in place of JPEG frames. Video frames can't be skipped one by one, since each depends on
     * the last; a car that falls behind catches up at the next keyframe (see [VideoHub]).
     */
    private fun serveVideoStream(request: Request, session: Session, video: VideoHub, socket: Socket, out: OutputStream) {
        noteViewer(socket, request)
        try {
            socket.sendBufferSize = STREAM_SEND_BUFFER
        } catch (_: IOException) {
        }
        val head = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: application/octet-stream\r\n" +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.flush()
        if (request.method == "HEAD") return

        var generation = 0
        var after = 0L
        var viewerPaused: String? = request.query["paused"]?.let { decode(it) }?.ifEmpty { null }
        while (running && !video.isClosed && pairing.session(session.id) != null) {
            val update = video.await(generation, after, viewerPaused, streamPingMs)
            when {
                update == null -> writeRecord(out, session, RECORD_PING)
                update.paused != viewerPaused -> {
                    viewerPaused = update.paused
                    if (viewerPaused != null) generation = 0 // after the pause: a fresh init and keyframe
                    writeRecord(out, session, RECORD_STATE, viewerPaused.orEmpty().toByteArray(Charsets.UTF_8))
                }
                else -> {
                    update.init?.let {
                        val codec = it.codec.toByteArray(Charsets.ISO_8859_1)
                        writeRecord(out, session, RECORD_INIT, byteArrayOf(codec.size.toByte()), codec, it.segment)
                        generation = it.generation
                    }
                    for (segment in update.segments) {
                        writeRecord(out, session, RECORD_SEGMENT, byteArrayOf(if (segment.keyframe) 1 else 0), segment.bytes)
                        after = segment.index
                        framesServed.incrementAndGet()
                    }
                }
            }
            out.flush()
            noteViewer(socket, request)
        }
    }

    private fun writeRecord(out: OutputStream, session: Session, type: Int, vararg plaintext: ByteArray) {
        val sealed = session.seal(byteArrayOf(type.toByte()), *plaintext)
        val length = sealed.size
        out.write(byteArrayOf(type.toByte(), (length ushr 24).toByte(), (length ushr 16).toByte(),
            (length ushr 8).toByte(), length.toByte()))
        out.write(sealed)
    }

    private fun writeFrameRecord(out: OutputStream, session: Session, frame: Frame) {
        val header = ByteArray(12)
        Crypto.putLong(header, 0, frame.seq)
        header[8] = (frame.width shr 8).toByte()
        header[9] = frame.width.toByte()
        header[10] = (frame.height shr 8).toByte()
        header[11] = frame.height.toByte()
        writeRecord(out, session, RECORD_FRAME, header, frame.jpeg)
    }

    private fun noteViewer(socket: Socket, request: Request) {
        val remote = socket.inetAddress?.hostAddress ?: return
        viewers[remote] = Viewer(remote, request.headers["host"].orEmpty(), clock())
    }

    private fun statusJson(): String {
        val frame = hub.latest()
        val paused = hub.pausedReason
        return "{\"seq\":${frame?.seq ?: 0},\"width\":${frame?.width ?: 0},\"height\":${frame?.height ?: 0}," +
            "\"framesSent\":${framesServed.get()},\"viewers\":${recentViewers().size}," +
            "\"paused\":${if (paused == null) "null" else "\"$paused\""}," +
            "\"touch\":${control?.touchAvailable == true}," +
            "\"jpegQuality\":${autoQuality?.current ?: 0},\"video\":${video != null}}"
    }

    private fun respond(
        out: OutputStream,
        status: Int,
        type: String?,
        body: ByteArray,
        keepAlive: Boolean,
        headOnly: Boolean = false,
        extra: List<Pair<String, String>> = emptyList(),
    ) {
        writeHead(out, status, type, body.size, keepAlive, extra)
        if (!headOnly && status != 204) out.write(body)
    }

    private fun writeHead(
        out: OutputStream,
        status: Int,
        type: String?,
        length: Int,
        keepAlive: Boolean,
        extra: List<Pair<String, String>> = emptyList(),
    ) {
        val head = StringBuilder(256)
        head.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n")
        if (type != null) head.append("Content-Type: ").append(type).append("\r\n")
        if (status != 204) head.append("Content-Length: ").append(length).append("\r\n")
        head.append("Cache-Control: no-store\r\n")
        head.append("X-Content-Type-Options: nosniff\r\n")
        head.append("Connection: ").append(if (keepAlive) "keep-alive" else "close").append("\r\n")
        for ((name, value) in extra) head.append(name).append(": ").append(value).append("\r\n")
        head.append("\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
    }

    private companion object {
        const val TEXT = "text/plain; charset=utf-8"
        const val JSON = "application/json"
        const val BINARY = "application/octet-stream"
        const val MAX_INPUT_BYTES = 4 * 1024
        const val MAX_HANDSHAKE_BYTES = 1024
        const val RECORD_FRAME = 1
        const val RECORD_STATE = 2
        const val RECORD_PING = 3
        const val RECORD_INIT = 4
        const val RECORD_SEGMENT = 5
        val STATUS_AAD = Crypto.utf8("status")
        val INPUT_AAD = Crypto.utf8("input")

        /** About one frame: enough to keep the link busy, too little to build up a backlog. */
        const val STREAM_SEND_BUFFER = 64 * 1024
        val EMPTY = ByteArray(0)

        /** The page loads nothing from anywhere but the phone. */
        val PAGE_HEADERS = listOf(
            "Content-Security-Policy" to "default-src 'none'; script-src 'self' 'unsafe-inline'; " +
                "style-src 'unsafe-inline'; img-src 'self' blob:; media-src blob:; connect-src 'self'",
            "Referrer-Policy" to "no-referrer",
        )

        fun decode(value: String): String = try {
            URLDecoder.decode(value, "UTF-8")
        } catch (_: IllegalArgumentException) {
            value
        }

        fun reason(status: Int) = when (status) {
            200 -> "OK"
            204 -> "No Content"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            409 -> "Conflict"
            411 -> "Length Required"
            413 -> "Payload Too Large"
            429 -> "Too Many Requests"
            503 -> "Service Unavailable"
            else -> "Status"
        }

        fun closeQuietly(c: Closeable?) {
            try {
                c?.close()
            } catch (_: IOException) {
            }
        }
    }
}

internal class BadRequest(message: String) : Exception(message)

internal class Request(
    val method: String,
    val path: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    private val version: String,
) {
    val keepAlive: Boolean
        get() {
            val connection = headers["connection"]?.lowercase()
            return if (version == "HTTP/1.0") connection == "keep-alive" else connection != "close"
        }

    val hasBody: Boolean
        get() = (headers["content-length"]?.toLongOrNull() ?: 0L) > 0L || headers.containsKey("transfer-encoding")

    companion object {
        private const val MAX_LINE = 8 * 1024
        private const val MAX_HEAD = 32 * 1024

        /** First byte of a TLS handshake record. */
        private const val TLS_HANDSHAKE = 0x16

        /** Reads one request head. Returns null if the connection closed cleanly first. */
        fun read(input: InputStream): Request? {
            // A browser that tries HTTPS first opens with a TLS handshake, which has no line
            // break for readLine to find. Hanging up at once lets it fall back to plain HTTP
            // straight away instead of after the idle timeout.
            if (input.markSupported()) {
                input.mark(1)
                if (input.read() == TLS_HANDSHAKE) throw IOException("TLS handshake on a plain HTTP port")
                input.reset()
            }
            var line: String
            var blanks = 0
            do {
                line = readLine(input) ?: return null
                // Tolerate a stray CRLF between keep-alive requests, but not an endless stream of them.
                if (line.isEmpty() && ++blanks > 4) throw BadRequest("empty request")
            } while (line.isEmpty())
            val parts = line.split(' ')
            if (parts.size != 3 || !parts[2].startsWith("HTTP/1.")) throw BadRequest("malformed request line")
            val headers = HashMap<String, String>()
            var size = line.length
            while (true) {
                val header = readLine(input) ?: throw IOException("connection closed mid-request")
                if (header.isEmpty()) break
                size += header.length
                if (size > MAX_HEAD) throw BadRequest("request head too large")
                val colon = header.indexOf(':')
                if (colon <= 0) throw BadRequest("malformed header")
                headers[header.substring(0, colon).trim().lowercase()] = header.substring(colon + 1).trim()
            }
            val target = parts[1]
            val q = target.indexOf('?')
            val path = if (q < 0) target else target.substring(0, q)
            val query = if (q < 0) emptyMap() else parseQuery(target.substring(q + 1))
            return Request(parts[0], path, query, headers, parts[2])
        }

        private fun parseQuery(raw: String): Map<String, String> =
            raw.split('&').filter { it.isNotEmpty() }.associate { pair ->
                val eq = pair.indexOf('=')
                if (eq < 0) pair to "" else pair.substring(0, eq) to pair.substring(eq + 1)
            }

        /** One line without its CR LF; null on end of stream before any byte. */
        private fun readLine(input: InputStream): String? {
            val bytes = StringBuilder()
            while (true) {
                val b = input.read()
                if (b < 0) {
                    if (bytes.isEmpty()) return null
                    throw IOException("connection closed mid-line")
                }
                if (b == '\n'.code) break
                if (bytes.length >= MAX_LINE) throw BadRequest("line too long")
                bytes.append(b.toChar())
            }
            if (bytes.isNotEmpty() && bytes[bytes.length - 1] == '\r') bytes.setLength(bytes.length - 1)
            return bytes.toString()
        }
    }
}
