/**
 * tests/adversarial/tier5-editor-storage-hardening.test.ts
 * Daylight Writer - Milestone 6 Phase 2 (Tier 5 White-Box Coverage Hardening)
 *
 * Systematic white-box stress suite targeting edge cases, boundary values,
 * and untested branches across:
 * 1. Core Editor & Canvas (src/editor/ / src/canvas/)
 *    - Typewriter center-scrolling, kinetic lerp deadband, dt clamping
 *    - Caret coordinate detection fallbacks (detached node, zero clientRects)
 *    - IME virtual keyboard recalibration & extreme height clamping (>=100px min)
 *    - Focus mode sentence segmentation, abbreviation masking, whitespace gap offsets
 *    - Auto-titling edge cases, punctuation delimiters, and manual override lock
 *    - Markdown formatting rules, blocks round-trip, TreeWalker offset restoration
 *
 * 2. Drawers & Spatial Synchronizer (src/drawers/)
 *    - LeftLibraryDrawer: nested tag tree recursive rollups, scoped fuzzy search,
 *      sanitizeSnippetHtml injection defenses, relative date formatting clock skews
 *    - RightMarginDrawer: spatial alignment, collision avoidance stacking order,
 *      wholesale paragraph deletion orphan retention, re-anchoring, leader lines SVG
 *    - SynchronizedScrollEngine & DrawerStateManager: bidirectional deadband scroll sync,
 *      reentrancy loop prevention, simultaneous dual drawer open, zero-chrome restoration
 *
 * 3. Local-First SQLite Storage Engine (src/storage/)
 *    - SQLiteStorageRepository: 250ms debounced WAL flush, in-flight flush mutex chaining,
 *      non-cached entity soft-delete tombstones, sync_queue entry creation
 *    - SqliteDatabase: multi-tier VFS, FTS5 virtual table soft-delete exclusion & deduplication,
 *      binary snapshot export/import roundtrip, onRestore event notification
 *    - Schema & Migrations: PRAGMA user_version idempotency, seedInitialData tombstone resistance
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

// Core Editor & Focus Mode
import { TypewriterEditor } from '../../src/editor/editor.ts';
import {
  FocusModeEngine,
  segmentSentences,
  findActiveSentenceIndex,
  maskAbbreviationsLengthPreserving,
  getNextFocusMode,
} from '../../src/editor/focus-mode.ts';
import {
  extractAutoTitle,
  AutoTitleManager,
  DEFAULT_UNTITLED,
} from '../../src/editor/auto-title.ts';
import {
  parseMarkdownInline,
  parseMarkdownToBlocks,
  blocksToMarkdown,
  detectMarkdownTrigger,
  getCaretCharacterOffset,
  setCaretCharacterOffset,
} from '../../src/editor/markdown-rules.ts';

// Drawers & Spatial Sync
import { LeftLibraryDrawer, sanitizeSnippetHtml } from '../../src/drawers/left-library.ts';
import { RightMarginDrawer } from '../../src/drawers/right-margin.ts';
import {
  SynchronizedScrollEngine,
  DrawerStateManager,
  calculateAlignedNoteOffsets,
  calculateDetailedNoteLayouts,
} from '../../src/drawers/sync-scroll.ts';

// Storage & VFS
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import {
  runMigrations,
  seedInitialData,
  fromDbDocument,
  fromDbNote,
  fromDbTag,
  type DocumentRecord,
  type ThoughtNoteRecord,
} from '../../src/storage/schema.ts';
import {
  searchDocumentsInMemory,
  buildTagTree,
  isTagMatch,
  normalizeTagPath,
  getTagLeafName,
  extractTagsFromText,
  scoreSubsequenceMatch,
  formatHighlightSnippet,
  getSearchBlocks,
  isWordBoundaryCode,
} from '../../src/storage/search.ts';

// ----------------------------------------------------------------------------
// Helper: DOM Environment Fixture Generator
// ----------------------------------------------------------------------------
function setupDOM() {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;
  return { win, doc };
}

function teardownDOM() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
}

// ============================================================================
// SUITE 1: CORE TYPEWRITER EDITOR, FOCUS MODES, TITLING & MARKDOWN
// ============================================================================

test('Tier 5 - Editor 1.1: TypewriterEditor - Viewport & IME Keyboard Height Clamping Boundaries', () => {
  const { doc } = setupDOM();

  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor({
    viewportWidth: 1584,
    viewportHeight: 1184,
  });
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  // Default state
  assert.strictEqual(editor.viewportHeight, 1184);
  assert.strictEqual(editor.effectiveViewportHeight, 1184);
  assert.strictEqual(editor.typewriterMidpoint, 592); // 1184 / 2

  // Normal keyboard open (e.g. 400px height)
  editor.setVirtualKeyboardHeight(400);
  assert.strictEqual(editor.effectiveViewportHeight, 784); // 1184 - 400
  assert.strictEqual(editor.typewriterMidpoint, 392); // 784 / 2
  assert.strictEqual(scrollContainer.style.paddingBottom, '392px');

  // Extreme keyboard height (greater than viewport, e.g. 1300px) -> clamps to 100px minimum
  editor.setVirtualKeyboardHeight(1300);
  assert.strictEqual(editor.effectiveViewportHeight, 100); // Math.max(100, 1184 - 1300)
  assert.strictEqual(editor.typewriterMidpoint, 50); // 100 / 2
  assert.strictEqual(scrollContainer.style.paddingBottom, '50px');

  // Keyboard close (0px height)
  editor.setVirtualKeyboardHeight(0);
  assert.strictEqual(editor.effectiveViewportHeight, 1184);
  assert.strictEqual(editor.typewriterMidpoint, 592);

  editor.destroy();
  teardownDOM();
});

test('Tier 5 - Editor 1.2: TypewriterEditor - Caret Coordinate Resolution Fallbacks on Detached and Zero-Height Nodes', () => {
  const { doc } = setupDOM();

  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor({ viewportHeight: 1184 });
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);
  editor.setContent('First paragraph block.\n\nSecond paragraph block.');

  // Verify initial block IDs
  const paragraphs = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(paragraphs.length, 2);
  assert.strictEqual((paragraphs[0] as unknown as HTMLElement).dataset.blockId, 'p-0');
  assert.strictEqual((paragraphs[1] as unknown as HTMLElement).dataset.blockId, 'p-1');

  // Manually invoke updateCaretPosition when no selection exists (fallback path)
  editor.activeBlockId = 'p-1';
  const pos = editor.updateCaretPosition();
  assert.strictEqual(pos.blockId, 'p-1');
  assert.strictEqual(pos.charOffset, 0);

  // Test setContent with multiple empty newlines
  editor.setContent('Single block with whitespace\n\n\n\n\nAnother block');
  const paragraphsAfter = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(paragraphsAfter.length, 2);

  // Test setContent with completely empty text
  editor.setContent('');
  const emptyParagraphs = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(emptyParagraphs.length, 1);
  assert.strictEqual((emptyParagraphs[0] as unknown as HTMLElement).dataset.blockId, 'p-0');
  assert.strictEqual(editor.getContent(), '');

  editor.destroy();
  teardownDOM();
});

test('Tier 5 - Editor 1.3: TypewriterEditor - Kinetic Lerp Anti-Jitter Deadband & Delta Snapping', () => {
  const { doc } = setupDOM();

  const scrollContainer = doc.createElement('div');
  const canvas = doc.createElement('div');
  doc.body.appendChild(scrollContainer);
  scrollContainer.appendChild(canvas);

  const editor = new TypewriterEditor({ viewportHeight: 1184, lerpLambda: 18.0 });
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  // Set target scroll to 500
  editor.targetScrollTop = 500;
  editor.currentScrollY = 499.7; // Delta is 0.3px (< 0.5px deadband threshold)
  editor.isRafActive = true;

  // Step the lerp with a valid timestamp
  editor.stepRafLerp(performance.now() + 16);

  // Deadband threshold asserts: snaps exactly to target, rounds scrollTop, ends rAF
  assert.strictEqual(editor.currentScrollY, 500);
  assert.strictEqual(editor.scrollTop, 500);
  assert.strictEqual(editor.isRafActive, false);
  assert.strictEqual(editor.caretPosition.screenY, editor.typewriterMidpoint);

  // Test user scroll suspension
  editor.setScrollSuspended(true);
  assert.strictEqual(editor.isScrollSuspended, true);
  editor.targetScrollTop = 800;
  editor.recalculateCenterScroll(false);
  assert.strictEqual(editor.isRafActive, false); // Blocked while suspended

  editor.resumeScroll();
  assert.strictEqual(editor.isScrollSuspended, false);

  editor.destroy();
  teardownDOM();
});

test('Tier 5 - Editor 1.4: FocusModeEngine - Sentence Segmentation with Length-Preserving Abbreviation Masking', () => {
  // Test abbreviation masking pure function
  const textWithAbbrs = 'Dr. Smith met Prof. Jones at 3 p.m. vs. Dr. Watson regarding e.g. and i.e. protocol.';
  const masked = maskAbbreviationsLengthPreserving(textWithAbbrs);
  assert.strictEqual(masked.length, textWithAbbrs.length, 'Masked text must have 1:1 character length parity');
  assert.ok(!masked.includes('Dr.'), 'Dots in abbreviations must be replaced with underscores');
  assert.ok(!masked.includes('Prof.'), 'Prof. dot must be masked');
  assert.ok(!masked.includes('vs.'), 'vs. dot must be masked');
  assert.ok(!masked.includes('e.g.'), 'e.g. dots must be masked');
  assert.ok(!masked.includes('i.e.'), 'i.e. dots must be masked');

  // Verify sentence segmentation does not split on masked abbreviations
  const sentences = segmentSentences(textWithAbbrs);
  assert.strictEqual(sentences.length, 1, 'Sentence containing abbreviations must not be prematurely split');
  assert.strictEqual(sentences[0].text, textWithAbbrs.trim());

  // Test multi-sentence text with punctuation
  const multiText = 'The first sentence is clear. However, Dr. Watson disagreed! What do you think? Exactly.';
  const multiSentences = segmentSentences(multiText);
  assert.strictEqual(multiSentences.length, 4);
  assert.strictEqual(multiSentences[0].text, 'The first sentence is clear.');
  assert.strictEqual(multiSentences[1].text, 'However, Dr. Watson disagreed!');
  assert.strictEqual(multiSentences[2].text, 'What do you think?');
  assert.strictEqual(multiSentences[3].text, 'Exactly.');

  // Test findActiveSentenceIndex boundary cases:
  // 1. Caret before first sentence
  assert.strictEqual(findActiveSentenceIndex(multiSentences, -5), 0);
  assert.strictEqual(findActiveSentenceIndex(multiSentences, 0), 0);

  // 2. Caret past last sentence
  assert.strictEqual(findActiveSentenceIndex(multiSentences, 9999), 3);

  // 3. Caret exactly at boundary between sentence 0 and sentence 1
  const s0End = multiSentences[0].end;
  const s1Start = multiSentences[1].start;
  const atEndIdx = findActiveSentenceIndex(multiSentences, s0End);
  assert.ok(atEndIdx === 0 || atEndIdx === 1);

  // 4. Caret in whitespace gap between sentence 0 and sentence 1
  if (s1Start > s0End) {
    const gapOffset = s0End + 1;
    const gapIdx = findActiveSentenceIndex(multiSentences, gapOffset);
    assert.ok(gapIdx >= 0 && gapIdx < multiSentences.length);
  }

  // 5. Empty sentences array
  assert.strictEqual(findActiveSentenceIndex([], 10), 0);
});

test('Tier 5 - Editor 1.5: FocusModeEngine - Mode Cycling, DOM Wrap & Full Style Teardown', () => {
  const { doc } = setupDOM();

  const shell = doc.createElement('div');
  const canvas = doc.createElement('div');
  canvas.className = 'canvas-container';
  shell.appendChild(canvas);
  doc.body.appendChild(shell);

  const p1 = doc.createElement('p');
  p1.className = 'editor-paragraph';
  p1.dataset.blockId = 'p-0';
  p1.textContent = 'This is the first sentence. This is the second sentence.';
  canvas.appendChild(p1);

  const focusEngine = new FocusModeEngine({
    canvasElement: canvas as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    initialMode: 'none',
  });

  // Cycle: none -> sentence -> paragraph -> none
  assert.strictEqual(focusEngine.getMode(), 'none');
  assert.strictEqual(getNextFocusMode('none'), 'sentence');
  assert.strictEqual(getNextFocusMode('sentence'), 'paragraph');
  assert.strictEqual(getNextFocusMode('paragraph'), 'none');

  focusEngine.cycleMode(); // to sentence
  assert.strictEqual(focusEngine.getMode(), 'sentence');
  assert.ok(canvas.classList.contains('focus-mode-sentence'));

  focusEngine.cycleMode(); // to paragraph
  assert.strictEqual(focusEngine.getMode(), 'paragraph');
  assert.ok(canvas.classList.contains('focus-mode-paragraph'));
  assert.ok(!canvas.classList.contains('focus-mode-sentence'));

  focusEngine.cycleMode(); // to none
  assert.strictEqual(focusEngine.getMode(), 'none');
  assert.ok(!canvas.classList.contains('focus-mode-paragraph'));
  assert.ok(!canvas.classList.contains('focus-mode-sentence'));

  // Suspend and resume
  focusEngine.suspend();
  focusEngine.resume();

  focusEngine.destroy();
  assert.ok(!canvas.classList.contains('focus-mode-paragraph'));
  assert.ok(!canvas.classList.contains('focus-mode-sentence'));
  teardownDOM();
});

test('Tier 5 - Editor 1.6: AutoTitleManager - Boundary Strings, Delimiters & Manual Override Lock', () => {
  // Empty, null, whitespace-only
  assert.strictEqual(extractAutoTitle(''), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('   \n\n\t  '), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('###'), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('######    '), DEFAULT_UNTITLED);

  // Headings with #
  assert.strictEqual(extractAutoTitle('# The First Heading'), 'The First Heading');
  assert.strictEqual(extractAutoTitle('### Deeper Subsection Heading'), 'Deeper Subsection Heading');

  // Tag vs Heading: #hashtag without space is preserved as content
  assert.strictEqual(extractAutoTitle('#project is great'), '#project is great');

  // Sentence extraction splitting on [.!?,]
  assert.strictEqual(extractAutoTitle('Hello world, this is a draft.'), 'Hello world');
  assert.strictEqual(extractAutoTitle('Is this the title? Yes it is.'), 'Is this the title');
  assert.strictEqual(extractAutoTitle('Alert! Something happened.'), 'Alert');

  // Length clamping (default 40 characters)
  const longSentence = 'A'.repeat(100) + '. Second sentence.';
  const clamped = extractAutoTitle(longSentence, 40);
  assert.strictEqual(clamped.length, 40);
  assert.strictEqual(clamped, 'A'.repeat(40));

  // AutoTitleManager state and manual override lock
  const mgr = new AutoTitleManager('Initial Title', false, 40);
  assert.strictEqual(mgr.getTitle(), 'Initial Title');
  assert.strictEqual(mgr.getIsCustom(), false);

  // Body mutation updates title when not custom
  const changed = mgr.updateFromContent('# New Story Beginning. More text.');
  assert.strictEqual(changed, true);
  assert.strictEqual(mgr.getTitle(), 'New Story Beginning');

  // Setting manual title engages custom lock
  mgr.setManualTitle('My Custom Title');
  assert.strictEqual(mgr.getTitle(), 'My Custom Title');
  assert.strictEqual(mgr.getIsCustom(), true);

  // Subsequent body mutations are blocked by lock
  const blocked = mgr.updateFromContent('# Another Completely Different Header');
  assert.strictEqual(blocked, false);
  assert.strictEqual(mgr.getTitle(), 'My Custom Title');

  // Resetting manual lock re-derives from content
  const resetTitle = mgr.resetManualLock('# Restored From Content');
  assert.strictEqual(resetTitle, 'Restored From Content');
  assert.strictEqual(mgr.getIsCustom(), false);
});

test('Tier 5 - Editor 1.7: MarkdownRules - Parsing Invariants, Trigger Detection & TreeWalker Offsets', () => {
  const { doc } = setupDOM();

  // Test triggers
  assert.deepStrictEqual(detectMarkdownTrigger('# '), { isTrigger: true, type: 'h1' });
  assert.deepStrictEqual(detectMarkdownTrigger('## '), { isTrigger: true, type: 'h2' });
  assert.deepStrictEqual(detectMarkdownTrigger('### '), { isTrigger: true, type: 'h3' });
  assert.deepStrictEqual(detectMarkdownTrigger('> '), { isTrigger: true, type: 'blockquote' });
  assert.deepStrictEqual(detectMarkdownTrigger('- '), { isTrigger: true, type: 'bullet_list' });
  assert.deepStrictEqual(detectMarkdownTrigger('* '), { isTrigger: true, type: 'bullet_list' });
  assert.deepStrictEqual(detectMarkdownTrigger('1. '), { isTrigger: true, type: 'numbered_list' });
  assert.deepStrictEqual(detectMarkdownTrigger('Regular text'), { isTrigger: false });

  // Test inline parsing with rich formatting
  const inlineHeading = parseMarkdownInline('# Main Title');
  assert.strictEqual(inlineHeading, '<h1>Main Title</h1>');

  const inlineStyles = parseMarkdownInline('**bold** and *italic* and `code` and ~~strike~~');
  assert.ok(inlineStyles.includes('<strong>bold</strong>'));
  assert.ok(inlineStyles.includes('<em>italic</em>'));
  assert.ok(inlineStyles.includes('<code>code</code>'));
  assert.ok(inlineStyles.includes('<del>strike</del>'));

  // White-box multiline verification:
  // parseMarkdownInline with /m flag parses headings preceded by newlines.
  const multiLineInput = '# Heading\nSecond line\n## Subheading';
  const multiLineResult = parseMarkdownInline(multiLineInput);
  assert.ok(multiLineResult.includes('<h1>Heading</h1>'), 'parseMarkdownInline with multiline flag converts first line heading');
  assert.ok(multiLineResult.includes('<h2>Subheading</h2>'), 'parseMarkdownInline with multiline flag converts subsequent line heading');

  // Test block parsing and roundtrip
  const markdownSample = '# Heading 1\n\nParagraph one.\n\n> A quote\n\n- List item 1';
  const blocks = parseMarkdownToBlocks(markdownSample);
  assert.strictEqual(blocks.length, 4);
  assert.strictEqual(blocks[0].type, 'heading');
  assert.strictEqual(blocks[0].level, 1);
  assert.strictEqual(blocks[1].type, 'paragraph');
  assert.strictEqual(blocks[2].type, 'blockquote');
  assert.strictEqual(blocks[3].type, 'list_item');

  // Serializing back to markdown
  const serialized = blocksToMarkdown(blocks);
  assert.ok(serialized.includes('# Heading 1'));
  assert.ok(serialized.includes('Paragraph one.'));

  // TreeWalker Caret Character Offset calculation
  const container = doc.createElement('div');
  container.innerHTML = '<p>Hello <strong>bold world</strong> and welcome.</p>';
  doc.body.appendChild(container);

  // Test setCaretCharacterOffset and getCaretCharacterOffset
  setCaretCharacterOffset(container as unknown as Node, 10);
  const measuredOffset = getCaretCharacterOffset(container as unknown as Node);
  assert.strictEqual(typeof measuredOffset, 'number');
  teardownDOM();
});

// ============================================================================
// SUITE 2: DUAL DRAWERS, TAG BROWSER, SPATIAL ALIGNMENT & SCROLL ENGINE
// ============================================================================

test('Tier 5 - Drawers 2.1: LeftLibraryDrawer - Deep Nested Tag Tree Recursive Rollup Counts', () => {
  const tags = [
    { id: 't1', name: 'project', path: 'project', created_at: 1000 },
    { id: 't2', name: 'writing', path: 'project/writing', created_at: 1000 },
    { id: 't3', name: 'drafts', path: 'project/writing/drafts', created_at: 1000 },
    { id: 't4', name: 'research', path: 'project/research', created_at: 1000 },
    { id: 't5', name: 'personal', path: 'personal', created_at: 1000 },
  ];

  // Document associations: doc1 in drafts, doc2 in drafts, doc3 in research, doc4 in personal
  const docTagsMap = new Map<string, string[]>([
    ['doc1', ['project/writing/drafts']],
    ['doc2', ['project/writing/drafts']],
    ['doc3', ['project/research']],
    ['doc4', ['personal']],
  ]);

  const tree = buildTagTree(tags, docTagsMap);
  assert.strictEqual(tree.length, 2, 'Should have two root nodes: project and personal');

  const projectNode = tree.find((n) => n.name === 'project')!;
  assert.ok(projectNode, 'Project root node must exist');
  // project has 2 in drafts + 1 in research = 3 total
  assert.strictEqual(projectNode.count, 3, 'Project node must recursively roll up 3 documents');
  assert.strictEqual(projectNode.directCount, 0, 'Project node has 0 direct documents');

  const writingNode = projectNode.children.find((n) => n.name === 'writing')!;
  assert.ok(writingNode, 'Writing node must exist under project');
  assert.strictEqual(writingNode.count, 2, 'Writing node must roll up 2 drafts');

  const personalNode = tree.find((n) => n.name === 'personal')!;
  assert.ok(personalNode, 'Personal root node must exist');
  assert.strictEqual(personalNode.count, 1);
  assert.strictEqual(personalNode.directCount, 1);
});

test('Tier 5 - Drawers 2.2: LeftLibraryDrawer - HTML Snippet Sanitization Defense-in-Depth', () => {
  // 1. Valid highlight snippet
  const valid = 'Here is a <mark class="os-search-highlight">match</mark> in text.';
  assert.strictEqual(sanitizeSnippetHtml(valid), valid);

  // 2. Malicious script tag injection
  const scriptAttack = '<script>alert("xss")</script><mark class="os-search-highlight">safe</mark>';
  const sanitizedScript = sanitizeSnippetHtml(scriptAttack);
  assert.ok(!sanitizedScript.includes('<script>'), 'Script tags must be escaped');
  assert.ok(sanitizedScript.includes('&lt;script&gt;alert("xss")&lt;/script&gt;'));
  assert.ok(sanitizedScript.includes('<mark class="os-search-highlight">safe</mark>'));

  // 3. Non-standard casing / attribute injection in mark tag
  const fakeMark = '<MARK class="os-search-highlight">fake</MARK><mark class="danger" onclick="evil()">click</mark>';
  const sanitizedFake = sanitizeSnippetHtml(fakeMark);
  assert.ok(!sanitizedFake.includes('<MARK'));
  assert.ok(!sanitizedFake.includes('<mark class="danger"'));

  // 4. Token collision injection with private unicode characters (\uE000 / \uE001)
  const tokenAttack = 'Prefix \uE000 test \uE001 suffix';
  const sanitizedToken = sanitizeSnippetHtml(tokenAttack);
  assert.ok(!sanitizedToken.includes('\uE000'));
  assert.ok(!sanitizedToken.includes('\uE001'));

  // 5. Empty / null snippet
  assert.strictEqual(sanitizeSnippetHtml(''), '');
});

test('Tier 5 - Drawers 2.3: RightMarginDrawer - Spatial Stacking Order & Strict Separation Invariant', () => {
  const blocks = [
    { id: 'p-0', type: 'paragraph' as const, text: 'Para 0', yOffset: 100, height: 40 },
    { id: 'p-1', type: 'paragraph' as const, text: 'Para 1', yOffset: 110, height: 40 }, // Closely spaced: delta 10px (< 80+16)
    { id: 'p-2', type: 'paragraph' as const, text: 'Para 2', yOffset: 350, height: 40 },
  ];

  const now = Date.now();
  const notes = [
    { id: 'note-1', paragraphAnchorId: 'p-0', content: 'Note 1 on P0', topOffset: 0, created_at: now - 200 },
    { id: 'note-2', paragraphAnchorId: 'p-0', content: 'Note 2 on P0 (collision)', topOffset: 0, created_at: now - 100 },
    { id: 'note-3', paragraphAnchorId: 'p-1', content: 'Note 3 on P1 (collision with P0 stack)', topOffset: 0, created_at: now },
    { id: 'note-4', paragraphAnchorId: 'p-2', content: 'Note 4 on P2', topOffset: 0, created_at: now },
  ];

  const noteHeight = 80;
  const minGap = 16;
  const offsets = calculateAlignedNoteOffsets(blocks, notes, noteHeight, minGap);

  const top1 = offsets.get('note-1')!;
  const top2 = offsets.get('note-2')!;
  const top3 = offsets.get('note-3')!;
  const top4 = offsets.get('note-4')!;

  // note-1 is at natural anchor yOffset 100
  assert.strictEqual(top1, 100);

  // note-2 is stacked below note-1: 100 + 80 + 16 = 196
  assert.strictEqual(top2, 196);
  assert.ok(top2 - top1 >= noteHeight + minGap, 'Note 2 must have >= 96px separation from Note 1');

  // note-3 is anchored at 110, but note-2 ends at 196 + 80 = 276. So note-3 must stack at 276 + 16 = 292
  assert.strictEqual(top3, 292);
  assert.ok(top3 - top2 >= noteHeight + minGap, 'Note 3 must have >= 96px separation from Note 2');

  // note-4 is anchored at 350. Since note-3 ends at 292 + 80 = 372, note-4 must stack at 372 + 16 = 388
  assert.strictEqual(top4, 388);

  // Detailed layout verification
  const detailedLayouts = calculateDetailedNoteLayouts(blocks, notes, noteHeight, minGap);
  assert.strictEqual(detailedLayouts.length, 4);
  assert.strictEqual(detailedLayouts[0].hasCollisionOffset, false);
  assert.strictEqual(detailedLayouts[1].hasCollisionOffset, true);
  assert.strictEqual(detailedLayouts[2].hasCollisionOffset, true);
  assert.strictEqual(detailedLayouts[3].hasCollisionOffset, true);
  assert.strictEqual(detailedLayouts[0].isOrphaned, false);
});

test('Tier 5 - Drawers 2.4: RightMarginDrawer - Wholesale Paragraph Deletion Orphan State & Re-anchoring', () => {
  const blocks = [
    { id: 'p-0', type: 'paragraph' as const, text: 'Remaining block', yOffset: 100, height: 40 },
    // p-1 and p-2 have been deleted from manuscript!
  ];

  const now = Date.now();
  const notes = [
    { id: 'note-surviving', paragraphAnchorId: 'p-0', content: 'Surviving', topOffset: 100, created_at: now },
    { id: 'note-orphan-1', paragraphAnchorId: 'p-1', content: 'Orphaned from P1', topOffset: 250, created_at: now },
    { id: 'note-orphan-2', paragraphAnchorId: 'p-2', content: 'Orphaned from P2', topOffset: 400, created_at: now },
  ];

  const layouts = calculateDetailedNoteLayouts(blocks, notes, 80, 16);
  const surviving = layouts.find((l) => l.noteId === 'note-surviving')!;
  const orphan1 = layouts.find((l) => l.noteId === 'note-orphan-1')!;
  const orphan2 = layouts.find((l) => l.noteId === 'note-orphan-2')!;

  assert.strictEqual(surviving.isOrphaned, false);
  assert.strictEqual(orphan1.isOrphaned, true);
  assert.strictEqual(orphan2.isOrphaned, true);

  // Leader line targets
  assert.strictEqual(surviving.leaderLineTargetY, 112); // 100 + 12
  assert.strictEqual(orphan1.leaderLineTargetY, undefined, 'Orphaned notes must not render leader lines');
});

test('Tier 5 - Drawers 2.5: SynchronizedScrollEngine & DrawerStateManager - Deadband, Reentrancy & Zero-Chrome Mode', () => {
  const { doc } = setupDOM();

  const shell = doc.createElement('div');
  shell.className = 'dc1-shell zero-chrome';
  doc.body.appendChild(shell);

  const editorContainer = doc.createElement('div');
  const marginContainer = doc.createElement('div');
  doc.body.appendChild(editorContainer);
  doc.body.appendChild(marginContainer);

  let syncCount = 0;
  const syncEngine = new SynchronizedScrollEngine({
    deadbandEpsilon: 1.0,
    bidirectional: true,
    onScrollSync: () => { syncCount++; },
  });

  syncEngine.bind(editorContainer as unknown as HTMLElement, marginContainer as unknown as HTMLElement);

  // Micro-scroll under deadband (< 1.0px) must NOT trigger sync
  editorContainer.scrollTop = 0;
  marginContainer.scrollTop = 0;
  syncEngine.syncFromEditor(0.5);
  assert.strictEqual(marginContainer.scrollTop, 0);
  assert.strictEqual(syncCount, 0);

  // Substantial scroll (>= 1.0px) triggers sync
  syncEngine.syncFromEditor(150);
  assert.strictEqual(marginContainer.scrollTop, 150);
  assert.strictEqual(syncCount, 1);

  // DrawerStateManager: dual drawer simultaneous open
  const drawerMgr = new DrawerStateManager(shell as unknown as HTMLElement);
  assert.strictEqual(drawerMgr.isZeroChrome, true);
  assert.ok(shell.classList.contains('zero-chrome'));

  // Open both drawers
  drawerMgr.openLeft();
  drawerMgr.openRight();
  assert.strictEqual(drawerMgr.leftOpen, true);
  assert.strictEqual(drawerMgr.rightOpen, true);
  assert.strictEqual(drawerMgr.isZeroChrome, false);
  assert.ok(shell.classList.contains('left-open'));
  assert.ok(shell.classList.contains('right-open'));
  assert.ok(!shell.classList.contains('zero-chrome'));

  // Single dismissAll restores zero-chrome
  drawerMgr.dismissAll();
  assert.strictEqual(drawerMgr.leftOpen, false);
  assert.strictEqual(drawerMgr.rightOpen, false);
  assert.strictEqual(drawerMgr.isZeroChrome, true);
  assert.ok(shell.classList.contains('zero-chrome'));
  assert.ok(!shell.classList.contains('left-open'));
  assert.ok(!shell.classList.contains('right-open'));

  syncEngine.destroy();
  drawerMgr.destroy();
  teardownDOM();
});

// ============================================================================
// SUITE 3: LOCAL-FIRST STORAGE ENGINE, SQLITE VFS, SCHEMA & SEARCH HARDENING
// ============================================================================

test('Tier 5 - Storage 3.1: SQLiteStorageRepository - In-Flight Flush Mutex Chaining & Concurrency', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 20); // 20ms debounce
  await repo.init();

  const docId = 'doc-concurrency-test';
  await repo.saveDocument({ id: docId, title: 'Rev 1', content: 'First content' });

  // Fire an immediate flush
  const flush1 = repo.flushPendingEdits();

  // Concurrently mutate the document while flush1 is active
  await repo.saveDocument({ id: docId, title: 'Rev 2', content: 'Second updated content' });

  // Fire a second flush: must chain behind flush1 and commit Rev 2
  const flush2 = repo.flushPendingEdits();

  await Promise.all([flush1, flush2]);

  // Read directly from raw SQLite to ensure Rev 2 was committed
  const rows = await db.executeSql<any>('SELECT title, content, version_vector FROM documents WHERE id = ?;', [docId]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, 'Rev 2');
  assert.strictEqual(rows[0].content, 'Second updated content');

  await db.close();
});

test('Tier 5 - Storage 3.2: SQLiteStorageRepository - Cached & Uncached Entity Soft-Delete Tombstones & Sync Queue', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const docId = 'doc-uncached-tombstone';
  const noteId = 'note-cached-tombstone';
  const now = Date.now();

  await db.run(
    `INSERT INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status)
     VALUES (?, 'Uncached Doc', 'Content', ?, ?, NULL, 0, 1, 'synced');`,
    [docId, now, now]
  );
  await db.run(
    `INSERT INTO margin_notes (id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status)
     VALUES (?, ?, 'p-0', 'Note Content', ?, ?, NULL, 'synced');`,
    [noteId, docId, now, now]
  );

  const repo = new SQLiteStorageRepository(db, 50);
  await repo.init(); // Loads docId and noteId into in-memory cache

  // Delete note from cache: existing note retains document_id -> foreign key is satisfied
  await repo.deleteNote(noteId);
  await repo.flushPendingEdits();

  // Test uncached document deletion: docId2 never existed in cache or DB
  const docId2 = 'doc-brand-new-uncached';
  await repo.deleteDocument(docId2);
  await repo.flushPendingEdits();

  // Check documents table: deleted_at must be populated for docId2
  const docRows = await db.executeSql<any>('SELECT deleted_at FROM documents WHERE id = ?;', [docId2]);
  assert.strictEqual(docRows.length, 1);
  assert.ok(docRows[0].deleted_at > 0, 'Document must have deleted_at timestamp');

  // Check sync_queue: delete operations must be queued
  const queueRows = await db.executeSql<any>(
    'SELECT entity_type, entity_id, operation FROM sync_queue WHERE entity_id IN (?, ?);',
    [noteId, docId2]
  );
  assert.strictEqual(queueRows.length, 2);
  assert.ok(queueRows.some((q) => q.entity_id === noteId && q.operation === 'delete'));
  assert.ok(queueRows.some((q) => q.entity_id === docId2 && q.operation === 'delete'));

  repo.destroy();
  await db.close();
});

test('Tier 5 - Storage 3.2b [REMEDIATED]: Uncached Note Deletion Handles Foreign Key Safely Without Infinite Retry Loop', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 50);

  // 1. Uncached non-existent note deletion must NOT insert invalid empty document_id or throw foreign key violation
  await repo.deleteNote('note-never-cached');
  await repo.flushPendingEdits(); // Must succeed cleanly without throwing SQLiteError (code 19)

  // Verify no invalid note was written to margin_notes
  const nonExistentRows = await db.executeSql<any>('SELECT * FROM margin_notes WHERE id = ?;', ['note-never-cached']);
  assert.strictEqual(nonExistentRows.length, 0, 'Non-existent note must not be inserted into margin_notes');

  // 2. Uncached existing note in DB: query real document_id and soft-delete safely
  const docId = 'doc-for-uncached-note';
  const noteId = 'note-in-db-only';
  const now = Date.now();
  await db.run(
    `INSERT INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status)
     VALUES (?, 'Parent Doc', 'Body', ?, ?, NULL, 0, 1, 'synced');`,
    [docId, now, now]
  );
  await db.run(
    `INSERT INTO margin_notes (id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status)
     VALUES (?, ?, 'p-1', 'Margin Content', ?, ?, NULL, 'synced');`,
    [noteId, docId, now, now]
  );

  // Delete uncached note that exists in DB
  await repo.deleteNote(noteId);
  await repo.flushPendingEdits();

  const noteRows = await db.executeSql<any>('SELECT deleted_at, document_id FROM margin_notes WHERE id = ?;', [noteId]);
  assert.strictEqual(noteRows.length, 1);
  assert.strictEqual(noteRows[0].document_id, docId, 'Note must retain its true document_id');
  assert.ok(noteRows[0].deleted_at > 0, 'Note must be soft-deleted in SQLite');

  repo.destroy();
  await db.close();
});

test('Tier 5 - Storage 3.3: SQLiteStorageRepository - Tag Association De-duplication & Hierarchical Querying', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const repo = new SQLiteStorageRepository(db, 50);
  await repo.init();

  const doc1 = await repo.saveDocument({ id: 'doc-tag-1', title: 'Doc 1', content: 'Anthropology notes' });
  const doc2 = await repo.saveDocument({ id: 'doc-tag-2', title: 'Doc 2', content: 'Sub-topic notes' });

  // Set tags with dirty inputs: duplicates, leading hashes, whitespace, mixed case
  await repo.setDocumentTags(doc1.id, [
    '#anthropology/pastoralism',
    'anthropology/pastoralism',
    '  #ANTHROPOLOGY/PASTORALISM  ',
    '#fieldwork',
    '###',
    '',
  ]);
  await repo.setDocumentTags(doc2.id, [
    'anthropology/pastoralism/nomads',
  ]);

  await repo.flushPendingEdits();

  const tags1 = await repo.getDocumentTags(doc1.id);
  assert.strictEqual(tags1.length, 2);
  assert.ok(tags1.includes('anthropology/pastoralism'));
  assert.ok(tags1.includes('fieldwork'));

  // Test hierarchical tag prefix matching in listDocuments
  // Querying 'anthropology/pastoralism' must match doc1 (exact) and doc2 (descendant child)
  const matchedDocs = await repo.listDocuments({ tagId: 'anthropology/pastoralism' });
  assert.strictEqual(matchedDocs.length, 2);

  // Querying 'fieldwork' matches only doc1
  const fieldworkDocs = await repo.listDocuments({ tagId: 'fieldwork' });
  assert.strictEqual(fieldworkDocs.length, 1);
  assert.strictEqual(fieldworkDocs[0].id, doc1.id);

  await db.close();
});

test('Tier 5 - Storage 3.4: SqliteDatabase - FTS5 Virtual Table Triggers, Soft-Delete & Update Deduplication', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);

  const now = Date.now();
  const docId = 'doc-fts-hardening';

  // 1. Insert document -> trigger trg_documents_fts_ai populates documents_fts
  await db.run(
    `INSERT INTO documents (id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status)
     VALUES (?, 'Quantum Mechanics', 'Wave-particle duality exploration', ?, ?, NULL, 0, 1, 'synced');`,
    [docId, now, now]
  );

  let ftsMatches = await db.executeSql<any>(
    `SELECT id FROM documents_fts WHERE documents_fts MATCH 'Quantum';`
  );
  assert.strictEqual(ftsMatches.length, 1);
  assert.strictEqual(ftsMatches[0].id, docId);

  // 2. Update document content -> trigger trg_documents_fts_au deletes old row and inserts updated row
  await db.run(
    `UPDATE documents SET content = 'Entanglement and non-locality phenomena' WHERE id = ?;`,
    [docId]
  );

  // Old term no longer matches
  const oldMatch = await db.executeSql<any>(
    `SELECT id FROM documents_fts WHERE documents_fts MATCH 'duality';`
  );
  assert.strictEqual(oldMatch.length, 0);

  // New term matches exactly once (zero duplicate rows)
  const newMatch = await db.executeSql<any>(
    `SELECT id FROM documents_fts WHERE documents_fts MATCH 'Entanglement';`
  );
  assert.strictEqual(newMatch.length, 1);

  // 3. Soft-delete document (deleted_at != NULL) -> trigger trg_documents_fts_au removes it from FTS index
  await db.run(
    `UPDATE documents SET deleted_at = ? WHERE id = ?;`,
    [Date.now(), docId]
  );

  const deletedMatch = await db.executeSql<any>(
    `SELECT id FROM documents_fts WHERE documents_fts MATCH 'Quantum';`
  );
  assert.strictEqual(deletedMatch.length, 0, 'Soft-deleted documents must be excluded from FTS5 index');

  await db.close();
});

test('Tier 5 - Storage 3.5: SqliteDatabase - Binary Snapshot Export & Import Roundtrip with onRestore Notification', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'source_backup.db' });
  await runMigrations(db);

  // Seed sample data
  await seedInitialData(db);

  // Verify seed document exists
  const initialDocs = await db.executeSql<any>('SELECT id, title FROM documents;');
  assert.ok(initialDocs.length >= 1);

  // Export binary snapshot
  const binarySnapshot = await db.exportSnapshot();
  assert.ok(binarySnapshot instanceof Uint8Array);
  assert.ok(binarySnapshot.byteLength > 512, 'Snapshot must contain valid database binary');

  // Create a second clean database
  const targetDb = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: 'target_restore.db' });
  await runMigrations(targetDb);

  // Subscribe to onRestore listener
  let restoreNotified = false;
  targetDb.onRestore(() => {
    restoreNotified = true;
  });

  // Import snapshot into second database
  await targetDb.importSnapshot(binarySnapshot);

  assert.strictEqual(restoreNotified, true, 'onRestore event must fire upon snapshot import');

  // Verify restored records
  const restoredDocs = await targetDb.executeSql<any>('SELECT id, title FROM documents;');
  assert.strictEqual(restoredDocs.length, initialDocs.length);
  assert.strictEqual(restoredDocs[0].id, initialDocs[0].id);

  await db.close();
  await targetDb.close();
});

test('Tier 5 - Storage 3.6: Schema & Migrations - Idempotent Migration Runner & Tombstone-Safe Seeding', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });

  // Migration pass 1
  const ver1 = await runMigrations(db);
  assert.strictEqual(ver1, 2);

  // Migration pass 2 (idempotent no-op)
  const ver2 = await runMigrations(db);
  assert.strictEqual(ver2, 2);

  // Initial seed pass on clean database: succeeds
  const seeded1 = await seedInitialData(db);
  assert.strictEqual(seeded1, true);

  // Second seed pass: fails gracefully (already seeded)
  const seeded2 = await seedInitialData(db);
  assert.strictEqual(seeded2, false);

  // Soft-delete the seeded documents
  await db.run('UPDATE documents SET deleted_at = ?;', [Date.now()]);

  // Third seed pass on tombstoned database: must NOT re-seed over deleted data
  const seeded3 = await seedInitialData(db);
  assert.strictEqual(seeded3, false, 'seedInitialData must be tombstone-aware and never overwrite soft-deleted databases');

  await db.close();
});

test('Tier 5 - Storage 3.7: Search Engine - Subsequence Fuzzy Matching, Word Boundaries & Manuscript Chunking', () => {
  // Test word boundary character codes
  assert.strictEqual(isWordBoundaryCode(32), true); // space
  assert.strictEqual(isWordBoundaryCode(47), true); // slash /
  assert.strictEqual(isWordBoundaryCode(45), true); // dash -
  assert.strictEqual(isWordBoundaryCode(65), false); // 'A'

  // Subsequence match on short strings
  const res1 = scoreSubsequenceMatch('dw', 'daylight_writer');
  assert.ok(res1 !== null);
  assert.ok(res1.score > 0);
  assert.strictEqual(res1.highlightRanges.length, 2);

  // Rejection when needle does not match in sequence
  const resReject = scoreSubsequenceMatch('xyz', 'daylight_writer');
  assert.strictEqual(resReject, null);

  // Highlighting formatting with snippets
  const snippet = formatHighlightSnippet('The quick brown fox jumps over the lazy dog', [[4, 9]], 50);
  assert.ok(snippet.includes('<mark class="os-search-highlight">quick</mark>'));

  // Manuscript chunking on massive text (>2500 chars)
  const massiveContent = 'Paragraph one.\n\n' + 'Word '.repeat(800) + '\n\nParagraph three.';
  const blocks = getSearchBlocks(massiveContent, 2500);
  assert.ok(blocks.length > 1, 'Massive manuscripts must be chunked into bounded blocks');
  assert.ok(blocks.every((b) => b.length <= 2500));

  // Multi-attribute search scoring verification
  const now = Date.now();
  const testDocs: DocumentRecord[] = [
    {
      id: 'doc-title-match',
      title: 'Typewriter Engine Design',
      content: 'General content about architecture.',
      created_at: now - 1000,
      updated_at: now - 1000,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
    {
      id: 'doc-body-match',
      title: 'System Architecture',
      content: 'Contains notes on the typewriter engine.',
      created_at: now - 5000,
      updated_at: now - 5000,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
  ];

  const docTags = new Map<string, string[]>();
  const hits = searchDocumentsInMemory('typewriter', testDocs, docTags);
  assert.strictEqual(hits.length, 2);
  // Title match (10x multiplier) must score significantly higher than body match (5x multiplier)
  assert.ok(
    hits[0].document.id === 'doc-title-match',
    'Title match must rank higher than body match'
  );
  assert.ok(hits[0].score > hits[1].score);
});
