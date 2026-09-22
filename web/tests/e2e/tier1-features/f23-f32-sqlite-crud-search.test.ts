import test from 'node:test';
import assert from 'node:assert';
import { InMemoryStorageRepository } from '../helpers/mock-adapters.ts';

test('F24 & F27: Document CRUD Repository Operations - Full lifecycle', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  // 1. Create Document
  const created = await repo.saveDocument({
    id: 'doc-1',
    title: 'The Solitary Reader',
    content: 'Quiet hours spent in thoughtful study.',
  });
  assert.strictEqual(created.id, 'doc-1');
  assert.strictEqual(created.title, 'The Solitary Reader');
  assert.strictEqual(created.sync_status, 'pending');

  // 2. Read Document
  const readDoc = await repo.getDocument('doc-1');
  assert.ok(readDoc !== null);
  assert.strictEqual(readDoc?.content, 'Quiet hours spent in thoughtful study.');

  // 3. Update Document
  const updated = await repo.saveDocument({
    id: 'doc-1',
    content: 'Quiet hours spent in thoughtful study and contemplation.',
  });
  assert.strictEqual(updated.content, 'Quiet hours spent in thoughtful study and contemplation.');

  // 4. Soft Delete (F39)
  await repo.deleteDocument('doc-1');
  const deletedDoc = await repo.getDocument('doc-1');
  assert.strictEqual(deletedDoc, null, 'Soft-deleted doc should not be returned by getDocument');
});

test('F25 & F26: In-Memory Reactive Cache with Debounced WAL Disk Flush & Emergency Flush', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  // Save multiple edits into reactive cache (0ms typing response)
  await repo.saveDocument({ id: 'doc-fast-1', title: 'Edit 1', content: 'C1' });
  await repo.saveDocument({ id: 'doc-fast-2', title: 'Edit 2', content: 'C2' });

  // Verify documents are immediately readable in-memory before disk flush
  const doc1 = await repo.getDocument('doc-fast-1');
  assert.strictEqual(doc1?.title, 'Edit 1');

  // Trigger emergency flush on lifecycle event (beforeunload/pagehide)
  assert.strictEqual(repo.flushCount, 0);
  await repo.flushPendingEdits();
  assert.strictEqual(repo.flushCount, 1);

  // Still readable after flush
  const doc2 = await repo.getDocument('doc-fast-2');
  assert.strictEqual(doc2?.title, 'Edit 2');
});

test('F28: Margin Note CRUD & Paragraph Association Engine', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 'doc-parent', title: 'Parent Document', content: 'Paragraph content' });

  // Create margin note anchored to p-1
  const note = await repo.saveNote({
    id: 'note-101',
    document_id: 'doc-parent',
    paragraph_anchor_id: 'p-1',
    content: 'Fascinating thesis statement',
  });
  assert.strictEqual(note.document_id, 'doc-parent');
  assert.strictEqual(note.paragraph_anchor_id, 'p-1');

  // List notes for document
  const notes = await repo.getNotesForDocument('doc-parent');
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].content, 'Fascinating thesis statement');

  // Delete note
  await repo.deleteNote('note-101');
  const remainingNotes = await repo.getNotesForDocument('doc-parent');
  assert.strictEqual(remainingNotes.length, 0);
});

test('F29 & F30 & F32: Hierarchical Nested Tag Parser and Query Support', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 'doc-tag-1', title: 'Fieldwork Notes', content: 'Notes from the valley' });
  await repo.saveDocument({ id: 'doc-tag-2', title: 'Personal Diary', content: 'Daily thoughts' });

  // Associate hierarchical tags (#research/fieldwork, #research/interviews, #ideas)
  await repo.setDocumentTags('doc-tag-1', ['#research/fieldwork', '#summer2026']);
  await repo.setDocumentTags('doc-tag-2', ['#ideas/personal']);

  const tagsDoc1 = await repo.getDocumentTags('doc-tag-1');
  assert.ok(tagsDoc1.includes('research/fieldwork'));
  assert.ok(tagsDoc1.includes('summer2026'));

  // Query documents by parent tag prefix 'research'
  const researchDocs = await repo.listDocuments({ tagId: 'research' });
  assert.strictEqual(researchDocs.length, 1);
  assert.strictEqual(researchDocs[0].id, 'doc-tag-1');

  // Query by exact tag 'ideas/personal'
  const ideaDocs = await repo.listDocuments({ tagId: 'ideas/personal' });
  assert.strictEqual(ideaDocs.length, 1);
  assert.strictEqual(ideaDocs[0].id, 'doc-tag-2');
});

test('F31 & F41: Sub-50ms Fuzzy Search Engine with Weighted Multi-Attribute Scoring', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 'doc-search-1', title: 'Quantum Computing Theory', content: 'Physical qubits and gates.' });
  await repo.saveDocument({ id: 'doc-search-2', title: 'Classical Mechanics', content: 'Notes on quantum entanglement applications.' });
  await repo.saveDocument({ id: 'doc-search-3', title: 'Music and Architecture', content: 'Harmonics and acoustics.' });
  await repo.setDocumentTags('doc-search-3', ['#science/quantum']);

  const startTime = performance.now();
  const searchResults = await repo.searchDocuments('quantum');
  const elapsedMs = performance.now() - startTime;

  // Search must complete sub-50ms (benchmark <3ms)
  assert.ok(elapsedMs < 50, `Fuzzy search took ${elapsedMs.toFixed(2)}ms, expected < 50ms`);
  assert.strictEqual(searchResults.length, 3);

  // doc-search-1 has 'quantum' in title (score 10)
  // doc-search-3 has 'quantum' in tag (score 8)
  // doc-search-2 has 'quantum' in body (score 5)
  assert.strictEqual(searchResults[0].document.id, 'doc-search-1');
  assert.strictEqual(searchResults[1].document.id, 'doc-search-3');
  assert.strictEqual(searchResults[2].document.id, 'doc-search-2');
});
