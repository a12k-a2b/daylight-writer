/**
 * tests/unit/command-palette.test.ts
 * Unit test suite for Command Palette (Cmd+K) & Diff Preview (F45, F46, F47, F44)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  CommandPalette,
  BUILT_IN_ACTIONS,
  type QuickActionItem,
} from '../../src/ai/command-palette.ts';
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import { HistoryManager } from '../../src/editor/history.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';

function createPaletteEnv(initialDocText: string = 'The ancient text was written by scholars in silence.') {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;

  const shell = doc.createElement('div');
  shell.className = 'dc1-shell';
  doc.body.appendChild(shell);

  const scrollContainer = doc.createElement('div');
  scrollContainer.id = 'editor-scroll-container';
  const canvas = doc.createElement('div');
  canvas.id = 'editor-canvas';
  scrollContainer.appendChild(canvas);
  shell.appendChild(scrollContainer);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as any, canvas as any);
  editor.setContent(initialDocText);

  const history = new HistoryManager();
  const aiAdapter = new MockAIServiceAdapter();

  const palette = new CommandPalette({
    editor,
    history,
    aiAdapter,
    shellElement: shell as any,
  });

  return { win, doc, shell, scrollContainer, canvas, editor, history, aiAdapter, palette };
}

test('CommandPalette: Viewport Boundary Clamping & Centering (F45, F46)', () => {
  const { palette } = createPaletteEnv();

  // 1. Center of canvas
  const normalRect = { left: 600, top: 400, right: 700, bottom: 430, width: 100, height: 30 };
  const posNormal = palette.calculatePalettePosition(normalRect, 320, 240);
  assert.strictEqual(posNormal.left, 490, 'Horizontal center: 600 + 50 - 160 = 490');
  assert.strictEqual(posNormal.top, 438, '8px below: 430 + 8 = 438');
  assert.strictEqual(posNormal.flipped, false);

  // 2. Right edge boundary clamp
  const rightRect = { left: 1400, top: 400, right: 1550, bottom: 430, width: 150, height: 30 };
  const posRight = palette.calculatePalettePosition(rightRect, 320, 240);
  assert.ok(posRight.left + 320 <= 1584 - 16, 'Palette must not overflow 16px right margin');
  assert.strictEqual(posRight.left, 1248);

  // 3. Left edge boundary clamp
  const leftRect = { left: 10, top: 400, right: 50, bottom: 430, width: 40, height: 30 };
  const posLeft = palette.calculatePalettePosition(leftRect, 320, 240);
  assert.strictEqual(posLeft.left, 16, 'Palette must clamp to 16px left margin');

  // 4. Bottom boundary flip upward
  const bottomRect = { left: 600, top: 1100, right: 700, bottom: 1130, width: 100, height: 30 };
  const posBottom = palette.calculatePalettePosition(bottomRect, 320, 240);
  assert.strictEqual(posBottom.flipped, true, 'Must flip upward near bottom margin');
  assert.ok(posBottom.top < 1100, `Top (${posBottom.top}) must be above selection (1100)`);
  assert.strictEqual(posBottom.top, 852, '1100 - 240 - 8 = 852');
});

test('CommandPalette: Built-in quick actions catalog contains 8 core operations', () => {
  assert.strictEqual(BUILT_IN_ACTIONS.length, 8);
  const actionIds = BUILT_IN_ACTIONS.map((a) => a.id);
  assert.ok(actionIds.includes('rewrite'));
  assert.ok(actionIds.includes('concise'));
  assert.ok(actionIds.includes('expand'));
  assert.ok(actionIds.includes('analytical'));
  assert.ok(actionIds.includes('casual'));
  assert.ok(actionIds.includes('poetic'));
  assert.ok(actionIds.includes('fix_grammar'));
  assert.ok(actionIds.includes('summarize'));
});

test('CommandPalette: Token LCS diff computation identifies equal, delete, and insert', () => {
  const { palette } = createPaletteEnv();

  const original = 'The manuscript was written by the scholar.';
  const transformed = 'The manuscript wrote the scholar.';

  const diffs = palette.computeDiff(original, transformed);
  assert.ok(diffs.length >= 3);

  const deletes = diffs.filter((d) => d.type === 'delete');
  const inserts = diffs.filter((d) => d.type === 'insert');
  const equals = diffs.filter((d) => d.type === 'equal');

  assert.ok(deletes.some((d) => d.text.includes('was written by')));
  assert.ok(inserts.some((d) => d.text.includes('wrote')));
  assert.ok(equals.some((d) => d.text.includes('The manuscript')));
});

test('CommandPalette: Full execution flow with Diff Preview and Accept Replacement', async () => {
  const { palette, shell, editor, history } = createPaletteEnv(
    'The manuscript was written by the the scholar.'
  );

  palette.open();
  assert.strictEqual(palette.isOpen, true);
  assert.ok(shell.querySelector('.command-palette'));

  // Trigger fix_grammar action
  const fixGrammar = BUILT_IN_ACTIONS.find((a) => a.id === 'fix_grammar')!;
  await palette.executeAction(fixGrammar);

  // Palette transitions to diff_preview mode
  assert.strictEqual(palette.mode, 'diff_preview');
  assert.ok(palette.previewContainerEl?.querySelector('.diff-delete'));
  assert.ok(palette.previewContainerEl?.querySelector('.diff-insert'));

  // Accept replacement
  palette.acceptReplacement();

  assert.strictEqual(palette.isOpen, false);
  assert.strictEqual(editor.getContent(), 'The manuscript wrote the scholar.');

  // Verify atomic undo transaction in HistoryManager
  assert.strictEqual(history.canUndo(), true);
  const undoResult = history.undo(editor.getContent(), 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, 'The manuscript was written by the the scholar.');
});

test('CommandPalette: Block ID is preserved during transformation', async () => {
  const { palette, editor, canvas } = createPaletteEnv('Original paragraph block text.');

  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  blockEl.dataset.blockId = 'p-42';
  editor.activeBlockId = 'p-42';

  palette.open();
  const conciseAction = BUILT_IN_ACTIONS.find((a) => a.id === 'concise')!;
  await palette.executeAction(conciseAction);
  palette.acceptReplacement();

  // Paragraph element must still have blockId p-42
  const updatedBlock = canvas.querySelector('[data-block-id="p-42"]') as unknown as HTMLElement;
  assert.ok(updatedBlock, 'Paragraph data-block-id must be preserved across AI replacements');
  assert.strictEqual(updatedBlock.dataset.blockId, 'p-42');
});

test('CommandPalette: Esc key cancels replacement without history modification', async () => {
  const { palette, history, editor } = createPaletteEnv('Text to stay unchanged.');

  palette.open();
  const expandAction = BUILT_IN_ACTIONS.find((a) => a.id === 'expand')!;
  await palette.executeAction(expandAction);

  assert.strictEqual(palette.mode, 'diff_preview');

  // Cancel via Esc
  palette.cancelReplacement();

  assert.strictEqual(palette.isOpen, false);
  assert.strictEqual(editor.getContent(), 'Text to stay unchanged.');
  assert.strictEqual(history.canUndo(), false, 'Cancelled transform must not leave undo snapshots');
});
