import test from 'node:test';
import assert from 'node:assert';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';
import { InMemoryStorageRepository } from '../helpers/mock-adapters.ts';

test('F14 & F22: Single-Keystroke & Touch Zero-Chrome Dismissal - Esc dismisses all drawers', () => {
  const dom = new DaylightDOMSimulator();
  dom.leftDrawerOpen = true;
  dom.rightDrawerOpen = true;
  assert.strictEqual(dom.isZeroChrome, false);

  // Press Escape
  dom.handleKeyDown('Escape');
  assert.strictEqual(dom.leftDrawerOpen, false);
  assert.strictEqual(dom.rightDrawerOpen, false);
  assert.strictEqual(dom.isZeroChrome, true);
});

test('F14 & F22: Keyboard shortcuts toggle individual drawers (Cmd+[ and Cmd+])', () => {
  const dom = new DaylightDOMSimulator();
  assert.strictEqual(dom.leftDrawerOpen, false);
  assert.strictEqual(dom.rightDrawerOpen, false);

  // Cmd+[ toggles Left Drawer
  dom.handleKeyDown('[', true);
  assert.strictEqual(dom.leftDrawerOpen, true);
  assert.strictEqual(dom.rightDrawerOpen, false);

  // Cmd+] toggles Right Drawer
  dom.handleKeyDown(']', true);
  assert.strictEqual(dom.leftDrawerOpen, true);
  assert.strictEqual(dom.rightDrawerOpen, true);

  // Cmd+[ toggles Left Drawer off
  dom.handleKeyDown('[', true);
  assert.strictEqual(dom.leftDrawerOpen, false);
  assert.strictEqual(dom.rightDrawerOpen, true);
});

test('F15 & F17: Left and Right Drawer Layout Specifications', () => {
  const dom = new DaylightDOMSimulator();
  assert.strictEqual(dom.leftDrawerWidth, 320, 'Left Drawer must be 320px');
  assert.strictEqual(dom.rightDrawerWidth, 360, 'Right Drawer must be 360px');
});

test('F16: Document Library Date Sorting - Toggles between updated_at and created_at', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const now = Date.now();
  // Doc A: Created earlier (now - 2000), Updated later (now)
  await repo.saveDocument({
    id: 'doc-a',
    title: 'Doc A',
    content: 'A',
    created_at: now - 2000,
    updated_at: now,
  });

  // Doc B: Created later (now - 1000), Updated earlier (now - 500)
  await repo.saveDocument({
    id: 'doc-b',
    title: 'Doc B',
    content: 'B',
    created_at: now - 1000,
    updated_at: now - 500,
  });

  // Sort by updated_at descending (default)
  const byModified = await repo.listDocuments({ sortBy: 'updated_at', sortOrder: 'desc' });
  assert.strictEqual(byModified[0].id, 'doc-a');
  assert.strictEqual(byModified[1].id, 'doc-b');

  // Sort by created_at descending
  const byCreated = await repo.listDocuments({ sortBy: 'created_at', sortOrder: 'desc' });
  assert.strictEqual(byCreated[0].id, 'doc-b');
  assert.strictEqual(byCreated[1].id, 'doc-a');
});

test('F18 & F19: Thought Note Anchoring & Synchronous Spatial Tracking', () => {
  const dom = new DaylightDOMSimulator();
  
  dom.blocks = [
    { id: 'p-1', type: 'paragraph', text: 'Paragraph 1', yOffset: 120, height: 60 },
    { id: 'p-2', type: 'paragraph', text: 'Paragraph 2', yOffset: 340, height: 60 },
    { id: 'p-3', type: 'paragraph', text: 'Paragraph 3', yOffset: 650, height: 60 },
  ];

  dom.notes = [
    { id: 'note-1', paragraphAnchorId: 'p-1', content: 'Note on P1', topOffset: 0 },
    { id: 'note-2', paragraphAnchorId: 'p-3', content: 'Note on P3', topOffset: 0 },
  ];

  const offsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(offsets.get('note-1'), 120, 'Note 1 must align with p-1 yOffset 120');
  assert.strictEqual(offsets.get('note-2'), 650, 'Note 2 must align with p-3 yOffset 650');
});

test('F20: Margin Note Stacking & Collision Avoidance', () => {
  const dom = new DaylightDOMSimulator();
  
  // Two notes anchored very close to each other (p-1 at 100, p-2 at 130)
  dom.blocks = [
    { id: 'p-1', type: 'paragraph', text: 'Paragraph 1', yOffset: 100, height: 25 },
    { id: 'p-2', type: 'paragraph', text: 'Paragraph 2', yOffset: 130, height: 25 },
  ];

  dom.notes = [
    { id: 'note-1', paragraphAnchorId: 'p-1', content: 'First Note (80px tall)', topOffset: 0 },
    { id: 'note-2', paragraphAnchorId: 'p-2', content: 'Second Note', topOffset: 0 },
  ];

  const offsets = dom.calculateNoteTopOffsets();
  const top1 = offsets.get('note-1')!;
  const top2 = offsets.get('note-2')!;

  assert.strictEqual(top1, 100);
  // Note 1 height is 80px + 16px min gap -> Note 2 must stack at 196px
  assert.ok(top2 >= top1 + 80 + 16, `Note 2 must stack non-destructively: ${top2} >= ${top1 + 96}`);
});

test('F21: Orphaned Thought Note Retention - Retains notes when target paragraph is deleted', () => {
  const dom = new DaylightDOMSimulator();
  
  dom.blocks = [
    { id: 'p-1', type: 'paragraph', text: 'Paragraph 1', yOffset: 100, height: 60 },
  ];

  dom.notes = [
    { id: 'note-orphan', paragraphAnchorId: 'p-deleted-999', content: 'Thought preserved even if paragraph deleted', topOffset: 450 },
  ];

  const offsets = dom.calculateNoteTopOffsets();
  assert.strictEqual(offsets.has('note-orphan'), true);
  assert.strictEqual(offsets.get('note-orphan'), 450, 'Orphaned note preserves last known top offset');
});
