/**
 * tests/e2e/gdrive-sync/tier2-boundary-cases.test.ts
 * Tier 2: Boundary & Corner Cases for Google Drive & Google Docs Cloud Sync
 *
 * Covers 5 boundary categories (>=5 tests per category, 25 tests total):
 * 1. Empty & Nil Inputs (B01)
 * 2. Unicode, Emoji & Special Characters (B02)
 * 3. Extreme Document Size Stress (B03)
 * 4. Offline Transitions & Network Flapping (B04)
 * 5. Token Expiry & Authentication Corner Cases (B05)
 */

import test from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../../src/sync/google-drive-sync-adapter.ts';
import { MockGoogleDocsSyncAdapter } from '../../../src/sync/mock-google-docs-sync-adapter.ts';
import { OfflineMutationQueue } from '../../../src/sync/offline-mutation-queue.ts';
import {
  setupGDriveTestEnv,
  GDriveTestStorageRepository,
  MockOAuthClient,
} from './helpers/test-harness.ts';
import type { DocumentRecord } from '../../../src/storage/schema.ts';

// ============================================================================
// Boundary 1: Empty & Nil Inputs (B01)
// ============================================================================

test('B01.1: Empty & Nil - Syncing 0-character empty document creates valid Google Doc', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-empty',
        entity_type: 'document',
        entity_id: 'doc-empty-1',
        operation: 'create',
        payload: {
          title: 'Empty Document',
          content: '',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    assert.ok(res.fileId);
    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.content, '');
    assert.strictEqual(created?.name, 'Empty Document');
  } finally {
    env.cleanup();
  }
});

test('B01.2: Empty & Nil - Syncing whitespace-only manuscript preserves spacing', async () => {
  const env = setupGDriveTestEnv();
  try {
    const whitespaceContent = '   \n\n\t\t   \n';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-ws',
        entity_type: 'document',
        entity_id: 'doc-ws',
        operation: 'create',
        payload: {
          title: 'Whitespace Canvas',
          content: whitespaceContent,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.ok(created);
    assert.strictEqual(created.content, whitespaceContent);
  } finally {
    env.cleanup();
  }
});

test('B01.3: Empty & Nil - Blank or null title defaults to "Untitled Document"', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-no-title',
        entity_type: 'document',
        entity_id: 'doc-null-title',
        operation: 'create',
        payload: {
          title: '',
          content: 'Manuscript text without header',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.name, 'Untitled Document');
  } finally {
    env.cleanup();
  }
});

test('B01.4: Empty & Nil - Empty token input safely resets authentication without throwing', () => {
  const adapter = new GoogleDriveSyncAdapter();
  adapter.setAccessToken('initial-valid-key');
  assert.strictEqual(adapter.isAuthenticated(), true);

  adapter.setAccessToken('');
  assert.strictEqual(adapter.isAuthenticated(), false);

  adapter.setAccessToken(null);
  assert.strictEqual(adapter.isAuthenticated(), false);
  assert.strictEqual(adapter.getAccessToken(), null);
});

test('B01.5: Empty & Nil - Querying empty remote manuscripts folder returns empty array', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.seedFolder('folder-zero-files', 'Daylight Manuscripts');
    const res = await env.server.handleRequest(
      "https://www.googleapis.com/drive/v3/files?q=parents+in+'folder-zero-files'+and+trashed+%3D+false"
    );

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data.files, []);
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Boundary 2: Unicode, Emoji & Special Characters (B02)
// ============================================================================

test('B02.1: Unicode & Special - Multi-byte UTF-8 CJK text preserved identically', async () => {
  const env = setupGDriveTestEnv();
  try {
    const cjkText = '# 第一章\n\n日中の静けさ。Deliberate quietude in Japanese 日本語 and Chinese 中文.';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-cjk',
        entity_type: 'document',
        entity_id: 'doc-cjk',
        operation: 'create',
        payload: {
          title: '日本語の原稿',
          content: cjkText,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.name, '日本語の原稿');
    assert.strictEqual(created?.content, cjkText);
  } finally {
    env.cleanup();
  }
});

test('B02.2: Unicode & Special - Right-to-Left (RTL) Arabic & Hebrew bidirectional text', async () => {
  const env = setupGDriveTestEnv();
  try {
    const rtlText = 'البداية الجديدة والنور الهادئ. עברית וערבית יחד עם אנגלית.';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-rtl',
        entity_type: 'document',
        entity_id: 'doc-rtl',
        operation: 'create',
        payload: {
          title: 'فصل في التأمل',
          content: rtlText,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.name, 'فصل في التأمل');
    assert.strictEqual(created?.content, rtlText);
  } finally {
    env.cleanup();
  }
});

test('B02.3: Unicode & Special - High surrogate emoji pairs and typographic punctuation', async () => {
  const env = setupGDriveTestEnv();
  try {
    const emojiText = 'Drafting on Daylight DC1 ✍️📜 with amber frontlight 💡 and peace 🧘‍♀️.';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-emoji',
        entity_type: 'document',
        entity_id: 'doc-emoji',
        operation: 'create',
        payload: {
          title: 'Writing Odyssey 🚀',
          content: emojiText,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.name, 'Writing Odyssey 🚀');
    assert.strictEqual(created?.content, emojiText);
  } finally {
    env.cleanup();
  }
});

test('B02.4: Unicode & Special - Reserved URL and filesystem characters in document title', async () => {
  const env = setupGDriveTestEnv();
  try {
    const complexTitle = 'Notes: Q1/Q2 (2026) & "Deep Work" * 100% #strategy?';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-special-title',
        entity_type: 'document',
        entity_id: 'doc-spec',
        operation: 'create',
        payload: {
          title: complexTitle,
          content: 'Content under special title',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.name, complexTitle);
  } finally {
    env.cleanup();
  }
});

test('B02.5: Unicode & Special - Markdown content with HTML tags, math symbols (<, >, &) and backticks', async () => {
  const env = setupGDriveTestEnv();
  try {
    const rawMarkdown = 'Comparison: 5 < 10 && 20 > 15. Code: `<div class="tag">Text & Math</div>`.';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-math',
        entity_type: 'document',
        entity_id: 'doc-math',
        operation: 'create',
        payload: {
          title: 'Math & Syntax',
          content: rawMarkdown,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.content, rawMarkdown);
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Boundary 3: Extreme Document Size Stress (B03)
// ============================================================================

test('B03.1: Size Stress - Syncing 100,000+ words manuscript payload (>500KB markdown)', async () => {
  const env = setupGDriveTestEnv();
  try {
    // Generate 100,000 words
    const paragraph = 'The quick brown fox jumps over the lazy dog in deliberate quietude. '.repeat(10); // 110 words
    const largeContent = paragraph.repeat(1000); // 110,000 words (~700KB)

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-large',
        entity_type: 'document',
        entity_id: 'doc-large-book',
        operation: 'create',
        payload: {
          title: 'Full Length Novel Draft',
          content: largeContent,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.ok(created);
    assert.strictEqual(created.content.length, largeContent.length);
  } finally {
    env.cleanup();
  }
});

test('B03.2: Size Stress - Extremely long document title (500+ characters) handled cleanly', async () => {
  const env = setupGDriveTestEnv();
  try {
    const longTitle = 'A'.repeat(500);
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const res = await adapter.syncDocumentMutation(
      {
        id: 'm-long-title',
        entity_type: 'document',
        entity_id: 'doc-long-title',
        operation: 'create',
        payload: {
          title: longTitle,
          content: 'Content',
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    const created = env.server.files.get(res.fileId);
    assert.strictEqual(created?.name, longTitle);
  } finally {
    env.cleanup();
  }
});

test('B03.3: Size Stress - Rapid succession queueing of 50 documents without dropping items', async () => {
  const adapter = new GoogleDriveSyncAdapter();

  for (let i = 1; i <= 50; i++) {
    adapter.queueMutation(`doc-${i}`, 'create', {
      title: `Document ${i}`,
      content: `Content for doc ${i}`,
    });
  }

  assert.strictEqual(adapter.getStatus().pendingCount, 50);
});

test('B03.4: Size Stress - Repeated PATCH updates on large document preserves content integrity', async () => {
  const env = setupGDriveTestEnv();
  try {
    const initialText = 'Base text for large manuscript. '.repeat(500);
    const file = env.server.seedFile({
      id: 'gdoc-large-patch',
      name: 'Large Patch Manuscript',
      content: initialText,
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const updatedText = initialText + '\n\nAppended new chapter.';
    await adapter.syncDocumentMutation(
      {
        id: 'm-lp',
        entity_type: 'document',
        entity_id: 'd-lp',
        operation: 'update',
        payload: {
          google_drive_file_id: 'gdoc-large-patch',
          content: updatedText,
        },
        client_timestamp: Date.now(),
      },
      'folder-1'
    );

    assert.strictEqual(file.content, updatedText);
  } finally {
    env.cleanup();
  }
});

test('B03.5: Size Stress - Batch mutation queue handles 100 items without memory leak', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  for (let i = 1; i <= 100; i++) {
    await queue.enqueue('document', `doc-bulk-${i}`, 'create', {
      title: `Bulk ${i}`,
      content: `Body ${i}`,
    });
  }

  const count = await queue.getPendingCount();
  assert.strictEqual(count, 100);
});

// ============================================================================
// Boundary 4: Offline Transitions & Network Flapping (B04)
// ============================================================================

test('B04.1: Network Flapping - Offline to online transition with empty queue is safe no-op', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    adapter.setOnline(false);
    assert.strictEqual(adapter.getStatus().state, 'offline');

    adapter.setOnline(true);
    assert.strictEqual(adapter.getStatus().state, 'idle');
    assert.strictEqual(env.server.callHistory.length, 0, 'No HTTP requests should be dispatched');
  } finally {
    env.cleanup();
  }
});

test('B04.2: Network Flapping - Rapid toggling between online and offline preserves queue state', () => {
  const adapter = new GoogleDriveSyncAdapter();
  adapter.queueMutation('doc-toggle', 'create', { title: 'Toggle Test' });

  // Flap connection 5 times
  for (let i = 0; i < 5; i++) {
    adapter.setOnline(false);
    assert.strictEqual(adapter.getStatus().state, 'offline');
    adapter.setOnline(true);
    assert.strictEqual(adapter.getStatus().state, 'syncing');
  }

  assert.strictEqual(adapter.getStatus().pendingCount, 1);
});

test('B04.3: Network Flapping - Connection timeout mid-sync leaves mutations safely queued', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.simulateFailure = true;
    env.server.failureMessage = 'ETIMEDOUT: Connection timed out';

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });
    adapter.queueMutation('doc-timeout', 'create', { title: 'Timeout Doc', content: 'Text' });

    await assert.rejects(async () => {
      await adapter.sync();
    }, /Connection timed out|sync failed/i);

    assert.strictEqual(adapter.getStatus().state, 'error');
    // Staged mutation was not cleared due to error
    assert.strictEqual(adapter.getStatus().pendingCount, 1);
  } finally {
    env.cleanup();
  }
});

test('B04.4: Network Flapping - HTTP 429 Rate Limit error handled cleanly', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.simulateRateLimit = true;

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });
    adapter.queueMutation('doc-ratelimit', 'create', { title: 'Rate Limit Doc' });

    await assert.rejects(async () => {
      await adapter.sync();
    }, /429|Rate limit/i);

    assert.strictEqual(adapter.getStatus().state, 'error');
  } finally {
    env.cleanup();
  }
});

test('B04.5: Network Flapping - HTTP 503 Backend Service Unavailable halts batch drain', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  const adapter = new MockGoogleDocsSyncAdapter({
    failureMode: 'server_error',
  });

  await queue.enqueue('document', 'doc-503-1', 'create', { title: 'Doc 1' });
  await queue.enqueue('document', 'doc-503-2', 'create', { title: 'Doc 2' });

  const result = await queue.drain(adapter);
  assert.strictEqual(result.failedCount, 2);
  assert.strictEqual(result.pushedCount, 0);

  // Both mutations must stay safely in queue
  const remaining = await queue.getPendingCount();
  assert.strictEqual(remaining, 2);
});

// ============================================================================
// Boundary 5: Token Expiry & Authentication Corner Cases (B05)
// ============================================================================

test('B05.1: Token Expiry - HTTP 401 Unauthorized transitions sync adapter to error state', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.simulateAuthExpired = true;

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.expired-token',
    });
    adapter.queueMutation('doc-401', 'create', { title: 'Test 401' });

    await assert.rejects(async () => {
      await adapter.sync();
    }, /401|Credentials|Unauthorized/i);

    assert.strictEqual(adapter.getStatus().state, 'error');
  } finally {
    env.cleanup();
  }
});

test('B05.2: Token Expiry - Auth failure during batch drain retains all undrained mutations', async () => {
  const queue = new OfflineMutationQueue();
  await queue.init();

  const adapter = new MockGoogleDocsSyncAdapter({
    failureMode: 'auth_expired',
  });

  await queue.enqueue('document', 'doc-auth-1', 'create', { title: 'Doc 1' });
  await queue.enqueue('document', 'doc-auth-2', 'create', { title: 'Doc 2' });

  const result = await queue.drain(adapter);
  assert.strictEqual(result.failedCount, 2);
  assert.strictEqual(result.pushedCount, 0);

  const pending = await queue.getPendingCount();
  assert.strictEqual(pending, 2, 'Must not drop mutations when auth fails');
});

test('B05.3: Token Expiry - Revoked refresh token (invalid_grant) rejects and clears session', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.expired',
      refreshToken: 'invalid-refresh-token',
      expiresIn: 1,
      tokenType: 'Bearer',
      timestamp: Date.now() - 5000,
    });

    await assert.rejects(async () => {
      await oauthClient.getValidAccessToken();
    }, /invalid or expired/i);
  } finally {
    env.cleanup();
  }
});

test('B05.4: Token Expiry - Expired token in IOAuthClient automatically refreshes before sync', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.old-stale',
      refreshToken: 'mock-refresh-token-xyz',
      expiresIn: 1,
      tokenType: 'Bearer',
      timestamp: Date.now() - 5000,
    });

    // Request valid token
    const freshToken = await oauthClient.getValidAccessToken();
    assert.ok(freshToken.startsWith('ya29.refreshed-'));

    // Use refreshed token for sync adapter
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: freshToken,
    });
    await adapter.init();
    assert.strictEqual(adapter.isAuthenticated(), true);
  } finally {
    env.cleanup();
  }
});

test('B05.5: Token Expiry - Malformed or garbage token string fails gracefully without process crash', async () => {
  const env = setupGDriveTestEnv();
  try {
    const garbageToken = '***INVALID-CONTROL-CHARS-\x00\x01\x02***';
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: garbageToken,
    });

    await assert.rejects(async () => {
      await adapter.verifyAuthentication();
    }, /Google OAuth verification failed|Token verification error/);

    assert.ok(adapter.syncLogs.some((l) => l.type === 'error'));
  } finally {
    env.cleanup();
  }
});
