/**
 * tests/unit/critique-engine.test.ts
 * Unit tests for Non-Modal Critique Engine and Offline Heuristic Suite (F48, F49, F50, F44)
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
} from '../../src/ai/critique-engine.ts';
import { HistoryManager } from '../../src/editor/history.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';

function createCritiqueEnv(initialText: string = 'The report was written in order to explain repetition the the phenomenon.') {
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
  const engine = new CritiqueEngine({
    editor,
    history,
    debounceMs: 10,
  });

  return { win, doc, scrollContainer, canvas, editor, history, engine };
}

test('CritiqueEngine: PassiveVoiceRule detects "to be" + participle and adverb variants', () => {
  const sample = 'The manuscript was written by scholars. The data were carefully analyzed yesterday.';
  const checks = PassiveVoiceRule.execute(sample, 0);

  assert.strictEqual(checks.length, 2);
  assert.strictEqual(checks[0].type, 'passive_voice');
  assert.strictEqual(checks[0].matchedText, 'was written');
  assert.strictEqual(checks[1].matchedText, 'were carefully analyzed');
  assert.strictEqual(checks[0].suggestion, 'active phrasing');
});

test('CritiqueEngine: ClarityWordinessRule flags wordy phrases with concise replacements', () => {
  const sample = 'We studied in order to learn, due to the fact that knowledge is power, at the end of the day.';
  const checks = ClarityWordinessRule.execute(sample, 0);

  assert.strictEqual(checks.length, 3);
  const inOrderTo = checks.find((c) => c.matchedText === 'in order to');
  const dueTo = checks.find((c) => c.matchedText === 'due to the fact that');
  const endOfDay = checks.find((c) => c.matchedText === 'at the end of the day');

  assert.ok(inOrderTo);
  assert.strictEqual(inOrderTo?.suggestion, 'to');
  assert.ok(dueTo);
  assert.strictEqual(dueTo?.suggestion, 'because');
  assert.ok(endOfDay);
  assert.strictEqual(endOfDay?.suggestion, 'ultimately');
});

test('CritiqueEngine: RepetitionRule flags duplicate consecutive words', () => {
  const sample = 'She knew that that decision was right, but in in truth it was hard.';
  const checks = RepetitionRule.execute(sample, 0);

  assert.strictEqual(checks.length, 2);
  assert.strictEqual(checks[0].type, 'repetition');
  assert.strictEqual(checks[0].matchedText, 'that that');
  assert.strictEqual(checks[0].suggestion, 'that');
  assert.strictEqual(checks[1].matchedText, 'in in');
  assert.strictEqual(checks[1].suggestion, 'in');
});

test('CritiqueEngine: ComplexityRule flags sentences exceeding 35 words without internal punctuation', () => {
  const longSentence =
    'This is an exceptionally long continuous English sentence written deliberately without any commas or semicolons or dashes or colons to test whether the heuristic rule engine flags runaway sentences with high word counts and lack of rhythm.';
  const checks = ComplexityRule.execute(longSentence, 0);

  assert.strictEqual(checks.length, 1);
  assert.strictEqual(checks[0].type, 'structure');
  assert.ok(checks[0].message.includes('Complex sentence'));
});

test('CritiqueAnalyzer: analyzeText and analyzeParagraphs produce sorted check lists', () => {
  const analyzer = new CritiqueAnalyzer();
  const text = 'The letter was written in order to prevent errors the the writer made.';

  const checks = analyzer.analyzeText(text);
  assert.strictEqual(checks.length, 3);
  // Verify start offsets are strictly ordered
  assert.ok(checks[0].startOffset <= checks[1].startOffset);
  assert.ok(checks[1].startOffset <= checks[2].startOffset);

  const paraMap = analyzer.analyzeParagraphs([
    'First paragraph was written by John.',
    'Second paragraph is clean.',
    'Third paragraph in order to test.',
  ]);

  assert.strictEqual(paraMap.get(0)?.length, 1);
  assert.strictEqual(paraMap.get(1)?.length, 0);
  assert.strictEqual(paraMap.get(2)?.length, 1);
});

test('CritiqueEngine: Renders gutter markers and opens suggestion tooltip card', async () => {
  const { engine, canvas, doc } = createCritiqueEnv(
    'The study was written by researchers in order to understand repetition the the phenomenon.'
  );

  engine.evaluateDocument();

  const gutterMarkers = canvas.querySelectorAll('.critique-gutter-marker');
  assert.ok(gutterMarkers.length > 0, 'Gutter marker dot should be rendered in paragraph margin');

  const firstMarker = gutterMarkers[0] as unknown as HTMLElement;
  assert.strictEqual(firstMarker.className, 'critique-gutter-marker');

  // Trigger tooltip
  engine.showTooltipForCheck(engine.currentChecks[0], firstMarker);

  const tooltip = doc.querySelector('.critique-tooltip-card');
  assert.ok(tooltip, 'Tooltip card should be attached to DOM');
  assert.ok(tooltip?.querySelector('.btn-critique-accept'));
  assert.ok(tooltip?.querySelector('.btn-critique-dismiss'));

  // Close tooltip
  engine.hideTooltip();
  assert.strictEqual(doc.querySelector('.critique-tooltip-card'), null);
});

test('CritiqueEngine: Accepting a suggestion commits atomic undo transaction (F44)', () => {
  const initialText = 'We must act in order to succeed.';
  const { engine, editor, history } = createCritiqueEnv(initialText);

  engine.evaluateDocument();
  assert.strictEqual(engine.currentChecks.length, 1);
  const wordyCheck = engine.currentChecks[0];
  assert.strictEqual(wordyCheck.suggestion, 'to');

  // Accept check
  engine.acceptCheck(wordyCheck);

  assert.strictEqual(editor.getContent(), 'We must act to succeed.');
  assert.strictEqual(history.canUndo(), true);

  // Single Cmd+Z undo restores original text
  const undoResult = history.undo(editor.getContent(), 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, initialText, 'Single Cmd+Z must revert accepted suggestion');
});

test('CritiqueEngine: Dismissing a check suppresses it from active checks', () => {
  const { engine } = createCritiqueEnv('The letter was written in haste.');

  engine.evaluateDocument();
  assert.strictEqual(engine.currentChecks.length, 1);

  const checkId = engine.currentChecks[0].id;
  engine.dismissCheck(checkId);

  assert.strictEqual(engine.currentChecks.length, 0, 'Dismissed check must be suppressed');
});

test('CritiqueEngine: Injects inline highlight spans with category classes and data-check-id (Defect 1, F49)', () => {
  const sample = 'The manuscript was written in order to explain repetition the the phenomenon.';
  const { engine, canvas } = createCritiqueEnv(sample);

  engine.evaluateDocument();

  const spans = Array.from(canvas.querySelectorAll('.critique-highlight')) as unknown as HTMLElement[];
  assert.strictEqual(spans.length, 3, 'Must render exactly 3 non-overlapping highlight spans');

  // Verify categories and data-check-id
  assert.ok(spans.some((s) => s.classList.contains('critique-highlight-passive') && s.textContent === 'was written'));
  assert.ok(spans.some((s) => s.classList.contains('critique-highlight-clarity') && s.textContent === 'in order to'));
  assert.ok(spans.some((s) => s.classList.contains('critique-highlight-repetition') && s.textContent === 'the the'));

  for (const span of spans) {
    assert.ok(span.dataset.checkId, 'Span must have data-check-id attribute');
    assert.strictEqual(span.dataset.paragraphIndex, '0');
  }

  // Clear highlights and verify unwrapping
  engine.clearInlineHighlights();
  assert.strictEqual(canvas.querySelectorAll('.critique-highlight').length, 0);
  assert.strictEqual(canvas.textContent, sample);
});

test('CritiqueEngine: Targeted multi-paragraph replacement mutates only target block and preserves block IDs (Defect 2)', () => {
  const initialText = 'First paragraph in order to test.\n\nSecond paragraph is clean.\n\nThird paragraph in order to test.';
  const { engine, editor, canvas } = createCritiqueEnv(initialText);

  engine.evaluateDocument();

  const paras = Array.from(canvas.querySelectorAll('.editor-paragraph')) as unknown as HTMLElement[];
  assert.strictEqual(paras.length, 3);
  assert.strictEqual(paras[0].dataset.blockId, 'p-0');
  assert.strictEqual(paras[2].dataset.blockId, 'p-2');

  // Find check for Paragraph 2 (third paragraph)
  const p2Check = engine.currentChecks.find((c) => c.paragraphIndex === 2 && c.matchedText === 'in order to');
  assert.ok(p2Check, 'Check for paragraph 2 must exist');

  engine.acceptCheck(p2Check);

  // Assert Paragraph 0 remains untouched and Paragraph 2 is modified
  const currentContent = editor.getContent();
  assert.ok(currentContent.includes('First paragraph in order to test.'), 'Paragraph 0 must not be modified');
  assert.ok(currentContent.includes('Third paragraph to test.'), 'Paragraph 2 must be modified');

  // Verify DOM block identity preserved
  const updatedParas = Array.from(canvas.querySelectorAll('.editor-paragraph')) as unknown as HTMLElement[];
  assert.strictEqual(updatedParas[0].dataset.blockId, 'p-0');
  assert.strictEqual(updatedParas[2].dataset.blockId, 'p-2');
});

test('CritiqueEngine: Omission suggestions with suggestion: "" render Accept button and omit phrase (Defect 3)', () => {
  const initialText = 'Needless to say, the project was a resounding success.';
  const { engine, editor, doc, canvas } = createCritiqueEnv(initialText);

  engine.evaluateDocument();

  const omissionCheck = engine.currentChecks.find((c) => c.matchedText?.toLowerCase() === 'needless to say');
  assert.ok(omissionCheck);
  assert.strictEqual(omissionCheck.suggestion, '');

  const marker = canvas.querySelector('.critique-gutter-marker') as unknown as HTMLElement;
  assert.ok(marker);

  // Open tooltip card
  engine.showTooltipForCheck(omissionCheck, marker);
  const tooltip = doc.querySelector('.critique-tooltip-card');
  assert.ok(tooltip);

  // Accept button must be rendered for omission
  const acceptBtn = tooltip.querySelector('.btn-critique-accept') as unknown as HTMLButtonElement;
  assert.ok(acceptBtn, 'Accept button must render when suggestion is empty string');
  assert.ok(tooltip.textContent?.includes('(omit phrase)'));

  // Accept omission
  engine.acceptCheck(omissionCheck);

  const updatedContent = editor.getContent();
  assert.ok(!updatedContent.includes('Needless to say'), 'Phrase must be omitted from content');
});

test('CritiqueEngine: Cross-paragraph check IDs are strictly scoped per paragraph (Defect 4)', () => {
  const multiParaText = 'First paragraph was written here.\n\nSecond paragraph was written there.';
  const { engine } = createCritiqueEnv(multiParaText);

  engine.evaluateDocument();

  const pvChecks = engine.currentChecks.filter((c) => c.matchedText === 'was written');
  assert.strictEqual(pvChecks.length, 2);

  assert.strictEqual(pvChecks[0].paragraphIndex, 0);
  assert.strictEqual(pvChecks[1].paragraphIndex, 1);

  assert.ok(pvChecks[0].id.startsWith('pv-0-'));
  assert.ok(pvChecks[1].id.startsWith('pv-1-'));
  assert.notStrictEqual(pvChecks[0].id, pvChecks[1].id, 'Check IDs across paragraphs must be unique');

  // Dismissing check for Paragraph 0 should not dismiss check for Paragraph 1
  engine.dismissCheck(pvChecks[0].id);

  assert.strictEqual(engine.currentChecks.length, 1);
  assert.strictEqual(engine.currentChecks[0].id, pvChecks[1].id);
});

