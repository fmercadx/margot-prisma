package io.github.fmercadx.carmirror.core

/**
 * Every reason the picture can be withheld, and the one the car is told about.
 *
 * The reasons are independent: the phone can be locked while the car is moving, say. The
 * picture comes back only when none applies, and the car shows the most specific one, in
 * the order below: the user's own choice first, then the phone's state, then the car's.
 */
class Pauses {
    /** The user tapped Pause. */
    @Volatile var byUser = false

    /** The phone's screen is off or showing the lock screen, where a PIN or pattern is drawn. */
    @Volatile var locked = false

    /** The phone is too hot to keep encoding; see [HeatGuard]. */
    @Volatile var hot = false

    /** GPS says the car is moving and the user wants the picture blank then; see [MotionGate]. */
    @Volatile var driving = false

    /** What the car's page is told: null while live, otherwise one of [REASONS]. */
    val reason: String?
        get() = when {
            byUser -> PRIVACY
            locked -> LOCKED
            hot -> HOT
            driving -> DRIVING
            else -> null
        }

    fun clear() {
        byUser = false
        locked = false
        hot = false
        driving = false
    }

    companion object {
        const val PRIVACY = "privacy"
        const val LOCKED = "locked"
        const val HOT = "hot"
        const val DRIVING = "driving"
        val REASONS = listOf(PRIVACY, LOCKED, HOT, DRIVING)
    }
}
