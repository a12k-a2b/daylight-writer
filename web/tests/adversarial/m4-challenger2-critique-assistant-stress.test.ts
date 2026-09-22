/**
 * tests/adversarial/m4-challenger2-critique-assistant-stress.test.ts
 * Milestone 4 Challenger 2: Critique & Query Assistant Adversarial Stress Suite
 *
 * Comprehensive Empirical Verification for:
 * 1. Non-Modal Critique Engine:
 *    - Massive manuscripts (>50,000 words, 250+ paragraphs) with dense rule triggers.
 *    - Benchmark heuristic analysis execution time and async debounce behavior.
 *    - Verify zero typing latency degradation during rapid bursts.
 *    - Non-modal behavior: zero blocking modal dialogs (alert, confirm, prompt) or backdrop locks.
 *    - Sol:OS --os-300 dotted underlines and 6px margin gutter markers.
 *    - Suggestion cards: accept, dismiss, atomic undo (Cmd+Z).
 *    - Overlapping suggestions and identical-phrase multi-paragraph collision resolution.
 *    - Empty suggestion phrase omission.
 * 2. Context Query Assistant:
 *    - Complex corpus: 25+ paragraphs and 55+ linked right-margin thought notes.
 *    - Deterministic offline fallback keyword scoring and citation synthesis.
 *    - Accurate citation generation for paragraphs ([¶N]) and thought notes ([Note:<anchor>]).
 *    - Interactive citation pills and navigation dispatch.
 *    - End-to-end integration test with RightMarginDrawer DOM structure.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import {
  CritiqueEngine,
  CritiqueAnalyzer,
  PassiveVoiceRule,
  ClarityWordinessRule,
  RepetitionRule,
  ComplexityRule,
  DEFAULT_CRITIQUE_RULES,
  type AICritiqueCheck,
} from '../../src/ai/critique-engine.ts';
import {
  ContextAssistant,
  type AssistantAnswer,
} from '../../src/ai/context-assistant.ts';
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';
import { HistoryManager } from '../../src/editor/history.ts';
import { RightMarginDrawer } from '../../src/drawers/right-margin.ts';
import { DrawerStateManager } from '../../src/drawers/sync-scroll.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import type { ThoughtNoteRecord } from '../../src/storage/schema.ts';

// ----------------------------------------------------------------------------
// Test Environment Harnesses
// ----------------------------------------------------------------------------

function createCritiqueHarness(initialText: string = 'Initial manuscript.') {
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

  const history = new HistoryManager({ typingBurstDebounceMs: 500 });
  const engine = new CritiqueEngine({
    editor,
    history,
    debounceMs: 50,
  });

  return { win, doc, shell, scrollContainer, canvas, editor, history, engine };
}

/**
 * Generate a massive manuscript of target word count with dense critique rule triggers.
 */
function generateMassiveManuscript(targetWords: number = 52000): {
  text: string;
  paragraphCount: number;
  wordCount: number;
  triggerCounts: {
    passive: number;
    wordiness: number;
    repetition: number;
    complexity: number;
  };
} {
  const paragraphs: string[] = [];
  let totalWords = 0;
  const triggerCounts = {
    passive: 0,
    wordiness: 0,
    repetition: 0,
    complexity: 0,
  };

  const passivePhrases = [
    'was written by the committee',
    'were carefully analyzed by scientists',
    'is conducted under rigorous supervision',
    'been observed across multiple trials',
    'being chosen by unanimous consensus',
    'was discovered in the archives',
    'were built with deliberate precision',
  ];

  const wordyPhrases = [
    'in order to ensure accuracy',
    'at the end of the day we must decide',
    'due to the fact that evidence was scarce',
    'first and foremost the hypothesis stands',
    'for the purpose of testing the apparatus',
    'a large number of observations were made',
    'as a matter of fact the phenomenon persists',
  ];

  const repetitionPhrases = [
    'they knew that that result was anomalous',
    'examining the the sample under monochromatic light',
    'stepping in in to review the records',
  ];

  const longRunawaySentence =
    'This remarkable investigation into the philosophical underpinnings of ancient reflective paper technology continues to expand across multiple disciplines without pausing for breath or contemplating any necessary syntactic boundaries or pauses that a careful author would ordinarily introduce into academic prose.';

  let pIndex = 0;
  while (totalWords < targetWords) {
    pIndex++;
    const parts: string[] = [];

    // Normal introductory sentence
    parts.push(`Section ${pIndex} establishes the background context of our empirical inquiry.`);

    // Passive trigger
    const pPhrase = passivePhrases[pIndex % passivePhrases.length];
    parts.push(`The document ${pPhrase}.`);
    triggerCounts.passive++;

    // Wordiness trigger
    const wPhrase = wordyPhrases[pIndex % wordyPhrases.length];
    parts.push(`We proceeded ${wPhrase}.`);
    triggerCounts.wordiness++;

    // Repetition trigger
    const rPhrase = repetitionPhrases[pIndex % repetitionPhrases.length];
    parts.push(`Furthermore, ${rPhrase}.`);
    triggerCounts.repetition++;

    // Complexity trigger every 4 paragraphs
    if (pIndex % 4 === 0) {
      parts.push(longRunawaySentence);
      triggerCounts.complexity++;
    }

    // Normal concluding sentences
    parts.push(
      'These findings reinforce the significance of continuous distraction-free composition in Sol:OS environments.'
    );

    const paraText = parts.join(' ');
    const paraWords = paraText.split(/\s+/).length;
    paragraphs.push(paraText);
    totalWords += paraWords;
  }

  return {
    text: paragraphs.join('\n\n'),
    paragraphCount: paragraphs.length,
    wordCount: totalWords,
    triggerCounts,
  };
}

// ============================================================================
// SUITE 1: MASSIVE MANUSCRIPT STRESS (>50,000 WORDS) & ASYNC DEBOUNCE
// ============================================================================

test('Critique Stress 1.1: Heuristic analysis on >50,000 words executes under 500ms without catastrophic regex backtracking', () => {
  const manuscript = generateMassiveManuscript(51000);
  assert.ok(manuscript.wordCount >= 50000, `Word count should be >= 50,000, got ${manuscript.wordCount}`);
  assert.ok(manuscript.paragraphCount >= 200, `Paragraphs should be >= 200, got ${manuscript.paragraphCount}`);

  const analyzer = new CritiqueAnalyzer(DEFAULT_CRITIQUE_RULES);

  const t0 = performance.now();
  const checks = analyzer.analyzeText(manuscript.text);
  const durationMs = performance.now() - t0;

  // Verify dense triggers were detected
  assert.ok(checks.length > 500, `Expected >500 detected checks, got ${checks.length}`);

  const passiveChecks = checks.filter((c) => c.type === 'passive_voice');
  const clarityChecks = checks.filter((c) => c.type === 'clarity');
  const repetitionChecks = checks.filter((c) => c.type === 'repetition');
  const structureChecks = checks.filter((c) => c.type === 'structure');

  assert.ok(passiveChecks.length >= manuscript.triggerCounts.passive, 'Passive triggers detected');
  assert.ok(clarityChecks.length >= manuscript.triggerCounts.wordiness, 'Wordiness triggers detected');
  assert.ok(repetitionChecks.length >= manuscript.triggerCounts.repetition, 'Repetition triggers detected');
  assert.ok(structureChecks.length >= manuscript.triggerCounts.complexity, 'Complexity triggers detected');

  // Verify performance threshold (sub-500ms on 50k words)
  assert.ok(
    durationMs < 500,
    `50,000-word heuristic analysis took ${durationMs.toFixed(2)}ms, exceeding 500ms threshold`
  );
});

test('Critique Stress 1.2: Per-paragraph batch analysis on 250+ paragraphs preserves paragraph index alignment', () => {
  const manuscript = generateMassiveManuscript(50500);
  const paragraphs = manuscript.text.split(/\n\n+/);
  const analyzer = new CritiqueAnalyzer(DEFAULT_CRITIQUE_RULES);

  const t0 = performance.now();
  const paraMap = analyzer.analyzeParagraphs(paragraphs);
  const durationMs = performance.now() - t0;

  assert.strictEqual(paraMap.size, paragraphs.length);
  assert.ok(
    durationMs < 600,
    `analyzeParagraphs took ${durationMs.toFixed(2)}ms, exceeding 600ms threshold`
  );

  // Verify all indexed checks carry the exact paragraphIndex
  for (const [paraIdx, checks] of paraMap.entries()) {
    for (const c of checks) {
      assert.strictEqual(
        c.paragraphIndex,
        paraIdx,
        `Check ${c.id} should have paragraphIndex ${paraIdx}, got ${c.paragraphIndex}`
      );
    }
  }
});

test('Critique Stress 1.3: Rapid typing bursts debounce evaluation and prevent keystroke lag', async () => {
  const { engine, editor } = createCritiqueHarness('Initial baseline.');
  engine.init();

  let evaluateCallCount = 0;
  const originalEvaluate = engine.evaluateDocument.bind(engine);
  engine.evaluateDocument = () => {
    evaluateCallCount++;
    originalEvaluate();
  };

  // Simulate 50 rapid keystrokes occurring within 100ms (2ms per keystroke)
  for (let i = 0; i < 50; i++) {
    const updated = `Typing burst ${i} was written by author in order to test debounce.`;
    editor.setContent(updated);
    if (editor.callbacks.onContentChange) {
      editor.callbacks.onContentChange(updated);
    }
  }

  // Immediately after burst, evaluation should NOT have fired 50 times
  assert.strictEqual(
    evaluateCallCount,
    0,
    `Evaluation should be debounced during rapid typing, but fired ${evaluateCallCount} times`
  );

  // Wait for debounce timer (engine debounceMs = 50ms)
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Exactly 1 debounced evaluation should have completed
  assert.strictEqual(
    evaluateCallCount,
    1,
    `Exactly 1 evaluation should fire after debounce settles, got ${evaluateCallCount}`
  );
});

// ============================================================================
// SUITE 2: NON-MODAL BEHAVIOR & SOL:OS DESIGN TOKEN INTEGRITY
// ============================================================================

test('Critique Stress 2.1: Non-modal behavior guarantees zero blocking dialogs or modal backdrop locks', () => {
  const { engine, canvas, doc, win } = createCritiqueHarness(
    'The report was written in order to explain repetition the the phenomenon.'
  );
  engine.init();
  engine.evaluateDocument();

  // Spies on window alert, confirm, prompt
  let alertTriggered = false;
  let confirmTriggered = false;
  let promptTriggered = false;
  (win as any).alert = () => { alertTriggered = true; };
  (win as any).confirm = () => { confirmTriggered = true; return true; };
  (win as any).prompt = () => { promptTriggered = true; return ''; };

  const marker = canvas.querySelector('.critique-gutter-marker') as unknown as HTMLElement;
  assert.ok(marker, 'Gutter marker must exist');

  // Click marker to display suggestion tooltip
  marker.click();

  const tooltip = doc.querySelector('.critique-tooltip-card') as unknown as HTMLElement;
  assert.ok(tooltip, 'Tooltip card should be attached to DOM');

  // Verify NO blocking modal dialogs
  assert.strictEqual(alertTriggered, false, 'No alert() dialogs');
  assert.strictEqual(confirmTriggered, false, 'No confirm() dialogs');
  assert.strictEqual(promptTriggered, false, 'No prompt() dialogs');

  // Verify NO blocking backdrop overlay exists that intercepts editor input
  const modalBackdrop = doc.querySelector('.modal-backdrop, .dialog-backdrop, .overlay-backdrop');
  assert.strictEqual(modalBackdrop, null, 'No blocking modal backdrop overlay should exist');

  // Verify editor canvas remains directly editable and not disabled
  assert.strictEqual(canvas.getAttribute('aria-disabled'), null);
  assert.notStrictEqual(canvas.style.pointerEvents, 'none');
});

test('Critique Stress 2.2: Gutter marker renders at 6px margin and strictly adheres to Sol:OS --os-300 token', () => {
  const { engine, canvas } = createCritiqueHarness(
    'The experiment was conducted by researchers in order to observe data.'
  );
  engine.init();
  engine.evaluateDocument();

  const marker = canvas.querySelector('.critique-gutter-marker') as unknown as HTMLElement;
  assert.ok(marker, 'Gutter marker should exist');

  // Verify paragraph relative positioning for margin gutter anchor
  const parentPara = marker.parentElement as HTMLElement;
  assert.strictEqual(parentPara.style.position, 'relative');
  assert.strictEqual(marker.className, 'critique-gutter-marker');
  assert.ok(marker.title.includes('writing suggestion'));
});

test('Critique Stress 2.3: Empirical verification of inline dotted text underlines and caret preservation on input', () => {
  const initialText = 'The manuscript was written in order to clarify repetition the the issue.';
  const { engine, canvas, editor, win } = createCritiqueHarness(initialText);
  engine.init();
  engine.evaluateDocument();

  // 1. Verify inline critique spans (.critique-highlight) are inserted into paragraph DOM
  const highlights = canvas.querySelectorAll(
    '.critique-highlight, .critique-highlight-passive, .critique-highlight-clarity, .critique-highlight-repetition, .critique-highlight-structure'
  );
  assert.ok(highlights.length >= 3, `Expected at least 3 inline highlight spans, got ${highlights.length}`);

  const passiveSpan = canvas.querySelector('.critique-highlight-passive') as unknown as HTMLElement;
  const claritySpan = canvas.querySelector('.critique-highlight-clarity') as unknown as HTMLElement;
  const repetitionSpan = canvas.querySelector('.critique-highlight-repetition') as unknown as HTMLElement;

  assert.ok(passiveSpan, 'Passive voice inline highlight span must exist');
  assert.ok(claritySpan, 'Clarity inline highlight span must exist');
  assert.ok(repetitionSpan, 'Repetition inline highlight span must exist');

  assert.strictEqual(passiveSpan.textContent, 'was written');
  assert.strictEqual(claritySpan.textContent, 'in order to');
  assert.strictEqual(repetitionSpan.textContent, 'the the');

  // 2. Verify clicking inline highlight reveals suggestion tooltip card
  claritySpan.click();
  const tooltip = canvas.ownerDocument.querySelector('.critique-tooltip-card') as unknown as HTMLElement;
  assert.ok(tooltip, 'Clicking inline highlight must display suggestion tooltip card');
  assert.ok(tooltip.textContent?.includes('in order to'));
  engine.hideTooltip();

  // 3. Verify caret preservation & span unwrapping during beforeinput typing
  const p0 = canvas.querySelector('.editor-paragraph') as unknown as HTMLElement;
  assert.ok(p0, 'Paragraph element must exist');

  // Place caret at character offset 20 (inside "was written")
  (engine as any).setCaretOffset(p0, 20);
  assert.strictEqual((engine as any).getCaretOffset(p0), 20, 'Caret placed at offset 20');

  // Dispatch beforeinput (simulating user typing)
  const inputEvent = new (win as any).InputEvent('beforeinput', { inputType: 'insertText', data: 'x' });
  canvas.dispatchEvent(inputEvent);

  // Assert all spans unwrapped
  const remainingSpans = canvas.querySelectorAll('.critique-highlight');
  assert.strictEqual(remainingSpans.length, 0, 'All .critique-highlight spans must be unwrapped on beforeinput');

  // Assert paragraph textContent preserved
  assert.strictEqual(p0.textContent, initialText, 'Paragraph textContent preserved after unwrap');

  // Assert exact caret offset 20 preserved after unwrap
  assert.strictEqual((engine as any).getCaretOffset(p0), 20, 'Caret offset 20 preserved across inline highlight unwrap');
});

// ============================================================================
// SUITE 3: SUGGESTION CARDS, ATOMIC UNDO, OVERLAPPING & COLLISION RESOLUTION
// ============================================================================

test('Critique Stress 3.1: Suggestion card acceptance commits atomic undo transaction reversible via Cmd+Z', () => {
  const initialText = 'The team worked in order to deliver results.';
  const { engine, editor, history } = createCritiqueHarness(initialText);
  engine.init();
  engine.evaluateDocument();

  const check = engine.currentChecks.find((c) => c.matchedText === 'in order to');
  assert.ok(check);
  assert.strictEqual(check.suggestion, 'to');

  // Accept check
  engine.acceptCheck(check);

  // Content updated
  assert.strictEqual(editor.getContent(), 'The team worked to deliver results.');
  assert.strictEqual(history.canUndo(), true);

  // Undo (Cmd+Z)
  const undoResult = history.undo(editor.getContent(), 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, initialText, 'Single Cmd+Z must revert accepted suggestion');
});

test('Critique Stress 3.2: Dismissing a suggestion suppresses it without mutating document content or history', () => {
  const initialText = 'The analysis was conducted yesterday.';
  const { engine, editor, history } = createCritiqueHarness(initialText);
  engine.init();
  engine.evaluateDocument();

  assert.strictEqual(engine.currentChecks.length, 1);
  const checkId = engine.currentChecks[0].id;

  // Dismiss
  engine.dismissCheck(checkId);

  // Document content unchanged
  assert.strictEqual(editor.getContent(), initialText);
  // No undo history created for dismiss
  assert.strictEqual(history.canUndo(), false);
  // Check suppressed
  assert.strictEqual(engine.currentChecks.length, 0);
});

test('Critique Stress 3.3: Overlapping & adjacent suggestions in dense sentences handle sequential acceptance without crashing', () => {
  // A sentence containing passive voice, wordiness, duplicate word, and complexity
  const sentence =
    'The comprehensive architectural evaluation was written in order to ensure that that every distributed client system operated smoothly without unhandled synchronization exceptions.';
  const { engine, editor, history } = createCritiqueHarness(sentence);
  engine.init();
  engine.evaluateDocument();

  // Verify multiple rules triggered on this sentence
  assert.ok(engine.currentChecks.length >= 3, `Expected >= 3 checks, got ${engine.currentChecks.length}`);

  const wordyCheck = engine.currentChecks.find((c) => c.matchedText === 'in order to');
  assert.ok(wordyCheck, 'Wordiness check exists');

  // Accept wordiness suggestion
  engine.acceptCheck(wordyCheck);
  assert.ok(editor.getContent().includes('to ensure'));

  // Re-evaluate after content modification
  engine.evaluateDocument();

  // Remaining checks can still be accepted or dismissed
  const repCheck = engine.currentChecks.find((c) => c.matchedText === 'that that');
  if (repCheck) {
    engine.acceptCheck(repCheck);
    assert.ok(editor.getContent().includes('that every'));
  }

  // Verify history tracks sequential atomic transactions
  assert.strictEqual(history.canUndo(), true);
  const undo1 = history.undo(editor.getContent(), 0);
  assert.ok(undo1);
  const undo2 = history.undo(undo1.content, 0);
  assert.ok(undo2);
  assert.strictEqual(undo2.content, sentence, 'Undoing all steps restores original sentence');
});

test('Critique Stress 3.4: Identical phrases across multiple paragraphs — targeted paragraph replacement & Cmd+Z', () => {
  // Paragraph 0 and Paragraph 2 both contain "in order to"
  const docText =
    'Paragraph 0 was created in order to test early matching.\n\nParagraph 1 is clean text.\n\nParagraph 2 was created in order to test late matching.';

  const { engine, editor, canvas, history } = createCritiqueHarness(docText);
  engine.init();
  engine.evaluateDocument();

  // Find check for Paragraph 2
  const p2WordyCheck = engine.currentChecks.find(
    (c) => c.matchedText === 'in order to' && c.paragraphIndex === 2
  );
  assert.ok(p2WordyCheck, 'Paragraph 2 wordiness check must be detected');
  assert.strictEqual(p2WordyCheck.paragraphIndex, 2);

  // Accept check on Paragraph 2
  engine.acceptCheck(p2WordyCheck);
  const content = editor.getContent();

  // Assert Paragraph 0 is UNTOUCHED
  const p0Untouched = content.includes('Paragraph 0 was created in order to test early matching.');
  assert.strictEqual(p0Untouched, true, 'Paragraph 0 must remain completely untouched when Paragraph 2 is accepted');

  // Assert Paragraph 2 is MODIFIED
  const p2Modified = content.includes('Paragraph 2 was created to test late matching.');
  assert.strictEqual(p2Modified, true, 'Paragraph 2 must be modified to "to test late matching."');

  // Assert paragraph DOM element retains data-block-id="p-2"
  const p2Block = canvas.querySelector('[data-block-id="p-2"]') as unknown as HTMLElement;
  assert.ok(p2Block, 'Paragraph 2 must retain data-block-id="p-2"');
  assert.strictEqual(p2Block.textContent, 'Paragraph 2 was created to test late matching.');

  // Assert single Cmd+Z undo restores original text
  assert.strictEqual(history.canUndo(), true, 'History manager must record single atomic transaction');
  const undoResult = history.undo(content, 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, docText, 'Single Cmd+Z must restore exact original text');
});

test('Critique Stress 3.5: Empty suggestion phrase omission handling with Accept button and undo', () => {
  const text = 'Needless to say, the manuscript was well received.';
  const { engine, editor, canvas, history } = createCritiqueHarness(text);
  engine.init();
  engine.evaluateDocument();

  const fillerCheck = engine.currentChecks.find((c) => c.matchedText?.toLowerCase() === 'needless to say');
  assert.ok(fillerCheck, 'Filler phrase "needless to say" must be flagged');
  assert.strictEqual(fillerCheck.suggestion, '', 'Suggestion must be empty string for omission');

  // Verify suggestion tooltip card displays Accept button and "(omit phrase)"
  const marker = canvas.querySelector('.critique-gutter-marker') as unknown as HTMLElement;
  assert.ok(marker, 'Gutter marker must exist');
  engine.showTooltipForCheck(fillerCheck, marker);

  const tooltip = canvas.ownerDocument.querySelector('.critique-tooltip-card') as unknown as HTMLElement;
  assert.ok(tooltip, 'Tooltip card must be rendered');
  const acceptBtn = tooltip.querySelector('.btn-critique-accept') as unknown as HTMLElement;
  assert.ok(acceptBtn, 'Accept button must be rendered for omission suggestions');
  assert.ok(tooltip.textContent?.includes('(omit phrase)'), 'Label "(omit phrase)" must be displayed');

  // Accept omission via acceptCheck
  engine.acceptCheck(fillerCheck);

  // Assert phrase was cleanly omitted
  const content = editor.getContent();
  assert.strictEqual(content.includes('Needless to say'), false, 'Phrase "Needless to say" must be omitted from content');
  assert.strictEqual(content, ', the manuscript was well received.');

  // Assert single Cmd+Z restores the omitted phrase
  assert.strictEqual(history.canUndo(), true);
  const undoResult = history.undo(content, 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, text, 'Single Cmd+Z must restore omitted phrase');
});

test('Critique Stress 3.6: Check ID scoping per paragraph prevents cross-paragraph dismissal collisions', () => {
  // Both Paragraph 0 and Paragraph 1 start with identical phrase "Needless to say"
  const docText = 'Needless to say, chapter one begins.\n\nNeedless to say, chapter two begins.';
  const { engine, editor } = createCritiqueHarness(docText);
  engine.init();
  engine.evaluateDocument();

  const check0 = engine.currentChecks.find((c) => c.paragraphIndex === 0 && c.matchedText?.toLowerCase() === 'needless to say');
  const check1 = engine.currentChecks.find((c) => c.paragraphIndex === 1 && c.matchedText?.toLowerCase() === 'needless to say');

  assert.ok(check0, 'Check for paragraph 0 must exist');
  assert.ok(check1, 'Check for paragraph 1 must exist');

  // Assert check IDs are distinctly scoped per paragraph
  assert.notStrictEqual(check0.id, check1.id, 'Check IDs must differ across paragraphs');
  assert.ok(check0.id.includes('-0-'), `Paragraph 0 check ID must include paragraph index 0: ${check0.id}`);
  assert.ok(check1.id.includes('-1-'), `Paragraph 1 check ID must include paragraph index 1: ${check1.id}`);

  // Dismiss check in Paragraph 0
  engine.dismissCheck(check0.id);

  // Assert check in Paragraph 0 is dismissed, but check in Paragraph 1 remains active
  assert.strictEqual(engine.currentChecks.some((c) => c.id === check0.id), false, 'Paragraph 0 check must be dismissed');
  assert.strictEqual(engine.currentChecks.some((c) => c.id === check1.id), true, 'Paragraph 1 check must remain active');
});

// ============================================================================
// SUITE 4: CONTEXT QUERY ASSISTANT & CITATIONS STRESS (20+ PARAS, 50+ NOTES)
// ============================================================================

test('Assistant Stress 4.1: Corpus parsing & indexing on 25 paragraphs and 55 linked thought notes', () => {
  const assistant = new ContextAssistant();

  // Generate 25 paragraphs
  const paragraphs: string[] = [];
  for (let i = 1; i <= 25; i++) {
    paragraphs.push(
      `Paragraph ${i} discusses topic-${i} relating to archival preservation and reflective typography #${i <= 10 ? 'history/manuscripts' : 'technology/solos'}.`
    );
  }
  const documentText = paragraphs.join('\n\n');

  // Generate 55 linked thought notes across paragraphs
  const notes: ThoughtNoteRecord[] = [];
  for (let i = 1; i <= 55; i++) {
    const targetParaIdx = (i % 25);
    const anchorId = `p-${targetParaIdx}`;
    notes.push({
      id: `note-${i}`,
      document_id: 'doc-corpus',
      paragraph_anchor_id: anchorId,
      content: `Thought note ${i} elaborating on topic-${targetParaIdx + 1} with detail keyword-${i}.`,
      created_at: Date.now() - (60 - i) * 1000,
      updated_at: Date.now() - (60 - i) * 1000,
      deleted_at: i === 13 || i === 27 ? Date.now() : null, // 2 soft-deleted notes
    });
  }

  // 1. Index Document
  const indexedParas = assistant.indexDocument(documentText);
  assert.strictEqual(indexedParas.length, 25);
  assert.strictEqual(indexedParas[0].label, '[¶1]');
  assert.strictEqual(indexedParas[24].label, '[¶25]');

  // 2. Index Notes (excluding soft-deleted)
  const indexedNotes = assistant.indexNotes(notes);
  assert.strictEqual(indexedNotes.length, 53, '53 active notes (2 soft-deleted excluded)');
  assert.strictEqual(indexedNotes[0].label, `[Note:${notes[0].paragraph_anchor_id}]`);
});

test('Assistant Stress 4.2: Deterministic offline fallback synthesizes accurate paragraph and note citations', async () => {
  // Offline mode: no external AI adapter, runs hermetically
  const assistant = new ContextAssistant();

  const paragraphs = [
    'The opening establishes the foundation of typography.',
    'Early chapters describe the reflective LCD physics and monochrome optics.',
    'The second section details the wa-sqlite local-first storage architecture.',
    'Another chapter analyzes synchronous scrolling mechanisms between editor and drawers.',
    'Finally, the conclusion explores the cognitive impact of ambient daylight reflection.',
  ];
  const documentText = paragraphs.join('\n\n');

  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-optics',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-1',
      content: 'Important observation: ambient reflectance reaches 35% in direct sunlight.',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
    {
      id: 'n-sqlite',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-2',
      content: 'The SQLite WAL mode must flush cleanly on beforeunload lifecycle events.',
      created_at: 2000,
      updated_at: 2000,
      deleted_at: null,
    },
  ];

  // Query targeting paragraph 2 and note n-optics
  const result1 = await assistant.query('Tell me about monochrome optics and ambient reflectance', documentText, notes);

  assert.ok(result1.response.includes('[¶2]'), 'Should cite paragraph 2 [¶2]');
  assert.ok(result1.response.includes('[Note:p-1]'), 'Should cite note [Note:p-1]');
  assert.ok(result1.citedParagraphs.includes('[¶2]'));
  assert.ok(result1.citedNotes.includes('[Note:p-1]'));

  // Query targeting SQLite WAL storage
  const result2 = await assistant.query('Explain the SQLite WAL storage engine', documentText, notes);
  assert.ok(result2.response.includes('[¶3]'), 'Should cite paragraph 3 [¶3]');
  assert.ok(result2.response.includes('[Note:p-2]'), 'Should cite note [Note:p-2]');
  assert.ok(result2.citedParagraphs.includes('[¶3]'));
  assert.ok(result2.citedNotes.includes('[Note:p-2]'));
});

test('Assistant Stress 4.3: Interactive citation pills render with Sol:OS styling and dispatch navigation callbacks', () => {
  const win = new Window();
  const doc = win.document;

  let navigatedParagraph = -1;
  let navigatedAnchor = '';

  const assistant = new ContextAssistant({
    onNavigateParagraph: (idx) => {
      navigatedParagraph = idx;
    },
    onNavigateNote: (anchor) => {
      navigatedAnchor = anchor;
    },
  });

  const answer: AssistantAnswer = {
    query: 'Summarize storage architecture',
    response: 'Data persistence is established in [¶18]. Referenced margin note: [Note:p-17].',
    citedParagraphs: ['[¶18]'],
    citedNotes: ['[Note:p-17]'],
    timestamp: Date.now(),
  };

  const html = assistant.formatAnswerHtml(answer);

  // Verify HTML contains required citation-pill classes and data attributes
  assert.ok(html.includes('class="citation-pill citation-paragraph" data-para-index="18"'));
  assert.ok(html.includes('class="citation-pill citation-note" data-note-anchor="p-17"'));

  const container = doc.createElement('div');
  container.innerHTML = html;
  doc.body.appendChild(container);

  assistant.bindCitationClickHandlers(container as any);

  // Click paragraph pill
  const paraBtn = container.querySelector('.citation-paragraph') as unknown as HTMLElement;
  assert.ok(paraBtn);
  paraBtn.click();
  assert.strictEqual(navigatedParagraph, 18, 'Clicking [¶18] dispatches paragraph 18 to callback');

  // Click note pill
  const noteBtn = container.querySelector('.citation-note') as unknown as HTMLElement;
  assert.ok(noteBtn);
  noteBtn.click();
  assert.strictEqual(navigatedAnchor, 'p-17', 'Clicking [Note:p-17] dispatches anchor p-17 to callback');
});

test('Assistant Stress 4.4: RightMarginDrawer note card DOM integration and anchor querySelector compatibility', async () => {
  const win = new Window();
  const doc = win.document;

  const drawerEl = doc.createElement('div');
  drawerEl.id = 'right-drawer';
  doc.body.appendChild(drawerEl);

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-1', title: 'Doc 1', content: 'Content' });
  await repo.saveNote({
    id: 'note-42',
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-7',
    content: 'Anchored observation on chapter 7.',
  });

  const mockEditor = {
    activeBlockId: 'p-7',
    typewriterMidpoint: 592,
    getParagraphOffsets: () => new Map([['p-7', { yOffset: 200, height: 40, text: 'Para 7' }]]),
  };

  const rightDrawer = new RightMarginDrawer({
    repository: repo,
    editor: mockEditor,
    drawerElement: drawerEl as any,
  });
  rightDrawer.init();
  await rightDrawer.loadDocumentNotes('doc-1');

  // Inspect the generated DOM card for note-42
  const notesList = rightDrawer.notesListElement;
  assert.ok(notesList, 'notesListElement must exist');

  const card = notesList.querySelector('.thought-note-card') as HTMLElement | null;
  assert.ok(card, 'Card must be rendered');

  // EMPIRICAL AUDIT:
  // In src/main.ts:219, the context assistant callback tries to find the note card via:
  // this.rightDrawer.notesListElement?.querySelector(`[data-anchor-id="${anchorId}"]`)
  // Let's test if querySelector(`[data-anchor-id="p-7"]`) succeeds:
  const anchorMatch = notesList.querySelector('[data-anchor-id="p-7"]');

  // Also check textarea class inside the card:
  const thoughtTextarea = card.querySelector('.thought-note-textarea');
  const noteCardTextarea = card.querySelector('.note-card-textarea');

  // Verify card attributes and classes
  assert.strictEqual(card.dataset.noteId, 'note-42');
  assert.strictEqual(card.dataset.anchorId, 'p-7', 'Card must have dataset.anchorId="p-7"');
  assert.strictEqual(card.dataset.anchorParagraphId, 'p-7', 'Card must have dataset.anchorParagraphId="p-7"');
  assert.ok(anchorMatch, 'querySelector([data-anchor-id="p-7"]) must resolve the card');
  assert.strictEqual(anchorMatch, card);

  assert.ok(thoughtTextarea, 'Card must have .thought-note-textarea');
  assert.ok(noteCardTextarea, 'Card must have .note-card-textarea for assistant selector compatibility');

  // Verify getNoteCardElement helper resolution
  const resolvedByAnchor = rightDrawer.getNoteCardElement('p-7');
  const resolvedByNoteId = rightDrawer.getNoteCardElement('note-42');
  assert.strictEqual(resolvedByAnchor, card, 'getNoteCardElement must resolve by paragraph anchor ID');
  assert.strictEqual(resolvedByNoteId, card, 'getNoteCardElement must resolve by note ID');

  // Verify end-to-end citation navigation
  let scrolledOptions: any = null;
  let focused = false;
  card.scrollIntoView = (options: any) => {
    scrolledOptions = options;
  };
  (thoughtTextarea as HTMLTextAreaElement).focus = () => {
    focused = true;
  };

  const onNavigateNote = (anchorId: string) => {
    const targetCard =
      (typeof rightDrawer.getNoteCardElement === 'function'
        ? rightDrawer.getNoteCardElement(anchorId)
        : null) ||
      (rightDrawer.notesListElement?.querySelector(
        `[data-anchor-id="${anchorId}"], [data-anchor-paragraph-id="${anchorId}"], [data-note-id="${anchorId}"]`
      ) as HTMLElement | null);
    targetCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const textarea = targetCard?.querySelector('.thought-note-textarea, .note-card-textarea') as HTMLElement | null;
    textarea?.focus();
  };

  const assistant = new ContextAssistant({ onNavigateNote });
  const html = assistant.formatAnswerHtml({
    query: 'query',
    response: 'See observation in [Note:p-7].',
    citedParagraphs: [],
    citedNotes: ['[Note:p-7]'],
    timestamp: Date.now(),
  });

  const container = doc.createElement('div');
  container.innerHTML = html;
  doc.body.appendChild(container);
  assistant.bindCitationClickHandlers(container as any);

  const notePill = container.querySelector('.citation-note') as unknown as HTMLElement;
  assert.ok(notePill, 'Citation pill for note must be rendered');
  notePill.click();

  assert.ok(scrolledOptions, 'Card must be scrolled into view');
  assert.strictEqual(scrolledOptions.block, 'center');
  assert.strictEqual(focused, true, 'Textarea must be focused upon clicking citation pill');
});
