package io.github.fmercadx.carmirror.core

import java.util.concurrent.atomic.AtomicLong

/** Where paired cars are remembered: the app's private storage on the phone, memory in tests. */
interface PairingStore {
    /** Pair id to pair key, for every car the user has allowed. */
    fun load(): Map<String, ByteArray>
    fun save(pairs: Map<String, ByteArray>)
}

class MemoryPairingStore : PairingStore {
    @Volatile private var pairs: Map<String, ByteArray> = emptyMap()
    override fun load() = pairs
    override fun save(pairs: Map<String, ByteArray>) {
        this.pairs = HashMap(pairs)
    }
}

/**
 * Who may see the screen and tap on the phone: cars the user has paired, each over its own
 * encrypted session.
 *
 * Anyone on the phone's hotspot can reach the server, and the page travels over plain http
 * (the car's browser can't be given a certificate for a hotspot address). So the server
 * shows nothing to a car until the user has paired it on the phone, and everything after
 * that is encrypted, so that someone else on the hotspot can neither watch nor tap.
 *
 * **Pairing**, once per car (per address the car uses). Both sides make an X25519 key pair.
 *  1. The car sends a commitment, SHA-256 of its public key, and gets the phone's public key.
 *  2. The car reveals its public key; the phone checks it against the commitment.
 *  3. Both show a 6-digit code computed from the two public keys, and the user taps Allow on
 *     the phone if the car shows the same one.
 * Committing first means a device in the middle has to choose its keys before seeing the
 * other side's, so it can't search for keys that make the two codes match: it gets one
 * guess in a million per attempt, and every attempt asks the user. Approved, both derive a
 * pair key from the shared secret; it never crosses the network. The phone keeps it in its
 * [PairingStore], the car's browser in its local storage.
 *
 * **Sessions**, once per page load. The car sends a fresh public key; the phone answers with
 * its own and a random nonce; the car proves it holds the pair key with an HMAC over both
 * keys and the nonce. Keys for each direction come from HKDF over the new shared secret and
 * the pair key, so a recording of one session can't be decrypted later, and nobody without
 * the pair key can open one. Every message is ChaCha20-Poly1305 with a counter for its nonce;
 * the phone refuses a counter it has already seen, so a captured tap can't be replayed.
 */
class Pairing(
    private val store: PairingStore,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Fresh X25519 key pairs and random bytes; replaceable only so tests can use known values. */
    private val newKeyPair: () -> Crypto.KeyPair = Crypto::keyPair,
    private val randomBytes: (Int) -> ByteArray = Crypto::randomBytes,
) {
    /** A car asking to be paired: shown on the phone with the code the car is showing. */
    class Request(val id: String, val code: String, val remoteAddress: String)

    enum class State(val wire: String) {
        STARTED("started"), WAITING("waiting"), APPROVED("approved"), DENIED("denied"), EXPIRED("expired")
    }

    /** Hears about pairing requests, to ask the user on the phone. */
    interface Listener {
        fun onRequest(request: Request)

        /** The request was answered or expired: stop asking. */
        fun onSettled(id: String)
    }

    @Volatile var listener: Listener? = null

    private class Pending(val id: String, val remote: String, val commitment: ByteArray, val keys: Crypto.KeyPair, val createdAt: Long) {
        var state = State.STARTED
        var code = ""
        var pairKey: ByteArray? = null
        var waitingSince = 0L
    }

    private class Outstanding(val pairId: String, val carKey: ByteArray, val keys: Crypto.KeyPair, val nonce: ByteArray, val createdAt: Long)

    private val lock = Object()
    private val pending = LinkedHashMap<String, Pending>()
    private val cooldownUntil = HashMap<String, Long>()
    private val pairs = HashMap(store.load())
    private val challenges = LinkedHashMap<String, Outstanding>()
    private val sessions = LinkedHashMap<String, Session>()

    val pairedCount: Int get() = synchronized(lock) { pairs.size }

    // ---- Pairing ----

    sealed class Start {
        class Started(val id: String, val phoneKey: ByteArray) : Start()
        /** Too many requests at once, or this address was just turned down. */
        object Refused : Start()
    }

    fun start(commitment: ByteArray, remote: String): Start {
        if (commitment.size != 32) return Start.Refused
        val settled = ArrayList<String>()
        val result = synchronized(lock) {
            prune(settled)
            val now = clock()
            if ((cooldownUntil[remote] ?: 0L) > now) return@synchronized Start.Refused
            // Answered requests stay a while so the car can collect the answer; only open ones count.
            val open = pending.values.filter { it.state == State.STARTED || it.state == State.WAITING }
            if (open.size >= MAX_PENDING || open.count { it.remote == remote } >= MAX_PENDING_PER_ADDRESS) {
                return@synchronized Start.Refused
            }
            val p = Pending(Crypto.b64(randomBytes(16)), remote, commitment, newKeyPair(), now)
            pending[p.id] = p
            Start.Started(p.id, p.keys.publicKey)
        }
        notifySettled(settled)
        return result
    }

    /**
     * The car reveals its public key. Returns [State.WAITING] once the user is being asked,
     * null if there is no such request or the key doesn't match the commitment.
     */
    fun finish(id: String, carKey: ByteArray, remote: String): State? {
        val settled = ArrayList<String>()
        var request: Request? = null
        val result = synchronized(lock) {
            prune(settled)
            val p = pending[id] ?: return@synchronized null
            if (p.state != State.STARTED || p.remote != remote) return@synchronized p.state.takeIf { it != State.STARTED }
            if (carKey.size != 32 || !Crypto.equal(Crypto.sha256(COMMIT, carKey), p.commitment)) {
                pending.remove(id)
                return@synchronized null
            }
            val shared = Crypto.sharedSecret(p.keys.secretKey, carKey)
            if (shared == null) {
                pending.remove(id)
                return@synchronized null
            }
            val phoneKey = p.keys.publicKey
            p.code = code(phoneKey, carKey)
            p.pairKey = Crypto.hkdf(shared, phoneKey + carKey, PAIR_KEY_INFO, 32)
            p.state = State.WAITING
            p.waitingSince = clock()
            request = Request(p.id, p.code, p.remote)
            lock.notifyAll()
            State.WAITING
        }
        notifySettled(settled)
        request?.let { r -> listener?.onRequest(r) }
        return result
    }

    /** Waits up to [timeoutMs] for request [id] to leave state [current]. */
    fun await(id: String, current: State?, timeoutMs: Long): State {
        val settled = ArrayList<String>()
        val deadline = clock() + timeoutMs
        var state: State
        synchronized(lock) {
            while (true) {
                prune(settled)
                state = pending[id]?.state ?: State.EXPIRED
                val left = deadline - clock()
                if (state != current || left <= 0) break
                lock.wait(minOf(left, 1_000))
            }
        }
        notifySettled(settled)
        return state
    }

    /** The user tapped Allow on the phone: remember the car. */
    fun approve(id: String): Boolean {
        val ok = synchronized(lock) {
            val p = pending[id]
            if (p == null || p.state != State.WAITING) return@synchronized false
            p.state = State.APPROVED
            pairs[p.id] = p.pairKey!!
            store.save(pairs)
            lock.notifyAll()
            true
        }
        if (ok) listener?.onSettled(id)
        return ok
    }

    /** The user tapped Deny: that address may not ask again for a while. */
    fun deny(id: String): Boolean {
        val ok = synchronized(lock) {
            val p = pending[id]
            if (p == null || p.state != State.WAITING) return@synchronized false
            p.state = State.DENIED
            cooldownUntil[p.remote] = clock() + DENY_COOLDOWN_MS
            lock.notifyAll()
            true
        }
        if (ok) listener?.onSettled(id)
        return ok
    }

    /** Requests the user is being asked about right now. */
    fun waiting(): List<Request> {
        val settled = ArrayList<String>()
        val result = synchronized(lock) {
            prune(settled)
            pending.values.filter { it.state == State.WAITING }.map { Request(it.id, it.code, it.remote) }
        }
        notifySettled(settled)
        return result
    }

    /** Forgets every paired car and ends every session; each car has to pair again. */
    fun forgetAll() {
        synchronized(lock) {
            pairs.clear()
            store.save(pairs)
            challenges.clear()
            sessions.clear()
        }
    }

    // ---- Sessions ----

    class Challenge(val phoneKey: ByteArray, val nonce: ByteArray)

    /** Starts a session for paired car [pairId]. Null if the phone doesn't know that car. */
    fun challenge(pairId: String, carKey: ByteArray): Challenge? {
        if (carKey.size != 32) return null
        synchronized(lock) {
            if (!pairs.containsKey(pairId)) return null
            val now = clock()
            challenges.values.removeIf { now - it.createdAt > CHALLENGE_MS }
            while (challenges.size >= MAX_CHALLENGES) challenges.remove(challenges.keys.first())
            val c = Outstanding(pairId, carKey, newKeyPair(), randomBytes(16), now)
            challenges[pairId + "/" + Crypto.b64(carKey)] = c
            return Challenge(c.keys.publicKey, c.nonce)
        }
    }

    /** Completes a session if [proof] shows the car holds the pair key. Each challenge works once. */
    fun open(pairId: String, carKey: ByteArray, proof: ByteArray): Session? {
        synchronized(lock) {
            val c = challenges.remove(pairId + "/" + Crypto.b64(carKey)) ?: return null
            val pairKey = pairs[pairId] ?: return null
            if (clock() - c.createdAt > CHALLENGE_MS) return null
            val phoneKey = c.keys.publicKey
            val expected = Crypto.hmac(pairKey, PROOF, c.nonce, carKey, phoneKey)
            if (!Crypto.equal(expected, proof)) return null
            val shared = Crypto.sharedSecret(c.keys.secretKey, carKey) ?: return null
            val keys = Crypto.hkdf(shared + pairKey, c.nonce, SESSION_INFO + carKey + phoneKey, 64)
            val session = Session(Crypto.b64(randomBytes(16)), pairId, keys.copyOfRange(0, 32), keys.copyOfRange(32, 64), clock())
            while (sessions.size >= MAX_SESSIONS) sessions.remove(sessions.keys.first())
            sessions[session.id] = session
            return session
        }
    }

    /** The live session [id], or null once it ended, was dropped, or its car was forgotten. */
    fun session(id: String?): Session? {
        if (id == null) return null
        synchronized(lock) {
            val s = sessions[id] ?: return null
            if (!pairs.containsKey(s.pairId)) {
                sessions.remove(id)
                return null
            }
            // Most recently used last, so the oldest idle session is the one dropped when full.
            sessions.remove(id)
            sessions[id] = s
            return s
        }
    }

    private fun prune(settled: MutableList<String>) {
        val now = clock()
        val iterator = pending.values.iterator()
        while (iterator.hasNext()) {
            val p = iterator.next()
            val expired = when (p.state) {
                State.STARTED -> now - p.createdAt > START_MS
                State.WAITING -> now - p.waitingSince > WAITING_MS
                else -> now - p.createdAt > START_MS + WAITING_MS + KEEP_ANSWER_MS
            }
            if (expired) {
                if (p.state == State.WAITING) settled += p.id
                iterator.remove()
            }
        }
        cooldownUntil.values.removeIf { it <= now }
        if (settled.isNotEmpty()) lock.notifyAll()
    }

    private fun notifySettled(ids: List<String>) {
        val l = listener ?: return
        ids.forEach { l.onSettled(it) }
    }

    companion object {
        val COMMIT = Crypto.utf8("car-mirror commit v1")
        val CODE = Crypto.utf8("car-mirror code v1")
        val PAIR_KEY_INFO = Crypto.utf8("car-mirror pair key v1")
        val PROOF = Crypto.utf8("car-mirror proof v1")
        val SESSION_INFO = Crypto.utf8("car-mirror session v1")

        /** The 6 digits both screens show: from SHA-256 of both public keys, phone's first. */
        fun code(phoneKey: ByteArray, carKey: ByteArray): String {
            val h = Crypto.sha256(CODE, phoneKey, carKey)
            val n = ((h[0].toLong() and 0xff) shl 24) or ((h[1].toLong() and 0xff) shl 16) or
                ((h[2].toLong() and 0xff) shl 8) or (h[3].toLong() and 0xff)
            return (n % 1_000_000).toString().padStart(6, '0')
        }

        const val START_MS = 60_000L
        const val WAITING_MS = 120_000L
        const val KEEP_ANSWER_MS = 60_000L
        const val DENY_COOLDOWN_MS = 30_000L
        const val CHALLENGE_MS = 30_000L
        const val MAX_PENDING = 8
        const val MAX_PENDING_PER_ADDRESS = 2
        const val MAX_CHALLENGES = 16
        const val MAX_SESSIONS = 8
    }
}

/**
 * One car's encrypted session: a key for each direction, and message counters for nonces.
 * Messages are the 8-byte counter, then ChaCha20-Poly1305 ciphertext and tag.
 */
class Session internal constructor(
    val id: String,
    val pairId: String,
    private val toCar: ByteArray,
    private val fromCar: ByteArray,
    val createdAt: Long,
) {
    private val sent = AtomicLong()
    private var lastReceived = 0L

    /** Encrypts a message for the car. [aad] names what it is, so one kind can't pass for another. */
    fun seal(aad: ByteArray, vararg plaintext: ByteArray): ByteArray {
        val counter = sent.incrementAndGet()
        val header = ByteArray(8).also { Crypto.putLong(it, 0, counter) }
        return header + Crypto.seal(toCar, Crypto.nonce(counter), aad, *plaintext)
    }

    /**
     * Decrypts a message from the car. Null if it was altered, isn't from this session, or
     * carries a counter no higher than the last one accepted: a replayed message is refused.
     */
    @Synchronized
    fun openFromCar(aad: ByteArray, message: ByteArray): ByteArray? {
        if (message.size < 8 + 16) return null
        val counter = Crypto.getLong(message, 0)
        if (counter <= lastReceived) return null
        val plaintext = Crypto.open(fromCar, Crypto.nonce(counter), aad, message, 8) ?: return null
        lastReceived = counter
        return plaintext
    }
}
