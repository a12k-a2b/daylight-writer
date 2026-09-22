/**
 * tests/adversarial/concurrent-data-loss-attack.test.ts
 * Milestone 1 Iteration 2 Gate Adversarial Challenger Attack Harness
 *
 * Empirical verification attempting concurrent data loss attacks on:
 * - Revision-gated dirty tracking under interleaved multi-worker race conditions
 * - Emergency flush stampedes during active WAL transactions
 * - Error injection and retry resilience without mutation dropping
 * - Binary snapshot restore cache invalidation and subsequent write integrity
 * - FTS5 trigger integrity under concurrent modifications and soft deletes
 */

import test from 'node:test';
import assert from 'node:assert';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, seedInitialData } from '../../src/storage/schema.ts';

// ----------------------------------------------------------------------------
// Attack 1: Massive Interleaved Concurrent Writers with Jittered Disk Delays
// ----------------------------------------------------------------------------
test('Adversarial Attack 1: Interleaved concurrent multi-entity writers with random I/O delays', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  // Inject random 5ms - 25ms delay into db.runTransaction to simulate I/O jitter
  const realRunTransaction = db.runTransaction.bind(db);
  db.runTransaction = async (ops) => {
    const delay = 5 + Math.floor(Math.random() * 20);
    await new Promise((r) => setTimeout(r, delay));
    return realRunTransaction(ops);
  };

  const repo = new SQLiteStorageRepository(db, 100);
  await repo.init();

  const NUM_DOCS = 4;
  const EDITS_PER_DOC = 50;

  // Initialize documents
  for (let d = 0; d < NUM_DOCS; d++) {
    await repo.saveDocument({
      id: `attack1-doc-${d}`,
      title: `Doc ${d} Initial`,
      content: `Initial content for doc ${d}`,
    });
  }

  // Writer workers running concurrently
  const workers: Promise<void>[] = [];

  for (let d = 0; d < NUM_DOCS; d++) {
    const docId = `attack1-doc-${d}`;
    workers.push(
      (async () => {
        for (let i = 1; i <= EDITS_PER_DOC; i++) {
          await repo.saveDocument({
            id: docId,
            title: `Doc ${d} Title Rev ${i}`,
            content: `Doc ${d} Content Rev ${i} - ${'word '.repeat(i % 10)}`,
          });

          // Also save a note
          if (i % 5 === 0) {
            await repo.saveNote({
              id: `note-${d}-${i}`,
              document_id: docId,
              paragraph_anchor_id: `p-${i}`,
              content: `Note revision ${i}`,
            });
          }

          // Also update tags
          if (i % 10 === 0) {
            await repo.setDocumentTags(docId, [`#project/doc${d}`, `#cycle/${i}`]);
          }

          // Random small pause to interleave with other workers
          if (i % 7 === 0) {
            await new Promise((r) => setTimeout(r, 2 + Math.floor(Math.random() * 5)));
          }
        }
      })()
    );
  }

  // Concurrently trigger uncoordinated flush attempts
  const flusher = (async () => {
    for (let f = 0; f < 10; f++) {
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 20)));
      await repo.flushPendingEdits().catch(() => {});
    }
  })();

  await Promise.all([...workers, flusher]);

  // Final flush to ensure everything pending is committed
  await repo.flushPendingEdits();

  // Oracle 1: In-memory cache must match SQLite for all documents
  for (let d = 0; d < NUM_DOCS; d++) {
    const docId = `attack1-doc-${d}`;
    const memDoc = await repo.getDocument(docId);
    assert.ok(memDoc, `In-memory document ${docId} must exist`);

    const sqlRows = await db.executeSql<any>(
      'SELECT id, title, content, version_vector, deleted_at FROM documents WHERE id = ?;',
      [docId]
    );
    assert.strictEqual(sqlRows.length, 1, `SQLite row for ${docId} must exist`);
    const sqlDoc = sqlRows[0];

    assert.strictEqual(
      sqlDoc.content,
      memDoc.content,
      `Content mismatch between memory and SQLite for ${docId}`
    );
    assert.strictEqual(
      sqlDoc.title,
      memDoc.title,
      `Title mismatch between memory and SQLite for ${docId}`
    );
    assert.strictEqual(
      sqlDoc.version_vector,
      memDoc.version_vector,
      `Version vector mismatch between memory and SQLite for ${docId}`
    );
    assert.strictEqual(
      sqlDoc.version_vector,
      EDITS_PER_DOC + 1, // 1 initial + 50 edits
      `Version vector must reflect all ${EDITS_PER_DOC} edits`
    );
  }

  // Oracle 2: All 40 created notes (4 docs * 10 notes) must exist in SQLite
  const totalNotes = await db.executeSql<any>(
    "SELECT count(*) as count FROM margin_notes WHERE id LIKE 'note-%';"
  );
  assert.strictEqual(totalNotes[0].count, 40, 'All 40 notes must be persisted in SQLite');

  // Oracle 3: Tags must match between memory and SQLite
  for (let d = 0; d < NUM_DOCS; d++) {
    const docId = `attack1-doc-${d}`;
    const memTags = await repo.getDocumentTags(docId);
    const sqlTags = await db.executeSql<any>(
      `SELECT t.path FROM tags t
       JOIN document_tags dt ON dt.tag_id = t.id
       WHERE dt.document_id = ?
       ORDER BY t.path ASC;`,
      [docId]
    );
    const sqlPaths = sqlTags.map((r: any) => r.path).sort();
    const sortedMemPaths = [...memTags].sort();
    assert.deepStrictEqual(sqlPaths, sortedMemPaths, `Tags mismatch for ${docId}`);
  }

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Attack 2: Emergency Flush Stampede during Active In-Flight WAL Transaction
// ----------------------------------------------------------------------------
test('Adversarial Attack 2: Emergency flush stampede during active in-flight WAL transaction', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  // Controlled barrier: hold runTransaction until released
  let releaseHold: () => void = () => {};
  let holdTransaction = false;

  const realRunTransaction = db.runTransaction.bind(db);
  db.runTransaction = async (ops) => {
    if (holdTransaction) {
      await new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
    }
    return realRunTransaction(ops);
  };

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  const docId = 'doc-stampede';

  // 1. Initial save & start flush 1 (which will be held)
  await repo.saveDocument({ id: docId, title: 'Stampede Doc', content: 'Base Content (Rev 1)' });
  holdTransaction = true;
  const inFlightFlushPromise = repo.flushPendingEdits();

  // Allow microtask tick to ensure inFlightFlush has reached runTransaction
  await new Promise((r) => setTimeout(r, 10));

  // 2. While transaction 1 is blocked, burst 25 new edits
  for (let i = 2; i <= 25; i++) {
    await repo.saveDocument({
      id: docId,
      title: 'Stampede Doc',
      content: `Burst Content Rev ${i}`,
    });
  }

  // 3. Stampede: 10 concurrent emergency flush calls launched at once
  const stampedePromises = Array.from({ length: 10 }, () => repo.flushPendingEdits());

  // 4. Release the in-flight transaction
  holdTransaction = false;
  releaseHold();

  // 5. Await both the original flush and all 10 stampede flushes
  await inFlightFlushPromise;
  await Promise.all(stampedePromises);

  // 6. Direct SQLite audit
  const rows = await db.executeSql<any>(
    'SELECT content, version_vector FROM documents WHERE id = ?;',
    [docId]
  );
  assert.strictEqual(rows.length, 1, 'Document must exist in SQLite');
  assert.strictEqual(
    rows[0].version_vector,
    25,
    `Version vector in SQLite must equal 25; got ${rows[0].version_vector}`
  );
  assert.strictEqual(
    rows[0].content,
    'Burst Content Rev 25',
    'SQLite must contain the final burst edit (Rev 25) without dropping'
  );

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Attack 3: Soft-Delete and Resurrection Race Condition
// ----------------------------------------------------------------------------
test('Adversarial Attack 3: Soft-delete and immediate resurrection race condition', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  let holdTransaction = false;
  let releaseHold: () => void = () => {};
  const realRun = db.runTransaction.bind(db);
  db.runTransaction = async (ops) => {
    if (holdTransaction) {
      await new Promise<void>((r) => { releaseHold = r; });
    }
    return realRun(ops);
  };

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  const docId = 'doc-resurrect';

  // 1. Initial save & trigger held flush
  await repo.saveDocument({ id: docId, title: 'Original', content: 'Living Document' });
  holdTransaction = true;
  const p1 = repo.flushPendingEdits();
  await new Promise((r) => setTimeout(r, 10));

  // 2. While flush 1 is held, delete the document, then immediately save new content (resurrect)
  await repo.deleteDocument(docId);
  await repo.saveDocument({
    id: docId,
    title: 'Resurrected',
    content: 'Phoenix rising from ashes',
    deleted_at: null,
  });

  // 3. Release flush 1 and trigger flush 2
  holdTransaction = false;
  releaseHold();
  await p1;
  await repo.flushPendingEdits();

  // 4. Verify in SQLite
  const rows = await db.executeSql<any>(
    'SELECT title, content, deleted_at, version_vector FROM documents WHERE id = ?;',
    [docId]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, 'Resurrected');
  assert.strictEqual(rows[0].deleted_at, null, 'Resurrected document must not have deleted_at set');
  assert.strictEqual(rows[0].version_vector, 3, 'Initial (1) -> Delete (2) -> Resurrect (3)');

  // 5. Verify FTS5 virtual table contains resurrected document
  const ftsHits = await db.executeSql<any>(
    'SELECT id FROM documents_fts WHERE documents_fts MATCH ?;',
    ['Phoenix']
  );
  assert.strictEqual(ftsHits.length, 1, 'Resurrected document must be searchable in FTS5');

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Attack 4: Transaction Failure & Retry Resilience (Simulated Disk / I/O Fault)
// ----------------------------------------------------------------------------
test('Adversarial Attack 4: Transaction failure and retry resilience without mutation dropping', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  let failNextTransaction = false;
  const realRun = db.runTransaction.bind(db);
  db.runTransaction = async (ops) => {
    if (failNextTransaction) {
      failNextTransaction = false;
      throw new Error('SIMULATED_SQLITE_IOERR: disk full or lock collision');
    }
    return realRun(ops);
  };

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  const docId = 'doc-failure-recovery';

  // 1. Save edit 1
  await repo.saveDocument({ id: docId, title: 'Edit 1', content: 'Content 1' });

  // 2. Make flush fail
  failNextTransaction = true;
  await assert.rejects(
    () => repo.flushPendingEdits(),
    /SIMULATED_SQLITE_IOERR/
  );

  // 3. User makes edit 2 after failure
  await repo.saveDocument({ id: docId, title: 'Edit 2', content: 'Content 2 (Post-Failure)' });

  // 4. Retry flush
  await repo.flushPendingEdits();

  // 5. Verify SQLite has latest content and correct version
  const rows = await db.executeSql<any>(
    'SELECT title, content, version_vector FROM documents WHERE id = ?;',
    [docId]
  );
  assert.strictEqual(rows.length, 1, 'Document must be persisted after recovery');
  assert.strictEqual(rows[0].title, 'Edit 2');
  assert.strictEqual(rows[0].content, 'Content 2 (Post-Failure)');
  assert.strictEqual(rows[0].version_vector, 2);

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Attack 5: Binary Snapshot Restore Cache Synchronization under Active In-Memory Mutex
// ----------------------------------------------------------------------------
test('Adversarial Attack 5: Binary snapshot restore clears in-memory dirty cache and re-syncs state', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // 1. Establish initial baseline snapshot
  await repo.saveDocument({ id: 'doc-snap-a', title: 'Snapshot Doc A', content: 'Original content A' });
  await repo.saveNote({
    id: 'note-snap-a',
    document_id: 'doc-snap-a',
    paragraph_anchor_id: 'p-1',
    content: 'Original note A',
  });
  await repo.setDocumentTags('doc-snap-a', ['#archive/golden']);
  await repo.flushPendingEdits();

  // Take binary snapshot
  const binarySnapshot = await db.exportSnapshot();
  assert.ok(binarySnapshot.length > 0);

  // 2. Introduce rogue mutations that are dirty in memory
  await repo.saveDocument({ id: 'doc-rogue', title: 'Rogue Doc', content: 'Should disappear on restore' });
  await repo.saveDocument({ id: 'doc-snap-a', title: 'Corrupted Doc A', content: 'Mutated before restore' });

  // 3. Import golden snapshot
  await db.importSnapshot(binarySnapshot);

  // 4. Check repository in-memory state:
  // - doc-rogue must NOT exist in cache
  // - doc-snap-a must be reverted to 'Snapshot Doc A'
  // - tags must be '#archive/golden'
  const rogueDoc = await repo.getDocument('doc-rogue');
  assert.strictEqual(rogueDoc, null, 'Rogue document must not exist after restoring golden snapshot');

  const restoredDoc = await repo.getDocument('doc-snap-a');
  assert.ok(restoredDoc);
  assert.strictEqual(restoredDoc.title, 'Snapshot Doc A');
  assert.strictEqual(restoredDoc.content, 'Original content A');

  const tags = await repo.getDocumentTags('doc-snap-a');
  assert.deepStrictEqual(tags, ['archive/golden']);

  // 5. Subsequent mutations after restore work seamlessly
  await repo.saveDocument({ id: 'doc-snap-a', title: 'Snapshot Doc A (New Edition)', content: 'Post-restore edit' });
  await repo.flushPendingEdits();

  const checkDb = await db.executeSql<any>(
    'SELECT title, content FROM documents WHERE id = ?;',
    ['doc-snap-a']
  );
  assert.strictEqual(checkDb[0].title, 'Snapshot Doc A (New Edition)');

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Attack 6: FTS5 Stress & Special Character Fuzzing under Concurrent Updates & Soft Deletes
// ----------------------------------------------------------------------------
test('Adversarial Attack 6: FTS5 stress under concurrent updates, special characters, and soft deletes', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 50);
  await repo.init();

  const adversarialPayloads = [
    { id: 'fts-adv-1', title: 'Normal Title', content: 'Simple baseline keyword' },
    { id: 'fts-adv-2', title: 'Quotes and "Punctuation"', content: 'Content with "double quotes" and \'single quotes\' and `backticks`' },
    { id: 'fts-adv-3', title: 'SQL & FTS Keywords', content: 'AND OR NOT NEAR MATCH SELECT FROM WHERE DELETE INSERT' },
    { id: 'fts-adv-4', title: 'Special Symbols & Markdown', content: '## Heading *italic* **bold** [link](url) <script>alert(1)</script>' },
    { id: 'fts-adv-5', title: 'Unicode & Emoji 🌞', content: 'Daylight Sol:OS --os-900 typography — em-dash and «guillemets»' },
  ];

  // Insert all
  for (const item of adversarialPayloads) {
    await repo.saveDocument(item);
  }
  await repo.flushPendingEdits();

  // Verify all 5 indexed in FTS5
  const initialFtsRows = await db.executeSql<any>('SELECT count(*) as count FROM documents_fts;');
  assert.strictEqual(initialFtsRows[0].count, 5, 'Expected 5 initial FTS5 rows');

  // Concurrently update 3 docs and soft-delete 2 docs
  await Promise.all([
    repo.saveDocument({ id: 'fts-adv-1', content: 'Updated baseline content with new keyword: solarflare' }),
    repo.saveDocument({ id: 'fts-adv-2', content: 'Updated quotes: "still quoted" and \'escaped\'' }),
    repo.saveDocument({ id: 'fts-adv-3', content: 'Updated FTS keywords: NOT OR AND NEAR' }),
    repo.deleteDocument('fts-adv-4'),
    repo.deleteDocument('fts-adv-5'),
  ]);

  await repo.flushPendingEdits();

  // Exactly 3 rows must remain in FTS5 (2 soft-deleted docs must be purged)
  const remainingFtsRows = await db.executeSql<any>('SELECT count(*) as count FROM documents_fts;');
  assert.strictEqual(remainingFtsRows[0].count, 3, 'Expected exactly 3 active rows in FTS5 after soft-deletes');

  // Search for updated keyword
  const solarHits = await db.executeSql<any>(
    'SELECT id FROM documents_fts WHERE documents_fts MATCH ?;',
    ['solarflare']
  );
  assert.strictEqual(solarHits.length, 1);
  assert.strictEqual(solarHits[0].id, 'fts-adv-1');

  // Verify soft-deleted documents are NOT found in FTS5
  const deletedHits = await db.executeSql<any>(
    'SELECT id FROM documents_fts WHERE documents_fts MATCH ?;',
    ['typography']
  );
  assert.strictEqual(deletedHits.length, 0, 'Soft-deleted documents must not leak into FTS5 results');

  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// Attack 7: Concurrent Rapid Typing Burst with Asynchronous Lifecycle Flush Stampede
// ----------------------------------------------------------------------------
test('Adversarial Attack 7: 1,000 rapid updates across multiple documents with continuous flush pressure', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 50);
  await repo.init();

  const numDocs = 5;
  const updatesPerDoc = 200; // 5 * 200 = 1,000 total updates

  // Spawn continuous background flushes
  let stopFlushing = false;
  const backgroundFlusher = (async () => {
    while (!stopFlushing) {
      await new Promise((r) => setTimeout(r, 10));
      await repo.flushPendingEdits().catch(() => {});
    }
  })();

  // Concurrently run 5 document writers
  const writers = Array.from({ length: numDocs }, async (_, docIdx) => {
    const docId = `burst-multi-${docIdx}`;
    for (let u = 1; u <= updatesPerDoc; u++) {
      await repo.saveDocument({
        id: docId,
        title: `Burst Doc ${docIdx}`,
        content: `Document ${docIdx} revision ${u} - payload size ${u * 10}`,
      });
    }
  });

  await Promise.all(writers);
  stopFlushing = true;
  await backgroundFlusher;

  // Final flush to catch any tail mutations
  await repo.flushPendingEdits();

  // Verify each document in SQLite matches the final 200th revision
  for (let docIdx = 0; docIdx < numDocs; docIdx++) {
    const docId = `burst-multi-${docIdx}`;
    const memDoc = await repo.getDocument(docId);
    assert.ok(memDoc);
    assert.strictEqual(memDoc.version_vector, updatesPerDoc);

    const dbRows = await db.executeSql<any>(
      'SELECT content, version_vector FROM documents WHERE id = ?;',
      [docId]
    );
    assert.strictEqual(dbRows.length, 1);
    assert.strictEqual(dbRows[0].version_vector, updatesPerDoc, `Version vector for doc ${docIdx} must be ${updatesPerDoc}`);
    assert.strictEqual(
      dbRows[0].content,
      `Document ${docIdx} revision ${updatesPerDoc} - payload size ${updatesPerDoc * 10}`,
      `Content for doc ${docIdx} must match the final revision`
    );
  }

  repo.destroy();
  await db.close();
});
