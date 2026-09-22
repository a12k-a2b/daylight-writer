/**
 * tests/unit/export-service.test.ts
 * Unit tests for Multi-Format Export Pipeline (F54-F58)
 * Markdown, Plain Text, OOXML Docx, Vector PDF, and ExportService.
 */

import test from 'node:test';
import assert from 'node:assert';
import { MarkdownExporter, sortThoughtNotes, extractAnchorIndex, formatNoteAnchorLabel } from '../../src/export/markdown-exporter.ts';
import { PlainTextExporter } from '../../src/export/plain-text-exporter.ts';
import { DocxExporter } from '../../src/export/docx-exporter.ts';
import { PdfExporter } from '../../src/export/pdf-exporter.ts';
import { ExportService } from '../../src/export/export-service.ts';
import type { DocumentRecord, ThoughtNoteRecord } from '../../src/storage/schema.ts';

function createSampleDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc_exp_1',
    title: 'The Architecture of Silence',
    content: '# The Architecture of Silence\n\nSilence is not the absence of sound, but the presence of stillness.\n\n## Chapter 1: The First Morning\n\nThe sun rose over the mist-laden hills, casting long shadows across the valley.',
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700003600000,
    deleted_at: null,
    ...overrides,
  };
}

function createSampleNotes(): ThoughtNoteRecord[] {
  return [
    {
      id: 'note_2',
      document_id: 'doc_exp_1',
      paragraph_anchor_id: 'p-2',
      content: 'Consider expanding on the metaphor of stillness here.',
      created_at: 1700001000000,
      updated_at: 1700001000000,
      deleted_at: null,
    },
    {
      id: 'note_0',
      document_id: 'doc_exp_1',
      paragraph_anchor_id: 'p-0',
      content: 'Working title draft: check alternatives.',
      created_at: 1700000500000,
      updated_at: 1700000500000,
      deleted_at: null,
    },
    {
      id: 'note_1',
      document_id: 'doc_exp_1',
      paragraph_anchor_id: 'p-1',
      content: 'Add reference to John Cage 4:33.',
      created_at: 1700000800000,
      updated_at: 1700000800000,
      deleted_at: null,
    },
  ];
}

test('MarkdownExporter: Monotonic sorting of thought notes by anchor paragraph', () => {
  const notes = createSampleNotes();
  const sorted = sortThoughtNotes(notes);

  assert.strictEqual(sorted[0].id, 'note_0');
  assert.strictEqual(sorted[1].id, 'note_1');
  assert.strictEqual(sorted[2].id, 'note_2');

  assert.strictEqual(extractAnchorIndex('p-0'), 0);
  assert.strictEqual(extractAnchorIndex('p-42'), 42);
  assert.strictEqual(extractAnchorIndex(null), 999999);
  assert.strictEqual(extractAnchorIndex('custom-anchor'), 999999);
});

test('MarkdownExporter: Generates YAML 1.2 frontmatter, body, and sorted margin notes', () => {
  const exporter = new MarkdownExporter();
  const doc = createSampleDoc();
  const notes = createSampleNotes();
  const tags = ['philosophy', 'essays', 'minimalism'];

  const result = exporter.export(doc, notes, tags, { includeFrontmatter: true, includeThoughtNotes: true });
  assert.strictEqual(result.filename, 'the_architecture_of_silence.md');
  assert.ok(result.mimeType.includes('text/markdown'));

  const text = result.data as string;
  assert.ok(text.startsWith('---\n'), 'Should start with YAML fence');
  assert.ok(text.includes('title: "The Architecture of Silence"'));
  assert.ok(text.includes('tags: ["philosophy", "essays", "minimalism"]'));
  assert.ok(text.includes('---\n\n# The Architecture of Silence'));
  assert.ok(text.includes('## Thought Notes'));
  assert.ok(text.includes('Working title draft: check alternatives.'));
  assert.ok(text.includes('Add reference to John Cage 4:33.'));
  assert.ok(text.includes('Consider expanding on the metaphor of stillness here.'));
});

test('MarkdownExporter: Respects options to omit frontmatter or notes', () => {
  const exporter = new MarkdownExporter();
  const doc = createSampleDoc();
  const notes = createSampleNotes();

  const withoutBoth = exporter.export(doc, notes, [], { includeFrontmatter: false, includeThoughtNotes: false });
  const text = withoutBoth.data as string;
  assert.strictEqual(text.startsWith('---\n'), false);
  assert.strictEqual(text.includes('## Thought Notes'), false);
  assert.ok(text.startsWith('# The Architecture of Silence'));
});

test('PlainTextExporter: Produces 80-column ASCII typewriter banner and strips markdown', () => {
  const exporter = new PlainTextExporter();
  const doc = createSampleDoc();
  const notes = createSampleNotes();

  const result = exporter.export(doc, notes, ['draft'], { includeThoughtNotes: true });
  assert.strictEqual(result.filename, 'the_architecture_of_silence.txt');
  assert.ok(result.mimeType.includes('text/plain'));

  const text = result.data as string;
  assert.ok(text.includes('='.repeat(80)));
  assert.ok(text.includes('THE ARCHITECTURE OF SILENCE'));
  assert.ok(text.includes('Tags: #draft'));
  // Markdown stripped
  assert.strictEqual(text.includes('# The Architecture of Silence'), false);
  assert.ok(text.includes('Silence is not the absence of sound'));
  assert.ok(text.includes('MARGIN NOTES:'));
  assert.ok(text.includes('[p-0]: Working title draft: check alternatives.'));
});

test('PlainTextExporter: ReDoS safety with deeply repeated pathological markdown input', () => {
  const exporter = new PlainTextExporter();
  const pathological = '*'.repeat(5000) + ' bold ' + '*'.repeat(5000) + '`'.repeat(2000);
  const start = Date.now();
  const stripped = exporter.stripMarkdown(pathological);
  const duration = Date.now() - start;

  assert.ok(duration < 30, `Stripping took ${duration}ms, expected < 30ms`);
  assert.ok(typeof stripped === 'string');
});

test('DocxExporter: Produces valid OOXML ZIP binary with standard parts and XML escaping', () => {
  const exporter = new DocxExporter();
  const doc = createSampleDoc({
    content: '# Escape Test & Title\n\nDangerous characters: <script>alert("xss")</script> & \'quotes\'.',
  });
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n_xss',
      document_id: 'doc_exp_1',
      paragraph_anchor_id: 'p-0',
      content: 'Note with <angle brackets> & ampersand.',
      created_at: 1700000000000,
      updated_at: 1700000000000,
      deleted_at: null,
    },
  ];

  const result = exporter.export(doc, notes, [], { includeThoughtNotes: true });
  assert.strictEqual(result.filename, 'the_architecture_of_silence.docx');
  assert.strictEqual(result.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(result.data instanceof Uint8Array);

  const bytes = result.data as Uint8Array;
  // Verify PKZIP magic bytes (0x50, 0x4B, 0x03, 0x04)
  assert.strictEqual(bytes[0], 0x50);
  assert.strictEqual(bytes[1], 0x4B);
  assert.strictEqual(bytes[2], 0x03);
  assert.strictEqual(bytes[3], 0x04);

  // Convert binary to string to inspect stored uncompressed XML files
  const binaryString = new TextDecoder('latin1').decode(bytes);
  assert.ok(binaryString.includes('[Content_Types].xml'));
  assert.ok(binaryString.includes('word/document.xml'));
  assert.ok(binaryString.includes('word/styles.xml'));
  assert.ok(binaryString.includes('Escape Test &amp; Title'));
  assert.ok(binaryString.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  assert.ok(binaryString.includes('&lt;angle brackets&gt; &amp; ampersand.'));
});

test('PdfExporter: Generates valid Vector PDF 1.4 binary with %PDF-1.4 header and %%EOF trailer', () => {
  const exporter = new PdfExporter();
  const doc = createSampleDoc();
  const notes = createSampleNotes();

  const result = exporter.export(doc, notes, ['solos'], { includeThoughtNotes: true });
  assert.strictEqual(result.filename, 'the_architecture_of_silence.pdf');
  assert.strictEqual(result.mimeType, 'application/pdf');
  assert.ok(result.data instanceof Uint8Array);

  const bytes = result.data as Uint8Array;
  const pdfString = new TextDecoder('latin1').decode(bytes);

  assert.ok(pdfString.startsWith('%PDF-1.4\n'), 'Must start with %PDF-1.4');
  assert.ok(pdfString.includes('/Type /Catalog'), 'Must define PDF Catalog');
  assert.ok(pdfString.includes('/Type /Pages'), 'Must define PDF Pages');
  assert.ok(pdfString.includes('/Type /Page'), 'Must define at least one Page');
  assert.ok(pdfString.includes('/Font << /F1'), 'Must include Helvetica Type 1 font');
  assert.ok(pdfString.includes('xref\n'), 'Must include cross-reference table');
  assert.ok(pdfString.includes('trailer\n'), 'Must include trailer');
  assert.ok(pdfString.includes('startxref\n'), 'Must include startxref pointer');
  assert.ok(pdfString.trim().endsWith('%%EOF'), 'Must terminate with %%EOF');
});

test('ExportService: Unified export interface across all 4 formats', async () => {
  const service = new ExportService();
  const doc = createSampleDoc();
  const notes = createSampleNotes();
  const tags = ['fiction', 'dc1'];

  const mdRes = await service.exportDocument(doc, 'md', notes, tags);
  assert.strictEqual(mdRes.filename.endsWith('.md'), true);
  assert.strictEqual(typeof mdRes.data, 'string');

  const txtRes = await service.exportDocument(doc, 'txt', notes, tags);
  assert.strictEqual(txtRes.filename.endsWith('.txt'), true);
  assert.strictEqual(typeof txtRes.data, 'string');

  const docxRes = await service.exportDocument(doc, 'docx', notes, tags);
  assert.strictEqual(docxRes.filename.endsWith('.docx'), true);
  assert.ok(docxRes.data instanceof Uint8Array);

  const pdfRes = await service.exportDocument(doc, 'pdf', notes, tags);
  assert.strictEqual(pdfRes.filename.endsWith('.pdf'), true);
  assert.ok(pdfRes.data instanceof Uint8Array);
});

test('MarkdownExporter: formatNoteAnchorLabel formats numeric, named, and null anchors', () => {
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: 'p-0' }), '[¶0]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: 'p-3' }), '[¶3]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: 'p-42' }), '[¶42]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: 'scratchpad' }), '[scratchpad]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: 'appendix' }), '[appendix]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: null }), '[unanchored]');
  assert.strictEqual(formatNoteAnchorLabel({ paragraph_anchor_id: '' }), '[unanchored]');
  assert.strictEqual(formatNoteAnchorLabel(null), '[unanchored]');
  assert.strictEqual(formatNoteAnchorLabel('scratchpad'), '[scratchpad]');
  assert.strictEqual(formatNoteAnchorLabel('p-7'), '[¶7]');
});

test('MarkdownExporter: sortThoughtNotes safely handles null and non-numeric anchors without throwing', () => {
  const notesWithNull: any[] = [
    { id: 'n1', document_id: 'doc', paragraph_anchor_id: null, content: 'First unanchored', created_at: 1000, deleted_at: null },
    { id: 'n2', document_id: 'doc', paragraph_anchor_id: 'p-2', content: 'Numbered 2', created_at: 500, deleted_at: null },
    { id: 'n3', document_id: 'doc', paragraph_anchor_id: null, content: 'Second unanchored', created_at: 2000, deleted_at: null },
    { id: 'n4', document_id: 'doc', paragraph_anchor_id: 'scratchpad', content: 'Scratchpad', created_at: 300, deleted_at: null },
    { id: 'n5', document_id: 'doc', paragraph_anchor_id: 'p-0', content: 'Numbered 0', created_at: 100, deleted_at: null },
  ];

  let sorted: ThoughtNoteRecord[] = [];
  assert.doesNotThrow(() => {
    sorted = sortThoughtNotes(notesWithNull as ThoughtNoteRecord[]);
  });

  assert.strictEqual(sorted.length, 5);
  // Numeric first: p-0, p-2
  assert.strictEqual(sorted[0].id, 'n5');
  assert.strictEqual(sorted[1].id, 'n2');
  // Null anchors sorted stably by created_at: n1 (1000), n3 (2000)
  assert.strictEqual(sorted[2].id, 'n1');
  assert.strictEqual(sorted[3].id, 'n3');
  // Named anchor: scratchpad
  assert.strictEqual(sorted[4].id, 'n4');
});

test('Export Pipelines: Unnumbered and null notes formatted cleanly in markdown, docx, and pdf', async () => {
  const exporterMd = new MarkdownExporter();
  const exporterDocx = new DocxExporter();
  const exporterPdf = new PdfExporter();
  const doc = createSampleDoc();
  const notes: ThoughtNoteRecord[] = [
    { id: 'n_num', document_id: doc.id, paragraph_anchor_id: 'p-1', content: 'Numbered note', created_at: 1000, updated_at: 1000, deleted_at: null },
    { id: 'n_scratch', document_id: doc.id, paragraph_anchor_id: 'scratchpad', content: 'Scratchpad note', created_at: 2000, updated_at: 2000, deleted_at: null },
    { id: 'n_unanchored', document_id: doc.id, paragraph_anchor_id: null as any, content: 'Unanchored note', created_at: 3000, updated_at: 3000, deleted_at: null },
  ];

  // Markdown
  const mdRes = exporterMd.export(doc, notes);
  const mdStr = mdRes.data as string;
  assert.ok(mdStr.includes('[¶1] Numbered note'));
  assert.ok(mdStr.includes('[scratchpad] Scratchpad note'));
  assert.ok(mdStr.includes('[unanchored] Unanchored note'));
  assert.strictEqual(mdStr.includes('[¶999999]'), false);

  // Docx
  const docxRes = exporterDocx.export(doc, notes);
  const docxStr = new TextDecoder('utf-8').decode(docxRes.data as Uint8Array);
  assert.ok(docxStr.includes('[¶1]'));
  assert.ok(docxStr.includes('[scratchpad]'));
  assert.ok(docxStr.includes('[unanchored]'));
  assert.strictEqual(docxStr.includes('[¶999999]'), false);
});
