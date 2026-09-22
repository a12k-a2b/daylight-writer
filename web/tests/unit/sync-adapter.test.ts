/**
 * tests/unit/sync-adapter.test.ts
 * Unit tests for Pluggable SyncAdapter and MockGoogleDocsSyncAdapter (F33, F34, F37, F39)
 */

import test from 'node:test';
import assert from 'node:assert';
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import type { SyncEvent } from '../../src/sync/sync-adapter.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

function createSampleDoc(id: string = 'doc_test_1', title: string = 'Test Title', content: string = 'Sample content'): DocumentRecord {
  const now = Date.now();
  return {
    id,
    title,
    content,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
    created_at: now - 5000,
    updated_at: now,
    deleted_at: null,
  };
}

test('SyncAdapter: init initializes virtual cloud state and reports idle', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const status = adapter.getStatus();
  assert.strictEqual(status.state, 'idle');
  assert.strictEqual(adapter.isOnline, true);
});

test('SyncAdapter: pushDocument stores document and updates revision monotonically', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const doc = createSampleDoc('doc_101', 'First Version', 'First body content');
  const pushRes1 = await adapter.pushDocument(doc);
  assert.strictEqual(pushRes1.success, true);
  assert.strictEqual(pushRes1.revisionId, 'rev-1');

  const docV2: DocumentRecord = {
    ...doc,
    title: 'Second Version',
    content: 'Second body content',
    updated_at: doc.updated_at + 1000,
  };
  const pushRes2 = await adapter.pushDocument(docV2);
  assert.strictEqual(pushRes2.success, true);
  assert.strictEqual(pushRes2.revisionId, 'rev-2');

  const pulled = await adapter.pullDocument('doc_101');
  assert.ok(pulled !== null);
  assert.strictEqual(pulled.title, 'Second Version');
  assert.strictEqual(pulled.content, 'Second body content');
});

test('SyncAdapter: LWW conflict resolution where remote has higher timestamp', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const baseDoc = createSampleDoc('doc_conflict', 'Original', 'Original content');
  await adapter.pushDocument(baseDoc);

  // Simulate remote doc updated at t=10000
  const remoteTime = Date.now() + 10000;
  adapter.setRemoteDocumentDirectly({
    ...baseDoc,
    title: 'Remote Edited Title',
    content: 'Remote newer content',
    updated_at: remoteTime,
  });

  // Client attempts push with older timestamp (t=5000)
  const clientOlderDoc: DocumentRecord = {
    ...baseDoc,
    title: 'Client Stale Title',
    content: 'Client stale content',
    updated_at: remoteTime - 2000,
  };

  const result = await adapter.pushDocument(clientOlderDoc);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.conflictResolved, true);
  assert.strictEqual(result.winner, 'remote');

  // Cloud should retain remote version
  const currentCloud = await adapter.pullDocument('doc_conflict');
  assert.strictEqual(currentCloud?.title, 'Remote Edited Title');
});

test('SyncAdapter: LWW conflict resolution where client has higher timestamp', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const baseDoc = createSampleDoc('doc_conflict_2', 'Original', 'Original content');
  await adapter.pushDocument(baseDoc);

  // Client attempts push with newer timestamp
  const clientNewerDoc: DocumentRecord = {
    ...baseDoc,
    title: 'Client Winning Title',
    content: 'Client winning content',
    updated_at: Date.now() + 5000,
  };

  const result = await adapter.pushDocument(clientNewerDoc);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.conflictResolved, false);

  const currentCloud = await adapter.pullDocument('doc_conflict_2');
  assert.strictEqual(currentCloud?.title, 'Client Winning Title');
});

test('SyncAdapter: Sub-second millisecond clock skew handling', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const fixedTime = 1700000000000;
  const remoteDoc = createSampleDoc('doc_skew', 'Remote', 'Content A');
  remoteDoc.updated_at = fixedTime + 15; // 15ms ahead
  adapter.setRemoteDocumentDirectly(remoteDoc);

  const clientDoc = createSampleDoc('doc_skew', 'Client', 'Content B');
  clientDoc.updated_at = fixedTime + 10; // 10ms ahead (5ms older)

  const res = await adapter.pushDocument(clientDoc);
  assert.strictEqual(res.conflictResolved, true);
  assert.strictEqual(res.winner, 'remote');
});

test('SyncAdapter: Failure simulation transitions state to error and rejects with Network timeout', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  adapter.setSimulatedFailure(true);

  const doc = createSampleDoc('doc_fail', 'Failing Title', 'Failing body');
  await assert.rejects(
    async () => {
      await adapter.pushDocument(doc);
    },
    /Sync failed: Network timeout/
  );

  const status = adapter.getStatus();
  assert.strictEqual(status.state, 'error');
  assert.ok(status.error?.includes('Network timeout'));

  // Reset failure and verify recovery
  adapter.setSimulatedFailure(false);
  const okRes = await adapter.pushDocument(doc);
  assert.strictEqual(okRes.success, true);
  assert.strictEqual(adapter.getStatus().state, 'idle');
});

test('SyncAdapter: Online/Offline toggling', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  adapter.setOnline(false);
  assert.strictEqual(adapter.isOnline, false);
  assert.strictEqual(adapter.getStatus().state, 'offline');

  adapter.setOnline(true);
  assert.strictEqual(adapter.isOnline, true);
  assert.strictEqual(adapter.getStatus().state, 'idle');
});

test('SyncAdapter: Event subscription and unsubscription', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });
  await adapter.init();

  const events: SyncEvent[] = [];
  const unsubscribe = adapter.subscribe((evt) => {
    events.push(evt);
  });

  const doc = createSampleDoc('doc_sub', 'Sub Title', 'Sub content');
  await adapter.pushDocument(doc);

  assert.ok(events.length >= 2, `Expected at least 2 events, got ${events.length}`);
  const stateChanges = events.map((e) => e.status.state);
  assert.ok(stateChanges.includes('syncing'));
  assert.ok(stateChanges.includes('idle'));

  unsubscribe();
  const countBefore = events.length;
  await adapter.pushDocument({ ...doc, title: 'Updated After Unsub' });
  assert.strictEqual(events.length, countBefore);
});
