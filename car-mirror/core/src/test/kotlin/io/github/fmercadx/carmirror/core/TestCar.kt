package io.github.fmercadx.carmirror.core

/**
 * The car's side of pairing and the session, written from the protocol description in
 * [Pairing] the same way viewer.html does it, so tests exercise the phone against an
 * independent implementation rather than against itself.
 */
class TestCar(private val newKeyPair: () -> Crypto.KeyPair = Crypto::keyPair) {
    private lateinit var pairingKeys: Crypto.KeyPair
    private lateinit var sessionKeys: Crypto.KeyPair
    var pairId: String? = null
    var pairKey: ByteArray? = null
    var sessionId: String? = null
    private var toCar = ByteArray(0)
    private var fromCar = ByteArray(0)
    private var sent = 0L

    val publicKey: ByteArray get() = pairingKeys.publicKey

    /** Step 1: a fresh key pair, and the commitment to send first. */
    fun commitment(): ByteArray {
        pairingKeys = newKeyPair()
        return Crypto.sha256(Crypto.utf8("car-mirror commit v1"), pairingKeys.publicKey)
    }

    /** The code this car shows, given the phone's public key. */
    fun code(phoneKey: ByteArray): String = Pairing.code(phoneKey, pairingKeys.publicKey)

    /** After the user allowed it: derive the pair key the phone derived too. */
    fun paired(id: String, phoneKey: ByteArray) {
        pairId = id
        val shared = Crypto.sharedSecret(pairingKeys.secretKey, phoneKey)!!
        pairKey = Crypto.hkdf(shared, phoneKey + pairingKeys.publicKey, Crypto.utf8("car-mirror pair key v1"), 32)
    }

    /** A session's fresh public key. */
    fun sessionKey(): ByteArray {
        sessionKeys = newKeyPair()
        return sessionKeys.publicKey
    }

    fun proof(phoneKey: ByteArray, nonce: ByteArray): ByteArray =
        Crypto.hmac(pairKey!!, Crypto.utf8("car-mirror proof v1"), nonce, sessionKeys.publicKey, phoneKey)

    fun opened(id: String, phoneKey: ByteArray, nonce: ByteArray) {
        sessionId = id
        val shared = Crypto.sharedSecret(sessionKeys.secretKey, phoneKey)!!
        val keys = Crypto.hkdf(shared + pairKey!!, nonce, Crypto.utf8("car-mirror session v1") + sessionKeys.publicKey + phoneKey, 64)
        toCar = keys.copyOfRange(0, 32)
        fromCar = keys.copyOfRange(32, 64)
        sent = 0
    }

    /** Decrypts a message from the phone: 8-byte counter, then ciphertext and tag. */
    fun open(aad: ByteArray, message: ByteArray): ByteArray? =
        if (message.size < 24) null else Crypto.open(toCar, Crypto.nonce(Crypto.getLong(message, 0)), aad, message, 8)

    /** Encrypts a message for the phone with the next counter. */
    fun seal(aad: ByteArray, plaintext: ByteArray): ByteArray = sealWith(++sent, aad, plaintext)

    fun sealWith(counter: Long, aad: ByteArray, plaintext: ByteArray): ByteArray {
        val header = ByteArray(8).also { Crypto.putLong(it, 0, counter) }
        return header + Crypto.seal(fromCar, Crypto.nonce(counter), aad, plaintext)
    }

    /** Pairs and opens a session directly against [pairing], approving on the "phone" at once. */
    fun pairAndOpen(pairing: Pairing, remote: String = "192.168.43.2"): Session {
        val started = pairing.start(commitment(), remote) as Pairing.Start.Started
        check(pairing.finish(started.id, publicKey, remote) == Pairing.State.WAITING)
        check(pairing.approve(started.id))
        paired(started.id, started.phoneKey)
        return openSession(pairing)
    }

    fun openSession(pairing: Pairing): Session {
        val key = sessionKey()
        val challenge = pairing.challenge(pairId!!, key)!!
        val session = pairing.open(pairId!!, key, proof(challenge.phoneKey, challenge.nonce))!!
        opened(session.id, challenge.phoneKey, challenge.nonce)
        return session
    }
}
