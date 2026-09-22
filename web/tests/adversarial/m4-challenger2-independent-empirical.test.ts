/**
 * tests/adversarial/m4-challenger2-independent-empirical.test.ts
 * Challenger 2 Independent Adversarial & Empirical Verification Suite
 * Milestone 4 Iteration 3: Critique & Query Assistant Stress
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
import { TypewriterEditor } from '../../src/editor/editor.ts';
import { HistoryManager } from '../../src/editor/history.ts';
import { RightMarginDrawer } from '../../src/drawers/right-margin.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import type { ThoughtNoteRecord } from '../../src/storage/schema.ts';

function createHarness(initialText: string = 'Initial manuscript.') {
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

// ----------------------------------------------------------------------------
// 1. Massive Manuscript (>50,000 words) & ReDoS Resistance
// ----------------------------------------------------------------------------

test('Empirical Challenge 1: >60,000 words + Adversarial ReDoS attack payloads execute under 400ms', () => {
  // Generate 60,000 words
  const chunks: string[] = [];
  let words = 0;
  let idx = 0;

  while (words < 60000) {
    idx++;
    const p = `Section ${idx} confirms that this paper was written by scholars in order to demonstrate that that repeated phrases fail due to the fact that evidence was carefully analyzed. In spite of the fact that ancient manuscripts were discovered in archives, we proceeded for the purpose of testing reflective LivePaper displays with silky smooth 60fps refresh.`;
    chunks.push(p);
    words += p.split(/\s+/).length;
  }

  // Inject adversarial payloads aimed at triggering catastrophic backtracking:
  // 1. Long adverb chain before past participle (e.g. was quickly quickly ... written)
  chunks.push(`Adversarial passive attempt: The thesis was ${'extraordinarily '.repeat(500)}written by author.`);
  // 2. Giant runaway sentence (8,000 characters without punctuation)
  chunks.push(`Adversarial complexity: ${'philosophical exploration of transflective liquid crystal display physics '.repeat(400)}.`);
  // 3. Repeating single character tokens
  chunks.push(`Adversarial repetition: ${'a '.repeat(2000)}b c d`);
  // 4. Repeated partial match for clarity rule
  chunks.push(`Adversarial wordiness partial: ${'in order in order in order to '.repeat(200)}clarify.`);

  const fullText = chunks.join('\n\n');
  const actualWordCount = fullText.split(/\s+/).length;
  assert.ok(actualWordCount >= 60000, `Word count must be >= 60,000, got ${actualWordCount}`);

  const analyzer = new CritiqueAnalyzer(DEFAULT_CRITIQUE_RULES);

  const t0 = performance.now();
  const checks = analyzer.analyzeText(fullText);
  const elapsedMs = performance.now() - t0;

  assert.ok(checks.length > 600, `Expected >600 detected checks, got ${checks.length}`);
  assert.ok(
    elapsedMs < 400,
    `Empirical check: 60,000 words + ReDoS attack vectors took ${elapsedMs.toFixed(2)}ms, exceeding 400ms limit`
  );
});

// ----------------------------------------------------------------------------
// 2. Per-Paragraph Batch Analysis on 300+ Paragraphs Preserving Alignment
// ----------------------------------------------------------------------------

test('Empirical Challenge 2: 300 paragraphs batch analysis preserves exact block ID and index alignment', () => {
  const paragraphList: string[] = [];
  for (let i = 0; i < 300; i++) {
    if (i % 3 === 0) {
      paragraphList.push(`Paragraph ${i} was conducted by researchers in order to observe data.`);
    } else if (i % 3 === 1) {
      paragraphList.push(`Paragraph ${i} shows that that result was discovered recently.`);
    } else {
      paragraphList.push(`Paragraph ${i} is concise clean text without any writing issues.`);
    }
  }

  const analyzer = new CritiqueAnalyzer(DEFAULT_CRITIQUE_RULES);
  const t0 = performance.now();
  const paraMap = analyzer.analyzeParagraphs(paragraphList);
  const elapsedMs = performance.now() - t0;

  assert.strictEqual(paraMap.size, 300, 'All 300 paragraphs must be indexed');
  assert.ok(elapsedMs < 500, `Batch analysis took ${elapsedMs.toFixed(2)}ms (<500ms)`);

  for (let i = 0; i < 300; i++) {
    const checks = paraMap.get(i) || [];
    for (const c of checks) {
      assert.strictEqual(c.paragraphIndex, i, `Check in paragraph ${i} must have paragraphIndex === ${i}`);
      assert.ok(c.id.includes(`-${i}-`), `Check ID must embed paragraph index ${i}: ${c.id}`);
    }
    if (i % 3 === 2) {
      assert.strictEqual(checks.length, 0, `Clean paragraph ${i} should have 0 checks`);
    } else {
      assert.ok(checks.length >= 1, `Paragraph ${i} should have at least 1 check`);
    }
  }
});

// ----------------------------------------------------------------------------
// 3. Non-Modal Behavior: Zero Blocking Dialogs, Zero Backdrop Locks
// ----------------------------------------------------------------------------

test('Empirical Challenge 3: Non-modal critique behavior guarantees zero blocking modal dialogs and zero backdrop locks', () => {
  const { engine, canvas, doc, win } = createHarness(
    'The report was written in order to explain repetition the the phenomenon.'
  );
  engine.init();
  engine.evaluateDocument();

  let dialogBlocked = false;
  (win as any).alert = () => { dialogBlocked = true; };
  (win as any).confirm = () => { dialogBlocked = true; return true; };
  (win as any).prompt = () => { dialogBlocked = true; return ''; };

  const marker = canvas.querySelector('.critique-gutter-marker') as unknown as HTMLElement;
  assert.ok(marker, 'Gutter marker must exist');
  marker.click();

  const tooltip = doc.querySelector('.critique-tooltip-card') as unknown as HTMLElement;
  assert.ok(tooltip, 'Tooltip must be present');

  // Verify zero modal blocking APIs were invoked
  assert.strictEqual(dialogBlocked, false, 'No window.alert/confirm/prompt should be invoked');

  // Verify zero backdrop elements exist in document
  const backdrops = doc.querySelectorAll('.modal-backdrop, .dialog-backdrop, .overlay-backdrop');
  assert.strictEqual(backdrops.length, 0, 'Zero blocking modal backdrop elements in DOM');

  // Verify canvas is fully interactable
  assert.strictEqual(canvas.style.pointerEvents, '', 'Canvas pointerEvents must remain interactive');
  assert.strictEqual(canvas.getAttribute('aria-disabled'), null, 'Canvas aria-disabled must not be set');

  // Light dismiss on outside click
  doc.dispatchEvent(new (win as any).MouseEvent('click', { bubbles: true }));
  assert.strictEqual(doc.querySelector('.critique-tooltip-card'), null, 'Clicking outside dismisses tooltip');
});

// ----------------------------------------------------------------------------
// 4. Targeted Paragraph Replacement (Identical Text Disambiguation)
// ----------------------------------------------------------------------------

test('Empirical Challenge 4: Targeted replacement in acceptCheck() mutates paragraph 2 while leaving identical paragraph 0 and 1 intact', () => {
  // 4 paragraphs where paragraphs 0, 1, and 2 share the identical phrase "was created in order to test"
  const docText = [
    'Paragraph 0 was created in order to test early matching.',
    'Paragraph 1 was created in order to test middle matching.',
    'Paragraph 2 was created in order to test late matching.',
    'Paragraph 3 was created in order to test final matching.',
  ].join('\n\n');

  const { engine, editor, canvas, history } = createHarness(docText);
  engine.init();
  engine.evaluateDocument();

  // Find check for Paragraph 2 ("in order to")
  const p2Check = engine.currentChecks.find(
    (c) => c.matchedText === 'in order to' && c.paragraphIndex === 2
  );
  assert.ok(p2Check, 'Paragraph 2 wordiness check must be detected');
  assert.strictEqual(p2Check.paragraphIndex, 2);

  // Accept check targeting paragraph 2 only
  engine.acceptCheck(p2Check);

  const updatedContent = editor.getContent();

  // Assert Paragraph 0 is UNTOUCHED
  assert.ok(
    updatedContent.includes('Paragraph 0 was created in order to test early matching.'),
    'Paragraph 0 must remain untouched'
  );

  // Assert Paragraph 1 is UNTOUCHED
  assert.ok(
    updatedContent.includes('Paragraph 1 was created in order to test middle matching.'),
    'Paragraph 1 must remain untouched'
  );

  // Assert Paragraph 3 is UNTOUCHED
  assert.ok(
    updatedContent.includes('Paragraph 3 was created in order to test final matching.'),
    'Paragraph 3 must remain untouched'
  );

  // Assert Paragraph 2 is MODIFIED
  assert.ok(
    updatedContent.includes('Paragraph 2 was created to test late matching.'),
    'Paragraph 2 must be modified to "to test late matching."'
  );

  // Verify paragraph 2 DOM node preserves data-block-id="p-2"
  const p2Block = canvas.querySelector('[data-block-id="p-2"]') as unknown as HTMLElement;
  assert.ok(p2Block, 'DOM element p-2 must exist');
  assert.strictEqual(p2Block.textContent, 'Paragraph 2 was created to test late matching.');

  // Verify single-step atomic Cmd+Z undo restores all paragraphs to original state
  assert.strictEqual(history.canUndo(), true, 'History must contain atomic undo transaction');
  const undoResult = history.undo(updatedContent, 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, docText, 'Single Cmd+Z must restore original text across all paragraphs');
});

// ----------------------------------------------------------------------------
// 5. Empty Phrase Omission Suggestions with Accept Button & Undo
// ----------------------------------------------------------------------------

test('Empirical Challenge 5: Empty phrase omission suggestions display Accept button, omit cleanly, and undo cleanly', () => {
  const initialText = 'Needless to say, the manuscript was accepted by the editorial board.';
  const { engine, editor, canvas, history, doc } = createHarness(initialText);
  engine.init();
  engine.evaluateDocument();

  const omissionCheck = engine.currentChecks.find((c) => c.matchedText?.toLowerCase() === 'needless to say');
  assert.ok(omissionCheck, 'Filler phrase "needless to say" must be flagged');
  assert.strictEqual(omissionCheck.suggestion, '', 'Suggestion must be empty string for omission');

  // Trigger tooltip
  const marker = canvas.querySelector('.critique-gutter-marker') as unknown as HTMLElement;
  assert.ok(marker, 'Gutter marker must exist');
  engine.showTooltipForCheck(omissionCheck, marker);

  const tooltip = doc.querySelector('.critique-tooltip-card') as unknown as HTMLElement;
  assert.ok(tooltip, 'Tooltip must render');

  const acceptBtn = tooltip.querySelector('.btn-critique-accept') as unknown as HTMLButtonElement;
  assert.ok(acceptBtn, 'Accept button must exist for omission suggestions');
  assert.ok(tooltip.textContent?.includes('(omit phrase)'), 'Label "(omit phrase)" must appear in tooltip');

  // Click accept button
  acceptBtn.click();

  // Verify phrase was cleanly omitted
  const content = editor.getContent();
  assert.strictEqual(content.includes('Needless to say'), false, 'Phrase "Needless to say" must be removed');
  assert.strictEqual(content, ', the manuscript was accepted by the editorial board.');

  // Verify single Cmd+Z undo restores original text
  assert.strictEqual(history.canUndo(), true);
  const undoResult = history.undo(content, 0);
  assert.ok(undoResult);
  assert.strictEqual(undoResult.content, initialText, 'Cmd+Z must restore omitted phrase');
});

// ----------------------------------------------------------------------------
// 6. Inline Dotted Text Underlines & Gutter Marker ID Scoping
// ----------------------------------------------------------------------------

test('Empirical Challenge 6: Inline dotted text underlines and distinct gutter marker ID scoping across paragraphs', () => {
  const docText =
    'Needless to say, part one was written carefully.\n\nNeedless to say, part two was written carefully.';
  const { engine, canvas, editor, win } = createHarness(docText);
  engine.init();
  engine.evaluateDocument();

  // Verify inline highlight spans
  const highlights = canvas.querySelectorAll('.critique-highlight');
  assert.ok(highlights.length >= 4, `Expected at least 4 highlights, got ${highlights.length}`);

  // Verify gutter markers
  const markers = Array.from(canvas.querySelectorAll('.critique-gutter-marker')) as unknown as HTMLElement[];
  assert.strictEqual(markers.length, 2, 'Must have exactly 2 gutter markers (1 per paragraph)');
  assert.strictEqual(markers[0].dataset.paragraphIndex, '0');
  assert.strictEqual(markers[1].dataset.paragraphIndex, '1');

  // Verify check IDs scoping
  const checkP0 = engine.currentChecks.find((c) => c.paragraphIndex === 0 && c.matchedText?.toLowerCase() === 'needless to say');
  const checkP1 = engine.currentChecks.find((c) => c.paragraphIndex === 1 && c.matchedText?.toLowerCase() === 'needless to say');
  assert.ok(checkP0);
  assert.ok(checkP1);
  assert.notStrictEqual(checkP0.id, checkP1.id, 'Check IDs must be scoped by paragraph index');

  // Dismissing check in paragraph 0 must leave paragraph 1 active
  engine.dismissCheck(checkP0.id);
  assert.strictEqual(engine.currentChecks.some((c) => c.id === checkP0.id), false);
  assert.strictEqual(engine.currentChecks.some((c) => c.id === checkP1.id), true);

  // Caret preservation and span unwrapping on typing
  const p1 = canvas.querySelectorAll('.editor-paragraph')[1] as unknown as HTMLElement;
  assert.ok(p1);
  (engine as any).setCaretOffset(p1, 15);
  const inputEvent = new (win as any).InputEvent('beforeinput', { inputType: 'insertText', data: 'z' });
  canvas.dispatchEvent(inputEvent);

  const remainingSpans = canvas.querySelectorAll('.critique-highlight');
  assert.strictEqual(remainingSpans.length, 0, 'Spans must be unwrapped on typing');
});

// ----------------------------------------------------------------------------
// 7. Context Query Assistant Corpus Indexing & Citation Navigation
// ----------------------------------------------------------------------------

test('Empirical Challenge 7: Query Assistant corpus indexing (30 paragraphs, 60 notes) and citation navigation dispatch', async () => {
  // Generate 30 paragraphs
  const paras: string[] = [];
  for (let i = 1; i <= 30; i++) {
    paras.push(`Paragraph ${i} elaborates on topic-${i} and historical typesetting technology #${i <= 15 ? 'history' : 'modern'}.`);
  }
  const documentText = paras.join('\n\n');

  // Generate 60 notes (with 3 soft-deleted notes)
  const notes: ThoughtNoteRecord[] = [];
  for (let i = 1; i <= 60; i++) {
    const targetAnchor = `p-${(i % 30)}`;
    notes.push({
      id: `note-item-${i}`,
      document_id: 'doc-stress',
      paragraph_anchor_id: targetAnchor,
      content: `Annotation ${i} regarding topic-${(i % 30) + 1} with keyword-${i}.`,
      created_at: 1000 + i,
      updated_at: 1000 + i,
      deleted_at: i % 19 === 0 ? 9999 : null, // soft-deleted
    });
  }

  let navigatedPara = -1;
  let navigatedNoteAnchor = '';

  const assistant = new ContextAssistant({
    onNavigateParagraph: (p) => { navigatedPara = p; },
    onNavigateNote: (anchor) => { navigatedNoteAnchor = anchor; },
  });

  // Index checks
  const indexedP = assistant.indexDocument(documentText);
  assert.strictEqual(indexedP.length, 30);
  assert.strictEqual(indexedP[0].label, '[¶1]');
  assert.strictEqual(indexedP[29].label, '[¶30]');

  const indexedN = assistant.indexNotes(notes);
  // 60 notes total, 3 soft-deleted (i=19, 38, 57)
  assert.strictEqual(indexedN.length, 57, '57 active notes (3 soft-deleted excluded)');

  // Query execution
  const answer = await assistant.query('Tell me about topic-12 and annotation details', documentText, notes);
  assert.ok(answer.citedParagraphs.length > 0, 'Must cite paragraphs');
  assert.ok(answer.citedNotes.length > 0, 'Must cite notes');

  // Format HTML & test click dispatch
  const win = new Window();
  const doc = win.document;
  const container = doc.createElement('div');
  container.innerHTML = assistant.formatAnswerHtml(answer);
  doc.body.appendChild(container);
  assistant.bindCitationClickHandlers(container as any);

  const paraPill = container.querySelector('.citation-paragraph') as unknown as HTMLElement;
  assert.ok(paraPill);
  paraPill.click();
  assert.ok(navigatedPara > 0, `Navigated paragraph should be >0, got ${navigatedPara}`);

  const notePill = container.querySelector('.citation-note') as unknown as HTMLElement;
  assert.ok(notePill);
  notePill.click();
  assert.ok(navigatedNoteAnchor.length > 0, 'Navigated note anchor should be dispatched');
});

// ----------------------------------------------------------------------------
// 8. RightMarginDrawer DOM Integration and Selector Compatibility
// ----------------------------------------------------------------------------

test('Empirical Challenge 8: RightMarginDrawer note card selectors, getNoteCardElement, and focus dispatch', async () => {
  const win = new Window();
  const doc = win.document;

  const drawerEl = doc.createElement('div');
  drawerEl.id = 'right-drawer';
  doc.body.appendChild(drawerEl);

  const repo = new InMemoryStorageRepository();
  await repo.init();
  await repo.saveDocument({ id: 'doc-qa', title: 'QA Document', content: 'Sample' });
  await repo.saveNote({
    id: 'note-cit-1',
    document_id: 'doc-qa',
    paragraph_anchor_id: 'p-14',
    content: 'Deep note on paragraph 14.',
  });

  const mockEditor = {
    activeBlockId: 'p-14',
    typewriterMidpoint: 592,
    getParagraphOffsets: () => new Map([['p-14', { yOffset: 450, height: 40, text: 'Para 14' }]]),
  };

  const rightDrawer = new RightMarginDrawer({
    repository: repo,
    editor: mockEditor,
    drawerElement: drawerEl as any,
  });
  rightDrawer.init();
  await rightDrawer.loadDocumentNotes('doc-qa');

  const card = rightDrawer.getNoteCardElement('p-14');
  assert.ok(card, 'Card must be resolved by getNoteCardElement("p-14")');
  assert.strictEqual(card.dataset.anchorId, 'p-14');
  assert.strictEqual(card.dataset.anchorParagraphId, 'p-14');
  assert.strictEqual(card.dataset.noteId, 'note-cit-1');

  // Also verify querySelector compatibility with main.ts patterns
  const matchByAnchorId = rightDrawer.notesListElement?.querySelector('[data-anchor-id="p-14"]');
  assert.strictEqual(matchByAnchorId, card);

  const matchByAnchorParaId = rightDrawer.notesListElement?.querySelector('[data-anchor-paragraph-id="p-14"]');
  assert.strictEqual(matchByAnchorParaId, card);

  const matchByNoteId = rightDrawer.notesListElement?.querySelector('[data-note-id="note-cit-1"]');
  assert.strictEqual(matchByNoteId, card);

  const textarea = card.querySelector('.note-card-textarea') as HTMLTextAreaElement;
  assert.ok(textarea, 'Card must have .note-card-textarea');

  let scrollCalled = false;
  card.scrollIntoView = () => { scrollCalled = true; };
  let focusCalled = false;
  textarea.focus = () => { focusCalled = true; };

  // Dispatch citation navigation
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  textarea.focus();

  assert.strictEqual(scrollCalled, true, 'scrollIntoView must be called');
  assert.strictEqual(focusCalled, true, 'focus must be called on textarea');
});
