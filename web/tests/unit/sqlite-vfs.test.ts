/**
 * tests/unit/sqlite-vfs.test.ts
 * Unit tests for multi-tier wa-sqlite VFS, SqliteDatabase, and Snapshot Backup Hooks (F40)
 */

import test from 'node:test';
import assert from 'node:assert';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, seedInitialData } from '../../src/storage/schema.ts';

test('SqliteDatabase: opens with MemoryVFS and runs basic SQL operations', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_unit.db' });
  assert.strictEqual(db.getVfsName(), 'MemoryVFS');

  await db.exec('CREATE TABLE test_kv (k TEXT PRIMARY KEY, v TEXT);');
  const res = await db.run('INSERT INTO test_kv VALUES (?, ?);', ['foo', 'bar']);
  assert.strictEqual(res.changes, 1);

  const rows = await db.executeSql<{ k: string; v: string }>('SELECT * FROM test_kv WHERE k = ?;', ['foo']);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].v, 'bar');

  await db.close();
});

test('SqliteDatabase: runs migrations and seeds data in MemoryVFS', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_seed.db' });
  const version = await runMigrations(db);
  assert.strictEqual(version, 2);

  const seeded = await seedInitialData(db);
  assert.strictEqual(seeded, true);

  const docs = await db.executeSql('SELECT * FROM documents WHERE deleted_at IS NULL;');
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].title, 'Welcome to Daylight Writer');

  const notes = await db.executeSql('SELECT * FROM margin_notes WHERE deleted_at IS NULL;');
  assert.strictEqual(notes.length, 2);

  await db.close();
});

test('SqliteDatabase: F40 Binary and JSON snapshot export and restore', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_snapshot.db' });
  await runMigrations(db);
  await seedInitialData(db);

  // 1. Export raw binary snapshot
  const binarySnapshot = await db.exportSnapshot();
  assert.ok(binarySnapshot instanceof Uint8Array);
  assert.ok(binarySnapshot.length > 0);

  // Verify SQLite format signature or valid content
  const headerStr = new TextDecoder().decode(binarySnapshot.slice(0, 15));
  assert.ok(headerStr.startsWith('SQLite format 3') || binarySnapshot[0] === 0x7B);

  // 2. Export JSON snapshot
  const jsonSnapshot = await db.exportJsonSnapshot();
  assert.strictEqual(jsonSnapshot.schema_version, 2);
  assert.strictEqual(jsonSnapshot.documents.length, 1);
  assert.strictEqual(jsonSnapshot.margin_notes.length, 2);
  assert.strictEqual(jsonSnapshot.tags.length, 2);

  // 3. Import JSON snapshot into fresh DB
  const db2 = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_restore.db' });
  await runMigrations(db2);
  await db2.importJsonSnapshot(jsonSnapshot);

  const restoredDocs = await db2.executeSql('SELECT * FROM documents;');
  assert.strictEqual(restoredDocs.length, 1);
  assert.strictEqual(restoredDocs[0].title, 'Welcome to Daylight Writer');

  await db.close();
  await db2.close();
});

test('SqliteDatabase: binary importSnapshot restores active connection and notifies listeners', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'test_bin_restore.db' });
  await runMigrations(db);
  await seedInitialData(db);

  // Take binary snapshot
  const binarySnapshot = await db.exportSnapshot();
  assert.ok(binarySnapshot instanceof Uint8Array);

  // Clear data on active connection
  await db.exec('DELETE FROM documents; DELETE FROM margin_notes;');
  let docsAfterClear = await db.executeSql('SELECT * FROM documents;');
  assert.strictEqual(docsAfterClear.length, 0);

  // Track restore callback
  let restoredNotified = false;
  db.onRestore(() => {
    restoredNotified = true;
  });

  // Restore from binary snapshot into active connection
  await db.importSnapshot(binarySnapshot);

  // Query immediately on the active connection without reopening
  const docsAfterRestore = await db.executeSql<any>('SELECT * FROM documents;');
  assert.strictEqual(docsAfterRestore.length, 1, 'Active connection must immediately observe restored documents');
  assert.strictEqual(docsAfterRestore[0].title, 'Welcome to Daylight Writer');
  assert.strictEqual(restoredNotified, true, 'onRestore listener must be notified');

  await db.close();
});
