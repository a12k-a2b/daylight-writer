/**
 * tests/unit/inline-continuation.test.ts
 * Unit tests for Inline Continuation Engine (F42, F43, F44, F52, F53)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  InlineContinuationEngine,
  detectContinuationTrigger,
} from '../../src/ai/inline-continuation.ts';
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import { HistoryManager } from '../../src/editor/history.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';

function createTestEnvironment(initialText: string = 'The sun sets over the mountains.') {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;

  const scrollContainer = doc.createElement('div');
  scrollContainer.id = 'editor-scroll-container';
  const canvas = doc.createElement('div');
  canvas.id = 'editor-canvas';
  scrollContainer.appendChild(canvas);
  doc.body.appendChild(scrollContainer);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as any, canvas as any);
  editor.setContent(initialText);

  const history = new HistoryManager();
  const aiAdapter = new MockAIServiceAdapter({
    cannedContinuationText: 'casting long amber shadows across the plains.',
  });

  const engine = new InlineContinuationEngine(editor, aiAdapter, history);
  engine.attach(canvas as any);

  return { win, doc, scrollContainer, canvas, editor, history, aiAdapter, engine };
}

test('detectContinuationTrigger: accurately identifies +++ trigger and strips buffer', () => {
  // 1. Standard sentence ending
  const res1 = detectContinuationTrigger('The landscape was still +++');
  assert.strictEqual(res1.triggered, true);
  assert.strictEqual(res1.strippedBuffer, 'The landscape was still ');

  // 2. New line trigger
  const res2 = detectContinuationTrigger('First paragraph.\n\n+++');
  assert.strictEqual(res2.triggered, true);
  assert.strictEqual(res2.strippedBuffer, 'First paragraph.\n\n');

  // 3. Negative case
  const res3 = detectContinuationTrigger('Just normal text ++');
  assert.strictEqual(res3.triggered, false);
  assert.strictEqual(res3.strippedBuffer, 'Just normal text ++');

  // 4. Empty string
  const res4 = detectContinuationTrigger('');
  assert.strictEqual(res4.triggered, false);
  assert.strictEqual(res4.strippedBuffer, '');
});

test('InlineContinuationEngine: triggers, streams ghost ink, and solidifies on completion', async () => {
  const { editor, engine, canvas } = createTestEnvironment('First sentence.');

  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  assert.ok(blockEl);

  // User typed '+++'
  blockEl.textContent = 'First sentence. +++';

  const streamPromise = engine.triggerContinuation(blockEl, 'First sentence. ');
  assert.strictEqual(engine.getState(), 'streaming');
  assert.strictEqual(engine.isStreaming(), true);

  // During streaming, ghost span exists
  const ghostSpan = blockEl.querySelector('.ai-streaming-token') as unknown as HTMLElement;
  assert.ok(ghostSpan, 'Ghost span should be mounted');
  assert.strictEqual(ghostSpan.dataset.ghost, 'true');

  const fullText = await streamPromise;
  assert.ok(fullText);
  assert.ok(fullText.includes('amber shadows'));

  // After completion, engine is idle and ghost span is solidified
  assert.strictEqual(engine.getState(), 'idle');
  assert.strictEqual(blockEl.querySelector('.ai-streaming-token'), null, 'Ghost span should be removed/unwrapped');
  assert.ok(blockEl.textContent?.includes('First sentence.  casting long amber shadows'));
  assert.ok(editor.getContent().includes('amber shadows'));
});

test('InlineContinuationEngine: Single-step atomic undo (F44) reverts full continuation in 1 stroke', async () => {
  const { editor, history, engine, canvas } = createTestEnvironment('The ancient library stood quiet.');

  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  const initialContent = editor.getContent();

  // Run continuation
  await engine.triggerContinuation(blockEl, initialContent + ' ');
  const generatedContent = editor.getContent();

  assert.ok(generatedContent.length > initialContent.length);
  assert.strictEqual(history.canUndo(), true);

  // Single Cmd+Z undo
  const undoSnapshot = history.undo(generatedContent, editor.caretPosition.charOffset);
  assert.ok(undoSnapshot, 'Undo snapshot should exist');
  assert.strictEqual(undoSnapshot.content, initialContent, 'Single undo must revert completely to pre-trigger state');

  editor.setContent(undoSnapshot.content);
  assert.strictEqual(editor.getContent(), initialContent);

  // Single Cmd+Shift+Z redo
  const redoSnapshot = history.redo(initialContent, 0);
  assert.ok(redoSnapshot);
  assert.strictEqual(redoSnapshot.content, generatedContent);
});

test('InlineContinuationEngine: Esc key cancels stream, erases ghost ink, zero history pollution', async () => {
  const { editor, history, engine, canvas, aiAdapter, win } = createTestEnvironment('Waiting for silence.');

  aiAdapter.simulatedDelayMs = 25;
  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  const initialContent = editor.getContent();

  // Start continuation
  const streamPromise = engine.triggerContinuation(blockEl, initialContent + ' ');
  assert.strictEqual(engine.isStreaming(), true);

  // Fire Escape
  engine.handleKeyDown(new win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as KeyboardEvent);

  await streamPromise;

  assert.strictEqual(engine.getState(), 'idle');
  assert.strictEqual(blockEl.querySelector('.ai-streaming-token'), null);
  assert.strictEqual(history.canUndo(), false, 'Cancelled continuation must not create undo history');
});

test('InlineContinuationEngine: Tab key immediately accepts and solidifies current ghost ink', async () => {
  const { editor, history, engine, canvas, aiAdapter, win } = createTestEnvironment('Drafting.');

  aiAdapter.simulatedDelayMs = 20;
  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;

  const streamPromise = engine.triggerContinuation(blockEl, 'Drafting. ');
  assert.strictEqual(engine.isStreaming(), true);

  // User hits Tab after a short wait
  await new Promise((r) => setTimeout(r, 10));
  engine.handleKeyDown(new win.KeyboardEvent('keydown', { key: 'Tab' }) as unknown as KeyboardEvent);

  await streamPromise;

  assert.strictEqual(engine.getState(), 'idle');
  assert.strictEqual(blockEl.querySelector('.ai-streaming-token'), null);
  assert.strictEqual(history.canUndo(), true, 'Accepted continuation commits atomic transaction');
});

test('InlineContinuationEngine: Error handling cleans up cleanly without history corruption', async () => {
  const { engine, canvas, aiAdapter, history } = createTestEnvironment('Safe text.');

  aiAdapter.shouldFail = true;
  aiAdapter.errorMessage = 'Simulated Hardware Timeout';

  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  const result = await engine.triggerContinuation(blockEl, 'Safe text. ');

  assert.strictEqual(result, null);
  assert.strictEqual(engine.getState(), 'idle');
  assert.strictEqual(blockEl.querySelector('.ai-streaming-token'), null);
  assert.strictEqual(history.canUndo(), false);
});
