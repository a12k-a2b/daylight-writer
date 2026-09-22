/**
 * tests/adversarial/editor-scroll-stress.test.ts
 * Milestone 2 Adversarial Stress Test Suite
 * Empirical Challenger Verification for Daylight Writer Typewriter Scroll & Viewport Engine
 *
 * Covers:
 * 1. Typewriter Center Alignment: 592px midpoint accuracy across first line, middle lines, and last line.
 * 2. Virtual Keyboard Recalibration: visualViewport dynamic resizing (484px, 500px, 380px, 900px).
 * 3. High-Frequency Viewport Resize Churn (100 rapid events).
 * 4. User Scroll Suspension (wheel, touch, scrollbar) and Instant Typing Resumption.
 * 5. Rapid Typing Burst (150+ rapid keystrokes) with zero rAF runaway, zero NaN, zero Infinity.
 * 6. Kinetic Lerp Frame Jitter & Monotonic Convergence across 60Hz and 120Hz (DC1 LivePaper).
 * 7. Boundary Conditions & Degenerate Editor States (empty doc, massive 500-para manuscript, extreme IME, destroy lifecycle).
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { TypewriterEditor } from '../../src/editor/editor.ts';

// Helper to create a fully isolated HappyDOM test fixture
function createEditorFixture(options: {
  viewportWidth?: number;
  viewportHeight?: number;
  keyboardHeight?: number;
  mockVisualViewport?: boolean;
} = {}) {
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;

  if (options.mockVisualViewport) {
    const vp = new win.EventTarget();
    (vp as any).height = options.viewportHeight ?? 1184;
    (win as any).visualViewport = vp;
  }

  const scrollContainer = win.document.createElement('div');
  scrollContainer.className = 'editor-scroll-container';
  const canvas = win.document.createElement('div');
  canvas.className = 'editor-canvas';

  win.document.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor({
    viewportWidth: options.viewportWidth ?? 1584,
    viewportHeight: options.viewportHeight ?? 1184,
    keyboardHeight: options.keyboardHeight ?? 0,
  });

  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  return { win, scrollContainer, canvas, editor };
}

// ----------------------------------------------------------------------------
// Test 1: Typewriter Center Alignment Across Document Topology
// ----------------------------------------------------------------------------
test('Adversarial Stress 1: Typewriter Center Alignment across First, Middle, and Terminal Lines', async () => {
  const { win, scrollContainer, canvas, editor } = createEditorFixture();

  // Create a 50-paragraph manuscript
  const paragraphCount = 50;
  const paragraphHeight = 60;
  const paragraphSpacing = 30; // 90px stride
  const blocks: HTMLElement[] = [];

  for (let i = 0; i < paragraphCount; i++) {
    const p = win.document.createElement('p');
    p.className = 'editor-paragraph';
    p.dataset.blockId = `p-${i}`;
    p.textContent = `Paragraph ${i}: The quick brown fox jumps over the lazy dog in Sol:OS typewriter mode.`;
    const offsetTop = i * (paragraphHeight + paragraphSpacing);
    Object.defineProperty(p, 'offsetTop', { value: offsetTop, configurable: true });
    Object.defineProperty(p, 'offsetHeight', { value: paragraphHeight, configurable: true });
    canvas.appendChild(p);
    blocks.push(p as unknown as HTMLElement);
  }

  // 1. First Line (p-0 at offsetTop 0):
  editor.activeBlockId = 'p-0';
  editor.recalculateCenterScroll(true);
  await Promise.resolve();

  assert.strictEqual(editor.scrollTop, 0, 'First line must clamp targetScrollTop to 0');
  assert.strictEqual(editor.targetScrollTop, 0);

  // Verify top padding formula ensures line 1 sits at optical center
  // paddingTop = calc(592px - 1.5em)
  assert.strictEqual(scrollContainer.style.paddingTop, 'calc(592px - 1.5em)');
  assert.strictEqual(scrollContainer.style.paddingBottom, '592px');

  // 2. Middle Lines (p-10 at offset 900px, p-25 at offset 2250px):
  const testMiddleBlocks = [
    { index: 10, y: 900 },
    { index: 25, y: 2250 },
    { index: 40, y: 3600 },
  ];

  for (const { index, y } of testMiddleBlocks) {
    editor.activeBlockId = `p-${index}`;
    editor.recalculateCenterScroll(true);
    await Promise.resolve();

    const expectedScrollTop = y - 592; // 592px midpoint
    assert.strictEqual(
      editor.scrollTop,
      expectedScrollTop,
      `Block p-${index} at Y=${y} must center at exactly 592px (targetScrollTop=${expectedScrollTop})`
    );
    // Visual screen position: y - scrollTop = 592px
    const computedScreenY: number = y - editor.scrollTop;
    assert.strictEqual(computedScreenY, 592, `Screen Y must match 592px midpoint exactly for middle line p-${index}`);
  }

  // 3. Last Line (p-49 at offset 49 * 90 = 4410px):
  editor.activeBlockId = 'p-49';
  editor.recalculateCenterScroll(true);
  await Promise.resolve();

  const terminalY = 49 * 90;
  const expectedTerminalScrollTop = terminalY - 592; // 4410 - 592 = 3818px
  assert.strictEqual(editor.scrollTop, expectedTerminalScrollTop, 'Last line must center at 592px without clamping');
  assert.strictEqual(terminalY - editor.scrollTop, 592, 'Terminal line screenY must equal 592px');

  // Verify bottom padding provides the required runway for last line centering
  assert.strictEqual(scrollContainer.style.paddingBottom, '592px', 'Bottom padding must match 50vh (592px)');

  editor.destroy();
});

// ----------------------------------------------------------------------------
// Test 2: Virtual Keyboard Dynamic Recalibration (484px, 500px, 380px, 900px)
// ----------------------------------------------------------------------------
test('Adversarial Stress 2: Virtual Keyboard Recalibration across Sol:OS / DC1 Viewport Profiles', async () => {
  const { win, scrollContainer, canvas, editor } = createEditorFixture({ mockVisualViewport: true });

  // Add sample paragraph at Y=1200
  const p = win.document.createElement('p');
  p.className = 'editor-paragraph';
  p.dataset.blockId = 'p-target';
  Object.defineProperty(p, 'offsetTop', { value: 1200, configurable: true });
  canvas.appendChild(p);
  editor.activeBlockId = 'p-target';

  const profiles = [
    { name: 'Standard Sol:OS Keyboard', kbHeight: 484, expectedEffective: 700, expectedMidpoint: 350 },
    { name: 'Heavy Keyboard with Word Bar', kbHeight: 500, expectedEffective: 684, expectedMidpoint: 342 },
    { name: 'Split Thumb Keyboard', kbHeight: 380, expectedEffective: 804, expectedMidpoint: 402 },
    { name: 'Extreme Landscape Keyboard (76% of screen)', kbHeight: 900, expectedEffective: 284, expectedMidpoint: 142 },
    { name: 'Keyboard Dismissed (Full 1184px)', kbHeight: 0, expectedEffective: 1184, expectedMidpoint: 592 },
  ];

  for (const prof of profiles) {
    // Test Path A: setVirtualKeyboardHeight API
    editor.setVirtualKeyboardHeight(prof.kbHeight);

    assert.strictEqual(
      editor.effectiveViewportHeight,
      prof.expectedEffective,
      `[${prof.name}] Effective height mismatch via setVirtualKeyboardHeight`
    );
    assert.strictEqual(
      editor.typewriterMidpoint,
      prof.expectedMidpoint,
      `[${prof.name}] Typewriter midpoint mismatch via setVirtualKeyboardHeight`
    );

    // Assert container padding re-computed dynamically
    assert.strictEqual(
      scrollContainer.style.paddingTop,
      `calc(${prof.expectedMidpoint}px - 1.5em)`,
      `[${prof.name}] Container paddingTop not updated to ${prof.expectedMidpoint}px`
    );
    assert.strictEqual(
      scrollContainer.style.paddingBottom,
      `${prof.expectedMidpoint}px`,
      `[${prof.name}] Container paddingBottom not updated to ${prof.expectedMidpoint}px`
    );

    // Assert targetScrollTop recalibrates to targetY - midpoint
    const expectedScrollTop = Math.max(0, 1200 - prof.expectedMidpoint);
    assert.strictEqual(
      editor.targetScrollTop,
      expectedScrollTop,
      `[${prof.name}] Target scroll top must recalculate to ${expectedScrollTop}`
    );
  }

  // Test Path B: Native window.visualViewport resize event simulation
  editor.setVirtualKeyboardHeight(0); // Clear manual override so visualViewport takes precedence
  const visualViewport = (win as any).visualViewport;

  const vpHeights = [
    { height: 484, expectedMid: 242 },
    { height: 500, expectedMid: 250 },
    { height: 380, expectedMid: 190 },
    { height: 900, expectedMid: 450 },
    { height: 1184, expectedMid: 592 },
  ];

  for (const { height, expectedMid } of vpHeights) {
    visualViewport.height = height;
    visualViewport.dispatchEvent(new win.Event('resize'));

    assert.strictEqual(
      editor.effectiveViewportHeight,
      height,
      `visualViewport height of ${height}px must be reported`
    );
    assert.strictEqual(
      editor.typewriterMidpoint,
      expectedMid,
      `Typewriter midpoint must recalculate to floor(${height} / 2) = ${expectedMid}`
    );
    assert.strictEqual(
      scrollContainer.style.paddingTop,
      `calc(${expectedMid}px - 1.5em)`
    );
  }

  editor.destroy();
});

// ----------------------------------------------------------------------------
// Test 3: High-Frequency Viewport Resize Churn (100 Rapid Events)
// ----------------------------------------------------------------------------
test('Adversarial Stress 3: High-Frequency Viewport Resize Churn (100 Rapid Transitions)', () => {
  const { win, editor } = createEditorFixture({ mockVisualViewport: true });
  const visualViewport = (win as any).visualViewport;

  const heights = [1184, 484, 500, 380, 900, 700, 600, 804, 1184];

  for (let i = 0; i < 100; i++) {
    const h = heights[i % heights.length];
    visualViewport.height = h;
    visualViewport.dispatchEvent(new win.Event('resize'));

    assert.ok(!Number.isNaN(editor.effectiveViewportHeight), `effectiveViewportHeight became NaN at iteration ${i}`);
    assert.ok(!Number.isNaN(editor.typewriterMidpoint), `typewriterMidpoint became NaN at iteration ${i}`);
    assert.ok(!Number.isNaN(editor.targetScrollTop), `targetScrollTop became NaN at iteration ${i}`);
  }

  // Final resize back to standard 1184
  visualViewport.height = 1184;
  visualViewport.dispatchEvent(new win.Event('resize'));
  assert.strictEqual(editor.typewriterMidpoint, 592);

  editor.destroy();
});

// ----------------------------------------------------------------------------
// Test 4: User Scroll Suspension & Resumption on Typing
// ----------------------------------------------------------------------------
test('Adversarial Stress 4: User Scroll Suspension (Wheel, Touch, Scrollbar) and Typing Resumption', async () => {
  const { win, scrollContainer, canvas, editor } = createEditorFixture();

  // Create paragraph at Y=2000
  const p = win.document.createElement('p');
  p.className = 'editor-paragraph';
  p.dataset.blockId = 'p-active';
  Object.defineProperty(p, 'offsetTop', { value: 2000, configurable: true });
  canvas.appendChild(p);
  editor.activeBlockId = 'p-active';

  // Initially center at target: 2000 - 592 = 1408px
  editor.recalculateCenterScroll(true);
  await Promise.resolve();
  assert.strictEqual(editor.scrollTop, 1408);
  assert.strictEqual(editor.isScrollSuspended, false);

  // Attack 4.1: User wheels away to review previous text
  scrollContainer.scrollTop = 400;
  scrollContainer.dispatchEvent(new win.Event('wheel'));
  scrollContainer.dispatchEvent(new win.Event('scroll'));

  assert.strictEqual(editor.isScrollSuspended, true, 'Wheel event must engage scroll suspension');
  assert.strictEqual(editor.isRafActive, false, 'Wheel event must abort active rAF lerp');
  assert.strictEqual(editor.scrollTop, 400, 'Scroll position must remain where user wheeled');

  // Verify that background recalculations DO NOT yank viewport while suspended
  editor.recalculateCenterScroll(false);
  assert.strictEqual(editor.isRafActive, false, 'recalculateCenterScroll must be inert while suspended');
  assert.strictEqual(editor.scrollTop, 400, 'Viewport must remain frozen at user scroll position');

  // Attack 4.2: User touches screen (touchstart)
  scrollContainer.dispatchEvent(new win.Event('touchstart'));
  assert.strictEqual(editor.isScrollSuspended, true);
  assert.strictEqual(editor.isRafActive, false);

  // Attack 4.3: User resumes typing (keystroke triggers input event)
  canvas.dispatchEvent(new win.Event('input'));
  assert.strictEqual(editor.isScrollSuspended, false, 'Typing keystroke must immediately clear scroll suspension');
  assert.strictEqual(editor.isRafActive, true, 'Typing keystroke must engage rAF lerp');
  assert.strictEqual(editor.targetScrollTop, 1408, 'Target scroll position must target 1408px');

  // Step rAF lerp from 400px to 1408px
  let now = 1000;
  let steps = 0;
  while (editor.isRafActive && steps < 100) {
    now += 16.67; // 60Hz step
    editor.stepRafLerp(now);
    steps++;
  }

  assert.ok(steps > 0 && steps < 40, `Lerp took ${steps} steps, expected 15-35 frames`);
  assert.strictEqual(editor.scrollTop, 1408, 'Lerp must smoothly converge back to exact 1408px center');
  assert.strictEqual(editor.isRafActive, false, 'rAF must sleep once deadband is reached');

  // Attack 4.4: Interrupted Lerp - user wheels mid-flight during lerp
  editor.targetScrollTop = 3000;
  editor.currentScrollY = 1408;
  editor.isRafActive = true;

  // Step 2 frames towards 3000px
  now += 16.67;
  editor.stepRafLerp(now);
  now += 16.67;
  editor.stepRafLerp(now);
  const midFlightY = editor.currentScrollY;
  assert.ok(midFlightY > 1408 && midFlightY < 3000, `Mid-flight scroll position should be between 1408 and 3000: got ${midFlightY}`);

  // User wheels mid-flight
  scrollContainer.dispatchEvent(new win.Event('wheel'));
  assert.strictEqual(editor.isRafActive, false, 'Wheel mid-flight must immediately cancel rAF');
  assert.strictEqual(editor.isScrollSuspended, true);

  // Step rAF while suspended: must do nothing
  now += 16.67;
  editor.stepRafLerp(now);
  assert.strictEqual(editor.currentScrollY, midFlightY, 'Current scroll position must stay frozen at mid-flight point');

  editor.destroy();
});

// ----------------------------------------------------------------------------
// Test 5: Rapid Typing Burst (150+ Keystrokes) & Concurrency Stability
// ----------------------------------------------------------------------------
test('Adversarial Stress 5: Rapid Typing Burst (150+ Keystrokes) & Zero Runaway rAF', () => {
  const { win, canvas, editor } = createEditorFixture();

  // Attach multiple paragraphs
  for (let i = 0; i < 10; i++) {
    const p = win.document.createElement('p');
    p.className = 'editor-paragraph';
    p.dataset.blockId = `p-${i}`;
    p.textContent = `Paragraph ${i}`;
    Object.defineProperty(p, 'offsetTop', { value: i * 150, configurable: true });
    canvas.appendChild(p);
  }
  editor.activeBlockId = 'p-5'; // Y = 750px -> targetScrollTop = 750 - 592 = 158px

  let rAFScheduleCount = 0;
  (globalThis as any).requestAnimationFrame = () => {
    rAFScheduleCount++;
    return rAFScheduleCount;
  };

  // Burst 150 keystrokes in succession
  const keystrokeCount = 150;
  for (let i = 0; i < keystrokeCount; i++) {
    canvas.dispatchEvent(new win.Event('input'));

    assert.ok(!Number.isNaN(editor.targetScrollTop), `targetScrollTop NaN at stroke ${i}`);
    assert.ok(!Number.isNaN(editor.currentScrollY), `currentScrollY NaN at stroke ${i}`);
    assert.ok(!Number.isNaN(editor.scrollTop), `scrollTop NaN at stroke ${i}`);
    assert.ok(Number.isFinite(editor.targetScrollTop), `targetScrollTop non-finite at stroke ${i}`);
  }

  // Exactly 1 rAF callback scheduled (no runaway duplication)
  assert.strictEqual(rAFScheduleCount, 1, 'Rapid typing burst must schedule exactly one rAF loop');
  assert.strictEqual(editor.isRafActive, true);
  assert.strictEqual(editor.targetScrollTop, 158);

  // Interleaved typing & frame steps: 100 keystrokes interleaved with rAF steps
  let now = 1000;
  for (let i = 0; i < 100; i++) {
    canvas.dispatchEvent(new win.Event('input'));
    now += 16.67;
    editor.stepRafLerp(now);

    assert.ok(!Number.isNaN(editor.currentScrollY), `currentScrollY NaN during interleaved step ${i}`);
    assert.ok(!Number.isNaN(editor.scrollTop), `scrollTop NaN during interleaved step ${i}`);
  }

  // Settle rAF
  let steps = 0;
  while (editor.isRafActive && steps < 50) {
    now += 16.67;
    editor.stepRafLerp(now);
    steps++;
  }

  assert.strictEqual(editor.scrollTop, 158, 'Interleaved typing must cleanly settle to target');
  assert.strictEqual(editor.isRafActive, false, 'rAF loop must sleep after convergence');

  editor.destroy();
});

// ----------------------------------------------------------------------------
// Test 6: Kinetic Lerp Frame Jitter & Monotonic Convergence Across 60Hz and 120Hz
// ----------------------------------------------------------------------------
test('Adversarial Stress 6: Kinetic Lerp Monotonicity, Jitter Tolerance & 60Hz/120Hz Parity', () => {
  const { editor: editor60 } = createEditorFixture();
  const { editor: editor120 } = createEditorFixture();

  // Test 6.1: 60Hz settling duration (~16.67ms per frame)
  editor60.targetScrollTop = 800;
  editor60.currentScrollY = 0;
  editor60.isRafActive = true;

  let now60 = 1000;
  let frames60 = 0;
  while (editor60.isRafActive && frames60 < 100) {
    now60 += 16.667;
    editor60.stepRafLerp(now60);
    frames60++;
  }
  const duration60Ms = frames60 * 16.667;

  // Test 6.2: 120Hz fluid LivePaper settling duration (~8.33ms per frame)
  editor120.targetScrollTop = 800;
  editor120.currentScrollY = 0;
  editor120.isRafActive = true;

  let now120 = 1000;
  let frames120 = 0;
  while (editor120.isRafActive && frames120 < 150) {
    now120 += 8.333;
    editor120.stepRafLerp(now120);
    frames120++;
  }
  const duration120Ms = frames120 * 8.333;

  assert.strictEqual(editor60.scrollTop, 800);
  assert.strictEqual(editor120.scrollTop, 800);

  // Both frame rates must settle in approximately 300ms-450ms (~150ms half-life)
  assert.ok(duration60Ms >= 300 && duration60Ms <= 450, `60Hz settling time ${duration60Ms.toFixed(1)}ms not in [300, 450]ms`);
  assert.ok(duration120Ms >= 300 && duration120Ms <= 450, `120Hz settling time ${duration120Ms.toFixed(1)}ms not in [300, 450]ms`);

  // Time disparity between 60Hz and 120Hz must be <50ms due to dt exponential formulation
  const durationDisparity = Math.abs(duration60Ms - duration120Ms);
  assert.ok(
    durationDisparity < 50,
    `Duration disparity between 60Hz (${duration60Ms.toFixed(1)}ms) and 120Hz (${duration120Ms.toFixed(1)}ms) must be <50ms; was ${durationDisparity.toFixed(1)}ms`
  );

  // Test 6.3: Adversarial Frame Jitter (negative timestamps, massive spikes, micro-ticks)
  const { editor: editorJitter } = createEditorFixture();
  editorJitter.targetScrollTop = 1000;
  editorJitter.currentScrollY = 0;
  editorJitter.isRafActive = true;

  const jitterSequence = [
    5,      // fast tick 5ms
    -10,    // negative delta (non-monotonic clock skew / wake from suspend)
    300,    // massive lag spike 300ms (clamped to 50ms)
    0.0001, // micro-tick (clamped to 1ms)
    16,
    -50,    // clock skew backwards
    100,    // another lag spike
    8,
    16,
  ];

  let nowJitter = 2000;
  let previousY = 0;

  for (const delta of jitterSequence) {
    nowJitter += delta;
    editorJitter.stepRafLerp(nowJitter);

    assert.ok(!Number.isNaN(editorJitter.currentScrollY), `currentScrollY is NaN after delta ${delta}`);
    assert.ok(!Number.isNaN(editorJitter.scrollTop), `scrollTop is NaN after delta ${delta}`);
    assert.ok(
      editorJitter.currentScrollY >= previousY,
      `Scroll position must be monotonic: prev=${previousY}, curr=${editorJitter.currentScrollY}`
    );
    previousY = editorJitter.currentScrollY;
  }

  editor60.destroy();
  editor120.destroy();
  editorJitter.destroy();
});

// ----------------------------------------------------------------------------
// Test 7: Boundary Conditions & Degenerate Editor States
// ----------------------------------------------------------------------------
test('Adversarial Stress 7: Degenerate States (Empty Doc, Massive 500-Para Doc, Extreme IME)', () => {
  const { win, canvas, editor } = createEditorFixture();

  // 1. Empty content
  editor.setContent('');
  assert.strictEqual(editor.getContent(), '');
  editor.recalculateCenterScroll(true);
  assert.strictEqual(editor.scrollTop, 0);
  assert.ok(!Number.isNaN(editor.typewriterMidpoint));

  // 2. Single whitespace
  editor.setContent('   ');
  editor.recalculateCenterScroll(true);
  assert.strictEqual(editor.scrollTop, 0);

  // 3. Massive manuscript (500 paragraphs, 50,000+ words)
  const largeParas: string[] = [];
  for (let i = 0; i < 500; i++) {
    largeParas.push(`Chapter section ${i}. ` + 'Word '.repeat(80));
  }
  const t0 = performance.now();
  editor.setContent(largeParas.join('\n\n'));
  const parseTime = performance.now() - t0;
  assert.ok(parseTime < 100, `500-paragraph content set must take <100ms; took ${parseTime.toFixed(2)}ms`);

  const tOffsets = performance.now();
  const offsets = editor.getParagraphOffsets();
  const offsetTime = performance.now() - tOffsets;
  assert.strictEqual(offsets.size, 500);
  assert.ok(offsetTime < 10, `Offset mapping across 500 paragraphs must take <10ms; took ${offsetTime.toFixed(2)}ms`);

  // 4. Extreme IME keyboard height (> screen height)
  editor.setVirtualKeyboardHeight(1300); // 1300 > 1184 screen height
  assert.strictEqual(editor.effectiveViewportHeight, 100, 'Effective height must clamp to min 100px');
  assert.strictEqual(editor.typewriterMidpoint, 50, 'Midpoint must be 50px');
  assert.ok(editor.typewriterMidpoint > 0, 'Midpoint must never be zero or negative');

  // Negative keyboard height
  editor.setVirtualKeyboardHeight(-50);
  assert.strictEqual(editor.effectiveViewportHeight, 1184, 'Negative keyboard height treated as 0');
  assert.strictEqual(editor.typewriterMidpoint, 592);

  // 5. Clean destroy during active lerp
  editor.targetScrollTop = 5000;
  editor.currentScrollY = 100;
  editor.isRafActive = true;
  editor.destroy();
  assert.strictEqual(editor.isRafActive, false, 'destroy() must cancel active rAF lerp');

  // Step after destroy: must be inert
  editor.stepRafLerp(9999);
  assert.strictEqual(editor.isRafActive, false);
});
