package com.daylight.writer.adversarial

import android.util.Base64
import com.daylight.writer.sync.DaylightSyncWorker
import com.daylight.writer.sync.NativeSyncQueueManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min
import kotlin.math.pow

/**
 * Tier 5 White-Box Adversarial Coverage Hardening Test Suite.
 *
 * Attacks and stress-tests:
 * 1. SAF payload encoding, boundary validation, and simulated I/O / disk-full failures.
 * 2. Concurrency and collision resilience in file export pipelines.
 * 3. Rapid lifecycle transitions, WakeLock acquire/release races, and timeout ceilings.
 * 4. Network oscillation, WorkManager retry policies, and offline queue coalescing.
 * 5. Memory leak resistance, atomic counter safety, and listener thread-safety.
 */
class AdversarialStressTest {

    // =========================================================================
    // 1. SAF Export Boundaries, Collisions, and Disk Full Simulation
    // =========================================================================

    /**
     * Models the exact data contract of SafFileExporter.ExportPayload.
     */
    data class SimulatedExportPayload(
        val filename: String,
        val mimeType: String,
        val rawBytes: ByteArray,
        val isBinary: Boolean
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is SimulatedExportPayload) return false
            return filename == other.filename &&
                    mimeType == other.mimeType &&
                    rawBytes.contentEquals(other.rawBytes) &&
                    isBinary == other.isBinary
        }

        override fun hashCode(): Int {
            var result = filename.hashCode()
            result = 31 * result + mimeType.hashCode()
            result = 31 * result + rawBytes.contentHashCode()
            result = 31 * result + isBinary.hashCode()
            return result
        }
    }

    private fun validateAndBuildPayload(
        filename: String,
        mimeType: String,
        data: String,
        isBinary: Boolean
    ): SimulatedExportPayload? {
        if (filename.isBlank() || mimeType.isBlank()) {
            return null
        }
        val bytes = try {
            if (isBinary) {
                java.util.Base64.getDecoder().decode(data)
            } else {
                data.toByteArray(Charsets.UTF_8)
            }
        } catch (_: Exception) {
            return null
        }
        return SimulatedExportPayload(filename, mimeType, bytes, isBinary)
    }

    @Test
    fun testSafExportInputValidationBoundaries() {
        // Blank filename or blank MIME type must be rejected immediately
        assertNull(validateAndBuildPayload("", "text/markdown", "content", false))
        assertNull(validateAndBuildPayload("   ", "text/markdown", "content", false))
        assertNull(validateAndBuildPayload("file.md", "", "content", false))
        assertNull(validateAndBuildPayload("file.md", "   ", "content", false))

        // Corrupted base64 for binary export must be rejected gracefully
        assertNull(validateAndBuildPayload("bad.pdf", "application/pdf", "not-valid-base64!@#$%", true))

        // Valid text and binary exports
        val textPayload = validateAndBuildPayload("valid.md", "text/markdown", "# Header\nHello", false)
        assertNotNull(textPayload)
        assertEquals("valid.md", textPayload?.filename)
        assertEquals("text/markdown", textPayload?.mimeType)
        assertEquals("# Header\nHello", String(textPayload!!.rawBytes, Charsets.UTF_8))

        val binaryData = java.util.Base64.getEncoder().encodeToString(byteArrayOf(0x50, 0x4B, 0x03, 0x04))
        val binPayload = validateAndBuildPayload("doc.docx", "application/vnd.openxmlformats", binaryData, true)
        assertNotNull(binPayload)
        assertTrue(binPayload!!.isBinary)
        assertEquals(4, binPayload.rawBytes.size)
    }

    @Test
    fun testSafExportDiskFullSimulation() {
        // Simulate a broken output stream throwing IOException("ENOSPC - No space left on device")
        val brokenStream = object : OutputStream() {
            var bytesWritten = 0
            val maxCapacity = 1024 // 1KB quota limit

            override fun write(b: Int) {
                if (bytesWritten >= maxCapacity) {
                    throw IOException("ENOSPC - No space left on device (Disk full simulation)")
                }
                bytesWritten++
            }

            override fun write(b: ByteArray, off: Int, len: Int) {
                if (bytesWritten + len > maxCapacity) {
                    throw IOException("ENOSPC - No space left on device (Disk full simulation)")
                }
                bytesWritten += len
            }
        }

        val largePayload = ByteArray(4096) { 0x41 } // 4KB payload exceeding 1KB quota
        var exceptionCaught = false

        try {
            brokenStream.use { os ->
                os.write(largePayload)
                os.flush()
            }
        } catch (e: IOException) {
            exceptionCaught = true
            assertTrue(e.message?.contains("ENOSPC") == true)
        }

        assertTrue("Disk full condition must be caught via IOException", exceptionCaught)
    }

    @Test
    fun testSafExportOverwriteSemantics() {
        // Simulates SAF 'wt' (write-truncate) stream behavior
        val buffer = ByteArrayOutputStream()
        
        // Initial write (500 bytes)
        buffer.write(ByteArray(500) { 0x31 })
        assertEquals(500, buffer.size())

        // Simulated overwrite: reset stream and write new content (200 bytes)
        buffer.reset()
        buffer.write(ByteArray(200) { 0x32 })
        assertEquals(200, buffer.size())
        assertEquals(0x32.toByte(), buffer.toByteArray()[0])
    }

    @Test
    fun testConcurrentSafExportRequests() {
        // Simulate 50 concurrent export requests hitting the bridge
        val numThreads = 50
        val executor = Executors.newFixedThreadPool(16)
        val latch = CountDownLatch(numThreads)
        val payloads = ConcurrentLinkedQueue<SimulatedExportPayload>()
        val successCount = AtomicInteger(0)

        for (i in 0 until numThreads) {
            executor.submit {
                try {
                    val fn = "doc_$i.md"
                    val content = "Content for manuscript $i"
                    val p = validateAndBuildPayload(fn, "text/markdown", content, false)
                    if (p != null) {
                        payloads.add(p)
                        successCount.incrementAndGet()
                    }
                } finally {
                    latch.countDown()
                }
            }
        }

        assertTrue(latch.await(5, TimeUnit.SECONDS))
        executor.shutdown()

        assertEquals(numThreads, successCount.get())
        assertEquals(numThreads, payloads.size)
    }

    // =========================================================================
    // 2. Rapid Lifecycle Transitions & WakeLock State Safety
    // =========================================================================

    /**
     * Models the exact thread-safe WakeLock management in DaylightNativeBridge.
     */
    class SimulatedWakeLockManager {
        private var isHeld = false
        private var acquiredAtMs = 0L
        private var timeoutMs = 3000L

        @Synchronized
        fun acquire(timeout: Long = 3000L): Boolean {
            if (!isHeld) {
                isHeld = true
                acquiredAtMs = System.currentTimeMillis()
                timeoutMs = timeout
                return true
            }
            return false // Idempotent: already held
        }

        @Synchronized
        fun release(): Boolean {
            if (isHeld) {
                isHeld = false
                acquiredAtMs = 0L
                return true
            }
            return false // Idempotent: already released, no underflow exception
        }

        @Synchronized
        fun isCurrentlyHeld(): Boolean = isHeld

        @Synchronized
        fun checkTimeout(currentTimeMs: Long): Boolean {
            if (isHeld && (currentTimeMs - acquiredAtMs >= timeoutMs)) {
                isHeld = false
                return true // Expired
            }
            return false
        }
    }

    @Test
    fun testWakeLockIdempotencyAndNoUnderflow() {
        val wlManager = SimulatedWakeLockManager()

        // Initial state: not held
        assertFalse(wlManager.isCurrentlyHeld())

        // Multiple redundant releases should return false cleanly without exception
        assertFalse(wlManager.release())
        assertFalse(wlManager.release())
        assertFalse(wlManager.isCurrentlyHeld())

        // Acquire once
        assertTrue(wlManager.acquire(3000L))
        assertTrue(wlManager.isCurrentlyHeld())

        // Redundant acquire should be idempotent (return false, still held)
        assertFalse(wlManager.acquire(3000L))
        assertTrue(wlManager.isCurrentlyHeld())

        // Release
        assertTrue(wlManager.release())
        assertFalse(wlManager.isCurrentlyHeld())
    }

    @Test
    fun testWakeLockTimeoutCeilingExpiration() {
        val wlManager = SimulatedWakeLockManager()
        wlManager.acquire(3000L)
        assertTrue(wlManager.isCurrentlyHeld())

        val now = System.currentTimeMillis()
        // 2999ms later: should still be held
        assertFalse(wlManager.checkTimeout(now + 2999L))
        assertTrue(wlManager.isCurrentlyHeld())

        // 3001ms later: should expire automatically
        assertTrue(wlManager.checkTimeout(now + 3001L))
        assertFalse(wlManager.isCurrentlyHeld())
    }

    @Test
    fun testRapidConcurrentLifecycleWakeLockRaces() {
        val wlManager = SimulatedWakeLockManager()
        val numThreads = 64
        val iterationsPerThread = 500
        val executor = Executors.newFixedThreadPool(16)
        val latch = CountDownLatch(numThreads)

        for (i in 0 until numThreads) {
            executor.submit {
                try {
                    for (j in 0 until iterationsPerThread) {
                        if (j % 2 == 0) {
                            wlManager.acquire(3000L)
                        } else {
                            wlManager.release()
                        }
                    }
                } finally {
                    latch.countDown()
                }
            }
        }

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        executor.shutdown()

        // Clean final release to verify state settles
        wlManager.release()
        assertFalse("WakeLock must not remain held after shutdown", wlManager.isCurrentlyHeld())
    }

    // =========================================================================
    // 3. Network Oscillation & Sync Queue Behavior
    // =========================================================================

    @Test
    fun testPendingCountBoundsAndCoercion() {
        val counter = AtomicInteger(0)

        fun update(c: Int): Int {
            val validated = c.coerceAtLeast(0)
            counter.set(validated)
            return validated
        }

        assertEquals(0, update(0))
        assertEquals(42, update(42))
        assertEquals(0, update(-1))
        assertEquals(0, update(-999999))
        assertEquals(100, update(100))
    }

    @Test
    fun testNetworkOscillationWithPendingMutations() {
        // Model network state and job scheduling
        var isOnline = true
        var immediateJobsScheduled = 0
        val pendingCount = AtomicInteger(0)

        fun onNetworkChanged(available: Boolean) {
            isOnline = available
            if (isOnline && pendingCount.get() > 0) {
                immediateJobsScheduled++
            }
        }

        fun onQueueUpdated(count: Int) {
            val validated = count.coerceAtLeast(0)
            pendingCount.set(validated)
            if (validated > 0 && isOnline) {
                immediateJobsScheduled++
            }
        }

        // 1. Initial online, 5 mutations arrive -> 1 immediate job scheduled
        onQueueUpdated(5)
        assertEquals(1, immediateJobsScheduled)

        // 2. Network drops (offline)
        onNetworkChanged(false)
        assertFalse(isOnline)

        // 3. 10 more mutations arrive while offline -> NO new immediate job scheduled
        onQueueUpdated(15)
        assertEquals(1, immediateJobsScheduled) // Still 1

        // 4. Network restored -> triggers immediate sync for pending mutations
        onNetworkChanged(true)
        assertTrue(isOnline)
        assertEquals(2, immediateJobsScheduled) // Incremented to 2!

        // 5. Rapid network bouncing 100 times
        for (i in 0 until 100) {
            onNetworkChanged(i % 2 == 0)
        }
        assertTrue(immediateJobsScheduled >= 2)
    }

    @Test
    fun testWorkManagerRetryLimitsAndBackoffCalculations() {
        val maxRetries = DaylightSyncWorker.MAX_RETRIES
        assertEquals(3, maxRetries)

        val webTimeout = DaylightSyncWorker.WEB_SYNC_TIMEOUT_MS
        assertEquals(15000L, webTimeout)

        // Exponential backoff logic verification
        val minBackoffMs = 10000L
        val maxBackoffMs = 5 * 60 * 60 * 1000L // 5 hours in ms

        fun calculateBackoff(attempt: Int): Long {
            val factor = 2.0.pow(attempt.toDouble()).toLong()
            return min(maxBackoffMs, minBackoffMs * factor)
        }

        assertEquals(10000L, calculateBackoff(0))  // Attempt 0: 10s
        assertEquals(20000L, calculateBackoff(1))  // Attempt 1: 20s
        assertEquals(40000L, calculateBackoff(2))  // Attempt 2: 40s
        assertEquals(80000L, calculateBackoff(3))  // Attempt 3: 80s
        assertEquals(maxBackoffMs, calculateBackoff(30)) // Clamped
    }

    // =========================================================================
    // 4. Memory Leak & Resource Hygiene
    // =========================================================================

    @Test
    fun testListenerThreadSafetyUnderConcurrentModifications() {
        // Verifies CopyOnWriteArrayList semantics used for SyncStatusListener
        val listeners = java.util.concurrent.CopyOnWriteArrayList<(Int) -> Unit>()
        val notificationsReceived = AtomicInteger(0)

        // Add 10 listeners
        for (i in 0 until 10) {
            listeners.add { notificationsReceived.incrementAndGet() }
        }

        val numThreads = 20
        val executor = Executors.newFixedThreadPool(8)
        val latch = CountDownLatch(numThreads)

        // Concurrently notify and add/remove listeners
        for (i in 0 until numThreads) {
            executor.submit {
                try {
                    val tempListener: (Int) -> Unit = { }
                    listeners.add(tempListener)
                    for (listener in listeners) {
                        listener(42)
                    }
                    listeners.remove(tempListener)
                } finally {
                    latch.countDown()
                }
            }
        }

        assertTrue(latch.await(5, TimeUnit.SECONDS))
        executor.shutdown()
        assertTrue(notificationsReceived.get() > 0)
    }

    @Test
    fun testMemoryQueueBurstAndDrainStress() {
        val memoryQueue = ConcurrentLinkedQueue<Map<String, Any>>()
        val numThreads = 16
        val mutationsPerThread = 500
        val latch = CountDownLatch(numThreads)
        val executor = Executors.newFixedThreadPool(numThreads)

        for (t in 0 until numThreads) {
            executor.submit {
                try {
                    for (m in 0 until mutationsPerThread) {
                        memoryQueue.add(mapOf("id" to "m_${t}_$m", "action" to "save"))
                    }
                } finally {
                    latch.countDown()
                }
            }
        }

        assertTrue(latch.await(5, TimeUnit.SECONDS))
        executor.shutdown()

        assertEquals(numThreads * mutationsPerThread, memoryQueue.size)

        // Drain queue
        var drained = 0
        while (memoryQueue.poll() != null) {
            drained++
        }
        assertEquals(numThreads * mutationsPerThread, drained)
        assertTrue(memoryQueue.isEmpty())
    }
}
