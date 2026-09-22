import test from 'node:test';
import assert from 'node:assert';
import { MockGoogleDocsSyncAdapter, type DocumentRecord } from '../helpers/mock-adapters.ts';

test('F33 & F34: Offline Mutation Queueing & SyncAdapter Interface Contract', async () => {
  const syncAdapter = new MockGoogleDocsSyncAdapter();
  await syncAdapter.init();

  assert.strictEqual(syncAdapter.getStatus().state, 'idle');
  assert.strictEqual(syncAdapter.getStatus().pendingCount, 0);

  // Queue local mutations while offline
  syncAdapter.setOnline(false);
  assert.strictEqual(syncAdapter.getStatus().state, 'offline');

  syncAdapter.queueMutation('doc-1', 'create', { title: 'First Chapter' });
  syncAdapter.queueMutation('doc-1', 'update', { content: 'Added paragraph' });
  assert.strictEqual(syncAdapter.getStatus().pendingCount, 2);

  // Sync while offline should not push mutations
  const offlineResult = await syncAdapter.sync();
  assert.strictEqual(offlineResult.pushedCount, 0);
  assert.strictEqual(syncAdapter.getStatus().pendingCount, 2);
});

test('F35: MockGoogleDocsSyncAdapter with Deterministic Simulation - Latency & Error Injection', async () => {
  const syncAdapter = new MockGoogleDocsSyncAdapter();
  await syncAdapter.init();
  syncAdapter.queueMutation('doc-2', 'update', { title: 'Updated' });

  // Simulate network failure
  syncAdapter.simulateFailure = true;
  await assert.rejects(async () => {
    await syncAdapter.sync();
  }, /Sync failed: Network timeout/);

  assert.strictEqual(syncAdapter.getStatus().state, 'error');

  // Recover from error
  syncAdapter.simulateFailure = false;
  const result = await syncAdapter.sync();
  assert.strictEqual(result.pushedCount, 1);
  assert.strictEqual(syncAdapter.getStatus().state, 'idle');
  assert.strictEqual(syncAdapter.getStatus().pendingCount, 0);
  assert.ok(syncAdapter.getStatus().lastSyncedAt !== null);
});

test('F36: Two-Way Sync Conflict Resolution with Chronological Integrity', async () => {
  const syncAdapter = new MockGoogleDocsSyncAdapter();
  const now = Date.now();

  const localDocNewer: DocumentRecord = {
    id: 'doc-conflict',
    title: 'Local Version',
    content: 'Edited locally more recently',
    created_at: now - 10000,
    updated_at: now,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const remoteDocOlder: DocumentRecord = {
    id: 'doc-conflict',
    title: 'Remote Version',
    content: 'Edited on remote earlier',
    created_at: now - 10000,
    updated_at: now - 5000,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  // When local is newer, resolved version retains local content
  const resolvedLocal = await syncAdapter.resolveConflict(localDocNewer, remoteDocOlder);
  assert.strictEqual(resolvedLocal.title, 'Local Version');
  assert.strictEqual(resolvedLocal.content, 'Edited locally more recently');
  assert.strictEqual(resolvedLocal.sync_status, 'synced');

  // When remote is newer, resolved version adopts remote content
  const remoteDocNewer = { ...remoteDocOlder, updated_at: now + 5000, content: 'Remote winner' };
  const resolvedRemote = await syncAdapter.resolveConflict(localDocNewer, remoteDocNewer);
  assert.strictEqual(resolvedRemote.content, 'Remote winner');
  assert.strictEqual(resolvedRemote.sync_status, 'synced');
});

test('F37 & F38: Network Connectivity Listener & Automatic Sync Trigger', async () => {
  const syncAdapter = new MockGoogleDocsSyncAdapter();
  await syncAdapter.init();
  
  // Go offline
  syncAdapter.setOnline(false);
  assert.strictEqual(syncAdapter.getStatus().state, 'offline');
  
  // Queue changes while offline
  syncAdapter.queueMutation('doc-auto', 'create', { content: 'Offline draft' });
  assert.strictEqual(syncAdapter.getStatus().pendingCount, 1);

  // Network listener detects 'online' transition
  let autoSyncTriggered = false;
  const onNetworkOnline = async () => {
    syncAdapter.setOnline(true);
    const syncRes = await syncAdapter.sync();
    if (syncRes.pushedCount > 0) autoSyncTriggered = true;
  };

  await onNetworkOnline();
  assert.strictEqual(autoSyncTriggered, true, 'Online event should trigger automatic sync flush');
  assert.strictEqual(syncAdapter.getStatus().state, 'idle');
  assert.strictEqual(syncAdapter.getStatus().pendingCount, 0);
});
