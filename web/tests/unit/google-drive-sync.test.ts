/**
 * tests/unit/google-drive-sync.test.ts
 * Unit tests for GoogleDriveSyncAdapter and Google Drive synchronization logic.
 */

import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';

describe('GoogleDriveSyncAdapter', () => {
  let adapter: GoogleDriveSyncAdapter;

  beforeEach(() => {
    adapter = new GoogleDriveSyncAdapter({
      targetFolderName: 'Daylight Manuscripts Test',
    });
  });

  test('initializes with unauthenticated status when no token is provided', async () => {
    await adapter.init();
    assert.strictEqual(adapter.isAuthenticated(), false);
    assert.strictEqual(adapter.getCurrentUser(), null);
    const status = adapter.getStatus();
    assert.strictEqual(status.state, 'idle');
  });

  test('stores and clears access token properly', () => {
    adapter.setAccessToken('mock-token-12345');
    assert.strictEqual(adapter.isAuthenticated(), true);
    assert.strictEqual(adapter.getAccessToken(), 'mock-token-12345');

    adapter.setAccessToken(null);
    assert.strictEqual(adapter.isAuthenticated(), false);
    assert.strictEqual(adapter.getAccessToken(), null);
  });

  test('queues document mutations and tracks pending count', () => {
    adapter.queueMutation('doc-1', 'update', { title: 'Chapter 1', content: 'Sample text' });
    adapter.queueMutation('doc-2', 'create', { title: 'Chapter 2', content: 'More text' });

    const status = adapter.getStatus();
    assert.strictEqual(status.pendingCount, 2);

    adapter.clearStagedMutations();
    assert.strictEqual(adapter.getStatus().pendingCount, 0);
  });

  test('verifies user profile against google oauth endpoint', async () => {
    const mockUser = {
      email: 'a12katta@gmail.com',
      name: 'Anjan Katta',
      picture: 'https://example.com/avatar.png',
    };

    const originalFetch = global.fetch;
    global.fetch = (async () => ({
      ok: true,
      json: async () => mockUser,
    })) as any;

    try {
      adapter.setAccessToken('valid-bearer-token');
      const user = await adapter.verifyAuthentication();

      assert.strictEqual(user.email, 'a12katta@gmail.com');
      assert.strictEqual(adapter.getCurrentUser()?.email, 'a12katta@gmail.com');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('resolves conflicts using chronological last-write-wins', async () => {
    const localDoc: any = { id: 'd1', content: 'Local version', updated_at: 2000 };
    const remoteDoc: any = { id: 'd1', content: 'Remote version', updated_at: 3000 };

    const resolved = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
    assert.strictEqual(resolved.content, 'Remote version');
    assert.strictEqual(resolved.sync_status, 'synced');
  });
});
