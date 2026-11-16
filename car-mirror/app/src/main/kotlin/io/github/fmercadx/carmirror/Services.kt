package io.github.fmercadx.carmirror

import android.content.Context

/** A system service this app cannot work without. The SDK types these as nullable. */
inline fun <reified T : Any> Context.service(): T =
    requireNotNull(getSystemService(T::class.java)) { "${T::class.java.simpleName} is not available" }
