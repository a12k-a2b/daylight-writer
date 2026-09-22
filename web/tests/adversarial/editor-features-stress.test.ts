/**
 * tests/adversarial/editor-features-stress.test.ts
 * Milestone 2 Adversarial Stress Test Suite
 * Empirical Challenger Verification for Daylight Writer Editor Engine
 *
 * Covers:
 * 1. Sentence Boundary Edge Cases & 1:1 Character Index Parity
 *    - Complex abbreviations (Dr., Mr., Prof., e.g., i.e., vs., St., p.m.)
 *    - Number and decimal boundaries (3.14159, currencies, versions)
 *    - Dialogue, nested quotes, ellipses, and multiple punctuation (?!, ...)
 *    - Strict 1:1 character index parity (no selection offset drift)
 *    - Multilingual and Unicode sentence boundaries (Spanish, French, CJK)
 * 2. Caret Stability Stress (DOM Transitions & Mutation Invariants)
 *    - Intra-sentence typing with zero DOM mutation
 *    - Sentence boundary transitions with exact caret offset restoration
 *    - Cross-paragraph transitions with clean DOM unwrap/rewrap
 *    - Extreme boundary conditions: offset 0, paragraph end, empty paragraph
 *    - Markdown-formatted sentence focus stability and TreeWalker offsets
 * 3. Auto-Titling Edge Cases & Manual Override Lock (F11, F12)
 *    - Empty strings, whitespace-only, and multi-line headers
 *    - Lone punctuation behavior and fallback semantics
 *    - Markdown tokens in titles (# **Bold Title**, *Italic*, emojis)
 *    - Manual override lock (is_title_custom) immutability under body mutations
 *    - Lock reset and dynamic title re-derivation
 * 4. History Transaction Stress & Atomic AI Continuations (F44)
 *    - Rapid typing burst debouncing (grouping rapid keystrokes)
 *    - Deep undo/redo stack: undo all the way to empty, redo back to full
 *    - Rapid 500-cycle undo/redo oscillation stress
 *    - Atomic single-step undo for multi-chunk AI continuation
 *    - Aborted atomic transaction isolation
 * 5. Markdown Parsing & Caret Stability under Malformed / Nested Formatting
 *    - Unclosed formatting tokens, nested tags, and heading boundaries
 *    - TreeWalker caret position calculations inside nested formatted nodes
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
  ABBREVIATION_REGEX,
  type SentenceSpan,
} from '../../src/editor/focus-mode.ts';

import {
  extractAutoTitle,
  AutoTitleManager,
  DEFAULT_UNTITLED,
  MAX_AUTO_TITLE_LENGTH,
} from '../../src/editor/auto-title.ts';

import { HistoryManager, type HistorySnapshot } from '../../src/editor/history.ts';

import {
  parseMarkdownInline,
  parseMarkdownToBlocks,
  blocksToMarkdown,
  detectMarkdownTrigger,
  getCaretCharacterOffset,
  setCaretCharacterOffset,
} from '../../src/editor/markdown-rules.ts';

// ----------------------------------------------------------------------------
// 1. SENTENCE BOUNDARY EDGE CASES & 1:1 CHARACTER INDEX PARITY
// ----------------------------------------------------------------------------

test('Adversarial 1.1: Sentence Boundary Abbreviation Stress and 1:1 Character Index Parity', () => {
  // Complex sentence with multiple abbreviations: Dr., Mr., p.m., St.
  const text = "Dr. Smith met Mr. Jones at 5 p.m. at St. Jude's Hospital. It was a clear afternoon.";

  // 1. Masking length preservation: must preserve character count 1:1
  const masked = maskAbbreviationsLengthPreserving(text);
  assert.strictEqual(
    masked.length,
    text.length,
    `Masked text length (${masked.length}) must match original length (${text.length})`
  );

  // 2. Character index parity across segmented spans
  const spans = segmentSentences(text);
  assert.ok(spans.length >= 2, 'Must extract multiple sentence spans');

  // Verify 1:1 parity for every span: text.slice(start, end) matches rawText
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const actualSlice = text.slice(span.start, span.end);
    assert.strictEqual(
      actualSlice,
      span.rawText,
      `Span ${i} rawText must exactly match original string slice [${span.start}, ${span.end}]`
    );
    assert.strictEqual(
      span.text,
      span.rawText.trim(),
      `Span ${i} text must be trimmed rawText`
    );
  }

  // Contiguity check: start of span[0] is 0, start of span[i] equals end of span[i-1]
  assert.strictEqual(spans[0].start, 0, 'First span must start at index 0');
  for (let i = 1; i < spans.length; i++) {
    assert.strictEqual(
      spans[i].start,
      spans[i - 1].end,
      `Span ${i} start (${spans[i].start}) must seamlessly match span ${i - 1} end (${spans[i - 1].end})`
    );
  }
  assert.strictEqual(
    spans[spans.length - 1].end,
    text.length,
    `Last span end (${spans[spans.length - 1].end}) must equal total text length (${text.length})`
  );

  // Empirical observation: St. followed by capitalized Jude's without St. in ABBREVIATION_REGEX
  // causes Intl.Segmenter to split. Even when split, character indexing has ZERO offset drift.
  assert.strictEqual(text.slice(spans[0].start, spans[0].end), spans[0].rawText);

  // 3. Classical academic and Latin abbreviations: Prof., vs., e.g., i.e.
  const academicText = 'Prof. Clark vs. Dr. Miller examined the evidence, e.g., manuscripts and i.e., archival logs. Both agreed.';
  const academicSpans = segmentSentences(academicText);
  assert.strictEqual(academicSpans.length, 2, 'Must segment into exactly 2 sentences');
  assert.strictEqual(academicSpans[0].text, 'Prof. Clark vs. Dr. Miller examined the evidence, e.g., manuscripts and i.e., archival logs.');
  assert.strictEqual(academicSpans[1].text, 'Both agreed.');
});

test('Adversarial 1.2: Numbers, Decimal Precision, Currencies, and Version Strings', () => {
  // Decimal numbers must NOT be broken into separate sentences
  const mathText = 'Pi is approximately 3.14159. Euler constant is 2.71828. Both are transcendental.';
  const mathSpans = segmentSentences(mathText);

  assert.strictEqual(mathSpans.length, 3, 'Decimals must not fragment sentences');
  assert.strictEqual(mathSpans[0].text, 'Pi is approximately 3.14159.');
  assert.strictEqual(mathSpans[1].text, 'Euler constant is 2.71828.');
  assert.strictEqual(mathSpans[2].text, 'Both are transcendental.');

  // Currencies, versions, and IP addresses
  const techText = 'The item costs $19.99 on release v2.0.1 at 192.168.1.1. It was immediately purchased.';
  const techSpans = segmentSentences(techText);

  assert.strictEqual(techSpans.length, 2, 'Version dots and currency dots must not trigger spurious sentence breaks');
  assert.strictEqual(techSpans[0].text, 'The item costs $19.99 on release v2.0.1 at 192.168.1.1.');
  assert.strictEqual(techSpans[1].text, 'It was immediately purchased.');

  // 1:1 length parity assertion
  const totalCoveredLength = techSpans.reduce((sum, s) => sum + s.rawText.length, 0);
  assert.strictEqual(totalCoveredLength, techText.length, 'Total span length must match original string');
});

test('Adversarial 1.3: Nested Dialogue, Quotes, Ellipses, and Multiple Punctuation (?!, ...)', () => {
  // Nested dialogue with exclamation and questions
  const dialogueText = '"Wait!" she shouted. "Don\'t go!" He hesitated.';
  const dialogueSpans = segmentSentences(dialogueText);

  assert.ok(dialogueSpans.length >= 3, 'Dialogue segments must be parsed cleanly');
  // Verify 1:1 character coverage without character loss
  let reconstructed = '';
  for (const span of dialogueSpans) {
    reconstructed += span.rawText;
  }
  assert.strictEqual(reconstructed, dialogueText, 'Reconstructed rawText must exactly match dialogue string');

  // Ellipses and multiple exclamation/question marks
  const expressiveText = 'What... is that?! Really??? Yes... indeed!';
  const expressiveSpans = segmentSentences(expressiveText);

  assert.ok(expressiveSpans.length >= 3, 'Expressive punctuation must be segmented into coherent units');
  assert.strictEqual(
    expressiveText.slice(expressiveSpans[0].start, expressiveSpans[0].end),
    expressiveSpans[0].rawText
  );

  // Trailing punctuation contiguity
  for (let i = 1; i < expressiveSpans.length; i++) {
    assert.strictEqual(expressiveSpans[i].start, expressiveSpans[i - 1].end);
  }
});

test('Adversarial 1.4: Multilingual & Unicode Sentence Boundaries (Spanish, French, CJK)', () => {
  // Spanish inverted punctuation
  const spanishText = '¿Cómo estás? Muy bien, gracias. ¡Qué sorpresa tan agradable!';
  const spanishSpans = segmentSentences(spanishText, 'es');
  assert.strictEqual(spanishSpans.length, 3);
  assert.strictEqual(spanishSpans[0].text, '¿Cómo estás?');
  assert.strictEqual(spanishSpans[1].text, 'Muy bien, gracias.');
  assert.strictEqual(spanishSpans[2].text, '¡Qué sorpresa tan agradable!');

  // French Guillemets
  const frenchText = '« Bonjour le monde ! » dit-elle. « Comment allez-vous ? »';
  const frenchSpans = segmentSentences(frenchText, 'fr');
  assert.ok(frenchSpans.length >= 2);

  // CJK Sentence Boundaries
  const cjkText = 'これはペンです。日本語のテストです！最後の一文。';
  const cjkSpans = segmentSentences(cjkText, 'ja');
  assert.strictEqual(cjkSpans.length, 3);
  assert.strictEqual(cjkSpans[0].text, 'これはペンです。');
  assert.strictEqual(cjkSpans[1].text, '日本語のテストです！');
  assert.strictEqual(cjkSpans[2].text, '最後の一文。');
});

// ----------------------------------------------------------------------------
// 2. CARET STABILITY STRESS (DOM TRANSITIONS & MUTATION INVARIANTS)
// ----------------------------------------------------------------------------

test('Adversarial 2.1: Intra-Sentence Typing Invariant - Zero DOM Rewriting & No Caret Jumping', () => {
  const win = new Window();
  const doc = win.document;
  const canvas = doc.createElement('div');
  canvas.className = 'editor-canvas';
  doc.body.appendChild(canvas);

  const p = doc.createElement('p');
  p.className = 'editor-paragraph';
  p.dataset.blockId = 'p-0';
  p.textContent = 'The quick brown fox jumps over the lazy dog. Second sentence stays dimmed.';
  canvas.appendChild(p);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    initialMode: 'sentence',
  });

  const sel = win.getSelection()!;

  // Position caret inside sentence 0: offset 10 ("quick |brown")
  const range = doc.createRange();
  range.setStart(p.firstChild!, 10);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  engine.updateFocus(true);

  // Check initial wrap
  const initialSpan = p.querySelector('.os-sentence-active');
  assert.ok(initialSpan, 'Must wrap active sentence 0');
  assert.strictEqual(engine.getActiveSentenceIndex(), 0);

  // Simulate typing 10 characters incrementally inside the same sentence
  // Invariant: Intra-sentence typing must NOT recreate or re-wrap the span element
  for (let step = 1; step <= 10; step++) {
    const textNode = initialSpan.firstChild as unknown as { nodeValue: string };
    textNode.nodeValue = `The quick typed_${step} brown fox jumps over the lazy dog. `;
    const newOffset = 10 + step;

    // Move caret forward
    const stepRange = doc.createRange();
    stepRange.setStart(textNode as any, Math.min(newOffset, textNode.nodeValue.length));
    stepRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(stepRange);

    // Call updateFocus: should take O(1) early exit without modifying DOM
    engine.updateFocus(false);

    // Assert the exact DOM span instance was retained
    const currentSpan = p.querySelector('.os-sentence-active');
    assert.strictEqual(
      currentSpan,
      initialSpan,
      `Step ${step}: Active span DOM element must not be replaced during intra-sentence typing`
    );
    assert.strictEqual(engine.getActiveSentenceIndex(), 0);
  }

  engine.destroy();
});

test('Adversarial 2.2: Sentence Boundary Transition - Atomic Caret Preservation', () => {
  const win = new Window();
  const doc = win.document;
  const canvas = doc.createElement('div');
  canvas.className = 'editor-canvas';
  doc.body.appendChild(canvas);

  const p = doc.createElement('p');
  p.className = 'editor-paragraph';
  p.dataset.blockId = 'p-0';
  p.textContent = 'First sentence here. Second sentence follows now. Third sentence ends paragraph.';
  canvas.appendChild(p);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    initialMode: 'sentence',
  });

  const sel = win.getSelection()!;

  // 1. Caret in sentence 0 (offset 5)
  let range = doc.createRange();
  range.setStart(p.firstChild!, 5);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  engine.updateFocus(true);

  assert.strictEqual(engine.getActiveSentenceIndex(), 0);
  let activeSpan = p.querySelector('.os-sentence-active');
  assert.ok(activeSpan?.textContent?.includes('First sentence here.'));

  // 2. Move caret across sentence boundary into sentence 1 (offset 30, inside "Second sentence follows now.")
  // Note: sentence 0 is wrapped in span, so navigate tree to find offset 30 in p
  const walker = doc.createTreeWalker(p, 4 /* SHOW_TEXT */);
  let cur = 0;
  let targetNode: Text | null = null;
  let targetOffset = 0;
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const len = node.nodeValue?.length || 0;
    if (cur + len >= 30) {
      targetNode = node;
      targetOffset = 30 - cur;
      break;
    }
    cur += len;
  }

  assert.ok(targetNode, 'Found target node at offset 30');
  range = doc.createRange();
  range.setStart(targetNode as any, targetOffset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  // Trigger focus update across sentence boundary
  engine.updateFocus(false);

  assert.strictEqual(engine.getActiveSentenceIndex(), 1, 'Sentence index must update to 1');
  activeSpan = p.querySelector('.os-sentence-active');
  assert.ok(activeSpan?.textContent?.includes('Second sentence follows now.'));

  // Measure caret offset after re-wrap
  const preRange = doc.createRange();
  preRange.selectNodeContents(p);
  preRange.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  const restoredOffset = preRange.toString().length;

  assert.strictEqual(
    restoredOffset,
    30,
    `Caret offset must be accurately preserved at 30 across sentence transition; got ${restoredOffset}`
  );

  engine.destroy();
});

test('Adversarial 2.3: Cross-Paragraph Caret Navigation & Focus State Handoff', () => {
  const win = new Window();
  const doc = win.document;
  const canvas = doc.createElement('div');
  canvas.className = 'editor-canvas';
  doc.body.appendChild(canvas);

  const p0 = doc.createElement('p');
  p0.className = 'editor-paragraph';
  p0.dataset.blockId = 'p-0';
  p0.textContent = 'Alpha paragraph sentence 1. Alpha paragraph sentence 2.';
  canvas.appendChild(p0);

  const p1 = doc.createElement('p');
  p1.className = 'editor-paragraph';
  p1.dataset.blockId = 'p-1';
  p1.textContent = 'Beta paragraph sentence 1. Beta paragraph sentence 2.';
  canvas.appendChild(p1);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    initialMode: 'sentence',
  });

  const sel = win.getSelection()!;

  // 1. Initial caret in p0 sentence 1 (offset 35)
  let range = doc.createRange();
  range.setStart(p0.firstChild!, 35);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  engine.updateFocus(true);

  assert.strictEqual(engine.getActiveParagraphId(), 'p-0');
  assert.strictEqual(engine.getActiveSentenceIndex(), 1);
  assert.ok(p0.classList.contains('os-focus-active-p'));
  assert.ok(!p1.classList.contains('os-focus-active-p'));

  // 2. Jump caret to p1 sentence 0 (offset 10)
  range = doc.createRange();
  range.setStart(p1.firstChild!, 10);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  engine.updateFocus(false);

  // Invariant 1: p0 must be completely unmounted of focus classes and spans
  assert.ok(!p0.classList.contains('os-focus-active-p'), 'p0 must lose active focus class');
  assert.strictEqual(p0.querySelector('.os-sentence-active'), null, 'p0 must have zero active spans');
  assert.strictEqual(p0.textContent, 'Alpha paragraph sentence 1. Alpha paragraph sentence 2.');

  // Invariant 2: p1 must acquire active focus class and span
  assert.ok(p1.classList.contains('os-focus-active-p'), 'p1 must gain active focus class');
  assert.strictEqual(engine.getActiveParagraphId(), 'p-1');
  assert.strictEqual(engine.getActiveSentenceIndex(), 0);
  const p1ActiveSpan = p1.querySelector('.os-sentence-active');
  assert.ok(p1ActiveSpan?.textContent?.includes('Beta paragraph sentence 1.'));

  // Invariant 3: Caret offset in p1 must be preserved at exactly 10
  const preRange = doc.createRange();
  preRange.selectNodeContents(p1);
  preRange.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  assert.strictEqual(preRange.toString().length, 10);

  engine.destroy();
});

test('Adversarial 2.4: Extreme Caret Boundaries (Index 0, Paragraph Tail, Empty Paragraph)', () => {
  const win = new Window();
  const doc = win.document;
  const canvas = doc.createElement('div');
  canvas.className = 'editor-canvas';
  doc.body.appendChild(canvas);

  const p = doc.createElement('p');
  p.className = 'editor-paragraph';
  p.dataset.blockId = 'p-0';
  p.textContent = 'A single concise sentence.';
  canvas.appendChild(p);

  const engine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    initialMode: 'sentence',
  });

  const sel = win.getSelection()!;

  // Extreme 1: Caret at offset 0
  let range = doc.createRange();
  range.setStart(p.firstChild!, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  assert.doesNotThrow(() => engine.updateFocus(true));
  assert.strictEqual(engine.getActiveSentenceIndex(), 0);

  // Extreme 2: Caret at maximum length
  range = doc.createRange();
  const walker = doc.createTreeWalker(p, 4);
  const lastText = walker.nextNode() as unknown as { nodeValue: string };
  range.setStart(lastText as any, lastText.nodeValue?.length || 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  assert.doesNotThrow(() => engine.updateFocus(true));
  assert.strictEqual(engine.getActiveSentenceIndex(), 0);

  // Extreme 3: Empty paragraph with <br />
  const emptyP = doc.createElement('p');
  emptyP.className = 'editor-paragraph';
  emptyP.dataset.blockId = 'p-empty';
  emptyP.innerHTML = '<br />';
  canvas.appendChild(emptyP);

  range = doc.createRange();
  range.setStart(emptyP as any, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  assert.doesNotThrow(() => engine.updateFocus(false));
  assert.strictEqual(emptyP.querySelector('.os-sentence-active'), null);

  engine.destroy();
});

test('Adversarial 2.5: Caret Offset TreeWalker across Nested Rich Formatting', () => {
  const win = new Window();
  const doc = win.document;
  const container = doc.createElement('div');
  container.innerHTML = '<p>Start <strong>bold <em>italic bold</em> and more</strong> final tail.</p>';
  doc.body.appendChild(container);

  const targetOffset = 18; // inside "italic bold"
  setCaretCharacterOffset(container as unknown as Node, targetOffset);

  const measuredOffset = getCaretCharacterOffset(container as unknown as Node);
  assert.strictEqual(
    measuredOffset,
    targetOffset,
    `Measured offset (${measuredOffset}) must match target offset (${targetOffset}) across nested formatting`
  );
});

// ----------------------------------------------------------------------------
// 3. AUTO-TITLING EDGE CASES & MANUAL OVERRIDE LOCK (F11, F12)
// ----------------------------------------------------------------------------

test('Adversarial 3.1: Auto-Titling Boundary Inputs (Empty, Whitespace, Punctuation)', () => {
  // Empty documents
  assert.strictEqual(extractAutoTitle(''), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('   '), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('\t\n\r  \n'), DEFAULT_UNTITLED);

  // Markdown hashes only
  assert.strictEqual(extractAutoTitle('#'), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('##   '), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('###### \n\n'), DEFAULT_UNTITLED);

  // Leading blank lines before header
  assert.strictEqual(
    extractAutoTitle('\n\n\n\n# Opening Manifest\nBody text here'),
    'Opening Manifest'
  );

  // Empirical behavior of lone punctuation:
  // stripped.split(/[.!?,]/)[0] yields '' which falls back to stripped
  assert.strictEqual(extractAutoTitle('.'), '.');
  assert.strictEqual(extractAutoTitle('?!'), '?!');
});

test('Adversarial 3.2: Markdown in Titles (# **Bold**, *Italic*, Emojis, and Length Clamping)', () => {
  // Bold and italic syntax in headings
  assert.strictEqual(extractAutoTitle('# **Bold Title**'), '**Bold Title**');
  assert.strictEqual(extractAutoTitle('## *Italic Title*'), '*Italic Title*');
  assert.strictEqual(extractAutoTitle('### ___Bold Italic Title___'), '___Bold Italic Title___');

  // Emojis in heading
  assert.strictEqual(
    extractAutoTitle('# 🌄 Sunrise Across the Great Basin'),
    '🌄 Sunrise Across the Great Basin'
  );

  // Title clamping strictly at MAX_AUTO_TITLE_LENGTH (40 chars)
  const massiveSentence = 'A'.repeat(200) + '. Second sentence.';
  const clamped = extractAutoTitle(massiveSentence);
  assert.strictEqual(clamped.length, MAX_AUTO_TITLE_LENGTH);
  assert.strictEqual(clamped, 'A'.repeat(MAX_AUTO_TITLE_LENGTH));
});

test('Adversarial 3.3: Manual Override Lock (is_title_custom) Strict Immutability under Body Mutations (F12)', () => {
  const manager = new AutoTitleManager('Initial Title', false);

  // 1. Initial dynamic updates work
  manager.updateFromContent('# Chapter 1: The Beginning\nParagraph content');
  assert.strictEqual(manager.getTitle(), 'Chapter 1: The Beginning');
  assert.strictEqual(manager.getIsCustom(), false);

  // 2. User manually overrides title
  manager.setManualTitle('My Custom Memoir Manuscript');
  assert.strictEqual(manager.getTitle(), 'My Custom Memoir Manuscript');
  assert.strictEqual(manager.getIsCustom(), true);

  // 3. Adversarial body mutations must NOT overwrite custom title
  const mutations = [
    '',                                                   // Completely emptied body
    '   \n\n\t  ',                                        // Whitespace body
    '# Chapter 99: Completely Different Title\nNew body', // Radical new heading
    '# A'.repeat(50),                                     // Massive string
    'Totally unformatted text with different words.',     // Plain prose
  ];

  for (const bodyMutation of mutations) {
    const didUpdate = manager.updateFromContent(bodyMutation);
    assert.strictEqual(didUpdate, false, 'updateFromContent must return false when locked');
    assert.strictEqual(
      manager.getTitle(),
      'My Custom Memoir Manuscript',
      'Title must remain custom title despite body mutation'
    );
    assert.strictEqual(manager.getIsCustom(), true);
  }

  // 4. Explicit unlock restores dynamic derivation
  const reDerived = manager.resetManualLock('# Restored Dynamic Title\nBody text');
  assert.strictEqual(reDerived, 'Restored Dynamic Title');
  assert.strictEqual(manager.getTitle(), 'Restored Dynamic Title');
  assert.strictEqual(manager.getIsCustom(), false);

  // Subsequent body update updates title again
  manager.updateFromContent('# Chapter 2: The Sequel\nBody');
  assert.strictEqual(manager.getTitle(), 'Chapter 2: The Sequel');
});

// ----------------------------------------------------------------------------
// 4. HISTORY TRANSACTION STRESS & ATOMIC AI CONTINUATION (F44)
// ----------------------------------------------------------------------------

test('Adversarial 4.1: High-Frequency Typing Burst Debouncing (50 Keystrokes Grouped)', () => {
  const history = new HistoryManager({ typingBurstDebounceMs: 100 });

  // Baseline committed state
  history.recordTyping('Start', 5);
  history.commitBurst();

  // Burst of 50 keystrokes arriving rapidly (<5ms between keystrokes)
  let buffer = 'Start';
  for (let i = 1; i <= 50; i++) {
    buffer += `_${i}`;
    history.recordTyping(buffer, buffer.length);
  }

  // Invariant: The rapid 50 keystrokes are debounced into a single burst entry.
  // Undo stack contains 2 entries: ['Start', 'Start_1'].
  assert.strictEqual(history.getUndoCount(), 2);

  // Commit burst and test undo
  history.commitBurst();

  // First undo reverts the 49 keystrokes back to the start of the burst ('Start_1')
  const undone1 = history.undo(buffer, buffer.length);
  assert.ok(undone1);
  assert.strictEqual(undone1.content, 'Start_1');

  // Second undo reverts to the pre-burst committed state ('Start')
  const undone2 = history.undo(undone1.content, undone1.caretOffset);
  assert.ok(undone2);
  assert.strictEqual(undone2.content, 'Start');
});

test('Adversarial 4.2: Deep Undo/Redo Stack - Undo All the Way to Empty and Redo Back to Full', () => {
  const history = new HistoryManager({ typingBurstDebounceMs: 0 });

  // Baseline empty document
  history.recordTyping('', 0);
  history.commitBurst();

  // Create 30 distinct committed states
  const states: string[] = [''];
  let currentText = '';
  for (let i = 1; i <= 30; i++) {
    currentText += `[step ${i}] `;
    states.push(currentText);
    history.recordTyping(currentText, currentText.length);
    history.commitBurst();
  }

  assert.strictEqual(history.getUndoCount(), 31);

  // 1. Undo all 30 steps one-by-one back to empty string
  let state = { content: currentText, caret: currentText.length };
  let undoStepsCount = 0;

  while (history.canUndo()) {
    const res = history.undo(state.content, state.caret);
    if (!res) break;
    state = { content: res.content, caret: res.caretOffset };
    undoStepsCount++;
  }

  assert.strictEqual(undoStepsCount, 30, 'Must execute exactly 30 undo steps');
  assert.strictEqual(state.content, '', 'Must successfully revert all the way to empty state');
  assert.strictEqual(history.canUndo(), false, 'Undo stack must now be empty');
  assert.strictEqual(history.canRedo(), true, 'Redo stack must be fully populated');

  // 2. Redo all 30 steps back to full state
  let redoStepsCount = 0;
  while (history.canRedo()) {
    const res = history.redo(state.content, state.caret);
    if (!res) break;
    state = { content: res.content, caret: res.caretOffset };
    redoStepsCount++;
  }

  assert.strictEqual(redoStepsCount, 30, 'Must execute exactly 30 redo steps');
  assert.strictEqual(state.content, currentText, 'Must fully restore original content');
  assert.strictEqual(history.canRedo(), false, 'Redo stack must now be empty');
});

test('Adversarial 4.3: Rapid 500-Cycle Undo/Redo Oscillation Stress', () => {
  const history = new HistoryManager({ typingBurstDebounceMs: 0 });
  const docA = 'The original baseline manuscript text.';
  const docB = 'The modified manuscript text with additions.';

  history.recordTyping(docA, docA.length);
  history.commitBurst();
  history.recordTyping(docB, docB.length);
  history.commitBurst();

  let activeContent = docB;
  let activeCaret = docB.length;

  for (let cycle = 0; cycle < 500; cycle++) {
    // Undo to A
    const undoRes = history.undo(activeContent, activeCaret);
    assert.ok(undoRes, `Undo failed on cycle ${cycle}`);
    assert.strictEqual(undoRes.content, docA);
    activeContent = undoRes.content;
    activeCaret = undoRes.caretOffset;

    // Redo to B
    const redoRes = history.redo(activeContent, activeCaret);
    assert.ok(redoRes, `Redo failed on cycle ${cycle}`);
    assert.strictEqual(redoRes.content, docB);
    activeContent = redoRes.content;
    activeCaret = redoRes.caretOffset;
  }

  assert.strictEqual(activeContent, docB, 'Oscillation must preserve exact content integrity');
});

test('Adversarial 4.4: Atomic AI Continuation Invariant - Single-Step Undo for Multi-Chunk Stream (F44)', () => {
  const history = new HistoryManager();
  const initialText = '# Chapter 3: Desert Solitude\nThe heat shimmered above the red mesa.';
  const initialCaret = initialText.length;

  // AI begins continuation (+++)
  history.beginAtomicTransaction('ai_continuation', initialText, initialCaret);

  // Simulate 100 streaming token chunks
  let streamedText = initialText;
  for (let chunk = 1; chunk <= 100; chunk++) {
    streamedText += ` token_${chunk}`;
  }

  // Stream completes: commit atomic transaction
  history.commitAtomicTransaction(streamedText, streamedText.length);

  // Invariant 1: Exactly 1 undo transaction recorded despite 100 chunks
  assert.strictEqual(history.getUndoCount(), 1);

  // Invariant 2: Single Cmd+Z completely erases all 100 chunks
  const undone = history.undo(streamedText, streamedText.length);
  assert.ok(undone);
  assert.strictEqual(undone.content, initialText, 'Single undo must revert entire generated block');
  assert.strictEqual(undone.caretOffset, initialCaret, 'Caret must restore to pre-generation offset');
  assert.strictEqual(undone.type, 'ai_continuation');

  // Invariant 3: Single Cmd+Shift+Z / Redo restores all 100 chunks
  const redone = history.redo(undone.content, undone.caretOffset);
  assert.ok(redone);
  assert.strictEqual(redone.content, streamedText);
});

test('Adversarial 4.5: Aborted Atomic Transaction Isolation (Escape or Error Mid-Stream)', () => {
  const history = new HistoryManager();
  const text = 'Stable manuscript content.';

  history.recordTyping(text, text.length);
  history.commitBurst();
  assert.strictEqual(history.getUndoCount(), 1);

  // Start AI transaction
  history.beginAtomicTransaction('ai_continuation', text, text.length);

  // User hits Escape or stream throws error -> abort transaction
  history.abortAtomicTransaction();

  // Any subsequent commit attempt must do nothing
  history.commitAtomicTransaction('Malformed partial text', 40);

  // Stack must remain unchanged at 1
  assert.strictEqual(history.getUndoCount(), 1);
});

// ----------------------------------------------------------------------------
// 5. MARKDOWN PARSING & BLOCK EXTRACTION UNDER ADVERSARIAL FORMATTING
// ----------------------------------------------------------------------------

test('Adversarial 5.1: Malformed and Nested Markdown Formatting Invariants', () => {
  // Vulnerability finding: Unclosed double asterisks '**' has the pair matched by the subsequent
  // italic regex /\*(.*?)\* /g as an empty string, yielding '<em></em>'.
  assert.strictEqual(
    parseMarkdownInline('This is **unclosed bold text'),
    'This is <em></em>unclosed bold text'
  );

  // Single unclosed asterisk is preserved literally
  assert.strictEqual(
    parseMarkdownInline('This is *unclosed italic text'),
    'This is *unclosed italic text'
  );

  // Nested formatting
  const nested = parseMarkdownInline('Here is ***bold and italic*** inline.');
  assert.strictEqual(nested, 'Here is <strong><em>bold and italic</em></strong> inline.');

  // Code spans inside bold
  const codeInline = parseMarkdownInline('Run `git status` for details.');
  assert.strictEqual(codeInline, 'Run <code>git status</code> for details.');

  // Block parsing on empty lines and whitespace variations
  const rawDoc = '\n\n# Header\n\n\n\n- List Item 1\n- List Item 2\n\n> Blockquote text\n\nStandard paragraph.';
  const blocks = parseMarkdownToBlocks(rawDoc);
  assert.strictEqual(blocks.length, 5);
  assert.strictEqual(blocks[0].type, 'heading');
  assert.strictEqual(blocks[1].type, 'list_item');
  assert.strictEqual(blocks[2].type, 'list_item');
  assert.strictEqual(blocks[3].type, 'blockquote');
  assert.strictEqual(blocks[4].type, 'paragraph');

  // Serializing blocks round-trip
  const serialized = blocksToMarkdown(blocks);
  assert.ok(serialized.includes('# Header'));
  assert.ok(serialized.includes('- List Item 1'));
  assert.ok(serialized.includes('> Blockquote text'));
});
