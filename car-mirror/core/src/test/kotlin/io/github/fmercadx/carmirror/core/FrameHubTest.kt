package io.github.fmercadx.carmirror.core

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FrameHubTest {
    private fun jpeg(n: Int) = byteArrayOf(n.toByte())

    /** Live viewer waiting for anything after [after]. */
    private fun FrameHub.next(after: Long, timeoutMs: Long) = awaitUpdate(after, null, timeoutMs)

    @Test
    fun `times out with nothing published`() {
        val hub = FrameHub()
        val started = System.nanoTime()
        assertNull(hub.next(0, 120))
        assertTrue((System.nanoTime() - started) / 1_000_000 >= 100, "returned before the timeout")
    }

    @Test
    fun `skips straight to the newest frame`() {
        val hub = FrameHub()
        repeat(3) { hub.publish(jpeg(it), 10, 20) }
        val frame = assertNotNull(hub.next(0, 10)?.frame)
        assertEquals(3, frame.seq)
        assertEquals(2, frame.jpeg[0].toInt())
    }

    @Test
    fun `waits for a frame newer than the one already seen`() {
        val hub = FrameHub()
        val first = hub.publish(jpeg(1), 10, 20)
        val got = AtomicReference<Frame?>()
        val waiting = CountDownLatch(1)
        val waiter = thread {
            waiting.countDown()
            got.set(hub.next(first.seq, 5_000)?.frame)
        }
        waiting.await()
        Thread.sleep(50)
        assertNull(got.get(), "returned the frame it had already seen")
        hub.publish(jpeg(2), 10, 20)
        waiter.join(2_000)
        assertEquals(2, got.get()?.seq)
    }

    @Test
    fun `a sequence number from an earlier session does not stall the viewer`() {
        val hub = FrameHub()
        hub.publish(jpeg(1), 10, 20)
        // The viewer last saw frame 900 from a capture session that has since restarted.
        assertEquals(1, hub.next(900, 10)?.frame?.seq)
    }

    @Test
    fun `while paused no frame is handed out, only the pause`() {
        val hub = FrameHub()
        hub.publish(jpeg(1), 10, 20)
        hub.setPaused("privacy")
        val update = assertNotNull(hub.awaitUpdate(0, null, 10))
        assertNull(update.frame, "a frame escaped while paused")
        assertEquals("privacy", update.paused)
        // A viewer that already knows it is paused waits, and still gets no frame.
        hub.publish(jpeg(2), 10, 20)
        assertNull(hub.awaitUpdate(0, "privacy", 100))
    }

    @Test
    fun `a viewer that knows it is paused is woken by the resume`() {
        val hub = FrameHub()
        hub.setPaused("driving")
        val got = AtomicReference<Update?>()
        val waiter = thread { got.set(hub.awaitUpdate(0, "driving", 5_000)) }
        Thread.sleep(50)
        assertNull(got.get())
        hub.setPaused(null)
        waiter.join(2_000)
        val update = assertNotNull(got.get())
        assertNull(update.paused)
        assertNull(update.frame, "resume is reported first; the frame comes on the next request")
    }

    @Test
    fun `knows whether anyone is watching`() {
        val hub = FrameHub()
        assertTrue(!hub.hasViewers(), "nobody has asked yet")
        val waiter = thread { hub.next(0, 300) }
        Thread.sleep(50)
        assertTrue(hub.hasViewers(), "a viewer is waiting")
        waiter.join()
        assertTrue(hub.hasViewers(withinMs = 2_000), "a viewer that just got its answer will ask again")
        Thread.sleep(150)
        assertTrue(!hub.hasViewers(withinMs = 100), "nobody has asked for a while")
    }

    @Test
    fun `close wakes waiting viewers`() {
        val hub = FrameHub()
        val done = CountDownLatch(1)
        thread {
            hub.next(0, 10_000)
            done.countDown()
        }
        Thread.sleep(50)
        hub.close()
        assertTrue(done.await(2, TimeUnit.SECONDS), "waiter was not woken by close")
        assertTrue(hub.isClosed)
    }
}
