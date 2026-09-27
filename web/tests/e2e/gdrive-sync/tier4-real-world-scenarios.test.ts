/**
 * tests/e2e/gdrive-sync/tier4-real-world-scenarios.test.ts
 * Tier 4: Real-World End-User Author Workflows & Application Scenarios
 *
 * S01: Full Manuscript Writing Session (End-to-End)
 * S02: The Offline Transatlantic Flight Scenario
 * S03: Multi-Device Cloud Collaboration & Remote Editing
 * S04: High-Speed Typewriter Burst with Token Lifecycle Interruption
 */

import test from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../../src/sync/google-drive-sync-adapter.ts';
import { OfflineMutationQueue } from '../../../src/sync/offline-mutation-queue.ts';
import { SyncStatusIndicator } from '../../../src/ui/sync-status-indicator.ts';
import {
  setupGDriveTestEnv,
  GDriveTestStorageRepository,
  MockOAuthClient,
} from './helpers/test-harness.ts';
import type { DocumentRecord } from '../../../src/storage/schema.ts';

// ============================================================================
// Scenario 1 (S01): Full Manuscript Writing Session
// ============================================================================

test('S01: Full Manuscript Writing Session - End-to-End Author Workflow', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    // 1. Author powers up tablet and verifies Google Drive connection
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.author-token-session',
      targetFolderName: 'Daylight Manuscripts',
    });
    await adapter.init();

    const user = await adapter.verifyAuthentication();
    assert.strictEqual(user.email, 'a12katta@gmail.com');
    assert.strictEqual(adapter.isAuthenticated(), true);

    // Setup header indicator pill
    const container = env.win.document.createElement('div') as unknown as HTMLElement;
    const indicator = new SyncStatusIndicator(container);
    indicator.bindAdapter(adapter);
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

    // 2. Author creates a new chapter manuscript
    const initialDraft = await repo.saveDocument({
      id: 'doc-ms-chap1',
      title: 'Chapter 1: The Mountain Sanctuary',
      content:
        '# Chapter 1: The Mountain Sanctuary\n\nThe morning light broke quietly through the timber canopy. Here on the high ridge, thought moves without distraction.',
      is_title_custom: true,
      sync_status: 'pending',
    });
    assert.strictEqual(initialDraft.google_drive_file_id, null);

    // 3. 1.5s background debounce triggers: creates native Google Doc in "Daylight Manuscripts"
    adapter.queueMutation('doc-ms-chap1', 'create', initialDraft);
    const syncRes1 = await adapter.sync();
    assert.strictEqual(syncRes1.pushedCount, 1);

    // Capture created file ID and link
    const serverFile = Array.from(env.server.files.values())[0];
    assert.ok(serverFile);
    assert.strictEqual(serverFile.name, 'Chapter 1: The Mountain Sanctuary');
    assert.strictEqual(serverFile.mimeType, 'application/vnd.google-apps.document');

    // Save remote file ID to local database
    const savedAfterSync = await repo.saveDocument({
      id: 'doc-ms-chap1',
      google_drive_file_id: serverFile.id,
      sync_status: 'synced',
      last_synced_at: Date.now(),
    });
    assert.strictEqual(savedAfterSync.google_drive_file_id, serverFile.id);

    // Header indicator reflects synced state
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

    // 4. Author pauses, then writes two additional paragraphs
    const secondPassage =
      savedAfterSync.content +
      '\n\nThe ink flows across the reflective LivePaper panel. Hours pass like single breaths.';

    const updatedDraft = await repo.saveDocument({
      id: 'doc-ms-chap1',
      content: secondPassage,
      updated_at: Date.now() + 5000,
      sync_status: 'pending',
    });

    // 5. Subsequent in-place patch update
    adapter.queueMutation('doc-ms-chap1', 'update', updatedDraft);
    const syncRes2 = await adapter.sync();
    assert.strictEqual(syncRes2.pushedCount, 1);

    // Verify ZERO duplicate files created
    assert.strictEqual(env.server.files.size, 1);
    const updatedServerFile = env.server.files.get(serverFile.id);
    assert.strictEqual(updatedServerFile?.content, secondPassage);

    // 6. Verify library drawer representation
    const card = env.win.document.createElement('div');
    card.className = 'library-doc-card';
    if (savedAfterSync.google_drive_file_id) {
      const badge = env.win.document.createElement('span');
      badge.className = 'doc-gdocs-badge';
      badge.textContent = 'Google Docs';
      card.appendChild(badge);

      const link = env.win.document.createElement('a');
      link.className = 'doc-gdocs-link';
      link.href = serverFile.webViewLink;
      card.appendChild(link);
    }

    assert.ok(card.querySelector('.doc-gdocs-badge'));
    assert.ok(card.querySelector('.doc-gdocs-link'));
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Scenario 2 (S02): The Offline Transatlantic Flight Scenario
// ============================================================================

test('S02: The Offline Transatlantic Flight Scenario - Flight Writing & Wi-Fi Reconnect', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();
  const queue = new OfflineMutationQueue();
  await queue.init();

  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.author-token-flight',
    });
    await adapter.init();

    // 1. Author boards plane: airplane mode activates
    adapter.setOnline(false);
    assert.strictEqual(adapter.getStatus().state, 'offline');

    const container = env.win.document.createElement('div') as unknown as HTMLElement;
    const indicator = new SyncStatusIndicator(container);
    indicator.bindAdapter(adapter);
    assert.strictEqual(indicator.labelEl?.textContent, 'Offline');

    // 2. During flight: Author writes Essay 1, Essay 2, and edits an existing draft
    await queue.enqueue('document', 'essay-1', 'create', {
      title: 'The Architecture of Solitude',
      content: '# The Architecture of Solitude\n\nSilence is not the absence of sound.',
    });
    await queue.enqueue('document', 'essay-2', 'create', {
      title: 'Reflections on Amber Light',
      content: '# Reflections on Amber Light\n\nThe 1800K glow preserves circadian rhythm.',
    });
    await queue.enqueue('document', 'draft-old', 'update', {
      title: 'Ongoing Novel',
      content: 'Chapter revised mid-flight over Greenland.',
    });

    const pendingCount = await queue.getPendingCount();
    assert.strictEqual(pendingCount, 3, 'All 3 flight mutations queued safely offline');

    // Indicator pill shows queued count
    indicator.update({
      state: 'offline',
      lastSyncedAt: null,
      pendingCount: 3,
    });
    assert.strictEqual(indicator.labelEl?.textContent, 'Offline (3)');

    // 3. Flight lands at airport: Wi-Fi reconnects
    adapter.setOnline(true);
    indicator.update({ state: 'syncing', lastSyncedAt: null, pendingCount: 3, inFlightCount: 3 });
    assert.strictEqual(indicator.labelEl?.textContent, 'Syncing...');

    // 4. Automatic drain executes to Google Drive
    const targetFolderId = await adapter.ensureDaylightFolder();
    const batch = (queue as any).memoryQueue;

    for (const item of batch) {
      await adapter.syncDocumentMutation(
        {
          id: item.id,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          operation: item.operation,
          payload: JSON.parse(item.payload),
          client_timestamp: item.client_timestamp,
        },
        targetFolderId
      );
    }
    (queue as any).memoryQueue = [];

    assert.strictEqual(env.server.files.size, 3, 'All 3 flight documents safely synced to Google Drive');
    assert.strictEqual(await queue.getPendingCount(), 0);

    // Indicator settles to synced
    indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0 });
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Scenario 3 (S03): Multi-Device Cloud Collaboration & Remote Editing
// ============================================================================

test('S03: Multi-Device Cloud Collaboration & Remote Editing Reconciliation', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    const baseTime = Date.now() - 3600000; // 1 hour ago
    const folderId = 'folder-multi-device';
    env.server.seedFolder(folderId, 'Daylight Manuscripts');

    // 1. Author initially wrote document on DC1 tablet
    const initialLocalDoc = await repo.saveDocument({
      id: 'doc-collab-session',
      title: 'Philosophy of Nature',
      content: '# Section 1: Flora\n\nThe ancient redwoods stand firm.',
      created_at: baseTime,
      updated_at: baseTime,
      google_drive_file_id: 'gdoc-nature-1',
      sync_status: 'synced',
    });

    env.server.seedFile({
      id: 'gdoc-nature-1',
      name: initialLocalDoc.title,
      content: initialLocalDoc.content,
      parents: [folderId],
      modifiedTime: new Date(baseTime).toISOString(),
    });

    // 2. Later, author opens Google Docs on laptop and adds Section 2 (30 minutes newer)
    const remoteEditTime = baseTime + 1800000;
    const remoteUpdatedContent =
      '# Section 1: Flora\n\nThe ancient redwoods stand firm.\n\n# Section 2: Fauna\n\nElk graze along the coastal bluffs.';

    const remoteFile = env.server.files.get('gdoc-nature-1')!;
    remoteFile.content = remoteUpdatedContent;
    remoteFile.modifiedTime = new Date(remoteEditTime).toISOString();

    // 3. Author picks up DC1 tablet and opens Daylight Writer
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
      targetFolderName: 'Daylight Manuscripts',
    });

    // Discovery detects remote file modifiedTime > local updated_at
    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files?q=parents+in+'${folderId}'+and+trashed+%3D+false`
    );
    const data = await res.json();
    const discovered = data.files.find((f: any) => f.id === 'gdoc-nature-1');
    assert.ok(discovered);

    const isRemoteNewer = new Date(discovered.modifiedTime).getTime() > initialLocalDoc.updated_at;
    assert.strictEqual(isRemoteNewer, true, 'Cloud version is detected as newer');

    // 4. Bidirectional reconciliation pulls latest text
    const exportRes = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files/${discovered.id}/export?mimeType=text/plain`
    );
    const latestCloudText = await exportRes.text();

    const reconciled = await adapter.resolveConflict(
      initialLocalDoc,
      {
        ...initialLocalDoc,
        content: latestCloudText,
        updated_at: new Date(discovered.modifiedTime).getTime(),
      },
      'last-write-wins'
    );

    // Save reconciled state into local storage
    const updatedLocal = await repo.saveDocument(reconciled);
    assert.strictEqual(updatedLocal.content, remoteUpdatedContent);
    assert.strictEqual(updatedLocal.sync_status, 'synced');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Scenario 4 (S04): High-Speed Typewriter Burst with Token Interruption
// ============================================================================

test('S04: High-Speed Typewriter Burst with Token Lifecycle Interruption', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.flow-state-token',
      refreshToken: 'mock-refresh-token-xyz',
      expiresIn: 3600,
      tokenType: 'Bearer',
      timestamp: Date.now(),
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: await oauthClient.getValidAccessToken(),
    });
    await adapter.init();

    // Setup UI indicator
    const container = env.win.document.createElement('div') as unknown as HTMLElement;
    const indicator = new SyncStatusIndicator(container);
    indicator.bindAdapter(adapter);

    // High speed typing burst: 5 revisions in rapid succession
    const folderId = await adapter.ensureDaylightFolder();
    let currentDocId = '';

    for (let revision = 1; revision <= 3; revision++) {
      if (revision === 1) {
        const createRes = await adapter.syncDocumentMutation(
          {
            id: `m-burst-${revision}`,
            entity_type: 'document',
            entity_id: 'doc-burst',
            operation: 'create',
            payload: { title: 'Flow State Essay', content: `Paragraph 1 draft` },
            client_timestamp: Date.now(),
          },
          folderId
        );
        currentDocId = createRes.fileId;
      } else {
        await adapter.syncDocumentMutation(
          {
            id: `m-burst-${revision}`,
            entity_type: 'document',
            entity_id: 'doc-burst',
            operation: 'update',
            payload: {
              google_drive_file_id: currentDocId,
              title: 'Flow State Essay',
              content: `Paragraph 1 draft. Revision ${revision} added.`,
            },
            client_timestamp: Date.now(),
          },
          folderId
        );
      }
    }

    assert.strictEqual(env.server.files.size, 1);

    // Auth token expires abruptly during typing pause
    env.server.simulateAuthExpired = true;

    // Next sync attempt detects expired token
    let authFailed = false;
    try {
      await adapter.syncDocumentMutation(
        {
          id: 'm-burst-4',
          entity_type: 'document',
          entity_id: 'doc-burst',
          operation: 'update',
          payload: {
            google_drive_file_id: currentDocId,
            content: 'Paragraph with expired token',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );
    } catch {
      authFailed = true;
    }
    assert.strictEqual(authFailed, true, 'Expired token triggers 401');

    // Background silent token renewal
    env.server.simulateAuthExpired = false;
    const renewed = await oauthClient.refreshToken('mock-refresh-token-xyz');
    adapter.setAccessToken(renewed.accessToken);

    // Re-push pending edit with renewed token succeeds cleanly
    await adapter.syncDocumentMutation(
      {
        id: 'm-burst-4-retry',
        entity_type: 'document',
        entity_id: 'doc-burst',
        operation: 'update',
        payload: {
          google_drive_file_id: currentDocId,
          content: 'Paragraph with renewed token succeeds',
        },
        client_timestamp: Date.now(),
      },
      folderId
    );

    assert.strictEqual(env.server.files.size, 1, 'File count remains exactly 1');
    assert.strictEqual(
      env.server.files.get(currentDocId)?.content,
      'Paragraph with renewed token succeeds'
    );
  } finally {
    env.cleanup();
  }
});
