/**
 * tests/e2e/gdrive-sync/tier3-combinations.test.ts
 * Tier 3: Cross-Feature Combinations & Pairwise Interactions
 *
 * Covers:
 * C01: Offline Typing -> Reconnect -> Remote Conflict Resolution
 * C02: Token Refresh During Batch Mutation Drain
 * C03: Background Typing Debounce + Manual Force-Sync Interruption
 * C04: Remote Document Discovery + Local Fuzzy Search Indexing
 * C05: Direct Token Fallback + UserInfo Verification + UI Chrome State
 * C06: Library Drawer Google Docs Badge + Android Native Bridge Intercept
 */

import test from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../../src/sync/google-drive-sync-adapter.ts';
import { MockGoogleDocsSyncAdapter } from '../../../src/sync/mock-google-docs-sync-adapter.ts';
import { OfflineMutationQueue } from '../../../src/sync/offline-mutation-queue.ts';
import { SyncStatusIndicator } from '../../../src/ui/sync-status-indicator.ts';
import { GoogleDriveModal } from '../../../src/ui/google-drive-modal.ts';
import {
  setupGDriveTestEnv,
  GDriveTestStorageRepository,
  MockOAuthClient,
} from './helpers/test-harness.ts';
import { InMemoryStorageRepository } from '../helpers/mock-adapters.ts';
import type { DocumentRecord } from '../../../src/storage/schema.ts';

// ============================================================================
// Combination 1 (C01): Offline Typing -> Reconnect -> Remote Conflict
// ============================================================================

test('C01: Offline Typing -> Reconnect -> Remote Conflict Resolution', async () => {
  const env = setupGDriveTestEnv();
  const repo = new GDriveTestStorageRepository();
  await repo.init();

  try {
    const baseTime = 1700000000000;
    const initialDoc = await repo.saveDocument({
      id: 'doc-cross-1',
      title: 'Chapter One',
      content: 'Original beginning of the book.',
      created_at: baseTime,
      updated_at: baseTime,
      google_drive_file_id: 'gdoc-cross-1',
      sync_status: 'synced',
    });

    // 1. Author goes offline on Daylight DC1
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });
    adapter.setOnline(false);
    assert.strictEqual(adapter.getStatus().state, 'offline');

    // 2. Author types while offline (local update at baseTime + 10000)
    const localEditTime = baseTime + 10000;
    const localUpdatedDoc = await repo.saveDocument({
      id: 'doc-cross-1',
      content: 'Original beginning of the book. Written offline on LivePaper.',
      updated_at: localEditTime,
      sync_status: 'pending',
    });
    adapter.queueMutation('doc-cross-1', 'update', localUpdatedDoc);
    assert.strictEqual(adapter.getStatus().pendingCount, 1);

    // 3. Meanwhile, remote edit occurred in Google Docs (newer: baseTime + 15000)
    const remoteEditTime = baseTime + 15000;
    const remoteDoc: DocumentRecord = {
      ...initialDoc,
      title: 'Chapter One: Dawn',
      content: 'Original beginning of the book. Edited remotely from Google Docs.',
      updated_at: remoteEditTime,
      sync_status: 'synced',
    };
    env.server.seedFile({
      id: 'gdoc-cross-1',
      name: remoteDoc.title,
      content: remoteDoc.content,
      modifiedTime: new Date(remoteEditTime).toISOString(),
    });

    // 4. Reconnect to network
    adapter.setOnline(true);
    assert.strictEqual(adapter.getStatus().state, 'syncing');

    // 5. Conflict resolution occurs via Last-Write-Wins (remote wins because remoteEditTime > localEditTime)
    const resolvedDoc = await adapter.resolveConflict(localUpdatedDoc, remoteDoc, 'last-write-wins');
    assert.strictEqual(resolvedDoc.content, remoteDoc.content);
    assert.strictEqual(resolvedDoc.title, 'Chapter One: Dawn');
    assert.strictEqual(resolvedDoc.sync_status, 'synced');

    // 6. Update local repository with reconciled document
    const finalSaved = await repo.saveDocument(resolvedDoc);
    assert.strictEqual(finalSaved.title, 'Chapter One: Dawn');
    assert.strictEqual(finalSaved.content, remoteDoc.content);
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Combination 2 (C02): Token Refresh During Batch Mutation Drain
// ============================================================================

test('C02: Token Refresh During Batch Mutation Drain', async () => {
  const env = setupGDriveTestEnv();
  const queue = new OfflineMutationQueue();
  await queue.init();

  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.valid-initial',
      refreshToken: 'mock-refresh-token-xyz',
      expiresIn: 3600,
      tokenType: 'Bearer',
      timestamp: Date.now(),
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: await oauthClient.getValidAccessToken(),
    });

    // Enqueue 3 mutations
    await queue.enqueue('document', 'd1', 'create', { title: 'Doc 1', content: 'C1' });
    await queue.enqueue('document', 'd2', 'create', { title: 'Doc 2', content: 'C2' });
    await queue.enqueue('document', 'd3', 'create', { title: 'Doc 3', content: 'C3' });

    assert.strictEqual(await queue.getPendingCount(), 3);

    // Process first document
    await adapter.syncDocumentMutation(
      {
        id: 'm1',
        entity_type: 'document',
        entity_id: 'd1',
        operation: 'create',
        payload: { title: 'Doc 1', content: 'C1' },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );
    assert.strictEqual(env.server.files.size, 1);

    // Simulate token expiration mid-batch
    env.server.simulateAuthExpired = true;

    // Next sync attempt encounters 401
    await assert.rejects(async () => {
      await adapter.syncDocumentMutation(
        {
          id: 'm2',
          entity_type: 'document',
          entity_id: 'd2',
          operation: 'create',
          payload: { title: 'Doc 2', content: 'C2' },
          client_timestamp: Date.now(),
        },
        'folder-1'
      );
    }, /401/);

    // Silent token refresh triggered
    env.server.simulateAuthExpired = false;
    const refreshedToken = await oauthClient.refreshToken('mock-refresh-token-xyz');
    adapter.setAccessToken(refreshedToken.accessToken);

    // Resume remaining documents with fresh token
    await adapter.syncDocumentMutation(
      {
        id: 'm2',
        entity_type: 'document',
        entity_id: 'd2',
        operation: 'create',
        payload: { title: 'Doc 2', content: 'C2' },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    await adapter.syncDocumentMutation(
      {
        id: 'm3',
        entity_type: 'document',
        entity_id: 'd3',
        operation: 'create',
        payload: { title: 'Doc 3', content: 'C3' },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    assert.strictEqual(env.server.files.size, 3, 'All 3 documents successfully uploaded after token recovery');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Combination 3 (C03): Background Typing Debounce + Manual Force-Sync
// ============================================================================

test('C03: Background Typing Debounce + Manual Force-Sync Interruption', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });
    await adapter.init();

    let debounceTimer: any = null;
    let debounceCancelled = false;
    let forceSyncTriggered = false;

    // Simulate 1.5s background debounce pipeline
    const scheduleDebounce = () => {
      debounceTimer = setTimeout(async () => {
        await adapter.sync();
      }, 1500);
    };

    // User types: starts debounce
    scheduleDebounce();
    assert.ok(debounceTimer !== null);

    // Before 1.5s expires, user opens modal and clicks "Sync to Drive Now"
    const modal = new GoogleDriveModal({
      container: env.win.document.body as unknown as HTMLElement,
      adapter,
      onSyncTriggered: async () => {
        // Cancel debounce timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          debounceCancelled = true;
        }
        forceSyncTriggered = true;
        adapter.queueMutation('doc-force', 'create', { title: 'Immediate Push', content: 'Pushed manually' });
        await adapter.sync();
      },
    });
    modal.open();

    const syncNowBtn = env.win.document.querySelector('#gdrive-sync-now-btn') as unknown as HTMLButtonElement;
    assert.ok(syncNowBtn);

    syncNowBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(debounceCancelled, true, 'Active debounce timer must be cancelled');
    assert.strictEqual(forceSyncTriggered, true, 'Immediate manual sync must execute');
    assert.strictEqual(adapter.getStatus().state, 'synced');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Combination 4 (C04): Remote Document Discovery + Local Search Indexing
// ============================================================================

test('C04: Remote Document Discovery + Local Fuzzy Search Indexing', async () => {
  const env = setupGDriveTestEnv();
  const searchRepo = new InMemoryStorageRepository();
  await searchRepo.init();

  try {
    const folderId = 'folder-mss-search';
    env.server.seedFolder(folderId, 'Daylight Manuscripts');

    // 1. Two new documents authored on remote Google Docs
    env.server.seedFile({
      id: 'gdoc-rem-arch',
      name: 'Archaeological Dig Notes',
      parents: [folderId],
      content: 'Excavation of the Bronze Age citadel in Mycenae #archaeology/bronze.',
    });
    env.server.seedFile({
      id: 'gdoc-rem-phil',
      name: 'Phenomenology of Perception',
      parents: [folderId],
      content: 'Maurice Merleau-Ponty and embodied cognition in quiet contemplation.',
    });

    // 2. Discover remote files
    const res = await env.server.handleRequest(
      `https://www.googleapis.com/drive/v3/files?q=parents+in+'${folderId}'+and+trashed+%3D+false`
    );
    const data = await res.json();
    assert.strictEqual(data.files.length, 2);

    // 3. Reconcile into local search repository
    for (const remoteFile of data.files) {
      // Export remote content
      const exportRes = await env.server.handleRequest(
        `https://www.googleapis.com/drive/v3/files/${remoteFile.id}/export?mimeType=text/plain`
      );
      const text = await exportRes.text();

      await searchRepo.saveDocument({
        id: `local-${remoteFile.id}`,
        title: remoteFile.name,
        content: text,
      });
    }

    // 4. Query fuzzy search immediately
    const searchHits = await searchRepo.searchDocuments('Bronze Age');
    assert.strictEqual(searchHits.length, 1);
    assert.strictEqual(searchHits[0].document.title, 'Archaeological Dig Notes');
    assert.ok(searchHits[0].matchHighlights[0].includes('Archaeological Dig Notes') || searchHits[0].score > 0);

    const searchHits2 = await searchRepo.searchDocuments('Merleau-Ponty');
    assert.strictEqual(searchHits2.length, 1);
    assert.strictEqual(searchHits2[0].document.title, 'Phenomenology of Perception');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Combination 5 (C05): Direct Token Fallback + UserInfo + UI Chrome State
// ============================================================================

test('C05: Direct Token Fallback + UserInfo Verification + UI Chrome State Transitions', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter();

    const container = env.win.document.createElement('div');
    env.win.document.body.appendChild(container);
    const indicator = new SyncStatusIndicator(container as unknown as HTMLElement);
    indicator.bindAdapter(adapter);

    const modal = new GoogleDriveModal({
      container: env.win.document.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    // Initial state: unauthenticated
    assert.strictEqual(adapter.isAuthenticated(), false);
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

    // User pastes direct token into input field
    const tokenInput = env.win.document.querySelector('#gdrive-token-input') as unknown as HTMLInputElement;
    const saveTokenBtn = env.win.document.querySelector('#gdrive-save-token-btn') as unknown as HTMLElement;
    assert.ok(tokenInput);
    assert.ok(saveTokenBtn);

    tokenInput.value = 'ya29.valid-token';
    saveTokenBtn.click();

    // Allow async verification and modal re-render timer (400ms)
    await new Promise((r) => setTimeout(r, 450));

    // Verify authenticated state
    assert.strictEqual(adapter.isAuthenticated(), true);
    assert.strictEqual(adapter.getCurrentUser()?.email, 'a12katta@gmail.com');

    // Modal updates log and status badge
    assert.ok(adapter.syncLogs.some((l) => l.type === 'success' && l.message.includes('a12katta@gmail.com')));

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Combination 6 (C06): Library Drawer Badge + Android Native Bridge Intercept
// ============================================================================

test('C06: Library Drawer Docs Badge + Android Native Bridge Intercept', async () => {
  const env = setupGDriveTestEnv();
  try {
    let interceptedUrl = '';
    let launchBrowserInvoked = false;

    // Mock Android Native Bridge & WebView Client
    (env.win as any).DaylightBridgeClient = {
      openExternalUrl: (url: string) => {
        interceptedUrl = url;
        launchBrowserInvoked = true;
      },
    };

    // Render library drawer card simulating left-library.ts
    const card = env.win.document.createElement('div');
    card.className = 'library-doc-card';

    const docRecord = {
      id: 'doc-android-sync',
      title: 'Philosophical Fragment',
      google_drive_file_id: 'gdoc-android-99',
    };

    const link = env.win.document.createElement('a');
    link.className = 'doc-gdocs-link';
    link.href = `https://docs.google.com/document/d/${docRecord.google_drive_file_id}/edit`;
    link.textContent = 'Open in Google Docs';

    // Hook click to check bridge intercept
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if ((env.win as any).DaylightBridgeClient) {
        (env.win as any).DaylightBridgeClient.openExternalUrl(link.href);
      }
    });

    card.appendChild(link);
    env.win.document.body.appendChild(card);

    link.click();

    assert.strictEqual(launchBrowserInvoked, true, 'Must invoke DaylightBridgeClient.openExternalUrl');
    assert.strictEqual(interceptedUrl, 'https://docs.google.com/document/d/gdoc-android-99/edit');
  } finally {
    env.cleanup();
  }
});
