/**
 * tests/unit/sync-scroll.test.ts
 * Unit tests for Synchronized Scroll Tracking, Zero-Chrome Dismissal & Geometry (F14, F19, F22)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  SynchronizedScrollEngine,
  DrawerStateManager,
  calculateAlignedNoteOffsets,
  calculateDetailedNoteLayouts,
  type ParagraphBlockInfo,
  type ThoughtNoteAnchor,
} from '../../src/drawers/sync-scroll.ts';

test('DrawerStateManager: Initial zero-chrome state and getters', () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const backdrop = doc.createElement('div');

  const manager = new DrawerStateManager(shell as unknown as HTMLElement, backdrop as unknown as HTMLElement);

  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.deepStrictEqual(manager.state, {
    leftOpen: false,
    rightOpen: false,
    isZeroChrome: true,
  });
  assert.ok(shell.classList.contains('zero-chrome'));
});

test('DrawerStateManager: Toggling left and right drawers and simultaneous dual open', () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const manager = new DrawerStateManager(shell as unknown as HTMLElement);

  // Toggle left open
  manager.toggleLeft();
  assert.strictEqual(manager.leftOpen, true);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, false);
  assert.ok(shell.classList.contains('left-open'));
  assert.ok(!shell.classList.contains('zero-chrome'));

  // Toggle right open -> Both are open simultaneously (1584px LivePaper layout)
  manager.toggleRight();
  assert.strictEqual(manager.leftOpen, true);
  assert.strictEqual(manager.rightOpen, true);
  assert.strictEqual(manager.isZeroChrome, false);
  assert.ok(shell.classList.contains('left-open'));
  assert.ok(shell.classList.contains('right-open'));

  // Toggle left closed
  manager.toggleLeft();
  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.rightOpen, true);
  assert.ok(!shell.classList.contains('left-open'));
  assert.ok(shell.classList.contains('right-open'));

  // Dismiss all (Escape / backdrop)
  manager.dismissAll();
  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.ok(shell.classList.contains('zero-chrome'));
  assert.ok(!shell.classList.contains('left-open'));
  assert.ok(!shell.classList.contains('right-open'));
});

test('DrawerStateManager: Explicit open/close methods and subscriptions', () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const manager = new DrawerStateManager(shell as unknown as HTMLElement);

  const states: any[] = [];
  const unsubscribe = manager.subscribe((state) => {
    states.push({ ...state });
  });

  // Initial state received on subscribe
  assert.strictEqual(states.length, 1);
  assert.strictEqual(states[0].isZeroChrome, true);

  manager.openLeft();
  assert.strictEqual(states.length, 2);
  assert.strictEqual(states[1].leftOpen, true);

  manager.openRight();
  assert.strictEqual(states.length, 3);
  assert.strictEqual(states[2].rightOpen, true);

  manager.closeLeft();
  assert.strictEqual(states.length, 4);
  assert.strictEqual(states[3].leftOpen, false);

  manager.closeRight();
  assert.strictEqual(states.length, 5);
  assert.strictEqual(states[4].isZeroChrome, true);

  unsubscribe();
  manager.openLeft();
  // Listener no longer called after unsubscribe
  assert.strictEqual(states.length, 5);
});

test('DrawerStateManager: Keyboard shortcuts (Esc, Cmd+[, Cmd+]) and Backdrop Light-Dismiss', () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const backdrop = doc.createElement('div');
  const target = doc.createElement('div');

  const manager = new DrawerStateManager(shell as unknown as HTMLElement, backdrop as unknown as HTMLElement);
  manager.bindKeyboardShortcuts(target as unknown as HTMLElement);

  // 1. Press Cmd+[ -> Opens Left Drawer
  const cmdBracketLeft = new win.KeyboardEvent('keydown', { key: '[', metaKey: true });
  target.dispatchEvent(cmdBracketLeft);
  assert.strictEqual(manager.leftOpen, true);
  assert.strictEqual(manager.rightOpen, false);

  // 2. Press Cmd+] -> Opens Right Drawer
  const cmdBracketRight = new win.KeyboardEvent('keydown', { key: ']', metaKey: true });
  target.dispatchEvent(cmdBracketRight);
  assert.strictEqual(manager.leftOpen, true);
  assert.strictEqual(manager.rightOpen, true);

  // 3. Press Escape -> Restores Zero-Chrome
  const escEvent = new win.KeyboardEvent('keydown', { key: 'Escape' });
  target.dispatchEvent(escEvent);
  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, true);

  // 4. Open Right Drawer and click backdrop -> Dismisses
  manager.openRight();
  assert.strictEqual(manager.rightOpen, true);

  const clickEvent = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  backdrop.dispatchEvent(clickEvent);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, true);

  manager.destroy();
});

test('SynchronizedScrollEngine: 1:1 Scroll synchronization, padding and height synchronization', () => {
  const win = new Window();
  const doc = win.document;

  const editorScrollContainer = doc.createElement('div');
  const marginScrollContainer = doc.createElement('div');
  const editorCanvas = doc.createElement('div');
  const marginNotesList = doc.createElement('div');

  Object.defineProperty(editorCanvas, 'scrollHeight', { value: 3200, configurable: true });
  Object.defineProperty(editorCanvas, 'offsetHeight', { value: 3200, configurable: true });

  const engine = new SynchronizedScrollEngine({
    editorScrollContainer: editorScrollContainer as unknown as HTMLElement,
    marginScrollContainer: marginScrollContainer as unknown as HTMLElement,
    editorCanvas: editorCanvas as unknown as HTMLElement,
    marginNotesList: marginNotesList as unknown as HTMLElement,
    deadbandEpsilon: 1.0,
    bidirectional: true,
  });

  // Verify padding application (F05 / 592px midpoint)
  assert.strictEqual(marginScrollContainer.style.paddingTop, 'calc(592px - 1.5em)');
  assert.strictEqual(marginScrollContainer.style.paddingBottom, '592px');

  // Verify height matching (prevents scroll clamping)
  assert.strictEqual(marginNotesList.style.minHeight, '3200px');

  // Sync from editor to margin
  engine.syncFromEditor(450);
  assert.strictEqual(marginScrollContainer.scrollTop, 450);

  // Deadband threshold: delta < 1.0px does not re-sync
  engine.syncFromEditor(450.4);
  assert.strictEqual(marginScrollContainer.scrollTop, 450);

  // Sync from margin to editor
  engine.syncFromMargin(800);
  assert.strictEqual(editorScrollContainer.scrollTop, 800);

  engine.destroy();
});

test('Spatial Alignment: calculateAlignedNoteOffsets satisfies unconstrained and collision stacking', () => {
  const blocks: ParagraphBlockInfo[] = [
    { id: 'p-1', type: 'paragraph', text: 'P1', yOffset: 100, height: 30 },
    { id: 'p-2', type: 'paragraph', text: 'P2', yOffset: 125, height: 30 },
    { id: 'p-3', type: 'paragraph', text: 'P3', yOffset: 600, height: 30 },
  ];

  const notes: ThoughtNoteAnchor[] = [
    { id: 'n-1', paragraphAnchorId: 'p-1', content: 'Note 1', topOffset: 0 },
    { id: 'n-2', paragraphAnchorId: 'p-2', content: 'Note 2', topOffset: 0 },
    { id: 'n-3', paragraphAnchorId: 'p-3', content: 'Note 3', topOffset: 0 },
  ];

  const offsets = calculateAlignedNoteOffsets(blocks, notes, 80, 16);

  const top1 = offsets.get('n-1')!;
  const top2 = offsets.get('n-2')!;
  const top3 = offsets.get('n-3')!;

  assert.strictEqual(top1, 100, 'Note 1 aligns with p-1 yOffset 100');
  // Collision: p-2 at 125 collides with Note 1 (100 + 80 + 16 = 196)
  assert.strictEqual(top2, 196, 'Note 2 stacks at 100 + 80 + 16 = 196');
  // Unconstrained: p-3 at 600 is well below Note 2 bottom (196 + 80 = 276)
  assert.strictEqual(top3, 600, 'Note 3 aligns with p-3 yOffset 600');
});

test('Spatial Alignment: calculateAlignedNoteOffsets retains orphaned notes at last known topOffset', () => {
  const blocks: ParagraphBlockInfo[] = [
    { id: 'p-survivor', type: 'paragraph', text: 'Survivor', yOffset: 400, height: 40 },
  ];

  const notes: ThoughtNoteAnchor[] = [
    { id: 'n-orphan-1', paragraphAnchorId: 'deleted-1', content: 'Orphan 1', topOffset: 150 },
    { id: 'n-orphan-2', paragraphAnchorId: 'deleted-2', content: 'Orphan 2', topOffset: 160 },
  ];

  const offsets = calculateAlignedNoteOffsets(blocks, notes, 80, 16);

  const top1 = offsets.get('n-orphan-1')!;
  const top2 = offsets.get('n-orphan-2')!;

  assert.strictEqual(top1, 150, 'Orphan 1 preserves last known offset 150');
  assert.strictEqual(top2, 150 + 80 + 16, 'Orphan 2 stacks non-destructively below Orphan 1');
});

test('Spatial Alignment: calculateDetailedNoteLayouts returns complete layout records with leader line targets', () => {
  const blocks: ParagraphBlockInfo[] = [
    { id: 'p-1', type: 'paragraph', text: 'P1', yOffset: 100, height: 25 },
    { id: 'p-2', type: 'paragraph', text: 'P2', yOffset: 130, height: 25 },
  ];

  const notes: ThoughtNoteAnchor[] = [
    { id: 'n-1', paragraphAnchorId: 'p-1', content: 'Note 1', topOffset: 0 },
    { id: 'n-2', paragraphAnchorId: 'p-2', content: 'Note 2', topOffset: 0 },
    { id: 'n-orphan', paragraphAnchorId: 'p-deleted', content: 'Orphaned note', topOffset: 500 },
  ];

  const layouts = calculateDetailedNoteLayouts(blocks, notes, 80, 16);
  assert.strictEqual(layouts.length, 3);

  const l1 = layouts[0];
  assert.strictEqual(l1.noteId, 'n-1');
  assert.strictEqual(l1.topOffset, 100);
  assert.strictEqual(l1.isOrphaned, false);
  assert.strictEqual(l1.hasCollisionOffset, false);
  assert.strictEqual(l1.leaderLineTargetY, 112); // yOffset + 12

  const l2 = layouts[1];
  assert.strictEqual(l2.noteId, 'n-2');
  assert.strictEqual(l2.topOffset, 196); // 100 + 80 + 16
  assert.strictEqual(l2.isOrphaned, false);
  assert.strictEqual(l2.hasCollisionOffset, true);
  assert.strictEqual(l2.leaderLineTargetY, 142); // 130 + 12

  const l3 = layouts[2];
  assert.strictEqual(l3.noteId, 'n-orphan');
  assert.strictEqual(l3.topOffset, 500);
  assert.strictEqual(l3.isOrphaned, true);
  assert.strictEqual(l3.leaderLineTargetY, undefined);
});
