import test from 'node:test';
import assert from 'node:assert';
import { InMemoryStorageRepository, MockAIServiceAdapter } from '../helpers/mock-adapters.ts';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';

test('Tier 3 Combination: Running Cmd+K text transformations on text with attached margin notes', async () => {
  const repo = new InMemoryStorageRepository();
  const ai = new MockAIServiceAdapter();
  const dom = new DaylightDOMSimulator();

  const doc = await repo.saveDocument({
    id: 'doc-cmdk-margin',
    title: 'Transformations & Notes',
    content: 'The old manuscript was written by ancient scribes with great reverence.',
  });

  // Attach a margin note to paragraph p-1
  const note = await repo.saveNote({
    id: 'note-anchor-check',
    document_id: doc.id,
    paragraph_anchor_id: 'p-1',
    content: 'Check provenance of this manuscript.',
  });

  dom.blocks = [
    {
      id: 'p-1',
      type: 'paragraph',
      text: doc.content,
      yOffset: 150,
      height: 60,
    },
  ];

  dom.notes = [
    {
      id: note.id,
      paragraphAnchorId: 'p-1',
      content: note.content,
      topOffset: 150,
    },
  ];

  // Verify initial spatial alignment
  let noteOffsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(noteOffsets.get('note-anchor-check'), 150);

  // User highlights text and triggers Cmd+K: 'fix_grammar'
  const transformedText = await ai.transformText({
    selectedText: dom.blocks[0].text,
    instruction: 'fix_grammar',
  });

  // Apply transformation to block p-1 without destroying block ID
  dom.blocks[0].text = transformedText;
  await repo.saveDocument({ id: doc.id, content: transformedText });

  // Verify paragraph anchor ID is unchanged
  assert.strictEqual(dom.blocks[0].id, 'p-1');

  // Verify note remains anchored to p-1 and spatially synchronized
  noteOffsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(noteOffsets.get('note-anchor-check'), 150);

  const persistedNotes = await repo.getNotesForDocument(doc.id);
  assert.strictEqual(persistedNotes.length, 1);
  assert.strictEqual(persistedNotes[0].paragraph_anchor_id, 'p-1');
  assert.strictEqual(persistedNotes[0].content, 'Check provenance of this manuscript.');
});
