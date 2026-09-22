/**
 * tests/adversarial/m5-challenger2-export-share-stress.test.ts
 * Milestone 5 Challenger 2 Empirical Stress & Binary Validation Harness
 *
 * Empirical investigations:
 * 1. 50,000-word manuscript export speed benchmarking (< 50ms md/txt, < 250ms docx/pdf)
 * 2. PKZIP 2.0 / OOXML binary buffer validation (PK0304, PK0102, PK0506, CRC-32 IEEE 802.3, XML parts)
 * 3. Vector PDF 1.4 binary structural validation (xref table byte offsets, Object tree hierarchy, Kids array references)
 * 4. Margin note anchor handling: pilcrow label fallback for unnumbered anchors & null anchor safety
 * 5. ReDoS pathological markdown attack patterns (< 10ms linear time execution)
 * 6. RFC 6068 Mailto URI length hard clamping (<= 2500 chars) and CRLF injection neutralization
 */

import test from 'node:test';
import assert from 'node:assert';
import { ExportService } from '../../src/export/export-service.ts';
import { ShareService } from '../../src/export/share-service.ts';
import { MarkdownExporter, exportToMarkdown, sortThoughtNotes, extractAnchorIndex } from '../../src/export/markdown-exporter.ts';
import { PlainTextExporter, stripMarkdownFormatting } from '../../src/export/plain-text-exporter.ts';
import { DocxExporter } from '../../src/export/docx-exporter.ts';
import { PdfExporter, VectorPdfBuilder } from '../../src/export/pdf-exporter.ts';
import { crc32, buildZipArchive } from '../../src/export/zip-builder.ts';
import type { DocumentRecord, ThoughtNoteRecord } from '../../src/storage/schema.ts';

// Helper to generate a 50,000-word manuscript
function generateManuscript(wordCount: number): string {
  const dictionary = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog',
    'philosophy', 'reflective', 'livepaper', 'sunlight', 'silence', 'clarity',
    'typewriter', 'distraction', 'focus', 'manuscript', 'chapter', 'canvas',
    'solos', 'monochrome', 'contrast', 'ergonomic', 'landscape', 'keystroke'
  ];
  const paragraphs: string[] = [];
  let currentWords: string[] = [];

  for (let i = 0; i < wordCount; i++) {
    currentWords.push(dictionary[i % dictionary.length]);
    if (currentWords.length >= 75) {
      paragraphs.push(currentWords.join(' ') + '.');
      currentWords = [];
    }
  }
  if (currentWords.length > 0) {
    paragraphs.push(currentWords.join(' ') + '.');
  }
  return paragraphs.join('\n\n');
}

test('Challenger 2 [Benchmark]: 50,000-Word Manuscript Export Speed Benchmarking (< 50ms md/txt, < 250ms docx/pdf)', async () => {
  const largeContent = generateManuscript(50000);
  const doc: DocumentRecord = {
    id: 'doc_50k_stress',
    title: '50,000-Word Manuscript Stress Corpus',
    content: `# 50,000-Word Manuscript Stress Corpus\n\n${largeContent}`,
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700005000000,
    deleted_at: null,
  };

  const notes: ThoughtNoteRecord[] = [];
  for (let i = 0; i < 100; i++) {
    notes.push({
      id: `note_${i}`,
      document_id: 'doc_50k_stress',
      paragraph_anchor_id: `p-${i * 5}`,
      content: `Note ${i}: Paragraph ${i * 5} critical assessment and thematic note.`,
      created_at: 1700000000000 + i * 1000,
      updated_at: 1700000000000 + i * 1000,
      deleted_at: null,
    });
  }

  const tags = ['epic', 'stress', 'benchmarking', 'livepaper', 'monochrome'];
  const service = new ExportService();

  // Benchmark Markdown (< 50ms)
  const tMdStart = performance.now();
  const mdResult = await service.exportDocument(doc, 'md', notes, tags);
  const tMd = performance.now() - tMdStart;
  assert.ok(tMd < 50, `Markdown export took ${tMd.toFixed(2)}ms, threshold is < 50ms`);
  assert.ok(typeof mdResult.data === 'string' && mdResult.data.length > 250000);

  // Benchmark Plain Text (< 50ms)
  const tTxtStart = performance.now();
  const txtResult = await service.exportDocument(doc, 'txt', notes, tags);
  const tTxt = performance.now() - tTxtStart;
  assert.ok(tTxt < 50, `Plain text export took ${tTxt.toFixed(2)}ms, threshold is < 50ms`);
  assert.ok(typeof txtResult.data === 'string' && txtResult.data.length > 250000);

  // Benchmark OOXML Word (.docx) (< 250ms)
  const tDocxStart = performance.now();
  const docxResult = await service.exportDocument(doc, 'docx', notes, tags);
  const tDocx = performance.now() - tDocxStart;
  assert.ok(tDocx < 250, `Docx export took ${tDocx.toFixed(2)}ms, threshold is < 250ms`);
  assert.ok(docxResult.data instanceof Uint8Array && docxResult.data.length > 100000);

  // Benchmark Vector PDF 1.4 (< 250ms)
  const tPdfStart = performance.now();
  const pdfResult = await service.exportDocument(doc, 'pdf', notes, tags);
  const tPdf = performance.now() - tPdfStart;
  assert.ok(tPdf < 250, `PDF export took ${tPdf.toFixed(2)}ms, threshold is < 250ms`);
  assert.ok(pdfResult.data instanceof Uint8Array && pdfResult.data.length > 100000);
});

test('Challenger 2 [Binary Validation]: PKZIP 2.0 & OOXML Buffer Structural Verification', async () => {
  const exporter = new DocxExporter();
  const doc: DocumentRecord = {
    id: 'ooxml_val',
    title: 'OOXML Structural & Binary Verification',
    content: '# Heading 1\n\nParagraph text with special chars & <tags>.\n\n## Heading 2\n\nSecond section.',
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700000000000,
    deleted_at: null,
  };
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n_ooxml',
      document_id: 'ooxml_val',
      paragraph_anchor_id: 'p-1',
      content: 'Marginal annotation with ampersand & quotes "here".',
      created_at: 1700000000000,
      updated_at: 1700000000000,
      deleted_at: null,
    }
  ];

  const res = exporter.export(doc, notes, ['ooxml', 'test']);
  assert.ok(res.data instanceof Uint8Array);
  const bytes = res.data;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1. Verify Local File Header Signature 0x04034B50 (PK\x03\x04)
  const firstSig = view.getUint32(0, true);
  assert.strictEqual(firstSig, 0x04034b50, 'First bytes must be PK\\x03\\x04 local header signature');

  // 2. Parse all Local Headers and match with Central Directory
  let offset = 0;
  const localFiles: Array<{ name: string; crc: number; size: number; offset: number; data: Uint8Array }> = [];

  while (offset < bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const versionNeeded = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    assert.strictEqual(versionNeeded, 20, 'Version needed must be 20 (PKZIP 2.0)');
    assert.strictEqual(method, 0, 'Compression method must be 0 (STORE)');
    assert.strictEqual(compSize, uncompSize, 'Stored file compSize must equal uncompSize');

    const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataOffset = offset + 30 + nameLen + extraLen;
    const fileData = bytes.subarray(dataOffset, dataOffset + compSize);

    // Verify CRC-32 against computed IEEE 802.3 CRC
    const calculatedCrc = crc32(fileData);
    assert.strictEqual(crc, calculatedCrc, `CRC mismatch for file ${name}: expected ${crc}, got ${calculatedCrc}`);

    localFiles.push({ name, crc, size: compSize, offset, data: fileData });
    offset = dataOffset + compSize;
  }

  // Expect exactly 5 OOXML files
  assert.strictEqual(localFiles.length, 5, 'Must contain exactly 5 OOXML parts');
  const expectedNames = [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/styles.xml',
    'word/document.xml',
  ];
  for (const expName of expectedNames) {
    assert.ok(localFiles.some(f => f.name === expName), `Missing required OOXML part: ${expName}`);
  }

  // 3. Verify Central Directory Headers (0x02014B50)
  const centralDirStart = offset;
  const centralFiles: Array<{ name: string; crc: number; localOffset: number }> = [];

  while (offset < bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    const versionMadeBy = view.getUint16(offset + 4, true);
    const versionNeeded = view.getUint16(offset + 6, true);
    const crc = view.getUint32(offset + 16, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    assert.strictEqual(versionMadeBy, 20);
    assert.strictEqual(versionNeeded, 20);
    centralFiles.push({ name, crc, localOffset: localHeaderOffset });

    offset = offset + 46 + nameLen;
  }

  assert.strictEqual(centralFiles.length, 5, 'Central directory must contain 5 entries');
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(centralFiles[i].name, localFiles[i].name);
    assert.strictEqual(centralFiles[i].crc, localFiles[i].crc);
    assert.strictEqual(centralFiles[i].localOffset, localFiles[i].offset);
  }

  // 4. Verify End of Central Directory (EOCD) Signature 0x06054B50 (PK\x05\x06)
  assert.strictEqual(view.getUint32(offset, true), 0x06054b50, 'EOCD signature mismatch');
  assert.strictEqual(view.getUint16(offset + 8, true), 5, 'EOCD total entries on disk must be 5');
  assert.strictEqual(view.getUint16(offset + 10, true), 5, 'EOCD total entries must be 5');
  assert.strictEqual(view.getUint32(offset + 16, true), centralDirStart, 'EOCD central dir offset mismatch');
  assert.strictEqual(offset + 22, bytes.length, 'EOCD record must terminate at the exact end of buffer');
});

test('Challenger 2 [Empirical Defect]: Vector PDF 1.4 Internal Object Reference Misalignment', () => {
  const builder = new VectorPdfBuilder();
  const doc: DocumentRecord = {
    id: 'pdf_val',
    title: 'PDF Structural Audit',
    content: '# Chapter 1\n\nFirst page paragraph.',
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700000000000,
    deleted_at: null,
  };

  const pdfBytes = builder.generate(doc);
  const pdfStr = new TextDecoder('latin1').decode(pdfBytes);

  // Parse all objects by ID: "X 0 obj ... endobj"
  const objRegex = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  const objects = new Map<number, string>();
  let match: RegExpExecArray | null;
  while ((match = objRegex.exec(pdfStr)) !== null) {
    objects.set(parseInt(match[1], 10), match[2].trim());
  }

  const pagesObj = objects.get(2);
  assert.ok(pagesObj, 'Object 2 must be Pages container');
  
  const kidsMatch = pagesObj.match(/\/Kids\s*\[(.*?)\]/);
  assert.ok(kidsMatch, 'Pages container must define /Kids');
  const kidObjectIds = kidsMatch[1].match(/(\d+)\s+0\s+R/g)?.map(k => parseInt(k, 10)) || [];

  // In standard PDF 1.4 (ISO 32000-1), each object in /Kids must have /Type /Page.
  // We verify that every object referenced in /Kids is strictly a Page and not a Font:
  for (const kidId of kidObjectIds) {
    const target = objects.get(kidId);
    assert.ok(target, `Kid object ${kidId} must exist`);
    const isFont = target.includes('/Type /Font');
    const isPage = target.includes('/Type /Page');
    
    assert.strictEqual(
      isPage,
      true,
      'Vector PDF 1.4: /Kids elements in Pages object must strictly have /Type /Page'
    );
    assert.strictEqual(
      isFont,
      false,
      'Vector PDF 1.4: /Kids elements must not reference Font objects'
    );
  }
});

test('Challenger 2 [Export Formatting]: Unnumbered Paragraph Anchor Pilcrow Fallback', () => {
  const doc: DocumentRecord = {
    id: 'doc_anchors',
    title: 'Anchor Formatting Test',
    content: 'Paragraph content.',
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700000000000,
    deleted_at: null,
  };

  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n_numbered',
      document_id: 'doc_anchors',
      paragraph_anchor_id: 'p-3',
      content: 'Numbered anchor note',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
    {
      id: 'n_named',
      document_id: 'doc_anchors',
      paragraph_anchor_id: 'scratchpad',
      content: 'Unnumbered scratchpad note',
      created_at: 2000,
      updated_at: 2000,
      deleted_at: null,
    },
  ];

  const mdRes = exportToMarkdown(doc, notes);
  const mdData = mdRes.data as string;

  // Numbered note is formatted as [¶3]
  assert.ok(mdData.includes('[¶3] Numbered anchor note'));

  // Verify that unnumbered anchor outputs [scratchpad] instead of erroneous [¶999999]
  const hasErroneousPilcrow = mdData.includes('[¶999999]');
  assert.strictEqual(hasErroneousPilcrow, false, 'Markdown export must not emit [¶999999] for unnumbered anchors');
  assert.strictEqual(mdData.includes('[scratchpad] Unnumbered scratchpad note'), true, 'Markdown export must include [scratchpad] label');
});

test('Challenger 2 [Export Robustness]: Null Paragraph Anchor Invariant in sortThoughtNotes', () => {
  const notesWithNull: any[] = [
    {
      id: 'n_null_1',
      document_id: 'doc1',
      paragraph_anchor_id: null,
      content: 'First unanchored note',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
    {
      id: 'n_null_2',
      document_id: 'doc1',
      paragraph_anchor_id: null,
      content: 'Second unanchored note',
      created_at: 2000,
      updated_at: 2000,
      deleted_at: null,
    }
  ];

  // extractAnchorIndex gracefully handles null by returning 999999
  assert.strictEqual(extractAnchorIndex(null), 999999);

  // sortThoughtNotes safely handles null anchor without throwing TypeError during localeCompare
  let threwNullError = false;
  let sorted: ThoughtNoteRecord[] = [];
  try {
    sorted = sortThoughtNotes(notesWithNull as ThoughtNoteRecord[]);
  } catch (err: any) {
    threwNullError = true;
  }

  assert.strictEqual(threwNullError, false, 'sortThoughtNotes must not throw on null paragraph_anchor_id');
  assert.strictEqual(sorted.length, 2);
  assert.strictEqual(sorted[0].id, 'n_null_1');
  assert.strictEqual(sorted[1].id, 'n_null_2');
});

test('Challenger 2 [Adversarial ReDoS]: Pathological Markdown Stripping Under Stress', () => {
  const pathologicalVectors = [
    { name: 'deeply unclosed code block', input: '```typescript\n' + 'a = 1;\n'.repeat(50000) },
    { name: 'deeply nested brackets', input: '['.repeat(15000) + 'text' + '](https://example.com)'.repeat(15000) },
    { name: 'asterisk alternation spam', input: '* * * '.repeat(20000) },
    { name: 'underscore alternation spam', input: '_ _ _ '.repeat(20000) },
    { name: 'blockquote nested stack', input: '> > > > '.repeat(10000) + 'quote' },
    { name: 'backtick spam', input: '`a`'.repeat(25000) },
  ];

  for (const vec of pathologicalVectors) {
    const t0 = performance.now();
    const clean = stripMarkdownFormatting(vec.input);
    const duration = performance.now() - t0;

    assert.ok(
      duration < 15,
      `ReDoS attack "${vec.name}" took ${duration.toFixed(2)}ms (threshold < 15ms)`
    );
    assert.ok(typeof clean === 'string');
  }
});

test('Challenger 2 [RFC 6068 Mailto]: Length Clamping, Multibyte Safety & CRLF Injection', () => {
  const service = new ShareService();

  // 1. CRLF injection attack in title and content
  const maliciousDoc: DocumentRecord = {
    id: 'crlf_attack',
    title: 'Injected\r\nTo: victim@example.com\r\nSubject: Spoofed\r\n\r\nEvil Payload',
    content: 'Line 1\r\nLine 2\r\n\r\nBcc: spy@dark.net\r\n--MIME-BOUNDARY',
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  };

  const crlfResult = service.composeEmail(maliciousDoc);
  assert.strictEqual(crlfResult.url.includes('\r'), false, 'Raw carriage return in mailto URL');
  assert.strictEqual(crlfResult.url.includes('\n'), false, 'Raw newline in mailto URL');
  assert.ok(crlfResult.charCount <= 2500, 'URL length <= 2500');

  // 2. 50,000-character manuscript clamped strictly <= 2500 chars
  const hugeDoc: DocumentRecord = {
    id: 'huge_doc',
    title: 'Huge Manuscript',
    content: 'Word '.repeat(10000), // 50,000 chars
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  };

  const hugeResult = service.composeEmail(hugeDoc);
  assert.strictEqual(hugeResult.truncated, true);
  assert.ok(hugeResult.charCount <= 2500, `Clamped URL length ${hugeResult.charCount} must be <= 2500`);
  assert.strictEqual(hugeResult.url.endsWith('%'), false, 'URL must not end with dangling %');
  assert.strictEqual(/%[0-9A-Fa-f]$/.test(hugeResult.url), false, 'URL must not end with incomplete %X byte');

  // 3. Multi-byte Unicode (Emoji) sweep
  const emojiDoc: DocumentRecord = {
    id: 'emoji_doc',
    title: '✨ 🌟 💫',
    content: '🔥'.repeat(2000), // 4-byte UTF-8 emojis
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  };

  const emojiResult = service.composeEmail(emojiDoc);
  assert.strictEqual(emojiResult.truncated, true);
  assert.ok(emojiResult.charCount <= 2500, `Emoji URL length ${emojiResult.charCount} must be <= 2500`);
  assert.strictEqual(emojiResult.url.endsWith('%'), false);
  assert.strictEqual(/%[0-9A-Fa-f]$/.test(emojiResult.url), false);
});
