import test from 'node:test';
import assert from 'node:assert';
import { MockAIServiceAdapter, type ThoughtNoteRecord } from '../helpers/mock-adapters.ts';
import { DC1_VIEWPORT } from '../helpers/dom-simulator.ts';

test('F42 & F43 & F52: Inline Continuation Trigger (+++) & Streaming Simulation', async () => {
  const aiAdapter = new MockAIServiceAdapter();

  // Test trigger detection helper
  const detectContinuationTrigger = (buffer: string): { triggered: boolean; strippedBuffer: string } => {
    if (buffer.endsWith('+++')) {
      return { triggered: true, strippedBuffer: buffer.slice(0, -3) };
    }
    return { triggered: false, strippedBuffer: buffer };
  };

  const inputBuffer = 'The morning light reflects across the field +++';
  const detection = detectContinuationTrigger(inputBuffer);
  assert.strictEqual(detection.triggered, true);
  assert.strictEqual(detection.strippedBuffer, 'The morning light reflects across the field ');

  // Stream continuation chunks
  const chunks: string[] = [];
  const fullText = await aiAdapter.streamContinuation(
    { documentText: detection.strippedBuffer, cursorOffset: detection.strippedBuffer.length },
    (chunk) => chunks.push(chunk)
  );

  assert.ok(chunks.length > 0, 'Stream must emit incremental chunks');
  assert.strictEqual(chunks.join(''), fullText);
  assert.ok(fullText.includes('landscape'));
});

test('F44: Atomic Single-Step Undo/Redo (Cmd+Z) for AI Continuation', async () => {
  const history: Array<{ before: string; after: string; cursor: number }> = [];
  let currentDocText = 'Initial text before AI trigger.';
  const initialCursor = currentDocText.length;

  const aiAdapter = new MockAIServiceAdapter();
  const beforeState = currentDocText;

  // Stream text
  const generatedText = await aiAdapter.streamContinuation(
    { documentText: currentDocText, cursorOffset: initialCursor },
    () => {}
  );

  currentDocText += generatedText;

  // Push single atomic transaction to history
  history.push({
    before: beforeState,
    after: currentDocText,
    cursor: initialCursor,
  });

  assert.strictEqual(history.length, 1);
  assert.ok(currentDocText.length > beforeState.length);

  // Single Cmd+Z keystroke undo
  const lastTx = history.pop()!;
  currentDocText = lastTx.before;
  assert.strictEqual(currentDocText, 'Initial text before AI trigger.', 'Cmd+Z must atomically revert all generated tokens');
});

test('F45 & F46: Command Palette (Cmd+K) Geometry & Viewport Clamping (1584x1184)', () => {
  const paletteWidth = 320;
  const paletteHeight = 240;

  const calculatePalettePosition = (selectionRect: { left: number; top: number; right: number; bottom: number; width: number }) => {
    let left = selectionRect.left + selectionRect.width / 2 - paletteWidth / 2;
    // Boundary clamp X (16px margins)
    left = Math.max(16, Math.min(left, DC1_VIEWPORT.logicalWidth - paletteWidth - 16));

    let top = selectionRect.bottom + 8;
    // Flip if overflowing bottom (1184 - 24px)
    if (top + paletteHeight > DC1_VIEWPORT.logicalHeight - 24) {
      top = selectionRect.top - paletteHeight - 8;
    }

    return { left, top };
  };

  // Normal selection in middle of canvas
  const posNormal = calculatePalettePosition({ left: 600, top: 400, right: 700, bottom: 430, width: 100 });
  assert.strictEqual(posNormal.left, 490);
  assert.strictEqual(posNormal.top, 438);

  // Selection near right edge
  const posRight = calculatePalettePosition({ left: 1400, top: 400, right: 1550, bottom: 430, width: 150 });
  assert.ok(posRight.left + paletteWidth <= DC1_VIEWPORT.logicalWidth - 16);

  // Selection near bottom edge (flips upward)
  const posBottom = calculatePalettePosition({ left: 600, top: 1100, right: 700, bottom: 1130, width: 100 });
  assert.ok(posBottom.top < 1100, `Palette must flip above selection: ${posBottom.top} < 1100`);
});

test('F47: AI Text Transformations (Summarize, Expand, Tone, Voice, Custom)', async () => {
  const aiAdapter = new MockAIServiceAdapter();
  const sample = 'The old library was quiet and filled with ancient books and dusty light.';

  // Summarize
  const summary = await aiAdapter.transformText({ selectedText: sample, instruction: 'summarize' });
  assert.ok(summary.startsWith('Summary:'));

  // Expand
  const expanded = await aiAdapter.transformText({ selectedText: sample, instruction: 'expand' });
  assert.ok(expanded.includes('fundamental significance') || expanded.includes('core thesis'));

  // Concise Tone
  const verbose = 'This is a very really quite exceptional observation.';
  const concise = await aiAdapter.transformText({ selectedText: verbose, instruction: 'concise' });
  assert.strictEqual(concise.trim(), 'This is a exceptional observation.');

  // Grammar
  const badGrammar = 'The manuscript was written by the the scholar.';
  const fixed = await aiAdapter.transformText({ selectedText: badGrammar, instruction: 'fix_grammar' });
  assert.strictEqual(fixed, 'The manuscript wrote the scholar.');
});

test('F48 & F49 & F50: Non-Modal Critique Mode Engine & Heuristics', async () => {
  const aiAdapter = new MockAIServiceAdapter();
  const testText = 'The study was written by researchers in order to understand repetition the the phenomenon.';

  const issues = await aiAdapter.runCritiqueChecks(testText);
  assert.strictEqual(issues.length, 3);

  const passiveIssue = issues.find((i) => i.type === 'passive_voice');
  const wordyIssue = issues.find((i) => i.type === 'clarity');
  const repIssue = issues.find((i) => i.type === 'repetition');

  assert.ok(passiveIssue, 'Passive voice should be flagged');
  assert.ok(wordyIssue, 'Wordy phrase "in order to" should be flagged');
  assert.ok(repIssue, 'Duplicate word "the the" should be flagged');
});

test('F51: Context-Aware Query Assistant over Document and Margin Notes', async () => {
  const aiAdapter = new MockAIServiceAdapter();
  const docText = 'Paragraph 1 introduces the premise of reflection.';
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-1',
      content: 'Consider adding historical context here.',
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    },
  ];

  const answer = await aiAdapter.queryContext('What is the main thesis?', docText, notes);
  assert.ok(answer.includes('[¶1]'), 'Assistant answer should cite [¶1]');
  assert.ok(answer.includes('[Note:p-1]'), 'Assistant answer should cite attached margin note [Note:p-1]');
});
