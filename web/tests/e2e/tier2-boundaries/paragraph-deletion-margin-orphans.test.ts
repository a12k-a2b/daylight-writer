import test from 'node:test';
import assert from 'node:assert';
import { InMemoryStorageRepository } from '../helpers/mock-adapters.ts';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';

test('Tier 2 Boundary: Paragraph deletion retains attached margin notes in orphan state', async () => {
  const repo = new InMemoryStorageRepository();
  const dom = new DaylightDOMSimulator();

  await repo.saveDocument({
    id: 'doc-orphan-test',
    title: 'Draft with Notes',
    content: 'Paragraph 1.\n\nParagraph 2 to be deleted.\n\nParagraph 3.',
  });

  // Attach note to Paragraph 2 (anchor 'p-2')
  const note = await repo.saveNote({
    id: 'note-critical-idea',
    document_id: 'doc-orphan-test',
    paragraph_anchor_id: 'p-2',
    content: 'Do not lose this crucial argument!',
  });

  // Simulate user deleting Paragraph 2 from document
  dom.blocks = [
    { id: 'p-1', type: 'paragraph', text: 'Paragraph 1.', yOffset: 100, height: 50 },
    { id: 'p-3', type: 'paragraph', text: 'Paragraph 3.', yOffset: 180, height: 50 },
  ];

  dom.notes = [
    { id: note.id, paragraphAnchorId: 'p-2', content: note.content, topOffset: 200 },
  ];

  // Note must NOT be deleted from repository
  const storedNotes = await repo.getNotesForDocument('doc-orphan-test');
  assert.strictEqual(storedNotes.length, 1);
  assert.strictEqual(storedNotes[0].id, 'note-critical-idea');
  assert.strictEqual(storedNotes[0].deleted_at, null);

  // In DOM simulator, note remains visible with orphan status
  const offsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(offsets.has('note-critical-idea'), true);
  assert.strictEqual(offsets.get('note-critical-idea'), 200);
});

test('Tier 2 Boundary: Re-anchoring orphaned margin note to remaining paragraph', async () => {
  const repo = new InMemoryStorageRepository();

  const note = await repo.saveNote({
    id: 'note-reanchor',
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-deleted-old',
    content: 'Re-anchor me',
  });

  // User re-anchors note to p-1
  const reanchored = await repo.saveNote({
    id: note.id,
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-1',
    content: note.content,
  });

  assert.strictEqual(reanchored.paragraph_anchor_id, 'p-1');
  const fetched = await repo.getNotesForDocument('doc-1');
  assert.strictEqual(fetched[0].paragraph_anchor_id, 'p-1');
});

test('Tier 2 Boundary: Bulk paragraph deletion leaves multiple orphaned notes intact and stacked', () => {
  const dom = new DaylightDOMSimulator();

  // 3 notes were attached to paragraphs that are now removed
  dom.notes = [
    { id: 'n-1', paragraphAnchorId: 'deleted-1', content: 'Note 1', topOffset: 150 },
    { id: 'n-2', paragraphAnchorId: 'deleted-2', content: 'Note 2', topOffset: 160 },
    { id: 'n-3', paragraphAnchorId: 'deleted-3', content: 'Note 3', topOffset: 170 },
  ];

  // All target paragraphs are absent from blocks
  dom.blocks = [
    { id: 'p-survivor', type: 'paragraph', text: 'Sole surviving paragraph.', yOffset: 400, height: 60 },
  ];

  const offsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(offsets.size, 3);

  const top1 = offsets.get('n-1')!;
  const top2 = offsets.get('n-2')!;
  const top3 = offsets.get('n-3')!;

  // Notes must stack non-destructively rather than overlap
  assert.ok(top2 >= top1 + 80 + 16, `n-2 must stack below n-1: ${top2} >= ${top1 + 96}`);
  assert.ok(top3 >= top2 + 80 + 16, `n-3 must stack below n-2: ${top3} >= ${top2 + 96}`);
});
