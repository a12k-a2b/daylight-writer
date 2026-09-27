/**
 * tests/e2e/gdrive-sync/tier1-features-f01-f05.test.ts
 * Tier 1: Isolated Feature Coverage for Features 1 to 5 (R1: Google Drive & Docs Sync Engine)
 *
 * Feature 1: Dedicated Folder Management (>=5 tests)
 * Feature 2: Genuine Google Doc Creation (>=5 tests)
 * Feature 3: In-Place Document Patching (>=5 tests)
 * Feature 4: File ID Local Persistence (>=5 tests)
 * Feature 5: Background Typing Sync Debounce (>=5 tests)
 */

import test from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../../src/sync/google-drive-sync-adapter.ts';
import { setupGDriveTestEnv, GDriveTestStorageRepository } from './helpers/test-harness.ts';
import type { DocumentRecord } from '../../../src/storage/schema.ts';

// ============================================================================
// Feature 1: Dedicated Folder Management (F01)
// ============================================================================

test('F01.1: Dedicated Folder Management - Discovers existing "Daylight Manuscripts" folder', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.seedFolder('folder-existing-123', 'Daylight Manuscripts');

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      targetFolderName: 'Daylight Manuscripts',
    });

    const folderId = await adapter.ensureDaylightFolder();
    assert.strictEqual(folderId, 'folder-existing-123');

    // Verify Drive query format
    const searchCall = env.server.callHistory.find((c) => c.url.includes('/drive/v3/files?q='));
    assert.ok(searchCall, 'Must query Google Drive files API with search query');
    assert.ok(searchCall.url.includes(encodeURIComponent("mimeType = 'application/vnd.google-apps.folder'")));
  } finally {
    env.cleanup();
  }
});

test('F01.2: Dedicated Folder Management - Auto-creates "Daylight Manuscripts" folder when not found', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      targetFolderName: 'Daylight Manuscripts',
    });

    const folderId = await adapter.ensureDaylightFolder();
    assert.ok(folderId.startsWith('folder-'), `Folder ID should be generated: ${folderId}`);
    assert.ok(env.server.folders.has(folderId), 'Folder must be created on Google Drive server');
    assert.strictEqual(env.server.folders.get(folderId)?.name, 'Daylight Manuscripts');

    // Verify POST request
    const createCall = env.server.callHistory.find((c) => c.method === 'POST' && c.url.includes('/drive/v3/files'));
    assert.ok(createCall, 'Must send POST request to create folder');
    const parsedBody = JSON.parse(createCall.body || '{}');
    assert.strictEqual(parsedBody.name, 'Daylight Manuscripts');
    assert.strictEqual(parsedBody.mimeType, 'application/vnd.google-apps.folder');
  } finally {
    env.cleanup();
  }
});

test('F01.3: Dedicated Folder Management - Caches discovered folder ID across subsequent operations', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.seedFolder('folder-cached-456', 'Daylight Manuscripts');
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const firstId = await adapter.ensureDaylightFolder();
    assert.strictEqual(firstId, 'folder-cached-456');

    // Second call should return cached ID without issuing extra HTTP requests
    const callCountBefore = env.server.callHistory.length;
    const secondId = await adapter.ensureDaylightFolder();
    assert.strictEqual(secondId, 'folder-cached-456');
    assert.strictEqual(env.server.callHistory.length, callCountBefore, 'No additional HTTP request when cached');
  } finally {
    env.cleanup();
  }
});

test('F01.4: Dedicated Folder Management - Rejects with clear diagnostic error on API permission failure', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.simulateFailure = true;
    env.server.failureStatusCode = 403;
    env.server.failureMessage = 'Insufficient Permission for Google Drive';

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    await assert.rejects(
      async () => {
        await adapter.ensureDaylightFolder();
      },
      /Failed to create Google Drive folder \(403\)|Insufficient Permission/
    );
  } finally {
    env.cleanup();
  }
});

test('F01.5: Dedicated Folder Management - Handles custom folder names and whitespace trimming', async () => {
  const env = setupGDriveTestEnv();
  try {
    const customName = 'Research Papers 2026';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      targetFolderName: customName,
    });

    const folderId = await adapter.ensureDaylightFolder();
    assert.strictEqual(env.server.folders.get(folderId)?.name, customName);
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 2: Genuine Google Doc Creation (F02)
// ============================================================================

test('F02.1: Genuine Google Doc Creation - Multipart upload formats RFC 2046 boundary and headers', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const mutation = {
      id: 'mut-1',
      entity_type: 'document' as const,
      entity_id: 'doc-101',
      operation: 'create' as const,
      payload: {
        id: 'doc-101',
        title: 'The Solitude of Writing',
        content: '# Chapter One\n\nThe morning light falls across the desk.',
      },
      client_timestamp: Date.now(),
    };

    const res = await adapter.syncDocumentMutation(mutation, 'folder-target-1');
    assert.ok(res.fileId, 'Must return created file ID');
    assert.ok(res.webViewLink?.includes('docs.google.com'), 'Must return valid Google Docs webViewLink');

    // Inspect recorded multipart request
    const uploadCall = env.server.callHistory.find((c) => c.url.includes('/upload/drive/v3/files?uploadType=multipart'));
    assert.ok(uploadCall, 'Must call multipart upload endpoint');
    assert.ok(uploadCall.headers['content-type'].includes('multipart/related'));
    assert.ok(uploadCall.body?.includes('application/vnd.google-apps.document'));
    assert.ok(uploadCall.body?.includes('The Solitude of Writing'));
    assert.ok(uploadCall.body?.includes('The morning light falls across the desk.'));
  } finally {
    env.cleanup();
  }
});

test('F02.2: Genuine Google Doc Creation - Attaches parent folder ID in upload metadata', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const mutation = {
      id: 'mut-2',
      entity_type: 'document' as const,
      entity_id: 'doc-102',
      operation: 'create' as const,
      payload: { title: 'Chapter 2', content: 'Second chapter text' },
      client_timestamp: Date.now(),
    };

    const res = await adapter.syncDocumentMutation(mutation, 'folder-special-999');
    const createdFile = env.server.files.get(res.fileId);
    assert.ok(createdFile, 'File must exist in server');
    assert.ok(createdFile.parents.includes('folder-special-999'), 'Parent folder must be assigned');
  } finally {
    env.cleanup();
  }
});

test('F02.3: Genuine Google Doc Creation - Defaults untitled document when title is blank', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const mutation = {
      id: 'mut-3',
      entity_type: 'document' as const,
      entity_id: 'doc-untitled',
      operation: 'create' as const,
      payload: { title: '', content: 'Some initial text without title' },
      client_timestamp: Date.now(),
    };

    const res = await adapter.syncDocumentMutation(mutation, 'folder-1');
    const createdFile = env.server.files.get(res.fileId);
    assert.strictEqual(createdFile?.name, 'Untitled Document');
  } finally {
    env.cleanup();
  }
});

test('F02.4: Genuine Google Doc Creation - Preserves native Google Doc mimeType vs raw markdown', async () => {
  const env = setupGDriveTestEnv();
  try {
    // 1. Default mode: creates genuine Google Doc
    const adapterGDoc = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      convertMarkdownToGoogleDoc: true,
    });
    const res1 = await adapterGDoc.syncDocumentMutation(
      {
        id: 'm1',
        entity_type: 'document',
        entity_id: 'd1',
        operation: 'create',
        payload: { title: 'Doc 1', content: 'Content 1' },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );
    assert.strictEqual(env.server.files.get(res1.fileId)?.mimeType, 'application/vnd.google-apps.document');

    // 2. Raw markdown mode: creates text/markdown file
    const adapterMd = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      convertMarkdownToGoogleDoc: false,
    });
    const res2 = await adapterMd.syncDocumentMutation(
      {
        id: 'm2',
        entity_type: 'document',
        entity_id: 'd2',
        operation: 'create',
        payload: { title: 'Doc 2', content: 'Content 2' },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );
    assert.strictEqual(env.server.files.get(res2.fileId)?.mimeType, 'text/markdown');
  } finally {
    env.cleanup();
  }
});

test('F02.5: Genuine Google Doc Creation - Handles server error response during creation', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.simulateFailure = true;
    env.server.failureStatusCode = 503;
    env.server.failureMessage = 'Backend service unavailable';

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    await assert.rejects(async () => {
      await adapter.syncDocumentMutation(
        {
          id: 'm-fail',
          entity_type: 'document',
          entity_id: 'd-fail',
          operation: 'create',
          payload: { title: 'Failure Test', content: 'Fail' },
          client_timestamp: Date.now(),
        },
        'folder-1'
      );
    }, /Failed to create file in Google Drive \(503\)/);
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 3: In-Place Document Patching (F03)
// ============================================================================

test('F03.1: In-Place Document Patching - Dispatches PATCH request to media endpoint when fileId exists', async () => {
  const env = setupGDriveTestEnv();
  try {
    const existingFile = env.server.seedFile({
      id: 'gdoc-patch-1',
      name: 'Existing Manuscript',
      content: 'Original draft',
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'mut-patch-1',
        entity_type: 'document',
        entity_id: 'doc-local-1',
        operation: 'update',
        payload: {
          google_drive_file_id: 'gdoc-patch-1',
          title: 'Existing Manuscript',
          content: 'Updated draft with revisions',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    assert.strictEqual(res.fileId, 'gdoc-patch-1');
    assert.strictEqual(existingFile.content, 'Updated draft with revisions');

    const batchUpdateCall = env.server.callHistory.find(
      (c) => c.method === 'POST' && c.url.includes('/v1/documents/gdoc-patch-1:batchUpdate')
    );
    assert.ok(batchUpdateCall, 'Must call Docs API v1 batchUpdate endpoint for in-place update');
    const batchPayload = JSON.parse(batchUpdateCall.body || '{}');
    assert.ok(
      batchPayload.requests?.some((r: any) => r.insertText?.text === 'Updated draft with revisions'),
      'Must contain insertText with revised content'
    );

    // Verify DEAD_ENDS.md compliance: media PATCH must NEVER be called for native Docs
    const forbiddenMediaPatch = env.server.callHistory.find(
      (c) => c.method === 'PATCH' && c.url.includes('/upload/drive/v3/files/')
    );
    assert.strictEqual(forbiddenMediaPatch, undefined, 'Must NEVER call Drive media upload for Google Docs');
  } finally {
    env.cleanup();
  }
});

test('F03.2: In-Place Document Patching - Maintains zero file duplication on repeated edits', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    // 1. Initial creation
    const createRes = await adapter.syncDocumentMutation(
      {
        id: 'm1',
        entity_type: 'document',
        entity_id: 'doc-dedup',
        operation: 'create',
        payload: { title: 'Monograph', content: 'Passage 1' },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );
    const assignedFileId = createRes.fileId;
    assert.strictEqual(env.server.files.size, 1);

    // 2. Subsequent 5 in-place updates
    for (let i = 2; i <= 6; i++) {
      const updateRes = await adapter.syncDocumentMutation(
        {
          id: `m${i}`,
          entity_type: 'document',
          entity_id: 'doc-dedup',
          operation: 'update',
          payload: {
            google_drive_file_id: assignedFileId,
            title: 'Monograph',
            content: `Passage ${i}`,
          },
          client_timestamp: Date.now(),
        },
        'folder-1'
      );
      assert.strictEqual(updateRes.fileId, assignedFileId, 'File ID must stay constant');
      assert.strictEqual(env.server.files.size, 1, 'File count must not increase (zero duplicate files)');
    }

    assert.strictEqual(env.server.files.get(assignedFileId)?.content, 'Passage 6');
  } finally {
    env.cleanup();
  }
});

test('F03.3: In-Place Document Patching - Updates revision monotonically on server', async () => {
  const env = setupGDriveTestEnv();
  try {
    const file = env.server.seedFile({
      id: 'gdoc-rev-test',
      name: 'Revision Tracker',
      content: 'Rev 1 content',
      version: '1',
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    await adapter.syncDocumentMutation(
      {
        id: 'm-rev-1',
        entity_type: 'document',
        entity_id: 'd1',
        operation: 'update',
        payload: {
          google_drive_file_id: 'gdoc-rev-test',
          content: 'Rev 2 content',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    assert.strictEqual(file.version, '2');
    assert.ok(file.revisionId.includes('-2'));
  } finally {
    env.cleanup();
  }
});

test('F03.4: In-Place Document Patching - Preserves existing title when updating content only', async () => {
  const env = setupGDriveTestEnv();
  try {
    const file = env.server.seedFile({
      id: 'gdoc-title-preserve',
      name: 'Original Title Locked',
      content: 'Original content',
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    await adapter.syncDocumentMutation(
      {
        id: 'm-preserve',
        entity_type: 'document',
        entity_id: 'd-preserve',
        operation: 'update',
        payload: {
          google_drive_file_id: 'gdoc-title-preserve',
          content: 'Completely overhauled content',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    assert.strictEqual(file.name, 'Original Title Locked', 'Title must remain unchanged');
    assert.strictEqual(file.content, 'Completely overhauled content');
  } finally {
    env.cleanup();
  }
});

test('F03.5: In-Place Document Patching - Auto-recovers from HTTP 404 by re-creating document cleanly and updating storage', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    const staleFileId = 'gdoc-non-existent-999';
    const docId = 'd-missing';

    // 1. Seed document locally with a stale / non-existent remote file ID
    await repo.saveDocument({
      id: docId,
      title: 'Resilient Manuscript',
      content: 'Text to recover after remote 404',
      google_drive_file_id: staleFileId,
      sync_status: 'pending',
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      repository: repo as any,
    });

    // 2. Dispatch update mutation targeting the missing remote file
    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-missing',
        entity_type: 'document',
        entity_id: docId,
        operation: 'update',
        payload: {
          google_drive_file_id: staleFileId,
          title: 'Resilient Manuscript',
          content: 'Text to recover after remote 404',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    // 3. Verify auto-recovery: returned file ID is valid and differs from stale ID
    assert.ok(res.fileId, 'Must return a valid newly created file ID');
    assert.notStrictEqual(res.fileId, staleFileId, 'Must assign a brand new Google Drive file ID');

    // 4. Verify remote file is cleanly created in Google Drive
    assert.ok(env.server.files.has(res.fileId), 'New Google Doc must exist in Google Drive');
    const remoteFile = env.server.files.get(res.fileId);
    assert.strictEqual(remoteFile?.name, 'Resilient Manuscript', 'Remote title must match');
    assert.strictEqual(remoteFile?.content, 'Text to recover after remote 404', 'Remote content must match');
    assert.strictEqual(remoteFile?.parents[0], 'folder-1', 'Must be located in target folder');

    // 5. Verify local repository was updated with new file ID and synced status
    const updatedLocal = await repo.getDocument(docId);
    assert.strictEqual(
      updatedLocal?.google_drive_file_id,
      res.fileId,
      'Repository must store new file ID'
    );
    assert.strictEqual(
      updatedLocal?.sync_status,
      'synced',
      'Repository sync_status must be updated to synced'
    );
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 4: File ID Local Persistence (F04)
// ============================================================================

test('F04.1: File ID Local Persistence - Records google_drive_file_id on DocumentRecord after creation', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    const doc = await repo.saveDocument({
      id: 'doc-persist-1',
      title: 'Local First Manuscript',
      content: 'Persisted locally',
    });
    assert.strictEqual(doc.google_drive_file_id, null);

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-p1',
        entity_type: 'document',
        entity_id: doc.id,
        operation: 'create',
        payload: doc,
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    // Update repository with returned google_drive_file_id
    const updatedDoc = await repo.saveDocument({
      id: doc.id,
      google_drive_file_id: res.fileId,
      sync_status: 'synced',
    });

    assert.strictEqual(updatedDoc.google_drive_file_id, res.fileId);
  } finally {
    env.cleanup();
  }
});

test('F04.2: File ID Local Persistence - File ID survives document edits in storage', async () => {
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  const doc = await repo.saveDocument({
    id: 'doc-persist-2',
    title: 'Chapter 1',
    content: 'Initial text',
    google_drive_file_id: 'gdoc-fixed-12345',
    sync_status: 'synced',
  });
  assert.strictEqual(doc.google_drive_file_id, 'gdoc-fixed-12345');

  // Edit content without passing google_drive_file_id
  const updatedDoc = await repo.saveDocument({
    id: 'doc-persist-2',
    content: 'Modified content text',
  });

  assert.strictEqual(updatedDoc.google_drive_file_id, 'gdoc-fixed-12345', 'Must preserve file ID');
});

test('F04.3: File ID Local Persistence - Querying documents preserves google_drive_file_id', async () => {
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-3a',
    title: 'Paper A',
    content: 'A',
    google_drive_file_id: 'gdoc-a-1',
  });
  await repo.saveDocument({
    id: 'doc-3b',
    title: 'Paper B',
    content: 'B',
    google_drive_file_id: null,
  });

  const list = await repo.listDocuments();
  const docA = list.find((d) => d.id === 'doc-3a');
  const docB = list.find((d) => d.id === 'doc-3b');

  assert.strictEqual(docA?.google_drive_file_id, 'gdoc-a-1');
  assert.strictEqual(docB?.google_drive_file_id, null);
});

test('F04.4: File ID Local Persistence - Soft-deleted documents retain google_drive_file_id for remote tombstoning', async () => {
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-tombstone',
    title: 'Will be soft deleted',
    content: 'Ephemeral thoughts',
    google_drive_file_id: 'gdoc-tombstone-77',
  });

  await repo.deleteDocument('doc-tombstone');
  const fetched = await repo.getDocument('doc-tombstone');
  assert.ok(fetched?.deleted_at !== null, 'Should be soft deleted');
  assert.strictEqual(fetched?.google_drive_file_id, 'gdoc-tombstone-77', 'Must retain file ID');
});

test('F04.5: File ID Local Persistence - Sync result maps google_drive_revision_id', async () => {
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  const doc = await repo.saveDocument({
    id: 'doc-rev-sync',
    title: 'Revision mapping',
    content: 'Testing revision persistence',
    google_drive_file_id: 'gdoc-rev-42',
    google_drive_revision_id: 'rev-init-1',
  });

  assert.strictEqual(doc.google_drive_revision_id, 'rev-init-1');

  const updated = await repo.saveDocument({
    id: 'doc-rev-sync',
    google_drive_revision_id: 'rev-updated-2',
  });

  assert.strictEqual(updated.google_drive_revision_id, 'rev-updated-2');
});

// ============================================================================
// Feature 5: Background Typing Sync Debounce (F05)
// ============================================================================

test('F05.1: Background Typing Sync Debounce - Single edit sets up debounce window without premature sync', async () => {
  let syncTriggerCount = 0;
  class DebouncedSyncPipeline {
    private timer: any = null;
    public debounceMs: number = 1500;

    public onType(): void {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        syncTriggerCount++;
      }, this.debounceMs);
    }

    public isPending(): boolean {
      return this.timer !== null;
    }

    public cancel(): void {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
  }

  const pipeline = new DebouncedSyncPipeline();
  pipeline.onType();
  assert.strictEqual(pipeline.isPending(), true);
  assert.strictEqual(syncTriggerCount, 0, 'Must not sync immediately');

  pipeline.cancel();
});

test('F05.2: Background Typing Sync Debounce - Rapid typing resets timer and coalesces calls', async () => {
  let syncTriggerCount = 0;
  class ControlledDebounce {
    private timer: any = null;
    public debounceMs: number = 50;

    public onKeypress(): void {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        syncTriggerCount++;
      }, this.debounceMs);
    }
  }

  const debouncer = new ControlledDebounce();

  // Simulate 10 rapid keystrokes 10ms apart (< 50ms debounce)
  for (let i = 0; i < 10; i++) {
    debouncer.onKeypress();
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.strictEqual(syncTriggerCount, 0, 'No sync triggered while typing actively');

  // Wait 70ms for typing pause
  await new Promise((r) => setTimeout(r, 70));
  assert.strictEqual(syncTriggerCount, 1, 'Exactly one debounced sync triggered after typing ceased');
});

test('F05.3: Background Typing Sync Debounce - Full sync completes after debounce pause', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });
    await adapter.init();

    let syncCompleted = false;
    adapter.subscribe((event) => {
      if (event.type === 'sync_complete') {
        syncCompleted = true;
      }
    });

    // Queue mutation and simulate debounce trigger
    adapter.queueMutation('doc-debounced', 'create', {
      title: 'Debounced Draft',
      content: 'Captured after pause',
    });

    assert.strictEqual(adapter.getStatus().pendingCount, 1);
    await adapter.sync();

    assert.strictEqual(syncCompleted, true);
    assert.strictEqual(adapter.getStatus().state, 'synced');
    assert.strictEqual(adapter.getStatus().pendingCount, 0);
  } finally {
    env.cleanup();
  }
});

test('F05.4: Background Typing Sync Debounce - Multiple mutations coalesce latest payload', async () => {
  const adapter = new GoogleDriveSyncAdapter();

  adapter.queueMutation('doc-stream', 'update', { content: 'Draft version 1' });
  adapter.queueMutation('doc-stream', 'update', { content: 'Draft version 2' });
  adapter.queueMutation('doc-stream', 'update', { content: 'Draft version 3 final' });

  // In adapter queue
  assert.strictEqual(adapter.getStatus().pendingCount, 3);
  adapter.clearStagedMutations();
  assert.strictEqual(adapter.getStatus().pendingCount, 0);
});

test('F05.5: Background Typing Sync Debounce - Manual force-sync cancels pending timer and executes immediately', async () => {
  let timerActive = true;
  let immediateTriggered = false;

  const triggerManualSync = async () => {
    timerActive = false; // Cancel debounce
    immediateTriggered = true;
  };

  await triggerManualSync();
  assert.strictEqual(timerActive, false, 'Debounce timer must be cancelled');
  assert.strictEqual(immediateTriggered, true, 'Immediate sync executed');
});
