package io.github.fmercadx.carmirror.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PausesAndHeatTest {
    @Test
    fun liveWhenNothingApplies() {
        assertNull(Pauses().reason)
    }

    @Test
    fun eachReasonOnItsOwn() {
        assertEquals("privacy", Pauses().apply { byUser = true }.reason)
        assertEquals("locked", Pauses().apply { locked = true }.reason)
        assertEquals("hot", Pauses().apply { hot = true }.reason)
        assertEquals("driving", Pauses().apply { driving = true }.reason)
    }

    @Test
    fun theUsersChoiceWinsThenThePhoneThenTheCar() {
        val p = Pauses().apply { driving = true; hot = true; locked = true; byUser = true }
        assertEquals("privacy", p.reason)
        p.byUser = false
        assertEquals("locked", p.reason, "a lock screen must never show, whatever else applies")
        p.locked = false
        assertEquals("hot", p.reason)
        p.hot = false
        assertEquals("driving", p.reason)
        p.driving = false
        assertNull(p.reason)
    }

    @Test
    fun unlockingDoesNotResumeWhileAnotherReasonHolds() {
        val p = Pauses().apply { locked = true; driving = true }
        p.locked = false
        assertEquals("driving", p.reason)
    }

    @Test
    fun clearResetsEverything() {
        val p = Pauses().apply { driving = true; hot = true; locked = true; byUser = true }
        p.clear()
        assertNull(p.reason)
    }

    @Test
    fun coolPhoneHasNoLimit() {
        assertEquals(HeatGuard.NO_LIMIT, HeatGuard.limitFor(HeatGuard.NONE))
        assertEquals(HeatGuard.NO_LIMIT, HeatGuard.limitFor(HeatGuard.LIGHT))
        assertFalse(HeatGuard.limitFor(HeatGuard.LIGHT).easing)
    }

    @Test
    fun warmPhoneSendsFewerSmallerFrames() {
        val moderate = HeatGuard.limitFor(HeatGuard.MODERATE)
        val severe = HeatGuard.limitFor(HeatGuard.SEVERE)
        assertEquals(20, moderate.maxFps)
        assertEquals(10, severe.maxFps)
        assertTrue(severe.maxJpegQuality!! < moderate.maxJpegQuality!!)
        assertFalse(moderate.pause)
        assertFalse(severe.pause)
        assertTrue(moderate.easing)
    }

    @Test
    fun hotPhonePauses() {
        for (status in listOf(HeatGuard.CRITICAL, HeatGuard.EMERGENCY, HeatGuard.SHUTDOWN)) {
            assertTrue(HeatGuard.limitFor(status).pause, "status $status")
        }
    }
}
