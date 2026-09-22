/**
 * tests/unit/editor-scroll.test.ts
 * Unit tests for Typewriter Center-Scrolling Engine & Viewport Mechanics (F04, F05, F06, F07)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { TypewriterEditor } from '../../src/editor/editor.ts';

test('Typewriter Editor: Layout geometry matches DC1 1584x1184 landscape canvas (F04)', () => {
  const editor = new TypewriterEditor();
  assert.strictEqual(editor.viewportWidth, 1584);
  assert.strictEqual(editor.viewportHeight, 1184);
  assert.strictEqual(editor.columnWidth, 720);

  // 720px column width at 10.5px average character pitch yields 65-75 CPL
  const approxCpl = editor.columnWidth / 10.5;
  assert.ok(approxCpl >= 65 && approxCpl <= 75, `Expected 65-75 CPL, got ${approxCpl.toFixed(1)}`);
});

test('Typewriter Editor: 50% viewport height midpoint calculation (592px) (F05)', () => {
  const editor = new TypewriterEditor();
  assert.strictEqual(editor.effectiveViewportHeight, 1184);
  assert.strictEqual(editor.typewriterMidpoint, 592); // 1184 / 2 = 592
});

test('Typewriter Editor: Dynamic IME keyboard recalibration (F07)', () => {
  const editor = new TypewriterEditor();

  // 1. Base fullscreen: 1184px -> 592px midpoint
  assert.strictEqual(editor.typewriterMidpoint, 592);

  // 2. Keyboard height 484px -> 700px effective -> 350px midpoint
  editor.setVirtualKeyboardHeight(484);
  assert.strictEqual(editor.effectiveViewportHeight, 700);
  assert.strictEqual(editor.typewriterMidpoint, 350);

  // 3. Heavy keyboard 500px -> 684px effective -> 342px midpoint
  editor.setVirtualKeyboardHeight(500);
  assert.strictEqual(editor.effectiveViewportHeight, 684);
  assert.strictEqual(editor.typewriterMidpoint, 342);

  // 4. Split thumb keyboard 380px -> 804px effective -> 402px midpoint
  editor.setVirtualKeyboardHeight(380);
  assert.strictEqual(editor.effectiveViewportHeight, 804);
  assert.strictEqual(editor.typewriterMidpoint, 402);

  // 5. Keyboard closes -> 1184px -> 592px midpoint
  editor.setVirtualKeyboardHeight(0);
  assert.strictEqual(editor.effectiveViewportHeight, 1184);
  assert.strictEqual(editor.typewriterMidpoint, 592);
});

test('Typewriter Editor: Padding application on scroll container', () => {
  const win = new Window();
  const doc = win.document;
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  assert.strictEqual(scrollContainer.style.paddingTop, 'calc(592px - 1.5em)');
  assert.strictEqual(scrollContainer.style.paddingBottom, '592px');

  editor.destroy();
});

test('Typewriter Editor: Content setting, retrieval, and paragraph offset extraction', () => {
  const win = new Window();
  const doc = win.document;
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  const rawText = 'First paragraph of thought.\n\nSecond paragraph of thought.\n\nThird paragraph.';
  editor.setContent(rawText);

  assert.strictEqual(editor.getContent(), rawText);

  const offsets = editor.getParagraphOffsets();
  assert.strictEqual(offsets.size, 3);
  assert.ok(offsets.has('p-0'));
  assert.ok(offsets.has('p-1'));
  assert.ok(offsets.has('p-2'));

  editor.destroy();
});

test('Typewriter Editor: User scroll suspension and resumption state machine (F06)', () => {
  const win = new Window();
  const doc = win.document;
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  assert.strictEqual(editor.isScrollSuspended, false);

  // Simulate user scroll event
  scrollContainer.dispatchEvent(new win.Event('wheel'));
  assert.strictEqual(editor.isScrollSuspended, true, 'Wheel event must suspend auto center-scrolling');

  // Resume scrolling
  editor.resumeScroll();
  assert.strictEqual(editor.isScrollSuspended, false, 'resumeScroll must clear scroll suspension');

  editor.destroy();
});

test('Typewriter Editor: Smooth rAF lerp converges to target and sleeps on deadband threshold', () => {
  const win = new Window();
  const doc = win.document;
  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  // Manually set a target scroll top
  editor.targetScrollTop = 200;
  editor.currentScrollY = 0;
  editor.isRafActive = true;

  // Step lerp by 16ms
  const t0 = 1000;
  editor.stepRafLerp(t0 + 16);
  assert.ok(editor.currentScrollY > 0, 'Scroll position should advance towards target');
  assert.ok(editor.currentScrollY < 200);

  // Simulate arrival near target within deadband (< 0.5px)
  editor.currentScrollY = 199.6;
  editor.stepRafLerp(t0 + 32);

  // Deadband threshold reached: must snap to exactly 200 and sleep rAF
  assert.strictEqual(editor.scrollTop, 200);
  assert.strictEqual(editor.isRafActive, false, 'rAF loop must sleep once target is reached within deadband');

  editor.destroy();
});
