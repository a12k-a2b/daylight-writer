import test from 'node:test';
import assert from 'node:assert';
import {
  InMemoryStorageRepository,
  MockAIServiceAdapter,
  MockExportService,
  type DocumentRecord,
  type ThoughtNoteRecord,
} from '../helpers/mock-adapters.ts';

test('Tier 4 Scenario: Research essay authoring with hierarchical tags and multi-format export', async () => {
  const repo = new InMemoryStorageRepository();
  const ai = new MockAIServiceAdapter();
  const exporter = new MockExportService();
  await repo.init();

  const docId = 'essay-fieldwork-2026';
  const essayTitle = 'Oral Histories of Transhumant Pastoralism in High Asia';

  // Step 1: Create essay and assign nested hierarchical tags
  const doc = await repo.saveDocument({
    id: docId,
    title: essayTitle,
    content: [
      '# Oral Histories of Transhumant Pastoralism',
      '',
      '[¶1] The mountain passes remain snowbound until late May.',
      '',
      '[¶2] The elder interviews were conducted in order to preserve ecological memory.',
      '',
      '[¶3] Migration routes follow ancestral grazing rights established centuries ago.',
    ].join('\n'),
  });

  const tags = ['#anthropology/pastoralism', '#fieldwork/interviews', '#asia/himalaya'];
  await repo.setDocumentTags(docId, tags);

  // Step 2: Attach research notes to specific paragraphs
  const note1 = await repo.saveNote({
    id: 'note-res-1',
    document_id: docId,
    paragraph_anchor_id: '¶2',
    content: 'Audio recording tape reel 04, timestamp 14:22.',
  });

  const note2 = await repo.saveNote({
    id: 'note-res-2',
    document_id: docId,
    paragraph_anchor_id: '¶3',
    content: 'Cross-reference with British colonial gazetteer (1892).',
  });

  // Step 3: Run critique checks on draft
  const critiqueIssues = await ai.runCritiqueChecks(doc.content);
  assert.ok(critiqueIssues.length > 0, 'Should detect writing issues in research draft');

  const wordyIssue = critiqueIssues.find((i) => i.type === 'clarity');
  assert.ok(wordyIssue, 'Should flag "in order to"');
  assert.strictEqual(wordyIssue.suggestion, 'to');

  // Step 4: Apply suggested critique replacement
  const cleanedContent = doc.content.replace('in order to', 'to');
  const updatedDoc = await repo.saveDocument({ id: docId, content: cleanedContent });
  assert.ok(!updatedDoc.content.includes('in order to'));

  // Step 5: Run Cmd+K transform on paragraph 3
  const p3Text = 'Migration routes follow ancestral grazing rights established centuries ago.';
  const transformedP3 = await ai.transformText({
    selectedText: p3Text,
    instruction: 'analytical',
  });
  assert.ok(transformedP3.startsWith('Empirical observation reveals:'));

  // Step 6: Context query assistant indexes text and notes
  const notes = await repo.getNotesForDocument(docId);
  const aiAnswer = await ai.queryContext('What archival references support the migration claims?', doc.content, notes);
  assert.ok(aiAnswer.includes('[Note:¶3]'), 'AI assistant must cite margin note [Note:¶3]');

  // Step 7: Export to PDF (.pdf) and Plain Text (.txt)
  const assignedTags = await repo.getDocumentTags(docId);

  const pdfExport = await exporter.exportToPdf(updatedDoc, notes, assignedTags);
  assert.strictEqual(pdfExport.filename, 'oral_histories_of_transhumant_pastoralism_in_high_asia.pdf');
  assert.strictEqual(pdfExport.mimeType, 'application/pdf');

  const txtExport = exporter.exportToPlainText(updatedDoc, notes, assignedTags);
  assert.ok((txtExport.data as string).includes('Tags: #anthropology/pastoralism, #fieldwork/interviews, #asia/himalaya'));
  assert.ok((txtExport.data as string).includes('MARGIN NOTES:'));
  assert.ok((txtExport.data as string).includes('tape reel 04'));

  // Step 8: Trigger native share
  const shareSuccess = await exporter.shareDocument(updatedDoc, 'pdf');
  assert.strictEqual(shareSuccess, true);
});
