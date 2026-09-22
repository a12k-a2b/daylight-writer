import test from 'node:test';
import assert from 'node:assert';
import { MockExportService, type DocumentRecord, type ThoughtNoteRecord } from '../helpers/mock-adapters.ts';

const sampleDoc: DocumentRecord = {
  id: 'doc-export-1',
  title: 'Reflections on Silence',
  content: '# Reflections on Silence\n\nSilence is not empty; it is the space where thought takes root.\n\n## Modern Distractions\n\nNotifications interrupt the delicate cadence of deep writing.',
  created_at: 1774000000000,
  updated_at: 1774050000000,
  deleted_at: null,
  is_title_custom: false,
  format_version: 1,
  sync_status: 'synced',
};

const sampleNotes: ThoughtNoteRecord[] = [
  {
    id: 'note-1',
    document_id: 'doc-export-1',
    paragraph_anchor_id: 'p-1',
    content: 'Add reference to Thoreau Walden chapter on solitude.',
    created_at: 1774010000000,
    updated_at: 1774010000000,
    deleted_at: null,
  },
];

const sampleTags = ['philosophy/solitude', 'drafts'];

test('F54: CommonMark Markdown (.md) Export Pipeline - YAML frontmatter and notes appendix', () => {
  const exporter = new MockExportService();
  const res = exporter.exportToMarkdown(sampleDoc, sampleNotes, sampleTags);

  assert.strictEqual(res.filename, 'reflections_on_silence.md');
  assert.strictEqual(res.mimeType, 'text/markdown; charset=utf-8');
  assert.strictEqual(typeof res.data, 'string');

  const mdText = res.data as string;
  assert.ok(mdText.startsWith('---'), 'Markdown export must contain YAML frontmatter');
  assert.ok(mdText.includes('title: "Reflections on Silence"'));
  assert.ok(mdText.includes('tags: ["philosophy/solitude", "drafts"]'));
  assert.ok(mdText.includes('## Margin Notes & Annotations'));
  assert.ok(mdText.includes('* **[p-1]**: Add reference to Thoreau'));
});

test('F55: UTF-8 Plain Text (.txt) Export Pipeline - ASCII banner and formatted notes', () => {
  const exporter = new MockExportService();
  const res = exporter.exportToPlainText(sampleDoc, sampleNotes, sampleTags);

  assert.strictEqual(res.filename, 'reflections_on_silence.txt');
  assert.strictEqual(res.mimeType, 'text/plain; charset=utf-8');

  const txt = res.data as string;
  assert.ok(txt.includes('REFLECTIONS ON SILENCE'));
  assert.ok(txt.includes('Last Modified:'));
  assert.ok(txt.includes('Tags: #philosophy/solitude, #drafts'));
  assert.ok(txt.includes('MARGIN NOTES:'));
  assert.ok(txt.includes('[p-1]: Add reference to Thoreau'));
});

test('F56: Microsoft Word (.docx) Export Pipeline - Client-Side OOXML Package', async () => {
  const exporter = new MockExportService();
  const res = await exporter.exportToDocx(sampleDoc, sampleNotes, sampleTags);

  assert.strictEqual(res.filename, 'reflections_on_silence.docx');
  assert.strictEqual(res.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(res.data instanceof Uint8Array);

  const bytes = res.data as Uint8Array;
  // Valid ZIP file header signature PK\x03\x04: 0x50, 0x4B, 0x03, 0x04
  assert.strictEqual(bytes[0], 0x50, 'Byte 0 must be P');
  assert.strictEqual(bytes[1], 0x4B, 'Byte 1 must be K');
  assert.strictEqual(bytes[2], 0x03, 'Byte 2 must be 0x03');
  assert.strictEqual(bytes[3], 0x04, 'Byte 3 must be 0x04');
});

test('F57: Vector PDF (.pdf) Export Pipeline - Valid PDF header', async () => {
  const exporter = new MockExportService();
  const res = await exporter.exportToPdf(sampleDoc, sampleNotes, sampleTags);

  assert.strictEqual(res.filename, 'reflections_on_silence.pdf');
  assert.strictEqual(res.mimeType, 'application/pdf');
  assert.ok(res.data instanceof Uint8Array);

  const decoder = new TextDecoder();
  const pdfString = decoder.decode(res.data as Uint8Array);
  // Valid PDF header must begin with %PDF-
  assert.ok(pdfString.startsWith('%PDF-'), 'PDF export must begin with %PDF- header');
  assert.ok(pdfString.includes('%%EOF'), 'PDF export must end with %%EOF');
});

test('F58: Native Web Share API Integration', async () => {
  const exporter = new MockExportService();
  const shared = await exporter.shareDocument(sampleDoc, 'md');
  assert.strictEqual(shared, true);
});

test('F59: Native Email Composition Fallback (mailto:) - Clamping at safe URI limit', () => {
  const exporter = new MockExportService();

  // 1. Standard length document
  const normalRes = exporter.composeEmail(sampleDoc);
  assert.ok(normalRes.url.startsWith('mailto:?subject='));
  assert.strictEqual(normalRes.truncated, false);

  // 2. Extremely long document (>2000 chars)
  const hugeContent = 'A'.repeat(3000);
  const hugeDoc = { ...sampleDoc, content: hugeContent };
  const hugeRes = exporter.composeEmail(hugeDoc);

  assert.strictEqual(hugeRes.truncated, true);
  assert.ok(hugeRes.url.includes('truncated'), 'URL body must contain truncation notice');
  assert.ok(hugeRes.url.length <= 2500, 'URL length must stay well within browser limits');
});
