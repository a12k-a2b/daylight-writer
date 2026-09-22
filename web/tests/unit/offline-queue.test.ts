/**
 * tests/unit/offline-queue.test.ts
 * Unit tests for SQLite & In-Memory Offline Mutation Queue (F36, F37, F38)
 */

import test from 'node:test';
import assert from 'node:assert';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations } from '../../src/storage/schema.ts';

test('OfflineMutationQueue: Enqueues mutations and reports pending count in memory mode', async () => {
  const queue = new OfflineMutationQueue();
  assert.strictEqual(await queue.getPendingCount(), 0);

  await queue.enqueue('document', 'doc_1', 'create', { title: 'Doc One', content: 'Hello' });
  await queue.enqueue('document', 'doc_2', 'create', { title: 'Doc Two', content: 'World' });

  assert.strictEqual(await queue.getPendingCount(), 2);
});

test('OfflineMutationQueue: Coalesces create + update into a single create with latest payload', async () => {
  const queue = new OfflineMutationQueue();

  await queue.enqueue('document', 'doc_c1', 'create', { title: 'Draft v1', content: 'Initial' });
  await queue.enqueue('document', 'doc_c1', 'update', { title: 'Draft v2', content: 'Updated' });

  assert.strictEqual(await queue.getPendingCount(), 1);
  const batch = await queue.acquireBatch(10);
  assert.strictEqual(batch.length, 1);
  assert.strictEqual(batch[0].operation, 'create');

  const payload = JSON.parse(batch[0].payload);
  assert.strictEqual(payload.title, 'Draft v2');
  assert.strictEqual(payload.content, 'Updated');
});

test('OfflineMutationQueue: Coalesces update + update into a single update with latest payload', async () => {
  const queue = new OfflineMutationQueue();

  await queue.enqueue('document', 'doc_u1', 'update', { title: 'Edit A', content: 'A' });
  await queue.enqueue('document', 'doc_u1', 'update', { title: 'Edit B', content: 'B' });

  assert.strictEqual(await queue.getPendingCount(), 1);
  const batch = await queue.acquireBatch(10);
  assert.strictEqual(batch.length, 1);
  assert.strictEqual(batch[0].operation, 'update');

  const payload = JSON.parse(batch[0].payload);
  assert.strictEqual(payload.title, 'Edit B');
  assert.strictEqual(payload.content, 'B');
});

test('OfflineMutationQueue: Coalesces create + delete by dropping both from queue', async () => {
  const queue = new OfflineMutationQueue();

  await queue.enqueue('document', 'doc_ephemeral', 'create', { title: 'Temporary' });
  assert.strictEqual(await queue.getPendingCount(), 1);

  await queue.enqueue('document', 'doc_ephemeral', 'delete', {});
  assert.strictEqual(await queue.getPendingCount(), 0);

  const batch = await queue.acquireBatch(10);
  assert.strictEqual(batch.length, 0);
});

test('OfflineMutationQueue: Coalesces update + delete into delete', async () => {
  const queue = new OfflineMutationQueue();

  await queue.enqueue('document', 'doc_del', 'update', { title: 'Edited' });
  await queue.enqueue('document', 'doc_del', 'delete', {});

  assert.strictEqual(await queue.getPendingCount(), 1);
  const batch = await queue.acquireBatch(10);
  assert.strictEqual(batch.length, 1);
  assert.strictEqual(batch[0].operation, 'delete');
});

test('OfflineMutationQueue: drain drains pending mutations to adapter and prunes queue', async () => {
  const queue = new OfflineMutationQueue();
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  await queue.enqueue('document', 'doc_drain_1', 'create', { title: 'Drain One', content: 'Body 1' });
  await queue.enqueue('document', 'doc_drain_2', 'create', { title: 'Drain Two', content: 'Body 2' });

  assert.strictEqual(await queue.getPendingCount(), 2);

  const drainRes = await queue.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 2);
  assert.strictEqual(drainRes.failedCount, 0);
  assert.strictEqual(await queue.getPendingCount(), 0);

  // Verify adapter received files
  const file1 = adapter.getRemoteFile('doc_drain_1');
  const file2 = adapter.getRemoteFile('doc_drain_2');
  assert.ok(file1 !== undefined);
  assert.strictEqual(file1.title, 'Drain One');
  assert.ok(file2 !== undefined);
  assert.strictEqual(file2.title, 'Drain Two');
});

test('OfflineMutationQueue: drain respects offline adapter status without erroring', async () => {
  const queue = new OfflineMutationQueue();
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();
  adapter.setOnline(false);

  await queue.enqueue('document', 'doc_offline', 'create', { title: 'Offline Doc' });
  assert.strictEqual(await queue.getPendingCount(), 1);

  const res = await queue.drain(adapter);
  assert.strictEqual(res.pushedCount, 0);
  assert.strictEqual(res.failedCount, 0);
  assert.strictEqual(await queue.getPendingCount(), 1);
});

test('OfflineMutationQueue: exponential backoff calculation with jitter', () => {
  const queue = new OfflineMutationQueue(undefined, {
    baseBackoffMs: 1000,
    maxBackoffMs: 30000,
  });

  const b0 = queue.calculateBackoff(0);
  assert.ok(b0 >= 900 && b0 <= 1100, `Expected ~1000ms (+-10%), got ${b0}`);

  const b1 = queue.calculateBackoff(1);
  assert.ok(b1 >= 1800 && b1 <= 2200, `Expected ~2000ms (+-10%), got ${b1}`);

  const b2 = queue.calculateBackoff(2);
  assert.ok(b2 >= 3600 && b2 <= 4400, `Expected ~4000ms (+-10%), got ${b2}`);

  const bLarge = queue.calculateBackoff(10);
  assert.ok(bLarge <= 33000, `Expected clamped to maxBackoffMs, got ${bLarge}`);
});

test('OfflineMutationQueue: Recovers in-flight mutations in memory mode', async () => {
  const queue = new OfflineMutationQueue();
  await queue.enqueue('document', 'doc_mem_1', 'create', { title: 'Doc 1' });
  await queue.enqueue('document', 'doc_mem_2', 'create', { title: 'Doc 2' });

  assert.strictEqual(await queue.getPendingCount(), 2);
  const batch = await queue.acquireBatch(2);
  assert.strictEqual(batch.length, 2);

  // Both items are now in_flight; getPendingCount would be 0 without recovery
  const recovered = await queue.recoverInFlight();
  assert.strictEqual(recovered, 2);
  assert.strictEqual(await queue.getPendingCount(), 2);

  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();
  const drainRes = await queue.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 2);
  assert.strictEqual(await queue.getPendingCount(), 0);
});

test('OfflineMutationQueue: Recovers abandoned in-flight mutations on startup and pre-drain in SQLite mode', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  // Simulate abandoned in-flight rows from an unexpected crash or page kill
  await db.executeSql(`
    INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
    VALUES
      ('sync_abandoned_1', 'document', 'doc_crash_1', 'create', '{"title":"Crashed 1"}', 1000, 0, NULL, 'in_flight'),
      ('sync_abandoned_2', 'document', 'doc_crash_2', 'update', '{"title":"Crashed 2"}', 2000, 0, NULL, 'in_flight');
  `);

  const inFlightBefore = await db.executeSql<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'in_flight';`
  );
  assert.strictEqual(inFlightBefore[0].count, 2);

  // New queue on restart
  const queue = new OfflineMutationQueue(db);

  // 1. Calling init() sweeps in_flight to pending
  const recoveredCount = await queue.init();
  assert.strictEqual(recoveredCount, 2);
  assert.strictEqual(await queue.getPendingCount(), 2);

  const inFlightAfter = await db.executeSql<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'in_flight';`
  );
  assert.strictEqual(inFlightAfter[0].count, 0);

  // 2. Test pre-drain sweep: insert another abandoned row mid-session
  await db.executeSql(`
    INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
    VALUES ('sync_abandoned_3', 'document', 'doc_crash_3', 'create', '{"title":"Crashed 3"}', 3000, 0, NULL, 'in_flight');
  `);

  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  // Drain should recover sync_abandoned_3 and drain all 3 items
  const drainRes = await queue.drain(adapter);
  assert.strictEqual(drainRes.pushedCount, 3);
  assert.strictEqual(drainRes.failedCount, 0);
  assert.strictEqual(await queue.getPendingCount(), 0);
});

test('OfflineMutationQueue: Coalesces new edits with recovered pending mutations after restart', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  await db.executeSql(`
    INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
    VALUES ('sync_crash_c1', 'document', 'doc_coalesce', 'create', '{"title":"Draft v1"}', 1000, 0, NULL, 'in_flight');
  `);

  const queue = new OfflineMutationQueue(db);
  await queue.enqueue('document', 'doc_coalesce', 'update', { title: 'Draft v2 (Recovered)' });

  const rows = await db.executeSql<any>(`SELECT * FROM sync_queue;`);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'pending');
  assert.strictEqual(rows[0].operation, 'create');
  assert.strictEqual(JSON.parse(rows[0].payload).title, 'Draft v2 (Recovered)');
});
