/**
 * tests/unit/history.test.ts
 * Unit tests for Undo/Redo History Transaction Manager (F44, typing bursts, atomic transactions)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { HistoryManager } from '../../src/editor/history.ts';

test('History: Basic undo and redo restores previous and forward states', () => {
  const history = new HistoryManager({ typingBurstDebounceMs: 10 });

  history.recordTyping('Initial text', 12);
  history.commitBurst();
  history.recordTyping('Initial text with added thoughts', 32);

  assert.strictEqual(history.canUndo(), true);
  assert.strictEqual(history.canRedo(), false);

  const prev = history.undo('Initial text with added thoughts', 32);
  assert.ok(prev);
  assert.strictEqual(prev.content, 'Initial text');
  assert.strictEqual(prev.caretOffset, 12);
  assert.strictEqual(history.canRedo(), true);

  const next = history.redo('Initial text', 12);
  assert.ok(next);
  assert.strictEqual(next.content, 'Initial text with added thoughts');
  assert.strictEqual(next.caretOffset, 32);
});

test('History: 500ms typing burst debouncing groups rapid keystrokes into single transaction', async () => {
  const history = new HistoryManager({ typingBurstDebounceMs: 50 });

  // Rapid burst typing (within 50ms)
  history.recordTyping('H', 1);
  history.recordTyping('He', 2);
  history.recordTyping('Hel', 3);
  history.recordTyping('Hell', 4);
  history.recordTyping('Hello', 5);

  // Only the initial burst start state was recorded
  assert.strictEqual(history.getUndoCount(), 1);

  // Wait past debounce threshold
  await new Promise((r) => setTimeout(r, 60));

  // Second burst
  history.recordTyping('Hello World', 11);
  assert.strictEqual(history.getUndoCount(), 2);

  // Undo reverts to initial state before second burst
  const undoResult = history.undo('Hello World', 11);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, 'H');
});

test('History: Atomic single-step undo for AI continuation (F44)', () => {
  const history = new HistoryManager();
  const baseText = 'The author sat quietly in the morning light.';
  const baseCaret = baseText.length;

  // AI begins streaming continuation after +++
  history.beginAtomicTransaction('ai_continuation', baseText, baseCaret);

  // Simulated streaming token chunks (do not create individual undo entries)
  const chunk1 = ' A soft breeze stirred the curtains.';
  const chunk2 = ' The ink on the page remained crisp.';
  const streamedContent = baseText + chunk1 + chunk2;

  // Stream completes: commit atomic transaction
  history.commitAtomicTransaction(streamedContent, streamedContent.length);

  assert.strictEqual(history.getUndoCount(), 1);

  // Single Cmd+Z undo completely reverts the entire multi-sentence AI continuation
  const reverted = history.undo(streamedContent, streamedContent.length);
  assert.ok(reverted);
  assert.strictEqual(reverted.content, baseText);
  assert.strictEqual(reverted.caretOffset, baseCaret);
  assert.strictEqual(reverted.type, 'ai_continuation');

  // Redo restores the full AI continuation
  const redone = history.redo(baseText, baseCaret);
  assert.ok(redone);
  assert.strictEqual(redone.content, streamedContent);
});

test('History: Abort atomic transaction discards pending snapshot', () => {
  const history = new HistoryManager();
  history.beginAtomicTransaction('ai_continuation', 'Pre-AI text', 11);
  history.abortAtomicTransaction();
  history.commitAtomicTransaction('Altered text', 12);

  assert.strictEqual(history.canUndo(), false);
});

test('History: Enforces maximum stack size limit', () => {
  const history = new HistoryManager({ maxStackSize: 5, typingBurstDebounceMs: 0 });

  for (let i = 1; i <= 10; i++) {
    history.recordTyping(`State ${i}`, i);
    history.commitBurst();
  }

  assert.strictEqual(history.getUndoCount(), 5);
});

test('History: Keyboard shortcuts Cmd+Z and Cmd+Shift+Z trigger undo/redo', () => {
  const win = new Window();
  const doc = win.document;
  const canvasEl = doc.createElement('div');
  doc.body.appendChild(canvasEl);

  const history = new HistoryManager();
  history.recordTyping('State A', 7);
  history.commitBurst();
  history.recordTyping('State B', 7);

  let restoredContent = '';

  const cleanup = history.bindKeyboardShortcuts(canvasEl as unknown as HTMLElement, {
    getContent: () => 'State B',
    getCaret: () => 7,
    restoreState: (snapshot) => {
      restoredContent = snapshot.content;
    },
  });

  // Dispatch Cmd+Z
  const undoEvent = new win.KeyboardEvent('keydown', {
    key: 'z',
    metaKey: true,
    bubbles: true,
  });
  canvasEl.dispatchEvent(undoEvent);

  assert.strictEqual(restoredContent, 'State A');

  // Dispatch Cmd+Shift+Z (Redo)
  const redoEvent = new win.KeyboardEvent('keydown', {
    key: 'z',
    metaKey: true,
    shiftKey: true,
    bubbles: true,
  });
  canvasEl.dispatchEvent(redoEvent);

  assert.strictEqual(restoredContent, 'State B');

  cleanup();
});
