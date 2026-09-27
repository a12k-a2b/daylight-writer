/**
 * tests/unit/google-drive-sync.test.ts
 * Unit tests for GoogleDriveSyncAdapter:
 * - Direct token entry & hermetic mock fallback
 * - Multi-tier token persistence (Memory, localStorage, DaylightBridge)
 * - Session recovery across adapter instances
 * - Android DaylightNativeBridge synchronization
 * - Automatic HTTP 401 interception, silent refresh & retry
 * - Proactive token expiration handling
 * - Conflict resolution and mutation queueing
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import type { AuthTokens } from '../../src/sync/oauth-pkce.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations } from '../../src/storage/schema.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import type { DatabaseDriver, DocumentRecord } from '../../src/storage/schema.ts';

// In-memory localStorage mock for hermetic testing in Node.js
class MockStorage {
  private store: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, val: string): void {
    this.store.set(key, String(val));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }
}

describe('GoogleDriveSyncAdapter', () => {
  let adapter: GoogleDriveSyncAdapter;
  let mockStorage: MockStorage;
  const originalFetch = global.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    mockStorage = new MockStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });

    adapter = new GoogleDriveSyncAdapter({
      targetFolderName: 'Daylight Manuscripts Test',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalLocalStorage !== undefined) {
      (globalThis as any).localStorage = originalLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  });

  // --------------------------------------------------------------------------
  // 1. Initial State & Basic Authentication
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // 2. Direct Token Entry & Hermetic Mock Token Fallback
  // --------------------------------------------------------------------------
  describe('Direct Token Entry (setDirectToken)', () => {
    test('instantly authenticates mock-token-* without network calls', async () => {
      let networkCalled = false;
      global.fetch = (async () => {
        networkCalled = true;
        throw new Error('Network should not be contacted for mock tokens');
      }) as any;

      const user = await adapter.setDirectToken('mock-token-test-author');
      assert.strictEqual(networkCalled, false, 'Must not dispatch network requests');
      assert.strictEqual(adapter.isAuthenticated(), true);
      assert.strictEqual(user?.email, 'a12katta@gmail.com');
      assert.strictEqual(adapter.getCurrentUser()?.email, 'a12katta@gmail.com');

      const logs = adapter.syncLogs;
      assert.ok(logs.some((l) => l.message.includes('Authenticated successfully as a12katta@gmail.com')));
    });

    test('instantly authenticates test-token-* without network calls', async () => {
      let networkCalled = false;
      global.fetch = (async () => {
        networkCalled = true;
        throw new Error('Network should not be contacted');
      }) as any;

      const user = await adapter.setDirectToken('test-token-developer');
      assert.strictEqual(networkCalled, false);
      assert.strictEqual(user?.email, 'a12katta@gmail.com');
    });

    test('clears authentication when setDirectToken is passed null or empty string', async () => {
      await adapter.setDirectToken('mock-token-initial');
      assert.strictEqual(adapter.isAuthenticated(), true);

      const result = await adapter.setDirectToken('');
      assert.strictEqual(result, null);
      assert.strictEqual(adapter.isAuthenticated(), false);
      assert.strictEqual(adapter.getAccessToken(), null);
      assert.strictEqual(adapter.getCurrentUser(), null);
    });

    test('calls UserInfo API for genuine live tokens (ya29...)', async () => {
      let headerCaptured = '';
      global.fetch = (async (url: string, init: any) => {
        headerCaptured = init?.headers?.Authorization;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            email: 'a12katta@gmail.com',
            name: 'Anjan Katta',
            picture: 'https://lh3.googleusercontent.com/avatar',
          }),
        };
      }) as any;

      const user = await adapter.setDirectToken('ya29.live-valid-token');
      assert.strictEqual(headerCaptured, 'Bearer ya29.live-valid-token');
      assert.strictEqual(user?.email, 'a12katta@gmail.com');
      assert.strictEqual(user?.name, 'Anjan Katta');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multi-Tier Token Persistence
  // --------------------------------------------------------------------------
  describe('Multi-Tier Token Persistence', () => {
    test('persists tokens to localStorage when setTokens is called', () => {
      const tokens: AuthTokens = {
        accessToken: 'ya29.persistent-token-1',
        refreshToken: '1//refresh-token-xyz',
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      };

      adapter.setTokens(tokens);

      assert.strictEqual(mockStorage.getItem('daylight_gdrive_access_token'), 'ya29.persistent-token-1');
      assert.strictEqual(mockStorage.getItem('daylight_gdrive_refresh_token'), '1//refresh-token-xyz');
      const rawStored = mockStorage.getItem('daylight_gdrive_tokens');
      assert.ok(rawStored);
      const parsed = JSON.parse(rawStored!);
      assert.strictEqual(parsed.accessToken, 'ya29.persistent-token-1');
      assert.strictEqual(parsed.refreshToken, '1//refresh-token-xyz');
    });

    test('recovers session and credentials on fresh adapter instance', () => {
      mockStorage.setItem(
        'daylight_gdrive_tokens',
        JSON.stringify({
          accessToken: 'ya29.restored-session-token',
          refreshToken: '1//restored-refresh',
          expiresIn: 3600,
          tokenType: 'Bearer',
          timestamp: Date.now(),
        })
      );
      mockStorage.setItem(
        'daylight_gdrive_user',
        JSON.stringify({ email: 'a12katta@gmail.com', name: 'Anjan Katta' })
      );
      mockStorage.setItem('daylight_gdrive_folder_id', 'folder-restored-88');

      const freshAdapter = new GoogleDriveSyncAdapter();
      assert.strictEqual(freshAdapter.isAuthenticated(), true);
      assert.strictEqual(freshAdapter.getAccessToken(), 'ya29.restored-session-token');
      assert.strictEqual(freshAdapter.getCurrentUser()?.email, 'a12katta@gmail.com');
      assert.strictEqual(freshAdapter.getTokens()?.refreshToken, '1//restored-refresh');
    });

    test('clearing tokens cleans up all localStorage keys', () => {
      adapter.setTokens({
        accessToken: 'ya29.to-delete',
        refreshToken: 'refresh-to-delete',
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });
      adapter.setCurrentUser({ email: 'a12katta@gmail.com' });

      assert.ok(mockStorage.getItem('daylight_gdrive_access_token'));
      assert.ok(mockStorage.getItem('daylight_gdrive_tokens'));
      assert.ok(mockStorage.getItem('daylight_gdrive_refresh_token'));
      assert.ok(mockStorage.getItem('daylight_gdrive_user'));

      adapter.clearTokens();

      assert.strictEqual(mockStorage.getItem('daylight_gdrive_access_token'), null);
      assert.strictEqual(mockStorage.getItem('daylight_gdrive_tokens'), null);
      assert.strictEqual(mockStorage.getItem('daylight_gdrive_refresh_token'), null);
      assert.strictEqual(mockStorage.getItem('daylight_gdrive_user'), null);
      assert.strictEqual(adapter.isAuthenticated(), false);
      assert.strictEqual(adapter.getCurrentUser(), null);
    });

    test('handles corrupted JSON in localStorage gracefully without throwing', () => {
      mockStorage.setItem('daylight_gdrive_tokens', '{ not-valid-json: !!');
      mockStorage.setItem('daylight_gdrive_user', '{ also-corrupted: ??');
      mockStorage.setItem('daylight_gdrive_access_token', 'ya29.legacy-fallback');

      const resilientAdapter = new GoogleDriveSyncAdapter();
      assert.strictEqual(resilientAdapter.isAuthenticated(), true);
      assert.strictEqual(resilientAdapter.getAccessToken(), 'ya29.legacy-fallback');
      assert.strictEqual(resilientAdapter.getCurrentUser(), null);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Android DaylightBridge Integration
  // --------------------------------------------------------------------------
  describe('Android DaylightBridge Synchronization', () => {
    test('invokes window.DaylightBridge.setSyncCredentials when bridge is available', () => {
      let bridgeCalled = false;
      let recordedToken = '';
      let recordedFolder = '';

      (globalThis as any).window = {
        DaylightBridge: {
          setSyncCredentials: (tok: string, folder: string) => {
            bridgeCalled = true;
            recordedToken = tok;
            recordedFolder = folder;
          },
        },
      };

      try {
        adapter.setAccessToken('ya29.bridge-test-token');
        assert.strictEqual(bridgeCalled, true);
        assert.strictEqual(recordedToken, 'ya29.bridge-test-token');
        assert.strictEqual(recordedFolder, '');
      } finally {
        delete (globalThis as any).window;
      }
    });

    test('degrades gracefully when window.DaylightBridge is undefined (desktop / Node)', () => {
      delete (globalThis as any).window;

      assert.doesNotThrow(() => {
        adapter.setAccessToken('ya29.no-bridge-token');
        adapter.syncToNativeBridge();
      });
      assert.strictEqual(adapter.getAccessToken(), 'ya29.no-bridge-token');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Automatic HTTP 401 Interception, Silent Refresh & Retry
  // --------------------------------------------------------------------------
  describe('HTTP 401 Interception and Silent Refresh', () => {
    test('intercepts 401, refreshes token via refreshToken, and retries request successfully', async () => {
      adapter.setTokens({
        accessToken: 'ya29.expired-token',
        refreshToken: 'valid-refresh-token-999',
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });

      let callCount = 0;
      global.fetch = (async (url: string, init: any) => {
        callCount++;
        // If it's the token refresh endpoint
        if (url.includes('/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'ya29.newly-refreshed-token',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          };
        }

        // Target API request: fail on first call with 401, succeed on retry with new token
        const authHeader = init?.headers?.get
          ? init.headers.get('Authorization')
          : init?.headers?.Authorization;

        if (authHeader === 'Bearer ya29.expired-token') {
          return {
            ok: false,
            status: 401,
            text: async () => 'Unauthorized - token expired',
          };
        }

        if (authHeader === 'Bearer ya29.newly-refreshed-token') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [{ id: 'f-1', name: 'Daylight Manuscripts Test' }] }),
          };
        }

        throw new Error(`Unexpected request to ${url} with header ${authHeader}`);
      }) as any;

      const res = await adapter.authenticatedFetch('https://www.googleapis.com/drive/v3/files?q=test');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(adapter.getAccessToken(), 'ya29.newly-refreshed-token');
      assert.ok(callCount >= 2, 'Must have executed refresh and retry');
    });

    test('transitions to error state and emits sync_error if 401 cannot be refreshed', async () => {
      adapter.setTokens({
        accessToken: 'ya29.unrefreshable-token',
        // No refresh token available!
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });

      global.fetch = (async () => ({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })) as any;

      let errorEventEmitted = false;
      adapter.subscribe((event) => {
        if (event.type === 'sync_error') {
          errorEventEmitted = true;
        }
      });

      await assert.rejects(async () => {
        await adapter.authenticatedFetch('https://www.googleapis.com/drive/v3/files');
      }, /Google OAuth token expired \(401\)/);

      assert.strictEqual(adapter.getStatus().state, 'error');
      assert.strictEqual(adapter.getStatus().error, 'Google OAuth token expired (401)');
      assert.strictEqual(errorEventEmitted, true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Proactive Token Refresh
  // --------------------------------------------------------------------------
  describe('Proactive Token Refresh', () => {
    test('getValidAccessToken refreshes token if expired before request', async () => {
      adapter.setTokens({
        accessToken: 'ya29.expired-proactive',
        refreshToken: 'refresh-token-proactive',
        expiresIn: 10,
        tokenType: 'Bearer',
        timestamp: Date.now() - 30000, // Expired 20s ago
      });

      global.fetch = (async (url: string) => {
        if (url.includes('/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'ya29.proactively-refreshed',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          };
        }
        throw new Error('Unexpected URL');
      }) as any;

      const validToken = await adapter.getValidAccessToken();
      assert.strictEqual(validToken, 'ya29.proactively-refreshed');
      assert.strictEqual(adapter.getAccessToken(), 'ya29.proactively-refreshed');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Mutation Staging & Conflict Resolution
  // --------------------------------------------------------------------------
  describe('Mutations and Conflicts', () => {
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

      global.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => mockUser,
      })) as any;

      adapter.setAccessToken('valid-bearer-token');
      const user = await adapter.verifyAuthentication();

      assert.strictEqual(user.email, 'a12katta@gmail.com');
      assert.strictEqual(adapter.getCurrentUser()?.email, 'a12katta@gmail.com');
    });

    test('resolves conflicts using chronological last-write-wins', async () => {
      const localDoc: any = { id: 'd1', content: 'Local version', updated_at: 2000 };
      const remoteDoc: any = { id: 'd1', content: 'Remote version', updated_at: 3000 };

      const resolved = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
      assert.strictEqual(resolved.content, 'Remote version');
      assert.strictEqual(resolved.sync_status, 'synced');
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 1: Dedicated Folder Resolution
  // --------------------------------------------------------------------------
  describe('Milestone 2: Dedicated Folder Resolution', () => {
    test('discovers existing "Daylight Manuscripts" folder via files.list query', async () => {
      let queryUsed = '';
      global.fetch = (async (url: string) => {
        const parsed = new URL(url);
        queryUsed = parsed.searchParams.get('q') || '';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [{ id: 'folder-existing-123', name: 'Daylight Manuscripts Test' }],
          }),
        };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const folderId = await adapter.ensureDaylightFolder();
      assert.strictEqual(folderId, 'folder-existing-123');
      assert.ok(queryUsed.includes("mimeType = 'application/vnd.google-apps.folder'"));
      assert.ok(queryUsed.includes("trashed = false"));
    });

    test('creates "Daylight Manuscripts" folder via POST /drive/v3/files when not found', async () => {
      let createBody: any = null;
      global.fetch = (async (url: string, init: any) => {
        if (init?.method === 'POST') {
          createBody = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'folder-new-456', name: createBody.name }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [] }),
        };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const folderId = await adapter.ensureDaylightFolder(true);
      assert.strictEqual(folderId, 'folder-new-456');
      assert.strictEqual(createBody.mimeType, 'application/vnd.google-apps.folder');
    });

    test('reuses cached folderId across repeated calls without extra network requests', async () => {
      let fetchCount = 0;
      global.fetch = (async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ id: 'folder-cached-789' }] }),
        };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const id1 = await adapter.ensureDaylightFolder(true);
      const id2 = await adapter.ensureDaylightFolder();
      assert.strictEqual(id1, 'folder-cached-789');
      assert.strictEqual(id2, 'folder-cached-789');
      assert.strictEqual(fetchCount, 1, 'Must use cached folderId');
    });

    test('throws descriptive error if folder query fails with HTTP 403 or 500', async () => {
      global.fetch = (async () => ({
        ok: false,
        status: 403,
        text: async () => 'Rate limit exceeded / Access denied',
      })) as any;

      adapter.setAccessToken('ya29.valid-token');
      await assert.rejects(
        async () => {
          await adapter.ensureDaylightFolder(true);
        },
        /Failed to query Google Drive folder \(403\)/
      );
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 2: Genuine Google Doc Creation
  // --------------------------------------------------------------------------
  describe('Milestone 2: Genuine Google Doc Creation', () => {
    test('creates genuine Google Doc with multipart/related upload and correct mimeType', async () => {
      let uploadedUrl = '';
      let uploadedContentType = '';
      let uploadedBody = '';

      global.fetch = (async (url: string, init: any) => {
        uploadedUrl = url;
        uploadedContentType = init?.headers?.get
          ? init.headers.get('Content-Type')
          : init?.headers?.['Content-Type'] || '';
        uploadedBody = init?.body || '';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'gdoc-created-001',
            name: 'Essay on Light',
            version: '1',
            webViewLink: 'https://docs.google.com/document/d/gdoc-created-001/edit',
          }),
        };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const res = await adapter.syncDocumentMutation(
        {
          id: 'mut-create-1',
          entity_type: 'document',
          entity_id: 'doc-local-1',
          operation: 'create',
          payload: { title: 'Essay on Light', content: 'Natural illumination promotes focus.' },
          client_timestamp: Date.now(),
        },
        'folder-123'
      );

      assert.strictEqual(res.fileId, 'gdoc-created-001');
      assert.ok(uploadedUrl.includes('/upload/drive/v3/files?uploadType=multipart'));
      assert.ok(uploadedContentType.includes('multipart/related'));
      assert.ok(uploadedBody.includes('application/vnd.google-apps.document'));
      assert.ok(uploadedBody.includes('Natural illumination promotes focus.'));
      assert.ok(uploadedBody.includes('folder-123'));
    });

    test('defaults blank title to "Untitled Document" when creating Google Doc', async () => {
      let uploadedBody = '';
      global.fetch = (async (url: string, init: any) => {
        uploadedBody = init?.body || '';
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'gdoc-untitled-1', version: '1' }),
        };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      await adapter.syncDocumentMutation(
        {
          id: 'mut-untitled',
          entity_type: 'document',
          entity_id: 'doc-untitled',
          operation: 'create',
          payload: { title: '   ', content: 'Some body text' },
          client_timestamp: Date.now(),
        },
        'folder-123'
      );

      assert.ok(uploadedBody.includes('Untitled Document'));
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 3: In-Place Content Patching (Docs API v1 batchUpdate)
  // --------------------------------------------------------------------------
  describe('Milestone 2: In-Place Content Patching (Docs API v1 batchUpdate)', () => {
    test('patches existing Google Doc via Docs API v1 batchUpdate without calling Drive media PATCH', async () => {
      const calls: Array<{ url: string; method: string; body: string }> = [];

      global.fetch = (async (url: string, init: any) => {
        calls.push({ url, method: init?.method || 'GET', body: init?.body || '' });

        // Document length query
        if (url.includes('/v1/documents/gdoc-patch-999') && (!init?.method || init?.method === 'GET')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              documentId: 'gdoc-patch-999',
              body: { content: [{ startIndex: 1, endIndex: 25 }] },
            }),
          };
        }

        // Docs batchUpdate
        if (url.includes(':batchUpdate')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ documentId: 'gdoc-patch-999', writeControl: { requiredRevisionId: 'rev-2' } }),
          };
        }

        // Drive v3 title patch
        if (url.includes('/drive/v3/files/gdoc-patch-999')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'gdoc-patch-999', name: 'Updated Title' }),
          };
        }

        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const res = await adapter.syncDocumentMutation(
        {
          id: 'mut-update-1',
          entity_type: 'document',
          entity_id: 'doc-local-2',
          operation: 'update',
          payload: {
            google_drive_file_id: 'gdoc-patch-999',
            title: 'Updated Title',
            content: 'Brand new replaced manuscript text.',
          },
          client_timestamp: Date.now(),
        },
        'folder-123'
      );

      assert.strictEqual(res.fileId, 'gdoc-patch-999');

      // VERIFY DEAD_ENDS.md COMPLIANCE: NEVER use Drive v3 media PATCH on native Docs
      const forbiddenDrivePatch = calls.find(
        (c) => c.method === 'PATCH' && c.url.includes('/upload/drive/v3/files/')
      );
      assert.strictEqual(forbiddenDrivePatch, undefined, 'Must NEVER use Drive v3 media upload for Google Docs');

      const batchUpdateCall = calls.find((c) => c.url.includes(':batchUpdate'));
      assert.ok(batchUpdateCall, 'Must call Docs API batchUpdate');
      const batchReq = JSON.parse(batchUpdateCall.body);
      assert.ok(batchReq.requests.some((r: any) => r.deleteContentRange));
      assert.ok(batchReq.requests.some((r: any) => r.insertText?.text === 'Brand new replaced manuscript text.'));
    });

    test('preserves existing title when updating content only', async () => {
      const calls: Array<{ url: string; method: string }> = [];

      global.fetch = (async (url: string, init: any) => {
        calls.push({ url, method: init?.method || 'GET' });
        if (url.includes('/v1/documents/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              documentId: 'gdoc-1',
              body: { content: [{ startIndex: 1, endIndex: 10 }] },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      await adapter.syncDocumentMutation(
        {
          id: 'm1',
          entity_type: 'document',
          entity_id: 'd1',
          operation: 'update',
          payload: {
            google_drive_file_id: 'gdoc-1',
            content: 'New content without changing title',
          },
          client_timestamp: Date.now(),
        },
        'folder-1'
      );

      // Verify no Drive v3 metadata PATCH was called for title
      const titlePatch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/drive/v3/files/'));
      assert.strictEqual(titlePatch, undefined, 'Must not dispatch title patch when title is omitted');
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 4: SQLite Persistence of google_drive_file_id
  // --------------------------------------------------------------------------
  describe('Milestone 2: SQLite Persistence of google_drive_file_id', () => {
    let testDb: DatabaseDriver;
    let repo: SQLiteStorageRepository;

    beforeEach(async () => {
      testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
      await runMigrations(testDb);
      repo = new SQLiteStorageRepository(testDb);
      await repo.init();
      adapter.setDatabaseDriver(testDb);
      adapter.setRepository(repo);
    });

    test('persists returned fileId, revisionId, and lastSyncedAt into documents table upon creation', async () => {
      await testDb.executeSql(`
        INSERT INTO documents (id, title, content, created_at, updated_at, sync_status)
        VALUES ('doc-persist-test', 'Local Manuscript', 'Content', 1000, 1000, 'pending');
      `);

      global.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gdoc-persisted-12345',
          version: 'rev-xyz-1',
          webViewLink: 'https://docs.google.com/document/d/gdoc-persisted-12345/edit',
        }),
      })) as any;

      adapter.setAccessToken('ya29.valid-token');
      await adapter.syncDocumentMutation(
        {
          id: 'mut-1',
          entity_type: 'document',
          entity_id: 'doc-persist-test',
          operation: 'create',
          payload: { title: 'Local Manuscript', content: 'Content' },
          client_timestamp: 1000,
        },
        'folder-1'
      );

      const rows = await testDb.executeSql<any>(
        `SELECT google_drive_file_id, google_drive_revision_id, last_synced_at, sync_status 
         FROM documents WHERE id = 'doc-persist-test';`
      );
      assert.strictEqual(rows[0].google_drive_file_id, 'gdoc-persisted-12345');
      assert.strictEqual(rows[0].google_drive_revision_id, 'rev-xyz-1');
      assert.strictEqual(rows[0].sync_status, 'synced');
      assert.ok(Number(rows[0].last_synced_at) > 0);

      // Verify findByDriveFileId on repository
      const found = await repo.findByDriveFileId('gdoc-persisted-12345');
      assert.ok(found);
      assert.strictEqual(found?.id, 'doc-persist-test');
    });

    test('secondary SQLite lookup in syncDocumentMutation resolves fileId even if payload is missing it', async () => {
      await testDb.executeSql(`
        INSERT INTO documents (id, title, content, created_at, updated_at, google_drive_file_id, sync_status)
        VALUES ('doc-stale-payload', 'Stale Payload Doc', 'New Content', 2000, 2000, 'gdoc-known-file-id', 'synced');
      `);

      let docBatchUpdateCalled = false;
      global.fetch = (async (url: string) => {
        if (url.includes(':batchUpdate')) {
          docBatchUpdateCalled = true;
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ body: { content: [{ startIndex: 1, endIndex: 10 }] } }),
        };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const res = await adapter.syncDocumentMutation(
        {
          id: 'mut-stale',
          entity_type: 'document',
          entity_id: 'doc-stale-payload',
          operation: 'update',
          payload: { title: 'Stale Payload Doc', content: 'New Content' }, // missing google_drive_file_id
          client_timestamp: 2000,
        },
        'folder-1'
      );

      assert.strictEqual(res.fileId, 'gdoc-known-file-id');
      assert.strictEqual(docBatchUpdateCalled, true, 'Must patch rather than duplicate');
    });

    test('flushPendingEdits does not re-enqueue documents with sync_status = synced into sync_queue', async () => {
      // Save document with sync_status: synced
      await repo.saveDocument({
        id: 'doc-synced-test',
        title: 'Already Synced Doc',
        content: 'Content',
        sync_status: 'synced',
      });

      await repo.flushPendingEdits();

      // Verify sync_queue does not contain doc-synced-test
      const rows = await testDb.executeSql<any>(
        `SELECT * FROM sync_queue WHERE entity_id = 'doc-synced-test';`
      );
      assert.strictEqual(rows.length, 0, 'Synced documents must not be re-enqueued for sync');
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 4b: Trashed File 404 Auto-Recovery & SQLite Synchronization
  // --------------------------------------------------------------------------
  describe('Milestone 2: Trashed File 404 Auto-Recovery & SQLite Synchronization', () => {
    let testDb: DatabaseDriver;
    let repo: SQLiteStorageRepository;

    beforeEach(async () => {
      testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
      await runMigrations(testDb);
      repo = new SQLiteStorageRepository(testDb);
      await repo.init();
      adapter.setDatabaseDriver(testDb);
      adapter.setRepository(repo);
      adapter.setAccessToken('ya29.valid-token');
    });

    test('Unit 1: Auto-recovers from HTTP 404 on Docs API query by calling createGoogleDocFile', async () => {
      const calls: Array<{ url: string; method: string; body: string }> = [];

      global.fetch = (async (url: string, init: any) => {
        calls.push({ url, method: init?.method || 'GET', body: init?.body || '' });

        // Query on missing remote file returns 404
        if (url.includes('/v1/documents/gdoc-stale-404')) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: { message: 'Document not found', code: 404 } }),
          };
        }

        // Multipart upload for re-creation
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'gdoc-recreated-new-123',
              name: 'Recovery Title',
              mimeType: 'application/vnd.google-apps.document',
              version: '1',
              webViewLink: 'https://docs.google.com/document/d/gdoc-recreated-new-123/edit',
            }),
          };
        }

        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      const res = await adapter.syncDocumentMutation(
        {
          id: 'mut-recover-unit-1',
          entity_type: 'document',
          entity_id: 'doc-unit-rec-1',
          operation: 'update',
          payload: {
            google_drive_file_id: 'gdoc-stale-404',
            title: 'Recovery Title',
            content: 'Recovered body content.',
          },
          client_timestamp: Date.now(),
        },
        'folder-unit-1'
      );

      // Verify clean recovery
      assert.strictEqual(res.fileId, 'gdoc-recreated-new-123', 'Must return newly created file ID');
      assert.notStrictEqual(res.fileId, 'gdoc-stale-404');

      // Verify sequence of network calls:
      const docQueryCall = calls.find((c) => c.url.includes('/v1/documents/gdoc-stale-404'));
      assert.ok(docQueryCall, 'Must have attempted to query stale doc');

      const multipartCall = calls.find((c) => c.url.includes('/upload/drive/v3/files?uploadType=multipart'));
      assert.ok(multipartCall, 'Must have invoked multipart create as fallback');
      assert.ok(multipartCall.body.includes('Recovery Title'), 'Multipart request must include title');
      assert.ok(multipartCall.body.includes('Recovered body content.'), 'Multipart request must include content');

      // Verify batchUpdate was NEVER called for the dead doc
      const deadBatchCall = calls.find((c) => c.url.includes('/v1/documents/gdoc-stale-404:batchUpdate'));
      assert.strictEqual(deadBatchCall, undefined, 'Must not dispatch batchUpdate on dead file');
    });

    test('Unit 2: Updates SQLite documents table and repository cache with new file ID and synced status upon 404 recovery', async () => {
      // Seed SQLite with pending document having stale Google Drive file ID
      const entityId = 'doc-sqlite-persist-404';
      const staleId = 'gdoc-dead-sqlite-999';

      await testDb.executeSql(
        `INSERT INTO documents (id, title, content, created_at, updated_at, sync_status, google_drive_file_id)
         VALUES (?, 'SQLite Manuscript', 'Original text', 1000, 1000, 'pending', ?);`,
        [entityId, staleId]
      );
      // Populate repository cache
      await repo.getDocument(entityId);

      global.fetch = (async (url: string) => {
        if (url.includes(`/v1/documents/${staleId}`)) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: { message: 'File not found', code: 404 } }),
          };
        }
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'gdoc-fresh-sqlite-777',
              version: 'rev-rec-1',
              webViewLink: 'https://docs.google.com/document/d/gdoc-fresh-sqlite-777/edit',
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      const res = await adapter.syncDocumentMutation(
        {
          id: 'mut-sqlite-rec',
          entity_type: 'document',
          entity_id: entityId,
          operation: 'update',
          payload: {
            title: 'SQLite Manuscript',
            content: 'Recovered and persisted text',
          },
          client_timestamp: Date.now(),
        },
        'folder-unit-1'
      );

      assert.strictEqual(res.fileId, 'gdoc-fresh-sqlite-777');

      // Verify SQLite row was updated with new file ID and synced status
      const rows = await testDb.executeSql<{
        google_drive_file_id: string;
        google_drive_revision_id: string;
        sync_status: string;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id, sync_status
         FROM documents WHERE id = ?;`,
        [entityId]
      );
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].google_drive_file_id, 'gdoc-fresh-sqlite-777', 'SQLite must record new file ID');
      assert.strictEqual(rows[0].google_drive_revision_id, 'rev-rec-1');
      assert.strictEqual(rows[0].sync_status, 'synced', 'SQLite sync_status must be synced');

      // Verify repository in-memory cache was updated
      const cachedDoc = await repo.getDocument(entityId);
      assert.strictEqual(cachedDoc?.google_drive_file_id, 'gdoc-fresh-sqlite-777');
      assert.strictEqual(cachedDoc?.sync_status, 'synced');
    });

    test('Unit 3: Auto-recovers from HTTP 404 when title metadata PATCH returns 404', async () => {
      global.fetch = (async (url: string, init: any) => {
        // Body query succeeds (or content is omitted)
        if (url.includes('/drive/v3/files/gdoc-stale-title?fields=')) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: { message: 'File not found', code: 404 } }),
          };
        }
        // Multipart upload for re-creation
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'gdoc-title-recreated-555',
              version: '1',
              webViewLink: 'https://docs.google.com/document/d/gdoc-title-recreated-555/edit',
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      const res = await adapter.syncDocumentMutation(
        {
          id: 'mut-title-404',
          entity_type: 'document',
          entity_id: 'doc-title-404',
          operation: 'update',
          payload: {
            google_drive_file_id: 'gdoc-stale-title',
            title: 'Renamed Manuscript',
          },
          client_timestamp: Date.now(),
        },
        'folder-unit-1'
      );

      assert.strictEqual(res.fileId, 'gdoc-title-recreated-555');
    });

    test('Unit 4: Negative boundary - does NOT auto-recover on HTTP 500 or 403 errors; throws and preserves existing file ID', async () => {
      const entityId = 'doc-preserve-on-500';
      const existingId = 'gdoc-existing-keep-id';

      await testDb.executeSql(
        `INSERT INTO documents (id, title, content, created_at, updated_at, sync_status, google_drive_file_id)
         VALUES (?, 'Error Test Doc', 'Original', 1000, 1000, 'synced', ?);`,
        [entityId, existingId]
      );

      let multipartCalled = false;
      global.fetch = (async (url: string) => {
        if (url.includes(`/v1/documents/${existingId}`)) {
          return {
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ error: { message: 'Internal Server Error', code: 500 } }),
          };
        }
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          multipartCalled = true;
          return { ok: true, status: 200, json: async () => ({ id: 'unexpected-duplicate' }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      await assert.rejects(async () => {
        await adapter.syncDocumentMutation(
          {
            id: 'mut-error-500',
            entity_type: 'document',
            entity_id: entityId,
            operation: 'update',
            payload: {
              google_drive_file_id: existingId,
              title: 'Error Test Doc',
              content: 'Should not create duplicate on 500',
            },
            client_timestamp: Date.now(),
          },
          'folder-unit-1'
        );
      }, /500/);

      assert.strictEqual(multipartCalled, false, 'Must NEVER call multipart create on transient HTTP 500');

      // Verify SQLite state remains intact
      const rows = await testDb.executeSql<{ google_drive_file_id: string }>(
        `SELECT google_drive_file_id FROM documents WHERE id = ?;`,
        [entityId]
      );
      assert.strictEqual(rows[0].google_drive_file_id, existingId, 'Existing file ID must be preserved');
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 5: Remote Document Discovery & Reconciliation (pull)
  // --------------------------------------------------------------------------
  describe('Milestone 2: Remote Discovery & Reconciliation (pull)', () => {
    let testDb: DatabaseDriver;
    let repo: SQLiteStorageRepository;

    beforeEach(async () => {
      testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
      await runMigrations(testDb);
      repo = new SQLiteStorageRepository(testDb);
      await repo.init();
      adapter.setDatabaseDriver(testDb);
      adapter.setRepository(repo);
    });

    test('pull() discovers remote Google Docs, exports text, and creates local document', async () => {
      global.fetch = (async (url: string) => {
        if (url.includes('/drive/v3/files?q=')) {
          if (url.includes('mimeType+%3D+%27application%2Fvnd.google-apps.folder%27') || url.includes('application%2Fvnd.google-apps.folder')) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'f-1' }] }) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                {
                  id: 'gdoc-remote-88',
                  name: 'Remote Manuscript',
                  mimeType: 'application/vnd.google-apps.document',
                  modifiedTime: '2026-09-27T10:00:00Z',
                  version: '3',
                },
              ],
            }),
          };
        }
        if (url.includes('/export')) {
          return {
            ok: true,
            status: 200,
            text: async () => '# Remote Manuscript\n\nDiscovered text content from Google Docs.',
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.createdCount, 1);
      assert.strictEqual(pullRes.pulledCount, 1);

      const rows = await testDb.executeSql<any>(
        `SELECT title, content, google_drive_file_id, sync_status 
         FROM documents WHERE google_drive_file_id = 'gdoc-remote-88';`
      );
      assert.strictEqual(rows[0].title, 'Remote Manuscript');
      assert.ok(rows[0].content.includes('Discovered text content'));
      assert.strictEqual(rows[0].sync_status, 'synced');
    });

    test('pull() updates existing local document when remote is newer (Last-Write-Wins)', async () => {
      // Local doc updated at 1000
      await repo.saveDocument({
        id: 'doc-lww-1',
        title: 'Original Local Title',
        content: 'Old local content',
        google_drive_file_id: 'gdoc-lww-remote',
        updated_at: 1000,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      global.fetch = (async (url: string) => {
        if (url.includes('/drive/v3/files?q=')) {
          if (url.includes('application%2Fvnd.google-apps.folder')) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'f-1' }] }) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                {
                  id: 'gdoc-lww-remote',
                  name: 'Overwriting Remote Title',
                  mimeType: 'application/vnd.google-apps.document',
                  modifiedTime: new Date(5000).toISOString(),
                },
              ],
            }),
          };
        }
        if (url.includes('/export')) {
          return {
            ok: true,
            status: 200,
            text: async () => 'New remote text wins!',
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.updatedCount, 1);

      const updated = await repo.getDocument('doc-lww-1');
      assert.strictEqual(updated?.title, 'Overwriting Remote Title');
      assert.strictEqual(updated?.content, 'New remote text wins!');
    });

    test('pull() queues update mutation when local is newer (Last-Write-Wins)', async () => {
      const queue = new OfflineMutationQueue(testDb);
      adapter.setMutationQueue(queue);

      // Local doc updated at 9000
      await repo.saveDocument({
        id: 'doc-local-newer',
        title: 'Local Edits Ahead',
        content: 'Fresh local typing',
        google_drive_file_id: 'gdoc-older-remote',
        updated_at: 9000,
        sync_status: 'pending',
      });
      await repo.flushPendingEdits();

      global.fetch = (async (url: string) => {
        if (url.includes('/drive/v3/files?q=')) {
          if (url.includes('application%2Fvnd.google-apps.folder')) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'f-1' }] }) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                {
                  id: 'gdoc-older-remote',
                  name: 'Stale Remote',
                  mimeType: 'application/vnd.google-apps.document',
                  modifiedTime: new Date(2000).toISOString(),
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.queuedCount, 1);
      assert.strictEqual(adapter.getStatus().pendingCount, 1);
    });
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Suite 6: Offline Mutation Queue Integration & End-to-End Drain
  // --------------------------------------------------------------------------
  describe('Milestone 2: Offline Mutation Queue Integration & Drain', () => {
    let testDb: DatabaseDriver;

    beforeEach(async () => {
      testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
      await runMigrations(testDb);
      adapter.setDatabaseDriver(testDb);
    });

    test('drains pending SQLite mutations in FIFO order, commits batch, and updates local records', async () => {
      const queue = new OfflineMutationQueue(testDb, { batchSize: 10 });
      await queue.init();

      await testDb.executeSql(`
        INSERT INTO documents (id, title, content, created_at, updated_at, sync_status)
        VALUES ('doc-queue-1', 'Queue Doc 1', 'Content 1', 1000, 1000, 'pending');
      `);

      await queue.enqueue('document', 'doc-queue-1', 'create', {
        title: 'Queue Doc 1',
        content: 'Content 1',
      }, 1000);

      assert.strictEqual(await queue.getPendingCount(), 1);

      global.fetch = (async (url: string) => {
        if (url.includes('/drive/v3/files?q=')) {
          return { ok: true, status: 200, json: async () => ({ files: [{ id: 'folder-drain-1' }] }) };
        }
        if (url.includes('/upload/drive/v3/files')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'gdoc-drained-1', version: '1' }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const drainRes = await queue.drain(adapter);
      assert.strictEqual(drainRes.pushedCount, 1);
      assert.strictEqual(drainRes.failedCount, 0);

      assert.strictEqual(await queue.getPendingCount(), 0);

      const docRows = await testDb.executeSql<any>(
        `SELECT google_drive_file_id, sync_status FROM documents WHERE id = 'doc-queue-1';`
      );
      assert.strictEqual(docRows[0].google_drive_file_id, 'gdoc-drained-1');
      assert.strictEqual(docRows[0].sync_status, 'synced');
    });

    test('recovers abandoned in_flight mutations left over from crash upon restart', async () => {
      await testDb.executeSql(`
        INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
        VALUES ('sync-crash-1', 'document', 'doc-crash', 'update', '{"title":"Crash Title"}', 500, 0, NULL, 'in_flight');
      `);

      const freshQueue = new OfflineMutationQueue(testDb);
      const recovered = await freshQueue.init();

      assert.strictEqual(recovered, 1);
      assert.strictEqual(await freshQueue.getPendingCount(), 1);

      const rows = await testDb.executeSql<any>(`SELECT status FROM sync_queue WHERE id = 'sync-crash-1';`);
      assert.strictEqual(rows[0].status, 'pending');
    });

    test('reverts in_flight mutations to pending with backoff and error message on sync failure', async () => {
      const queue = new OfflineMutationQueue(testDb, { maxRetries: 3 });
      await queue.enqueue('document', 'doc-fail-1', 'update', { title: 'Fail Doc' });

      global.fetch = (async () => {
        throw new Error('Connection refused / 503 Service Unavailable');
      }) as any;

      adapter.setAccessToken('ya29.valid-token');
      const drainRes = await queue.drain(adapter);
      assert.strictEqual(drainRes.pushedCount, 0);
      assert.strictEqual(drainRes.failedCount, 1);

      const rows = await testDb.executeSql<any>(`SELECT status, retry_count, last_error FROM sync_queue;`);
      assert.strictEqual(rows[0].status, 'pending');
      assert.strictEqual(rows[0].retry_count, 1);
      assert.ok(rows[0].last_error.includes('Connection refused'));
    });
  });
});
