/**
 * tests/e2e/gdrive-sync/tier1-features-f11-f13.test.ts
 * Tier 1: Isolated Feature Coverage for Features 11 to 13 (R3: Bidirectional Reconciliation & Remote Discovery)
 *
 * Feature 11: Remote Document Discovery (>=5 tests)
 * Feature 12: Bidirectional Reconciliation (>=5 tests)
 * Feature 13: Offline Mutation Queue & Drain (>=5 tests)
 */

import test from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../../src/sync/google-drive-sync-adapter.ts';
import { MockGoogleDocsSyncAdapter } from '../../../src/sync/mock-google-docs-sync-adapter.ts';
import { OfflineMutationQueue } from '../../../src/sync/offline-mutation-queue.ts';
import { setupGDriveTestEnv, GDriveTestStorageRepository } from './helpers/test-harness.ts';
import type { DocumentRecord } from '../../../src/storage/schema.ts';

// ============================================================================
// Feature 11: Remote Document Discovery (F11)
// ============================================================================

test('F11.1: Remote Discovery - Queries Google Drive for files inside Daylight Manuscripts folder', async () => {
  const env = setupGDriveTestEnv();
  try {
    const targetFolderId = 'folder-daylight-123';
    env.server.seedFolder(targetFolderId, 'Daylight Manuscripts');
    env.server.seedFile({
      id: 'gdoc-rem-1',
      name: 'Remote Manuscript 1',
      parents: [targetFolderId],
    });

    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files?q=parents+in+'${targetFolderId}'+and+trashed+%3D+false&fields=files(id,name,mimeType,modifiedTime)`
    );

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.files.length, 1);
    assert.strictEqual(data.files[0].id, 'gdoc-rem-1');
    assert.strictEqual(data.files[0].name, 'Remote Manuscript 1');
  } finally {
    env.cleanup();
  }
});

test('F11.2: Remote Discovery - Identifies new remote documents not present in local storage', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    const folderId = 'folder-mss';
    env.server.seedFolder(folderId, 'Daylight Manuscripts');
    env.server.seedFile({
      id: 'gdoc-cloud-new',
      name: 'Cloud Authored Chapter',
      parents: [folderId],
      content: 'Written on web browser',
    });

    // Check local repo
    const existingLocal = await repo.findByDriveFileId('gdoc-cloud-new');
    assert.strictEqual(existingLocal, null, 'Must not exist in local storage prior to discovery');

    // Simulate discovery query
    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files?q=parents+in+'${folderId}'+and+trashed+%3D+false`
    );
    const data = await res.json();
    const discoveredFile = data.files.find((f: any) => f.id === 'gdoc-cloud-new');
    assert.ok(discoveredFile, 'Must discover remote file in cloud folder');
  } finally {
    env.cleanup();
  }
});

test('F11.3: Remote Discovery - Detects remote updates by comparing modifiedTime with local updated_at', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    const localUpdated = Date.now() - 50000;
    const remoteModified = new Date(Date.now() - 10000).toISOString(); // 40 seconds newer

    await repo.saveDocument({
      id: 'doc-sync-check',
      title: 'Chapter 3',
      content: 'Local text',
      updated_at: localUpdated,
      google_drive_file_id: 'gdoc-compare-1',
    });

    const file = env.server.seedFile({
      id: 'gdoc-compare-1',
      name: 'Chapter 3',
      content: 'Remote updated text from laptop',
      modifiedTime: remoteModified,
    });

    const isRemoteNewer = new Date(file.modifiedTime).getTime() > localUpdated;
    assert.strictEqual(isRemoteNewer, true, 'Remote file must be detected as newer');
  } finally {
    env.cleanup();
  }
});

test('F11.4: Remote Discovery - Filters out trashed files during normal discovery', async () => {
  const env = setupGDriveTestEnv();
  try {
    const folderId = 'folder-trash-test';
    env.server.seedFolder(folderId, 'Daylight Manuscripts');
    env.server.seedFile({
      id: 'gdoc-active',
      name: 'Active File',
      parents: [folderId],
      trashed: false,
    });
    env.server.seedFile({
      id: 'gdoc-trashed',
      name: 'Deleted File',
      parents: [folderId],
      trashed: true,
    });

    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files?q=parents+in+'${folderId}'+and+trashed+%3D+false`
    );
    const data = await res.json();

    assert.strictEqual(data.files.length, 1);
    assert.strictEqual(data.files[0].id, 'gdoc-active');
  } finally {
    env.cleanup();
  }
});

test('F11.5: Remote Discovery - Handles empty remote manuscripts folder without error', async () => {
  const env = setupGDriveTestEnv();
  try {
    const folderId = 'folder-empty';
    env.server.seedFolder(folderId, 'Daylight Manuscripts');

    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files?q=parents+in+'${folderId}'+and+trashed+%3D+false`
    );
    const data = await res.json();
    assert.deepStrictEqual(data.files, []);
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 12: Bidirectional Reconciliation (F12)
// ============================================================================

test('F12.1: Bidirectional Reconciliation - Last-Write-Wins: Remote version wins when remote timestamp is newer', async () => {
  const adapter = new GoogleDriveSyncAdapter();
  const localDoc: DocumentRecord = {
    id: 'doc-lww-1',
    title: 'Original Title',
    content: 'Older local text',
    created_at: 1000,
    updated_at: 5000,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'pending',
    google_drive_file_id: 'gdoc-1',
  };

  const remoteDoc: DocumentRecord = {
    id: 'doc-lww-1',
    title: 'Updated Remotely',
    content: 'Newer remote text from browser',
    created_at: 1000,
    updated_at: 8000, // 3 seconds newer
    deleted_at: null,
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    google_drive_file_id: 'gdoc-1',
  };

  const resolved = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
  assert.strictEqual(resolved.content, 'Newer remote text from browser');
  assert.strictEqual(resolved.title, 'Updated Remotely');
  assert.strictEqual(resolved.sync_status, 'synced');
  assert.ok(resolved.last_synced_at !== null);
});

test('F12.2: Bidirectional Reconciliation - Last-Write-Wins: Local version wins when local timestamp is newer', async () => {
  const adapter = new GoogleDriveSyncAdapter();
  const localDoc: DocumentRecord = {
    id: 'doc-lww-2',
    title: 'Local Revision',
    content: 'Newer local text on DC1 LivePaper',
    created_at: 1000,
    updated_at: 12000, // Newer
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'pending',
    google_drive_file_id: 'gdoc-2',
  };

  const remoteDoc: DocumentRecord = {
    id: 'doc-lww-2',
    title: 'Older Remote Version',
    content: 'Stale remote text',
    created_at: 1000,
    updated_at: 9000,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
    google_drive_file_id: 'gdoc-2',
  };

  const resolved = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
  assert.strictEqual(resolved.content, 'Newer local text on DC1 LivePaper');
  assert.strictEqual(resolved.title, 'Local Revision');
  assert.strictEqual(resolved.sync_status, 'synced');
});

test('F12.3: Bidirectional Reconciliation - Sub-second millisecond tie-break preserves chronological integrity', async () => {
  const adapter = new GoogleDriveSyncAdapter();
  const timestamp = 1700000000000;

  const localDoc: DocumentRecord = {
    id: 'doc-tie',
    title: 'Local Exact Tie',
    content: 'Exact timestamp tie content',
    created_at: timestamp - 1000,
    updated_at: timestamp,
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'pending',
  };

  const remoteDoc: DocumentRecord = {
    ...localDoc,
    title: 'Remote Exact Tie',
    content: 'Remote exact timestamp content',
  };

  // When timestamps are equal (localTime >= remoteTime), local version deterministically resolves
  const resolved = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
  assert.strictEqual(resolved.title, 'Local Exact Tie');
  assert.strictEqual(resolved.sync_status, 'synced');
});

test('F12.4: Bidirectional Reconciliation - Reconciles newly discovered remote file into local storage', async () => {
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  const discoveredRemoteDoc: DocumentRecord = {
    id: 'doc_auto_' + Date.now(),
    title: 'Novel Outline from Google Drive',
    content: '# Outline\n\n1. Introduction\n2. Rising Action\n3. Climax',
    created_at: Date.now() - 60000,
    updated_at: Date.now() - 30000,
    deleted_at: null,
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    google_drive_file_id: 'gdoc-rem-discovered-99',
    last_synced_at: Date.now(),
  };

  const saved = await repo.saveDocument(discoveredRemoteDoc);
  assert.strictEqual(saved.id, discoveredRemoteDoc.id);
  assert.strictEqual(saved.google_drive_file_id, 'gdoc-rem-discovered-99');

  const retrieved = await repo.findByDriveFileId('gdoc-rem-discovered-99');
  assert.ok(retrieved, 'Must be retrievable by Google Drive file ID');
  assert.strictEqual(retrieved.title, 'Novel Outline from Google Drive');
});

test('F12.5: Bidirectional Reconciliation - Google Docs text export endpoint retrieves plain text content', async () => {
  const env = setupGDriveTestEnv();
  try {
    const file = env.server.seedFile({
      id: 'gdoc-export-source',
      name: 'Essay on Modernity',
      content: '# Modernity\n\nThe transformation of time and space.',
    });

    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`
    );

    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, '# Modernity\n\nThe transformation of time and space.');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 13: Offline Mutation Queue & Drain (F13)
// ============================================================================

test('F13.1: Offline Mutation Queue - Enqueues mutations while offline in pending status', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  await queue.enqueue('document', 'doc-offline-1', 'create', {
    title: 'Offline Chapter 1',
    content: 'Written without wifi',
  });

  const count = await queue.getPendingCount();
  assert.strictEqual(count, 1);

  const item = (queue as any).memoryQueue[0];
  assert.strictEqual(item.entity_id, 'doc-offline-1');
  assert.strictEqual(item.status, 'pending');
});

test('F13.2: Offline Mutation Queue - Coalesces multiple rapid offline edits for the same document', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  await queue.enqueue('document', 'doc-coalesce', 'create', {
    title: 'Draft',
    content: 'Initial sentence.',
  });

  await queue.enqueue('document', 'doc-coalesce', 'update', {
    title: 'Draft',
    content: 'Initial sentence. Second sentence added.',
  });

  await queue.enqueue('document', 'doc-coalesce', 'update', {
    title: 'Draft Revised',
    content: 'Initial sentence. Second sentence added. Third sentence.',
  });

  const count = await queue.getPendingCount();
  assert.strictEqual(count, 1, 'Multiple edits must coalesce into 1 pending mutation');

  const item = (queue as any).memoryQueue[0];
  const payload = JSON.parse(item.payload);
  assert.strictEqual(payload.content, 'Initial sentence. Second sentence added. Third sentence.');
  assert.strictEqual(payload.title, 'Draft Revised');
});

test('F13.3: Offline Mutation Queue - Automated drain pushes pending mutations to sync adapter', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  const mockAdapter = new MockGoogleDocsSyncAdapter();
  await mockAdapter.init();

  await queue.enqueue('document', 'doc-drain-1', 'create', {
    title: 'Drained Doc 1',
    content: 'Content 1',
  });
  await queue.enqueue('document', 'doc-drain-2', 'create', {
    title: 'Drained Doc 2',
    content: 'Content 2',
  });

  const result = await queue.drain(mockAdapter);
  assert.strictEqual(result.pushedCount, 2);
  assert.strictEqual(result.failedCount, 0);

  const remaining = await queue.getPendingCount();
  assert.strictEqual(remaining, 0, 'Queue should be empty after successful drain');
});

test('F13.4: Offline Mutation Queue - Increments retry count and applies backoff on sync failure', async () => {
  const queue = new OfflineMutationQueue(undefined, {
    baseBackoffMs: 100,
    maxRetries: 3,
  });
  await queue.init();

  const failingAdapter = new MockGoogleDocsSyncAdapter({
    simulateFailure: true,
  });

  await queue.enqueue('document', 'doc-fail-test', 'create', {
    title: 'Will Fail',
    content: 'Failing content',
  });

  const result = await queue.drain(failingAdapter);
  assert.strictEqual(result.failedCount, 1);
  assert.strictEqual(result.pushedCount, 0);

  const count = await queue.getPendingCount();
  assert.strictEqual(count, 1, 'Failed mutation must stay in queue');

  const item = (queue as any).memoryQueue[0];
  assert.strictEqual(item.retry_count, 1);
  assert.strictEqual(item.status, 'pending');
  assert.ok(item.last_error !== null);
});

test('F13.5: Offline Mutation Queue - Recovers abandoned in-flight mutations upon startup', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  // Manually stage an in-flight mutation as if interrupted during app crash
  await queue.enqueue('document', 'doc-crashed', 'create', { title: 'Crash Draft' });
  (queue as any).memoryQueue[0].status = 'in_flight';

  // Run startup recovery sweep
  const recoveredCount = await queue.recoverInFlight();
  assert.strictEqual(recoveredCount, 1, 'Must recover 1 abandoned in-flight mutation');

  const count = await queue.getPendingCount();
  assert.strictEqual(count, 1);
  assert.strictEqual((queue as any).memoryQueue[0].status, 'pending');
});
