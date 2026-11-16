package io.github.fmercadx.carmirror.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Gesture parsing, automatic quality, and the moving/stopped decision. */
class ControlsTest {

    // ---- Gesture ----

    @Test
    fun `parses a tap and a swipe`() {
        val tap = assertNotNull(Gesture.parse("d=60&p=0.5000,0.2500"))
        assertEquals(60, tap.durationMs)
        assertEquals(1, tap.points.size)
        assertEquals(0.25f, tap.points[0].y)

        val swipe = assertNotNull(Gesture.parse("d=300&p=0.5,0.8;0.5,0.5;0.5,0.2\n"))
        assertEquals(3, swipe.points.size)
        assertEquals(0.2f, swipe.points.last().y)
    }

    @Test
    fun `rejects anything malformed or out of range`() {
        for (body in listOf(
            "", "d=60", "p=0.5,0.5", "d=0&p=0.5,0.5", "d=10001&p=0.5,0.5", "d=x&p=0.5,0.5",
            "d=60&p=", "d=60&p=1.5,0.5", "d=60&p=0.5,-0.1", "d=60&p=0.5", "d=60&p=0.5,0.5,0.5",
            "d=60&p=NaN,0.5", "d=60&p=a,b",
            "d=60&p=" + List(Gesture.MAX_POINTS + 1) { "0.5,0.5" }.joinToString(";"),
        )) assertNull(Gesture.parse(body), body.take(40))
    }

    // ---- AutoQuality ----

    private class FakeClock(var now: Long = 0) {
        fun advance(ms: Long) {
            now += ms
        }
    }

    @Test
    fun `steps down when the car skips frames, never below the floor`() {
        val clock = FakeClock()
        val q = AutoQuality(max = 70, min = 40, clock = { clock.now })
        repeat(6) {
            repeat(10) { q.onFrameServed(skippedBefore = 1) } // half the frames skipped
            clock.advance(2_000)
            q.onFrameServed(1)
        }
        assertEquals(40, q.current)
    }

    @Test
    fun `climbs back once the car keeps up, never above the preset`() {
        val clock = FakeClock()
        val q = AutoQuality(max = 70, min = 40, clock = { clock.now })
        repeat(10) { q.onFrameServed(2) }
        clock.advance(2_000)
        q.onFrameServed(2)
        assertEquals(60, q.current)

        // Keeping up, but not for long enough yet.
        clock.advance(2_000)
        q.onFrameServed(0)
        assertEquals(60, q.current)

        repeat(20) {
            clock.advance(4_000)
            q.onFrameServed(0)
        }
        assertEquals(70, q.current)
    }

    @Test
    fun `occasional skips do not change anything`() {
        val clock = FakeClock()
        val q = AutoQuality(max = 70, clock = { clock.now })
        repeat(30) { i ->
            q.onFrameServed(if (i % 10 == 0) 1 else 0)
            clock.advance(200)
        }
        assertEquals(70, q.current)
    }

    // ---- MotionGate ----

    @Test
    fun `moving starts above walking pace and survives a red light`() {
        val gate = MotionGate()
        assertFalse(gate.onSpeed(2f, 0))
        assertTrue(gate.onSpeed(6f, 1_000))
        // Stopped at a light for 4 s: still "moving", so the picture doesn't flicker back.
        assertTrue(gate.onSpeed(0f, 2_000))
        assertTrue(gate.onSpeed(0f, 6_000))
        assertTrue(gate.onSpeed(8f, 7_000))
    }

    @Test
    fun `stops after five seconds below walking pace`() {
        val gate = MotionGate()
        gate.onSpeed(10f, 0)
        assertTrue(gate.onSpeed(0.5f, 1_000))
        assertTrue(gate.onSpeed(0.5f, 5_999))
        assertFalse(gate.onSpeed(0.5f, 6_000))
    }

    @Test
    fun `a reading without speed changes nothing`() {
        val gate = MotionGate()
        gate.onSpeed(10f, 0)
        assertTrue(gate.onSpeed(null, 10_000))
    }

    @Test
    fun `no readings for a minute ends moving, so a garage doesn't keep it paused`() {
        val gate = MotionGate()
        gate.onSpeed(10f, 0)
        assertTrue(gate.onTick(59_000))
        assertFalse(gate.onTick(60_000))
    }
}
