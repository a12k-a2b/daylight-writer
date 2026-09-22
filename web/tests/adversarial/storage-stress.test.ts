/**
 * tests/adversarial/storage-stress.test.ts
 * Milestone 1 Adversarial Stress Test Suite
 * Empirical Challenger Verification for Daylight Writer Persistence Engine
 *
 * Covers:
 * 1. Rapid Typing Simulation (1,000 document updates in <100ms, 0ms lag, 250ms debouncing)
 * 2. Emergency Lifecycle Flush (beforeunload, visibilitychange, pagehide, blur)
 * 3. Large Payload Test (50,000+ words, 500+ margin notes, FTS5 sync, query performance)
 * 4. Snapshot Export and Restore (F40: JSON and Binary snapshot export/restore)
 * 5. Concurrent Mutation Race Condition (in-flight flush vs new mutations)
 * 6. FTS5 Duplication & Soft-Delete Tombstone Leak under INSERT OR REPLACE
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, seedInitialData } from '../../src/storage/schema.ts';

// ----------------------------------------------------------------------------
// Test 1: Rapid Typing Simulation (1,000 updates in <100ms)
// ----------------------------------------------------------------------------
test('Adversarial Stress 1: Rapid Typing Simulation (1,000 updates in <100ms)', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  const docId = 'doc-rapid-stress-1000';
  const burstCount = 1000;
  const latencies: number[] = [];

  const tStart = performance.now();
  for (let i = 1; i <= burstCount; i++) {
    const t0 = performance.now();
    await repo.saveDocument({
      id: docId,
      title: 'Rapid Typing Stress Manuscript',
      content: `Keystroke update ${i}: ${'thought '.repeat(i % 30)}`,
    });
    latencies.push(performance.now() - t0);
  }
  const totalDuration = performance.now() - tStart;

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);

  // Assertions on burst performance
  assert.ok(
    totalDuration < 100,
    `1,000 updates must complete in <100ms; took ${totalDuration.toFixed(2)}ms`
  );
  assert.ok(
    avgLatency < 1.0,
    `Average keystroke latency must be <1ms (0ms tier); took ${avgLatency.toFixed(3)}ms`
  );
  assert.ok(
    maxLatency < 16.0,
    `Max keystroke latency must be <16ms frame budget; was ${maxLatency.toFixed(3)}ms`
  );

  // Debouncing assertion: 0 flushes occurred during the burst
  assert.strictEqual(
    repo.flushCount,
    0,
    `Expected 0 flushes during burst; got ${repo.flushCount}`
  );

  // Wait 350ms for the 250ms trailing-edge debounced commit to fire
  await new Promise((r) => setTimeout(r, 350));

  // Exactly 1 SQLite WAL transaction should have committed
  assert.strictEqual(
    repo.flushCount,
    1,
    `Expected exactly 1 coalesced flush; got ${repo.flushCount}`
  );

  // Verify SQLite WAL persistence directly
  const rows = await db.executeSql<any>(
    'SELECT id, content, version_vector FROM documents WHERE id = ?;',
    [docId]
  );
  assert.strictEqual(rows.length, 1, 'Document must exist in SQLite');
  assert.strictEqual(
    rows[0].version_vector,
    1000,
    'Version vector must equal 1000'
  );
  assert.ok(
    rows[0].content.startsWith('Keystroke update 1000:'),
    'Final document state must match update 1,000 exactly'
  );

  // Verify sync_queue contains the latest document payload
  const queueRows = await db.executeSql<any>(
    'SELECT * FROM sync_queue WHERE entity_id = ?;',
    [docId]
  );
  assert.strictEqual(
    queueRows.length,
    1,
    'Expected 1 coalesced sync_queue entry'
  );
  const queuePayload = JSON.parse(queueRows[0].payload);
  assert.strictEqual(queuePayload.version_vector, 1000);

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Test 2: Emergency Lifecycle Flush Verification
// ----------------------------------------------------------------------------
test('Adversarial Stress 2: Emergency Lifecycle Flush (beforeunload, visibilitychange, pagehide, blur)', async () => {
  // Pre-initialize DB before window assignment to allow node:fs WASM loading
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  try {
    // 1. Test beforeunload emergency flush
  await repo.saveDocument({
    id: 'doc-unload',
    title: 'Unload Title',
    content: 'Unload content',
  });
  await repo.saveNote({
    id: 'note-unload',
    document_id: 'doc-unload',
    paragraph_anchor_id: 'p-0',
    content: 'Unload margin note',
  });
  await repo.setDocumentTags('doc-unload', ['#emergency/unload']);

  assert.strictEqual(repo.flushCount, 0, 'Should not have flushed yet');

  win.dispatchEvent(new win.Event('beforeunload'));
  await new Promise((r) => setTimeout(r, 25)); // Allow microtask tick

  assert.strictEqual(repo.flushCount, 1, 'beforeunload must trigger immediate flush');

  const unloadDoc = await db.executeSql('SELECT * FROM documents WHERE id = ?;', ['doc-unload']);
  const unloadNote = await db.executeSql('SELECT * FROM margin_notes WHERE id = ?;', ['note-unload']);
  const unloadTag = await db.executeSql('SELECT * FROM tags WHERE path = ?;', ['emergency/unload']);
  const unloadDocTag = await db.executeSql('SELECT * FROM document_tags WHERE document_id = ?;', ['doc-unload']);

  assert.strictEqual(unloadDoc.length, 1);
  assert.strictEqual(unloadNote.length, 1);
  assert.strictEqual(unloadTag.length, 1);
  assert.strictEqual(unloadDocTag.length, 1);

  // 2. Test visibilitychange (state === 'hidden') emergency flush
  await repo.saveDocument({ id: 'doc-vis', title: 'Vis Title', content: 'Vis content' });
  Object.defineProperty(win.document, 'visibilityState', { value: 'hidden', configurable: true });
  win.document.dispatchEvent(new win.Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 25));

  const visDoc = await db.executeSql('SELECT * FROM documents WHERE id = ?;', ['doc-vis']);
  assert.strictEqual(visDoc.length, 1, 'visibilitychange hidden must trigger immediate flush');

  // 3. Test pagehide emergency flush
  await repo.saveDocument({ id: 'doc-pagehide', title: 'Hide Title', content: 'Hide content' });
  win.dispatchEvent(new win.Event('pagehide'));
  await new Promise((r) => setTimeout(r, 25));

  const hideDoc = await db.executeSql('SELECT * FROM documents WHERE id = ?;', ['doc-pagehide']);
  assert.strictEqual(hideDoc.length, 1, 'pagehide must trigger immediate flush');

  // 4. Test blur emergency flush
  await repo.saveDocument({ id: 'doc-blur', title: 'Blur Title', content: 'Blur content' });
  win.dispatchEvent(new win.Event('blur'));
  await new Promise((r) => setTimeout(r, 25));

  const blurDoc = await db.executeSql('SELECT * FROM documents WHERE id = ?;', ['doc-blur']);
  assert.strictEqual(blurDoc.length, 1, 'blur must trigger immediate flush');

  } finally {
    repo.destroy();
    await db.close();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  }
});

// ----------------------------------------------------------------------------
// Test 3: Large Payload Manuscript (50,000+ words, 500+ notes, search, FTS)
// ----------------------------------------------------------------------------
test('Adversarial Stress 3: Large Payload Manuscript (50,000+ words, 500+ notes, search, FTS)', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // Generate 50,000+ word content (~5,000 paragraphs, >750k characters)
  const paragraph = 'Daylight Computer DC1 LivePaper delivers unprecedented readability under natural ambient light. ';
  const paragraphs: string[] = [];
  for (let i = 0; i < 5000; i++) {
    paragraphs.push(`Paragraph ${i}: ${paragraph} Deep sustained attention flourished.`);
  }
  const fullManuscript = paragraphs.join('\n\n');
  const wordCount = fullManuscript.split(/\s+/).filter(Boolean).length;
  assert.ok(wordCount >= 50000, `Expected >= 50,000 words, got ${wordCount}`);

  // Save 50,000-word document
  const tDoc0 = performance.now();
  await repo.saveDocument({
    id: 'doc-epic-manuscript',
    title: 'The Great Ambient Odyssey',
    content: fullManuscript,
  });
  const saveDocTime = performance.now() - tDoc0;
  assert.ok(saveDocTime < 50, `Saving 50k-word document took ${saveDocTime.toFixed(2)}ms (must be <50ms)`);

  // Generate 520 margin notes
  const noteCount = 520;
  const tNotes0 = performance.now();
  for (let i = 0; i < noteCount; i++) {
    await repo.saveNote({
      id: `note-epic-${i}`,
      document_id: 'doc-epic-manuscript',
      paragraph_anchor_id: `p-${i}`,
      content: `Note ${i}: Check thematic cadence and sentence rhythm.`,
    });
  }
  const saveNotesTime = performance.now() - tNotes0;
  const avgNoteTime = saveNotesTime / noteCount;
  assert.ok(avgNoteTime < 1.0, `Saving notes avg took ${avgNoteTime.toFixed(3)}ms/note (must be <1ms)`);

  // Explicit flush to SQLite WAL
  const tFlush0 = performance.now();
  await repo.flushPendingEdits();
  const flushTime = performance.now() - tFlush0;
  assert.ok(flushTime < 1000, `Flushing 521 records took ${flushTime.toFixed(2)}ms`);

  // Verify directly in SQLite
  const dbDoc = await db.executeSql<any>(
    'SELECT id, length(content) as len FROM documents WHERE id = ?;',
    ['doc-epic-manuscript']
  );
  assert.strictEqual(dbDoc.length, 1);
  assert.strictEqual(dbDoc[0].len, fullManuscript.length);

  const dbNotes = await db.executeSql<any>(
    'SELECT count(*) as count FROM margin_notes WHERE document_id = ?;',
    ['doc-epic-manuscript']
  );
  assert.strictEqual(dbNotes[0].count, 520);

  // Benchmark getNotesForDocument (520 notes)
  const tGetNotes0 = performance.now();
  const fetchedNotes = await repo.getNotesForDocument('doc-epic-manuscript');
  const getNotesTime = performance.now() - tGetNotes0;
  assert.strictEqual(fetchedNotes.length, 520);
  assert.ok(getNotesTime < 10, `getNotesForDocument took ${getNotesTime.toFixed(2)}ms (target <10ms)`);

  // Benchmark searchDocuments in-memory fuzzy search
  const tSearch0 = performance.now();
  const hits = await repo.searchDocuments('Odyssey');
  const searchTime = performance.now() - tSearch0;
  assert.ok(hits.length >= 1);
  assert.ok(searchTime < 50, `searchDocuments took ${searchTime.toFixed(2)}ms (must be <50ms)`);

  // Benchmark FTS5 virtual table query
  const tFts0 = performance.now();
  const ftsHits = await db.executeSql<any>(
    'SELECT id FROM documents_fts WHERE documents_fts MATCH ?;',
    ['flourished']
  );
  const ftsTime = performance.now() - tFts0;
  assert.strictEqual(ftsHits.length, 1);
  assert.ok(ftsTime < 20, `FTS5 query took ${ftsTime.toFixed(2)}ms (must be <20ms)`);

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Test 4: Database Snapshot Export/Restore (F40)
// ----------------------------------------------------------------------------
test('Adversarial Stress 4: Database Snapshot Export and Restore (F40)', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);
  await seedInitialData(db);

  // 1. JSON Snapshot Export and Restore (Relational Model)
  const jsonSnapshot = await db.exportJsonSnapshot();
  assert.strictEqual(jsonSnapshot.schema_version, 2);
  assert.strictEqual(jsonSnapshot.documents.length, 1);
  assert.strictEqual(jsonSnapshot.margin_notes.length, 2);
  assert.strictEqual(jsonSnapshot.tags.length, 2);

  // Clear data
  await db.exec('DELETE FROM documents; DELETE FROM margin_notes;');
  let docsAfterClear = await db.executeSql('SELECT * FROM documents;');
  assert.strictEqual(docsAfterClear.length, 0);

  // Restore via JSON
  await db.importJsonSnapshot(jsonSnapshot);
  let docsAfterRestore = await db.executeSql('SELECT * FROM documents;');
  assert.strictEqual(docsAfterRestore.length, 1);
  assert.strictEqual(docsAfterRestore[0].title, 'Welcome to Daylight Writer');

  // 2. Binary Snapshot Export verification
  const binarySnapshot = await db.exportSnapshot();
  assert.ok(binarySnapshot instanceof Uint8Array);
  assert.ok(binarySnapshot.length > 0);

  // Verify SQLite format 3 signature
  const sig = new TextDecoder().decode(binarySnapshot.slice(0, 15));
  assert.ok(sig.startsWith('SQLite format 3'));

  // Corrupt / clear database state
  await db.exec('DELETE FROM documents;');
  const clearedCheck = await db.executeSql('SELECT * FROM documents;');
  assert.strictEqual(clearedCheck.length, 0);

  // Binary Restore via importSnapshot restores active connection
  await db.importSnapshot(binarySnapshot);
  const checkRestored = await db.executeSql<any>('SELECT * FROM documents;');

  console.log('[Adversarial Metric] Documents found in DB after binary importSnapshot:', checkRestored.length);
  assert.strictEqual(
    checkRestored.length,
    1,
    'EMPIRICAL VERIFICATION: Binary importSnapshot successfully reloads active connection in MemoryVFS'
  );
  assert.strictEqual(
    checkRestored[0]?.title,
    'Welcome to Daylight Writer',
    'Restored document content matches snapshot'
  );

  await db.close();
});

// ----------------------------------------------------------------------------
// Test 5: Concurrent Mutation Race Condition during In-Flight Transaction Flush
// ----------------------------------------------------------------------------
test('Adversarial Stress 5: Concurrency race condition during in-flight transaction flush', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  // Simulate realistic 30ms disk/worker transaction delay
  const origRunTransaction = db.runTransaction.bind(db);
  db.runTransaction = async (ops) => {
    await new Promise((r) => setTimeout(r, 30));
    return origRunTransaction(ops);
  };

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // 1. Initial write
  await repo.saveDocument({ id: 'doc-race', title: 'Manuscript', content: 'Version A' });

  // 2. Initiate flush 1
  const flush1 = repo.flushPendingEdits();

  // 3. While flush 1 is awaiting runTransaction, user mutates to Version B
  await new Promise((r) => setTimeout(r, 10));
  await repo.saveDocument({ id: 'doc-race', title: 'Manuscript', content: 'Version B (Critical Update)' });

  // 4. Await flush 1
  await flush1;

  // 5. Wait for the 250ms debounced flush from Version B to fire
  await new Promise((r) => setTimeout(r, 350));

  // 6. Check SQLite directly
  const rows = await db.executeSql<any>('SELECT content, version_vector FROM documents WHERE id = ?;', ['doc-race']);

  console.log('[Adversarial Metric] Content in SQLite after debounced flush of Version B:', rows[0]?.content);
  assert.strictEqual(
    rows[0]?.content,
    'Version B (Critical Update)',
    'EMPIRICAL VERIFICATION: Latest mutation is retained and persisted in SQLite WAL after in-flight transaction flush'
  );
  assert.strictEqual(
    rows[0]?.version_vector,
    2,
    'Version vector must equal 2'
  );

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Test 6: FTS5 Virtual Table Duplication & Soft-Delete Tombstone Leak
// ----------------------------------------------------------------------------
test('Adversarial Stress 6: FTS5 Virtual Table Duplication and Soft-Delete Tombstone Leak', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // 1. Create document
  await repo.saveDocument({
    id: 'doc-tombstone',
    title: 'Classified Note',
    content: 'The secret passphrase is amber-sunlight',
  });
  await repo.flushPendingEdits();

  // FTS5 initially contains 1 row
  const ftsInitial = await db.executeSql<any>('SELECT rowid, id, title FROM documents_fts;');
  assert.strictEqual(ftsInitial.length, 1);

  // 2. Update document
  await repo.saveDocument({
    id: 'doc-tombstone',
    title: 'Classified Note',
    content: 'The secret passphrase is changed to obsidian-night',
  });
  await repo.flushPendingEdits();

  // Verification 1: No duplicate FTS rows
  const ftsAfterUpdate = await db.executeSql<any>('SELECT rowid, id, title FROM documents_fts;');
  console.log('[Adversarial Metric] FTS5 rows after document update:', ftsAfterUpdate.length);
  assert.strictEqual(
    ftsAfterUpdate.length,
    1,
    'EMPIRICAL VERIFICATION: Document update does not create duplicate rows in documents_fts'
  );

  // 3. Soft delete document
  await repo.deleteDocument('doc-tombstone');
  await repo.flushPendingEdits();

  // Verification 2: Zero soft delete tombstone leak
  const ftsMatchesAfterDelete = await db.executeSql<any>(
    'SELECT id FROM documents_fts WHERE documents_fts MATCH ?;',
    ['obsidian']
  );
  console.log('[Adversarial Metric] FTS5 search hits for soft-deleted document:', ftsMatchesAfterDelete.length);
  assert.strictEqual(
    ftsMatchesAfterDelete.length,
    0,
    'EMPIRICAL VERIFICATION: Soft-deleted document is purged from documents_fts, preventing tombstone leakage'
  );

  repo.destroy();
  await db.close();
});
