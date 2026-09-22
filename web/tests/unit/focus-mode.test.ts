/**
 * tests/unit/focus-mode.test.ts
 * Unit tests for Focus Mode Engine & Sol:OS Grayscale Dimming (F08, F09)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  maskAbbreviationsLengthPreserving,
  segmentSentences,
  findActiveSentenceIndex,
  getNextFocusMode,
  FocusModeEngine,
} from '../../src/editor/focus-mode.ts';

test('Focus Mode: Abbreviation masking preserves exact character length', () => {
  const text = 'Dr. Smith met with Prof. Jones vs. the advisory board, e.g., on Tuesday.';
  const masked = maskAbbreviationsLengthPreserving(text);

  assert.strictEqual(masked.length, text.length, 'Masked text length must match original text length');
  assert.ok(!masked.includes('Dr.'), 'Masked text must not contain period in abbreviation');
  assert.ok(masked.includes('Dr_'), 'Period should be replaced with underscore');
});

test('Focus Mode: segmentSentences accurately segments sentences with abbreviations', () => {
  const text = 'Dr. Smith arrived at the station early. The train was on schedule.';
  const spans = segmentSentences(text);

  assert.strictEqual(spans.length, 2);
  assert.strictEqual(spans[0].text, 'Dr. Smith arrived at the station early.');
  assert.strictEqual(spans[1].text, 'The train was on schedule.');
  assert.strictEqual(text.slice(spans[0].start, spans[0].end).trim(), spans[0].text);
  assert.strictEqual(text.slice(spans[1].start, spans[1].end).trim(), spans[1].text);
});

test('Focus Mode: segmentSentences handles Latin abbreviations (e.g. / i.e.) and vs.', () => {
  const text = 'Consider diverse tools, e.g., fountain pens and typewriters. Both encourage deliberate thought.';
  const spans = segmentSentences(text);

  assert.strictEqual(spans.length, 2);
  assert.strictEqual(spans[0].text, 'Consider diverse tools, e.g., fountain pens and typewriters.');
  assert.strictEqual(spans[1].text, 'Both encourage deliberate thought.');
});

test('Focus Mode: findActiveSentenceIndex resolves caret positions and boundary transitions', () => {
  const text = 'First sentence of the paragraph. Second sentence follows. Third sentence completes it.';
  const spans = segmentSentences(text);
  assert.strictEqual(spans.length, 3);

  // Caret at index 0 -> sentence 0
  assert.strictEqual(findActiveSentenceIndex(spans, 0), 0);

  // Caret in middle of sentence 0
  assert.strictEqual(findActiveSentenceIndex(spans, 15), 0);

  // Caret in sentence 1
  const s1Start = spans[1].start;
  assert.strictEqual(findActiveSentenceIndex(spans, s1Start + 5), 1);

  // Caret at tail of paragraph -> sentence 2
  assert.strictEqual(findActiveSentenceIndex(spans, text.length), 2);
});

test('Focus Mode: getNextFocusMode cycles in strict order (none -> sentence -> paragraph -> none)', () => {
  assert.strictEqual(getNextFocusMode('none'), 'sentence');
  assert.strictEqual(getNextFocusMode('sentence'), 'paragraph');
  assert.strictEqual(getNextFocusMode('paragraph'), 'none');
});

test('FocusModeEngine: Paragraph mode applies .focus-mode-paragraph and .os-focus-active', () => {
  const win = new Window();
  const doc = win.document;
  const canvas = doc.createElement('div');
  canvas.className = 'editor-canvas';
  doc.body.appendChild(canvas);

  const p0 = doc.createElement('p');
  p0.className = 'editor-paragraph';
  p0.dataset.blockId = 'p-0';
  p0.textContent = 'Paragraph 0 context.';
  canvas.appendChild(p0);

  const p1 = doc.createElement('p');
  p1.className = 'editor-paragraph';
  p1.dataset.blockId = 'p-1';
  p1.textContent = 'Paragraph 1 active text.';
  canvas.appendChild(p1);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    initialMode: 'none',
  });

  // Cycle to sentence then paragraph
  engine.setMode('paragraph');
  assert.strictEqual(engine.getMode(), 'paragraph');
  assert.ok(canvas.classList.contains('focus-mode-paragraph'));

  // Place caret in p-1
  const sel = win.getSelection()!;
  const range = doc.createRange();
  range.setStart(p1.firstChild!, 5);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  engine.updateFocus(true);
  assert.ok(p1.classList.contains('os-focus-active'));
  assert.ok(!p0.classList.contains('os-focus-active'));

  // Cleanup
  engine.destroy();
  assert.ok(!canvas.classList.contains('focus-mode-paragraph'));
});

test('FocusModeEngine: Sentence mode isolates active sentence in span and cleans up on switch', () => {
  const win = new Window();
  const doc = win.document;
  const canvas = doc.createElement('div');
  canvas.className = 'editor-canvas';
  doc.body.appendChild(canvas);

  const p = doc.createElement('p');
  p.className = 'editor-paragraph';
  p.dataset.blockId = 'p-0';
  p.textContent = 'First sentence here. Second sentence starts now. Third sentence ends.';
  canvas.appendChild(p);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    initialMode: 'sentence',
  });

  assert.ok(canvas.classList.contains('focus-mode-sentence'));

  // Place caret in second sentence ("Second sentence starts now.")
  const sel = win.getSelection()!;
  const range = doc.createRange();
  range.setStart(p.firstChild!, 25);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  engine.updateFocus(true);

  assert.ok(p.classList.contains('os-focus-active-p'));
  const activeSpan = p.querySelector('.os-sentence-active');
  assert.ok(activeSpan, 'Must wrap active sentence in .os-sentence-active');
  assert.strictEqual(activeSpan.textContent?.trim(), 'Second sentence starts now.');

  // Cycle to none cleans up spans
  engine.setMode('none');
  assert.ok(!canvas.classList.contains('focus-mode-sentence'));
  assert.strictEqual(p.querySelector('.os-sentence-active'), null);

  engine.destroy();
});
