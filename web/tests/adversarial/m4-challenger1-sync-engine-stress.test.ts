/**
 * tests/adversarial/m4-challenger1-sync-engine-stress.test.ts
 * Milestone 4 Tier 5 Adversarial Coverage Hardening: Sync Engine & Storage Layer
 *
 * EMPIRICAL CHALLENGES:
 * 1. Challenge 1 (Corrupted API payloads & Malformed JSON):
 *    - HTML 500 error pages, truncated JSON, empty 0-byte responses, single-file 502 isolation.
 *    - Structured errors raised, clean sync logging, state set to 'error', zero SQLite corruption, zero process crash.
 * 2. Challenge 2 (Concurrent Local Mutations vs Remote Merging):
 *    - Concurrently trigger local SQLite document updates while an asynchronous remote pull/reconciliation is executing.
 *    - Assert Last-Write-Wins (LWW) is strictly honored based on monotonic timestamps and no silent edit overwrites occur.
 * 3. Challenge 3 (Offline Queue Heavy Coalescing & Crash Recovery):
 *    - 100 rapid insert/update/delete mutations on the same document while offline.
 *    - SQLite mutation queue compaction/coalescing and state recovery after repository close and reopen.
 * 4. Challenge 4 (Token Expiration Mid-Batch Drain):
 *    - Multi-item mutation queue drain with HTTP 401 simulated on item 2.
 *    - Automatic silent token refresh, item 2 retried with fresh token, all items drain without queue stall.
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type DatabaseDriver, type DocumentRecord, type SyncQueueRecord } from '../../src/storage/schema.ts';
import { NetworkListener } from '../../src/sync/network-listener.ts';
import { refreshAccessToken, inFlightRefreshPromises } from '../../src/sync/oauth-pkce.ts';

// ============================================================================
// Hermetic Test Infrastructure
// ============================================================================

class MockLocalStorage {
  private store = new Map<string, string>();
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

interface MockRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  modifiedTime: string;
  createdTime: string;
  version: string;
  revisionId: string;
  webViewLink: string;
  trashed: boolean;
}

class AdversarialDriveServer {
  public files = new Map<string, MockRemoteFile>();
  public folderId = 'folder-daylight-manuscripts-m4';
  public folderName = 'Daylight Manuscripts';
  public refreshTokens = new Map<string, string>(); // refreshToken -> newAccessToken
  public recordedRequests: Array<{ url: string; method: string; authHeader?: string; body?: any }> = [];

  // Fault injection hooks
  public onFetchHook: ((url: string, init?: RequestInit) => Promise<Response | null> | Response | null) | null = null;
  public artificialDelayMs = 0;
  public tokenRefreshCount = 0;
  private fileIdSeq = 1000;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.files.clear();
    this.recordedRequests = [];
    this.onFetchHook = null;
    this.artificialDelayMs = 0;
    this.tokenRefreshCount = 0;
    this.fileIdSeq = 1000;
    this.refreshTokens.clear();
    this.refreshTokens.set('mock-refresh-token-xyz', 'ya29.fresh-refreshed-token-456');
  }

  public seedFile(file: Partial<MockRemoteFile> & { id: string; name: string }): MockRemoteFile {
    const full: MockRemoteFile = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType || 'application/vnd.google-apps.document',
      parents: file.parents || [this.folderId],
      content: file.content || '',
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      createdTime: file.createdTime || new Date().toISOString(),
      version: file.version || '1',
      revisionId: file.revisionId || `rev-${file.id}-1`,
      webViewLink: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
      trashed: file.trashed || false,
    };
    this.files.set(file.id, full);
    return full;
  }

  public async handleFetch(urlStr: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const authHeader = headers.get('authorization') || undefined;
    const bodyStr = typeof init?.body === 'string' ? init.body : undefined;

    this.recordedRequests.push({
      url: urlStr,
      method,
      authHeader,
      body: bodyStr,
    });

    if (this.artificialDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.artificialDelayMs));
    }

    // Custom fault injection hook
    if (this.onFetchHook) {
      const injected = await this.onFetchHook(urlStr, init);
      if (injected) return injected;
    }

    const url = new URL(urlStr);

    // 1. Google UserInfo
    if (url.pathname.includes('/userinfo')) {
      return new Response(
        JSON.stringify({
          email: 'a12katta@gmail.com',
          name: 'Anjan Katta',
          picture: 'https://example.com/avatar.png',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. OAuth Token Refresh / Exchange
    if (url.pathname.includes('/token')) {
      this.tokenRefreshCount++;
      const params = new URLSearchParams(bodyStr || '');
      const refreshToken = params.get('refresh_token');

      if (refreshToken === 'invalid-refresh-token' || refreshToken === 'revoked-token') {
        return new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const freshToken = this.refreshTokens.get(refreshToken || '') || `ya29.refreshed-${Date.now()}`;
      return new Response(
        JSON.stringify({
          access_token: freshToken,
          refresh_token: refreshToken || 'mock-refresh-token-xyz',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Drive v3 Files Search (folder query & manuscripts list)
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || '';

      // Folder search
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'") || q.includes('application/vnd.google-apps.folder')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: this.folderId,
                name: this.folderName,
                mimeType: 'application/vnd.google-apps.folder',
                trashed: false,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // File list in folder
      const matchingFiles: any[] = [];
      for (const file of this.files.values()) {
        if (!file.trashed) {
          matchingFiles.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            createdTime: file.createdTime,
            version: file.version,
            revisionId: file.revisionId,
            webViewLink: file.webViewLink,
            trashed: file.trashed,
          });
        }
      }
      return new Response(
        JSON.stringify({ files: matchingFiles }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Drive v3 Multipart Document Creation
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      let parsedMeta: any = {};
      let parsedContent = '';
      if (bodyStr) {
        const jsonMatch = bodyStr.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            parsedMeta = JSON.parse(jsonMatch[0]);
          } catch {}
        }
        const parts = bodyStr.split(/\r?\n--[^\r\n]+\r?\n/);
        if (parts.length >= 3) {
          const contentPart = parts[2];
          const headerSplit = contentPart.indexOf('\r\n\r\n');
          if (headerSplit !== -1) {
            parsedContent = contentPart.slice(headerSplit + 4).replace(/\r?\n--[^\r\n]+--/, '');
          } else {
            parsedContent = contentPart;
          }
        }
      }

      const fileId = `gdoc-created-${++this.fileIdSeq}`;
      const newFile: MockRemoteFile = {
        id: fileId,
        name: parsedMeta.name || 'Untitled Document',
        mimeType: parsedMeta.mimeType || 'application/vnd.google-apps.document',
        parents: [this.folderId],
        content: parsedContent,
        modifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        version: '1',
        revisionId: `rev-${fileId}-1`,
        webViewLink: `https://docs.google.com/document/d/${fileId}/edit`,
        trashed: false,
      };
      this.files.set(fileId, newFile);

      return new Response(
        JSON.stringify({
          id: fileId,
          name: newFile.name,
          mimeType: newFile.mimeType,
          version: newFile.version,
          revisionId: newFile.revisionId,
          webViewLink: newFile.webViewLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Google Docs API v1: GET Document length
    const docGetMatch = url.pathname.match(/\/v1\/documents\/([^/:]+)$/);
    if (docGetMatch && method === 'GET') {
      const docId = docGetMatch[1];
      const file = this.files.get(docId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { message: 'Document not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const len = file.content.length;
      return new Response(
        JSON.stringify({
          documentId: file.id,
          title: file.name,
          body: {
            content: [
              { endIndex: 1, sectionBreak: {} },
              ...(len > 0
                ? [
                    {
                      startIndex: 1,
                      endIndex: 1 + len + 1,
                      paragraph: { elements: [{ textRun: { content: file.content + '\n' } }] },
                    },
                  ]
                : []),
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Google Docs API v1: batchUpdate
    const docBatchMatch = url.pathname.match(/\/v1\/documents\/([^/:]+):batchUpdate$/);
    if (docBatchMatch && method === 'POST') {
      const docId = docBatchMatch[1];
      const file = this.files.get(docId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { message: 'Document not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let payload: any = {};
      try {
        payload = JSON.parse(bodyStr || '{}');
      } catch {}
      const requests = payload.requests || [];
      for (const req of requests) {
        if (req.deleteContentRange) {
          file.content = '';
        } else if (req.insertText) {
          file.content = (file.content || '') + (req.insertText.text || '');
        }
      }
      file.modifiedTime = new Date().toISOString();
      file.version = String(parseInt(file.version || '1') + 1);
      file.revisionId = `rev-${file.id}-${file.version}`;

      return new Response(
        JSON.stringify({
          documentId: file.id,
          revisionId: file.revisionId,
          writeControl: { requiredRevisionId: file.revisionId },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. Drive v3 Metadata PATCH (title update)
    const patchMetaMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    if (patchMetaMatch && method === 'PATCH') {
      const fileId = patchMetaMatch[1];
      const file = this.files.get(fileId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { message: 'File not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let payload: any = {};
      try {
        payload = JSON.parse(bodyStr || '{}');
      } catch {}
      if (payload.name) file.name = payload.name;
      if (payload.trashed !== undefined) file.trashed = Boolean(payload.trashed);
      file.modifiedTime = new Date().toISOString();

      return new Response(
        JSON.stringify({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          version: file.version,
          webViewLink: file.webViewLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 8. Drive v3 Export (plain text export for reconciliation)
    const exportMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)\/export/);
    if (exportMatch && method === 'GET') {
      const fileId = exportMatch[1];
      const file = this.files.get(fileId);
      if (!file || file.trashed) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(file.content, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 404 Default
    return new Response(JSON.stringify({ error: 'Endpoint not mocked', path: url.pathname }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================================
// Test Suite Setup
// ============================================================================

describe('Milestone 4 Adversarial Hardening Suite: Sync Engine & Storage Layer Stress', () => {
  let testDb: DatabaseDriver;
  let repo: SQLiteStorageRepository;
  let queue: OfflineMutationQueue;
  let adapter: GoogleDriveSyncAdapter;
  let server: AdversarialDriveServer;
  let mockStorage: MockLocalStorage;

  const originalFetch = global.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(async () => {
    mockStorage = new MockLocalStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });

    server = new AdversarialDriveServer();
    global.fetch = ((url: string, init?: RequestInit) => server.handleFetch(url, init)) as any;

    testDb = await SqliteDatabase.open({
      vfsPreference: 'memory',
      dbName: `test_m4_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.db`,
    });
    await runMigrations(testDb);

    repo = new SQLiteStorageRepository(testDb);
    await repo.init();

    queue = new OfflineMutationQueue(testDb, { batchSize: 50 });
    await queue.init();

    adapter = new GoogleDriveSyncAdapter({
      targetFolderName: 'Daylight Manuscripts',
      db: testDb,
      repository: repo,
      mutationQueue: queue,
    });
    adapter.setTokens({
      accessToken: 'ya29.initial-token-123',
      refreshToken: 'mock-refresh-token-xyz',
      expiresIn: 3600,
      tokenType: 'Bearer',
      timestamp: Date.now(),
    });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    inFlightRefreshPromises.clear();
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  // ==========================================================================
  // Challenge 1: Corrupted API Payloads & Malformed JSON
  // ==========================================================================
  describe('Challenge 1: Corrupted API Payloads & Malformed JSON Robustness', () => {
    test('1.1: HTML 500 error page from Drive API raises structured error, sets status error, logs cleanly, preserves SQLite', async () => {
      // Seed a document in SQLite
      const doc = await repo.saveDocument({
        id: 'doc-corrupt-1',
        title: 'Original Title',
        content: 'Original Content',
        sync_status: 'pending',
      });
      await repo.flushPendingEdits();

      // Stage mutation
      adapter.queueMutation(doc.id, 'create', doc);

      // Fault injection: Return HTML 500 error page on folder query
      server.onFetchHook = async (urlStr: string) => {
        if (urlStr.includes('/drive/v3/files')) {
          return new Response(
            '<!DOCTYPE html><html><head><title>500 Internal Server Error</title></head><body><h1>500 Internal Server Error</h1><p>Backend crashed.</p></body></html>',
            {
              status: 500,
              headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            }
          );
        }
        return null;
      };

      // Execute sync - should fail cleanly with structured error
      await assert.rejects(
        async () => {
          await adapter.sync();
        },
        (err: Error) => {
          assert.ok(err.message.includes('500'), 'Error message must reflect HTTP 500');
          assert.ok(err.message.includes('<!DOCTYPE html>') || err.message.includes('Internal Server Error'), 'Error must contain payload snippet');
          return true;
        }
      );

      // Assert adapter status transitioned to error
      const status = adapter.getStatus();
      assert.strictEqual(status.state, 'error', 'Adapter state must be error');
      assert.ok(status.error !== null, 'Status must carry error description');

      // Assert clean structured logging in syncLogs
      const errorLogs = adapter.syncLogs.filter((l) => l.type === 'error');
      assert.ok(errorLogs.length >= 1, 'Sync logs must record structured error');
      assert.ok(errorLogs.some((l) => l.message.includes('500')), 'Log message must reference HTTP 500');

      // Assert SQLite state is completely uncorrupted
      const pragma = await testDb.executeSql<{ integrity_check: string }>('PRAGMA integrity_check;');
      assert.strictEqual(pragma[0].integrity_check, 'ok', 'SQLite integrity must remain ok');

      const reloadedDoc = await repo.getDocument(doc.id);
      assert.strictEqual(reloadedDoc?.content, 'Original Content', 'Local document content must remain intact');
    });

    test('1.2: Truncated JSON response on Drive files search fails JSON parse without crashing process', async () => {
      // Fault injection: Return 200 OK but truncated invalid JSON
      server.onFetchHook = async (urlStr: string) => {
        if (urlStr.includes('/drive/v3/files')) {
          return new Response('{"files": [{"id": "gdoc-broken", "name": "Incomplete', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return null;
      };

      await assert.rejects(
        async () => {
          await adapter.ensureDaylightFolder(true);
        },
        (err: any) => {
          assert.ok(
            err instanceof SyntaxError || err.name === 'SyntaxError' || String(err).includes('JSON'),
            'Must raise JSON parse SyntaxError'
          );
          return true;
        }
      );

      // Verify SQLite state remains operational
      const pragma = await testDb.executeSql<{ integrity_check: string }>('PRAGMA integrity_check;');
      assert.strictEqual(pragma[0].integrity_check, 'ok');
    });

    test('1.3: Empty 0-byte response on Docs batchUpdate raises structured error and sets error state', async () => {
      // Seed remote file and local doc mapped to it
      server.seedFile({
        id: 'gdoc-empty-resp-test',
        name: 'Empty Test Doc',
        content: 'Existing cloud content',
      });

      const localDoc = await repo.saveDocument({
        id: 'doc-empty-resp',
        title: 'Empty Test Doc',
        content: 'New content to push',
        google_drive_file_id: 'gdoc-empty-resp-test',
        sync_status: 'pending',
      });
      await repo.flushPendingEdits();

      adapter.queueMutation(localDoc.id, 'update', localDoc);

      // Fault injection: batchUpdate returns empty 500
      server.onFetchHook = async (urlStr: string) => {
        if (urlStr.includes(':batchUpdate')) {
          return new Response('', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        return null;
      };

      await assert.rejects(
        async () => {
          await adapter.sync();
        },
        (err: Error) => {
          assert.ok(err.message.includes('500'), 'Error must note 500 status');
          return true;
        }
      );

      assert.strictEqual(adapter.getStatus().state, 'error');
      assert.ok(adapter.syncLogs.some((l) => l.type === 'error'));

      // SQLite uncorrupted
      const doc = await repo.getDocument(localDoc.id);
      assert.strictEqual(doc?.content, 'New content to push');
    });

    test('1.4: Single-file 502 Bad Gateway during pull() records error for that file without failing entire reconciliation', async () => {
      // Seed 3 remote files in Google Drive
      server.seedFile({
        id: 'gdoc-multi-1',
        name: 'Healthy Chapter 1',
        content: 'Content 1',
      });
      server.seedFile({
        id: 'gdoc-multi-2',
        name: 'Corrupted Chapter 2',
        content: 'Content 2',
      });
      server.seedFile({
        id: 'gdoc-multi-3',
        name: 'Healthy Chapter 3',
        content: 'Content 3',
      });

      // Fault injection: only gdoc-multi-2 fails with 502 Bad Gateway HTML
      server.onFetchHook = async (urlStr: string) => {
        if (urlStr.includes('gdoc-multi-2/export')) {
          return new Response('<html><body>502 Bad Gateway</body></html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          });
        }
        return null;
      };

      const pullRes = await adapter.pull();

      // Reconciliation should succeed partially: 2 imported, 1 error recorded
      assert.strictEqual(pullRes.createdCount, 2, '2 healthy documents must be imported');
      assert.ok(pullRes.errors && pullRes.errors.length === 1, 'Exactly 1 file error must be captured');
      assert.strictEqual(pullRes.errors![0].fileId, 'gdoc-multi-2');
      assert.ok(pullRes.errors![0].error.includes('502'), 'Captured error must note 502');

      // Verify the 2 healthy documents exist in SQLite
      const healthy1 = await repo.findByDriveFileId('gdoc-multi-1');
      assert.ok(healthy1, 'Healthy file 1 must be saved to SQLite');
      assert.strictEqual(healthy1?.content, 'Content 1');

      const healthy3 = await repo.findByDriveFileId('gdoc-multi-3');
      assert.ok(healthy3, 'Healthy file 3 must be saved to SQLite');
      assert.strictEqual(healthy3?.content, 'Content 3');

      // Corrupted file 2 must NOT exist in SQLite
      const corrupted = await repo.findByDriveFileId('gdoc-multi-2');
      assert.strictEqual(corrupted, null, 'Corrupted file must not create phantom SQLite record');
    });

    test('1.5: Corrupted non-JSON 503 response during init() folder discovery defers folder initialization without crash', async () => {
      server.onFetchHook = async (urlStr: string) => {
        if (urlStr.includes('/drive/v3/files?q=')) {
          return new Response('<html>503 Service Unavailable: Drive backend overloaded</html>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          });
        }
        return null;
      };

      // init() catches and logs warning per line 616 of adapter
      await adapter.init();
      assert.ok(true, 'init() must complete without throwing unhandled rejection');
      assert.strictEqual(adapter.getStatus().state, 'idle');
    });
  });

  // ==========================================================================
  // Challenge 2: Concurrent Local Mutations vs Remote Merging
  // ==========================================================================
  describe('Challenge 2: Concurrent Local Mutations vs Remote Merging (LWW Integrity)', () => {
    test('2.1: Concurrent local updates across multiple documents during asynchronous pull() strictly honor LWW', async () => {
      const baseTime = 1700000000000;

      // Doc 1: Local older (baseTime + 1000), Remote newer (baseTime + 3000) -> Remote wins
      const doc1 = await repo.saveDocument({
        id: 'doc-lww-c1',
        title: 'Doc 1 Local Title',
        content: 'Doc 1 Local Content (older)',
        google_drive_file_id: 'gdoc-lww-c1',
        updated_at: baseTime + 1000,
        sync_status: 'synced',
      });

      // Doc 2: Local newer (baseTime + 5000), Remote older (baseTime + 2000) -> Local wins
      const doc2 = await repo.saveDocument({
        id: 'doc-lww-c2',
        title: 'Doc 2 Local Title',
        content: 'Doc 2 Local Content (newer)',
        google_drive_file_id: 'gdoc-lww-c2',
        updated_at: baseTime + 5000,
        sync_status: 'synced',
      });

      // Doc 3: Exact tie (baseTime + 4000) -> In sync
      const doc3 = await repo.saveDocument({
        id: 'doc-lww-c3',
        title: 'Doc 3 Tie Title',
        content: 'Doc 3 Tie Content',
        google_drive_file_id: 'gdoc-lww-c3',
        updated_at: baseTime + 4000,
        sync_status: 'synced',
      });

      await repo.flushPendingEdits();

      // Seed remote files in server
      server.seedFile({
        id: 'gdoc-lww-c1',
        name: 'Doc 1 Remote Title (Winning)',
        content: 'Doc 1 Remote Content (newer winning text)',
        modifiedTime: new Date(baseTime + 3000).toISOString(),
      });

      server.seedFile({
        id: 'gdoc-lww-c2',
        name: 'Doc 2 Remote Title (Stale)',
        content: 'Doc 2 Remote Content (stale text)',
        modifiedTime: new Date(baseTime + 2000).toISOString(),
      });

      server.seedFile({
        id: 'gdoc-lww-c3',
        name: 'Doc 3 Tie Title',
        content: 'Doc 3 Tie Content',
        modifiedTime: new Date(baseTime + 4000).toISOString(),
      });

      // Inject 35ms network latency on server requests to simulate real remote latency
      server.artificialDelayMs = 35;

      // Start asynchronous pull reconciliation
      const pullPromise = adapter.pull();

      // CONCURRENTLY execute local mutations on SQLite while pull is executing:
      // - Update Doc 2 to even newer timestamp (baseTime + 8000)
      // - Create a brand new local document Doc 4 (baseTime + 7000)
      const concurrentWritePromise = (async () => {
        await new Promise((r) => setTimeout(r, 10)); // let pull begin
        await repo.saveDocument({
          id: doc2.id,
          content: 'Doc 2 Super Fresh Local Typing on DC1 LivePaper',
          updated_at: baseTime + 8000,
        });
        await repo.saveDocument({
          id: 'doc-lww-c4',
          title: 'Doc 4 Created Concurrently',
          content: 'Brand new manuscript chapter drafted while pull was running',
          updated_at: baseTime + 7000,
        });
        await repo.flushPendingEdits();
      })();

      // Await both operations
      await Promise.all([pullPromise, concurrentWritePromise]);

      // Assert LWW Invariants across all documents:
      // 1. Doc 1: Remote was newer (3000 > 1000) -> Remote content won
      const finalDoc1 = await repo.getDocument(doc1.id);
      assert.strictEqual(finalDoc1?.title, 'Doc 1 Remote Title (Winning)');
      assert.strictEqual(finalDoc1?.content, 'Doc 1 Remote Content (newer winning text)');
      assert.strictEqual(finalDoc1?.updated_at, baseTime + 3000);

      // 2. Doc 2: Local was newer (8000 > 2000) -> Local content MUST NOT be overwritten!
      const finalDoc2 = await repo.getDocument(doc2.id);
      assert.strictEqual(
        finalDoc2?.content,
        'Doc 2 Super Fresh Local Typing on DC1 LivePaper',
        'Local edit with newer timestamp must NEVER be overwritten by older remote content'
      );
      assert.strictEqual(finalDoc2?.updated_at, baseTime + 8000);

      // 3. Doc 3: Tie -> preserved
      const finalDoc3 = await repo.getDocument(doc3.id);
      assert.strictEqual(finalDoc3?.content, 'Doc 3 Tie Content');

      // 4. Doc 4: Created concurrently -> completely intact
      const finalDoc4 = await repo.getDocument('doc-lww-c4');
      assert.strictEqual(finalDoc4?.content, 'Brand new manuscript chapter drafted while pull was running');
      assert.strictEqual(finalDoc4?.updated_at, baseTime + 7000);
    });

    test('2.2: Interleaved direct conflict resolution oracle adheres strictly to monotonic timestamp comparison', async () => {
      const base = 1000000;
      const localOlder: DocumentRecord = {
        id: 'doc-oracle-1',
        title: 'Local Older',
        content: 'Local text at t=1000',
        created_at: base,
        updated_at: base + 1000,
        deleted_at: null,
        is_title_custom: false,
        format_version: 1,
        sync_status: 'pending',
      };

      const remoteNewer: DocumentRecord = {
        id: 'doc-oracle-1',
        title: 'Remote Newer',
        content: 'Remote text at t=2000',
        created_at: base,
        updated_at: base + 2000,
        deleted_at: null,
        is_title_custom: false,
        format_version: 1,
        sync_status: 'synced',
      };

      // Remote wins
      const resRemoteWon = await adapter.resolveConflict(localOlder, remoteNewer, 'last-write-wins');
      assert.strictEqual(resRemoteWon.content, 'Remote text at t=2000');
      assert.strictEqual(resRemoteWon.updated_at, base + 2000);

      // Invert: local newer (t=3000) vs remote older (t=2000) -> Local wins
      const localNewer: DocumentRecord = {
        ...localOlder,
        content: 'Local text at t=3000',
        updated_at: base + 3000,
      };
      const resLocalWon = await adapter.resolveConflict(localNewer, remoteNewer, 'last-write-wins');
      assert.strictEqual(resLocalWon.content, 'Local text at t=3000');
      assert.strictEqual(resLocalWon.updated_at, base + 3000);

      // Exact millisecond tie: local >= remote -> local preserves
      const tieLocal: DocumentRecord = { ...localOlder, updated_at: base + 2000, content: 'Local tie text' };
      const resTie = await adapter.resolveConflict(tieLocal, remoteNewer, 'last-write-wins');
      assert.strictEqual(resTie.content, 'Local tie text', 'Exact timestamp tie must favor local');
    });

    test('2.3: Monotonic version vectors increment strictly under concurrent multi-document writer burst', async () => {
      const docCount = 10;
      const initialDocs: DocumentRecord[] = [];

      for (let i = 0; i < docCount; i++) {
        const d = await repo.saveDocument({
          id: `doc-burst-${i}`,
          title: `Burst Chapter ${i}`,
          content: `Initial content ${i}`,
        });
        initialDocs.push(d);
      }
      await repo.flushPendingEdits();

      // Launch 5 rapid concurrent updates on each of the 10 documents
      const burstUpdates: Promise<any>[] = [];
      for (let round = 1; round <= 5; round++) {
        for (let i = 0; i < docCount; i++) {
          burstUpdates.push(
            repo.saveDocument({
              id: `doc-burst-${i}`,
              content: `Content ${i} after round ${round}`,
            })
          );
        }
      }

      await Promise.all(burstUpdates);
      await repo.flushPendingEdits();

      // Verify each document has version_vector >= 6 (1 initial + 5 updates)
      for (let i = 0; i < docCount; i++) {
        const doc = await repo.getDocument(`doc-burst-${i}`);
        assert.ok(doc, `Doc ${i} must exist`);
        assert.ok(
          (doc.version_vector ?? 0) >= 6,
          `Doc ${i} version vector must be at least 6, got ${doc.version_vector}`
        );
      }

      // SQLite integrity verification
      const integrity = await testDb.executeSql<{ integrity_check: string }>('PRAGMA integrity_check;');
      assert.strictEqual(integrity[0].integrity_check, 'ok');
    });

    test('2.4: Simultaneous bidirectional sync: concurrent queue drain + remote pull execute without deadlock or collision', async () => {
      // 1. Seed 5 distinct documents locally in queue to push
      for (let i = 1; i <= 5; i++) {
        const localDoc = await repo.saveDocument({
          id: `doc-bidi-local-${i}`,
          title: `Local Manuscript Chapter ${i}`,
          content: `Local text created offline ${i}`,
          sync_status: 'synced',
        });
        await queue.enqueue('document', localDoc.id, 'create', localDoc);
      }
      await repo.flushPendingEdits();

      // 2. Seed 5 remote documents in Google Drive to pull
      for (let i = 1; i <= 5; i++) {
        server.seedFile({
          id: `gdoc-bidi-remote-${i}`,
          name: `Remote Manuscript Chapter ${i}`,
          content: `Remote text created on cloud ${i}`,
          modifiedTime: new Date(Date.now() - 50000 + i * 1000).toISOString(),
        });
      }

      adapter.setOnline(true);
      server.artificialDelayMs = 15; // simulate real network latency

      // 3. Concurrently launch both drain and pull
      const [drainResult, pullResult] = await Promise.all([
        queue.drain(adapter),
        adapter.pull(),
      ]);

      // 4. Assert both directions completed
      assert.strictEqual(drainResult.pushedCount, 5, 'All 5 local documents must be pushed to Google Drive');
      assert.strictEqual(pullResult.createdCount, 5, 'All 5 remote documents must be imported to SQLite');

      // 5. Total documents in repository must now be 10
      const allLocalDocs = await repo.listDocuments();
      assert.strictEqual(allLocalDocs.length, 10, 'Repository must contain all 10 reconciled documents');

      // 6. SQLite integrity check
      const integrity = await testDb.executeSql<{ integrity_check: string }>('PRAGMA integrity_check;');
      assert.strictEqual(integrity[0].integrity_check, 'ok');
    });
  });

  // ==========================================================================
  // Challenge 3: Offline Queue Heavy Coalescing & Crash Recovery
  // ==========================================================================
  describe('Challenge 3: Offline Queue Heavy Coalescing & Crash Recovery', () => {
    test('3.1: 100 rapid updates on same document while offline coalesce into EXACTLY 1 row with 100:1 ratio', async () => {
      adapter.setOnline(false);

      const targetDocId = 'doc-coalesce-target-1';
      const baseTime = 1710000000000;

      // Initial local document
      await repo.saveDocument({
        id: targetDocId,
        title: 'Original Title',
        content: 'Original Content',
        google_drive_file_id: 'gdoc-coalesce-1',
      });
      await repo.flushPendingEdits();

      // Enqueue 100 rapid update mutations while offline
      for (let i = 1; i <= 100; i++) {
        await queue.enqueue(
          'document',
          targetDocId,
          'update',
          {
            id: targetDocId,
            title: `Title Rev ${i}`,
            content: `Paragraph text edit revision number ${i} on DC1 LivePaper`,
            google_drive_file_id: 'gdoc-coalesce-1',
            updated_at: baseTime + i * 100,
          },
          baseTime + i * 100
        );
      }

      // Assert queue has EXACTLY 1 pending mutation for this document in SQLite
      const rows = await testDb.executeSql<SyncQueueRecord>(
        `SELECT * FROM sync_queue WHERE entity_id = ? AND entity_type = 'document';`,
        [targetDocId]
      );
      assert.strictEqual(rows.length, 1, 'All 100 updates must coalesce into exactly 1 pending SQLite row');
      assert.strictEqual(await queue.getPendingCount(), 1);

      // Verify the single row holds the 100th latest payload
      const storedPayload = JSON.parse(rows[0].payload);
      assert.strictEqual(storedPayload.title, 'Title Rev 100');
      assert.strictEqual(storedPayload.content, 'Paragraph text edit revision number 100 on DC1 LivePaper');
      assert.strictEqual(rows[0].operation, 'update');
      assert.strictEqual(rows[0].client_timestamp, baseTime + 100 * 100);
      assert.strictEqual(rows[0].status, 'pending');
    });

    test('3.2: 100 rapid operations: 1 Create + 98 Updates + 1 Delete completely deletes offline row (0 rows)', async () => {
      const transientDocId = 'doc-transient-draft';
      const baseTime = 1710000000000;

      // 1. Create offline
      await queue.enqueue(
        'document',
        transientDocId,
        'create',
        { id: transientDocId, title: 'Ephemeral Manuscript', content: 'V0' },
        baseTime
      );

      // 2. 98 rapid updates
      for (let i = 1; i <= 98; i++) {
        await queue.enqueue(
          'document',
          transientDocId,
          'update',
          { id: transientDocId, title: 'Ephemeral Manuscript', content: `V${i}` },
          baseTime + i * 50
        );
      }

      // Prior to delete: exactly 1 row as 'create'
      const preDeleteRows = await testDb.executeSql<SyncQueueRecord>(
        `SELECT * FROM sync_queue WHERE entity_id = ?;`,
        [transientDocId]
      );
      assert.strictEqual(preDeleteRows.length, 1);
      assert.strictEqual(preDeleteRows[0].operation, 'create');

      // 3. User deletes the draft before it was ever uploaded to Google Drive
      await queue.enqueue(
        'document',
        transientDocId,
        'delete',
        { id: transientDocId },
        baseTime + 5000
      );

      // Both create and delete should be eliminated cleanly
      const postDeleteRows = await testDb.executeSql<SyncQueueRecord>(
        `SELECT * FROM sync_queue WHERE entity_id = ?;`,
        [transientDocId]
      );
      assert.strictEqual(
        postDeleteRows.length,
        0,
        'Entity created and deleted offline must be pruned completely from sync_queue'
      );
      assert.strictEqual(await queue.getPendingCount(), 0);
    });

    test('3.3: 100 rapid operations: 1 Create + 99 Updates retains "create" operation with 100th payload', async () => {
      const newDocId = 'doc-create-coalesce';
      const baseTime = 1710000000000;

      await queue.enqueue('document', newDocId, 'create', { id: newDocId, title: 'New Doc', content: 'V0' }, baseTime);

      for (let i = 1; i <= 99; i++) {
        await queue.enqueue(
          'document',
          newDocId,
          'update',
          { id: newDocId, title: `New Doc Rev ${i}`, content: `Content Rev ${i}` },
          baseTime + i * 50
        );
      }

      const rows = await testDb.executeSql<SyncQueueRecord>(
        `SELECT * FROM sync_queue WHERE entity_id = ?;`,
        [newDocId]
      );
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].operation, 'create', 'Operation must remain create so cloud creates genuine Google Doc');
      const payload = JSON.parse(rows[0].payload);
      assert.strictEqual(payload.title, 'New Doc Rev 99');
      assert.strictEqual(payload.content, 'Content Rev 99');
    });

    test('3.4: Repository close, simulated crash, and state recovery recovers in-flight rows and drains cleanly', async () => {
      // 1. Populate queue with 20 items
      for (let i = 0; i < 20; i++) {
        await queue.enqueue(
          'document',
          `doc-crash-rec-${i}`,
          'create',
          { id: `doc-crash-rec-${i}`, title: `Crash Chapter ${i}`, content: `Manuscript text ${i}` }
        );
      }

      // 2. Simulate 5 items in the middle of being pushed when browser was abruptly killed ('in_flight')
      const allRows = await testDb.executeSql<SyncQueueRecord>(`SELECT id FROM sync_queue LIMIT 5;`);
      const inFlightIds = allRows.map((r) => r.id);
      for (const id of inFlightIds) {
        await testDb.executeSql(`UPDATE sync_queue SET status = 'in_flight' WHERE id = ?;`, [id]);
      }

      // 3. Close repository & queue (simulating app shutdown/crash)
      repo.destroy();

      // 4. Reopen new repository & new queue on the SAME SQLite database
      const reopenedRepo = new SQLiteStorageRepository(testDb);
      await reopenedRepo.init();

      const reopenedQueue = new OfflineMutationQueue(testDb, { batchSize: 50 });
      const recoveredCount = await reopenedQueue.init();

      // Assert crash recovery restored all 5 in_flight mutations to pending
      assert.strictEqual(recoveredCount, 5, 'Must recover exactly 5 abandoned in_flight mutations');
      assert.strictEqual(await reopenedQueue.getPendingCount(), 20, 'All 20 mutations must now be pending');

      // 5. Connect adapter to reopened queue and drain online
      adapter.setOnline(true);
      const drainResult = await reopenedQueue.drain(adapter);

      assert.strictEqual(drainResult.pushedCount, 20, 'All 20 mutations must drain successfully');
      assert.strictEqual(drainResult.failedCount, 0);
      assert.strictEqual(await reopenedQueue.getPendingCount(), 0, 'Queue must be empty after drain');
    });

    test('3.5: Heavy multi-document interleaved bursts (250 operations across 5 documents) compacts to 5 rows and survives repo restart', async () => {
      adapter.setOnline(false);
      const docIds = ['doc-burst-a', 'doc-burst-b', 'doc-burst-c', 'doc-burst-d', 'doc-burst-e'];

      // Create all 5 initial documents
      for (const id of docIds) {
        await repo.saveDocument({ id, title: `Title ${id}`, content: `Initial ${id}`, sync_status: 'synced' });
        await queue.enqueue('document', id, 'create', { id, title: `Title ${id}`, content: `Initial ${id}` });
      }
      await repo.flushPendingEdits();

      // Interleave 49 updates across each of the 5 documents (total 245 more operations, 250 total)
      for (let round = 1; round <= 49; round++) {
        for (const id of docIds) {
          await queue.enqueue('document', id, 'update', {
            id,
            title: `Title ${id} R${round}`,
            content: `Content for ${id} in round ${round}`,
          });
        }
      }

      // Assert queue has EXACTLY 5 rows (one per document)
      const queueRows = await testDb.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
      assert.strictEqual(queueRows.length, 5, '250 mutations must compact cleanly into exactly 5 rows in sync_queue');
      assert.strictEqual(await queue.getPendingCount(), 5);

      // Verify each row has latest round 49 payload
      for (const row of queueRows) {
        assert.strictEqual(row.operation, 'create', 'Operation must remain create for unpushed document');
        const payload = JSON.parse(row.payload);
        assert.ok(payload.title.includes('R49'), `Payload must have latest round 49 title, got ${payload.title}`);
      }

      // Close and reopen repository
      repo.destroy();
      const reopenedRepo = new SQLiteStorageRepository(testDb);
      await reopenedRepo.init();

      const reopenedQueue = new OfflineMutationQueue(testDb);
      await reopenedQueue.init();

      assert.strictEqual(await reopenedQueue.getPendingCount(), 5);

      // Verify SQLite state is uncorrupted
      const integrity = await testDb.executeSql<{ integrity_check: string }>('PRAGMA integrity_check;');
      assert.strictEqual(integrity[0].integrity_check, 'ok');
    });
  });

  // ==========================================================================
  // Challenge 4: Token Expiration Mid-Batch Drain
  // ==========================================================================
  describe('Challenge 4: Token Expiration Mid-Batch Drain & Silent Refresh', () => {
    test('4.1: Mid-batch HTTP 401 on item 2 triggers silent refresh, retries item 2 with fresh token, and drains all 4 items', async () => {
      // Setup 4 distinct documents queued for sync
      for (let i = 1; i <= 4; i++) {
        await queue.enqueue('document', `doc-token-expire-${i}`, 'create', {
          id: `doc-token-expire-${i}`,
          title: `Document ${i}`,
          content: `Content for document ${i}`,
        });
      }
      assert.strictEqual(await queue.getPendingCount(), 4);

      // Configure server to return HTTP 401 on item 2's FIRST attempt
      let item2FirstAttempt = true;
      server.onFetchHook = async (urlStr: string, init?: RequestInit) => {
        // Intercept upload request for item 2
        if (urlStr.includes('/upload/drive/v3/files')) {
          const bodyStr = typeof init?.body === 'string' ? init.body : '';
          if (bodyStr.includes('Document 2') && item2FirstAttempt) {
            item2FirstAttempt = false;
            // First attempt: return HTTP 401 Unauthorized
            return new Response(
              JSON.stringify({
                error: {
                  code: 401,
                  message: 'Request had invalid authentication credentials. Expected OAuth 2 access token.',
                  status: 'UNAUTHENTICATED',
                },
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
        return null;
      };

      // Ensure adapter is online
      adapter.setOnline(true);

      // Execute queue drain
      const drainResult = await queue.drain(adapter);

      // Assert all 4 items pushed successfully without queue stall
      assert.strictEqual(drainResult.pushedCount, 4, 'All 4 items must drain successfully');
      assert.strictEqual(drainResult.failedCount, 0, 'Zero failed items');
      assert.strictEqual(await queue.getPendingCount(), 0, 'Queue must be empty');

      // Assert token refresh occurred exactly once
      assert.strictEqual(server.tokenRefreshCount, 1, 'Silent token refresh must be invoked exactly once');

      // Assert adapter access token was updated to fresh token
      const currentToken = await adapter.getValidAccessToken();
      assert.strictEqual(
        currentToken,
        'ya29.fresh-refreshed-token-456',
        'Adapter must now hold the refreshed access token'
      );

      // Assert adapter status returned to synced
      assert.strictEqual(adapter.getStatus().state, 'synced');
      assert.strictEqual(adapter.getStatus().error, null);

      // Assert all 4 documents exist in server
      assert.strictEqual(server.files.size, 4);
    });

    test('4.2: Unrecoverable HTTP 401 (revoked refresh token) rolls back unpushed items to pending without data corruption', async () => {
      // Setup 3 items in queue
      for (let i = 1; i <= 3; i++) {
        await queue.enqueue('document', `doc-unrecov-401-${i}`, 'create', {
          id: `doc-unrecov-401-${i}`,
          title: `Unrecoverable Doc ${i}`,
          content: `Content ${i}`,
        });
      }

      // Configure adapter with revoked refresh token
      adapter.setTokens({
        accessToken: 'ya29.valid-initial',
        refreshToken: 'revoked-token', // server will return 400 invalid_grant
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });

      // Item 2 fails with 401
      server.onFetchHook = async (urlStr: string, init?: RequestInit) => {
        if (urlStr.includes('/upload/drive/v3/files')) {
          const bodyStr = typeof init?.body === 'string' ? init.body : '';
          if (bodyStr.includes('Unrecoverable Doc 2')) {
            return new Response(JSON.stringify({ error: { code: 401, message: 'Invalid credentials' } }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        return null;
      };

      adapter.setOnline(true);
      const drainResult = await queue.drain(adapter);

      // Item 1 may have pushed before failure or batch rolled back
      assert.strictEqual(drainResult.failedCount > 0 || drainResult.pushedCount < 3, true);

      // Adapter transitions to error state
      assert.strictEqual(adapter.getStatus().state, 'error');

      // SQLite sync_queue retains unpushed items with retry_count incremented
      const remainingRows = await testDb.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
      assert.ok(remainingRows.length > 0, 'Unpushed mutations must remain in sync_queue for subsequent retry');
      assert.ok(remainingRows.some((r) => r.status === 'pending'), 'Remaining mutations must be in pending status');

      // SQLite integrity verification
      const integrity = await testDb.executeSql<{ integrity_check: string }>('PRAGMA integrity_check;');
      assert.strictEqual(integrity[0].integrity_check, 'ok');
    });

    test('4.3: Silent token refresh request deduplication under concurrent pressure', async () => {
      const options = {
        clientId: 'test-client',
        redirectUri: 'http://localhost/cb',
      };

      // Dispatch 20 concurrent refresh requests using the same refresh token
      const promises = Array.from({ length: 20 }, () =>
        refreshAccessToken('mock-refresh-token-xyz', options)
      );

      const responses = await Promise.all(promises);

      // All 20 returned the same refreshed token
      for (const res of responses) {
        assert.strictEqual(res.access_token, 'ya29.fresh-refreshed-token-456');
      }

      // Exactly 1 network request was issued to Google OAuth endpoint
      assert.strictEqual(server.tokenRefreshCount, 1, '20 concurrent refresh requests must coalesce to 1 network call');
    });

    test('4.4: Multi-item drain (8 items) reuses refreshed token for all subsequent items without redundant refreshes', async () => {
      // Setup 8 distinct documents queued for sync
      for (let i = 1; i <= 8; i++) {
        await queue.enqueue('document', `doc-token-reuse-${i}`, 'create', {
          id: `doc-token-reuse-${i}`,
          title: `Document ${i}`,
          content: `Content for document ${i}`,
        });
      }
      assert.strictEqual(await queue.getPendingCount(), 8);

      // Fail item 2 only on first try with initial token
      let item2Failed = false;
      server.onFetchHook = async (urlStr: string, init?: RequestInit) => {
        if (urlStr.includes('/upload/drive/v3/files')) {
          const bodyStr = typeof init?.body === 'string' ? init.body : '';
          if (bodyStr.includes('Document 2') && !item2Failed) {
            item2Failed = true;
            return new Response(JSON.stringify({ error: { code: 401, message: 'Expired token' } }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        return null;
      };

      adapter.setOnline(true);
      const drainResult = await queue.drain(adapter);

      assert.strictEqual(drainResult.pushedCount, 8, 'All 8 items must drain successfully');
      assert.strictEqual(drainResult.failedCount, 0);
      assert.strictEqual(await queue.getPendingCount(), 0);

      // Token refresh should occur EXACTLY once
      assert.strictEqual(server.tokenRefreshCount, 1, 'Token refresh must occur only once');

      // Verify that all items 3 to 8 used the refreshed token
      const uploadRequests = server.recordedRequests.filter((r) => r.url.includes('/upload/drive/v3/files'));
      assert.strictEqual(uploadRequests.length, 9); // item 1 + item 2 (attempt 1) + item 2 (retry) + items 3..8 = 9
      for (let i = 2; i < uploadRequests.length; i++) {
        assert.strictEqual(
          uploadRequests[i].authHeader,
          'Bearer ya29.fresh-refreshed-token-456',
          `Request ${i} must use the refreshed token`
        );
      }
    });
  });
});
