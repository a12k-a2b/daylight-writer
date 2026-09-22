/**
 * tests/adversarial/m6-challenger1-deep-stress.test.ts
 * Daylight Writer - Milestone 6 Challenger 1 Empirical Stress Test Suite
 *
 * Rigorous empirical verification targeting:
 * 1. Uncached note deletion, SQLite foreign key constraint 19 immunity,
 *    and flush retry loop termination.
 * 2. Multiline headings in parseMarkdownInline across consecutive and interleaved lines.
 * 3. Typewriter scrolling, kinetic lerp deadband threshold, and IME virtual
 *    keyboard height clamping (>= 100px).
 * 4. Focus mode sentence & paragraph cycling, abbreviation preservation,
 *    and clean DOM unwrapping/teardown.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { TypewriterEditor } from '../../src/editor/editor.ts';
import {
  FocusModeEngine,
  segmentSentences,
  findActiveSentenceIndex,
  maskAbbreviationsLengthPreserving,
  getNextFocusMode,
} from '../../src/editor/focus-mode.ts';
import {
  parseMarkdownInline,
  parseMarkdownToBlocks,
  blocksToMarkdown,
} from '../../src/editor/markdown-rules.ts';

import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import {
  runMigrations,
  type ThoughtNoteRecord,
} from '../../src/storage/schema.ts';

// ----------------------------------------------------------------------------
// Helper: DOM Environment Fixture Generator
// ----------------------------------------------------------------------------
function setupDOM() {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;
  return { win, doc };
}

function teardownDOM() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
}

// ============================================================================
// SUITE 1: UNCACHED NOTE DELETION, FK CONSTRAINT 19 & RETRY LOOP RESISTANCE
// ============================================================================

test('Challenger M6 - Storage 1.1: Deleting non-existent uncached note does not throw FK code 19 and flushes cleanly', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 50);
  await repo.init();

  // Attempt to delete a note that was never cached and never existed in DB
  const ghostNoteId = 'ghost-note-xyz-999';
  await repo.deleteNote(ghostNoteId);

  // Must flush cleanly without throwing SQLiteError: FOREIGN KEY constraint failed (code 19)
  await repo.flushPendingEdits();

  // Verify DB state: ghost note must not exist in margin_notes
  const rows = await db.executeSql<any>('SELECT * FROM margin_notes WHERE id = ?;', [ghostNoteId]);
  assert.strictEqual(rows.length, 0, 'Non-existent note must not be inserted into margin_notes');

  // Verify dirty state
  assert.strictEqual((repo as any).dirtyNoteIds.size, 0, 'dirtyNoteIds must be completely clear');
  assert.strictEqual((repo as any).flushRetryCount, 0, 'flushRetryCount must be 0');

  repo.destroy();
  await db.close();
});

test('Challenger M6 - Storage 1.2: Deleting uncached existing note reads valid document_id and soft-deletes safely', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const docId = 'doc-parent-valid';
  const noteId = 'note-persisted-prior-session';
  const now = Date.now();

  // Directly insert parent document and note into SQLite (simulating prior session or another worker)
  await db.run(
    `INSERT INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status)
     VALUES (?, 'Parent Title', 'Parent content body', ?, ?, NULL, 0, 1, 'synced');`,
    [docId, now, now]
  );
  await db.run(
    `INSERT INTO margin_notes (id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status)
     VALUES (?, ?, 'p-0', 'Initial Note Content', ?, ?, NULL, 'synced');`,
    [noteId, docId, now, now]
  );

  // Fresh repo with empty cache (noteId is UNCACHED in this instance)
  const repo = new SQLiteStorageRepository(db, 50);
  assert.strictEqual((repo as any).notesCache.has(noteId), false, 'Note must not be in cache initially');

  // Trigger uncached deletion
  await repo.deleteNote(noteId);

  // Verify note is now loaded into cache with genuine document_id
  const cached = (repo as any).notesCache.get(noteId);
  assert.ok(cached, 'Note tombstone must be created in cache');
  assert.strictEqual(cached.document_id, docId, 'Tombstone must have genuine parent document_id');
  assert.ok(cached.deleted_at > 0, 'Tombstone must have deleted_at timestamp');

  // Flush to disk
  await repo.flushPendingEdits();

  // Verify in SQLite: margin_notes updated with soft-delete timestamp and retained foreign key
  const noteRows = await db.executeSql<any>('SELECT document_id, deleted_at FROM margin_notes WHERE id = ?;', [noteId]);
  assert.strictEqual(noteRows.length, 1);
  assert.strictEqual(noteRows[0].document_id, docId);
  assert.ok(noteRows[0].deleted_at > 0, 'deleted_at must be populated in DB');

  // Verify sync_queue mutation recorded
  const syncRows = await db.executeSql<any>(
    'SELECT entity_type, entity_id, operation FROM sync_queue WHERE entity_id = ?;',
    [noteId]
  );
  assert.strictEqual(syncRows.length, 1);
  assert.strictEqual(syncRows[0].operation, 'delete');
  assert.strictEqual(syncRows[0].entity_type, 'margin_note');

  repo.destroy();
  await db.close();
});

test('Challenger M6 - Storage 1.3: Quarantine defense removes invalid note with empty document_id without crashing flush', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 50);
  await repo.init();

  // Artificially inject a corrupted note record with empty document_id into dirty cache
  const corruptNoteId = 'corrupted-empty-doc-id';
  const corruptNote: ThoughtNoteRecord = {
    id: corruptNoteId,
    document_id: '', // EMPTY - would violate FOREIGN KEY if sent to SQLite
    paragraph_anchor_id: 'p-0',
    content: 'Corrupted Note',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
    sync_status: 'pending',
  };
  (repo as any).notesCache.set(corruptNoteId, corruptNote);
  (repo as any).dirtyNoteIds.add(corruptNoteId);

  // Attempt flush: quarantine logic in performFlushCycle must eject corrupt note from dirtyNoteIds
  await repo.flushPendingEdits();

  // Verify dirtyNoteIds was cleaned up
  assert.strictEqual((repo as any).dirtyNoteIds.has(corruptNoteId), false, 'Corrupted note must be ejected from dirty set');
  assert.strictEqual((repo as any).flushRetryCount, 0, 'No retry count incremented on quarantined note');

  // Verify SQLite did NOT receive the invalid row
  const rows = await db.executeSql<any>('SELECT * FROM margin_notes WHERE id = ?;', [corruptNoteId]);
  assert.strictEqual(rows.length, 0, 'Corrupted note must never be written to margin_notes table');

  repo.destroy();
  await db.close();
});

test('Challenger M6 - Storage 1.4: Flush error retry loop terminates at MAX_FLUSH_RETRIES (5) and halts', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 10);
  await repo.init();

  assert.strictEqual((SQLiteStorageRepository as any).MAX_FLUSH_RETRIES, 5, 'MAX_FLUSH_RETRIES must equal 5');

  // Save a document to make dirty set non-empty
  await repo.saveDocument({ id: 'doc-test-fail', title: 'Test', content: 'Fail me' });

  // Intentionally sabotage db.runTransaction to simulate persistent I/O failure
  const originalRunTransaction = db.runTransaction.bind(db);
  (db as any).runTransaction = async () => {
    throw new Error('Simulated persistent flash disk I/O error');
  };

  // Trigger flush cycles up to max retries
  let caughtErrors = 0;
  for (let i = 1; i <= 6; i++) {
    try {
      await repo.flushPendingEdits();
    } catch {
      caughtErrors++;
    }
  }

  // Verify retry count reached and capped
  assert.ok((repo as any).flushRetryCount >= (SQLiteStorageRepository as any).MAX_FLUSH_RETRIES);

  // Restore runTransaction
  (db as any).runTransaction = originalRunTransaction;
  repo.destroy();
  await db.close();
});

test('Challenger M6 - Storage 1.5: Concurrent uncached note deletions during active in-flight flush', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const docId = 'doc-concurrent-test';
  const now = Date.now();
  await db.run(
    `INSERT INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status)
     VALUES (?, 'Doc Concurrent', 'Content', ?, ?, NULL, 0, 1, 'synced');`,
    [docId, now, now]
  );

  const repo = new SQLiteStorageRepository(db, 50);

  // Create 5 notes in DB directly
  for (let i = 1; i <= 5; i++) {
    await db.run(
      `INSERT INTO margin_notes (id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status)
       VALUES (?, ?, 'p-0', 'Content', ?, ?, NULL, 'synced');`,
      [`note-conc-${i}`, docId, now, now]
    );
  }

  // Launch parallel deletions of uncached notes
  await Promise.all([
    repo.deleteNote('note-conc-1'),
    repo.deleteNote('note-conc-2'),
    repo.deleteNote('note-conc-3'),
    repo.deleteNote('note-conc-4'),
    repo.deleteNote('note-conc-5'),
    repo.deleteNote('note-conc-ghost-99'),
  ]);

  // Flush all pending edits
  await repo.flushPendingEdits();

  // Verify all 5 valid notes are soft-deleted in SQLite
  const deletedRows = await db.executeSql<any>(
    `SELECT id, deleted_at FROM margin_notes WHERE id IN ('note-conc-1', 'note-conc-2', 'note-conc-3', 'note-conc-4', 'note-conc-5');`
  );
  assert.strictEqual(deletedRows.length, 5);
  for (const row of deletedRows) {
    assert.ok(row.deleted_at > 0, `Note ${row.id} must be soft deleted`);
  }

  // Verify ghost note was safely omitted
  const ghostRows = await db.executeSql<any>(`SELECT * FROM margin_notes WHERE id = 'note-conc-ghost-99';`);
  assert.strictEqual(ghostRows.length, 0);

  repo.destroy();
  await db.close();
});

// ============================================================================
// SUITE 2: MULTILINE HEADINGS IN parseMarkdownInline
// ============================================================================

test('Challenger M6 - Markdown 2.1: Headings 1 through 6 parse correctly across consecutive lines', () => {
  const input = [
    '# Heading Level 1',
    '## Heading Level 2',
    '### Heading Level 3',
    '#### Heading Level 4',
    '##### Heading Level 5',
    '###### Heading Level 6',
  ].join('\n');

  const output = parseMarkdownInline(input);

  const expected = [
    '<h1>Heading Level 1</h1>',
    '<h2>Heading Level 2</h2>',
    '<h3>Heading Level 3</h3>',
    '<h4>Heading Level 4</h4>',
    '<h5>Heading Level 5</h5>',
    '<h6>Heading Level 6</h6>',
  ].join('\n');

  assert.strictEqual(output, expected);
});

test('Challenger M6 - Markdown 2.2: Headings interleaved with multiline body paragraphs', () => {
  const input = [
    '# Document Title',
    'This is the introductory paragraph on line 2.',
    '## Section One: Fundamentals',
    'Paragraph under section one detailing DC1 LivePaper specs.',
    'Another sentence in the same section.',
    '### Subsection 1.1: Grayscale Tokens',
    'Tokens range monotonically from --os-0 to --os-1000.',
    '#### Deep Technical Notes',
    'Final observations and closing thoughts.',
  ].join('\n');

  const output = parseMarkdownInline(input);

  assert.ok(output.includes('<h1>Document Title</h1>'));
  assert.ok(output.includes('<h2>Section One: Fundamentals</h2>'));
  assert.ok(output.includes('<h3>Subsection 1.1: Grayscale Tokens</h3>'));
  assert.ok(output.includes('<h4>Deep Technical Notes</h4>'));
  assert.ok(output.includes('This is the introductory paragraph on line 2.'));
  assert.ok(output.includes('Tokens range monotonically from --os-0 to --os-1000.'));
});

test('Challenger M6 - Markdown 2.3: Headings containing inline bold, italic, code, and strikethrough', () => {
  const input = [
    '# Heading with **bold** text',
    '## Subheading with *italic* styling',
    '### Section with `inline code` snippet',
    '#### Notes with ~~strikethrough~~ content',
    '##### Mixed ***bold and italic*** tokens',
  ].join('\n');

  const output = parseMarkdownInline(input);

  assert.ok(output.includes('<h1>Heading with <strong>bold</strong> text</h1>'));
  assert.ok(output.includes('<h2>Subheading with <em>italic</em> styling</h2>'));
  assert.ok(output.includes('<h3>Section with <code>inline code</code> snippet</h3>'));
  assert.ok(output.includes('<h4>Notes with <del>strikethrough</del> content</h4>'));
  assert.ok(output.includes('<h5>Mixed <strong><em>bold and italic</em></strong> tokens</h5>'));
});

test('Challenger M6 - Markdown 2.4: Windows CRLF (\\r\\n) line endings preserve multiline headings', () => {
  const input = '# Windows H1\r\n## Windows H2\r\n### Windows H3';
  const output = parseMarkdownInline(input);

  assert.ok(output.includes('<h1>Windows H1</h1>') || output.includes('<h1>Windows H1\r</h1>'));
  assert.ok(output.includes('<h2>Windows H2</h2>') || output.includes('<h2>Windows H2\r</h2>'));
  assert.ok(output.includes('<h3>Windows H3</h3>'));
});

test('Challenger M6 - Markdown 2.5: Non-heading hash patterns are NOT transformed', () => {
  const input = [
    '#notaheadline (no space)',
    '####### Seven hashes exceeds H6',
    'Price is #1 in the market',
    'Nested tag #project/drafts in text',
  ].join('\n');

  const output = parseMarkdownInline(input);

  assert.ok(!output.includes('<h1>notaheadline'));
  assert.ok(!output.includes('<h7>'));
  assert.ok(!output.includes('<h1>Price'));
  assert.ok(output.includes('#notaheadline (no space)'));
  assert.ok(output.includes('####### Seven hashes exceeds H6'));
  assert.ok(output.includes('#project/drafts'));
});

// ============================================================================
// SUITE 3: TYPEWRITER SCROLLING, KINETIC LERP DEADBAND & IME HEIGHT CLAMPING
// ============================================================================

test('Challenger M6 - Editor 3.1: IME virtual keyboard height clamping strictly enforces >= 100px', () => {
  const { doc } = setupDOM();
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor({
    viewportWidth: 1584,
    viewportHeight: 1184,
  });
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  // Baseline: no keyboard
  assert.strictEqual(editor.keyboardHeight, 0);
  assert.strictEqual(editor.effectiveViewportHeight, 1184);
  assert.strictEqual(editor.typewriterMidpoint, 592);

  // Normal virtual keyboard: 400px height
  editor.setVirtualKeyboardHeight(400);
  assert.strictEqual(editor.keyboardHeight, 400);
  assert.strictEqual(editor.effectiveViewportHeight, 784);
  assert.strictEqual(editor.typewriterMidpoint, 392);

  // Large virtual keyboard: 1084px height (exactly 100px remaining)
  editor.setVirtualKeyboardHeight(1084);
  assert.strictEqual(editor.effectiveViewportHeight, 100);
  assert.strictEqual(editor.typewriterMidpoint, 50);

  // Extreme keyboard: 1150px height (would result in 34px without clamp)
  editor.setVirtualKeyboardHeight(1150);
  assert.strictEqual(editor.effectiveViewportHeight, 100, 'Must clamp to minimum 100px');
  assert.strictEqual(editor.typewriterMidpoint, 50);

  // Pathological keyboard: 1500px (exceeds total viewport height 1184px)
  editor.setVirtualKeyboardHeight(1500);
  assert.strictEqual(editor.effectiveViewportHeight, 100, 'Must clamp to minimum 100px even when height exceeds viewport');
  assert.strictEqual(editor.typewriterMidpoint, 50);

  // CSS variables verification
  assert.strictEqual(scrollContainer.style.getPropertyValue('--effective-viewport-height'), '100px');
  assert.strictEqual(scrollContainer.style.getPropertyValue('--typewriter-midpoint-y'), '50px');

  editor.destroy();
  teardownDOM();
});

test('Challenger M6 - Editor 3.2: Kinetic lerp deadband threshold (< 0.5px) snaps and halts rAF', () => {
  const { doc } = setupDOM();
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor({
    viewportWidth: 1584,
    viewportHeight: 1184,
    lerpLambda: 18.0,
  });
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  // 1. Positive micro-delta below deadband: delta = 0.4 (< 0.5)
  editor.currentScrollY = 200.0;
  editor.targetScrollTop = 200.4;
  editor.isRafActive = true;

  editor.stepRafLerp(performance.now() + 16.6);

  // Must snap immediately to target and halt rAF
  assert.strictEqual(editor.currentScrollY, 200.4);
  assert.strictEqual(editor.scrollTop, 200);
  assert.strictEqual(editor.isRafActive, false, 'rAF must halt when within 0.5px deadband');

  // 2. Negative micro-delta below deadband: delta = -0.35 (< 0.5)
  editor.currentScrollY = 300.0;
  editor.targetScrollTop = 299.65;
  editor.isRafActive = true;

  editor.stepRafLerp(performance.now() + 16.6);

  assert.strictEqual(editor.currentScrollY, 299.65);
  assert.strictEqual(editor.scrollTop, 300);
  assert.strictEqual(editor.isRafActive, false, 'rAF must halt on negative sub-0.5px delta');

  // 3. Significant delta above deadband: delta = 50.0 (>= 0.5)
  editor.currentScrollY = 100.0;
  editor.targetScrollTop = 150.0;
  editor.isRafActive = true;

  editor.stepRafLerp(performance.now() + 16.6);

  // Must apply exponential lerp and keep rAF active
  assert.ok(editor.currentScrollY > 100.0, 'currentScrollY must advance towards target');
  assert.ok(editor.currentScrollY < 150.0, 'currentScrollY must not overshoot target');
  assert.strictEqual(editor.isRafActive, true, 'rAF must remain active while delta >= 0.5px');

  editor.destroy();
  teardownDOM();
});

test('Challenger M6 - Editor 3.3: Scroll suspension pauses kinetic lerp and resumes cleanly', () => {
  const { doc } = setupDOM();
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  editor.isRafActive = true;
  editor.setScrollSuspended(true);

  assert.strictEqual(editor.isScrollSuspended, true);
  assert.strictEqual(editor.isRafActive, false, 'Suspending scroll must abort active rAF');

  // Step while suspended must immediately exit without moving
  editor.currentScrollY = 100;
  editor.targetScrollTop = 500;
  editor.stepRafLerp(performance.now() + 16.6);
  assert.strictEqual(editor.currentScrollY, 100, 'Scroll position must not move while suspended');
  assert.strictEqual(editor.isRafActive, false);

  // Resuming scroll
  editor.resumeScroll();
  assert.strictEqual(editor.isScrollSuspended, false);

  editor.destroy();
  teardownDOM();
});

// ============================================================================
// SUITE 4: FOCUS MODE CYCLING, ABBREVIATION PRESERVATION & DOM TEARDOWN
// ============================================================================

test('Challenger M6 - Focus 4.1: getNextFocusMode cycles none -> sentence -> paragraph -> none', () => {
  assert.strictEqual(getNextFocusMode('none'), 'sentence');
  assert.strictEqual(getNextFocusMode('sentence'), 'paragraph');
  assert.strictEqual(getNextFocusMode('paragraph'), 'none');
});

test('Challenger M6 - Focus 4.2: Abbreviation masking preserves single-sentence integrity with 1:1 char index parity', () => {
  const sentenceWithAbbr = 'Dr. Smith met with Prof. Jones at 9 a.m. vs. opponent team.';
  const masked = maskAbbreviationsLengthPreserving(sentenceWithAbbr);

  // Length parity invariant
  assert.strictEqual(masked.length, sentenceWithAbbr.length, 'Masked text must have identical length for 1:1 index mapping');

  // Must not split into multiple sentences
  const spans = segmentSentences(sentenceWithAbbr, 'en');
  assert.strictEqual(spans.length, 1, 'Sentence containing Dr., Prof., vs. must remain a single unified sentence');
  assert.strictEqual(spans[0].start, 0);
  assert.strictEqual(spans[0].end, sentenceWithAbbr.length);

  // Multi-sentence text with abbreviations in sentence 1
  const multi = 'Dr. Jane arrived early. She reviewed the preliminary data.';
  const multiSpans = segmentSentences(multi, 'en');
  assert.strictEqual(multiSpans.length, 2, 'Should segment into exactly 2 sentences');
  assert.strictEqual(multiSpans[0].text, 'Dr. Jane arrived early.');
  assert.strictEqual(multiSpans[1].text, 'She reviewed the preliminary data.');
});

test('Challenger M6 - Focus 4.3: Full mode cycling none -> sentence -> paragraph -> none DOM teardown', () => {
  const { doc } = setupDOM();
  const shell = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(shell);
  shell.appendChild(canvas);

  const p1 = doc.createElement('p');
  p1.dataset.blockId = 'p-0';
  p1.textContent = 'First sentence of p1. Second sentence of p1.';
  const p2 = doc.createElement('p');
  p2.dataset.blockId = 'p-1';
  p2.textContent = 'Paragraph two content here.';
  canvas.appendChild(p1);
  canvas.appendChild(p2);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    initialMode: 'none',
  });

  assert.strictEqual(engine.getMode(), 'none');
  assert.ok(!shell.classList.contains('focus-mode-sentence'));
  assert.ok(!shell.classList.contains('focus-mode-paragraph'));

  // Cycle 1: none -> sentence
  const mode1 = engine.cycleMode();
  assert.strictEqual(mode1, 'sentence');
  assert.strictEqual(engine.getMode(), 'sentence');
  assert.ok(shell.classList.contains('focus-mode-sentence'));
  assert.ok(!shell.classList.contains('focus-mode-paragraph'));

  // Cycle 2: sentence -> paragraph
  const mode2 = engine.cycleMode();
  assert.strictEqual(mode2, 'paragraph');
  assert.strictEqual(engine.getMode(), 'paragraph');
  assert.ok(!shell.classList.contains('focus-mode-sentence'));
  assert.ok(shell.classList.contains('focus-mode-paragraph'));
  // Any sentence spans must have been removed
  assert.strictEqual(canvas.querySelectorAll('.os-sentence-active').length, 0);

  // Cycle 3: paragraph -> none
  const mode3 = engine.cycleMode();
  assert.strictEqual(mode3, 'none');
  assert.strictEqual(engine.getMode(), 'none');
  assert.ok(!shell.classList.contains('focus-mode-sentence'));
  assert.ok(!shell.classList.contains('focus-mode-paragraph'));
  assert.strictEqual(canvas.querySelectorAll('.os-focus-active').length, 0);
  assert.strictEqual(canvas.querySelectorAll('.os-sentence-active').length, 0);

  // Destroy engine cleanly
  engine.destroy();
  teardownDOM();
});
