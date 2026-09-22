/**
 * tests/unit/right-margin.test.ts
 * Unit tests for Right Thought Margin Scratchpad, Anchoring, Collision Stacking & Orphans (F17, F18, F20, F21)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { RightMarginDrawer } from '../../src/drawers/right-margin.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';

class MockEditor {
  public activeBlockId: string = 'p-1';
  public typewriterMidpoint: number = 592;
  public offsets: Map<string, { yOffset: number; height: number; text: string }> = new Map();

  getParagraphOffsets() {
    return this.offsets;
  }
}

test('RightMarginDrawer: Layout initialization, open/close/toggle and zero-chrome state', () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  shell.className = 'dc1-shell zero-chrome';
  const drawerEl = doc.createElement('aside');
  drawerEl.id = 'margin-drawer';
  drawerEl.className = 'drawer drawer-right';
  shell.appendChild(drawerEl);

  const repo = new InMemoryStorageRepository();
  const editor = new MockEditor();

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
  });

  margin.init();

  assert.strictEqual(margin.isOpen, false);
  assert.ok(!shell.classList.contains('right-open'));

  // Open drawer
  margin.open();
  assert.strictEqual(margin.isOpen, true);
  assert.ok(shell.classList.contains('right-open'));
  assert.ok(!shell.classList.contains('zero-chrome'));

  // Close drawer
  margin.close();
  assert.strictEqual(margin.isOpen, false);
  assert.ok(!shell.classList.contains('right-open'));
  assert.ok(shell.classList.contains('zero-chrome'));

  // Toggle drawer
  margin.toggle();
  assert.strictEqual(margin.isOpen, true);
  margin.toggle();
  assert.strictEqual(margin.isOpen, false);

  margin.destroy();
});

test('RightMarginDrawer: Paragraph anchor binding and note creation (F18)', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const drawerEl = doc.createElement('aside');
  drawerEl.id = 'margin-drawer';
  shell.appendChild(drawerEl);

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-m3', title: 'Test Doc', content: 'Sample text' });

  const editor = new MockEditor();
  editor.activeBlockId = 'p-2';
  editor.offsets.set('p-1', { yOffset: 100, height: 40, text: 'Paragraph 1' });
  editor.offsets.set('p-2', { yOffset: 250, height: 40, text: 'Paragraph 2' });

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
  });

  margin.init();
  await margin.loadDocumentNotes('doc-m3');

  // Create note anchored to active paragraph (p-2)
  const note = await margin.createNote();
  assert.ok(note.id);
  assert.strictEqual(note.paragraph_anchor_id, 'p-2');
  assert.strictEqual(note.document_id, 'doc-m3');

  // Check DOM card
  const card = margin.cardElements.get(note.id);
  assert.ok(card);
  const badge = card?.querySelector('.thought-note-anchor-badge');
  assert.strictEqual(badge?.textContent?.trim(), '¶ p-2');

  // Note should be saved in repository
  const storedNotes = await repo.getNotesForDocument('doc-m3');
  assert.strictEqual(storedNotes.length, 1);
  assert.strictEqual(storedNotes[0].id, note.id);

  margin.destroy();
});

test('RightMarginDrawer: Note content editing and debounced persistence', async () => {
  const win = new Window();
  const doc = win.document;
  const drawerEl = doc.createElement('aside');

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-edit', title: 'Edit Test', content: 'Text' });

  const editor = new MockEditor();
  editor.offsets.set('p-1', { yOffset: 100, height: 40, text: 'P1' });

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
    debounceSaveMs: 20, // Short debounce for testing
  });

  margin.init();
  await margin.loadDocumentNotes('doc-edit');

  const note = await margin.createNote('p-1');
  assert.strictEqual(note.content, '');

  // Update note content (0ms UI latency)
  margin.updateNoteContent(note.id, 'Fresh insight about character motivation');
  assert.strictEqual(margin.notes.get(note.id)?.content, 'Fresh insight about character motivation');

  // Wait for debounce timer
  await new Promise((resolve) => setTimeout(resolve, 50));

  const fetched = await repo.getNotesForDocument('doc-edit');
  assert.strictEqual(fetched[0].content, 'Fresh insight about character motivation');

  margin.destroy();
});

test('RightMarginDrawer: Non-destructive collision stacking & leader lines (F20)', async () => {
  const win = new Window();
  const doc = win.document;
  const drawerEl = doc.createElement('aside');

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-collide', title: 'Collide Test', content: 'Text' });

  const editor = new MockEditor();
  // Two paragraphs very close together (100 and 130)
  editor.offsets.set('p-1', { yOffset: 100, height: 25, text: 'P1' });
  editor.offsets.set('p-2', { yOffset: 130, height: 25, text: 'P2' });

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
    minGapPx: 16,
    defaultNoteHeight: 80,
  });

  margin.init();
  await margin.loadDocumentNotes('doc-collide');

  const note1 = await margin.createNote('p-1');
  const note2 = await margin.createNote('p-2');

  const offsets = margin.calculateNoteTopOffsets();
  const top1 = offsets.get(note1.id)!;
  const top2 = offsets.get(note2.id)!;

  assert.strictEqual(top1, 100);
  // Note 2 must stack non-destructively: 100 + 80 + 16 = 196
  assert.ok(top2 >= top1 + 80 + 16, `top2 ${top2} must be >= ${top1 + 96}`);

  // Trigger layout update and verify leader lines rendered
  margin.updateLayout();

  const card2 = margin.cardElements.get(note2.id);
  assert.ok(card2?.classList.contains('colliding'));

  // SVG paths should exist for leader lines
  const paths = margin.leaderSvgElement?.querySelectorAll('path');
  assert.ok(paths && paths.length >= 2, 'Leader lines should be rendered for active notes');

  margin.destroy();
});

test('RightMarginDrawer: Orphaned note retention when anchor paragraph is deleted (F21)', async () => {
  const win = new Window();
  const doc = win.document;
  const drawerEl = doc.createElement('aside');

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-orphan', title: 'Orphan Test', content: 'Text' });

  const editor = new MockEditor();
  editor.offsets.set('p-1', { yOffset: 100, height: 40, text: 'P1' });
  editor.offsets.set('p-deleted', { yOffset: 250, height: 40, text: 'P to delete' });

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
  });

  margin.init();
  await margin.loadDocumentNotes('doc-orphan');

  const note = await margin.createNote('p-deleted');
  margin.updateNoteContent(note.id, 'Crucial insight that must not vanish');

  // Verify initial position
  assert.strictEqual(margin.calculateNoteTopOffsets().get(note.id), 250);

  // Now delete paragraph from editor text
  editor.offsets.delete('p-deleted');

  // Recalculate layout
  const offsets = margin.calculateNoteTopOffsets();
  assert.strictEqual(offsets.has(note.id), true);
  assert.strictEqual(offsets.get(note.id), 250, 'Orphaned note preserves last known topOffset');

  // Note MUST still exist in repository
  const stored = await repo.getNotesForDocument('doc-orphan');
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].id, note.id);
  assert.strictEqual(stored[0].deleted_at, null);

  // Update layout and check orphaned styling
  margin.updateLayout();
  const card = margin.cardElements.get(note.id);
  assert.ok(card?.classList.contains('orphaned'));

  // Check orphaned section is shown
  assert.strictEqual(margin.orphanedSection?.style.display, 'flex');
  assert.strictEqual(margin.orphanedCountBadge?.textContent, '1');

  // Test Re-anchoring to p-1
  await margin.reanchorNote(note.id, 'p-1');
  assert.strictEqual(margin.notes.get(note.id)?.paragraph_anchor_id, 'p-1');
  assert.strictEqual(margin.calculateNoteTopOffsets().get(note.id), 100);

  margin.destroy();
});

test('RightMarginDrawer: Note deletion removes from memory, DOM, and repository', async () => {
  const win = new Window();
  const doc = win.document;
  const drawerEl = doc.createElement('aside');

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-del', title: 'Del Test', content: 'Text' });

  const editor = new MockEditor();
  editor.offsets.set('p-1', { yOffset: 100, height: 40, text: 'P1' });

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
  });

  margin.init();
  await margin.loadDocumentNotes('doc-del');

  const note = await margin.createNote('p-1');
  assert.strictEqual(margin.notes.size, 1);

  // Delete note
  await margin.deleteNote(note.id);
  assert.strictEqual(margin.notes.size, 0);
  assert.strictEqual(margin.cardElements.has(note.id), false);

  const stored = await repo.getNotesForDocument('doc-del');
  assert.strictEqual(stored.length, 0);

  margin.destroy();
});

test('RightMarginDrawer: Note cards include citation navigation attributes and getNoteCardElement works (Defect 5)', async () => {
  const win = new Window();
  const doc = win.document;
  const drawerEl = doc.createElement('aside');

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-cite', title: 'Citation Test', content: 'Text' });

  const editor = new MockEditor();
  editor.offsets.set('p-7', { yOffset: 150, height: 40, text: 'P7' });

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
    drawerElement: drawerEl as unknown as HTMLElement,
  });

  margin.init();
  await margin.loadDocumentNotes('doc-cite');

  const note = await margin.createNote('p-7');
  const card = margin.getNoteCardElement('p-7');
  assert.ok(card, 'Card must be retrievable by anchor paragraph ID');
  assert.strictEqual(card.dataset.noteId, note.id);
  assert.strictEqual(card.dataset.anchorId, 'p-7');
  assert.strictEqual(card.dataset.anchorParagraphId, 'p-7');

  // Verify textarea class has both classes
  const textarea = card.querySelector('.note-card-textarea') as HTMLTextAreaElement;
  assert.ok(textarea, 'Textarea must have note-card-textarea class');
  assert.ok(textarea.classList.contains('thought-note-textarea'));

  // Verify retrieval by note id
  const cardByNoteId = margin.getNoteCardElement(note.id);
  assert.strictEqual(cardByNoteId, card);

  margin.destroy();
});

