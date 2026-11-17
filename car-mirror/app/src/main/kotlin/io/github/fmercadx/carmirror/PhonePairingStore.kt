package io.github.fmercadx.carmirror

import android.content.Context
import io.github.fmercadx.carmirror.core.Crypto
import io.github.fmercadx.carmirror.core.PairingStore

/**
 * The cars this phone has paired, in the app's private storage. The manifest turns backups
 * off, so the pair keys never leave the phone.
 */
class PhonePairingStore(context: Context) : PairingStore {
    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun load(): Map<String, ByteArray> =
        prefs.all.mapNotNull { (id, value) -> (value as? String)?.let(Crypto::unb64)?.let { id to it } }.toMap()

    override fun save(pairs: Map<String, ByteArray>) {
        val editor = prefs.edit().clear()
        pairs.forEach { (id, key) -> editor.putString(id, Crypto.b64(key)) }
        editor.commit()
    }

    private companion object {
        const val FILE = "paired_screens"
    }
}
