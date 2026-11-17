package io.github.fmercadx.carmirror.core

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The crypto primitives against published test vectors, the protocol against values computed
 * by the car's own crypto.js (noble), and pairing and sessions end to end.
 */
class PairingTest {
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    // RFC 7748 section 6.1: Alice is the phone, Bob the car.
    private val aliceSecret = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
    private val bobSecret = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
    private val alicePublic = hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a")
    private val bobPublic = hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f")

    private class Clock(var now: Long = 1_000_000)

    // ---- Primitives ----

    @Test
    fun `x25519 matches RFC 7748`() {
        val base = ByteArray(32).also { it[0] = 9 }
        assertEquals(alicePublic.hex(), Crypto.sharedSecret(aliceSecret, base)!!.hex())
        assertEquals(bobPublic.hex(), Crypto.sharedSecret(bobSecret, base)!!.hex())
        assertEquals("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
            Crypto.sharedSecret(aliceSecret, bobPublic)!!.hex())
        assertNull(Crypto.sharedSecret(aliceSecret, ByteArray(32)), "a low-order point gives no secret")
        assertNull(Crypto.sharedSecret(aliceSecret, ByteArray(31)), "wrong size")
    }

    @Test
    fun `hashes, hmac and hkdf match their test vectors`() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Crypto.sha256(Crypto.utf8("abc")).hex())
        assertEquals("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
            Crypto.hmac(Crypto.utf8("key"), Crypto.utf8("The quick brown fox jumps over the lazy dog")).hex())
        // RFC 5869 test case 1.
        assertEquals("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
            Crypto.hkdf(ByteArray(22) { 0x0b }, hex("000102030405060708090a0b0c"), hex("f0f1f2f3f4f5f6f7f8f9"), 42).hex())
    }

    @Test
    fun `chacha20-poly1305 matches RFC 8439 and refuses anything altered`() {
        val key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
        val nonce = hex("070000004041424344454647")
        val aad = hex("50515253c0c1c2c3c4c5c6c7")
        val text = Crypto.utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.")
        val sealed = Crypto.seal(key, nonce, aad, text.copyOfRange(0, 40), text.copyOfRange(40, text.size))
        assertEquals("d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b" +
            "1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc" +
            "3ff4def08e4b7a9de576d26586cec64b61161ae10b594f09e26a7e902ecbd0600691", sealed.hex())
        assertContentEquals(text, Crypto.open(key, nonce, aad, sealed))
        assertNull(Crypto.open(key, nonce, aad, sealed.copyOf().also { it[3] = (it[3] + 1).toByte() }), "altered ciphertext")
        assertNull(Crypto.open(key, nonce, Crypto.utf8("other"), sealed), "other associated data")
        assertNull(Crypto.open(key, Crypto.nonce(2), aad, sealed), "other nonce")
    }

    // ---- The protocol, against the car's crypto.js ----

    /** A Pairing whose key pairs are the RFC keys and whose "random" bytes are 0, 1, 2, ... */
    private fun knownPairing(): Pairing = Pairing(
        MemoryPairingStore(),
        newKeyPair = { Crypto.KeyPair(aliceSecret, alicePublic) },
        randomBytes = { n -> ByteArray(n) { it.toByte() } },
    )

    @Test
    fun `pairing and session match the car's crypto byte for byte`() {
        val pairing = knownPairing()
        val car = TestCar { Crypto.KeyPair(bobSecret, bobPublic) }
        val commitment = car.commitment()
        assertEquals("248bd6f192ce39ed91c2541df11f8e6c4683aba844bf9ee71430861af4c1073f", commitment.hex())

        var asked: Pairing.Request? = null
        pairing.listener = object : Pairing.Listener {
            override fun onRequest(request: Pairing.Request) { asked = request }
            override fun onSettled(id: String) {}
        }
        val started = assertIs<Pairing.Start.Started>(pairing.start(commitment, "car"))
        assertContentEquals(alicePublic, started.phoneKey)
        assertEquals(Pairing.State.WAITING, pairing.finish(started.id, bobPublic, "car"))
        assertEquals("942408", asked!!.code, "the phone shows what crypto.js computes")
        assertEquals("942408", car.code(started.phoneKey), "and so does the car")

        assertTrue(pairing.approve(started.id))
        car.paired(started.id, started.phoneKey)
        assertEquals("1646469d16f6188c59bdb14b080a7f10a7efc446bae8e79be4e56b2337891096", car.pairKey!!.hex())

        // A session with the same keys and the nonce crypto.js used.
        val key = car.sessionKey()
        val challenge = pairing.challenge(car.pairId!!, key)!!
        assertEquals("000102030405060708090a0b0c0d0e0f", challenge.nonce.hex())
        val proof = car.proof(challenge.phoneKey, challenge.nonce)
        assertEquals("22d80f55a2631b8832bc5e1d80e0235a1a692cddc669d7520ef5657fe5d645a1", proof.hex())
        val session = assertNotNull(pairing.open(car.pairId!!, key, proof))
        car.opened(session.id, challenge.phoneKey, challenge.nonce)

        // The very bytes crypto.js produced for its first tap open on the phone.
        val fromJs = hex("0000000000000001" + "d813f323ef4345f3b227fcab53bdc5069b3e1460b2f9")
        assertEquals("a=home", String(session.openFromCar(Crypto.utf8("input"), fromJs)!!))
        val frame = session.seal(byteArrayOf(1), Crypto.utf8("frame"))
        assertEquals("frame", String(car.open(byteArrayOf(1), frame)!!))
    }

    @Test
    fun `the session keys equal crypto js for the RFC keys and nonce`() {
        // Directly from the derivation, the way viewer.html and Pairing.open both do it.
        val pairKey = hex("1646469d16f6188c59bdb14b080a7f10a7efc446bae8e79be4e56b2337891096")
        val nonce = hex("000102030405060708090a0b0c0d0e0f")
        val shared = Crypto.sharedSecret(bobSecret, alicePublic)!!
        val keys = Crypto.hkdf(shared + pairKey, nonce, Crypto.utf8("car-mirror session v1") + bobPublic + alicePublic, 64)
        assertEquals("a15c9a8230af6b33ecdbfd61026ac37ce4ad55e85154a8e80cd9b976930795f1" +
            "3ea0bc3eefda622dfdd34825bad43229730fbc316b511eae906d69e256a9caa4", keys.hex())
        assertEquals("22d80f55a2631b8832bc5e1d80e0235a1a692cddc669d7520ef5657fe5d645a1",
            Crypto.hmac(pairKey, Crypto.utf8("car-mirror proof v1"), nonce, bobPublic, alicePublic).hex())
        assertEquals("d813f323ef4345f3b227fcab53bdc5069b3e1460b2f9",
            Crypto.seal(keys.copyOfRange(32, 64), Crypto.nonce(1), Crypto.utf8("input"), Crypto.utf8("a=home")).hex())
    }

    // ---- Pairing rules ----

    @Test
    fun `a car that reveals a different key than it committed to is refused`() {
        val pairing = Pairing(MemoryPairingStore())
        val car = TestCar()
        val started = pairing.start(car.commitment(), "car") as Pairing.Start.Started
        assertNull(pairing.finish(started.id, Crypto.keyPair().publicKey, "car"))
        assertTrue(pairing.waiting().isEmpty(), "nothing to ask the user about")
    }

    @Test
    fun `only the address that started a request can finish it`() {
        val pairing = Pairing(MemoryPairingStore())
        val car = TestCar()
        val started = pairing.start(car.commitment(), "car") as Pairing.Start.Started
        assertNull(pairing.finish(started.id, car.publicKey, "someone else"))
        assertEquals(Pairing.State.WAITING, pairing.finish(started.id, car.publicKey, "car"))
    }

    @Test
    fun `a car committing to an all-zero key is refused`() {
        val pairing = Pairing(MemoryPairingStore())
        val zero = ByteArray(32)
        val started = pairing.start(Crypto.sha256(Pairing.COMMIT, zero), "car") as Pairing.Start.Started
        assertNull(pairing.finish(started.id, zero, "car"))
    }

    @Test
    fun `denied, the address waits before it may ask again`() {
        val clock = Clock()
        val pairing = Pairing(MemoryPairingStore(), clock = { clock.now })
        val car = TestCar()
        val started = pairing.start(car.commitment(), "car") as Pairing.Start.Started
        pairing.finish(started.id, car.publicKey, "car")
        assertTrue(pairing.deny(started.id))
        assertEquals(Pairing.State.DENIED, pairing.await(started.id, Pairing.State.WAITING, 0))
        assertIs<Pairing.Start.Refused>(pairing.start(TestCar().commitment(), "car"))
        assertIs<Pairing.Start.Started>(pairing.start(TestCar().commitment(), "another car"))
        clock.now += Pairing.DENY_COOLDOWN_MS + 1
        assertIs<Pairing.Start.Started>(pairing.start(TestCar().commitment(), "car"))
        assertEquals(0, pairing.pairedCount)
    }

    @Test
    fun `an unanswered request expires and stops asking`() {
        val clock = Clock()
        val pairing = Pairing(MemoryPairingStore(), clock = { clock.now })
        val settled = mutableListOf<String>()
        pairing.listener = object : Pairing.Listener {
            override fun onRequest(request: Pairing.Request) {}
            override fun onSettled(id: String) { settled += id }
        }
        val car = TestCar()
        val started = pairing.start(car.commitment(), "car") as Pairing.Start.Started
        pairing.finish(started.id, car.publicKey, "car")
        assertEquals(1, pairing.waiting().size)
        clock.now += Pairing.WAITING_MS + 1
        assertTrue(pairing.waiting().isEmpty())
        assertEquals(listOf(started.id), settled, "the phone is told to stop asking")
        assertFalse(pairing.approve(started.id), "too late to approve")
        assertEquals(Pairing.State.EXPIRED, pairing.await(started.id, Pairing.State.WAITING, 0))
    }

    @Test
    fun `a flood of pairing requests is turned away`() {
        val pairing = Pairing(MemoryPairingStore())
        repeat(Pairing.MAX_PENDING_PER_ADDRESS) { assertIs<Pairing.Start.Started>(pairing.start(TestCar().commitment(), "car")) }
        assertIs<Pairing.Start.Refused>(pairing.start(TestCar().commitment(), "car"))
        var others = 0
        while (pairing.start(TestCar().commitment(), "car ${others}") is Pairing.Start.Started) others++
        assertEquals(Pairing.MAX_PENDING - Pairing.MAX_PENDING_PER_ADDRESS, others)
    }

    @Test
    fun `answered requests don't count against a car pairing again`() {
        val pairing = Pairing(MemoryPairingStore())
        repeat(Pairing.MAX_PENDING_PER_ADDRESS + 2) { n ->
            val car = TestCar()
            val started = assertIs<Pairing.Start.Started>(pairing.start(car.commitment(), "car"), "attempt $n")
            pairing.finish(started.id, car.publicKey, "car")
            assertTrue(pairing.approve(started.id))
        }
        assertEquals(Pairing.MAX_PENDING_PER_ADDRESS + 2, pairing.pairedCount)
    }

    // ---- Sessions ----

    @Test
    fun `a paired car opens a session and both directions decrypt`() {
        val store = MemoryPairingStore()
        val pairing = Pairing(store)
        val car = TestCar()
        val session = car.pairAndOpen(pairing)
        assertEquals(1, pairing.pairedCount)
        assertEquals(1, store.load().size, "remembered on the phone")
        assertEquals("hello", String(car.open(Crypto.utf8("status"), session.seal(Crypto.utf8("status"), Crypto.utf8("hello")))!!))
        assertEquals("d=60&p=0.5,0.5", String(session.openFromCar(Crypto.utf8("input"), car.seal(Crypto.utf8("input"), Crypto.utf8("d=60&p=0.5,0.5")))!!))
        assertEquals(session, pairing.session(session.id))
    }

    @Test
    fun `a remembered car opens a session after the phone restarts`() {
        val store = MemoryPairingStore()
        val car = TestCar()
        car.pairAndOpen(Pairing(store))
        val restarted = Pairing(store)
        assertNotNull(car.openSession(restarted))
    }

    @Test
    fun `a session needs the pair key`() {
        val pairing = Pairing(MemoryPairingStore())
        val car = TestCar()
        car.pairAndOpen(pairing)
        val impostor = TestCar()
        impostor.pairId = car.pairId
        impostor.pairKey = Crypto.randomBytes(32)
        val key = impostor.sessionKey()
        val challenge = pairing.challenge(car.pairId!!, key)!!
        assertNull(pairing.open(car.pairId!!, key, impostor.proof(challenge.phoneKey, challenge.nonce)))
        assertNull(pairing.challenge("not-a-pair", Crypto.keyPair().publicKey), "unknown car")
    }

    @Test
    fun `each challenge works once`() {
        val pairing = Pairing(MemoryPairingStore())
        val car = TestCar()
        car.pairAndOpen(pairing)
        val key = car.sessionKey()
        val challenge = pairing.challenge(car.pairId!!, key)!!
        val proof = car.proof(challenge.phoneKey, challenge.nonce)
        assertNotNull(pairing.open(car.pairId!!, key, proof))
        assertNull(pairing.open(car.pairId!!, key, proof), "a recorded handshake can't be replayed")
    }

    @Test
    fun `a replayed, reordered or altered message from the car is refused`() {
        val pairing = Pairing(MemoryPairingStore())
        val car = TestCar()
        val session = car.pairAndOpen(pairing)
        val aad = Crypto.utf8("input")
        val first = car.seal(aad, Crypto.utf8("a=home"))
        val second = car.seal(aad, Crypto.utf8("a=back"))
        assertNotNull(session.openFromCar(aad, second))
        assertNull(session.openFromCar(aad, first), "older counter")
        assertNull(session.openFromCar(aad, second), "same counter again")
        val third = car.seal(aad, Crypto.utf8("a=recents"))
        assertNull(session.openFromCar(aad, third.copyOf().also { it[20] = (it[20] + 1).toByte() }), "altered")
        assertNull(session.openFromCar(Crypto.utf8("status"), third), "a message of another kind")
        assertNotNull(session.openFromCar(aad, third), "a refused message doesn't burn the counter")
    }

    @Test
    fun `forgetting every car ends their sessions`() {
        val pairing = Pairing(MemoryPairingStore())
        val car = TestCar()
        val session = car.pairAndOpen(pairing)
        pairing.forgetAll()
        assertNull(pairing.session(session.id))
        assertEquals(0, pairing.pairedCount)
        assertNull(pairing.challenge(car.pairId!!, car.sessionKey()), "it has to pair again")
    }
}
