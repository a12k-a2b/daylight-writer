/**
 * tests/adversarial/m2-it2-challenger2-metadata-reset-stress.test.ts
 * Milestone 2 Iteration 2 Empirical Adversarial Stress Harness:
 * SQLite Metadata Reset, Cache Non-Resurrection, and Reconciliation Invariants
 *
 * Verifies:
 * 1. Challenge 1: Direct Disk Null Clearing Verification
 *    Calling updateSyncMetadata(id, { google_drive_file_id: null }) writes NULL directly to SQLite
 *    on disk, verified by closing repo and re-querying SQLite via raw SELECT query.
 * 2. Challenge 2: Cache Non-Resurrection
 *    Calling saveDocument({ id, content: 'new' }) without passing file ID (or with explicit null)
 *    following a cleared file ID does NOT resurrect the dead ID from internal cache or disk.
 * 3. Challenge 3: Field Isolation & Dynamic Set Clause Matrix
 *    Tests individual field clearing (file_id, revision_id, last_synced_at) and boundary values.
 * 4. Challenge 4: High-Concurrency Stress (100 Documents)
 *    Concurrently clears metadata and executes saveDocument across 100 documents with 0 resurrections.
 * 5. Challenge 5: Trashed File 404 Auto-Recovery End-to-End Integration
 *    Verifies full sync adapter recovery lifecycle unlinking stale ID and persisting new ID to disk.
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations } from '../../src/storage/schema.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import type { DatabaseDriver, DocumentRecord } from '../../src/storage/schema.ts';

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

describe('M2-IT2 Challenger 2: SQLite Metadata Reset & Cache Non-Resurrection Empirical Harness', () => {
  let testDb: DatabaseDriver;
  let repo: SQLiteStorageRepository;
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

    testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
    await runMigrations(testDb);

    repo = new SQLiteStorageRepository(testDb);
    await repo.init();
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
  // CHALLENGE 1: Direct Disk Null Clearing Verification
  // ==========================================================================
  describe('Challenge 1: Direct Disk Null Clearing Verification', () => {
    test('Empirical C1.1: updateSyncMetadata writes NULL to SQLite on disk and persists across repository restart', async () => {
      const docId = 'doc-disk-null-c1-1';

      // 1. Create document with valid Google Drive metadata
      await repo.saveDocument({
        id: docId,
        title: 'Original Cloud Manuscript',
        content: 'Original manuscript content on DC1 LivePaper',
        google_drive_file_id: 'gdoc-file-id-initial',
        google_drive_revision_id: 'rev-file-id-initial',
        last_synced_at: 1720000000000,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Verify on disk via raw SQLite SELECT
      const initialDiskRows = await testDb.executeSql<{
        google_drive_file_id: string | null;
        google_drive_revision_id: string | null;
        last_synced_at: number | null;
        sync_status: string;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id, last_synced_at, sync_status
         FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(initialDiskRows.length, 1);
      assert.strictEqual(initialDiskRows[0].google_drive_file_id, 'gdoc-file-id-initial');
      assert.strictEqual(initialDiskRows[0].google_drive_revision_id, 'rev-file-id-initial');
      assert.strictEqual(initialDiskRows[0].last_synced_at, 1720000000000);
      assert.strictEqual(initialDiskRows[0].sync_status, 'synced');

      // 2. Call updateSyncMetadata with explicit NULL
      await repo.updateSyncMetadata(docId, {
        google_drive_file_id: null,
        google_drive_revision_id: null,
        sync_status: 'pending',
      });

      // In-memory verification
      const cachedDoc = await repo.getDocument(docId);
      assert.strictEqual(cachedDoc?.google_drive_file_id, null, 'In-memory cache must return null');
      assert.strictEqual(cachedDoc?.google_drive_revision_id, null, 'In-memory cache must return null');
      assert.strictEqual(cachedDoc?.sync_status, 'pending');

      // Direct disk verification BEFORE repository restart
      const midDiskRows = await testDb.executeSql<{
        google_drive_file_id: string | null;
        google_drive_revision_id: string | null;
        sync_status: string;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id, sync_status
         FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(midDiskRows[0].google_drive_file_id, null, 'Raw SQLite row must have NULL file ID');
      assert.strictEqual(midDiskRows[0].google_drive_revision_id, null, 'Raw SQLite row must have NULL rev ID');
      assert.strictEqual(midDiskRows[0].sync_status, 'pending');

      // 3. Complete shutdown and restart of repository (erasing all in-memory caches)
      const freshRepo = new SQLiteStorageRepository(testDb);
      await freshRepo.init();

      // Verify directly via raw SQL on disk after restart
      const postRestartDiskRows = await testDb.executeSql<{
        google_drive_file_id: string | null;
        google_drive_revision_id: string | null;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(postRestartDiskRows.length, 1);
      assert.strictEqual(postRestartDiskRows[0].google_drive_file_id, null, 'Post-restart disk state MUST be strictly NULL');
      assert.strictEqual(postRestartDiskRows[0].google_drive_revision_id, null, 'Post-restart revision MUST be strictly NULL');

      // Verify via fresh repository instance reading from disk
      const freshDoc = await freshRepo.getDocument(docId);
      assert.ok(freshDoc, 'Document must exist after reload');
      assert.strictEqual(freshDoc.google_drive_file_id, null, 'Fresh repo getDocument must return null');
      assert.strictEqual(freshDoc.google_drive_revision_id, null, 'Fresh repo getDocument must return null');

      // Verify findByDriveFileId returns null for the cleared ID
      const lookupOld = await freshRepo.findByDriveFileId('gdoc-file-id-initial');
      assert.strictEqual(lookupOld, null, 'findByDriveFileId must not find cleared file ID');
    });

    test('Empirical C1.2: Clearing last_synced_at to null writes NULL to SQLite on disk', async () => {
      const docId = 'doc-disk-null-c1-2';
      await repo.saveDocument({
        id: docId,
        title: 'Sync Timestamp Test',
        content: 'Content',
        last_synced_at: 1720000000000,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      await repo.updateSyncMetadata(docId, { last_synced_at: null });

      const diskRow = await testDb.executeSql<{ last_synced_at: number | null }>(
        `SELECT last_synced_at FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(diskRow[0].last_synced_at, null, 'last_synced_at must be NULL in SQLite');

      const cached = await repo.getDocument(docId);
      assert.strictEqual(cached?.last_synced_at, null);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Cache Non-Resurrection Invariants
  // ==========================================================================
  describe('Challenge 2: Cache Non-Resurrection Invariants', () => {
    test('Empirical C2.1: saveDocument without file ID following updateSyncMetadata(null) does NOT resurrect file ID', async () => {
      const docId = 'doc-resurrect-c2-1';

      // Seed with initial Google Drive metadata
      await repo.saveDocument({
        id: docId,
        title: 'Initial Title',
        content: 'Initial Content',
        google_drive_file_id: 'dead-file-id-xyz',
        google_drive_revision_id: 'rev-dead-1',
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Clear metadata via updateSyncMetadata
      await repo.updateSyncMetadata(docId, {
        google_drive_file_id: null,
        google_drive_revision_id: null,
        sync_status: 'pending',
      });

      // Subsequent user edit: user types new content. google_drive_file_id is omitted / undefined
      const savedDoc1 = await repo.saveDocument({
        id: docId,
        content: 'New content typed on DC1 LivePaper after file was trashed remotely',
      });

      // Verification on returned object
      assert.strictEqual(
        savedDoc1.google_drive_file_id,
        null,
        'saveDocument return value must not resurrect dead file ID'
      );
      assert.strictEqual(
        savedDoc1.google_drive_revision_id,
        null,
        'saveDocument return value must not resurrect dead revision ID'
      );

      // Verification on getDocument (in-memory cache)
      const cachedDoc = await repo.getDocument(docId);
      assert.strictEqual(
        cachedDoc?.google_drive_file_id,
        null,
        'getDocument must not return resurrected file ID'
      );

      // Verification on disk after flush
      await repo.flushPendingEdits();
      const diskRows = await testDb.executeSql<{ google_drive_file_id: string | null }>(
        `SELECT google_drive_file_id FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(
        diskRows[0].google_drive_file_id,
        null,
        'SQLite disk row must not have resurrected file ID after flush'
      );
    });

    test('Empirical C2.2: saveDocument with explicit google_drive_file_id: null clears metadata without resurrection', async () => {
      const docId = 'doc-resurrect-c2-2';

      // Seed document with valid file ID
      await repo.saveDocument({
        id: docId,
        title: 'Direct Null Save',
        content: 'Initial text',
        google_drive_file_id: 'file-to-be-nuked',
        google_drive_revision_id: 'rev-to-be-nuked',
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Call saveDocument with explicit nulls
      const saved = await repo.saveDocument({
        id: docId,
        content: 'Updated text with explicit null file ID',
        google_drive_file_id: null,
        google_drive_revision_id: null,
      });

      assert.strictEqual(saved.google_drive_file_id, null, 'Explicit null must be respected in return value');
      assert.strictEqual(saved.google_drive_revision_id, null, 'Explicit null must be respected in return value');

      await repo.flushPendingEdits();

      // Check SQLite disk
      const diskRows = await testDb.executeSql<{
        google_drive_file_id: string | null;
        google_drive_revision_id: string | null;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(diskRows[0].google_drive_file_id, null, 'Disk must be strictly NULL');
      assert.strictEqual(diskRows[0].google_drive_revision_id, null, 'Disk rev must be strictly NULL');

      // Subsequent save with undefined file ID should STILL remain null
      const secondSave = await repo.saveDocument({
        id: docId,
        content: 'Subsequent update',
      });
      assert.strictEqual(secondSave.google_drive_file_id, null, 'Must still be null on subsequent save');
      await repo.flushPendingEdits();

      const diskRows2 = await testDb.executeSql<{ google_drive_file_id: string | null }>(
        `SELECT google_drive_file_id FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(diskRows2[0].google_drive_file_id, null, 'Disk must still be strictly NULL');
    });

    test('Empirical C2.3: Interleaved rapid typing sequence (5 saves) never resurrects dead file ID', async () => {
      const docId = 'doc-resurrect-c2-3';

      await repo.saveDocument({
        id: docId,
        title: 'Typing Stream',
        content: 'Start',
        google_drive_file_id: 'dead-stream-id',
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Clear metadata
      await repo.updateSyncMetadata(docId, {
        google_drive_file_id: null,
        google_drive_revision_id: null,
        sync_status: 'pending',
      });

      // Simulate 5 rapid keystroke saves in memory
      for (let k = 1; k <= 5; k++) {
        const res = await repo.saveDocument({
          id: docId,
          content: `Keystroke ${k}`,
        });
        assert.strictEqual(res.google_drive_file_id, null, `Keystroke ${k} must not resurrect file ID`);
      }

      await repo.flushPendingEdits();

      // Verify disk
      const diskRow = await testDb.executeSql<{ google_drive_file_id: string | null; content: string }>(
        `SELECT google_drive_file_id, content FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(diskRow[0].google_drive_file_id, null);
      assert.strictEqual(diskRow[0].content, 'Keystroke 5');
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Field Isolation & Dynamic Set Clause Matrix
  // ==========================================================================
  describe('Challenge 3: Field Isolation & Dynamic Set Clause Matrix', () => {
    test('Empirical C3.1: updateSyncMetadata with empty object does not alter any existing column', async () => {
      const docId = 'doc-matrix-c3-1';
      await repo.saveDocument({
        id: docId,
        title: 'Preserve Test',
        content: 'Original Content',
        google_drive_file_id: 'keep-this-id',
        google_drive_revision_id: 'keep-this-rev',
        last_synced_at: 55555,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Pass empty metadata object
      await repo.updateSyncMetadata(docId, {});

      const row = await testDb.executeSql<{
        google_drive_file_id: string | null;
        google_drive_revision_id: string | null;
        last_synced_at: number | null;
        sync_status: string;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id, last_synced_at, sync_status FROM documents WHERE id = ?;`,
        [docId]
      );

      assert.strictEqual(row[0].google_drive_file_id, 'keep-this-id');
      assert.strictEqual(row[0].google_drive_revision_id, 'keep-this-rev');
      assert.strictEqual(row[0].last_synced_at, 55555);
      assert.strictEqual(row[0].sync_status, 'synced');
    });

    test('Empirical C3.2: Partial metadata update updates ONLY specified fields and preserves others', async () => {
      const docId = 'doc-matrix-c3-2';
      await repo.saveDocument({
        id: docId,
        title: 'Partial Update Test',
        content: 'Original Content',
        google_drive_file_id: 'existing-id-preserve',
        google_drive_revision_id: 'existing-rev-preserve',
        last_synced_at: 1000,
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Only update sync_status to pending and revision to null, preserving file_id
      await repo.updateSyncMetadata(docId, {
        google_drive_revision_id: null,
        sync_status: 'pending',
      });

      const row = await testDb.executeSql<{
        google_drive_file_id: string | null;
        google_drive_revision_id: string | null;
        last_synced_at: number | null;
        sync_status: string;
      }>(
        `SELECT google_drive_file_id, google_drive_revision_id, last_synced_at, sync_status FROM documents WHERE id = ?;`,
        [docId]
      );

      assert.strictEqual(row[0].google_drive_file_id, 'existing-id-preserve', 'File ID must be preserved');
      assert.strictEqual(row[0].google_drive_revision_id, null, 'Revision ID must be cleared to NULL');
      assert.strictEqual(row[0].last_synced_at, 1000, 'last_synced_at must be preserved');
      assert.strictEqual(row[0].sync_status, 'pending', 'sync_status must be updated to pending');
    });

    test('Empirical C3.3: findByDriveFileId guards against null, empty string, and whitespace', async () => {
      assert.strictEqual(await repo.findByDriveFileId(''), null);
      assert.strictEqual(await repo.findByDriveFileId('   '), null);
      assert.strictEqual(await repo.findByDriveFileId(null as any), null);
      assert.strictEqual(await repo.findByDriveFileId(undefined as any), null);
    });
  });

  // ==========================================================================
  // CHALLENGE 4: High-Concurrency Stress (100 Documents)
  // ==========================================================================
  describe('Challenge 4: High-Concurrency Stress (100 Documents)', () => {
    test('Empirical C4.1: 100 documents: batch null clearing, concurrent saves, and flushes result in zero resurrections', async () => {
      const totalDocs = 100;

      // 1. Create 100 documents with active Google Drive IDs
      for (let i = 1; i <= totalDocs; i++) {
        await repo.saveDocument({
          id: `stress-doc-${i}`,
          title: `Document #${i}`,
          content: `Content #${i}`,
          google_drive_file_id: `gdoc-file-${i}`,
          google_drive_revision_id: `rev-${i}`,
          last_synced_at: 1720000000000,
          sync_status: 'synced',
        });
      }
      await repo.flushPendingEdits();

      // Verify all 100 on disk
      const initialDiskCount = await testDb.executeSql<{ count: number }>(
        `SELECT COUNT(*) as count FROM documents WHERE google_drive_file_id IS NOT NULL;`
      );
      assert.strictEqual(initialDiskCount[0].count, totalDocs);

      // 2. Concurrently clear odd-numbered documents (50 docs: 1, 3, 5, ..., 99)
      const clearPromises: Promise<void>[] = [];
      for (let i = 1; i <= totalDocs; i += 2) {
        clearPromises.push(
          repo.updateSyncMetadata(`stress-doc-${i}`, {
            google_drive_file_id: null,
            google_drive_revision_id: null,
            sync_status: 'pending',
          })
        );
      }
      await Promise.all(clearPromises);

      // 3. Concurrently execute saveDocument on ALL 100 documents without passing google_drive_file_id
      const savePromises: Promise<DocumentRecord>[] = [];
      for (let i = 1; i <= totalDocs; i++) {
        savePromises.push(
          repo.saveDocument({
            id: `stress-doc-${i}`,
            content: `Concurrent updated content #${i}`,
          })
        );
      }
      const savedResults = await Promise.all(savePromises);

      // Verify in-memory return values
      for (let i = 1; i <= totalDocs; i++) {
        const res = savedResults[i - 1];
        if (i % 2 === 1) {
          // Odd: cleared
          assert.strictEqual(
            res.google_drive_file_id,
            null,
            `Document #${i} was cleared; saveDocument must NOT resurrect ID`
          );
        } else {
          // Even: preserved
          assert.strictEqual(
            res.google_drive_file_id,
            `gdoc-file-${i}`,
            `Document #${i} was NOT cleared; must retain original ID`
          );
        }
      }

      // 4. Flush all pending edits to SQLite
      await repo.flushPendingEdits();

      // 5. Query SQLite disk state directly
      const clearedDiskRows = await testDb.executeSql<{ count: number }>(
        `SELECT COUNT(*) as count FROM documents WHERE google_drive_file_id IS NULL;`
      );
      assert.strictEqual(
        clearedDiskRows[0].count,
        50,
        'Exactly 50 documents must have NULL google_drive_file_id on disk'
      );

      const remainingDiskRows = await testDb.executeSql<{ count: number }>(
        `SELECT COUNT(*) as count FROM documents WHERE google_drive_file_id IS NOT NULL;`
      );
      assert.strictEqual(
        remainingDiskRows[0].count,
        50,
        'Exactly 50 documents must retain non-NULL google_drive_file_id on disk'
      );

      // 6. Completely restart repository and verify all 100 from fresh disk reload
      const reloadedRepo = new SQLiteStorageRepository(testDb);
      await reloadedRepo.init();

      for (let i = 1; i <= totalDocs; i++) {
        const doc = await reloadedRepo.getDocument(`stress-doc-${i}`);
        assert.ok(doc, `Document #${i} must reload`);
        if (i % 2 === 1) {
          assert.strictEqual(doc.google_drive_file_id, null, `Reloaded doc #${i} must have null file ID`);
          assert.strictEqual(doc.google_drive_revision_id, null, `Reloaded doc #${i} must have null revision ID`);
        } else {
          assert.strictEqual(doc.google_drive_file_id, `gdoc-file-${i}`, `Reloaded doc #${i} must retain file ID`);
        }
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 5: Trashed File 404 Auto-Recovery End-to-End Integration
  // ==========================================================================
  describe('Challenge 5: Trashed File 404 Auto-Recovery End-to-End Integration', () => {
    test('Empirical C5.1: Full sync adapter 404 recovery replaces stale ID with new ID on disk and in repo', async () => {
      // Setup mock fetch server
      const createdFileId = 'gdoc-freshly-created-999';
      let docQueryCalled = false;
      let uploadCalled = false;

      global.fetch = (async (urlStr: string, init?: RequestInit) => {
        const method = (init?.method || 'GET').toUpperCase();
        const url = new URL(urlStr);

        // UserInfo
        if (url.pathname.includes('/userinfo')) {
          return new Response(JSON.stringify({ email: 'a12katta@gmail.com', name: 'Anjan' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Folder search
        if (url.pathname === '/drive/v3/files' && method === 'GET') {
          return new Response(
            JSON.stringify({ files: [{ id: 'manuscripts-folder', name: 'Daylight Manuscripts' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Docs GET -> return 404
        if (url.pathname.includes('/v1/documents/trashed-remote-doc-1')) {
          docQueryCalled = true;
          return new Response(JSON.stringify({ error: { message: 'Document not found', code: 404 } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Multipart Doc Creation
        if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
          uploadCalled = true;
          return new Response(
            JSON.stringify({
              id: createdFileId,
              name: 'Recovery Manuscript',
              mimeType: 'application/vnd.google-apps.document',
              version: '1',
              webViewLink: `https://docs.google.com/document/d/${createdFileId}/edit`,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      const adapter = new GoogleDriveSyncAdapter({
        targetFolderName: 'Daylight Manuscripts',
        db: testDb,
        repository: repo,
      });
      adapter.setAccessToken('ya29.empirical-challenger-valid-token');

      const docId = 'doc-e2e-recovery-1';
      await repo.saveDocument({
        id: docId,
        title: 'Recovery Manuscript',
        content: 'Content that must be preserved when remote is trashed',
        google_drive_file_id: 'trashed-remote-doc-1',
        sync_status: 'synced',
      });
      await repo.flushPendingEdits();

      // Trigger user edit
      await repo.saveDocument({
        id: docId,
        content: 'New content after remote was trashed',
        sync_status: 'pending',
      });
      await repo.flushPendingEdits();

      // Queue the update mutation into adapter.queue
      adapter.queueMutation(docId, 'update', {
        id: docId,
        title: 'Recovery Manuscript',
        content: 'New content after remote was trashed',
        google_drive_file_id: 'trashed-remote-doc-1',
      });

      // Execute sync
      const syncResult = await adapter.sync();

      assert.strictEqual(docQueryCalled, true, 'Must have attempted to query remote doc');
      assert.strictEqual(uploadCalled, true, 'Must have fallen back to createGoogleDocFile on 404');
      assert.strictEqual(syncResult.pushedCount, 1, 'Sync result must report 1 document pushed');

      // Verify that SQLite documents table row has been updated with the NEW file ID
      const diskRow = await testDb.executeSql<DocumentRecord>(
        `SELECT google_drive_file_id, sync_status FROM documents WHERE id = ?;`,
        [docId]
      );
      assert.strictEqual(diskRow[0].google_drive_file_id, createdFileId, 'SQLite on disk must hold NEW file ID');
      assert.strictEqual(diskRow[0].sync_status, 'synced', 'SQLite on disk must be marked synced');

      // Verify that repository cache has been updated with the NEW file ID
      const reloadedDoc = await repo.getDocument(docId);
      assert.strictEqual(reloadedDoc?.google_drive_file_id, createdFileId, 'Repo cache must hold NEW file ID');
      assert.strictEqual(reloadedDoc?.sync_status, 'synced');

      // Verify old dead file ID does not exist in repo lookup
      const oldLookup = await repo.findByDriveFileId('trashed-remote-doc-1');
      assert.strictEqual(oldLookup, null, 'Old trashed file ID must not resolve');

      // Verify new file ID resolves to this document
      const newLookup = await repo.findByDriveFileId(createdFileId);
      assert.ok(newLookup, 'New file ID must resolve');
      assert.strictEqual(newLookup.id, docId);
    });
  });
});
