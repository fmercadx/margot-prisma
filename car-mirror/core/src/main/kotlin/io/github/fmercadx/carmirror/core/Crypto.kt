package io.github.fmercadx.carmirror.core

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.macs.HMac
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.math.ec.rfc7748.X25519
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * The primitives behind pairing and the encrypted session ([Pairing]): X25519 key agreement,
 * SHA-256, HMAC-SHA-256, HKDF-SHA-256 and ChaCha20-Poly1305. The car's page does the same with
 * the noble libraries (crypto.js), so every choice here has to match that file byte for byte.
 */
object Crypto {
    private val random = SecureRandom()

    fun randomBytes(count: Int): ByteArray = ByteArray(count).also { random.nextBytes(it) }

    class KeyPair(val secretKey: ByteArray, val publicKey: ByteArray)

    fun keyPair(): KeyPair {
        val secret = ByteArray(X25519.SCALAR_SIZE)
        X25519.generatePrivateKey(random, secret)
        val public = ByteArray(X25519.POINT_SIZE)
        X25519.generatePublicKey(secret, 0, public, 0)
        return KeyPair(secret, public)
    }

    /**
     * The X25519 shared secret, or null when [publicKey] is the wrong size or a low-order point
     * (which would give an all-zero secret an attacker could predict).
     */
    fun sharedSecret(secretKey: ByteArray, publicKey: ByteArray): ByteArray? {
        if (publicKey.size != X25519.POINT_SIZE) return null
        val out = ByteArray(X25519.POINT_SIZE)
        return if (X25519.calculateAgreement(secretKey, 0, publicKey, 0, out, 0)) out else null
    }

    fun sha256(vararg parts: ByteArray): ByteArray {
        val digest = SHA256Digest()
        for (part in parts) digest.update(part, 0, part.size)
        return ByteArray(digest.digestSize).also { digest.doFinal(it, 0) }
    }

    fun hmac(key: ByteArray, vararg parts: ByteArray): ByteArray {
        val mac = HMac(SHA256Digest())
        mac.init(KeyParameter(key))
        for (part in parts) mac.update(part, 0, part.size)
        return ByteArray(mac.macSize).also { mac.doFinal(it, 0) }
    }

    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val generator = HKDFBytesGenerator(SHA256Digest())
        generator.init(HKDFParameters(ikm, salt, info))
        return ByteArray(length).also { generator.generateBytes(it, 0, length) }
    }

    /** ChaCha20-Poly1305 of the [plaintext] parts, concatenated. Returns ciphertext and tag. */
    fun seal(key: ByteArray, nonce: ByteArray, aad: ByteArray, vararg plaintext: ByteArray): ByteArray {
        val cipher = ChaCha20Poly1305()
        cipher.init(true, AEADParameters(KeyParameter(key), TAG_BITS, nonce, aad))
        val out = ByteArray(cipher.getOutputSize(plaintext.sumOf { it.size }))
        var written = 0
        for (part in plaintext) written += cipher.processBytes(part, 0, part.size, out, written)
        cipher.doFinal(out, written)
        return out
    }

    /** Decrypts what [seal] made, or returns null if it was altered or the key is wrong. */
    fun open(key: ByteArray, nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray, offset: Int = 0): ByteArray? {
        val length = ciphertext.size - offset
        if (length < TAG_BITS / 8) return null
        val cipher = ChaCha20Poly1305()
        cipher.init(false, AEADParameters(KeyParameter(key), TAG_BITS, nonce, aad))
        val out = ByteArray(cipher.getOutputSize(length))
        return try {
            val written = cipher.processBytes(ciphertext, offset, length, out, 0)
            cipher.doFinal(out, written)
            out
        } catch (_: org.bouncycastle.crypto.InvalidCipherTextException) {
            null
        }
    }

    /** The 12-byte nonce for message number [counter]: four zero bytes, then the counter big-endian. */
    fun nonce(counter: Long): ByteArray = ByteArray(12).also { putLong(it, 4, counter) }

    fun putLong(target: ByteArray, offset: Int, value: Long) {
        for (i in 0 until 8) target[offset + i] = (value ushr (56 - 8 * i)).toByte()
    }

    fun getLong(source: ByteArray, offset: Int): Long {
        var value = 0L
        for (i in 0 until 8) value = (value shl 8) or (source[offset + i].toLong() and 0xff)
        return value
    }

    fun equal(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    fun utf8(text: String): ByteArray = text.toByteArray(Charsets.UTF_8)

    /** Unpadded base64url, as the page writes it. */
    fun b64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun unb64(text: String?): ByteArray? = try {
        if (text == null) null else Base64.getUrlDecoder().decode(text)
    } catch (_: IllegalArgumentException) {
        null
    }

    private const val TAG_BITS = 128
}
