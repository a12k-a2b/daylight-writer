/**
 * tests/adversarial/m5-challenger1-empirical-defects.test.ts
 * Challenger 1: Empirical Defect Demonstrations for Milestone 5 Iteration 2
 *
 * Defect 1 (CRITICAL): Silent data loss when adapter.sync() returns 0 pushed while offline during batch drain
 * Defect 2 (HIGH): Accumulation of unpurged staged mutations in MockGoogleDocsSyncAdapter on sync failure
 */

import test from 'node:test';
import assert from 'node:assert';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type SyncQueueRecord } from '../../src/storage/schema.ts';

async function createTestSqliteDb(dbName: string = `defect_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`): Promise<SqliteDatabase> {
  const db = await SqliteDatabase.open({
    vfsPreference: 'memory',
    dbName,
  });
  await runMigrations(db);
  return db;
}

test('Defect 1 Reproduction: Silent data loss when network drops mid-drain and adapter returns pushedCount=0', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { batchSize: 1 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  // Enqueue two documents
  await queue.enqueue('document', 'doc_safe', 'create', { title: 'Safe Document', content: 'Batch 1' });
  await queue.enqueue('document', 'doc_victim', 'create', { title: 'Victim Document', content: 'Batch 2' });

  // Simulate network dropping to offline specifically when batch 2 is being synced
  let syncCount = 0;
  const originalSync = adapter.sync.bind(adapter);
  adapter.sync = async () => {
    syncCount++;
    if (syncCount === 2) {
      adapter.setOnline(false); // Adapter goes offline mid-drain
    }
    return originalSync();
  };

  const drainResult = await queue.drain(adapter);

  // Check remote store: doc_safe should exist, doc_victim does NOT exist on remote
  const safeRemote = adapter.getRemoteFile('doc_safe');
  const victimRemote = adapter.getRemoteFile('doc_victim');
  assert.ok(safeRemote, 'doc_safe was pushed in batch 1');
  assert.strictEqual(victimRemote, undefined, 'doc_victim was never pushed because adapter was offline');

  // CRITICAL DEFECT ASSERTION:
  // Because adapter.sync() returned { pushedCount: 0, pulledCount: 0 } without throwing,
  // OfflineMutationQueue.drain() executed commitBatch() and permanently deleted doc_victim from SQLite!
  const remainingRows = await db.executeSql<SyncQueueRecord>('SELECT * FROM sync_queue;');
  
  // Demonstrating the bug: doc_victim was purged from sync_queue despite NEVER being pushed to remote!
  const victimInDb = remainingRows.find((r) => r.entity_id === 'doc_victim');
  
  console.log('[DEFECT 1 PROOF] doc_victim on remote:', !!victimRemote);
  console.log('[DEFECT 1 PROOF] doc_victim in SQLite sync_queue:', victimInDb ? 'PRESERVED' : 'SILENTLY DELETED');
  
  // Invariant assertions: victimInDb preserved as pending, zero data loss
  assert.ok(victimInDb !== undefined, 'Invariant: doc_victim must be preserved in SQLite sync_queue');
  assert.strictEqual(victimInDb.status, 'pending', 'Invariant: doc_victim must remain pending in sync_queue');
  assert.strictEqual(victimRemote, undefined, 'Invariant: doc_victim was not pushed because adapter was offline');

  await db.close();
});

test('Defect 2 Reproduction: MockGoogleDocsSyncAdapter leaks unpurged mutations on error, causing ghost pushes of dead-letter records', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { maxRetries: 2 });
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  // Enqueue a document that will experience repeated failures until dead-lettered
  await queue.enqueue('document', 'doc_doomed', 'create', { title: 'Doomed Doc' });

  // Induce network failure for two drain cycles -> reaches maxRetries (2) -> status = 'failed'
  adapter.simulateFailure = true;
  await queue.drain(adapter);
  await queue.drain(adapter);

  // In SQLite, doc_doomed is now 'failed' (dead-letter queue)
  const rows = await db.executeSql<SyncQueueRecord>('SELECT * FROM sync_queue;');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'failed');
  assert.strictEqual(await queue.getPendingCount(), 0);

  // Now, user creates a completely different, new document
  await queue.enqueue('document', 'doc_fresh', 'create', { title: 'Fresh Doc' });
  assert.strictEqual(await queue.getPendingCount(), 1);

  // Network recovers
  adapter.simulateFailure = false;
  const drainRes = await queue.drain(adapter);

  // CRITICAL DEFECT ASSERTION:
  // queue.drain() only acquired doc_fresh (1 row) from SQLite.
  // But because adapter failed to clear its internal queue on previous failures,
  // adapter.sync() pushed 3 items: the two previous failed copies of doc_doomed AND doc_fresh!
  console.log('[DEFECT 2 PROOF] Drain pushedCount:', drainRes.pushedCount);
  console.log('[DEFECT 2 PROOF] Remote doc_doomed present:', !!adapter.getRemoteFile('doc_doomed'));
  console.log('[DEFECT 2 PROOF] Remote doc_fresh present:', !!adapter.getRemoteFile('doc_fresh'));

  // Invariant assertions: zero ghost pushes, doc_fresh pushed cleanly
  assert.strictEqual(drainRes.pushedCount, 1, 'Invariant: exactly 1 mutation (doc_fresh) was pushed');
  assert.strictEqual(adapter.getRemoteFile('doc_doomed'), undefined, 'Invariant: dead-lettered doc_doomed must not be ghost-pushed');
  assert.ok(adapter.getRemoteFile('doc_fresh') !== undefined, 'Invariant: doc_fresh was successfully pushed to remote');

  await db.close();
});
