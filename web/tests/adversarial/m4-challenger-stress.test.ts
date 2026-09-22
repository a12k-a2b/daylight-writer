/**
 * tests/adversarial/m4-challenger-stress.test.ts
 * Milestone 4 Challenger 1: Continuation & Palette Stress Suite
 *
 * Comprehensive Adversarial Verification for:
 * 1. +++ Inline Continuation:
 *    - 100+ burst rapid trigger & atomic single-step Cmd+Z undo stress cycles.
 *    - 100 sequential burst accumulation and reverse single-step unwinding.
 *    - Mid-stream cancellation via Esc and Backspace (zero ghost DOM nodes, zero history pollution).
 *    - Concurrent trigger collision and multi-paragraph isolation.
 *    - 592px typewriter center-scroll lock during continuous token streaming.
 * 2. Cmd+K Command Palette:
 *    - Selection anchoring and viewport boundary clamping at viewport extremes:
 *      (0, 0), (1584, 0), (0, 1184), (1584, 1184).
 *    - 1,000+ random selection rectangle fuzzer verifying palette never clips offscreen.
 *    - Upward flip condition near bottom boundary (vHeight - 24px).
 *    - Diff preview mode height clamping (320px).
 * 3. Token-Level LCS Diff Algorithm:
 *    - Mathematical invariants: reconstructed text A and text B match originals exactly.
 *    - Edge cases: empty strings, full replacement, Unicode/emojis, math inequalities (< and >),
 *      hostile HTML/XSS injection, multiline text, repeated words.
 *    - Paragraph data-block-id retention under transforms (preventing margin note orphaning).
 *    - Single-step atomic Cmd+Z undo for accepted transforms and zero history pollution on cancel.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import {
  InlineContinuationEngine,
  detectContinuationTrigger,
} from '../../src/ai/inline-continuation.ts';
import {
  CommandPalette,
  BUILT_IN_ACTIONS,
  type SelectionAnchorRect,
} from '../../src/ai/command-palette.ts';
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import { HistoryManager } from '../../src/editor/history.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';

// ----------------------------------------------------------------------------
// Test Environment Helpers
// ----------------------------------------------------------------------------

function createEditorHarness(initialText: string = 'The ancient manuscript remained undisturbed.') {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;

  const shell = doc.createElement('div');
  shell.className = 'dc1-shell';
  doc.body.appendChild(shell);

  const scrollContainer = doc.createElement('div');
  scrollContainer.id = 'editor-scroll-container';
  scrollContainer.className = 'editor-scroll-container';

  const canvas = doc.createElement('div');
  canvas.id = 'editor-canvas';
  canvas.className = 'editor-canvas';

  scrollContainer.appendChild(canvas);
  shell.appendChild(scrollContainer);

  const editor = new TypewriterEditor({
    viewportWidth: 1584,
    viewportHeight: 1184,
  });
  editor.init(scrollContainer as any, canvas as any);
  editor.setContent(initialText);

  const history = new HistoryManager({ maxStackSize: 300 });
  const aiAdapter = new MockAIServiceAdapter({
    cannedContinuationText: 'illuminated by the amber glow of the setting sun.',
    simulatedDelayMs: 0,
  });

  const continuationEngine = new InlineContinuationEngine(editor, aiAdapter, history);
  continuationEngine.attach(canvas as any);

  const palette = new CommandPalette({
    editor,
    history,
    aiAdapter,
    shellElement: shell as any,
  });
  palette.init();

  return {
    win,
    doc,
    shell,
    scrollContainer,
    canvas,
    editor,
    history,
    aiAdapter,
    continuationEngine,
    palette,
  };
}

// ============================================================================
// SUITE 1: INLINE CONTINUATION ENGINE (+++) ADVERSARIAL STRESS
// ============================================================================

test('Continuation Stress 1.1: 120 rapid burst cycles with single-step atomic Cmd+Z undo', async () => {
  const { editor, history, continuationEngine, canvas, aiAdapter } = createEditorHarness(
    'Initial manuscript baseline text.'
  );

  aiAdapter.simulatedDelayMs = 0; // Instant micro-chunks for high-throughput stress
  const originalBaseline = editor.getContent();
  const burstCount = 120;

  for (let i = 0; i < burstCount; i++) {
    const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
    assert.ok(blockEl, `Paragraph element must exist at iteration ${i}`);

    const preBurstContent = editor.getContent();
    const initialUndoCount = history.getUndoCount();

    // 1. User types '+++'
    blockEl.textContent = preBurstContent + ' +++';

    // 2. Trigger continuation
    const streamPromise = continuationEngine.triggerContinuation(
      blockEl,
      preBurstContent + ' '
    );
    const completedText = await streamPromise;

    assert.ok(completedText, `Continuation should succeed at iteration ${i}`);
    assert.strictEqual(continuationEngine.getState(), 'idle');
    assert.strictEqual(
      canvas.querySelectorAll('.ai-streaming-token').length,
      0,
      `Zero ghost spans should remain in DOM at iteration ${i}`
    );

    const postBurstContent = editor.getContent();
    assert.ok(
      postBurstContent.length > preBurstContent.length,
      `Content must expand after burst ${i}`
    );
    assert.strictEqual(
      history.getUndoCount(),
      initialUndoCount + 1,
      `Exactly one atomic undo entry should be added at iteration ${i}`
    );

    // 3. Single-step Cmd+Z Undo (F44)
    const undoSnapshot = history.undo(postBurstContent, editor.caretPosition.charOffset);
    assert.ok(undoSnapshot, `Undo snapshot must exist at iteration ${i}`);
    assert.strictEqual(
      undoSnapshot.content,
      preBurstContent,
      `Single-step undo must restore exact pre-burst state at iteration ${i}`
    );

    // Apply reverted content to editor
    editor.setContent(undoSnapshot.content);
    assert.strictEqual(editor.getContent(), preBurstContent);
    assert.strictEqual(history.getUndoCount(), initialUndoCount);
  }

  // Verify final document state matches the initial baseline perfectly
  assert.strictEqual(editor.getContent(), originalBaseline);
  assert.strictEqual(history.getUndoCount(), 0);
});

test('Continuation Stress 1.2: 100 sequential bursts accumulation and reverse single-step unwinding', async () => {
  const { editor, history, continuationEngine, canvas, aiAdapter } = createEditorHarness(
    'Chapter One.'
  );

  aiAdapter.simulatedDelayMs = 0;
  const burstCount = 100;
  const historyBaselines: string[] = [];

  // Perform 100 sequential bursts without undoing in between
  for (let i = 0; i < burstCount; i++) {
    const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
    const current = editor.getContent();

    // Baseline before AI continuation streams
    historyBaselines.push(current);

    blockEl.textContent = current + ' +++';
    await continuationEngine.triggerContinuation(blockEl, current + ' ');
  }

  assert.strictEqual(history.getUndoCount(), burstCount);

  // Now unwind all 100 bursts in reverse order, verifying each undo step
  let currentContent = editor.getContent();
  for (let i = burstCount - 1; i >= 0; i--) {
    const expectedBaseline = historyBaselines[i];
    const undoSnapshot = history.undo(currentContent, 0);

    assert.ok(undoSnapshot, `Undo snapshot must exist for reverse step ${i}`);
    assert.strictEqual(
      undoSnapshot.content,
      expectedBaseline,
      `Undo step ${i} must restore exact pre-generation baseline`
    );

    editor.setContent(undoSnapshot.content);
    currentContent = undoSnapshot.content;
  }

  assert.strictEqual(editor.getContent(), 'Chapter One.');
  assert.strictEqual(history.canUndo(), false);
});

test('Continuation Stress 1.3: Mid-stream cancellation via Escape removes ghost tokens and prevents undo pollution', async () => {
  const { editor, history, continuationEngine, canvas, aiAdapter, win } = createEditorHarness(
    'Silence before the storm.'
  );

  aiAdapter.simulatedDelayMs = 20; // Allow micro-delays to test mid-stream abort
  const initialContent = editor.getContent();
  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;

  const streamPromise = continuationEngine.triggerContinuation(blockEl, initialContent + ' ');
  assert.strictEqual(continuationEngine.isStreaming(), true);

  // Wait for 2 chunks to arrive
  await new Promise((r) => setTimeout(r, 15));

  // Verify ghost span is currently mounted in DOM
  const activeGhost = blockEl.querySelector('.ai-streaming-token');
  assert.ok(activeGhost, 'Ghost span must be present while streaming');

  // Emit Escape key to abort
  continuationEngine.handleKeyDown(
    new win.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }) as any
  );

  const result = await streamPromise;
  assert.strictEqual(result, null, 'Cancelled stream must resolve to null');
  assert.strictEqual(continuationEngine.getState(), 'idle');

  // Verify ghost span is completely purged from DOM
  assert.strictEqual(
    blockEl.querySelector('.ai-streaming-token'),
    null,
    'Ghost span must be eliminated on Esc cancel'
  );
  assert.strictEqual(
    canvas.querySelectorAll('.ai-streaming-token').length,
    0,
    'Zero ghost spans in entire canvas'
  );

  // Verify ZERO history pollution
  assert.strictEqual(
    history.canUndo(),
    false,
    'Aborted continuation must create zero undo history entries'
  );
  assert.strictEqual(history.getUndoCount(), 0);
});

test('Continuation Stress 1.4: Mid-stream cancellation via Backspace erases ghost tokens immediately', async () => {
  const { editor, history, continuationEngine, canvas, aiAdapter, win } = createEditorHarness(
    'Typing in flow.'
  );

  aiAdapter.simulatedDelayMs = 25;
  const initialContent = editor.getContent();
  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;

  const streamPromise = continuationEngine.triggerContinuation(blockEl, initialContent + ' ');
  assert.strictEqual(continuationEngine.isStreaming(), true);

  await new Promise((r) => setTimeout(r, 10));

  // Emit Backspace key to abort
  continuationEngine.handleKeyDown(
    new win.KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }) as any
  );

  const result = await streamPromise;
  assert.strictEqual(result, null);
  assert.strictEqual(continuationEngine.getState(), 'idle');
  assert.strictEqual(blockEl.querySelector('.ai-streaming-token'), null);
  assert.strictEqual(history.canUndo(), false);
});

test('Continuation Stress 1.5: Multi-paragraph trigger isolation and contention avoidance', async () => {
  const { editor, continuationEngine, canvas, aiAdapter } = createEditorHarness(
    'Paragraph One.\n\nParagraph Two.\n\nParagraph Three.'
  );

  aiAdapter.simulatedDelayMs = 30;
  const paragraphs = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(paragraphs.length, 3);

  const p0 = paragraphs[0] as unknown as HTMLElement;
  const p1 = paragraphs[1] as unknown as HTMLElement;

  // Start continuation on p0
  const stream0 = continuationEngine.triggerContinuation(p0, 'Paragraph One. ');
  assert.strictEqual(continuationEngine.isStreaming(), true);

  // Attempt concurrent continuation trigger on p1 while p0 is still streaming
  continuationEngine.handleInput(); // Should be a no-op because engine is busy streaming
  assert.strictEqual(continuationEngine.isStreaming(), true);

  // p1 must NOT have any ghost spans
  assert.strictEqual(p1.querySelector('.ai-streaming-token'), null);

  await stream0;
  assert.strictEqual(continuationEngine.getState(), 'idle');

  // Now p1 can trigger cleanly
  aiAdapter.simulatedDelayMs = 0;
  await continuationEngine.triggerContinuation(p1, 'Paragraph Two. ');
  assert.strictEqual(continuationEngine.getState(), 'idle');
  assert.strictEqual(p1.querySelector('.ai-streaming-token'), null);
});

test('Continuation Stress 1.6: 592px Typewriter Center-Scroll Lock during token streaming', async () => {
  const { editor, continuationEngine, canvas, aiAdapter, scrollContainer } = createEditorHarness(
    'Top paragraph line.'
  );

  // Mock layout geometry on elements for HappyDOM
  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  Object.defineProperty(blockEl, 'offsetTop', { value: 1200, configurable: true });
  Object.defineProperty(blockEl, 'offsetHeight', { value: 60, configurable: true });

  editor.activeBlockId = 'p-0';
  editor.recalculateCenterScroll(true);

  // Verify baseline center-scroll target at 592px midpoint
  // targetScrollTop = Math.max(0, 1200 - 592) = 608px
  assert.strictEqual(editor.targetScrollTop, 608);
  assert.strictEqual(editor.scrollTop, 608);
  assert.strictEqual(editor.caretPosition.screenY, 592);

  let chunkCount = 0;
  continuationEngine.options.onChunk = (_chunk, _full) => {
    chunkCount++;
    // Verify that during streaming, center-scroll recalculation is called
    // and targetScrollTop remains locked to offsetTop - 592
    assert.strictEqual(
      editor.targetScrollTop,
      608,
      `targetScrollTop must remain locked at 608px on chunk ${chunkCount}`
    );
  };

  aiAdapter.simulatedDelayMs = 5;
  await continuationEngine.triggerContinuation(blockEl, 'Top paragraph line. ');

  assert.ok(chunkCount > 0, 'At least one chunk should have streamed');
  assert.strictEqual(editor.targetScrollTop, 608);
  assert.strictEqual(scrollContainer.style.paddingTop, 'calc(592px - 1.5em)');
  assert.strictEqual(scrollContainer.style.paddingBottom, '592px');
});

// ============================================================================
// SUITE 2: COMMAND PALETTE VIEWPORT BOUNDARY CLAMPING & FLIPPED POSITIONING
// ============================================================================

test('Palette Clamping 2.1: Four Viewport Extremes Clamp & Flip Behavior', () => {
  const { palette } = createEditorHarness();
  const pWidth = 320;
  const pHeight = 240;

  // Extreme 1: Top-Left (0, 0)
  const rectTopLeft: SelectionAnchorRect = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  };
  const posTopLeft = palette.calculatePalettePosition(rectTopLeft, pWidth, pHeight);
  assert.strictEqual(posTopLeft.left, 16, 'X must clamp to 16px left margin');
  assert.strictEqual(posTopLeft.top, 16, 'Y must clamp to 16px top margin');
  assert.strictEqual(posTopLeft.flipped, false);
  assert.ok(posTopLeft.left + pWidth <= 1584);
  assert.ok(posTopLeft.top + pHeight <= 1184);

  // Extreme 2: Top-Right (1584, 0)
  const rectTopRight: SelectionAnchorRect = {
    left: 1584,
    top: 0,
    right: 1584,
    bottom: 0,
    width: 0,
    height: 0,
  };
  const posTopRight = palette.calculatePalettePosition(rectTopRight, pWidth, pHeight);
  assert.strictEqual(posTopRight.left, 1584 - pWidth - 16, 'X must clamp to right edge (1248)');
  assert.strictEqual(posTopRight.top, 16);
  assert.strictEqual(posTopRight.flipped, false);
  assert.ok(posTopRight.left + pWidth <= 1584 - 16);

  // Extreme 3: Bottom-Left (0, 1184)
  const rectBottomLeft: SelectionAnchorRect = {
    left: 0,
    top: 1184,
    right: 0,
    bottom: 1184,
    width: 0,
    height: 0,
  };
  const posBottomLeft = palette.calculatePalettePosition(rectBottomLeft, pWidth, pHeight);
  assert.strictEqual(posBottomLeft.left, 16);
  assert.strictEqual(posBottomLeft.flipped, true, 'Must flip upward near bottom boundary');
  // top = 1184 - 240 - 8 = 936 -> with 16px bottom clamp: Math.min(936, 1184 - 240 - 16) = 928
  assert.strictEqual(posBottomLeft.top, 928);
  assert.ok(posBottomLeft.top + pHeight <= 1184 - 16, 'Palette bottom must not exceed 1184 - 16');
  assert.strictEqual(posBottomLeft.top + pHeight, 1168);

  // Extreme 4: Bottom-Right (1584, 1184)
  const rectBottomRight: SelectionAnchorRect = {
    left: 1584,
    top: 1184,
    right: 1584,
    bottom: 1184,
    width: 0,
    height: 0,
  };
  const posBottomRight = palette.calculatePalettePosition(rectBottomRight, pWidth, pHeight);
  assert.strictEqual(posBottomRight.left, 1584 - pWidth - 16);
  assert.strictEqual(posBottomRight.flipped, true, 'Must flip upward near bottom boundary');
  assert.strictEqual(posBottomRight.top, 928);
  assert.ok(posBottomRight.left + pWidth <= 1584 - 16);
  assert.ok(posBottomRight.top + pHeight <= 1184 - 16, 'Palette bottom must not exceed 1184 - 16');
});

test('Palette Clamping 2.2: 1,000+ Random Selection Rectangle Fuzzing Never Clips Offscreen', () => {
  const { palette } = createEditorHarness();
  const pWidth = 320;
  const pHeight = 240;
  const testCount = 1200;

  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let i = 0; i < testCount; i++) {
    // Generate selection coordinates across normal, edge, and out-of-bounds ranges
    const left = Math.round(pseudoRandom() * 1800 - 100); // -100 to 1700
    const top = Math.round(pseudoRandom() * 1400 - 100);  // -100 to 1300
    const width = Math.round(pseudoRandom() * 600);       // 0 to 600
    const height = Math.round(pseudoRandom() * 200);      // 0 to 200
    const right = left + width;
    const bottom = top + height;

    const rect: SelectionAnchorRect = { left, top, right, bottom, width, height };
    const pos = palette.calculatePalettePosition(rect, pWidth, pHeight);

    // Assert strictly within active DC1 viewport bounds (1584x1184) with 16px margins
    assert.ok(
      pos.left >= 16,
      `Left (${pos.left}) must be >= 16 for rect ${JSON.stringify(rect)}`
    );
    assert.ok(
      pos.left + pWidth <= 1584 - 16,
      `Right (${pos.left + pWidth}) must be <= 1568 for rect ${JSON.stringify(rect)}`
    );
    assert.ok(
      pos.top >= 16,
      `Top (${pos.top}) must be >= 16 for rect ${JSON.stringify(rect)}`
    );
    assert.ok(
      pos.top + pHeight <= 1184 - 16,
      `Bottom (${pos.top + pHeight}) must be <= 1168 for rect ${JSON.stringify(rect)}`
    );

    // If bottom overflow occurs, flipped must be true
    if (bottom + 8 + pHeight > 1184 - 24) {
      assert.strictEqual(
        pos.flipped,
        true,
        `Must flip upward when bottom (${bottom}) + 8 + ${pHeight} > 1160`
      );
    }
  }
});

test('Palette Clamping 2.3: Diff Preview Mode (Height = 320px) boundary clamping and upward flip', () => {
  const { palette } = createEditorHarness();
  const diffHeight = 320;
  const pWidth = 320;

  // Selection at Y=900 (would overflow with 320px height)
  const rectNearBottom: SelectionAnchorRect = {
    left: 500,
    top: 890,
    right: 600,
    bottom: 910,
    width: 100,
    height: 20,
  };

  const pos = palette.calculatePalettePosition(rectNearBottom, pWidth, diffHeight);
  // bottom = 910 + 8 = 918. 918 + 320 = 1238 > 1160 -> MUST FLIP
  assert.strictEqual(pos.flipped, true, 'Diff preview must flip upward');
  // top = 890 - 320 - 8 = 562
  assert.strictEqual(pos.top, 562);
  assert.ok(pos.top + diffHeight <= 1184 - 16, 'Diff preview bottom must not exceed 1184 - 16');

  // Extreme selection at bottom edge (Y=1184) with 320px height
  const rectExtremeBottom: SelectionAnchorRect = {
    left: 600,
    top: 1184,
    right: 700,
    bottom: 1184,
    width: 100,
    height: 0,
  };
  const posExtreme = palette.calculatePalettePosition(rectExtremeBottom, pWidth, diffHeight);
  assert.strictEqual(posExtreme.flipped, true, 'Diff preview must flip upward at bottom boundary');
  // top = 1184 - 320 - 8 = 856 -> clamped to 1184 - 320 - 16 = 848
  assert.strictEqual(posExtreme.top, 848);
  assert.strictEqual(posExtreme.top + diffHeight, 1184 - 16);
});

// ============================================================================
// SUITE 3: TOKEN-LEVEL LCS DIFF ALGORITHM & ADVERSARIAL EDGE CASES
// ============================================================================

test('LCS Diff 3.1: Fundamental Invariant & Reconstruction Accuracy across 10 Adversarial Edge Cases', () => {
  const { palette } = createEditorHarness();

  const edgeCases = [
    { name: 'Empty A, non-empty B', a: '', b: 'All new manuscript content.' },
    { name: 'Non-empty A, empty B', a: 'Manuscript content deleted entirely.', b: '' },
    { name: 'Both empty', a: '', b: '' },
    { name: 'Identical strings', a: 'Exactly the same text.', b: 'Exactly the same text.' },
    { name: 'Completely disjoint strings', a: 'alpha beta gamma', b: 'one two three' },
    {
      name: 'Unicode and Emojis',
      a: 'The quiet morning 🌞 with coffee ☕ and peace 🌿.',
      b: 'The quiet morning 🌙 with tea 🍵 and tranquil 🍃 silence.',
    },
    {
      name: 'Math inequalities and symbols',
      a: 'Assert that x < 5 and y > 10, where a <= b && c >= d.',
      b: 'Assert that x < 3 and y > 15, where a < b && c > d.',
    },
    {
      name: 'Hostile HTML & XSS payload tokens',
      a: 'Normal <safe> string with & symbols.',
      b: 'Attacker <script>alert("pwn")</script> & <img src=x onerror=attack()>',
    },
    {
      name: 'Multiline with uneven spacing and indentation',
      a: 'Paragraph 1.\n\n   Indented note.\n\nParagraph 3.',
      b: 'Paragraph 1.\n\nModified note without indent.\n\nParagraph 3.\n\nNew Paragraph 4.',
    },
    {
      name: 'Repeated words and anagram patterns',
      a: 'the the the quick quick brown fox',
      b: 'the quick brown brown fox fox',
    },
  ];

  for (const tc of edgeCases) {
    const diffs = palette.computeDiff(tc.a, tc.b);

    // Invariant 1: Reconstructed text A must match original text A
    const reconstructedA = diffs
      .filter((d) => d.type === 'equal' || d.type === 'delete')
      .map((d) => d.text)
      .join('');
    assert.strictEqual(
      reconstructedA,
      tc.a,
      `[${tc.name}] Reconstructed text A must exactly match original A`
    );

    // Invariant 2: Reconstructed text B must match transformed text B
    const reconstructedB = diffs
      .filter((d) => d.type === 'equal' || d.type === 'insert')
      .map((d) => d.text)
      .join('');
    assert.strictEqual(
      reconstructedB,
      tc.b,
      `[${tc.name}] Reconstructed text B must exactly match transformed B`
    );
  }
});

test('LCS Diff 3.2: Performance Stress on Large 1,000-word Manuscript', () => {
  const { palette } = createEditorHarness();

  const wordsA: string[] = [];
  const wordsB: string[] = [];
  for (let i = 0; i < 500; i++) {
    wordsA.push(`token_${i}`);
    if (i % 10 === 0) {
      wordsB.push(`modified_${i}`);
    } else {
      wordsB.push(`token_${i}`);
    }
  }

  const textA = wordsA.join(' ');
  const textB = wordsB.join(' ');

  const startTime = Date.now();
  const diffs = palette.computeDiff(textA, textB);
  const elapsed = Date.now() - startTime;

  assert.ok(diffs.length > 0);
  assert.ok(
    elapsed < 500,
    `LCS diff calculation for 500 tokens must take <500ms (took ${elapsed}ms)`
  );

  const reconstructedA = diffs
    .filter((d) => d.type === 'equal' || d.type === 'delete')
    .map((d) => d.text)
    .join('');
  assert.strictEqual(reconstructedA, textA);
});

test('LCS Diff 3.3: DOM XSS Neutrality in Diff Preview Container', async () => {
  const { palette, shell, aiAdapter } = createEditorHarness(
    'Initial safe sentence.'
  );

  // Set up malicious transformed text with HTML tags and handlers
  aiAdapter.cannedTransforms['custom'] = () =>
    'Hostile <script>window.evilExecuted=true;</script> <img src="invalid" onerror="window.evilExecuted=true;">';

  palette.open();
  await palette.executeCustomInstruction('inject attack');

  assert.strictEqual(palette.mode, 'diff_preview');
  assert.ok(palette.previewContainerEl);

  // Verify that NO <script> or <img> elements are created in DOM
  const scriptTags = palette.previewContainerEl.querySelectorAll('script');
  const imgTags = palette.previewContainerEl.querySelectorAll('img');
  assert.strictEqual(scriptTags.length, 0, 'ZERO <script> tags permitted in preview DOM');
  assert.strictEqual(imgTags.length, 0, 'ZERO <img> tags permitted in preview DOM');

  // Verify elements are purely <del>, <ins>, and <span>
  const insertTags = palette.previewContainerEl.querySelectorAll('ins.diff-insert');
  assert.ok(insertTags.length > 0);
  assert.ok(insertTags[0].textContent?.includes('<script>'));

  palette.close();
});

test('LCS Diff 3.4: Paragraph data-block-id is strictly preserved across AI transformations', async () => {
  const { palette, editor, canvas } = createEditorHarness(
    'Paragraph 0.\n\nParagraph 1: Target for AI transform.\n\nParagraph 2.'
  );

  const pElements = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(pElements.length, 3);

  // Set explicit blockIds simulating thought margin anchoring
  (pElements[0] as unknown as HTMLElement).dataset.blockId = 'p-anchor-0';
  (pElements[1] as unknown as HTMLElement).dataset.blockId = 'p-anchor-1';
  (pElements[2] as unknown as HTMLElement).dataset.blockId = 'p-anchor-2';

  editor.activeBlockId = 'p-anchor-1';

  palette.open();
  assert.strictEqual(palette.capturedSelection?.blockId, 'p-anchor-1');

  const conciseAction = BUILT_IN_ACTIONS.find((a) => a.id === 'concise')!;
  await palette.executeAction(conciseAction);

  // Accept the replacement
  palette.acceptReplacement();

  // Verify paragraph 1 still exists in DOM and its blockId is untouched
  const targetBlock = canvas.querySelector('[data-block-id="p-anchor-1"]') as unknown as HTMLElement;
  assert.ok(targetBlock, 'Paragraph data-block-id="p-anchor-1" must remain in DOM');
  assert.strictEqual(targetBlock.dataset.blockId, 'p-anchor-1');
  assert.ok(
    targetBlock.textContent?.includes('The manuscript wrote the scholar.') ||
      targetBlock.textContent?.length! > 0
  );

  // Neighboring blocks must also retain their exact IDs
  assert.ok(canvas.querySelector('[data-block-id="p-anchor-0"]'));
  assert.ok(canvas.querySelector('[data-block-id="p-anchor-2"]'));
});

test('LCS Diff 3.5: Single-step atomic Cmd+Z undo restores pre-transform text and blockId', async () => {
  const { palette, editor, canvas, history } = createEditorHarness(
    'Original prose before palette invocation.'
  );

  const blockEl = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  blockEl.dataset.blockId = 'p-sol-99';
  editor.activeBlockId = 'p-sol-99';

  const originalContent = editor.getContent();
  const initialUndoCount = history.getUndoCount();

  palette.open();
  const rewriteAction = BUILT_IN_ACTIONS.find((a) => a.id === 'rewrite')!;
  await palette.executeAction(rewriteAction);
  palette.acceptReplacement();

  const transformedContent = editor.getContent();
  assert.notStrictEqual(transformedContent, originalContent);
  assert.strictEqual(history.getUndoCount(), initialUndoCount + 1);

  // Single Cmd+Z undo reverts back to original prose in 1 step
  const undoSnapshot = history.undo(transformedContent, editor.caretPosition.charOffset);
  assert.ok(undoSnapshot);
  assert.strictEqual(undoSnapshot.content, originalContent);

  editor.setContent(undoSnapshot.content);
  assert.strictEqual(editor.getContent(), originalContent);

  // Single Cmd+Shift+Z redo re-applies transform
  const redoSnapshot = history.redo(originalContent, 0);
  assert.ok(redoSnapshot);
  assert.strictEqual(redoSnapshot.content, transformedContent);
});

test('LCS Diff 3.6: Cancelling palette with Escape leaves zero undo history entries', async () => {
  const { palette, editor, history } = createEditorHarness(
    'Pristine content.'
  );

  const initialUndoCount = history.getUndoCount();

  palette.open();
  const expandAction = BUILT_IN_ACTIONS.find((a) => a.id === 'expand')!;
  await palette.executeAction(expandAction);

  assert.strictEqual(palette.mode, 'diff_preview');

  // Cancel via Esc
  palette.cancelReplacement();

  assert.strictEqual(palette.isOpen, false);
  assert.strictEqual(editor.getContent(), 'Pristine content.');
  assert.strictEqual(
    history.getUndoCount(),
    initialUndoCount,
    'Zero history entries should be created when cancelling palette'
  );
  assert.strictEqual(history.canUndo(), false);
});
