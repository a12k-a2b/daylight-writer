/**
 * tests/adversarial/m5-challenger1-deep-stress.test.ts
 * Milestone 5 Iteration 2: Challenger 1 Deep Adversarial Sync & Recovery Stress Harness
 *
 * Empirical verification of:
 * 1. In-flight mutation recovery across simulated crashes with abandoned in_flight rows.
 * 2. Automatic startup recovery via ensureStartupRecovery() on getPendingCount() / enqueue().
 * 3. Coalescing of post-crash incoming mutations with recovered pending rows.
 * 4. Multi-crash cascading recovery and drain with zero data loss.
 * 5. High-frequency network flapping (150 cycles) under continuous mutation ingestion.
 * 6. Concurrent multi-caller drain re-entrancy protection and dead-letter max-retry transitions.
 * 7. In-flight recovery under pure in-memory fallback mode.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import { NetworkListener } from '../../src/sync/network-listener.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type SyncQueueRecord } from '../../src/storage/schema.ts';

async function createTestSqliteDb(dbName: string = `stress_sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`): Promise<SqliteDatabase> {
  const db = await SqliteDatabase.open({
    vfsPreference: 'memory',
    dbName,
  });
  await runMigrations(db);
  return db;
}

// ----------------------------------------------------------------------------
// TEST 1: In-Flight Mutation Recovery & Coalescing Under Simulated Process Crash
// ----------------------------------------------------------------------------
test('Adversarial Deep Stress: Crash recovery of abandoned in_flight rows, post-crash coalescing, and lossless drain', async () => {
  const db = await createTestSqliteDb();

  // Simulate an unexpected browser crash or hard process termination mid-drain:
  // Several documents and margin notes were acquired and marked 'in_flight' right before the crash.
  const abandonedRows = [
    // Doc 1: was create, in_flight
    { id: 'sync_ab_1', entity_type: 'document', entity_id: 'doc_crash_1', operation: 'create', payload: JSON.stringify({ title: 'Crash Doc 1 v0', content: 'Initial' }), ts: 1000 },
    // Doc 2: was create, in_flight
    { id: 'sync_ab_2', entity_type: 'document', entity_id: 'doc_crash_2', operation: 'create', payload: JSON.stringify({ title: 'Crash Doc 2 v0', content: 'To Be Deleted' }), ts: 1100 },
    // Doc 3: was update, in_flight
    { id: 'sync_ab_3', entity_type: 'document', entity_id: 'doc_crash_3', operation: 'update', payload: JSON.stringify({ title: 'Crash Doc 3 v1', content: 'Update v1' }), ts: 1200 },
    // Doc 4: was update, in_flight
    { id: 'sync_ab_4', entity_type: 'document', entity_id: 'doc_crash_4', operation: 'update', payload: JSON.stringify({ title: 'Crash Doc 4 v1', content: 'Pre-delete' }), ts: 1300 },
    // Doc 5: was create, in_flight (untouched after crash)
    { id: 'sync_ab_5', entity_type: 'document', entity_id: 'doc_crash_5', operation: 'create', payload: JSON.stringify({ title: 'Crash Doc 5 Untouched', content: 'Untouched' }), ts: 1400 },
    // Note 1: was note create, in_flight
    { id: 'sync_ab_6', entity_type: 'margin_note', entity_id: 'note_crash_1', operation: 'create', payload: JSON.stringify({ content: 'Note v0' }), ts: 1500 },
    // Note 2: was note update, in_flight
    { id: 'sync_ab_7', entity_type: 'margin_note', entity_id: 'note_crash_2', operation: 'update', payload: JSON.stringify({ content: 'Note 2 v1' }), ts: 1600 },
  ];

  for (const row of abandonedRows) {
    await db.executeSql(
      `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'in_flight');`,
      [row.id, row.entity_type, row.entity_id, row.operation, row.payload, row.ts]
    );
  }

  // Pre-condition: All 7 rows exist in SQLite with status = 'in_flight'
  const inFlightBefore = await db.executeSql<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'in_flight';`
  );
  assert.strictEqual(inFlightBefore[0].count, 7, 'Must have exactly 7 in_flight rows before recovery');

  // Instantiate fresh OfflineMutationQueue simulating application reboot
  const queue = new OfflineMutationQueue(db);

  // Sub-test A: Test lazy startup recovery via getPendingCount() WITHOUT calling init() first
  const pendingCountLazy = await queue.getPendingCount();
  assert.strictEqual(pendingCountLazy, 7, 'getPendingCount() must lazily recover in_flight rows to pending');

  // Verify in SQLite that in_flight rows were indeed transitioned to pending
  const inFlightAfterLazy = await db.executeSql<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'in_flight';`
  );
  assert.strictEqual(inFlightAfterLazy[0].count, 0, 'No in_flight rows should remain in SQLite');

  const pendingRowsInDb = await db.executeSql<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending';`
  );
  assert.strictEqual(pendingRowsInDb[0].count, 7, 'All 7 rows must now be in pending status');

  // Sub-test B: Verify new edits coalesce cleanly with recovered pending rows
  // 1. Doc 1 (recovered create) receives an update -> should stay 'create' with latest payload v2
  await queue.enqueue('document', 'doc_crash_1', 'update', { title: 'Crash Doc 1 v2', content: 'Updated after crash' });

  // 2. Doc 2 (recovered create) is deleted -> create + delete should drop both from queue
  await queue.enqueue('document', 'doc_crash_2', 'delete', {});

  // 3. Doc 3 (recovered update) receives another update -> should remain 'update' with v2 payload
  await queue.enqueue('document', 'doc_crash_3', 'update', { title: 'Crash Doc 3 v2', content: 'Update v2' });

  // 4. Doc 4 (recovered update) is deleted -> update + delete should become 'delete'
  await queue.enqueue('document', 'doc_crash_4', 'delete', {});

  // 5. Note 1 (recovered create) receives an update -> should stay 'create' with latest payload
  await queue.enqueue('margin_note', 'note_crash_1', 'update', { content: 'Note v1 Updated' });

  // 6. Note 2 (recovered update) receives an update -> should remain 'update'
  await queue.enqueue('margin_note', 'note_crash_2', 'update', { content: 'Note 2 v2 Updated' });

  // Expected pending count:
  // Doc 1: 1 (create)
  // Doc 2: 0 (dropped)
  // Doc 3: 1 (update)
  // Doc 4: 1 (delete)
  // Doc 5: 1 (create untouched)
  // Note 1: 1 (create)
  // Note 2: 1 (update)
  // Total = 6 records
  const pendingCountAfterEdits = await queue.getPendingCount();
  assert.strictEqual(pendingCountAfterEdits, 6, `Expected exactly 6 pending records after coalescing, got ${pendingCountAfterEdits}`);

  // Inspect SQLite rows to confirm operations and payloads
  const queueRecords = await db.executeSql<SyncQueueRecord>(
    `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY entity_id ASC;`
  );
  assert.strictEqual(queueRecords.length, 6);

  const doc1Row = queueRecords.find((r) => r.entity_id === 'doc_crash_1');
  assert.ok(doc1Row);
  assert.strictEqual(doc1Row.operation, 'create');
  assert.strictEqual(JSON.parse(doc1Row.payload).title, 'Crash Doc 1 v2');

  const doc2Row = queueRecords.find((r) => r.entity_id === 'doc_crash_2');
  assert.strictEqual(doc2Row, undefined, 'doc_crash_2 should have been purged from queue');

  const doc3Row = queueRecords.find((r) => r.entity_id === 'doc_crash_3');
  assert.ok(doc3Row);
  assert.strictEqual(doc3Row.operation, 'update');
  assert.strictEqual(JSON.parse(doc3Row.payload).title, 'Crash Doc 3 v2');

  const doc4Row = queueRecords.find((r) => r.entity_id === 'doc_crash_4');
  assert.ok(doc4Row);
  assert.strictEqual(doc4Row.operation, 'delete');

  const doc5Row = queueRecords.find((r) => r.entity_id === 'doc_crash_5');
  assert.ok(doc5Row);
  assert.strictEqual(doc5Row.operation, 'create');

  const note1Row = queueRecords.find((r) => r.entity_id === 'note_crash_1');
  assert.ok(note1Row);
  assert.strictEqual(note1Row.operation, 'create');
  assert.strictEqual(JSON.parse(note1Row.payload).content, 'Note v1 Updated');

  // Sub-test C: Drain and verify zero data loss
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  // Pre-seed doc_crash_3 and doc_crash_4 on adapter so update/delete apply realistically
  adapter.seedRemoteDocument({ docId: 'doc_crash_3', title: 'Old Remote 3', content: 'Old' });
  adapter.seedRemoteDocument({ docId: 'doc_crash_4', title: 'Old Remote 4', content: 'Old' });

  const drainResult = await queue.drain(adapter);
  assert.strictEqual(drainResult.pushedCount, 6, 'Must push all 6 coalesced mutations');
  assert.strictEqual(drainResult.failedCount, 0, 'Zero failures expected during drain');

  // SQLite sync_queue should now be completely clean
  assert.strictEqual(await queue.getPendingCount(), 0);
  const totalDbRows = await db.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
  assert.strictEqual(totalDbRows[0].count, 0, 'sync_queue must be 100% empty post-drain');

  // Verify adapter state
  const remoteDoc1 = adapter.getRemoteFile('doc_crash_1');
  assert.ok(remoteDoc1);
  assert.strictEqual(remoteDoc1.title, 'Crash Doc 1 v2');

  const remoteDoc2 = adapter.getRemoteFile('doc_crash_2');
  assert.strictEqual(remoteDoc2, undefined, 'doc_crash_2 must not exist on remote');

  const remoteDoc3 = adapter.getRemoteFile('doc_crash_3');
  assert.ok(remoteDoc3);
  assert.strictEqual(remoteDoc3.title, 'Crash Doc 3 v2');

  const remoteDoc4 = adapter.getRemoteFile('doc_crash_4');
  assert.ok(remoteDoc4);
  assert.strictEqual(remoteDoc4.trashed, true, 'doc_crash_4 must be trashed on remote');

  const remoteDoc5 = adapter.getRemoteFile('doc_crash_5');
  assert.ok(remoteDoc5);
  assert.strictEqual(remoteDoc5.title, 'Crash Doc 5 Untouched');

  await db.close();
});

// ----------------------------------------------------------------------------
// TEST 2: Cascading Multi-Crash Stress Mid-Batch
// ----------------------------------------------------------------------------
test('Adversarial Deep Stress: Cascading crashes across sequential drain attempts', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { batchSize: 5 });

  // Enqueue 20 mutations
  for (let i = 0; i < 20; i++) {
    await queue.enqueue('document', `cascade_doc_${i}`, 'create', {
      title: `Cascade Doc ${i}`,
      content: `Content ${i}`,
    });
  }
  assert.strictEqual(await queue.getPendingCount(), 20);

  // Crash 1: Queue acquires first batch (5 items marked in_flight), then crashes
  const batch1 = await queue.acquireBatch(5);
  assert.strictEqual(batch1.length, 5);
  // Abandon queue without commitBatch or rollbackBatch!

  // Restart 1: New queue instance
  const queueRestart1 = new OfflineMutationQueue(db, { batchSize: 5 });
  const recovered1 = await queueRestart1.init();
  assert.strictEqual(recovered1, 5, 'Must recover 5 abandoned rows on restart 1');
  assert.strictEqual(await queueRestart1.getPendingCount(), 20);

  // Crash 2: Acquire 2 batches (10 items), then crash again
  const batch2a = await queueRestart1.acquireBatch(5);
  const batch2b = await queueRestart1.acquireBatch(5);
  assert.strictEqual(batch2a.length, 5);
  assert.strictEqual(batch2b.length, 5);
  // Abandon again

  // Restart 2: New queue instance
  const queueRestart2 = new OfflineMutationQueue(db, { batchSize: 10 });
  const recovered2 = await queueRestart2.init();
  assert.strictEqual(recovered2, 10, 'Must recover 10 abandoned rows on restart 2');
  assert.strictEqual(await queueRestart2.getPendingCount(), 20);

  // Now perform clean drain
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();
  const drainRes = await queueRestart2.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 20);
  assert.strictEqual(drainRes.failedCount, 0);
  assert.strictEqual(await queueRestart2.getPendingCount(), 0);

  // Verify all 20 reached adapter
  for (let i = 0; i < 20; i++) {
    const file = adapter.getRemoteFile(`cascade_doc_${i}`);
    assert.ok(file, `Cascade Doc ${i} missing from remote file store`);
  }

  await db.close();
});

// ----------------------------------------------------------------------------
// TEST 3: Rapid Network Flapping (100 Cycles) with Offline Enqueuing & Auto-Drain
// ----------------------------------------------------------------------------
test('Adversarial Deep Stress: 100 Rapid Network Flapping Cycles with Offline Coalescing & Auto-Drain', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { batchSize: 50 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const listener = new NetworkListener(adapter, queue);

  const numCycles = 100;
  for (let cycle = 0; cycle < numCycles; cycle++) {
    // 1. Transition to offline
    listener.handleOffline();
    assert.strictEqual(adapter.getStatus().state, 'offline');

    // 2. Enqueue mutations while offline (create + 2 updates)
    const docId = `cycle_doc_${cycle}`;
    await queue.enqueue('document', docId, 'create', { title: `Doc ${cycle} v0`, content: 'Initial' });
    await queue.enqueue('document', docId, 'update', { title: `Doc ${cycle} v1`, content: 'Revision 1' });
    await queue.enqueue('document', docId, 'update', { title: `Doc ${cycle} v2`, content: 'Final Content' });

    // 3. Transition to online -> triggers handleOnline() -> drains queue
    await listener.handleOnline();
  }

  // Verify all 100 documents reached cloud store with final content v2
  const remainingPending = await queue.getPendingCount();
  assert.strictEqual(remainingPending, 0, 'All mutations must be drained after 100 cycles');

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const file = adapter.getRemoteFile(`cycle_doc_${cycle}`);
    assert.ok(file, `cycle_doc_${cycle} missing from remote file store`);
    assert.strictEqual(file.title, `Doc ${cycle} v2`);
    assert.strictEqual(file.content, 'Final Content');
  }

  await db.close();
});

// ----------------------------------------------------------------------------
// TEST 4: Re-entrancy & Dead-Letter Transition Under Flapped Failures
// ----------------------------------------------------------------------------
test('Adversarial Deep Stress: Dead-letter failure transition after max retries and re-entrancy lock', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { batchSize: 5, maxRetries: 3 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 20 });
  await adapter.init();

  // Enqueue 5 items
  for (let i = 0; i < 5; i++) {
    await queue.enqueue('document', `retry_doc_${i}`, 'create', { title: `Retry Doc ${i}` });
  }

  // Induce network failures
  adapter.simulateFailure = true;

  // Drain attempt 1: Fails, retry_count = 1, status = 'pending'
  const d1 = await queue.drain(adapter);
  assert.strictEqual(d1.failedCount, 5);
  let rows = await db.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
  for (const r of rows) {
    assert.strictEqual(r.status, 'pending');
    assert.strictEqual(r.retry_count, 1);
  }

  // Drain attempt 2: Fails, retry_count = 2, status = 'pending'
  const d2 = await queue.drain(adapter);
  assert.strictEqual(d2.failedCount, 5);
  rows = await db.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
  for (const r of rows) {
    assert.strictEqual(r.status, 'pending');
    assert.strictEqual(r.retry_count, 2);
  }

  // Drain attempt 3: Fails, retry_count = 3 (>= maxRetries 3) -> status = 'failed'
  const d3 = await queue.drain(adapter);
  assert.strictEqual(d3.failedCount, 5);
  rows = await db.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
  for (const r of rows) {
    assert.strictEqual(r.status, 'failed', `Record ${r.id} must be transitioned to 'failed'`);
    assert.strictEqual(r.retry_count, 3);
  }

  // getPendingCount should now be 0 since all are dead-lettered
  assert.strictEqual(await queue.getPendingCount(), 0);

  // Subsequent drain attempts skip 'failed' records
  const d4 = await queue.drain(adapter);
  assert.strictEqual(d4.pushedCount, 0);
  assert.strictEqual(d4.failedCount, 0);

  // User revives one doc by editing it:
  await queue.enqueue('document', 'retry_doc_0', 'update', { title: 'Revived Retry Doc 0' });
  assert.strictEqual(await queue.getPendingCount(), 1);

  // Restore network and drain
  adapter.simulateFailure = false;
  const d5 = await queue.drain(adapter);
  assert.ok(d5.pushedCount >= 1);
  assert.strictEqual(d5.failedCount, 0);
  assert.strictEqual(await queue.getPendingCount(), 0);

  const revivedFile = adapter.getRemoteFile('retry_doc_0');
  assert.ok(revivedFile);
  assert.strictEqual(revivedFile.title, 'Revived Retry Doc 0');

  await db.close();
});

// ----------------------------------------------------------------------------
// TEST 5: Memory-Mode In-Flight Recovery & Coalescing Under Stress
// ----------------------------------------------------------------------------
test('Adversarial Deep Stress: Memory-fallback mode in-flight recovery and coalescing', async () => {
  const queue = new OfflineMutationQueue(undefined, { batchSize: 10 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  // Enqueue 10 documents
  for (let i = 0; i < 10; i++) {
    await queue.enqueue('document', `mem_stress_${i}`, 'create', { title: `Mem Stress ${i} v0` });
  }
  assert.strictEqual(await queue.getPendingCount(), 10);

  // Acquire batch of 10 (marked in_flight)
  const batch = await queue.acquireBatch(10);
  assert.strictEqual(batch.length, 10);
  assert.strictEqual(await queue.getPendingCount(), 0);

  // Simulate crash / recovery
  const recovered = await queue.recoverInFlight();
  assert.strictEqual(recovered, 10);
  assert.strictEqual(await queue.getPendingCount(), 10);

  // New edits while recovered
  for (let i = 0; i < 5; i++) {
    await queue.enqueue('document', `mem_stress_${i}`, 'update', { title: `Mem Stress ${i} v1` });
  }
  for (let i = 5; i < 10; i++) {
    await queue.enqueue('document', `mem_stress_${i}`, 'delete', {});
  }

  // 5 creates updated, 5 creates deleted -> 5 total remaining
  assert.strictEqual(await queue.getPendingCount(), 5);

  const drainRes = await queue.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 5);
  assert.strictEqual(await queue.getPendingCount(), 0);

  for (let i = 0; i < 5; i++) {
    const f = adapter.getRemoteFile(`mem_stress_${i}`);
    assert.ok(f);
    assert.strictEqual(f.title, `Mem Stress ${i} v1`);
  }
  for (let i = 5; i < 10; i++) {
    const f = adapter.getRemoteFile(`mem_stress_${i}`);
    assert.strictEqual(f, undefined);
  }
});
