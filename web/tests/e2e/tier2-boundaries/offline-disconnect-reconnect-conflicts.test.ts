import test from 'node:test';
import assert from 'node:assert';
import { MockGoogleDocsSyncAdapter, type DocumentRecord } from '../helpers/mock-adapters.ts';

test('Tier 2 Boundary: Network drops mid-session with massive queue accumulation', async () => {
  const sync = new MockGoogleDocsSyncAdapter();
  await sync.init();

  // Simulate unexpected network drop
  sync.setOnline(false);

  // Writer authors 50 incremental edits offline
  for (let i = 0; i < 50; i++) {
    sync.queueMutation('doc-offline', 'update', {
      content: `Sentence ${i} written while offline off-grid.`,
    });
  }

  assert.strictEqual(sync.getStatus().pendingCount, 50);
  assert.strictEqual(sync.getStatus().state, 'offline');

  // Attempt sync while offline -> pushes 0
  const offlinePush = await sync.sync();
  assert.strictEqual(offlinePush.pushedCount, 0);
  assert.strictEqual(sync.getStatus().pendingCount, 50);

  // Network restored
  sync.setOnline(true);
  assert.strictEqual(sync.getStatus().state, 'idle');

  // Full flush pushes all 50 mutations
  const onlinePush = await sync.sync();
  assert.strictEqual(onlinePush.pushedCount, 50);
  assert.strictEqual(sync.getStatus().pendingCount, 0);
});

test('Tier 2 Boundary: Clock skew conflict resolution handles sub-second differences', async () => {
  const sync = new MockGoogleDocsSyncAdapter();
  const baseTime = 1774000000000;

  const localDoc: DocumentRecord = {
    id: 'doc-skew',
    title: 'Clock Skew Local',
    content: 'Edited locally at exact millisecond',
    created_at: baseTime,
    updated_at: baseTime + 1005, // 1005ms
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  const remoteDoc: DocumentRecord = {
    id: 'doc-skew',
    title: 'Clock Skew Remote',
    content: 'Edited remotely 5ms earlier',
    created_at: baseTime,
    updated_at: baseTime + 1000, // 1000ms
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'conflict',
  };

  // Local is 5ms newer -> local wins
  const resolved = await sync.resolveConflict(localDoc, remoteDoc);
  assert.strictEqual(resolved.title, 'Clock Skew Local');
  assert.strictEqual(resolved.content, 'Edited locally at exact millisecond');
  assert.strictEqual(resolved.sync_status, 'synced');
});
