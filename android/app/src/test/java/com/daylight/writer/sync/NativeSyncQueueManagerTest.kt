package com.daylight.writer.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.min
import kotlin.math.pow

/**
 * Unit tests for Daylight Writer background synchronization contracts.
 * Tests configuration, scheduling constants, backoff calculations, and queue operations.
 */
class NativeSyncQueueManagerTest {

    @Test
    fun testWorkManagerConstants() {
        assertEquals("daylight_writer_periodic_sync", NativeSyncQueueManager.PERIODIC_WORK_NAME)
        assertEquals("daylight_writer_immediate_sync", NativeSyncQueueManager.IMMEDIATE_WORK_NAME)
        assertEquals("daylight_writer_sync", NativeSyncQueueManager.TAG_SYNC_WORK)
        assertEquals("daylight_sync_prefs", NativeSyncQueueManager.PREFS_NAME)
        assertEquals(15L, NativeSyncQueueManager.PERIODIC_INTERVAL_MINUTES)
    }

    @Test
    fun testSyncWorkerConstants() {
        assertEquals(3, DaylightSyncWorker.MAX_RETRIES)
        assertEquals(15000L, DaylightSyncWorker.WEB_SYNC_TIMEOUT_MS)
    }

    @Test
    fun testPeriodicIntervalCompliesWithAndroidWorkManagerMinimum() {
        val intervalMinutes = NativeSyncQueueManager.PERIODIC_INTERVAL_MINUTES
        val intervalMillis = intervalMinutes * 60 * 1000
        // Android WorkManager PeriodicWorkRequest enforces a 15-minute minimum interval (900,000 ms)
        assertEquals(900_000L, intervalMillis)
        assertTrue("Interval must be >= 15 minutes", intervalMinutes >= 15L)
    }

    @Test
    fun testExponentialBackoffCalculation() {
        val baseBackoffMs = 10_000L
        val maxBackoffMs = 300_000L

        fun computeBackoff(attempt: Int): Long {
            val factor = 2.0.pow(attempt.toDouble()).toLong()
            return min(maxBackoffMs, baseBackoffMs * factor)
        }

        // Attempt 0: 10s * 1 = 10s
        assertEquals(10_000L, computeBackoff(0))
        // Attempt 1: 10s * 2 = 20s
        assertEquals(20_000L, computeBackoff(1))
        // Attempt 2: 10s * 4 = 40s
        assertEquals(40_000L, computeBackoff(2))
        // Attempt 3: 10s * 8 = 80s
        assertEquals(80_000L, computeBackoff(3))
        // Attempt 10: clamped to maxBackoffMs
        assertEquals(maxBackoffMs, computeBackoff(10))
    }

    @Test
    fun testQueueCoalescingLogic() {
        // Models offline mutation queue coalescing
        data class Mutation(val id: String, val entityId: String, var op: String, var payload: String)

        val queue = mutableListOf<Mutation>()

        fun enqueue(entityId: String, op: String, payload: String) {
            val existing = queue.find { it.entityId == entityId }
            if (existing != null) {
                if (existing.op == "create" && op == "delete") {
                    queue.remove(existing)
                    return
                }
                if (existing.op == "create" && op == "update") {
                    existing.payload = payload
                    return
                }
                existing.op = op
                existing.payload = payload
                return
            }
            queue.add(Mutation("mut_${System.currentTimeMillis()}", entityId, op, payload))
        }

        // 1. Create then delete -> should discard both
        enqueue("doc_1", "create", "initial text")
        assertEquals(1, queue.size)
        enqueue("doc_1", "delete", "")
        assertEquals(0, queue.size)

        // 2. Create then update -> remains create with latest payload
        enqueue("doc_2", "create", "draft 1")
        enqueue("doc_2", "update", "draft 2")
        assertEquals(1, queue.size)
        assertEquals("create", queue[0].op)
        assertEquals("draft 2", queue[0].payload)

        // 3. Update then update -> overwritten with latest
        enqueue("doc_3", "update", "v1")
        enqueue("doc_3", "update", "v2")
        assertEquals(2, queue.size)
        assertEquals("v2", queue[1].payload)
    }
}
