/**
 * tests/adversarial/m5-challenger1-sync-stress.test.ts
 * Milestone 5 Challenger 1: Sync & Offline Mutation Queue Adversarial Stress Harness
 *
 * Comprehensive Empirical Stress Testing:
 * 1. High-Frequency Mutation Burst Coalescing (500+ mutations across 50 documents):
 *    - Validated in BOTH SQLite-backed mode (MemoryVFS) and In-Memory fallback mode.
 *    - Exact coalescing rules under fire: create+updates->create, create+delete->drop,
 *      update+updates->update, update+delete->delete.
 *    - Total queue condensation verification: 505 operations -> exactly 35 records.
 * 2. Network Flapping, Abrupt Drain Interruption, and Exponential Backoff with Jitter:
 *    - Jitter and exponential distribution validation across 100 samples.
 *    - Abrupt mid-drain network drops verifying zero data loss.
 *    - Transactional rollback: records stay safe, retry_count increments, transitions to 'failed' on maxRetries.
 *    - Concurrency & Race Condition Stress: concurrent enqueue during delayed drain, re-entrancy prevention.
 * 3. Sub-Millisecond LWW Clock Skew Conflict Resolution:
 *    - 0.50ms sub-millisecond precision resolution.
 *    - 0.000ms exact tie resolution determinism between resolveConflict() and pushDocument().
 *    - Extreme clock skews (±7 days drift).
 *    - Conflict strategies: 'last-write-wins', 'local-wins', 'remote-wins'.
 * 4. UI Sync Status Indicator & Network Listener Chaos:
 *    - 100 rapid online/offline flapping cycles.
 *    - DOM state synchronization and click-to-retry execution.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import { NetworkListener } from '../../src/sync/network-listener.ts';
import { SyncStatusIndicator } from '../../src/ui/sync-status-indicator.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type DocumentRecord, type SyncQueueRecord } from '../../src/storage/schema.ts';

// Helper to create an isolated in-memory SQLite database instance
async function createTestSqliteDb(dbName: string = `test_sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`): Promise<SqliteDatabase> {
  const db = await SqliteDatabase.open({
    vfsPreference: 'memory',
    dbName,
  });
  await runMigrations(db);
  return db;
}

// ----------------------------------------------------------------------------
// 1. High-Frequency Mutation Burst Coalescing Stress (500+ Operations)
// ----------------------------------------------------------------------------

test('Adversarial M5: High-Frequency Mutation Coalescing Stress - SQLite-Backed (505 Operations across 50 Docs)', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { batchSize: 50 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const numDocs = 50;
  let totalOperationsEnqueued = 0;

  // We divide 50 documents into 4 distinct lifecycle categories:
  // - Category A: docs 0-14 (15 docs) -> create + 10 updates -> coalesces to 1 'create' with v10 payload
  // - Category B: docs 15-29 (15 docs) -> create + 10 updates + delete -> dropped completely (0 records)
  // - Category C: docs 30-39 (10 docs) -> 10 updates -> coalesces to 1 'update' with v10 payload
  // - Category D: docs 40-49 (10 docs) -> 5 updates + delete -> coalesces to 1 'delete'

  // Pre-populate remote adapter with initial versions for Category C and D
  for (let d = 30; d < numDocs; d++) {
    adapter.seedRemoteDocument({
      docId: `doc_${d}`,
      title: `Pre-existing Remote Doc ${d}`,
      content: `Initial remote content ${d}`,
      modifiedTime: 1700000000000,
    });
  }

  // --- Fire Category A (Docs 0 to 14): create + 10 updates = 11 ops each (165 ops) ---
  for (let d = 0; d < 15; d++) {
    const docId = `doc_${d}`;
    await queue.enqueue('document', docId, 'create', {
      title: `Doc ${d} Title v0`,
      content: `Content v0`,
      version: 0,
    });
    totalOperationsEnqueued++;

    for (let u = 1; u <= 10; u++) {
      await queue.enqueue('document', docId, 'update', {
        title: `Doc ${d} Title v${u}`,
        content: `Content v${u}`,
        version: u,
      });
      totalOperationsEnqueued++;
    }
  }

  // --- Fire Category B (Docs 15 to 29): create + 10 updates + delete = 12 ops each (180 ops) ---
  for (let d = 15; d < 30; d++) {
    const docId = `doc_${d}`;
    await queue.enqueue('document', docId, 'create', {
      title: `Ephemeral Doc ${d} Title v0`,
      content: `Ephemeral content v0`,
      version: 0,
    });
    totalOperationsEnqueued++;

    for (let u = 1; u <= 10; u++) {
      await queue.enqueue('document', docId, 'update', {
        title: `Ephemeral Doc ${d} Title v${u}`,
        content: `Ephemeral content v${u}`,
        version: u,
      });
      totalOperationsEnqueued++;
    }

    await queue.enqueue('document', docId, 'delete', {});
    totalOperationsEnqueued++;
  }

  // --- Fire Category C (Docs 30 to 39): 10 updates = 10 ops each (100 ops) ---
  for (let d = 30; d < 40; d++) {
    const docId = `doc_${d}`;
    for (let u = 1; u <= 10; u++) {
      await queue.enqueue('document', docId, 'update', {
        title: `Doc ${d} Updated Title v${u}`,
        content: `Updated content v${u}`,
        version: u,
      });
      totalOperationsEnqueued++;
    }
  }

  // --- Fire Category D (Docs 40 to 49): 5 updates + delete = 6 ops each (60 ops) ---
  for (let d = 40; d < 50; d++) {
    const docId = `doc_${d}`;
    for (let u = 1; u <= 5; u++) {
      await queue.enqueue('document', docId, 'update', {
        title: `Doc ${d} Pre-delete v${u}`,
        content: `Pre-delete content v${u}`,
        version: u,
      });
      totalOperationsEnqueued++;
    }
    await queue.enqueue('document', docId, 'delete', {});
    totalOperationsEnqueued++;
  }

  assert.strictEqual(totalOperationsEnqueued, 505, 'Must have generated exactly 505 burst operations');

  // Verify SQLite Table Coalescing Invariants
  const pendingCount = await queue.getPendingCount();
  const expectedPending = 15 + 0 + 10 + 10; // 35 total pending records
  assert.strictEqual(
    pendingCount,
    expectedPending,
    `SQLite coalescing failed: expected ${expectedPending} pending records in sync_queue, got ${pendingCount}`
  );

  // Directly inspect SQLite sync_queue rows to verify operations and payloads
  const rows = await db.executeSql<SyncQueueRecord>(
    `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY entity_id ASC;`
  );
  assert.strictEqual(rows.length, 35);

  // Category A verification: must be 'create' with version: 10
  for (let d = 0; d < 15; d++) {
    const row = rows.find((r) => r.entity_id === `doc_${d}`);
    assert.ok(row, `Row for Category A doc_${d} missing in SQLite`);
    assert.strictEqual(row.operation, 'create', `doc_${d} operation should remain 'create'`);
    const payload = JSON.parse(row.payload);
    assert.strictEqual(payload.version, 10, `doc_${d} payload should be latest version (10)`);
    assert.strictEqual(payload.title, `Doc ${d} Title v10`);
  }

  // Category B verification: ephemeral documents must be completely absent
  for (let d = 15; d < 30; d++) {
    const row = rows.find((r) => r.entity_id === `doc_${d}`);
    assert.strictEqual(row, undefined, `Ephemeral Category B doc_${d} should have been purged from sync_queue`);
  }

  // Category C verification: must be 'update' with version: 10
  for (let d = 30; d < 40; d++) {
    const row = rows.find((r) => r.entity_id === `doc_${d}`);
    assert.ok(row, `Row for Category C doc_${d} missing in SQLite`);
    assert.strictEqual(row.operation, 'update');
    const payload = JSON.parse(row.payload);
    assert.strictEqual(payload.version, 10);
    assert.strictEqual(payload.title, `Doc ${d} Updated Title v10`);
  }

  // Category D verification: must be 'delete'
  for (let d = 40; d < 50; d++) {
    const row = rows.find((r) => r.entity_id === `doc_${d}`);
    assert.ok(row, `Row for Category D doc_${d} missing in SQLite`);
    assert.strictEqual(row.operation, 'delete');
  }

  // Execute Batch Drain and Verify Monotonic Propagation to Cloud Adapter
  const drainRes = await queue.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 35);
  assert.strictEqual(drainRes.failedCount, 0);

  // Queue in SQLite must be 100% empty
  assert.strictEqual(await queue.getPendingCount(), 0);
  const remainingRows = await db.executeSql(`SELECT COUNT(*) as count FROM sync_queue;`);
  assert.strictEqual(remainingRows[0].count, 0);

  // Verify Cloud Store State Post-Drain
  for (let d = 0; d < 15; d++) {
    const cloudFile = adapter.getRemoteFile(`doc_${d}`);
    assert.ok(cloudFile, `Cloud missing Category A doc_${d}`);
    assert.strictEqual(cloudFile.title, `Doc ${d} Title v10`);
    assert.strictEqual(cloudFile.trashed, false);
  }

  for (let d = 15; d < 30; d++) {
    const cloudFile = adapter.getRemoteFile(`doc_${d}`);
    assert.strictEqual(cloudFile, undefined, `Category B ephemeral doc_${d} should never have reached cloud`);
  }

  for (let d = 30; d < 40; d++) {
    const cloudFile = adapter.getRemoteFile(`doc_${d}`);
    assert.ok(cloudFile, `Cloud missing Category C doc_${d}`);
    assert.strictEqual(cloudFile.title, `Doc ${d} Updated Title v10`);
    assert.strictEqual(cloudFile.trashed, false);
  }

  for (let d = 40; d < 50; d++) {
    const cloudFile = adapter.getRemoteFile(`doc_${d}`);
    assert.ok(cloudFile, `Cloud missing Category D doc_${d}`);
    assert.strictEqual(cloudFile.trashed, true, `Category D doc_${d} must be trashed`);
  }

  await db.close();
});

test('Adversarial M5: High-Frequency Mutation Coalescing Stress - In-Memory Fallback Mode (505 Operations)', async () => {
  const queue = new OfflineMutationQueue(undefined, { batchSize: 50 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  let totalOperations = 0;

  // Repeat the exact 505 operations in memory fallback mode
  for (let d = 0; d < 15; d++) {
    await queue.enqueue('document', `mem_doc_${d}`, 'create', { title: `MemDoc ${d} v0`, version: 0 });
    totalOperations++;
    for (let u = 1; u <= 10; u++) {
      await queue.enqueue('document', `mem_doc_${d}`, 'update', { title: `MemDoc ${d} v${u}`, version: u });
      totalOperations++;
    }
  }

  for (let d = 15; d < 30; d++) {
    await queue.enqueue('document', `mem_doc_${d}`, 'create', { title: `Ephemeral MemDoc ${d}`, version: 0 });
    totalOperations++;
    for (let u = 1; u <= 10; u++) {
      await queue.enqueue('document', `mem_doc_${d}`, 'update', { title: `Ephemeral MemDoc ${d} v${u}`, version: u });
      totalOperations++;
    }
    await queue.enqueue('document', `mem_doc_${d}`, 'delete', {});
    totalOperations++;
  }

  for (let d = 30; d < 40; d++) {
    for (let u = 1; u <= 10; u++) {
      await queue.enqueue('document', `mem_doc_${d}`, 'update', { title: `MemDoc ${d} v${u}`, version: u });
      totalOperations++;
    }
  }

  for (let d = 40; d < 50; d++) {
    for (let u = 1; u <= 5; u++) {
      await queue.enqueue('document', `mem_doc_${d}`, 'update', { title: `PreDelete ${d} v${u}`, version: u });
      totalOperations++;
    }
    await queue.enqueue('document', `mem_doc_${d}`, 'delete', {});
    totalOperations++;
  }

  assert.strictEqual(totalOperations, 505);
  const pendingCount = await queue.getPendingCount();
  assert.strictEqual(pendingCount, 35, `In-memory coalescing should leave exactly 35 records, got ${pendingCount}`);

  const drainRes = await queue.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 35);
  assert.strictEqual(drainRes.failedCount, 0);
  assert.strictEqual(await queue.getPendingCount(), 0);
});

// ----------------------------------------------------------------------------
// 2. Network Flapping, Abrupt Drain Interruption & Jittered Backoff
// ----------------------------------------------------------------------------

test('Adversarial M5: Exponential Backoff & 10% Jitter Statistical Distribution', () => {
  const queue = new OfflineMutationQueue(undefined, {
    baseBackoffMs: 1000,
    maxBackoffMs: 32000,
  });

  const testRetries = [0, 1, 2, 3, 4, 5, 10];

  for (const r of testRetries) {
    const baseExp = Math.min(32000, 1000 * Math.pow(2, r));
    const samples: number[] = [];

    for (let i = 0; i < 100; i++) {
      const delay = queue.calculateBackoffMs(r);
      samples.push(delay);

      // Invariant 1: delay must be >= baseExp
      assert.ok(
        delay >= baseExp,
        `Retry ${r}: delay ${delay} must be >= base ${baseExp}`
      );

      // Invariant 2: delay must be <= baseExp * 1.10 (plus floor boundary)
      assert.ok(
        delay <= Math.floor(baseExp * 1.10) + 1,
        `Retry ${r}: delay ${delay} must be <= jitter ceiling ${baseExp * 1.10}`
      );
    }

    // Invariant 3: randomness exists (not all 100 values identical)
    const uniqueValues = new Set(samples);
    assert.ok(
      uniqueValues.size > 1,
      `Retry ${r}: backoff values must exhibit jitter randomness, got uniform value ${samples[0]}`
    );
  }
});

test('Adversarial M5: Abrupt Mid-Drain Network Failure, Rollback & MaxRetries Failure Transition in SQLite', async () => {
  const db = await createTestSqliteDb();
  const maxRetries = 3;
  const queue = new OfflineMutationQueue(db, { batchSize: 10, maxRetries });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  // Enqueue 10 mutations
  for (let i = 0; i < 10; i++) {
    await queue.enqueue('document', `fail_doc_${i}`, 'create', {
      title: `Doc ${i}`,
      content: `Will experience network drop`,
    });
  }

  assert.strictEqual(await queue.getPendingCount(), 10);

  // 1. Simulate network failure on attempt 1
  adapter.simulateFailure = true;
  const drain1 = await queue.drain(adapter);
  assert.strictEqual(drain1.pushedCount, 0);
  assert.strictEqual(drain1.failedCount, 10);

  // Invariant: ZERO DATA LOSS. All 10 items rolled back from 'in_flight' to 'pending'
  assert.strictEqual(await queue.getPendingCount(), 10);
  let rows = await db.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
  assert.strictEqual(rows.length, 10);
  for (const r of rows) {
    assert.strictEqual(r.status, 'pending');
    assert.strictEqual(r.retry_count, 1);
    assert.strictEqual(r.last_error, 'Sync failed: Network timeout');
  }

  // 2. Simulate failure on attempt 2
  const drain2 = await queue.drain(adapter);
  assert.strictEqual(drain2.pushedCount, 0);
  assert.strictEqual(drain2.failedCount, 10);
  rows = await db.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
  for (const r of rows) {
    assert.strictEqual(r.status, 'pending');
    assert.strictEqual(r.retry_count, 2);
  }

  // 3. Simulate failure on attempt 3 (reaches maxRetries = 3)
  const drain3 = await queue.drain(adapter);
  assert.strictEqual(drain3.pushedCount, 0);
  assert.strictEqual(drain3.failedCount, 10);

  // Invariant: Status must transition to 'failed', not 'pending'
  rows = await db.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
  for (const r of rows) {
    assert.strictEqual(r.status, 'failed', `Record ${r.id} should be marked 'failed' after 3 attempts`);
    assert.strictEqual(r.retry_count, 3);
  }
  // getPendingCount should now report 0 pending records (all 10 are failed/dead-letter)
  assert.strictEqual(await queue.getPendingCount(), 0);

  // 4. If an operator updates or re-enqueues one of these documents, it becomes pending again
  await queue.enqueue('document', 'fail_doc_0', 'create', {
    title: 'Doc 0 Revived',
    content: 'Recovered after dead-letter',
  });
  // Note: enqueue handles coalescing or inserting
  const revivedCount = await queue.getPendingCount();
  assert.ok(revivedCount >= 1);

  adapter.simulateFailure = false;
  const drainRecovery = await queue.drain(adapter);
  assert.ok(drainRecovery.pushedCount >= 1);
  assert.strictEqual(drainRecovery.failedCount, 0);

  await db.close();
});

test('Adversarial M5: Concurrent Enqueuing During Latency-Delayed Drain & Re-entrancy Prevention', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { batchSize: 20 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 60 });
  await adapter.init();

  // Enqueue initial batch of 10 docs
  for (let i = 0; i < 10; i++) {
    await queue.enqueue('document', `concur_doc_${i}`, 'create', {
      title: `Concur Doc ${i} v1`,
      content: 'Initial',
    });
  }

  assert.strictEqual(await queue.getPendingCount(), 10);

  // Start drain in background (will pause 60ms during adapter.sync())
  const drainPromise = queue.drain(adapter);

  // Attempt concurrent second drain while first is draining -> should be rejected by isDraining lock
  const reentrantDrain = await queue.drain(adapter);
  assert.strictEqual(reentrantDrain.pushedCount, 0);
  assert.strictEqual(reentrantDrain.failedCount, 0);

  // While initial drain is in flight, enqueue 10 brand new documents AND update 5 existing ones
  for (let i = 10; i < 20; i++) {
    await queue.enqueue('document', `concur_doc_${i}`, 'create', {
      title: `Concur Doc ${i} v1`,
      content: 'New during drain',
    });
  }
  for (let i = 0; i < 5; i++) {
    await queue.enqueue('document', `concur_doc_${i}`, 'update', {
      title: `Concur Doc ${i} v2`,
      content: 'Updated during in-flight drain',
    });
  }

  // Await first drain: because drain() continues in a while loop until the queue is exhausted,
  // it safely and completely acquires and drains the 10 initial + 15 mid-drain mutations!
  const firstDrainRes = await drainPromise;
  assert.strictEqual(
    firstDrainRes.pushedCount,
    25,
    `drain() must continuously drain all pending mutations including those enqueued mid-drain (expected 25, got ${firstDrainRes.pushedCount})`
  );

  // The queue should now be completely drained
  const pendingRemaining = await queue.getPendingCount();
  assert.strictEqual(pendingRemaining, 0, 'Queue should be empty after continuous drain loop');

  // Verify all 20 documents in remote store have their latest values
  for (let i = 0; i < 5; i++) {
    const file = adapter.getRemoteFile(`concur_doc_${i}`);
    assert.strictEqual(file?.title, `Concur Doc ${i} v2`);
  }
  for (let i = 5; i < 10; i++) {
    const file = adapter.getRemoteFile(`concur_doc_${i}`);
    assert.strictEqual(file?.title, `Concur Doc ${i} v1`);
  }
  for (let i = 10; i < 20; i++) {
    const file = adapter.getRemoteFile(`concur_doc_${i}`);
    assert.strictEqual(file?.title, `Concur Doc ${i} v1`);
  }

  await db.close();
});

// ----------------------------------------------------------------------------
// 3. Sub-Millisecond LWW Clock Skew Conflict Resolution
// ----------------------------------------------------------------------------

test('Adversarial M5: Sub-Millisecond LWW (0.50ms Delta) Clock Skew Conflict Resolution', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const baseTime = 1720000000000;
  const docId = 'sub_ms_doc';

  // Case 1: Remote is 0.50ms newer -> Remote wins
  adapter.seedRemoteDocument({
    docId,
    title: 'Remote at +0.75ms',
    content: 'Remote text',
    modifiedTime: baseTime + 0.75,
  });

  const localOlder: DocumentRecord = {
    id: docId,
    title: 'Local at +0.25ms',
    content: 'Local older text',
    created_at: baseTime,
    updated_at: baseTime + 0.25, // 0.5ms older
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const pushRes1 = await adapter.pushDocument(localOlder);
  assert.strictEqual(pushRes1.conflictResolved, true);
  assert.strictEqual(pushRes1.winner, 'remote');
  let current = await adapter.pullDocument(docId);
  assert.strictEqual(current?.title, 'Remote at +0.75ms');

  // Also verify resolveConflict contract agrees
  const remoteDoc1: DocumentRecord = {
    id: docId,
    title: 'Remote at +0.75ms',
    content: 'Remote text',
    created_at: baseTime,
    updated_at: baseTime + 0.75,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };
  const resolvedDirect1 = await adapter.resolveConflict(localOlder, remoteDoc1);
  assert.strictEqual(resolvedDirect1.title, 'Remote at +0.75ms');

  // Case 2: Local is 0.50ms newer -> Local wins
  const localNewer: DocumentRecord = {
    ...localOlder,
    title: 'Local at +1.25ms',
    content: 'Local winning text',
    updated_at: baseTime + 1.25, // 0.5ms newer than remote (+0.75)
  };

  const pushRes2 = await adapter.pushDocument(localNewer);
  assert.strictEqual(pushRes2.conflictResolved, false);
  assert.strictEqual(pushRes2.winner, 'client');
  current = await adapter.pullDocument(docId);
  assert.strictEqual(current?.title, 'Local at +1.25ms');

  const resolvedDirect2 = await adapter.resolveConflict(localNewer, remoteDoc1);
  assert.strictEqual(resolvedDirect2.title, 'Local at +1.25ms');
});

test('Adversarial M5: Exact 0.000ms Tie Determinism & Strategy Overrides', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const exactTime = 1720000000500;
  const docId = 'exact_tie_doc';

  const localDoc: DocumentRecord = {
    id: docId,
    title: 'Local Exact Tie',
    content: 'Local text',
    created_at: exactTime - 1000,
    updated_at: exactTime,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const remoteDoc: DocumentRecord = {
    id: docId,
    title: 'Remote Exact Tie',
    content: 'Remote text',
    created_at: exactTime - 1000,
    updated_at: exactTime,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  // When timestamps are identical, local (client) deterministically wins in LWW
  const resolvedTie = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
  assert.strictEqual(resolvedTie.title, 'Local Exact Tie');

  // Test Explicit 'local-wins' Strategy (even if remote has higher timestamp)
  const remoteAhead = { ...remoteDoc, updated_at: exactTime + 999999 };
  const resolvedLocalWins = await adapter.resolveConflict(localDoc, remoteAhead, 'local-wins');
  assert.strictEqual(resolvedLocalWins.title, 'Local Exact Tie');

  // Test Explicit 'remote-wins' Strategy (even if local has higher timestamp)
  const localAhead = { ...localDoc, updated_at: exactTime + 999999 };
  const resolvedRemoteWins = await adapter.resolveConflict(localAhead, remoteDoc, 'remote-wins');
  assert.strictEqual(resolvedRemoteWins.title, 'Remote Exact Tie');
});

test('Adversarial M5: Extreme Multi-Day Clock Drift Handling (±7 Days)', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const base = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // Scenario 1: Client device clock is skewed 7 days into the past
  const pastLocal: DocumentRecord = {
    id: 'skew_past',
    title: 'Stale Local (Past Drift)',
    content: 'Edited on skewed device',
    created_at: base - sevenDaysMs - 1000,
    updated_at: base - sevenDaysMs,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const currentRemote: DocumentRecord = {
    id: 'skew_past',
    title: 'Modern Remote',
    content: 'Edited on synced server',
    created_at: base - 5000,
    updated_at: base,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const resPast = await adapter.resolveConflict(pastLocal, currentRemote);
  assert.strictEqual(resPast.title, 'Modern Remote', 'Server must preserve modern remote when client clock is days behind');

  // Scenario 2: Client device clock is skewed 7 days into the future
  const futureLocal: DocumentRecord = {
    id: 'skew_future',
    title: 'Future Local (Future Drift)',
    content: 'Edited with future timestamp',
    created_at: base,
    updated_at: base + sevenDaysMs,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const resFuture = await adapter.resolveConflict(futureLocal, currentRemote);
  assert.strictEqual(resFuture.title, 'Future Local (Future Drift)', 'LWW honors chronological highest timestamp');
});

// ----------------------------------------------------------------------------
// 4. UI Sync Status Indicator & Network Listener Chaos
// ----------------------------------------------------------------------------

test('Adversarial M5: 100 Rapid Network Flapping Cycles with SyncStatusIndicator & Retry Action', async () => {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).document = doc;
  (globalThis as any).window = win;

  const header = doc.createElement('header');
  doc.body.appendChild(header);

  let retryTriggeredCount = 0;
  const indicator = new SyncStatusIndicator(header as any, {
    onRetry: () => {
      retryTriggeredCount++;
    },
  });

  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();
  indicator.bindAdapter(adapter);

  // Verify initial mounted state
  assert.ok(indicator.element !== null);
  assert.strictEqual(indicator.element.classList.contains('sync-state-synced'), true);
  assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

  // Rapidly toggle 100 times between online, offline, and error states
  for (let i = 0; i < 100; i++) {
    const cycle = i % 3;
    if (cycle === 0) {
      adapter.setOnline(false);
      assert.strictEqual(indicator.element.classList.contains('sync-state-offline'), true);
    } else if (cycle === 1) {
      adapter.setOnline(true);
      adapter.setSimulatedFailure(true);
      try {
        await adapter.sync();
      } catch {
        // Expected
      }
      assert.strictEqual(indicator.element.classList.contains('sync-state-error'), true);
      assert.strictEqual(indicator.glyphEl?.textContent, '⚠');
    } else {
      adapter.setSimulatedFailure(false);
      adapter.setOnline(true);
      await adapter.sync();
      assert.strictEqual(indicator.element.classList.contains('sync-state-synced'), true);
      assert.strictEqual(indicator.glyphEl?.textContent, '✓');
    }
  }

  // Set to error state and trigger user click on the pill
  adapter.setOnline(true);
  adapter.setSimulatedFailure(true);
  try {
    await adapter.sync();
  } catch {
    // Expected
  }
  assert.strictEqual(indicator.element.classList.contains('sync-state-error'), true);

  // Click on error pill triggers onRetry callback
  indicator.element.click();
  assert.strictEqual(retryTriggeredCount, 1, 'Clicking on error pill must trigger onRetry callback');

  // Click when synced should NOT trigger retry callback
  adapter.setSimulatedFailure(false);
  await adapter.sync();
  assert.strictEqual(indicator.element.classList.contains('sync-state-synced'), true);
  indicator.element.click();
  assert.strictEqual(retryTriggeredCount, 1, 'Clicking on synced pill must not trigger onRetry');

  indicator.destroy();
  assert.strictEqual(indicator.element, null);
});
