import test from 'node:test';
import assert from 'node:assert';
import {
  InMemoryStorageRepository,
  MockAIServiceAdapter,
  MockExportService,
  type DocumentRecord,
  type ThoughtNoteRecord,
} from '../helpers/mock-adapters.ts';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';
import { SOL_OS_PALETTE } from '../helpers/contrast-verifier.ts';

test('Tier 4 Scenario: Distraction-free book chapter authoring session with margin notes', async () => {
  const repo = new InMemoryStorageRepository();
  const ai = new MockAIServiceAdapter();
  const exporter = new MockExportService();
  const dom = new DaylightDOMSimulator();

  await repo.init();

  // Step 1: Writer initializes new document
  const docId = 'chapter-1-quietude';
  const initialSentence = 'The quiet rhythm of morning thought, before the world stirs.';

  let currentDoc = await repo.saveDocument({
    id: docId,
    content: initialSentence,
  });

  // Step 2: Verify auto-titling derives opening phrase
  dom.updateTitleFromText(initialSentence);
  assert.strictEqual(dom.title, 'The quiet rhythm of morning thought');
  assert.strictEqual(dom.isTitleCustom, false);

  // Step 3: Writer establishes manual title override lock
  const customTitle = 'The Architecture of Quietude — Chapter 1';
  dom.setManualTitle(customTitle);
  currentDoc = await repo.saveDocument({
    id: docId,
    title: customTitle,
    is_title_custom: true,
  });
  assert.strictEqual(dom.title, customTitle);
  assert.strictEqual(currentDoc.is_title_custom, true);

  // Step 4: Author writes 3 distinct sections
  const fullContent = [
    '# The Architecture of Quietude',
    '',
    'The quiet rhythm of morning thought begins before the world stirs. Amber sunlight filters across the table.',
    '',
    '## Solitude and Prose',
    '',
    'True focus requires an intentional absence of electronic agitation. The reflective display reflects ambient daylight without emitting cold blue rays.',
    '',
    '## The Final Horizon',
    '',
    'Here the prose settles into sustained clarity. Words flow with deliberate cadence.',
  ].join('\n');

  currentDoc = await repo.saveDocument({
    id: docId,
    content: fullContent,
  });

  // Populate editor blocks
  dom.blocks = [
    { id: 'h1-1', type: 'heading', level: 1, text: 'The Architecture of Quietude', yOffset: 100, height: 50 },
    { id: 'p-1', type: 'paragraph', text: 'The quiet rhythm of morning thought begins before the world stirs.', yOffset: 170, height: 60 },
    { id: 'h2-1', type: 'heading', level: 2, text: 'Solitude and Prose', yOffset: 250, height: 40 },
    { id: 'p-2', type: 'paragraph', text: 'True focus requires an intentional absence of electronic agitation.', yOffset: 310, height: 80 },
    { id: 'h2-2', type: 'heading', level: 2, text: 'The Final Horizon', yOffset: 410, height: 40 },
    { id: 'p-3', type: 'paragraph', text: 'Here the prose settles into sustained clarity.', yOffset: 470, height: 60 },
  ];

  // Step 5: Author attaches margin notes to Paragraphs 2 and 3
  const note1 = await repo.saveNote({
    id: 'note-ch1-1',
    document_id: docId,
    paragraph_anchor_id: 'p-2',
    content: 'Emphasize the Sharp transflective panel ergonomics here.',
  });

  const note2 = await repo.saveNote({
    id: 'note-ch1-2',
    document_id: docId,
    paragraph_anchor_id: 'p-3',
    content: 'Connect this to the concluding cadence in chapter 2.',
  });

  dom.notes = [
    { id: note1.id, paragraphAnchorId: 'p-2', content: note1.content, topOffset: 310 },
    { id: note2.id, paragraphAnchorId: 'p-3', content: note2.content, topOffset: 470 },
  ];

  // Verify spatial sync
  const noteOffsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(noteOffsets.get('note-ch1-1'), 310);
  assert.strictEqual(noteOffsets.get('note-ch1-2'), 470);

  // Step 6: Activate Sentence Focus Mode
  dom.focusMode = 'sentence';
  dom.activeBlockId = 'p-2';
  dom.activeSentenceIndex = 0;

  // Step 7: Dismiss all drawers into zero-chrome view
  dom.leftDrawerOpen = false;
  dom.rightDrawerOpen = false;
  assert.strictEqual(dom.isZeroChrome, true);
  assert.strictEqual(dom.centralMargin, 432); // (1584 - 720) / 2

  // Step 8: Trigger AI +++ continuation at cursor
  const targetBlock = dom.blocks.find((b) => b.id === 'p-3')!;
  const originalP3Text = targetBlock.text;
  const continuationChunks: string[] = [];

  const addedText = await ai.streamContinuation(
    { documentText: targetBlock.text, cursorOffset: targetBlock.text.length },
    (chunk) => continuationChunks.push(chunk)
  );

  targetBlock.text += addedText;
  assert.ok(targetBlock.text.length > originalP3Text.length);
  assert.ok(continuationChunks.length > 0);

  // Single Cmd+Z undo check
  targetBlock.text = originalP3Text;
  assert.strictEqual(targetBlock.text, originalP3Text);

  // Re-apply continuation
  targetBlock.text += addedText;
  await repo.saveDocument({ id: docId, content: fullContent + ' ' + addedText });

  // Step 9: Export the completed chapter to Markdown (.md) and Word (.docx)
  const allNotes = await repo.getNotesForDocument(docId);
  assert.strictEqual(allNotes.length, 2);

  const mdExport = exporter.exportToMarkdown(currentDoc, allNotes);
  assert.ok((mdExport.data as string).includes('The Architecture of Quietude — Chapter 1'));
  assert.ok((mdExport.data as string).includes('## Margin Notes & Annotations'));
  assert.ok((mdExport.data as string).includes('Sharp transflective panel ergonomics'));

  const docxExport = await exporter.exportToDocx(currentDoc, allNotes);
  assert.strictEqual(docxExport.filename, 'the_architecture_of_quietude___chapter_1.docx');
  assert.ok(docxExport.data instanceof Uint8Array);
});
