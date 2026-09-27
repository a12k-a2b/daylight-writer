/**
 * tests/adversarial/m2-challenger2-sync-reconciliation-stress.test.ts
 * Milestone 2 Empirical Adversarial Stress Test Suite:
 * Bidirectional Reconciliation & Offline Queue Drain Hardening
 *
 * Tailored for Daylight Computer (DC1) LivePaper Display
 *
 * Verifies:
 * 1. Infinite loop prevention: pull() importing/updating documents followed by
 *    repo.flushPendingEdits() does NOT insert documents into sync_queue or trigger sync storms.
 * 2. Last-Write-Wins (LWW) conflict resolution: exact winning content for remote-newer,
 *    local-newer, timestamp ties, 1ms sub-second differences, and multi-doc matrices.
 * 3. Offline queue recovery: 50 offline mutations injected into SQLite sync_queue,
 *    simulating network reconnection and draining with zero dropped edits across
 *    various batch sizes (10, 17, 50), mixed operations (creates + in-place updates),
 *    and mid-drain network failures with crash recovery.
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations } from '../../src/storage/schema.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import type { DatabaseDriver, DocumentRecord, SyncQueueRecord } from '../../src/storage/schema.ts';

// Hermetic in-memory localStorage mock for Node.js test environment
class MockLocalStorage {
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

// In-memory mock Google Drive & Google Docs server state
interface MockRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  modifiedTime: string;
  version: string;
  revisionId: string;
  webViewLink: string;
  trashed: boolean;
}

class HermeticDriveServer {
  public files: Map<string, MockRemoteFile> = new Map();
  public folderId: string = 'daylight-manuscripts-folder-id';
  public folderName: string = 'Daylight Manuscripts';
  public requests: Array<{ url: string; method: string; body?: any }> = [];
  public failNextBatchAfterCount: number = Infinity;
  public failError: Error | null = null;
  public simulatedDelayMs: number = 0;

  private fileSeq: number = 1000;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.files.clear();
    this.requests = [];
    this.failNextBatchAfterCount = Infinity;
    this.failError = null;
    this.simulatedDelayMs = 0;
  }

  public seedFile(file: Partial<MockRemoteFile> & { id: string; name: string }): MockRemoteFile {
    const fullFile: MockRemoteFile = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType || 'application/vnd.google-apps.document',
      content: file.content || '',
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      version: file.version || '1',
      revisionId: file.revisionId || `rev-${file.id}-1`,
      webViewLink: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
      trashed: file.trashed || false,
    };
    this.files.set(file.id, fullFile);
    return fullFile;
  }

  public async handleFetch(urlStr: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method || 'GET').toUpperCase();
    const url = new URL(urlStr);
    const bodyStr = typeof init?.body === 'string' ? init.body : null;

    this.requests.push({ url: urlStr, method, body: bodyStr });

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    if (this.requests.length > this.failNextBatchAfterCount && this.failError) {
      throw this.failError;
    }

    // 1. UserInfo endpoint
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

    // 2. Drive v3 Files list & search (GET /drive/v3/files)
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || '';

      // Folder resolution query
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'") || q.includes('application/vnd.google-apps.folder')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: this.folderId,
                name: this.folderName,
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Files in folder query
      const matchingFiles: any[] = [];
      for (const file of this.files.values()) {
        if (file.trashed) continue;
        matchingFiles.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          createdTime: file.modifiedTime,
          version: file.version,
          revisionId: file.revisionId,
          webViewLink: file.webViewLink,
          trashed: file.trashed,
        });
      }

      return new Response(
        JSON.stringify({ files: matchingFiles, nextPageToken: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Export Google Doc (GET /drive/v3/files/{id}/export)
    const exportMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)\/export/);
    if (exportMatch && method === 'GET') {
      const fileId = exportMatch[1];
      const file = this.files.get(fileId);
      if (!file || file.trashed) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(file.content, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 4. Multipart Doc Creation (POST /upload/drive/v3/files?uploadType=multipart)
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const fileId = `gdoc-created-${++this.fileSeq}`;
      let parsedName = 'Untitled Document';
      let parsedContent = '';

      if (bodyStr) {
        const metaMatch = bodyStr.match(/\{[\s\S]*?\}/);
        if (metaMatch) {
          try {
            const meta = JSON.parse(metaMatch[0]);
            if (meta.name) parsedName = meta.name;
          } catch {}
        }
        const parts = bodyStr.split(/\r?\n--[^\r\n]+\r?\n/);
        if (parts.length >= 3) {
          const contentPart = parts[2];
          const headerEnd = contentPart.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            parsedContent = contentPart.slice(headerEnd + 4).replace(/\r?\n--[^\r\n]+--/, '');
          } else {
            parsedContent = contentPart;
          }
        }
      }

      const createdFile: MockRemoteFile = {
        id: fileId,
        name: parsedName,
        mimeType: 'application/vnd.google-apps.document',
        content: parsedContent,
        modifiedTime: new Date().toISOString(),
        version: '1',
        revisionId: `rev-${fileId}-1`,
        webViewLink: `https://docs.google.com/document/d/${fileId}/edit`,
        trashed: false,
      };

      this.files.set(fileId, createdFile);

      return new Response(
        JSON.stringify({
          id: fileId,
          name: createdFile.name,
          mimeType: createdFile.mimeType,
          version: createdFile.version,
          webViewLink: createdFile.webViewLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Google Docs API v1: GET Document length (GET /v1/documents/{documentId})
    const docGetMatch = url.pathname.match(/\/v1\/documents\/([^/:]+)$/);
    if (docGetMatch && method === 'GET') {
      const docId = docGetMatch[1];
      const file = this.files.get(docId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'Doc not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const textLen = (file.content || '').length;
      return new Response(
        JSON.stringify({
          documentId: file.id,
          title: file.name,
          body: {
            content: [
              { endIndex: 1 },
              {
                startIndex: 1,
                endIndex: 1 + textLen + 1,
                paragraph: { elements: [{ textRun: { content: file.content } }] },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Google Docs API v1: batchUpdate (POST /v1/documents/{documentId}:batchUpdate)
    const batchMatch = url.pathname.match(/\/v1\/documents\/([^/:]+):batchUpdate$/);
    if (batchMatch && method === 'POST') {
      const docId = batchMatch[1];
      const file = this.files.get(docId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'Doc not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let payload: any = {};
      try {
        payload = JSON.parse(bodyStr || '{}');
      } catch {}

      for (const req of payload.requests || []) {
        if (req.deleteContentRange) {
          file.content = '';
        } else if (req.insertText) {
          file.content = (file.content || '') + (req.insertText.text || '');
        }
      }

      const verNum = parseInt(file.version || '1', 10) + 1;
      file.version = String(verNum);
      file.revisionId = `rev-${docId}-${file.version}`;
      file.modifiedTime = new Date().toISOString();

      return new Response(
        JSON.stringify({
          documentId: file.id,
          revisionId: file.revisionId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. Drive v3 Metadata PATCH (PATCH /drive/v3/files/{id})
    const metaPatchMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    if (metaPatchMatch && method === 'PATCH') {
      const fileId = metaPatchMatch[1];
      const file = this.files.get(fileId);
      if (!file) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'File not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let data: any = {};
      try {
        data = JSON.parse(bodyStr || '{}');
      } catch {}

      if (data.name) file.name = data.name;
      if (data.trashed !== undefined) file.trashed = data.trashed;

      return new Response(
        JSON.stringify({
          id: file.id,
          name: file.name,
          version: file.version,
          webViewLink: file.webViewLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

describe('Milestone 2 Adversarial Stress Suite: Sync Reconciliation & Offline Queue Drain', () => {
  let testDb: DatabaseDriver;
  let repo: SQLiteStorageRepository;
  let adapter: GoogleDriveSyncAdapter;
  let server: HermeticDriveServer;
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

    server = new HermeticDriveServer();
    global.fetch = ((url: string, init?: RequestInit) => server.handleFetch(url, init)) as any;

    testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
    await runMigrations(testDb);

    repo = new SQLiteStorageRepository(testDb);
    await repo.init();

    adapter = new GoogleDriveSyncAdapter({
      targetFolderName: 'Daylight Manuscripts',
      db: testDb,
      repository: repo,
    });
    adapter.setAccessToken('ya29.empirical-challenger-valid-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalLocalStorage !== undefined) {
      (globalThis as any).localStorage = originalLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
  });

  // ==========================================================================
  // SECTION 1: Infinite Loop Prevention & Sync Storm Immunity
  // ==========================================================================
  describe('Section 1: Infinite Loop Prevention & Sync Storm Immunity', () => {
    test('Empirical 1.1: pull() importing 10 remote docs marks them synced; subsequent repo.flushPendingEdits() does NOT enqueue into sync_queue', async () => {
      // Seed 10 remote documents
      for (let i = 1; i <= 10; i++) {
        server.seedFile({
          id: `gdoc-infinite-new-${i}`,
          name: `Remote Manuscript #${i}`,
          content: `# Remote Manuscript #${i}\n\nLivePaper distraction-free text content.`,
          modifiedTime: new Date(1700000000000 + i * 1000).toISOString(),
        });
      }

      // Execute pull
      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.createdCount, 10, 'Should import all 10 remote documents');
      assert.strictEqual(pullRes.pulledCount, 10);
      assert.strictEqual(pullRes.queuedCount, 0, 'No outgoing mutations should be queued during pull of new documents');

      // Verify all 10 are marked 'synced' in local DB
      const localDocs = await testDb.executeSql<any>(
        `SELECT id, title, sync_status, google_drive_file_id FROM documents WHERE google_drive_file_id IS NOT NULL;`
      );
      assert.strictEqual(localDocs.length, 10);
      for (const d of localDocs) {
        assert.strictEqual(d.sync_status, 'synced', `Document ${d.id} must have sync_status = 'synced'`);
      }

      // Adversarial flush: flush repository explicitly multiple times
      await repo.flushPendingEdits();
      await repo.flushPendingEdits();

      // Invariant: sync_queue must be completely empty!
      const queueRows = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(queueRows[0].count, 0, 'Pulled documents must NEVER enter sync_queue upon flush');

      // Invariant: adapter.getStatus().pendingCount must be 0
      assert.strictEqual(adapter.getStatus().pendingCount, 0, 'Adapter pending count must be 0');

      // Invariant: subsequent sync() must push 0 documents
      const pushRes = await adapter.sync();
      assert.strictEqual(pushRes.pushedCount, 0, 'Subsequent sync must push 0 documents (no echo storm)');
    });

    test('Empirical 1.2: pull() updating 10 existing documents retains synced status; subsequent flush does NOT enter sync_queue', async () => {
      // Create 10 local documents originally synced at t = 1000
      for (let i = 1; i <= 10; i++) {
        await repo.saveDocument({
          id: `local-doc-update-${i}`,
          title: `Old Local Title #${i}`,
          content: `Old local content #${i}`,
          google_drive_file_id: `gdoc-existing-${i}`,
          updated_at: 1000,
          sync_status: 'synced',
        });
      }
      await repo.flushPendingEdits();

      // Seed 10 remote documents with newer timestamp t = 5000
      for (let i = 1; i <= 10; i++) {
        server.seedFile({
          id: `gdoc-existing-${i}`,
          name: `Updated Cloud Title #${i}`,
          content: `Updated cloud content #${i}`,
          modifiedTime: new Date(5000).toISOString(),
        });
      }

      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.updatedCount, 10, 'All 10 documents should update from remote');
      assert.strictEqual(pullRes.queuedCount, 0);

      // Perform adversarial flush
      await repo.flushPendingEdits();

      // Verify sync_queue remains 0
      const queueRows = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(queueRows[0].count, 0, 'Updated documents must NOT be re-enqueued into sync_queue');

      // Subsequent sync pushes 0
      const syncRes = await adapter.sync();
      assert.strictEqual(syncRes.pushedCount, 0);
    });

    test('Empirical 1.3: Ping-Pong Sync Storm Immunity: 5 alternating cycles of pull() -> flush() -> sync() push exactly 0 mutations', async () => {
      // Seed 5 remote documents
      for (let i = 1; i <= 5; i++) {
        server.seedFile({
          id: `gdoc-storm-${i}`,
          name: `Storm Test #${i}`,
          content: `Storm text #${i}`,
          modifiedTime: new Date(1710000000000).toISOString(),
        });
      }

      // Initial pull
      const initialPull = await adapter.pull();
      assert.strictEqual(initialPull.createdCount, 5);

      const requestCountAfterInitialPull = server.requests.length;

      // Execute 5 rapid alternating cycles of pull -> flush -> sync
      for (let cycle = 1; cycle <= 5; cycle++) {
        await repo.flushPendingEdits();
        const syncRes = await adapter.sync();
        assert.strictEqual(syncRes.pushedCount, 0, `Cycle ${cycle}: sync must push 0 documents`);

        const pullRes = await adapter.pull();
        assert.strictEqual(pullRes.createdCount, 0, `Cycle ${cycle}: pull must create 0 new documents`);
        assert.strictEqual(pullRes.updatedCount, 0, `Cycle ${cycle}: pull must update 0 documents`);
        assert.strictEqual(pullRes.queuedCount, 0, `Cycle ${cycle}: pull must queue 0 mutations`);
        assert.strictEqual(pullRes.unmodifiedCount, 5, `Cycle ${cycle}: all 5 documents must register as unmodified`);

        const queueCount = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
        assert.strictEqual(queueCount[0].count, 0, `Cycle ${cycle}: sync_queue must remain empty`);
      }

      // Verify no POST /upload/drive/v3/files or POST /batchUpdate requests occurred during the 5 cycles
      const postMutations = server.requests
        .slice(requestCountAfterInitialPull)
        .filter((r) => r.method === 'POST' && (r.url.includes('/upload/') || r.url.includes(':batchUpdate')));
      assert.strictEqual(postMutations.length, 0, 'Zero outgoing push mutations must occur during ping-pong loops');
    });

    test('Empirical 1.4: Granular mutation isolation: Only genuinely edited local documents enter sync_queue; pulled documents are excluded', async () => {
      // Pull 10 remote docs
      for (let i = 1; i <= 10; i++) {
        server.seedFile({
          id: `gdoc-isolation-${i}`,
          name: `Isolated Remote #${i}`,
          content: `Content #${i}`,
          modifiedTime: new Date(2000).toISOString(),
        });
      }
      await adapter.pull();
      await repo.flushPendingEdits();

      // Now simulate a genuine user edit on ONLY document #3
      const doc3 = await repo.findByDriveFileId('gdoc-isolation-3');
      assert.ok(doc3, 'Document #3 must exist locally');

      await repo.saveDocument({
        id: doc3.id,
        content: 'Locally modified content typed by user on DC1 LivePaper',
        updated_at: 9999,
        sync_status: 'pending',
      });

      // Flush edits to SQLite
      await repo.flushPendingEdits();

      // Assert sync_queue contains EXACTLY 1 mutation for doc3, and NONE for the other 9 documents
      const queueRows = await testDb.executeSql<SyncQueueRecord>(`SELECT * FROM sync_queue;`);
      assert.strictEqual(queueRows.length, 1, 'sync_queue must contain exactly 1 mutation for the edited document');
      assert.strictEqual(queueRows[0].entity_id, doc3.id);
      assert.strictEqual(queueRows[0].operation, 'update');
    });
  });

  // ==========================================================================
  // SECTION 2: Bidirectional Last-Write-Wins (LWW) Conflict Resolution
  // ==========================================================================
  describe('Section 2: Bidirectional Last-Write-Wins (LWW) Conflict Resolution', () => {
    test('Empirical 2.1: Remote Newer: Remote content and title overwrite local; sync_status becomes synced; 0 mutations queued', async () => {
      // Local document created at t = 1000
      const localDoc = await repo.saveDocument({
        id: 'doc-lww-remote-wins',
        title: 'Old Local Title',
        content: 'Old local draft text',
        google_drive_file_id: 'gdoc-lww-test-1',
        updated_at: 1000,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Remote document updated at t = 3000 (2000ms newer)
      server.seedFile({
        id: 'gdoc-lww-test-1',
        name: 'Winning Cloud Title',
        content: 'Winning cloud text content updated from desktop browser',
        modifiedTime: new Date(3000).toISOString(),
      });

      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.updatedCount, 1, 'Remote doc must win update');
      assert.strictEqual(pullRes.queuedCount, 0, 'No mutations should be queued');

      // Verify exact winning content in SQLite repository
      const updatedLocal = await repo.getDocument(localDoc.id);
      assert.strictEqual(updatedLocal?.title, 'Winning Cloud Title');
      assert.strictEqual(updatedLocal?.content, 'Winning cloud text content updated from desktop browser');
      assert.strictEqual(updatedLocal?.updated_at, 3000);
      assert.strictEqual(updatedLocal?.sync_status, 'synced');

      // Verify no pending items in queue
      const queueCount = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(queueCount[0].count, 0);
    });

    test('Empirical 2.2: Local Newer: Local content wins; local content is untouched; update mutation is queued', async () => {
      const queue = new OfflineMutationQueue(testDb);
      adapter.setMutationQueue(queue);

      // Local document updated at t = 8000
      const localDoc = await repo.saveDocument({
        id: 'doc-lww-local-wins',
        title: 'Winning Local Title',
        content: 'Winning local manuscript text composed on DC1 LivePaper',
        google_drive_file_id: 'gdoc-lww-test-2',
        updated_at: 8000,
        sync_status: 'pending',
      });
      await repo.flushPendingEdits();

      // Remote document older at t = 4000
      server.seedFile({
        id: 'gdoc-lww-test-2',
        name: 'Stale Remote Title',
        content: 'Stale remote text',
        modifiedTime: new Date(4000).toISOString(),
      });

      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.queuedCount, 1, 'Local doc must queue mutation to overwrite stale remote');
      assert.strictEqual(pullRes.updatedCount, 0, 'Local doc must not be overwritten');

      // Assert local content is untouched
      const currentLocal = await repo.getDocument(localDoc.id);
      assert.strictEqual(currentLocal?.title, 'Winning Local Title');
      assert.strictEqual(currentLocal?.content, 'Winning local manuscript text composed on DC1 LivePaper');
      assert.strictEqual(currentLocal?.updated_at, 8000);

      // Assert mutation is queued in SQLite sync_queue
      const pendingCount = await queue.getPendingCount();
      assert.strictEqual(pendingCount, 1);
    });

    test('Empirical 2.3: Boundary Exact Timestamp Equality: Neither overwrites; unmodifiedCount increments; 0 mutations queued', async () => {
      const exactTime = 1720000000000;
      await repo.saveDocument({
        id: 'doc-lww-tie',
        title: 'Tie Local Title',
        content: 'Tie Local Content',
        google_drive_file_id: 'gdoc-tie-1',
        updated_at: exactTime,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      server.seedFile({
        id: 'gdoc-tie-1',
        name: 'Tie Remote Title',
        content: 'Tie Remote Content',
        modifiedTime: new Date(exactTime).toISOString(),
      });

      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.unmodifiedCount, 1, 'Exact timestamp match must register as unmodified');
      assert.strictEqual(pullRes.updatedCount, 0);
      assert.strictEqual(pullRes.queuedCount, 0);

      // Assert local content was NOT modified
      const currentDoc = await repo.getDocument('doc-lww-tie');
      assert.strictEqual(currentDoc?.content, 'Tie Local Content');

      const queueCount = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(queueCount[0].count, 0);
    });

    test('Empirical 2.4: 1-Millisecond Sub-second Precision LWW Boundary Stress', async () => {
      const queue = new OfflineMutationQueue(testDb);
      adapter.setMutationQueue(queue);

      const baseTime = 1725000000000;

      // Case A: Remote is 1ms newer (baseTime + 1 vs baseTime)
      await repo.saveDocument({
        id: 'doc-1ms-remote-wins',
        title: 'Local 1ms Stale',
        content: 'Local 1ms content',
        google_drive_file_id: 'gdoc-1ms-remote',
        updated_at: baseTime,
        sync_status: 'synced',
      });
      server.seedFile({
        id: 'gdoc-1ms-remote',
        name: 'Remote 1ms Winner',
        content: 'Remote 1ms winning content',
        modifiedTime: new Date(baseTime + 1).toISOString(),
      });

      // Case B: Local is 1ms newer (baseTime + 1 vs baseTime)
      await repo.saveDocument({
        id: 'doc-1ms-local-wins',
        title: 'Local 1ms Winner',
        content: 'Local 1ms winning content',
        google_drive_file_id: 'gdoc-1ms-local',
        updated_at: baseTime + 1,
        sync_status: 'pending',
      });
      server.seedFile({
        id: 'gdoc-1ms-local',
        name: 'Remote 1ms Stale',
        content: 'Remote 1ms stale content',
        modifiedTime: new Date(baseTime).toISOString(),
      });
      await repo.flushPendingEdits();

      const pullRes = await adapter.pull();
      assert.strictEqual(pullRes.updatedCount, 1, 'Exactly 1 doc updated (remote 1ms newer)');
      assert.strictEqual(pullRes.queuedCount, 1, 'Exactly 1 doc queued (local 1ms newer)');

      // Verify Case A winner
      const docA = await repo.getDocument('doc-1ms-remote-wins');
      assert.strictEqual(docA?.title, 'Remote 1ms Winner');
      assert.strictEqual(docA?.content, 'Remote 1ms winning content');

      // Verify Case B winner
      const docB = await repo.getDocument('doc-1ms-local-wins');
      assert.strictEqual(docB?.title, 'Local 1ms Winner');
      assert.strictEqual(docB?.content, 'Local 1ms winning content');
    });

    test('Empirical 2.5: Complex Multi-Document Reconciliation Matrix (12 documents)', async () => {
      const queue = new OfflineMutationQueue(testDb);
      adapter.setMutationQueue(queue);

      // Matrix:
      // Docs 1-3: Remote newer (expect updatedCount = 3)
      // Docs 4-6: Local newer (expect queuedCount = 3)
      // Docs 7-9: Exact timestamp tie (expect unmodifiedCount = 3)
      // Docs 10-12: Newly discovered remote docs (expect createdCount = 3)

      for (let i = 1; i <= 3; i++) {
        await repo.saveDocument({
          id: `matrix-doc-${i}`,
          title: `Local Older #${i}`,
          content: `Local text #${i}`,
          google_drive_file_id: `gdoc-matrix-${i}`,
          updated_at: 1000,
          sync_status: 'synced',
        });
        server.seedFile({
          id: `gdoc-matrix-${i}`,
          name: `Remote Newer #${i}`,
          content: `Remote winning text #${i}`,
          modifiedTime: new Date(5000).toISOString(),
        });
      }

      for (let i = 4; i <= 6; i++) {
        await repo.saveDocument({
          id: `matrix-doc-${i}`,
          title: `Local Newer #${i}`,
          content: `Local winning text #${i}`,
          google_drive_file_id: `gdoc-matrix-${i}`,
          updated_at: 9000,
          sync_status: 'pending',
        });
        server.seedFile({
          id: `gdoc-matrix-${i}`,
          name: `Remote Stale #${i}`,
          content: `Remote stale text #${i}`,
          modifiedTime: new Date(3000).toISOString(),
        });
      }

      for (let i = 7; i <= 9; i++) {
        await repo.saveDocument({
          id: `matrix-doc-${i}`,
          title: `Tie Local #${i}`,
          content: `Tie text #${i}`,
          google_drive_file_id: `gdoc-matrix-${i}`,
          updated_at: 4000,
          sync_status: 'synced',
        });
        server.seedFile({
          id: `gdoc-matrix-${i}`,
          name: `Tie Remote #${i}`,
          content: `Tie remote text #${i}`,
          modifiedTime: new Date(4000).toISOString(),
        });
      }

      for (let i = 10; i <= 12; i++) {
        server.seedFile({
          id: `gdoc-matrix-${i}`,
          name: `Discovered New #${i}`,
          content: `Brand new text #${i}`,
          modifiedTime: new Date(6000).toISOString(),
        });
      }

      await repo.flushPendingEdits();

      const pullRes = await adapter.pull();

      assert.strictEqual(pullRes.createdCount, 3, 'Created count must be 3');
      assert.strictEqual(pullRes.updatedCount, 3, 'Updated count must be 3');
      assert.strictEqual(pullRes.queuedCount, 3, 'Queued count must be 3');
      assert.strictEqual(pullRes.unmodifiedCount, 3, 'Unmodified count must be 3');
      assert.strictEqual(pullRes.pulledCount, 6, 'Total pulled (created + updated) must be 6');

      // Verify exact content of all groups
      for (let i = 1; i <= 3; i++) {
        const doc = await repo.getDocument(`matrix-doc-${i}`);
        assert.strictEqual(doc?.content, `Remote winning text #${i}`);
      }
      for (let i = 4; i <= 6; i++) {
        const doc = await repo.getDocument(`matrix-doc-${i}`);
        assert.strictEqual(doc?.content, `Local winning text #${i}`);
      }
      for (let i = 7; i <= 9; i++) {
        const doc = await repo.getDocument(`matrix-doc-${i}`);
        assert.strictEqual(doc?.content, `Tie text #${i}`);
      }
      for (let i = 10; i <= 12; i++) {
        const doc = await repo.findByDriveFileId(`gdoc-matrix-${i}`);
        assert.ok(doc, `Discovered doc ${i} must exist in repo`);
        assert.strictEqual(doc?.content, `Brand new text #${i}`);
      }
    });
  });

  // ==========================================================================
  // SECTION 3: Offline Queue Recovery & 50-Mutation Drain
  // ==========================================================================
  describe('Section 3: Offline Queue Recovery & 50-Mutation Drain', () => {
    test('Empirical 3.1: 50 offline mutations injected into SQLite sync_queue; offline drain blocked; online drain pushes all 50 cleanly with zero dropped edits', async () => {
      const queue = new OfflineMutationQueue(testDb, { batchSize: 50 });
      await queue.init();
      adapter.setMutationQueue(queue);

      // 1. Populate 50 document records into SQLite documents table
      for (let i = 1; i <= 50; i++) {
        await testDb.executeSql(
          `INSERT INTO documents (
            id, title, content, created_at, updated_at, format_version, sync_status
          ) VALUES (?, ?, ?, ?, ?, 1, 'pending');`,
          [
            `doc-stress-50-${i}`,
            `Offline Manuscript #${i}`,
            `# Chapter ${i}\n\nComposed entirely offline without network on Daylight Computer DC1.`,
            1720000000000 + i * 100,
            1720000000000 + i * 100,
          ]
        );

        // 2. Inject 50 pending mutations into sync_queue
        await testDb.executeSql(
          `INSERT INTO sync_queue (
            id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status
          ) VALUES (?, 'document', ?, 'create', ?, ?, 0, NULL, 'pending');`,
          [
            `sync_offline_50_${i}`,
            `doc-stress-50-${i}`,
            JSON.stringify({
              id: `doc-stress-50-${i}`,
              title: `Offline Manuscript #${i}`,
              content: `# Chapter ${i}\n\nComposed entirely offline without network on Daylight Computer DC1.`,
            }),
            1720000000000 + i * 100,
          ]
        );
      }

      assert.strictEqual(await queue.getPendingCount(), 50, 'Queue must hold all 50 offline mutations');

      // 3. Simulate offline state: drain attempt must push 0 and preserve all 50
      adapter.setOnline(false);
      const offlineDrain = await queue.drain(adapter);
      assert.strictEqual(offlineDrain.pushedCount, 0, 'Offline drain must push 0');
      assert.strictEqual(await queue.getPendingCount(), 50, 'All 50 mutations must remain pending while offline');

      // 4. Simulate network reconnection: trigger drain
      adapter.setOnline(true);
      const onlineDrain = await queue.drain(adapter);

      assert.strictEqual(onlineDrain.pushedCount, 50, 'All 50 mutations must be pushed successfully');
      assert.strictEqual(onlineDrain.failedCount, 0, 'Zero mutations may fail');
      assert.strictEqual(await queue.getPendingCount(), 0, 'Pending queue count must drop to 0');

      // Invariant: SQLite sync_queue table must be completely drained
      const remainingRows = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(remainingRows[0].count, 0, 'sync_queue table must have 0 rows remaining');

      // Invariant: All 50 local document records must now have sync_status = 'synced' and a valid google_drive_file_id
      const syncedDocs = await testDb.executeSql<DocumentRecord>(
        `SELECT id, title, sync_status, google_drive_file_id FROM documents WHERE sync_status = 'synced';`
      );
      assert.strictEqual(syncedDocs.length, 50, 'All 50 documents must be updated to sync_status = synced');

      const fileIds = new Set<string>();
      for (const doc of syncedDocs) {
        assert.ok(doc.google_drive_file_id, `Document ${doc.id} must possess a google_drive_file_id`);
        fileIds.add(doc.google_drive_file_id!);
      }
      assert.strictEqual(fileIds.size, 50, 'All 50 documents must have distinct unique Google Drive file IDs');

      // Invariant: All 50 documents exist on the remote mock Google Drive server
      assert.strictEqual(server.files.size, 50, 'Mock server must hold exactly 50 created files');
    });

    test('Empirical 3.2: 50 offline mutations across 5 chunked batches (batchSize: 10) commit atomically across batch boundaries', async () => {
      const queue = new OfflineMutationQueue(testDb, { batchSize: 10 });
      await queue.init();
      adapter.setMutationQueue(queue);

      for (let i = 1; i <= 50; i++) {
        await testDb.executeSql(
          `INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status)
           VALUES (?, ?, ?, 1000, 1000, 1, 'pending');`,
          [`doc-batch10-${i}`, `Batch10 Doc #${i}`, `Content #${i}`]
        );
        await testDb.executeSql(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
           VALUES (?, 'document', ?, 'create', ?, ?, 0, NULL, 'pending');`,
          [
            `sync_batch10_${i}`,
            `doc-batch10-${i}`,
            JSON.stringify({ id: `doc-batch10-${i}`, title: `Batch10 Doc #${i}`, content: `Content #${i}` }),
            1000 + i,
          ]
        );
      }

      assert.strictEqual(await queue.getPendingCount(), 50);

      const drainRes = await queue.drain(adapter);
      assert.strictEqual(drainRes.pushedCount, 50, 'Must push all 50 mutations across 5 consecutive batches');
      assert.strictEqual(drainRes.failedCount, 0);
      assert.strictEqual(await queue.getPendingCount(), 0);

      const remainingRows = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(remainingRows[0].count, 0);
    });

    test('Empirical 3.3: 50 offline mutations with prime non-uniform batch size (batchSize: 17) terminates cleanly without dropping mutations', async () => {
      // 17 + 17 + 16 = 50
      const queue = new OfflineMutationQueue(testDb, { batchSize: 17 });
      await queue.init();
      adapter.setMutationQueue(queue);

      for (let i = 1; i <= 50; i++) {
        await testDb.executeSql(
          `INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status)
           VALUES (?, ?, ?, 1000, 1000, 1, 'pending');`,
          [`doc-batch17-${i}`, `Batch17 Doc #${i}`, `Content #${i}`]
        );
        await testDb.executeSql(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
           VALUES (?, 'document', ?, 'create', ?, ?, 0, NULL, 'pending');`,
          [
            `sync_batch17_${i}`,
            `doc-batch17-${i}`,
            JSON.stringify({ id: `doc-batch17-${i}`, title: `Batch17 Doc #${i}`, content: `Content #${i}` }),
            1000 + i,
          ]
        );
      }

      const drainRes = await queue.drain(adapter);
      assert.strictEqual(drainRes.pushedCount, 50, 'All 50 must be pushed cleanly');
      assert.strictEqual(drainRes.failedCount, 0);
      assert.strictEqual(await queue.getPendingCount(), 0);

      const remainingRows = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(remainingRows[0].count, 0);
    });

    test('Empirical 3.4: 50 offline mutations with mixed operations (25 creates + 25 in-place updates) patches Docs cleanly without duplication', async () => {
      const queue = new OfflineMutationQueue(testDb, { batchSize: 20 });
      await queue.init();
      adapter.setMutationQueue(queue);

      // Pre-seed 25 files on remote server and in local DB for the updates
      for (let i = 1; i <= 25; i++) {
        const fileId = `gdoc-existing-mixed-${i}`;
        server.seedFile({
          id: fileId,
          name: `Pre-existing Doc #${i}`,
          content: `Initial remote content #${i}`,
          modifiedTime: new Date(1000).toISOString(),
        });

        await testDb.executeSql(
          `INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status, google_drive_file_id)
           VALUES (?, ?, ?, 1000, 2000, 1, 'pending', ?);`,
          [`doc-update-${i}`, `Updated Title #${i}`, `Brand new patched text #${i}`, fileId]
        );

        await testDb.executeSql(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
           VALUES (?, 'document', ?, 'update', ?, 2000, 0, NULL, 'pending');`,
          [
            `sync_mix_update_${i}`,
            `doc-update-${i}`,
            JSON.stringify({
              id: `doc-update-${i}`,
              title: `Updated Title #${i}`,
              content: `Brand new patched text #${i}`,
              google_drive_file_id: fileId,
            }),
          ]
        );
      }

      // Add 25 new documents (creates)
      for (let i = 26; i <= 50; i++) {
        await testDb.executeSql(
          `INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status)
           VALUES (?, ?, ?, 3000, 3000, 1, 'pending');`,
          [`doc-create-${i}`, `Created Title #${i}`, `Created content #${i}`]
        );

        await testDb.executeSql(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
           VALUES (?, 'document', ?, 'create', ?, 3000, 0, NULL, 'pending');`,
          [
            `sync_mix_create_${i}`,
            `doc-create-${i}`,
            JSON.stringify({
              id: `doc-create-${i}`,
              title: `Created Title #${i}`,
              content: `Created content #${i}`,
            }),
          ]
        );
      }

      assert.strictEqual(await queue.getPendingCount(), 50);

      const drainRes = await queue.drain(adapter);
      assert.strictEqual(drainRes.pushedCount, 50);
      assert.strictEqual(drainRes.failedCount, 0);
      assert.strictEqual(await queue.getPendingCount(), 0);

      // Verify that the 25 existing files were patched in place (not duplicated)
      // Total files on server should now be 25 original + 25 new = 50 files total!
      assert.strictEqual(server.files.size, 50, 'Server must have exactly 50 files (25 patched + 25 created, zero duplicates)');

      // Verify content was patched in place for existing files
      for (let i = 1; i <= 25; i++) {
        const file = server.files.get(`gdoc-existing-mixed-${i}`);
        assert.ok(file, `File ${i} must exist`);
        assert.strictEqual(file.name, `Updated Title #${i}`);
        assert.strictEqual(file.content, `Brand new patched text #${i}`);
      }
    });
  });

  // ==========================================================================
  // SECTION 4: Fault Tolerance, Crash Recovery & Network Resiliency
  // ==========================================================================
  describe('Section 4: Fault Tolerance, Crash Recovery & Network Resiliency', () => {
    test('Empirical 4.1: Crash recovery: 50 abandoned in_flight mutations are restored to pending on startup and drain cleanly', async () => {
      // Simulate mid-drain crash: 50 mutations stuck in 'in_flight' status
      for (let i = 1; i <= 50; i++) {
        await testDb.executeSql(
          `INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status)
           VALUES (?, ?, ?, 1000, 1000, 1, 'pending');`,
          [`doc-crash-${i}`, `Crash Doc #${i}`, `Crash content #${i}`]
        );
        await testDb.executeSql(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
           VALUES (?, 'document', ?, 'create', ?, 1000, 0, NULL, 'in_flight');`,
          [
            `sync_crash_${i}`,
            `doc-crash-${i}`,
            JSON.stringify({ id: `doc-crash-${i}`, title: `Crash Doc #${i}`, content: `Crash content #${i}` }),
          ]
        );
      }

      // App reboots: initialize a fresh queue instance
      const freshQueue = new OfflineMutationQueue(testDb);
      const recoveredCount = await freshQueue.init();

      assert.strictEqual(recoveredCount, 50, 'Startup recovery must restore all 50 abandoned mutations');
      assert.strictEqual(await freshQueue.getPendingCount(), 50, 'Queue pending count must now reflect 50');

      // Verify DB status
      const inFlightCheck = await testDb.executeSql<{ count: number }>(
        `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'in_flight';`
      );
      assert.strictEqual(inFlightCheck[0].count, 0, 'Zero rows may remain in_flight after startup recovery');

      // Now drain with adapter
      adapter.setMutationQueue(freshQueue);
      const drainRes = await freshQueue.drain(adapter);

      assert.strictEqual(drainRes.pushedCount, 50, 'All 50 recovered mutations must drain cleanly');
      assert.strictEqual(drainRes.failedCount, 0);
      assert.strictEqual(await freshQueue.getPendingCount(), 0);
    });

    test('Empirical 4.2: Partial network failure during drain: first 20 commit, remaining 30 roll back and recover cleanly on reconnect', async () => {
      // Use batchSize: 10 so 50 items will execute in 5 batches
      const queue = new OfflineMutationQueue(testDb, { batchSize: 10, maxRetries: 5 });
      await queue.init();
      adapter.setMutationQueue(queue);

      for (let i = 1; i <= 50; i++) {
        await testDb.executeSql(
          `INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status)
           VALUES (?, ?, ?, 1000, 1000, 1, 'pending');`,
          [`doc-failover-${i}`, `Failover Doc #${i}`, `Failover content #${i}`]
        );
        await testDb.executeSql(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
           VALUES (?, 'document', ?, 'create', ?, ?, 0, NULL, 'pending');`,
          [
            `sync_failover_${i}`,
            `doc-failover-${i}`,
            JSON.stringify({ id: `doc-failover-${i}`, title: `Failover Doc #${i}`, content: `Failover content #${i}` }),
            1000 + i,
          ]
        );
      }

      // Configure server to fail with 503 error after 2 batches (each create doc = 1 ensureFolder + 1 upload POST = ~2-3 requests per doc)
      // Instead of counting raw HTTP requests, configure failError triggered when attempting 3rd batch
      let pushedBeforeFailure = 0;
      const originalCreateFile = (adapter as any).createGoogleDocFile.bind(adapter);
      (adapter as any).createGoogleDocFile = async function (...args: any[]) {
        pushedBeforeFailure++;
        if (pushedBeforeFailure > 20) {
          throw new Error('HTTP 503: Google Drive Service Temporarily Unavailable');
        }
        return await originalCreateFile(...args);
      };

      const firstDrain = await queue.drain(adapter);

      // First 2 batches (20 items) succeeded; 3rd batch failed and stopped drain
      assert.strictEqual(firstDrain.pushedCount, 20, 'First 20 items must be committed before failure');
      assert.strictEqual(firstDrain.failedCount, 10, 'The 3rd batch (10 items) failed');

      // Check remaining in queue: 20 committed -> 30 remaining
      const midQueueCount = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(midQueueCount[0].count, 30, 'Exactly 30 items must remain in sync_queue');

      // The 10 failed items should be rolled back to status = 'pending' with retry_count = 1
      const failedItems = await testDb.executeSql<SyncQueueRecord>(
        `SELECT * FROM sync_queue WHERE retry_count = 1;`
      );
      assert.strictEqual(failedItems.length, 10, 'The 10 items in the failing batch must have retry_count = 1');
      assert.strictEqual(failedItems[0].status, 'pending');
      assert.ok(failedItems[0].last_error?.includes('503'));

      // Network heals: restore normal createGoogleDocFile implementation
      (adapter as any).createGoogleDocFile = originalCreateFile;

      // Drain again
      const secondDrain = await queue.drain(adapter);

      assert.strictEqual(secondDrain.pushedCount, 30, 'Remaining 30 items must be pushed on retry');
      assert.strictEqual(secondDrain.failedCount, 0);

      // Final invariant: All 50 items successfully pushed; queue is completely empty
      const finalQueueCount = await testDb.executeSql<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue;`);
      assert.strictEqual(finalQueueCount[0].count, 0, 'Final queue count must be 0');

      const allSynced = await testDb.executeSql<{ count: number }>(
        `SELECT COUNT(*) as count FROM documents WHERE sync_status = 'synced';`
      );
      assert.strictEqual(allSynced[0].count, 50, 'All 50 documents must be synced');
    });
  });
});
