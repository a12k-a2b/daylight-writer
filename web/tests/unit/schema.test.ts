/**
 * tests/unit/schema.test.ts
 * Unit tests for PowerSync schema, migrations, seed data, and domain mappers
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  INITIAL_SCHEMA_SQL,
  MIGRATIONS,
  runMigrations,
  seedInitialData,
  fromDbDocument,
  fromDbNote,
  fromDbTag,
  SEED_DOCUMENT_ID,
  SEED_NOTE_1_ID,
  SEED_NOTE_2_ID,
  SEED_TAG_GETTING_STARTED_ID,
  type DatabaseDriver,
} from '../../src/storage/schema.ts';

// Lightweight in-memory test driver for schema logic
class MockDriver implements DatabaseDriver {
  public executedSql: string[] = [];
  public transactions: { sql: string; params: any[] }[][] = [];
  public userVersion = 0;
  public docCount = 0;

  async executeSql<T = any>(sql: string, _params: any[] = []): Promise<T[]> {
    this.executedSql.push(sql);
    if (sql.includes('PRAGMA user_version;')) {
      return [{ user_version: this.userVersion }] as any;
    }
    if (sql.includes('SELECT COUNT(*) as count FROM documents')) {
      return [{ count: this.docCount }] as any;
    }
    return [];
  }

  async runTransaction(operations: { sql: string; params: any[] }[]): Promise<void> {
    this.transactions.push(operations);
    for (const op of operations) {
      if (op.sql.startsWith('PRAGMA user_version =')) {
        const match = op.sql.match(/PRAGMA user_version = (\d+);/);
        if (match) {
          this.userVersion = Number(match[1]);
        }
      }
    }
  }
}

test('Schema DDL: INITIAL_SCHEMA_SQL contains all required tables and indexes', () => {
  assert.ok(INITIAL_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS documents'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS margin_notes'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS tags'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS document_tags'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS sync_queue'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('idx_documents_updated_at'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('idx_margin_notes_doc_anchor'));
  assert.ok(INITIAL_SCHEMA_SQL.includes('trg_documents_fts_ai'));
});

test('Migrations: runMigrations executes pending migrations and updates user_version', async () => {
  const driver = new MockDriver();
  assert.strictEqual(driver.userVersion, 0);

  const version = await runMigrations(driver);
  assert.strictEqual(version, 2);
  assert.strictEqual(driver.userVersion, 2);
  assert.strictEqual(driver.transactions.length, 2);

  // Second run is idempotent
  const version2 = await runMigrations(driver);
  assert.strictEqual(version2, 2);
  assert.strictEqual(driver.transactions.length, 2);
});

test('Seed Data: seedInitialData creates welcome document and notes on first boot', async () => {
  const driver = new MockDriver();
  const seeded = await seedInitialData(driver);
  assert.strictEqual(seeded, true);
  assert.strictEqual(driver.transactions.length, 1);

  const ops = driver.transactions[0];
  const docOp = ops.find(op => op.params.includes(SEED_DOCUMENT_ID));
  assert.ok(docOp);
  assert.strictEqual(docOp!.params[1], 'Welcome to Daylight Writer');

  const note1Op = ops.find(op => op.params.includes(SEED_NOTE_1_ID));
  assert.ok(note1Op);

  const note2Op = ops.find(op => op.params.includes(SEED_NOTE_2_ID));
  assert.ok(note2Op);

  const tagOp = ops.find(op => op.params.includes(SEED_TAG_GETTING_STARTED_ID));
  assert.ok(tagOp);
});

test('Seed Data: does not re-seed if documents already exist', async () => {
  const driver = new MockDriver();
  driver.docCount = 3;

  const seeded = await seedInitialData(driver);
  assert.strictEqual(seeded, false);
  assert.strictEqual(driver.transactions.length, 0);
});

test('Domain Mappers: fromDbDocument maps SQLite row to DocumentRecord', () => {
  const row = {
    id: 'doc-test-1',
    title: 'Test Document',
    content: 'Some content',
    created_at: 1700000000000,
    updated_at: 1700000500000,
    deleted_at: null,
    is_title_custom: 1,
    format_version: 1,
    sync_status: 'synced',
    google_drive_file_id: 'gdrive-123',
    version_vector: 2,
  };

  const doc = fromDbDocument(row);
  assert.strictEqual(doc.id, 'doc-test-1');
  assert.strictEqual(doc.title, 'Test Document');
  assert.strictEqual(doc.content, 'Some content');
  assert.strictEqual(doc.created_at, 1700000000000);
  assert.strictEqual(doc.updated_at, 1700000500000);
  assert.strictEqual(doc.deleted_at, null);
  assert.strictEqual(doc.is_title_custom, true);
  assert.strictEqual(doc.sync_status, 'synced');
  assert.strictEqual(doc.google_drive_file_id, 'gdrive-123');
  assert.strictEqual(doc.version_vector, 2);
});

test('Domain Mappers: fromDbNote and fromDbTag map correctly', () => {
  const noteRow = {
    id: 'note-1',
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-2',
    content: 'Margin idea',
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
  };
  const note = fromDbNote(noteRow);
  assert.strictEqual(note.id, 'note-1');
  assert.strictEqual(note.paragraph_anchor_id, 'p-2');
  assert.strictEqual(note.content, 'Margin idea');

  const tagRow = {
    id: 'tag-1',
    name: 'drafts',
    path: 'project/drafts',
    created_at: 3000,
  };
  const tag = fromDbTag(tagRow);
  assert.strictEqual(tag.id, 'tag-1');
  assert.strictEqual(tag.name, 'drafts');
  assert.strictEqual(tag.path, 'project/drafts');
});

test('Seed Data: seedInitialData is completely idempotent and handles soft-deleted welcome doc', async () => {
  const { SqliteDatabase } = await import('../../src/storage/sqlite-vfs.ts');
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_seed_idempotent.db' });
  await runMigrations(db);

  // First seed
  const seeded1 = await seedInitialData(db);
  assert.strictEqual(seeded1, true);

  // Soft-delete welcome document
  await db.executeSql('UPDATE documents SET deleted_at = ? WHERE id = ?;', [Date.now(), 'doc-welcome-01']);

  // Second seed after soft-delete: must NOT crash with UNIQUE constraint failed and must return false
  const seeded2 = await seedInitialData(db);
  assert.strictEqual(seeded2, false);

  // Forced direct call to seedInitialData with cleared doc table but existing notes:
  // Should never throw unhandled exception
  await db.exec('DELETE FROM documents;');
  const seeded3 = await seedInitialData(db);
  assert.strictEqual(seeded3, true);

  await db.close();
});

test('FTS5 Triggers: handle INSERT OR REPLACE and soft-delete updates without duplicate or orphaned entries', async () => {
  const { SqliteDatabase } = await import('../../src/storage/sqlite-vfs.ts');
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_fts_integrity.db' });
  await runMigrations(db);

  // 1. Initial insert
  await db.executeSql(`INSERT INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status, version_vector)
    VALUES ('doc-1', 'Initial Title', 'The quick brown fox', 100, 100, NULL, 0, 1, 'synced', 1);`);

  let ftsRows = await db.executeSql<any>('SELECT id, title, content FROM documents_fts;');
  assert.strictEqual(ftsRows.length, 1);
  assert.strictEqual(ftsRows[0].title, 'Initial Title');

  // 2. INSERT OR REPLACE update
  await db.executeSql(`INSERT OR REPLACE INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status, version_vector)
    VALUES ('doc-1', 'Updated Title', 'The quick brown fox jumps over the lazy dog', 100, 200, NULL, 0, 1, 'synced', 2);`);

  ftsRows = await db.executeSql<any>('SELECT id, title, content FROM documents_fts;');
  assert.strictEqual(ftsRows.length, 1, 'Must NOT contain duplicate FTS rows after INSERT OR REPLACE update');
  assert.strictEqual(ftsRows[0].title, 'Updated Title');

  // 3. INSERT OR REPLACE soft-delete
  await db.executeSql(`INSERT OR REPLACE INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status, version_vector)
    VALUES ('doc-1', 'Updated Title', 'The quick brown fox jumps over the lazy dog', 100, 300, 300, 0, 1, 'synced', 3);`);

  ftsRows = await db.executeSql<any>('SELECT id, title, content FROM documents_fts;');
  assert.strictEqual(ftsRows.length, 0, 'Must contain 0 FTS rows after soft-delete');

  const matches = await db.executeSql<any>('SELECT id FROM documents_fts WHERE documents_fts MATCH ?;', ['fox']);
  assert.strictEqual(matches.length, 0, 'Soft-deleted documents must not match full-text search');

  await db.close();
});
