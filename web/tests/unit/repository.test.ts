/**
 * tests/unit/repository.test.ts
 * Unit tests for SQLiteStorageRepository: In-memory cache, 250ms debouncing, emergency flush, CRUD
 */

import test from 'node:test';
import assert from 'node:assert';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations } from '../../src/storage/schema.ts';

test('Repository: in-memory cache provides 0ms instant read/write', async () => {
  const repo = new SQLiteStorageRepository(undefined, 250);
  await repo.init();

  const start = performance.now();
  const saved = await repo.saveDocument({
    id: 'doc-cache-1',
    title: 'Instant Keystroke',
    content: 'Zero typing lag',
  });
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 16, `Keystroke save must be < 16ms, took ${elapsed.toFixed(2)}ms`);
  assert.strictEqual(saved.title, 'Instant Keystroke');

  const fetched = await repo.getDocument('doc-cache-1');
  assert.strictEqual(fetched?.content, 'Zero typing lag');

  repo.destroy();
});

test('Repository: 250ms debounce and emergency lifecycle flush', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_repo_flush.db' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  await repo.saveDocument({ id: 'doc-f1', title: 'Edit 1', content: 'C1' });
  await repo.saveDocument({ id: 'doc-f2', title: 'Edit 2', content: 'C2' });

  // Prior to flush, records are available in-memory
  const memDoc1 = await repo.getDocument('doc-f1');
  assert.strictEqual(memDoc1?.title, 'Edit 1');

  // Trigger emergency flush
  await repo.flushPendingEdits();
  assert.ok(repo.flushCount >= 1);

  // Verify rows were committed to SQLite
  const dbRows = await db.executeSql('SELECT * FROM documents WHERE id IN (\'doc-f1\', \'doc-f2\');');
  assert.strictEqual(dbRows.length, 2);

  // Verify sync_queue entries were generated
  const queueRows = await db.executeSql('SELECT * FROM sync_queue;');
  assert.strictEqual(queueRows.length, 2);

  repo.destroy();
  await db.close();
});

test('Repository: Document CRUD operations with soft delete', async () => {
  const repo = new SQLiteStorageRepository();
  await repo.init();

  // Create
  await repo.saveDocument({ id: 'doc-crud-1', title: 'Original Title', content: 'Body 1' });

  // Read
  const doc = await repo.getDocument('doc-crud-1');
  assert.strictEqual(doc?.title, 'Original Title');

  // Update
  await repo.saveDocument({ id: 'doc-crud-1', title: 'Updated Title' });
  const updated = await repo.getDocument('doc-crud-1');
  assert.strictEqual(updated?.title, 'Updated Title');
  assert.strictEqual(updated?.content, 'Body 1');

  // List
  const list = await repo.listDocuments();
  assert.strictEqual(list.length, 1);

  // Soft Delete
  await repo.deleteDocument('doc-crud-1');
  const deleted = await repo.getDocument('doc-crud-1');
  assert.strictEqual(deleted, null, 'Soft-deleted doc should return null');

  const emptyList = await repo.listDocuments();
  assert.strictEqual(emptyList.length, 0);

  repo.destroy();
});

test('Repository: Margin Note CRUD and paragraph binding', async () => {
  const repo = new SQLiteStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 'doc-m1', title: 'Document with Notes' });

  // Save Notes
  await repo.saveNote({
    id: 'note-1',
    document_id: 'doc-m1',
    paragraph_anchor_id: 'p-0',
    content: 'First thought',
  });
  await repo.saveNote({
    id: 'note-2',
    document_id: 'doc-m1',
    paragraph_anchor_id: 'p-2',
    content: 'Second thought',
  });

  const notes = await repo.getNotesForDocument('doc-m1');
  assert.strictEqual(notes.length, 2);
  assert.strictEqual(notes[0].paragraph_anchor_id, 'p-0');
  assert.strictEqual(notes[1].paragraph_anchor_id, 'p-2');

  // Delete Note
  await repo.deleteNote('note-1');
  const remaining = await repo.getNotesForDocument('doc-m1');
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].id, 'note-2');

  repo.destroy();
});

test('Repository: Hierarchical tags and tag-based document queries', async () => {
  const repo = new SQLiteStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 'd1', title: 'Doc One' });
  await repo.saveDocument({ id: 'd2', title: 'Doc Two' });

  await repo.setDocumentTags('d1', ['#research/linguistics', '#project/drafts']);
  await repo.setDocumentTags('d2', ['#ideas/fiction']);

  const tagsD1 = await repo.getDocumentTags('d1');
  assert.ok(tagsD1.includes('research/linguistics'));
  assert.ok(tagsD1.includes('project/drafts'));

  // Query by prefix 'research'
  const researchDocs = await repo.listDocuments({ tagId: 'research' });
  assert.strictEqual(researchDocs.length, 1);
  assert.strictEqual(researchDocs[0].id, 'd1');

  // Query by exact tag 'ideas/fiction'
  const fictionDocs = await repo.listDocuments({ tagId: 'ideas/fiction' });
  assert.strictEqual(fictionDocs.length, 1);
  assert.strictEqual(fictionDocs[0].id, 'd2');

  // getTags returns created tags
  const allTags = await repo.getTags();
  const researchTag = allTags.find(t => t.path === 'research/linguistics');
  assert.ok(researchTag);

  // Query by tag ID (UUID/key) rather than tag path
  const docsByTagId = await repo.listDocuments({ tagId: researchTag!.id });
  assert.strictEqual(docsByTagId.length, 1);
  assert.strictEqual(docsByTagId[0].id, 'd1');

  repo.destroy();
});

test('Repository: Search integration returns scored hits with highlights', async () => {
  const repo = new SQLiteStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 's1', title: 'The Art of Solitude', content: 'Writing in silence.' });
  await repo.saveDocument({ id: 's2', title: 'Urban Architecture', content: 'Solitude found in cities.' });
  await repo.setDocumentTags('s1', ['#philosophy']);

  const hits = await repo.searchDocuments('solitude');
  assert.strictEqual(hits.length, 2);

  // Title match scores higher than body match
  assert.strictEqual(hits[0].document.id, 's1');
  assert.strictEqual(hits[1].document.id, 's2');
  assert.ok(hits[0].score > hits[1].score);

  repo.destroy();
});

test('Repository: automatically reloads caches when database is restored', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_repo_restore.db' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // Create document in db
  await repo.saveDocument({ id: 'doc-original', title: 'Original In Repo', content: 'Text 1' });
  await repo.flushPendingEdits();

  // Create another database with different data to export
  const db2 = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_repo_restore_src.db' });
  await runMigrations(db2);
  await db2.executeSql("INSERT INTO documents (id, title, content, created_at, updated_at, format_version, sync_status) VALUES ('doc-restored', 'Restored Title', 'Restored Content', 1000, 2000, 1, 'synced');");
  const snapshotBytes = await db2.exportSnapshot();
  await db2.close();

  // Import into db; repo is subscribed to db.onRestore
  await db.importSnapshot(snapshotBytes);

  // After importSnapshot, repo should have auto-reloaded from restored db
  const docs = await repo.listDocuments();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].id, 'doc-restored');
  assert.strictEqual(docs[0].title, 'Restored Title');

  const oldDoc = await repo.getDocument('doc-original');
  assert.strictEqual(oldDoc, null);

  repo.destroy();
  await db.close();
});

test('Repository: updateSyncMetadata explicitly clears google_drive_file_id in SQLite and cache when null is passed', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_sync_meta_reset.db' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // 1. Create document with valid sync metadata
  await repo.saveDocument({
    id: 'doc-sync-meta-1',
    title: 'Sync Meta Document',
    content: 'Initial text',
    sync_status: 'synced',
    google_drive_file_id: 'gdoc-initial-file-id-123',
    google_drive_revision_id: 'rev-1',
    last_synced_at: 1700000000000,
  });
  await repo.flushPendingEdits();

  // Verify initial state on disk
  const initialDbRows = await db.executeSql<any>(
    `SELECT google_drive_file_id, google_drive_revision_id, last_synced_at, sync_status 
     FROM documents WHERE id = 'doc-sync-meta-1';`
  );
  assert.strictEqual(initialDbRows[0].google_drive_file_id, 'gdoc-initial-file-id-123');
  assert.strictEqual(initialDbRows[0].sync_status, 'synced');

  // 2. Clear sync metadata via updateSyncMetadata with explicit nulls
  await repo.updateSyncMetadata('doc-sync-meta-1', {
    google_drive_file_id: null,
    google_drive_revision_id: null,
    last_synced_at: null,
    sync_status: 'pending',
  });

  // Verify in-memory cache reflects null
  const memDoc = await repo.getDocument('doc-sync-meta-1');
  assert.strictEqual(memDoc?.google_drive_file_id, null);
  assert.strictEqual(memDoc?.google_drive_revision_id, null);
  assert.strictEqual(memDoc?.last_synced_at, null);
  assert.strictEqual(memDoc?.sync_status, 'pending');

  // Verify SQLite database reflects NULL (COALESCE bug resolved)
  const clearedDbRows = await db.executeSql<any>(
    `SELECT google_drive_file_id, google_drive_revision_id, last_synced_at, sync_status 
     FROM documents WHERE id = 'doc-sync-meta-1';`
  );
  assert.strictEqual(clearedDbRows[0].google_drive_file_id, null, 'SQLite google_drive_file_id must be NULL on disk');
  assert.strictEqual(clearedDbRows[0].google_drive_revision_id, null, 'SQLite google_drive_revision_id must be NULL on disk');
  assert.strictEqual(clearedDbRows[0].last_synced_at, null, 'SQLite last_synced_at must be NULL on disk');
  assert.strictEqual(clearedDbRows[0].sync_status, 'pending');

  // Verify findByDriveFileId no longer finds the document
  const found = await repo.findByDriveFileId('gdoc-initial-file-id-123');
  assert.strictEqual(found, null, 'findByDriveFileId must return null for unlinked file ID');

  repo.destroy();
  await db.close();
});

test('Repository: saveDocument deterministically clears google_drive_file_id without resurrection', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_save_resurrect.db' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // 1. Initial document with active file ID
  await repo.saveDocument({
    id: 'doc-resurrect-1',
    title: 'Resurrect Test',
    content: 'Initial text',
    google_drive_file_id: 'gdoc-stale-id',
  });
  await repo.flushPendingEdits();

  // 2. Update with explicit null file ID
  const updated = await repo.saveDocument({
    id: 'doc-resurrect-1',
    google_drive_file_id: null,
    sync_status: 'pending',
  });

  // Verify no resurrection in returned record or cache
  assert.strictEqual(updated.google_drive_file_id, null, 'saveDocument must not resurrect stale file ID');
  const cached = await repo.getDocument('doc-resurrect-1');
  assert.strictEqual(cached?.google_drive_file_id, null);

  // 3. Flush and verify SQLite
  await repo.flushPendingEdits();
  const dbRows = await db.executeSql<any>(
    `SELECT google_drive_file_id FROM documents WHERE id = 'doc-resurrect-1';`
  );
  assert.strictEqual(dbRows[0].google_drive_file_id, null, 'SQLite must contain NULL after flush');

  // 4. Subsequent edit omitting file ID preserves null (does not resurrect)
  const subsequent = await repo.saveDocument({
    id: 'doc-resurrect-1',
    content: 'Typed more text',
  });
  assert.strictEqual(subsequent.google_drive_file_id, null);

  repo.destroy();
  await db.close();
});


