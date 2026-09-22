import test from 'node:test';
import assert from 'node:assert';
import {
  MockExportService,
  InMemoryStorageRepository,
  type DocumentRecord,
  type ThoughtNoteRecord,
} from '../helpers/mock-adapters.ts';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';

test('Tier 3 Combination: Multi-format export while focus mode is active and hierarchical tags are set', async () => {
  const repo = new InMemoryStorageRepository();
  const exporter = new MockExportService();
  const dom = new DaylightDOMSimulator();

  // 1. Setup document with hierarchical tags
  const doc = await repo.saveDocument({
    id: 'doc-combo-export',
    title: 'Fieldwork Observations in the Alpine Valley',
    content: '# Alpine Valley Observations\n\n[¶1] The fog clings to the tree line at dawn.\n\n[¶2] We recorded temperature shifts every fifteen minutes.\n\n[¶3] The instruments remained steady despite the frost.',
  });

  const tags = ['#research/fieldwork', '#meteorology/alpine'];
  await repo.setDocumentTags(doc.id, tags);

  // 2. Attach margin notes to paragraphs
  const note1 = await repo.saveNote({
    id: 'note-alpine-1',
    document_id: doc.id,
    paragraph_anchor_id: 'p-1',
    content: 'Atmospheric pressure recorded at 1013 hPa.',
  });

  const note2 = await repo.saveNote({
    id: 'note-alpine-2',
    document_id: doc.id,
    paragraph_anchor_id: 'p-2',
    content: 'Verify calibration on sensor B.',
  });

  // 3. Activate sentence focus mode in DOM
  dom.focusMode = 'sentence';
  dom.activeBlockId = 'p-2';
  dom.activeSentenceIndex = 0;

  // 4. Trigger exports across all 4 formats while focus mode is active in UI
  const fetchedTags = await repo.getDocumentTags(doc.id);
  const notes = await repo.getNotesForDocument(doc.id);

  // A. Markdown Export
  const mdResult = exporter.exportToMarkdown(doc, notes, fetchedTags);
  const mdText = mdResult.data as string;
  assert.ok(mdText.includes('title: "Fieldwork Observations in the Alpine Valley"'));
  assert.ok(mdText.includes('research/fieldwork'));
  assert.ok(mdText.includes('meteorology/alpine'));
  assert.ok(mdText.includes('The fog clings to the tree line at dawn.'));
  assert.ok(mdText.includes('Atmospheric pressure recorded at 1013 hPa.'));
  assert.ok(mdText.includes('Verify calibration on sensor B.'));

  // B. Plain Text Export
  const txtResult = exporter.exportToPlainText(doc, notes, fetchedTags);
  const txtText = txtResult.data as string;
  assert.ok(txtText.includes('Tags: #research/fieldwork, #meteorology/alpine'));
  assert.ok(txtText.includes('Atmospheric pressure recorded at 1013 hPa.'));

  // C. Word (.docx) Export
  const docxResult = await exporter.exportToDocx(doc, notes, fetchedTags);
  assert.strictEqual(docxResult.filename, 'fieldwork_observations_in_the_alpine_valley.docx');
  assert.ok(docxResult.data instanceof Uint8Array);

  // D. PDF (.pdf) Export
  const pdfResult = await exporter.exportToPdf(doc, notes, fetchedTags);
  assert.strictEqual(pdfResult.filename, 'fieldwork_observations_in_the_alpine_valley.pdf');
  assert.ok(pdfResult.data instanceof Uint8Array);
});
