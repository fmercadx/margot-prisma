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
 *   GET /                 the viewer page
 *   GET /frame?after=N    long-poll: the newest JPEG with seq > N, or 204 after [longPollMs]
 *   GET /stream.mjpeg     multipart MJPEG, for browsers without fetch/createImageBitmap
 *   GET /status           JSON, for debugging
 */
class MirrorServer(
    private val hub: FrameHub,
    private val hostAllowed: (String) -> Boolean = { true },
    private val longPollMs: Long = 10_000,
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

    val port: Int get() = serverSocket?.localPort ?: -1

    /**
     * Binds [preferredPort], or the first free port among the nine after it, on [bindAddress]
     * (all addresses when null) and starts serving. Returns the port actually bound.
     */
    fun start(preferredPort: Int, bindAddress: InetAddress? = null): Int {
        check(!running) { "already started" }
        viewerHtml // fail now, not on the first request, if the page is missing
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
                    respond(output, 400, "text/plain; charset=utf-8", e.message.orEmpty().toByteArray(), keepAlive = false)
                    output.flush()
                    break
                }
                val keepAlive = handle(request, socket, output)
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
    private fun handle(request: Request, socket: Socket, out: OutputStream): Boolean {
        val headOnly = request.method == "HEAD"
        if (request.method != "GET" && !headOnly) {
            respond(out, 405, "text/plain; charset=utf-8", "Only GET is supported".toByteArray(),
                keepAlive = false, extra = listOf("Allow" to "GET, HEAD"))
            return false
        }
        if (request.hasBody) {
            respond(out, 400, "text/plain; charset=utf-8", "Request bodies are not accepted".toByteArray(), keepAlive = false)
            return false
        }
        val host = request.headers["host"].orEmpty()
        if (!hostAllowed(host)) {
            respond(out, 403, "text/plain; charset=utf-8",
                "Open this page with the address shown in the Car Mirror app.".toByteArray(), keepAlive = false)
            return false
        }
        val keepAlive = request.keepAlive
        when (request.path) {
            "/", "/index.html" -> respond(out, 200, "text/html; charset=utf-8", viewerHtml, keepAlive, headOnly, PAGE_HEADERS)
            "/frame" -> serveFrame(request, socket, out, keepAlive, headOnly)
            "/stream.mjpeg" -> {
                serveMjpeg(request, socket, out)
                return false
            }
            "/status" -> respond(out, 200, "application/json", statusJson().toByteArray(), keepAlive, headOnly)
            "/favicon.ico" -> respond(out, 204, null, EMPTY, keepAlive, headOnly)
            else -> respond(out, 404, "text/plain; charset=utf-8", "Not found".toByteArray(), keepAlive, headOnly)
        }
        return keepAlive
    }

    private fun serveFrame(request: Request, socket: Socket, out: OutputStream, keepAlive: Boolean, headOnly: Boolean) {
        noteViewer(socket, request)
        if (hub.isClosed) {
            respond(out, 503, "text/plain; charset=utf-8", "Mirroring stopped".toByteArray(), keepAlive, headOnly)
            return
        }
        val after = request.query["after"]?.toLongOrNull() ?: 0L
        val frame = hub.awaitAfter(after, longPollMs)
        if (frame == null) {
            respond(out, 204, null, EMPTY, keepAlive, headOnly)
            return
        }
        respond(out, 200, "image/jpeg", frame.jpeg, keepAlive, headOnly, listOf(
            "X-Frame-Seq" to frame.seq.toString(),
            "X-Frame-Width" to frame.width.toString(),
            "X-Frame-Height" to frame.height.toString(),
        ))
        noteViewer(socket, request)
        if (!headOnly) framesServed.incrementAndGet()
    }

    private fun serveMjpeg(request: Request, socket: Socket, out: OutputStream) {
        noteViewer(socket, request)
        val head = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: multipart/x-mixed-replace; boundary=$BOUNDARY\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.flush()
        if (request.method == "HEAD") return
        var seen = 0L
        while (running && !hub.isClosed) {
            // Re-send the current frame every few seconds even when nothing changed, so a
            // browser that vanished without closing the connection is noticed on write.
            val frame = hub.awaitAfter(seen, 3_000) ?: hub.latest() ?: continue
            val part = "--$BOUNDARY\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.size}\r\n\r\n"
            out.write(part.toByteArray(Charsets.ISO_8859_1))
            out.write(frame.jpeg)
            out.write(CRLF)
            out.flush()
            seen = frame.seq
            framesServed.incrementAndGet()
            noteViewer(socket, request)
        }
    }

    private fun noteViewer(socket: Socket, request: Request) {
        val remote = socket.inetAddress?.hostAddress ?: return
        viewers[remote] = Viewer(remote, request.headers["host"].orEmpty(), clock())
    }

    private fun statusJson(): String {
        val frame = hub.latest()
        return "{\"seq\":${frame?.seq ?: 0},\"width\":${frame?.width ?: 0},\"height\":${frame?.height ?: 0}," +
            "\"framesSent\":${framesServed.get()},\"viewers\":${recentViewers().size}}"
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
        const val BOUNDARY = "carmirrorframe"
        val CRLF = "\r\n".toByteArray(Charsets.ISO_8859_1)
        val EMPTY = ByteArray(0)

        /** The page loads nothing from anywhere but the phone. */
        val PAGE_HEADERS = listOf(
            "Content-Security-Policy" to "default-src 'none'; script-src 'unsafe-inline'; " +
                "style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'",
            "Referrer-Policy" to "no-referrer",
        )

        fun reason(status: Int) = when (status) {
            200 -> "OK"
            204 -> "No Content"
            400 -> "Bad Request"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
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
