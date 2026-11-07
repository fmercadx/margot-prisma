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

    @Test
    fun `times out with nothing published`() {
        val hub = FrameHub()
        val started = System.nanoTime()
        assertNull(hub.awaitAfter(0, 120))
        assertTrue((System.nanoTime() - started) / 1_000_000 >= 100, "returned before the timeout")
    }

    @Test
    fun `skips straight to the newest frame`() {
        val hub = FrameHub()
        repeat(3) { hub.publish(jpeg(it), 10, 20) }
        val frame = assertNotNull(hub.awaitAfter(0, 10))
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
            got.set(hub.awaitAfter(first.seq, 5_000))
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
        assertEquals(1, hub.awaitAfter(900, 10)?.seq)
    }

    @Test
    fun `close wakes waiting viewers`() {
        val hub = FrameHub()
        val done = CountDownLatch(1)
        thread {
            hub.awaitAfter(0, 10_000)
            done.countDown()
        }
        Thread.sleep(50)
        hub.close()
        assertTrue(done.await(2, TimeUnit.SECONDS), "waiter was not woken by close")
        assertTrue(hub.isClosed)
    }
}
