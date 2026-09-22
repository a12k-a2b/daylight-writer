/**
 * tests/adversarial/tier5-ai-sync-export-hardening.test.ts
 * Daylight Writer - Tier 5 White-Box Adversarial Hardening Suite
 *
 * White-box coverage analysis and stress hardening targeting:
 * 1. src/ai/ (AIServiceAdapter, MockAIServiceAdapter, CommandPalette, CritiqueEngine, ContextAssistant, InlineContinuation)
 * 2. src/sync/ (SyncAdapter, MockGoogleDocsSyncAdapter, OfflineMutationQueue, NetworkListener, SyncStatusIndicator)
 * 3. src/export/ (ExportService, ZipBuilder, MarkdownExporter, PlainTextExporter, DocxExporter, PdfExporter, ShareService)
 * 4. Sol:OS tokens & contrast rules (tokens.css, contrast-verifier.ts)
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display (1584×1184 landscape)
 * Hardware Profile: 8-bit grayscale, 60-120Hz native refresh, zero EPD waveforms / flashes.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

// AI Subsystem Imports
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import {
  InlineContinuationEngine,
  detectContinuationTrigger,
} from '../../src/ai/inline-continuation.ts';
import {
  CommandPalette,
  BUILT_IN_ACTIONS,
  EXPORT_COMMANDS,
  type SelectionAnchorRect,
} from '../../src/ai/command-palette.ts';
import {
  CritiqueAnalyzer,
  PassiveVoiceRule,
  ClarityWordinessRule,
  RepetitionRule,
  ComplexityRule,
  DEFAULT_CRITIQUE_RULES,
} from '../../src/ai/critique-engine.ts';
import { ContextAssistant } from '../../src/ai/context-assistant.ts';

// Sync Subsystem Imports
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { NetworkListener } from '../../src/sync/network-listener.ts';
import { SyncStatusIndicator } from '../../src/ui/sync-status-indicator.ts';
import type { SyncMutation, SyncStatus } from '../../src/sync/sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type DocumentRecord, type ThoughtNoteRecord } from '../../src/storage/schema.ts';

// Export Subsystem Imports
import { ExportService } from '../../src/export/export-service.ts';
import {
  exportToMarkdown,
  sanitizeFilename,
  extractAnchorIndex,
  formatNoteAnchorLabel,
  sortThoughtNotes,
  UNANCHORED_INDEX,
} from '../../src/export/markdown-exporter.ts';
import {
  exportToPlainText,
  stripMarkdownFormatting,
} from '../../src/export/plain-text-exporter.ts';
import {
  exportToDocx,
  escapeXml,
  buildContentTypesXml,
  buildPackageRelsXml,
  buildDocumentRelsXml,
  buildStylesXml,
} from '../../src/export/docx-exporter.ts';
import {
  exportToPdf,
  VectorPdfBuilder,
} from '../../src/export/pdf-exporter.ts';
import { crc32, buildZipArchive } from '../../src/export/zip-builder.ts';
import { ShareService } from '../../src/export/share-service.ts';

// Sol:OS Contrast & Token Imports
import {
  SOL_OS_PALETTE,
  calculateContrastRatio,
  checkMonochromePurity,
  auditElementStyle,
  parseColor,
  relativeLuminance,
} from '../e2e/helpers/contrast-verifier.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';
import { HistoryManager } from '../../src/editor/history.ts';

// Helper: isolated in-memory SQLite database
async function createTestSqliteDb(): Promise<SqliteDatabase> {
  const db = await SqliteDatabase.open({
    vfsPreference: 'memory',
    dbName: `tier5_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`,
  });
  await runMigrations(db);
  return db;
}

// ============================================================================
// SUITE 1: AI SUBSYSTEM WHITE-BOX COVERAGE & HARDENING
// ============================================================================

test('AI-01: MockAIServiceAdapter - streamCompletion handles pre-aborted signal immediately', async () => {
  const adapter = new MockAIServiceAdapter();
  const controller = new AbortController();
  controller.abort(); // Pre-aborted

  let chunkCount = 0;
  const result = await adapter.streamCompletion(
    {
      documentText: 'Hello world',
      cursorOffset: 11,
      signal: controller.signal,
    },
    () => {
      chunkCount++;
    }
  );

  assert.strictEqual(result, '', 'Must return empty string when pre-aborted');
  assert.strictEqual(chunkCount, 0, 'Must not emit any chunks when pre-aborted');
  assert.strictEqual(adapter.callLog.length, 1);
});

test('AI-02: MockAIServiceAdapter - streamCompletion handles mid-flight signal abort during streaming', async () => {
  const adapter = new MockAIServiceAdapter({
    cannedContinuationText: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
    simulatedDelayMs: 5,
  });
  const controller = new AbortController();

  let chunksReceived: string[] = [];
  const streamPromise = adapter.streamCompletion(
    {
      documentText: 'Test text',
      cursorOffset: 9,
      signal: controller.signal,
    },
    (chunk) => {
      chunksReceived.push(chunk);
      if (chunksReceived.length === 3) {
        controller.abort(); // Abort mid-flight after 3 chunks
      }
    }
  );

  const finalResult = await streamPromise;
  assert.ok(chunksReceived.length >= 3, 'Should have received at least 3 chunks before abort');
  assert.ok(
    chunksReceived.length < 10,
    `Should stop streaming early, but got ${chunksReceived.length} chunks`
  );
  assert.ok(finalResult.length > 0, 'Should return the accumulated text up to abort');
});

test('AI-03: MockAIServiceAdapter - complete respects aborted signal and returns empty string', async () => {
  const adapter = new MockAIServiceAdapter();
  const controller = new AbortController();
  controller.abort();

  const result = await adapter.complete({
    documentText: 'Existing text',
    cursorOffset: 13,
    signal: controller.signal,
  });

  assert.strictEqual(result, '');
});

test('AI-04: MockAIServiceAdapter - transformText matrix coverage across all instructions', async () => {
  const adapter = new MockAIServiceAdapter();
  const sample = 'The very quiet lake was written by nature.';

  // 1. summarize
  const sum = await adapter.transformText({ selectedText: sample, instruction: 'summarize' });
  assert.ok(sum.startsWith('Summary: '));

  // 2. expand
  const exp = await adapter.transformText({ selectedText: sample, instruction: 'expand' });
  assert.ok(exp.includes('This insight reveals'));

  // 3. concise
  const con = await adapter.transformText({
    selectedText: 'She was very really quite extremely happy.',
    instruction: 'concise',
  });
  assert.strictEqual(con, 'She was happy.');

  // 4. poetic
  const poe = await adapter.transformText({ selectedText: sample, instruction: 'poetic' });
  assert.ok(poe.startsWith('Like quiet amber light upon paper: '));

  // 5. analytical
  const ana = await adapter.transformText({ selectedText: 'A Great Discovery', instruction: 'analytical' });
  assert.ok(ana.startsWith('Empirical observation reveals: a great discovery'));

  // 6. casual
  const cas = await adapter.transformText({ selectedText: 'Important finding', instruction: 'casual' });
  assert.ok(cas.startsWith('Basically, important finding'));

  // 7. fix_grammar
  const gr1 = await adapter.transformText({
    selectedText: 'The the essay was written by the student.',
    instruction: 'fix_grammar',
  });
  assert.strictEqual(gr1, 'The essay wrote the student.');

  // 8. custom with prompt
  const cust1 = await adapter.transformText({
    selectedText: 'Sample text',
    instruction: 'custom',
    customPrompt: 'make it dramatic',
  });
  assert.strictEqual(cust1, '[Transformed per "make it dramatic"]: Sample text');

  // 9. custom with missing prompt
  const cust2 = await adapter.transformText({
    selectedText: 'Sample text',
    instruction: 'custom',
  });
  assert.strictEqual(cust2, '[Transformed per ""]: Sample text');

  // 10. fallback default for unknown instruction
  const def = await adapter.transformText({
    selectedText: 'Unchanged text',
    instruction: 'unknown_instruction' as any,
  });
  assert.strictEqual(def, 'Unchanged text');
});

test('AI-05: MockAIServiceAdapter - cannedTransforms override hook and error handling', async () => {
  const adapter = new MockAIServiceAdapter();
  adapter.cannedTransforms['poetic'] = (text) => `***${text.toUpperCase()}***`;

  const transformed = await adapter.transformText({
    selectedText: 'twilight',
    instruction: 'poetic',
  });
  assert.strictEqual(transformed, '***TWILIGHT***');

  // Error simulation
  adapter.shouldFail = true;
  adapter.errorMessage = 'AI Cloud Quota Exceeded';
  await assert.rejects(
    async () => {
      await adapter.transformText({ selectedText: 'text', instruction: 'summarize' });
    },
    { message: 'AI Cloud Quota Exceeded' }
  );
});

test('AI-06: MockAIServiceAdapter - queryContext handles both string document and AIContext object', async () => {
  const adapter = new MockAIServiceAdapter();

  // Passing string doc and notes
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-1',
      content: 'Core argument on stillness',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
  ];

  const ans1 = await adapter.queryContext('What is the core argument?', 'Document body', notes);
  assert.ok(ans1.includes('[Note:p-1]'));
  assert.ok(ans1.includes('[¶1]'));

  // Passing AIContext object
  const ans2 = await adapter.queryContext('Query prompt', {
    documentText: 'Document text here',
    marginNotes: notes,
  });
  assert.ok(ans2.includes('[Note:p-1]'));

  // Passing AIContext with empty notes
  const ans3 = await adapter.queryContext('Query prompt', {
    documentText: 'Document text here',
    marginNotes: [],
  });
  assert.ok(!ans3.includes('[Note:'));
});

test('AI-07: InlineContinuationEngine - detectContinuationTrigger boundary cases', () => {
  // Exact trigger
  assert.deepStrictEqual(detectContinuationTrigger('+++'), {
    triggered: true,
    strippedBuffer: '',
  });

  // Leading text before trigger
  assert.deepStrictEqual(detectContinuationTrigger('Silence descended+++'), {
    triggered: true,
    strippedBuffer: 'Silence descended',
  });

  // Four pluses: buffer ends with +++, stripped leaves the first +
  assert.deepStrictEqual(detectContinuationTrigger('++++'), {
    triggered: true,
    strippedBuffer: '+',
  });

  // Multiline buffer ending in +++
  assert.deepStrictEqual(detectContinuationTrigger('First line\nSecond line+++'), {
    triggered: true,
    strippedBuffer: 'First line\nSecond line',
  });

  // Non-matching inputs
  assert.strictEqual(detectContinuationTrigger('').triggered, false);
  assert.strictEqual(detectContinuationTrigger('+').triggered, false);
  assert.strictEqual(detectContinuationTrigger('++').triggered, false);
  assert.strictEqual(detectContinuationTrigger('+++after').triggered, false);
  assert.strictEqual(detectContinuationTrigger('+++ ').triggered, false);
});

test('AI-08: CommandPalette - calculatePalettePosition boundary clamping & upward flip', () => {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;

  const dummyEditor = {} as any;
  const dummyHistory = {} as any;
  const dummyAi = new MockAIServiceAdapter();

  const palette = new CommandPalette({
    editor: dummyEditor,
    history: dummyHistory,
    aiAdapter: dummyAi,
    shellElement: doc.body as any,
  });

  palette.viewportWidth = 1584;
  palette.viewportHeight = 1184;
  palette.paletteWidth = 320;
  palette.paletteHeight = 240;

  // 1. Center of screen: sits 8px below selection
  const centerRect: SelectionAnchorRect = { left: 700, top: 500, right: 800, bottom: 530, width: 100, height: 30 };
  const posCenter = palette.calculatePalettePosition(centerRect);
  assert.strictEqual(posCenter.flipped, false);
  assert.strictEqual(posCenter.top, 538); // 530 + 8
  assert.strictEqual(posCenter.left, 590); // 700 + 50 - 160

  // 2. Far left edge clamp (should not go < 16px)
  const leftRect: SelectionAnchorRect = { left: 5, top: 300, right: 25, bottom: 330, width: 20, height: 30 };
  const posLeft = palette.calculatePalettePosition(leftRect);
  assert.strictEqual(posLeft.left, 16, 'Should clamp left edge to 16px');

  // 3. Far right edge clamp (should not exceed 1584 - 320 - 16 = 1248px)
  const rightRect: SelectionAnchorRect = { left: 1550, top: 300, right: 1580, bottom: 330, width: 30, height: 30 };
  const posRight = palette.calculatePalettePosition(rightRect);
  assert.strictEqual(posRight.left, 1248, 'Should clamp right edge to 1248px');

  // 4. Bottom overflow triggers upward flip
  // vHeight = 1184; bottom safety buffer = 1184 - 24 = 1160
  // If bottom = 1000, top = 1000 + 8 = 1008; 1008 + 240 = 1248 > 1160 -> flips!
  const bottomRect: SelectionAnchorRect = { left: 700, top: 970, right: 800, bottom: 1000, width: 100, height: 30 };
  const posBottom = palette.calculatePalettePosition(bottomRect);
  assert.strictEqual(posBottom.flipped, true, 'Must flip upward near bottom edge');
  assert.strictEqual(posBottom.top, 970 - 240 - 8); // 722
});

test('AI-09: CommandPalette - computeDiff handles empty, identical, complete replacement, and XSS', () => {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  const palette = new CommandPalette({
    editor: {} as any,
    history: {} as any,
    aiAdapter: new MockAIServiceAdapter(),
    shellElement: doc.body as any,
  });

  // 1. Identical strings -> single equal chunk
  const diff1 = palette.computeDiff('identical words here', 'identical words here');
  assert.strictEqual(diff1.length, 1);
  assert.strictEqual(diff1[0].type, 'equal');
  assert.strictEqual(diff1[0].text, 'identical words here');

  // 2. Empty original -> single insert chunk
  const diff2 = palette.computeDiff('', 'new words');
  assert.strictEqual(diff2.length, 1);
  assert.strictEqual(diff2[0].type, 'insert');
  assert.strictEqual(diff2[0].text, 'new words');

  // 3. Empty replacement -> single delete chunk
  const diff3 = palette.computeDiff('old words', '');
  assert.strictEqual(diff3.length, 1);
  assert.strictEqual(diff3[0].type, 'delete');
  assert.strictEqual(diff3[0].text, 'old words');

  // 4. Hostile XSS injection tokens
  const hostileA = 'Normal text';
  const hostileB = 'Normal <script>alert(1)</script> text';
  const diff4 = palette.computeDiff(hostileA, hostileB);
  assert.ok(diff4.some((c) => c.type === 'insert' && c.text.includes('<script>')));

  // Invariant: concatenating equal + delete gives textA; concatenating equal + insert gives textB
  const reconA = diff4.filter((c) => c.type !== 'insert').map((c) => c.text).join('');
  const reconB = diff4.filter((c) => c.type !== 'delete').map((c) => c.text).join('');
  assert.strictEqual(reconA, hostileA);
  assert.strictEqual(reconB, hostileB);
});

test('AI-10: CritiqueAnalyzer - Rule suite coverage and multi-paragraph indexing', () => {
  const analyzer = new CritiqueAnalyzer(DEFAULT_CRITIQUE_RULES);

  const text = 'The report was written by the team in order to clarify the the findings.';
  const checks = analyzer.analyzeText(text, 0);

  // Should flag passive voice ("was written"), clarity ("in order to"), and repetition ("the the")
  const types = checks.map((c) => c.type);
  assert.ok(types.includes('passive_voice'), 'Must flag passive voice');
  assert.ok(types.includes('clarity'), 'Must flag clarity');
  assert.ok(types.includes('repetition'), 'Must flag repetition');

  // analyzeParagraphs multi-paragraph map
  const paraMap = analyzer.analyzeParagraphs([
    'Clean simple sentence.',
    'It was discovered by accident.',
  ]);
  assert.strictEqual(paraMap.get(0)?.length, 0);
  assert.ok((paraMap.get(1)?.length || 0) > 0);
});

test('AI-11: ContextAssistant - indexDocument and formatAnswerHtml with citation pills & XSS neutralization', () => {
  const assistant = new ContextAssistant();

  // Document indexing with pre-existing pilcrow tags vs plain paragraphs
  const docText = `
    [¶1] Opening thesis paragraph.

    Second unnumbered paragraph with multiple sentences.

    [¶5] Preserved jump paragraph.
  `;
  const indexed = assistant.indexDocument(docText);
  assert.strictEqual(indexed.length, 3);
  assert.strictEqual(indexed[0].label, '[¶1]');
  assert.strictEqual(indexed[1].label, '[¶2]');
  assert.strictEqual(indexed[2].label, '[¶5]');

  // formatAnswerHtml converts [¶N] and [Note:X] to buttons and escapes XSS
  const answer = {
    query: 'What is <script>alert(1)</script>?',
    response: 'Consult [¶2] and [Note:p-3] with <b>dangerous</b> tags.',
    citedParagraphs: ['[¶2]'],
    citedNotes: ['[Note:p-3]'],
    timestamp: Date.now(),
  };

  const formatted = assistant.formatAnswerHtml(answer);
  assert.ok(!formatted.includes('<script>'), 'Must escape script tags');
  assert.ok(formatted.includes('&lt;b&gt;dangerous&lt;/b&gt;'), 'Must escape HTML tags');
  assert.ok(formatted.includes('data-para-index="2"'), 'Must include paragraph button');
  assert.ok(formatted.includes('data-note-anchor="p-3"'), 'Must include note anchor button');
});

// ============================================================================
// SUITE 2: SYNC SUBSYSTEM WHITE-BOX COVERAGE & HARDENING
// ============================================================================

test('SYNC-01: MockGoogleDocsSyncAdapter - Failure modes 401, 429, and 503 error handling', async () => {
  const adapter = new MockGoogleDocsSyncAdapter({ simulatedLatencyMs: 0 });

  // 1. auth_expired
  adapter.setSimulatedFailure(true, 'auth_expired');
  await assert.rejects(
    async () => await adapter.sync(),
    /Google OAuth token expired \(401\)/
  );
  assert.strictEqual(adapter.getStatus().state, 'error');

  // 2. rate_limit
  adapter.setSimulatedFailure(true, 'rate_limit');
  await assert.rejects(
    async () => await adapter.sync(),
    /Google Drive API Rate limit exceeded \(429\)/
  );

  // 3. server_error
  adapter.setSimulatedFailure(true, 'server_error');
  await assert.rejects(
    async () => await adapter.sync(),
    /Internal Server Error \(503\)/
  );

  // 4. timeout
  adapter.setSimulatedFailure(true, 'timeout');
  await assert.rejects(
    async () => await adapter.sync(),
    /Network timeout/
  );
});

test('SYNC-02: MockGoogleDocsSyncAdapter - Offline guard and safe event emission with faulty listener', async () => {
  const adapter = new MockGoogleDocsSyncAdapter();
  adapter.setOnline(false);

  // Sync while offline returns {0, 0} immediately
  const res = await adapter.sync();
  assert.strictEqual(res.pushedCount, 0);
  assert.strictEqual(res.pulledCount, 0);
  assert.strictEqual(adapter.getStatus().state, 'offline');

  // Subscribe faulty listener that throws
  let goodListenerFired = false;
  adapter.subscribe(() => {
    throw new Error('Exploding listener');
  });
  adapter.subscribe(() => {
    goodListenerFired = true;
  });

  // Emitting event should not crash adapter or block the good listener
  adapter.setOnline(true);
  assert.strictEqual(goodListenerFired, true, 'Faulty listener must not prevent other listeners from executing');
});

test('SYNC-03: MockGoogleDocsSyncAdapter - Conflict resolution strategies and millisecond tie-breaker', async () => {
  const adapter = new MockGoogleDocsSyncAdapter();

  const localDoc: DocumentRecord = {
    id: 'doc-conflict',
    title: 'Local Title',
    content: 'Local Content',
    is_title_custom: true,
    format_version: 1,
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
    google_drive_file_id: 'gdoc-1',
    google_drive_revision_id: 'rev-1',
    sync_status: 'pending',
  };

  const remoteDoc: DocumentRecord = {
    id: 'doc-conflict',
    title: 'Remote Title',
    content: 'Remote Content',
    is_title_custom: true,
    format_version: 1,
    created_at: 1000,
    updated_at: 2000, // Exact timestamp tie!
    deleted_at: null,
    google_drive_file_id: 'gdoc-1',
    google_drive_revision_id: 'rev-2',
    sync_status: 'synced',
  };

  // 1. Exact tie (local.updated_at === remote.updated_at) -> local wins cleanly
  const tied = await adapter.resolveConflict(localDoc, remoteDoc, 'last-write-wins');
  assert.strictEqual(tied.title, 'Local Title');
  assert.strictEqual(tied.google_drive_revision_id, 'rev-2', 'Preserves remote revision ID');

  // 2. Local-wins strategy
  const localWon = await adapter.resolveConflict(
    { ...localDoc, updated_at: 1500 },
    { ...remoteDoc, updated_at: 3000 },
    'local-wins'
  );
  assert.strictEqual(localWon.title, 'Local Title');

  // 3. Remote-wins strategy
  const remoteWon = await adapter.resolveConflict(
    { ...localDoc, updated_at: 4000 },
    { ...remoteDoc, updated_at: 1000 },
    'remote-wins'
  );
  assert.strictEqual(remoteWon.title, 'Remote Title');
});

test('SYNC-04: OfflineMutationQueue - In-flight crash recovery resets stranded rows to pending', async () => {
  // Test both in-memory and SQLite-backed
  const memoryQueue = new OfflineMutationQueue(undefined);
  await memoryQueue.enqueue('document', 'doc-1', 'create', { title: 'Test' });

  // Simulate in_flight state
  const batchMem = await memoryQueue.acquireBatch(10);
  assert.strictEqual(batchMem.length, 1);
  assert.strictEqual(await memoryQueue.getPendingCount(), 0, 'Should be 0 pending while in_flight');

  // Recovery sweep restores it
  const recoveredMem = await memoryQueue.recoverInFlight();
  assert.strictEqual(recoveredMem, 1);
  assert.strictEqual(await memoryQueue.getPendingCount(), 1, 'Restored to pending');

  // Now SQLite-backed recovery
  const db = await createTestSqliteDb();
  const sqlQueue = new OfflineMutationQueue(db);
  await sqlQueue.enqueue('document', 'doc-2', 'create', { title: 'SQLite Doc' });

  const batchSql = await sqlQueue.acquireBatch(10);
  assert.strictEqual(batchSql.length, 1);
  assert.strictEqual(await sqlQueue.getPendingCount(), 0);

  const recoveredSql = await sqlQueue.recoverInFlight();
  assert.strictEqual(recoveredSql, 1);
  assert.strictEqual(await sqlQueue.getPendingCount(), 1);
});

test('SYNC-05: OfflineMutationQueue - Coalescing permutations (create+update, create+delete, update+delete)', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db);

  // 1. create + update -> stays 'create' with updated payload
  await queue.enqueue('document', 'doc-create-up', 'create', { title: 'Initial' });
  await queue.enqueue('document', 'doc-create-up', 'update', { title: 'Updated' });

  const rows1 = await queue.acquireBatch(10);
  assert.strictEqual(rows1.length, 1);
  assert.strictEqual(rows1[0].operation, 'create');
  assert.ok(rows1[0].payload.includes('Updated'));
  await queue.clear();

  // 2. create + delete -> both eliminated (never pushed to cloud)
  await queue.enqueue('document', 'doc-create-del', 'create', { title: 'Ephemeral' });
  await queue.enqueue('document', 'doc-create-del', 'delete', {});
  assert.strictEqual(await queue.getPendingCount(), 0, 'create + delete must be purged completely');

  // 3. update + delete -> becomes 'delete'
  await queue.enqueue('document', 'doc-up-del', 'update', { title: 'Mod 1' });
  await queue.enqueue('document', 'doc-up-del', 'delete', {});
  const rows3 = await queue.acquireBatch(10);
  assert.strictEqual(rows3.length, 1);
  assert.strictEqual(rows3[0].operation, 'delete');
});

test('SYNC-06: OfflineMutationQueue - Max retries transitions status to failed on rollback', async () => {
  const db = await createTestSqliteDb();
  const queue = new OfflineMutationQueue(db, { maxRetries: 2 });
  const adapter = new MockGoogleDocsSyncAdapter();
  adapter.setSimulatedFailure(true, 'timeout');

  await queue.enqueue('document', 'doc-retry-fail', 'create', { title: 'Fail Test' });

  // Drain attempt 1: failure -> retry_count = 1, status remains 'pending'
  await queue.drain(adapter);
  assert.strictEqual(await queue.getPendingCount(), 1);

  // Drain attempt 2: failure -> retry_count = 2 >= maxRetries -> status becomes 'failed'
  await queue.drain(adapter);
  assert.strictEqual(await queue.getPendingCount(), 0, 'No longer pending once failed');

  const failedRows = await db.executeSql<any>(
    `SELECT * FROM sync_queue WHERE entity_id = 'doc-retry-fail';`
  );
  assert.strictEqual(failedRows[0].status, 'failed');
  assert.strictEqual(failedRows[0].retry_count, 2);
});

test('SYNC-07: OfflineMutationQueue - Exponential backoff calculation bounds and jitter distribution', () => {
  const queue = new OfflineMutationQueue(undefined, {
    baseBackoffMs: 1000,
    maxBackoffMs: 16000,
  });

  for (let i = 0; i < 10; i++) {
    const delay = queue.calculateBackoffMs(i);
    assert.ok(delay >= 1000, `Delay ${delay} must be >= base 1000ms`);
    assert.ok(delay <= 16000 * 1.1 + 10, `Delay ${delay} must be bounded by max with jitter`);
  }
});

test('SYNC-08: SyncStatusIndicator - UI transitions and retry click handling', () => {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).document = doc;
  (globalThis as any).window = win;

  const container = doc.createElement('div');
  doc.body.appendChild(container);

  let retryClicked = false;
  const indicator = new SyncStatusIndicator(container as any, {
    onRetryClick: () => {
      retryClicked = true;
    },
  });

  // 1. Initial mounted state
  assert.strictEqual(indicator.element?.classList.contains('sync-state-synced'), true);

  // 2. Transition to syncing
  indicator.update({ state: 'syncing', lastSyncedAt: null, pendingCount: 3 });
  assert.strictEqual(indicator.element?.classList.contains('sync-state-syncing'), true);
  assert.strictEqual(indicator.labelEl?.textContent, 'Syncing...');

  // 3. Transition to offline
  indicator.update({ state: 'offline', lastSyncedAt: null, pendingCount: 2 });
  assert.strictEqual(indicator.element?.classList.contains('sync-state-offline'), true);
  assert.strictEqual(indicator.labelEl?.textContent, 'Offline (2)');

  // 4. Transition to error
  indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 1, error: 'Network timeout' });
  assert.strictEqual(indicator.element?.classList.contains('sync-state-error'), true);
  assert.strictEqual(indicator.labelEl?.textContent, 'Sync Error');

  // 5. Click in error state triggers retry callback
  indicator.element?.dispatchEvent(new win.MouseEvent('click') as any);
  assert.strictEqual(retryClicked, true, 'Clicking error pill must trigger retry callback');

  // 6. Click in synced state does NOT trigger retry callback
  retryClicked = false;
  indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0 });
  indicator.element?.dispatchEvent(new win.MouseEvent('click') as any);
  assert.strictEqual(retryClicked, false, 'Clicking synced pill must not trigger retry');
});

// ============================================================================
// SUITE 3: EXPORT SUBSYSTEM WHITE-BOX COVERAGE & HARDENING
// ============================================================================

test('EXPORT-01: ZipBuilder - Empty archive generates valid 22-byte PKZIP 2.0 EOCD record', () => {
  const zip = buildZipArchive([]);
  assert.strictEqual(zip.length, 22, 'Empty zip must be exactly 22 bytes (EOCD record only)');

  const view = new DataView(zip.buffer);
  const signature = view.getUint32(0, true);
  assert.strictEqual(signature, 0x06054b50, 'EOCD signature must be 0x06054b50 (PK\\x05\\x06)');
  assert.strictEqual(view.getUint16(8, true), 0, 'Total entries on disk must be 0');
  assert.strictEqual(view.getUint16(10, true), 0, 'Total entries in central directory must be 0');
  assert.strictEqual(view.getUint32(12, true), 0, 'Central directory size must be 0');
  assert.strictEqual(view.getUint32(16, true), 0, 'Offset of central directory must be 0');
});

test('EXPORT-02: ZipBuilder - CRC-32 IEEE 802.3 test vectors', () => {
  const encoder = new TextEncoder();

  // Empty buffer -> 0
  assert.strictEqual(crc32(new Uint8Array(0)), 0);

  // Standard test vector "123456789" -> 0xCBF43926 (3421780262)
  const testVec = encoder.encode('123456789');
  assert.strictEqual(crc32(testVec), 0xcbf43926);
});

test('EXPORT-03: ZipBuilder - Multi-file archive with UTF-8 Unicode filenames', () => {
  const entries = [
    { path: 'hello.txt', data: 'Hello World' },
    { path: 'sub/notes.md', data: '# Notes\nContent' },
    { path: '日本語/テスト.txt', data: 'UTF-8 multi-byte test' },
  ];

  const archive = buildZipArchive(entries);
  assert.ok(archive.length > 200);

  // Verify Local Header 1
  const view = new DataView(archive.buffer);
  assert.strictEqual(view.getUint32(0, true), 0x04034b50, 'PK\\x03\\x04 local header 1');
  assert.strictEqual(view.getUint16(6, true), 0x0800, 'UTF-8 language flag bit set');
});

test('EXPORT-04: DocxExporter - escapeXml strips invalid XML 1.0 control characters and escapes entities', () => {
  const input = 'Normal & <tag> "quote" \'apostrophe\' \x00\x05\x08\x0B\x0C\x0E\x1F\t\r\nEnd';
  const escaped = escapeXml(input);

  assert.ok(!escaped.includes('& '), 'Must escape ampersand');
  assert.ok(escaped.includes('&amp;'));
  assert.ok(escaped.includes('&lt;tag&gt;'));
  assert.ok(escaped.includes('&quot;quote&quot;'));
  assert.ok(escaped.includes('&apos;apostrophe&apos;'));

  // Invalid control characters stripped
  assert.ok(!escaped.includes('\x00'));
  assert.ok(!escaped.includes('\x05'));
  assert.ok(!escaped.includes('\x08'));
  assert.ok(!escaped.includes('\x1F'));

  // Valid whitespace preserved
  assert.ok(escaped.includes('\t'));
  assert.ok(escaped.includes('\r'));
  assert.ok(escaped.includes('\n'));
});

test('EXPORT-05: DocxExporter - Valid OOXML package structure with notes table', async () => {
  const doc: DocumentRecord = {
    id: 'doc-docx',
    title: 'Word Export Title',
    content: '# Heading 1\n\nParagraph with **bold** and *italic* formatting.',
    is_title_custom: true,
    format_version: 1,
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
    sync_status: 'synced',
  };

  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-docx',
      paragraph_anchor_id: 'p-1',
      content: 'Important note on paragraph 1',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
  ];

  const result = await exportToDocx(doc, notes, ['draft', 'essay']);
  assert.strictEqual(result.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(result.data instanceof Uint8Array);
  assert.ok(result.data.length > 500);

  // Validate that it's a valid PKZIP package
  const view = new DataView((result.data as Uint8Array).buffer);
  assert.strictEqual(view.getUint32(0, true), 0x04034b50);
});

test('EXPORT-06: PdfExporter - VectorPdfBuilder special character escaping and multi-page layout', () => {
  const builder = new VectorPdfBuilder({ pageSize: 'landscape_dc1' });

  // Generate with special PDF characters: '(', ')', '\'
  const doc: DocumentRecord = {
    id: 'doc-pdf',
    title: 'PDF Title (Special \\ Characters)',
    content: 'Testing (parentheses) and \\backslashes\\ inside PDF stream.'.repeat(100), // Large enough for multiple pages
    is_title_custom: true,
    format_version: 1,
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
    sync_status: 'synced',
  };

  const pdfBytes = builder.generate(doc);
  const pdfString = new TextDecoder('latin1').decode(pdfBytes);

  // Verify PDF header and trailer invariants
  assert.ok(pdfString.startsWith('%PDF-1.4'), 'Must have %PDF-1.4 header');
  assert.ok(pdfString.includes('%%EOF'), 'Must end with %%EOF marker');
  assert.ok(pdfString.includes('/Type /Catalog'), 'Must contain Catalog');
  assert.ok(pdfString.includes('/Type /Pages'), 'Must contain Pages');
  assert.ok(pdfString.includes('xref'), 'Must contain xref table');

  // Verify parentheses escaped
  assert.ok(pdfString.includes('\\(') && pdfString.includes('\\)'));
});

test('EXPORT-07: MarkdownExporter - Filename sanitization and anchor sorting invariants', () => {
  // Pathological filename
  const sanitized = sanitizeFilename('My / Illegal: * "Doc" <Name>? |\\ End', 'md');
  assert.strictEqual(
    sanitized,
    'my___illegal_____doc___name______end.md'
  );
  assert.strictEqual(sanitizeFilename('', 'txt'), 'untitled.txt');

  // extractAnchorIndex edge cases
  assert.strictEqual(extractAnchorIndex(null), UNANCHORED_INDEX);
  assert.strictEqual(extractAnchorIndex(undefined), UNANCHORED_INDEX);
  assert.strictEqual(extractAnchorIndex(''), UNANCHORED_INDEX);
  assert.strictEqual(extractAnchorIndex('unanchored'), UNANCHORED_INDEX);
  assert.strictEqual(extractAnchorIndex('p-42'), 42);
  assert.strictEqual(extractAnchorIndex('¶7'), 7);

  // formatNoteAnchorLabel
  assert.strictEqual(formatNoteAnchorLabel(null), '[unanchored]');
  assert.strictEqual(formatNoteAnchorLabel(''), '[unanchored]');
  assert.strictEqual(formatNoteAnchorLabel('p-3'), '[¶3]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: 'p-9' }), '[¶9]');

  // sortThoughtNotes sorts by numeric anchor, stable chronological tie-breaker, and filters deleted
  const notes: ThoughtNoteRecord[] = [
    { id: 'n-3', document_id: 'd', paragraph_anchor_id: 'p-10', content: 'Ten', created_at: 100, updated_at: 100, deleted_at: null },
    { id: 'n-1', document_id: 'd', paragraph_anchor_id: 'p-2', content: 'Two', created_at: 200, updated_at: 200, deleted_at: null },
    { id: 'n-del', document_id: 'd', paragraph_anchor_id: 'p-1', content: 'Deleted', created_at: 50, updated_at: 50, deleted_at: 999 },
    { id: 'n-un', document_id: 'd', paragraph_anchor_id: null as any, content: 'Orphan', created_at: 300, updated_at: 300, deleted_at: null },
  ];


  const sorted = sortThoughtNotes(notes);
  assert.strictEqual(sorted.length, 3, 'Must filter out deleted notes');
  assert.strictEqual(sorted[0].id, 'n-1'); // p-2
  assert.strictEqual(sorted[1].id, 'n-3'); // p-10
  assert.strictEqual(sorted[2].id, 'n-un'); // unanchored at end
});

test('EXPORT-08: PlainTextExporter - stripMarkdownFormatting linear ReDoS immunity and accuracy', () => {
  const complexMd = `
# Main Header
Paragraph with **bold text**, *italic text*, and \`inline code\`.
~~strikethrough~~ and [link text](https://daylightcomputer.com).
![Daylight DC1](https://example.com/dc1.png)

> Blockquote reflection.

\`\`\`typescript
const a = 1;
const b = 2;
\`\`\`

---

- Bullet 1
* Bullet 2
+ Bullet 3

<span class="custom">HTML tags stripped</span>
`;

  const start = performance.now();
  const stripped = stripMarkdownFormatting(complexMd);
  const duration = performance.now() - start;

  assert.ok(duration < 20, `Stripping took ${duration}ms, must run in <20ms`);
  assert.ok(!stripped.includes('# Main Header'));
  assert.ok(stripped.includes('Main Header'));
  assert.ok(stripped.includes('bold text'));
  assert.ok(stripped.includes('italic text'));
  assert.ok(stripped.includes('inline code'));
  assert.ok(stripped.includes('link text (https://daylightcomputer.com)'));
  // Remediated: Image stripping regex runs before link stripping regex
  assert.strictEqual(stripped.includes('[Image: Daylight DC1]'), true, 'Images must be converted to [Image: alt] placeholder');
  assert.strictEqual(stripped.includes('!Daylight DC1'), false, 'Images must not be corrupted by link replacer');
  assert.ok(stripped.includes('Blockquote reflection.'));
  assert.ok(stripped.includes('const a = 1;'));
  assert.ok(stripped.includes('• Bullet 1'));
  assert.ok(!stripped.includes('<span'));
});

test('EXPORT-09: ShareService - composeEmail URI safety, character limit clamping, and CRLF replacement', () => {
  const share = new ShareService();

  // 1. Extreme document with CRLF
  const massiveDoc: DocumentRecord = {
    id: 'doc-email',
    title: 'Long Title & Special <Chars>',
    content: 'First paragraph with \r\n Windows CRLF.\r\n\r\n' + 'Word '.repeat(1000),
    is_title_custom: true,
    format_version: 1,
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
    sync_status: 'synced',
  };

  const emailRes = share.composeEmail(massiveDoc);
  assert.ok(emailRes.url.startsWith('mailto:?subject='), 'Must be a valid mailto: URL');
  assert.strictEqual(emailRes.truncated, true, 'Massive document must be truncated');
  assert.ok(emailRes.url.length <= 2500, `URI length ${emailRes.url.length} must be <= 2500`);
  assert.ok(!emailRes.url.includes('\r'), 'Must not contain raw carriage return');
  assert.ok(!emailRes.url.includes('\n'), 'Must not contain raw line feed');
});

test('EXPORT-10: ExportService - Facade delegates to all 4 exporters and share hooks', async () => {
  const exportService = new ExportService();

  const doc: DocumentRecord = {
    id: 'doc-facade',
    title: 'Facade Test Document',
    content: '# Facade Heading\n\nParagraph text here with notes.',
    is_title_custom: true,
    format_version: 1,
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
    sync_status: 'synced',
  };

  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-facade',
      paragraph_anchor_id: 'p-1',
      content: 'Note on paragraph 1',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
  ];

  // 1. exportToMarkdown
  const mdRes = exportService.exportToMarkdown(doc, notes, ['test', 'facade']);
  assert.strictEqual(mdRes.filename, 'facade_test_document.md');
  assert.ok(mdRes.mimeType.includes('text/markdown'));

  // 2. exportToPlainText
  const txtRes = exportService.exportToPlainText(doc, notes, ['test', 'facade']);
  assert.strictEqual(txtRes.filename, 'facade_test_document.txt');
  assert.ok(txtRes.mimeType.includes('text/plain'));

  // 3. exportToDocx
  const docxRes = await exportService.exportToDocx(doc, notes, ['test', 'facade']);
  assert.strictEqual(docxRes.filename, 'facade_test_document.docx');
  assert.strictEqual(docxRes.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  // 4. exportToPdf
  const pdfRes = await exportService.exportToPdf(doc, notes, ['test', 'facade']);
  assert.strictEqual(pdfRes.filename, 'facade_test_document.pdf');
  assert.strictEqual(pdfRes.mimeType, 'application/pdf');

  // 5. composeEmail via facade
  const emailRes = exportService.composeEmail(doc);
  assert.ok(emailRes.url.startsWith('mailto:?subject='));
});

test('SYNC-09: NetworkListener - Start and stop idempotency and status reflection', async () => {
  const win = new Window({ url: 'http://localhost:3000' });
  (globalThis as any).window = win;

  const adapter = new MockGoogleDocsSyncAdapter();
  const queue = new OfflineMutationQueue(undefined);
  const listener = new NetworkListener(adapter, queue);

  // Idempotent start
  listener.start();
  listener.start();

  // Trigger offline
  listener.handleOffline();
  assert.strictEqual(adapter.getStatus().state, 'offline');

  // Enqueue item while offline
  await queue.enqueue('document', 'doc-net-1', 'create', { title: 'Net Doc' });
  assert.strictEqual(await queue.getPendingCount(), 1);

  // Trigger online -> should drain queue automatically
  await listener.handleOnline();
  assert.strictEqual(adapter.getStatus().state, 'idle');
  assert.strictEqual(await queue.getPendingCount(), 0);

  // Idempotent stop
  listener.stop();
  listener.stop();
});

test('AI-12: InlineContinuationEngine - State lifecycle and destruction cleanup', () => {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).document = doc;
  (globalThis as any).window = win;

  const canvas = doc.createElement('div');
  doc.body.appendChild(canvas);

  const editor = {} as any;
  const history = {} as any;
  const adapter = new MockAIServiceAdapter();

  let stateChanges: string[] = [];
  const engine = new InlineContinuationEngine(editor, adapter, history, {
    onStateChange: (state) => stateChanges.push(state),
  });

  assert.strictEqual(engine.getState(), 'idle');
  assert.strictEqual(engine.isStreaming(), false);

  engine.attach(canvas as any);
  engine.destroy();
  assert.strictEqual(engine.getState(), 'idle');
});

test('SOLOS-05: Sol:OS Hardware Invariant - Strict verification of zero EPD waveform & screen flash hooks', async () => {
  const fs = await import('fs');
  const path = await import('path');

  const tokensCssPath = path.resolve(process.cwd(), 'src/styles/tokens.css');
  const mainCssPath = path.resolve(process.cwd(), 'src/styles/main.css');

  // Strip block comments completely before scanning active CSS rules
  const tokensCss = fs.readFileSync(tokensCssPath, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const mainCss = fs.readFileSync(mainCssPath, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

  const forbiddenPatterns = [
    /ACTION_REFRESH_SCREEN/i,
    /waveform/i,
    /screen-flash/i,
    /epd-flash/i,
    /e-ink/i,
    /eink/i,
  ];

  for (const pattern of forbiddenPatterns) {
    const linesTokens = tokensCss.split('\n');
    const linesMain = mainCss.split('\n');

    for (const line of [...linesTokens, ...linesMain]) {
      if (pattern.test(line)) {
        // Assert failure if any active rule attempts to trigger E-ink / EPD waveform hooks
        assert.fail(`Forbidden EPD / E-Ink pattern "${pattern}" found in active CSS line: ${line}`);
      }
    }
  }
});

// ============================================================================
// SUITE 4: SOL:OS TOKENS & CONTRAST RULES HARDENING
// ============================================================================

test('SOLOS-01: Sol:OS Tokens - All tokens adhere to monochrome purity (max channel delta <= 20)', () => {
  for (const [name, hex] of Object.entries(SOL_OS_PALETTE)) {
    const purity = checkMonochromePurity(hex);
    assert.ok(
      purity.isMonochrome,
      `Token ${name} (${hex}) must be monochrome, but had channel delta ${purity.maxDelta}`
    );
  }

  // Also check brand grays
  const brandYellowPurity = checkMonochromePurity('#CECECE');
  const brandAmberPurity = checkMonochromePurity('#9D9D9E');
  const brandOrangePurity = checkMonochromePurity('#6C6C6D');

  assert.ok(brandYellowPurity.isMonochrome);
  assert.ok(brandAmberPurity.isMonochrome);
  assert.ok(brandOrangePurity.isMonochrome);
});

test('SOLOS-02: Sol:OS Tokens - Monotonic luminance ordering', () => {
  // Ordered sequence from paper ground (--os-0) to max black ink (--os-1000)
  // Note: --os-100 is warm neutral border (#DCD5C9), --os-150 is recessed canvas (#F5F5F5)
  const tokens = [
    { name: '--os-0', hex: SOL_OS_PALETTE.os0 },
    { name: '--os-50', hex: SOL_OS_PALETTE.os50 },
    { name: '--os-150', hex: SOL_OS_PALETTE.os150 },
    { name: '--os-200', hex: SOL_OS_PALETTE.os200 },
    { name: '--os-300', hex: SOL_OS_PALETTE.os300 },
    { name: '--os-400', hex: SOL_OS_PALETTE.os400 },
    { name: '--os-800', hex: SOL_OS_PALETTE.os800 },
    { name: '--os-900', hex: SOL_OS_PALETTE.os900 },
    { name: '--os-1000', hex: SOL_OS_PALETTE.os1000 },
  ];

  for (let i = 0; i < tokens.length - 1; i++) {
    const [r1, g1, b1] = parseColor(tokens[i].hex);
    const [r2, g2, b2] = parseColor(tokens[i + 1].hex);
    const lum1 = relativeLuminance(r1, g1, b1);
    const lum2 = relativeLuminance(r2, g2, b2);

    assert.ok(
      lum1 > lum2,
      `Token ${tokens[i].name} (lum=${lum1.toFixed(3)}) must have strictly higher luminance than ${tokens[i + 1].name} (lum=${lum2.toFixed(3)})`
    );
  }
});

test('SOLOS-03: Sol:OS Contrast - Primary, secondary, and focus mode dimming contrast ratios', () => {
  const bgPaper = SOL_OS_PALETTE.os0; // #FFFFFF
  const bgCard = SOL_OS_PALETTE.os50; // #F7F7F7

  // WCAG AAA (>= 7.0:1) for primary text
  const c900On0 = calculateContrastRatio(SOL_OS_PALETTE.os900, bgPaper);
  const c1000On0 = calculateContrastRatio(SOL_OS_PALETTE.os1000, bgPaper);
  const c900On50 = calculateContrastRatio(SOL_OS_PALETTE.os900, bgCard);

  assert.ok(c900On0 >= 7.0, `--os-900 on --os-0 contrast ${c900On0.toFixed(2)} must be >= 7.0:1`);
  assert.ok(c1000On0 >= 7.0, `--os-1000 on --os-0 contrast ${c1000On0.toFixed(2)} must be >= 7.0:1`);
  assert.ok(c900On50 >= 7.0, `--os-900 on --os-50 contrast ${c900On50.toFixed(2)} must be >= 7.0:1`);

  // WCAG AA (>= 4.5:1) for secondary text
  const c400On0 = calculateContrastRatio(SOL_OS_PALETTE.os400, bgPaper);
  assert.ok(c400On0 >= 4.5, `--os-400 on --os-0 contrast ${c400On0.toFixed(2)} must be >= 4.5:1`);

  // Cognitive focus dimming contrast window (3.0:1 to 4.5:1)
  const c300On0 = calculateContrastRatio(SOL_OS_PALETTE.os300, bgPaper);
  assert.ok(c300On0 >= 3.0, `Dimmed text contrast ${c300On0.toFixed(2)} must remain legible >= 3.0:1`);
  assert.ok(c300On0 < 4.5, `Dimmed text contrast ${c300On0.toFixed(2)} must be lower than secondary text < 4.5:1`);
});

test('SOLOS-04: Sol:OS Contrast - Rejection of chromatic colors', () => {
  const badColors = ['#007AFF', '#FF3B30', '#34C759', '#AF52DE', 'rgb(255, 100, 50)'];

  for (const color of badColors) {
    const violation = auditElementStyle({
      selector: '.bad-element',
      text: 'Chromatic violation text',
      color,
      backgroundColor: '#FFFFFF',
    });
    assert.strictEqual(violation?.issue, 'CHROMATIC_COLOR_VIOLATION');
  }
});
