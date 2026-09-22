/**
 * tests/adversarial/m6-challenger2-empirical-invariants.test.ts
 * Daylight Writer - Milestone 6 Challenger 2 Empirical Stress & Invariant Verification Harness
 *
 * Independent empirical verification of:
 * 1. stripMarkdownFormatting: ![alt](url) -> [Image: alt] (never !alt (url)), empty alts, ReDoS immunity
 * 2. PKZIP 2.0 multi-file zip builder: magic headers, IEEE 802.3 CRC-32, EOCD, exact offsets, Unicode paths
 * 3. Docx OOXML package generator: XML 1.0 entity escaping, control char stripping, valid part hierarchy
 * 4. Vector PDF 1.4 object graph: %PDF-1.4 header, exact 20-byte xref table byte offsets, Kids/Count hierarchy, grayscale rg operators
 * 5. Offline sync rollback & mutation queue: in-flight recovery, coalescing permutations, partial batch rollback, max retries
 * 6. Sol:OS grayscale tokens & zero chromatic leaks: monochrome purity, luminance monotonicity, WCAG AA/AAA, zero EPD hooks
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Export & Serializer Imports
import {
  stripMarkdownFormatting,
  exportToPlainText,
  PlainTextExporter,
} from '../../src/export/plain-text-exporter.ts';
import {
  buildZipArchive,
  crc32,
  type ZipEntry,
} from '../../src/export/zip-builder.ts';
import {
  exportToDocx,
  escapeXml,
  buildContentTypesXml,
  buildPackageRelsXml,
  buildDocumentRelsXml,
  buildStylesXml,
  buildDocumentXml,
  DocxExporter,
} from '../../src/export/docx-exporter.ts';
import {
  VectorPdfBuilder,
  exportToPdf,
} from '../../src/export/pdf-exporter.ts';
import {
  exportToMarkdown,
  sanitizeFilename,
  sortThoughtNotes,
  formatNoteAnchorLabel,
} from '../../src/export/markdown-exporter.ts';
import { ExportService } from '../../src/export/export-service.ts';
import { ShareService } from '../../src/export/share-service.ts';

// Sync & Storage Imports
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { MockGoogleDocsSyncAdapter } from '../../src/sync/mock-google-docs-sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type DocumentRecord, type ThoughtNoteRecord } from '../../src/storage/schema.ts';

// Contrast & Token Verification Imports
import {
  SOL_OS_PALETTE,
  calculateContrastRatio,
  checkMonochromePurity,
  parseColor,
  relativeLuminance,
} from '../e2e/helpers/contrast-verifier.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function createInMemoryDb(): Promise<SqliteDatabase> {
  const db = await SqliteDatabase.open({
    vfsPreference: 'memory',
    dbName: `m6_c2_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`,
  });
  await runMigrations(db);
  return db;
}

function createSampleDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-m6-c2',
    title: 'Milestone 6 Empirical Challenge',
    content: `# Title Heading\n\nParagraph with **bold** and *italic* text.\n\n## Section 2\n\nSecond paragraph content.`,
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700001000000,
    deleted_at: null,
    ...overrides,
  };
}

function createSampleNotes(): ThoughtNoteRecord[] {
  return [
    {
      id: 'note-1',
      document_id: 'doc-m6-c2',
      paragraph_anchor_id: 'p-1',
      content: 'First anchor observation',
      created_at: 1700000100000,
      updated_at: 1700000200000,
      deleted_at: null,
    },
    {
      id: 'note-2',
      document_id: 'doc-m6-c2',
      paragraph_anchor_id: 'p-2',
      content: 'Second anchor observation',
      created_at: 1700000300000,
      updated_at: 1700000400000,
      deleted_at: null,
    },
  ];
}

// ============================================================================
// SUITE 1: PLAIN TEXT STRIPPER & IMAGE/LINK PRECEDENCE INVARIANTS
// ============================================================================

test('C2-STRIP-01: stripMarkdownFormatting converts ![alt](url) to [Image: alt] and NEVER !alt (url)', () => {
  const testCases = [
    {
      input: '![Daylight DC1](https://example.com/dc1.png)',
      expected: '[Image: Daylight DC1]',
      forbidden: '!Daylight DC1',
    },
    {
      input: '![Photo of high desert](https://images.unsplash.com/photo-1234?w=800)',
      expected: '[Image: Photo of high desert]',
      forbidden: '!Photo of high desert',
    },
    {
      input: '![Diagram 2026: LivePaper Transflective Panel](https://specs.daylight.computer/panel.svg)',
      expected: '[Image: Diagram 2026: LivePaper Transflective Panel]',
      forbidden: '!Diagram 2026',
    },
    {
      input: 'Text before ![Inline Image](http://example.com/test.jpg) and text after.',
      expected: 'Text before [Image: Inline Image] and text after.',
      forbidden: '!Inline Image',
    },
  ];

  for (const tc of testCases) {
    const result = stripMarkdownFormatting(tc.input);
    assert.ok(result.includes(tc.expected), `Expected "${tc.expected}" in "${result}"`);
    assert.strictEqual(
      result.includes(tc.forbidden),
      false,
      `Forbidden string "${tc.forbidden}" must NOT appear in output: "${result}"`
    );
  }
});

test('C2-STRIP-02: stripMarkdownFormatting handles empty alt text ![](url) cleanly without artifacts', () => {
  const input = 'Here is an image with no alt: ![](https://example.com/blank.png) done.';
  const result = stripMarkdownFormatting(input);
  assert.strictEqual(result.includes('!'), false, `Output must not leak exclamation marks: "${result}"`);
  assert.strictEqual(result.includes('https://example.com'), false, `URL must be stripped when alt is empty: "${result}"`);
  assert.strictEqual(result, 'Here is an image with no alt:  done.');
});

test('C2-STRIP-03: stripMarkdownFormatting distinguishes images from regular markdown links on the same line', () => {
  const input = 'Read [Daylight Docs](https://daylightcomputer.com) and view ![Daylight DC1](https://daylightcomputer.com/dc1.png).';
  const result = stripMarkdownFormatting(input);

  // Link must become: text (url)
  assert.ok(result.includes('Daylight Docs (https://daylightcomputer.com)'), 'Regular link must format as text (url)');
  // Image must become: [Image: alt]
  assert.ok(result.includes('[Image: Daylight DC1]'), 'Image must format as [Image: alt]');
  // No corrupted link for image
  assert.strictEqual(result.includes('!Daylight DC1'), false, 'Image must not become !alt (url)');
});

test('C2-STRIP-04: stripMarkdownFormatting executes with high performance on large 50k manuscript and adversarial lines', () => {
  // 1. 50,000-word realistic writing document (~470,000 characters)
  const dictionary = ['word', 'test', '# heading', '**bold**', '*italic*', '[link](https://daylight.computer)', '![dc1](https://dc1.png)'];
  let md = '';
  for (let i = 0; i < 50000; i++) {
    md += dictionary[i % dictionary.length] + ' ';
    if (i % 50 === 0) md += '\n\n';
  }

  const start50k = performance.now();
  const stripped50k = stripMarkdownFormatting(md);
  const duration50k = performance.now() - start50k;

  assert.ok(duration50k < 50, `50,000-word document took ${duration50k}ms, must run in <50ms`);
  assert.ok(!stripped50k.includes('!dc1 (https://dc1.png)'), 'No corrupted images in 50k document');
  assert.ok(stripped50k.includes('[Image: dc1]'), 'Images properly transformed in 50k document');

  // 2. 5,000 lines of unclosed markdown brackets (adversarial line boundary test)
  const adversarialLines = '![unclosed alt text\n'.repeat(5000);
  const startLines = performance.now();
  const strippedLines = stripMarkdownFormatting(adversarialLines);
  const durationLines = performance.now() - startLines;

  assert.ok(durationLines < 20, `5,000 adversarial lines took ${durationLines}ms, must run in <20ms`);
  assert.strictEqual(typeof strippedLines, 'string');
});

// ============================================================================
// SUITE 2: PKZIP 2.0 MULTI-FILE ZIP BUILDER INVARIANTS
// ============================================================================

test('C2-ZIP-01: Empty PKZIP 2.0 archive produces valid 22-byte EOCD structure', () => {
  const zipBuffer = buildZipArchive([]);
  assert.strictEqual(zipBuffer.length, 22, 'Empty archive must be exactly 22 bytes (EOCD only)');

  const view = new DataView(zipBuffer.buffer);
  const eocdSig = view.getUint32(0, true);
  assert.strictEqual(eocdSig, 0x06054b50, 'EOCD signature must be 0x06054b50 (PK\\x05\\x06)');
  assert.strictEqual(view.getUint16(4, true), 0, 'Disk number must be 0');
  assert.strictEqual(view.getUint16(6, true), 0, 'Start disk must be 0');
  assert.strictEqual(view.getUint16(8, true), 0, 'Total entries on disk must be 0');
  assert.strictEqual(view.getUint16(10, true), 0, 'Total entries must be 0');
  assert.strictEqual(view.getUint32(12, true), 0, 'Central directory size must be 0');
  assert.strictEqual(view.getUint32(16, true), 0, 'Central directory offset must be 0');
  assert.strictEqual(view.getUint16(20, true), 0, 'Comment length must be 0');
});

test('C2-ZIP-02: IEEE 802.3 CRC-32 standard test vectors', () => {
  const encoder = new TextEncoder();
  assert.strictEqual(crc32(new Uint8Array(0)), 0x00000000, 'CRC-32 of empty buffer is 0');
  assert.strictEqual(crc32(encoder.encode('123456789')), 0xcbf43926, 'Standard 123456789 vector must match 0xcbf43926');
  assert.strictEqual(crc32(encoder.encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('C2-ZIP-03: Multi-file PKZIP 2.0 archive structural offsets and cross-record integrity', () => {
  const entries: ZipEntry[] = [
    { path: '[Content_Types].xml', data: '<Types xmlns="test"/>' },
    { path: '_rels/.rels', data: '<Relationships/>' },
    { path: 'word/document.xml', data: '<w:document><w:body><w:p><w:r><w:t>Hello World</w:t></w:r></w:p></w:body></w:document>' },
    { path: 'word/styles.xml', data: '<w:styles/>' },
    { path: 'unicode/文件.txt', data: 'UTF-8 encoded payload 测试' },
  ];

  const zipBytes = buildZipArchive(entries);
  const view = new DataView(zipBytes.buffer);
  const decoder = new TextDecoder();

  // 1. Validate Local File Headers
  let cursor = 0;
  const recordedLocalOffsets: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    recordedLocalOffsets.push(cursor);
    const sig = view.getUint32(cursor, true);
    assert.strictEqual(sig, 0x04034b50, `File ${i} local header signature must be 0x04034b50`);
    assert.strictEqual(view.getUint16(cursor + 4, true), 20, 'Version needed must be 20 (2.0)');
    assert.strictEqual(view.getUint16(cursor + 6, true), 0x0800, 'UTF-8 flag 0x0800 must be set');
    assert.strictEqual(view.getUint16(cursor + 8, true), 0, 'Compression must be 0 (STORE)');

    const entryData = typeof entries[i].data === 'string' ? new TextEncoder().encode(entries[i].data as string) : entries[i].data as Uint8Array;
    const expectedCrc = crc32(entryData);
    assert.strictEqual(view.getUint32(cursor + 14, true), expectedCrc, `CRC-32 must match for ${entries[i].path}`);
    assert.strictEqual(view.getUint32(cursor + 18, true), entryData.length, 'Compressed size match');
    assert.strictEqual(view.getUint32(cursor + 22, true), entryData.length, 'Uncompressed size match');

    const nameLen = view.getUint16(cursor + 26, true);
    const extraLen = view.getUint16(cursor + 28, true);
    const nameBytes = zipBytes.subarray(cursor + 30, cursor + 30 + nameLen);
    assert.strictEqual(decoder.decode(nameBytes), entries[i].path, 'Local header filename must match');

    const dataBytes = zipBytes.subarray(cursor + 30 + nameLen + extraLen, cursor + 30 + nameLen + extraLen + entryData.length);
    assert.deepStrictEqual(dataBytes, entryData, 'File payload must match byte-for-byte');

    cursor += 30 + nameLen + extraLen + entryData.length;
  }

  const centralDirStart = cursor;

  // 2. Validate Central Directory Headers
  for (let i = 0; i < entries.length; i++) {
    const sig = view.getUint32(cursor, true);
    assert.strictEqual(sig, 0x02014b50, `File ${i} central dir signature must be 0x02014b50`);
    assert.strictEqual(view.getUint16(cursor + 4, true), 20, 'Version made by must be 20');
    assert.strictEqual(view.getUint16(cursor + 6, true), 20, 'Version needed must be 20');
    assert.strictEqual(view.getUint16(cursor + 8, true), 0x0800, 'UTF-8 flag must be set');
    assert.strictEqual(view.getUint16(cursor + 10, true), 0, 'Compression must be 0');

    const entryData = typeof entries[i].data === 'string' ? new TextEncoder().encode(entries[i].data as string) : entries[i].data as Uint8Array;
    assert.strictEqual(view.getUint32(cursor + 16, true), crc32(entryData), 'Central dir CRC match');
    assert.strictEqual(view.getUint32(cursor + 20, true), entryData.length, 'Central dir compressed size');
    assert.strictEqual(view.getUint32(cursor + 24, true), entryData.length, 'Central dir uncompressed size');

    const nameLen = view.getUint16(cursor + 28, true);
    const relativeOffset = view.getUint32(cursor + 42, true);
    assert.strictEqual(
      relativeOffset,
      recordedLocalOffsets[i],
      `Central dir relative offset must point exactly to local header of ${entries[i].path}`
    );

    const nameBytes = zipBytes.subarray(cursor + 46, cursor + 46 + nameLen);
    assert.strictEqual(decoder.decode(nameBytes), entries[i].path, 'Central dir filename must match');

    cursor += 46 + nameLen;
  }

  const centralDirSize = cursor - centralDirStart;

  // 3. Validate EOCD Record
  const eocdSig = view.getUint32(cursor, true);
  assert.strictEqual(eocdSig, 0x06054b50, 'EOCD signature must be 0x06054b50');
  assert.strictEqual(view.getUint16(cursor + 8, true), entries.length, 'Total entries on disk');
  assert.strictEqual(view.getUint16(cursor + 10, true), entries.length, 'Total entries');
  assert.strictEqual(view.getUint32(cursor + 12, true), centralDirSize, 'Central dir size in EOCD');
  assert.strictEqual(view.getUint32(cursor + 16, true), centralDirStart, 'Central dir offset in EOCD');
  assert.strictEqual(cursor + 22, zipBytes.length, 'EOCD must be exactly at buffer end');
});

// ============================================================================
// SUITE 3: DOCX OOXML PACKAGE GENERATION INVARIANTS
// ============================================================================

test('C2-DOCX-01: escapeXml escapes standard XML entities and strips invalid XML 1.0 control characters', () => {
  const dirty = 'Daylight & Co. <DC1> "Transflective" \'LivePaper\' \x00\x01\x08\x0B\x0C\x0E\x1F\t\nValid';
  const clean = escapeXml(dirty);

  assert.ok(clean.includes('&amp;'), '& must be escaped to &amp;');
  assert.ok(clean.includes('&lt;DC1&gt;'), '< and > must be escaped');
  assert.ok(clean.includes('&quot;Transflective&quot;'), '" must be escaped');
  assert.ok(clean.includes('&apos;LivePaper&apos;'), '\' must be escaped');
  assert.strictEqual(clean.includes('\x00'), false, 'Null byte stripped');
  assert.strictEqual(clean.includes('\x01'), false, 'Control char 0x01 stripped');
  assert.strictEqual(clean.includes('\x08'), false, 'Control char 0x08 stripped');
  assert.strictEqual(clean.includes('\x1F'), false, 'Control char 0x1F stripped');
  assert.ok(clean.includes('\t\nValid'), 'Valid whitespace (tab, newline) preserved');
});

test('C2-DOCX-02: exportToDocx generates valid OOXML package with required parts and styles', async () => {
  const doc = createSampleDoc();
  const notes = createSampleNotes();
  const tags = ['project/draft', 'livepaper'];

  const result = await exportToDocx(doc, notes, tags);
  assert.strictEqual(result.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(result.filename.endsWith('.docx'));
  assert.ok(result.data instanceof Uint8Array);

  const zipBytes = result.data as Uint8Array;
  assert.ok(zipBytes.length > 500, 'Docx zip must contain substantial XML structure');

  // Verify that zip buffer contains the 5 required OOXML parts
  const text = new TextDecoder().decode(zipBytes);
  assert.ok(text.includes('[Content_Types].xml'), 'Must contain [Content_Types].xml');
  assert.ok(text.includes('_rels/.rels'), 'Must contain _rels/.rels');
  assert.ok(text.includes('word/_rels/document.xml.rels'), 'Must contain document rels');
  assert.ok(text.includes('word/styles.xml'), 'Must contain styles.xml');
  assert.ok(text.includes('word/document.xml'), 'Must contain document.xml');
  assert.ok(text.includes('First anchor observation'), 'Must contain thought note content');
  assert.ok(text.includes('Georgia'), 'Must specify Georgia serif typography');
});

// ============================================================================
// SUITE 4: VECTOR PDF 1.4 OBJECT GRAPH INVARIANTS
// ============================================================================

test('C2-PDF-01: VectorPdfBuilder produces valid PDF 1.4 with exact 20-byte xref table offsets and grayscale color operators', () => {
  const doc = createSampleDoc({
    title: 'Long Vector PDF 1.4 Test',
    content: ('# Section Heading\n\n' + 'Paragraph text on daylight LivePaper. '.repeat(50) + '\n\n').repeat(5),
  });
  const notes = createSampleNotes();
  const tags = ['manuscript', 'dc1'];

  const builder = new VectorPdfBuilder();
  const pdfBytes = builder.generate(doc, notes, tags);
  const pdfText = new TextDecoder().decode(pdfBytes);

  // 1. Validate Header
  assert.ok(pdfText.startsWith('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'), 'Must start with PDF 1.4 binary header');

  // 2. Validate Catalog & Pages hierarchy
  assert.ok(pdfText.includes('/Type /Catalog /Pages 2 0 R'), 'Object 1 must be Catalog pointing to Pages at 2 0 R');
  assert.ok(pdfText.includes('/Type /Pages /Kids ['), 'Object 2 must be Pages container with Kids array');
  assert.ok(pdfText.includes('/Type /Font /Subtype /Type1 /BaseFont /Helvetica'), 'Font F1 must be Helvetica');
  assert.ok(pdfText.includes('/Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold'), 'Font F2 must be Helvetica-Bold');

  // 3. Validate Sol:OS grayscale color operators only (no chromatic rg operators)
  const rgMatches = pdfText.match(/([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+[rR][gG]/g) || [];
  assert.ok(rgMatches.length > 0, 'PDF must contain color operators');
  for (const match of rgMatches) {
    const parts = match.trim().split(/\s+/);
    const r = parseFloat(parts[0]);
    const g = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);
    assert.strictEqual(r, g, `PDF color must be pure gray (R==G in ${match})`);
    assert.strictEqual(g, b, `PDF color must be pure gray (G==B in ${match})`);
  }

  // 4. Validate xref table byte offsets directly from Uint8Array bytes
  const startxrefIndex = pdfText.lastIndexOf('startxref');
  assert.ok(startxrefIndex !== -1, 'startxref must exist');
  const startxrefMatch = pdfText.slice(startxrefIndex).match(/startxref\s+(\d+)\s+%%EOF/);
  assert.ok(startxrefMatch, 'startxref must match integer offset');
  const xrefByteOffset = parseInt(startxrefMatch[1], 10);

  // Verify byte-level signature "xref\n" at xrefByteOffset
  const xrefMarker = new TextDecoder().decode(pdfBytes.subarray(xrefByteOffset, xrefByteOffset + 5));
  assert.strictEqual(xrefMarker, 'xref\n', 'Byte at startxref must be "xref\\n"');

  // Inspect the xref header: "xref\n0 <count>\n"
  const xrefSnippet = new TextDecoder().decode(pdfBytes.subarray(xrefByteOffset, xrefByteOffset + 30));
  const xrefHeaderMatch = xrefSnippet.match(/^xref\n0\s+(\d+)\n/);
  assert.ok(xrefHeaderMatch, 'xref header must define object count');
  const objectCount = parseInt(xrefHeaderMatch[1], 10);

  // Verify that each object pointer points to "${i} 0 obj"
  const decoder = new TextDecoder();
  let lineOffset = xrefByteOffset + xrefHeaderMatch[0].length;

  for (let i = 0; i < objectCount; i++) {
    const entryLine = decoder.decode(pdfBytes.subarray(lineOffset, lineOffset + 20));
    assert.strictEqual(entryLine.length, 20, 'Each xref entry must be exactly 20 bytes');

    if (i > 0) {
      const objByteOffset = parseInt(entryLine.slice(0, 10), 10);
      const expectedObjHeader = `${i} 0 obj`;
      const actualObjHeader = decoder.decode(pdfBytes.subarray(objByteOffset, objByteOffset + expectedObjHeader.length));
      assert.strictEqual(
        actualObjHeader,
        expectedObjHeader,
        `Object ${i} xref byte offset (${objByteOffset}) must point to "${expectedObjHeader}"`
      );
    }
    lineOffset += 20;
  }
});

// ============================================================================
// SUITE 5: OFFLINE SYNC MUTATION QUEUE ROLLBACK & COALESCING INVARIANTS
// ============================================================================

test('C2-SYNC-01: OfflineMutationQueue recovers stranded in_flight mutations after simulated crash', async () => {
  const db = await createInMemoryDb();
  const queue = new OfflineMutationQueue(db);

  // Simulate an uncommitted in-flight row directly in DB as if a tab crashed mid-sync
  await db.executeSql(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status)
     VALUES ('stranded-1', 'document', 'doc-1', 'update', '{"title":"Crash Title"}', 1700000000000, 0, NULL, 'in_flight');`
  );

  const recovered = await queue.recoverInFlight();
  assert.strictEqual(recovered, 1, 'Must recover exactly 1 stranded in-flight mutation');

  const pendingCount = await queue.getPendingCount();
  assert.strictEqual(pendingCount, 1, 'Recovered mutation must be in pending status');
});

test('C2-SYNC-02: OfflineMutationQueue coalescing permutations (create+update, create+delete, update+delete)', async () => {
  const db = await createInMemoryDb();
  const queue = new OfflineMutationQueue(db);

  // 1. Create + Update -> Remains Create with new payload
  await queue.enqueue('document', 'doc-coalesce-1', 'create', { title: 'Initial' }, 1000);
  await queue.enqueue('document', 'doc-coalesce-1', 'update', { title: 'Updated Title' }, 2000);

  const rows1 = await db.executeSql<any>(`SELECT * FROM sync_queue WHERE entity_id = 'doc-coalesce-1';`);
  assert.strictEqual(rows1.length, 1);
  assert.strictEqual(rows1[0].operation, 'create', 'Operation must remain create');
  assert.ok(rows1[0].payload.includes('Updated Title'), 'Payload must be updated to latest');

  // 2. Create + Delete -> Net 0 (both dropped)
  await queue.enqueue('document', 'doc-coalesce-2', 'create', { title: 'Temporary' }, 3000);
  assert.strictEqual(await queue.getPendingCount(), 2);
  await queue.enqueue('document', 'doc-coalesce-2', 'delete', {}, 4000);
  assert.strictEqual(await queue.getPendingCount(), 1, 'Create+Delete must drop the row entirely');

  // 3. Update + Delete -> Becomes Delete
  await queue.enqueue('document', 'doc-coalesce-3', 'update', { title: 'Edit' }, 5000);
  await queue.enqueue('document', 'doc-coalesce-3', 'delete', {}, 6000);
  const rows3 = await db.executeSql<any>(`SELECT * FROM sync_queue WHERE entity_id = 'doc-coalesce-3';`);
  assert.strictEqual(rows3.length, 1);
  assert.strictEqual(rows3[0].operation, 'delete', 'Update + Delete must coalesce to delete');
});

test('C2-SYNC-03: OfflineMutationQueue rollbackBatch transitions to failed when maxRetries is reached', async () => {
  const db = await createInMemoryDb();
  const queue = new OfflineMutationQueue(db, { maxRetries: 3 });

  await queue.enqueue('document', 'doc-fail-1', 'update', { title: 'Fail Test' });

  // Failing sync adapter simulating network failure
  const adapter = new MockGoogleDocsSyncAdapter();
  await adapter.init();
  adapter.setSimulatedFailure(true, 'server_error');

  // Attempt 1: retry_count becomes 1, status pending
  await queue.drain(adapter);
  let rows = await db.executeSql<any>(`SELECT * FROM sync_queue WHERE entity_id = 'doc-fail-1';`);
  assert.strictEqual(rows[0].retry_count, 1);
  assert.strictEqual(rows[0].status, 'pending');

  // Attempt 2: retry_count becomes 2, status pending
  await queue.drain(adapter);
  rows = await db.executeSql<any>(`SELECT * FROM sync_queue WHERE entity_id = 'doc-fail-1';`);
  assert.strictEqual(rows[0].retry_count, 2);
  assert.strictEqual(rows[0].status, 'pending');

  // Attempt 3: retry_count becomes 3 >= maxRetries (3), status transitions to 'failed'
  await queue.drain(adapter);
  rows = await db.executeSql<any>(`SELECT * FROM sync_queue WHERE entity_id = 'doc-fail-1';`);
  assert.strictEqual(rows[0].retry_count, 3);
  assert.strictEqual(rows[0].status, 'failed', 'Row must transition to failed on max retries');
  assert.ok(rows[0].last_error !== null && rows[0].last_error.length > 0, 'Error message recorded');
});

// ============================================================================
// SUITE 6: SOL:OS GRAYSCALE TOKENS & ZERO CHROMATIC LEAKS
// ============================================================================

test('C2-SOLOS-01: Sol:OS tokens strictly adhere to monochrome purity and monotonic luminance', () => {
  // Surface-to-ink monotonic luminance sequence (os100 is dedicated hairline border)
  const monotonicTokens = [
    'os0', 'os50', 'os150', 'os200',
    'os300', 'os400', 'os800', 'os900', 'os1000'
  ] as const;

  const allTokens = [
    'os0', 'os50', 'os100', 'os150', 'os200',
    'os300', 'os400', 'os800', 'os900', 'os1000'
  ] as const;

  for (const key of allTokens) {
    const hex = SOL_OS_PALETTE[key];
    assert.ok(hex, `Token ${key} must exist in palette`);

    // Purity check
    const purity = checkMonochromePurity(hex);
    assert.ok(
      purity.isMonochrome,
      `Token ${key} (${hex}) must be monochrome (delta: ${purity.maxDelta})`
    );
  }

  let prevLuminance = 2.0;
  for (const key of monotonicTokens) {
    const hex = SOL_OS_PALETTE[key];
    const [r, g, b] = parseColor(hex);
    const lum = relativeLuminance(r, g, b);
    assert.ok(
      lum <= prevLuminance + 0.001,
      `Token ${key} (${hex}, lum=${lum}) must have lower or equal luminance than previous (${prevLuminance})`
    );
    prevLuminance = lum;
  }
});

test('C2-SOLOS-02: Sol:OS contrast ratios exceed WCAG AA/AAA thresholds on LivePaper canvas', () => {
  const bg = SOL_OS_PALETTE.os0; // #FFFFFF

  // Primary text: os900 on os0
  const contrastPrimary = calculateContrastRatio(SOL_OS_PALETTE.os900, bg);
  assert.ok(contrastPrimary >= 13.0, `Primary contrast ${contrastPrimary}:1 must exceed 13:1 (WCAG AAA >= 7:1)`);

  // Max black: os1000 on os0
  const contrastBlack = calculateContrastRatio(SOL_OS_PALETTE.os1000, bg);
  assert.ok(contrastBlack >= 20.0, `Max black contrast ${contrastBlack}:1 must exceed 20:1`);

  // Secondary text: os400 on os0
  const contrastSecondary = calculateContrastRatio(SOL_OS_PALETTE.os400, bg);
  assert.ok(contrastSecondary >= 6.5, `Secondary contrast ${contrastSecondary}:1 must exceed 6.5:1 (WCAG AA >= 4.5:1)`);

  // Focus mode dimmed text: os300 on os0
  const contrastDimmed = calculateContrastRatio(SOL_OS_PALETTE.os300, bg);
  assert.ok(contrastDimmed >= 3.0 && contrastDimmed <= 4.5, `Dimmed text contrast ${contrastDimmed}:1 must be in dimmed range`);
});

test('C2-SOLOS-03: Zero chromatic leaks across CSS files (tokens.css, main.css, reset.css)', () => {
  const cssPaths = [
    resolve(process.cwd(), 'src/styles/tokens.css'),
    resolve(process.cwd(), 'src/styles/main.css'),
    resolve(process.cwd(), 'src/styles/reset.css'),
  ];

  for (const p of cssPaths) {
    const content = readFileSync(p, 'utf-8');
    // Find all hex colors #RGB, #RRGGBB
    const hexMatches = content.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    for (const hex of hexMatches) {
      let normalized = hex;
      if (hex.length === 4) {
        normalized = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      const purity = checkMonochromePurity(normalized);
      assert.ok(
        purity.isMonochrome,
        `Chromatic leak detected in ${p}: ${hex} has channel delta ${purity.maxDelta} > 20`
      );
    }
  }
});
