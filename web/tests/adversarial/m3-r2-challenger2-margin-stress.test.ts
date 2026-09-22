/**
 * tests/adversarial/m3-r2-challenger2-margin-stress.test.ts
 * Milestone 3 Iteration 2 Challenger 2: Adversarial Stress & Empirical Verification Suite
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST FOR:
 * 1. Right margin note paragraph anchoring (getParagraphOffsets()).
 * 2. 50+ dense margin notes clustered on adjacent paragraphs with collision avoidance (>=16px vertical gap).
 * 3. Paragraph deletion orphan note retention with visual indicator, re-anchoring & resurrection.
 * 4. High-speed scroll synchronization (5,000 px/s) without jitter or lag (60Hz & 120Hz LivePaper).
 * 5. Keyboard shortcuts (Esc, Cmd+[, Cmd+]) and backdrop touch/click dismissal.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { RightMarginDrawer } from '../../src/drawers/right-margin.ts';
import {
  SynchronizedScrollEngine,
  DrawerStateManager,
  calculateAlignedNoteOffsets,
  calculateDetailedNoteLayouts,
  type ParagraphBlockInfo,
  type ThoughtNoteAnchor,
} from '../../src/drawers/sync-scroll.ts';
import { TypewriterEditor } from '../../src/editor/editor.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';

// ----------------------------------------------------------------------------
// Test Environment Fixture
// ----------------------------------------------------------------------------

interface MarginHarness {
  win: Window;
  doc: Document;
  shell: HTMLElement;
  drawerEl: HTMLElement;
  scrollContainer: HTMLElement;
  leaderSvg: SVGElement;
  notesList: HTMLElement;
  orphanedSection: HTMLElement;
  orphanedList: HTMLElement;
  orphanedCountBadge: HTMLElement;
  backdrop: HTMLElement;
  repo: InMemoryStorageRepository;
  editorOffsets: Map<string, { yOffset: number; height: number; text: string }>;
  editorMock: {
    activeBlockId: string;
    typewriterMidpoint: number;
    getParagraphOffsets: () => Map<string, { yOffset: number; height: number; text: string }>;
  };
  margin: RightMarginDrawer;
}

function setupMarginHarness(): MarginHarness {
  const win = new Window();
  const doc = win.document as unknown as Document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  const shell = doc.createElement('div');
  shell.className = 'dc1-shell zero-chrome';
  doc.body.appendChild(shell);

  const drawerEl = doc.createElement('aside');
  drawerEl.id = 'margin-drawer';
  drawerEl.className = 'drawer drawer-right';
  shell.appendChild(drawerEl);

  const scrollContainer = doc.createElement('div');
  scrollContainer.id = 'margin-scroll-container';
  scrollContainer.className = 'margin-scroll-container';
  drawerEl.appendChild(scrollContainer);

  const leaderSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaderSvg.id = 'margin-leader-svg';
  leaderSvg.setAttribute('class', 'margin-leader-svg');
  scrollContainer.appendChild(leaderSvg as unknown as Node);

  const notesList = doc.createElement('div');
  notesList.id = 'margin-notes-list';
  notesList.className = 'margin-notes-list';
  scrollContainer.appendChild(notesList);

  const orphanedSection = doc.createElement('div');
  orphanedSection.id = 'orphaned-notes-section';
  orphanedSection.className = 'orphaned-notes-section';
  orphanedSection.style.display = 'none';
  orphanedSection.innerHTML = `
    <div class="orphaned-header">
      <span class="orphaned-title">Orphaned Notes</span>
      <span id="orphaned-count-badge" class="orphaned-badge">0</span>
    </div>
    <div id="orphaned-notes-list" class="orphaned-notes-list"></div>
  `;
  drawerEl.appendChild(orphanedSection);

  const orphanedList = orphanedSection.querySelector('#orphaned-notes-list') as HTMLElement;
  const orphanedCountBadge = orphanedSection.querySelector('#orphaned-count-badge') as HTMLElement;

  const backdrop = doc.createElement('div');
  backdrop.id = 'drawer-backdrop';
  backdrop.className = 'drawer-backdrop';
  shell.appendChild(backdrop);

  const repo = new InMemoryStorageRepository();
  const editorOffsets = new Map<string, { yOffset: number; height: number; text: string }>();

  const editorMock = {
    activeBlockId: 'p-0',
    typewriterMidpoint: 592,
    getParagraphOffsets: () => editorOffsets,
  };

  const margin = new RightMarginDrawer({
    repository: repo,
    editor: editorMock,
    shellElement: shell as unknown as HTMLElement,
    drawerElement: drawerEl as unknown as HTMLElement,
    scrollContainer: scrollContainer as unknown as HTMLElement,
    notesListElement: notesList as unknown as HTMLElement,
    orphanedSection: orphanedSection as unknown as HTMLElement,
    orphanedListElement: orphanedList as unknown as HTMLElement,
    orphanedCountBadge: orphanedCountBadge as unknown as HTMLElement,
    leaderSvgElement: leaderSvg as unknown as SVGElement,
    minGapPx: 16,
    defaultNoteHeight: 80,
    debounceSaveMs: 10,
  });

  margin.init();

  return {
    win,
    doc,
    shell: shell as unknown as HTMLElement,
    drawerEl: drawerEl as unknown as HTMLElement,
    scrollContainer: scrollContainer as unknown as HTMLElement,
    leaderSvg: leaderSvg as unknown as SVGElement,
    notesList: notesList as unknown as HTMLElement,
    orphanedSection: orphanedSection as unknown as HTMLElement,
    orphanedList: orphanedList as unknown as HTMLElement,
    orphanedCountBadge: orphanedCountBadge as unknown as HTMLElement,
    backdrop: backdrop as unknown as HTMLElement,
    repo,
    editorOffsets,
    editorMock,
    margin,
  };
}

// ============================================================================
// SUITE 1: Right Margin Note Paragraph Anchoring (getParagraphOffsets())
// ============================================================================

test('Challenger 2 Suite 1.1: TypewriterEditor.getParagraphOffsets() dynamic coordinate extraction and reflow', async () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  const scrollContainer = doc.createElement('div');
  scrollContainer.id = 'editor-scroll-container';
  const canvas = doc.createElement('div');
  canvas.id = 'editor-canvas';
  scrollContainer.appendChild(canvas);
  doc.body.appendChild(scrollContainer);

  const editor = new TypewriterEditor();
  editor.init(scrollContainer as unknown as HTMLElement, canvas as unknown as HTMLElement);

  // 1. Initially set 3 paragraphs
  const initialText = 'First paragraph text.\n\nSecond paragraph prose.\n\nThird paragraph concluding thoughts.';
  editor.setContent(initialText);

  // Simulate DOM layout values for paragraphs in HappyDOM
  const pElements = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(pElements.length, 3, 'Canvas must render 3 paragraph blocks');

  // Assign simulated offsetTop and offsetHeight
  let currentY = 0;
  pElements.forEach((el, idx) => {
    const htmlEl = el as HTMLElement;
    Object.defineProperty(htmlEl, 'offsetTop', { value: currentY, configurable: true });
    Object.defineProperty(htmlEl, 'offsetHeight', { value: 34, configurable: true });
    currentY += 54; // 34px height + 20px margin
  });

  const offsets = editor.getParagraphOffsets();
  assert.strictEqual(offsets.size, 3, 'Must return offsets for all 3 paragraphs');
  assert.strictEqual(offsets.get('p-0')?.yOffset, 0);
  assert.strictEqual(offsets.get('p-1')?.yOffset, 54);
  assert.strictEqual(offsets.get('p-2')?.yOffset, 108);

  // 2. Dynamic reflow: Prepend 2 new paragraphs at the top of the manuscript
  const expandedText = 'Intro A.\n\nIntro B.\n\nFirst paragraph text.\n\nSecond paragraph prose.\n\nThird paragraph concluding thoughts.';
  editor.setContent(expandedText);

  const updatedPElements = canvas.querySelectorAll('.editor-paragraph');
  assert.strictEqual(updatedPElements.length, 5, 'Canvas must now contain 5 paragraphs');

  let updatedY = 0;
  updatedPElements.forEach((el, idx) => {
    const htmlEl = el as HTMLElement;
    Object.defineProperty(htmlEl, 'offsetTop', { value: updatedY, configurable: true });
    Object.defineProperty(htmlEl, 'offsetHeight', { value: 34, configurable: true });
    updatedY += 54;
  });

  const updatedOffsets = editor.getParagraphOffsets();
  assert.strictEqual(updatedOffsets.size, 5);
  assert.strictEqual(updatedOffsets.get('p-0')?.yOffset, 0);
  assert.strictEqual(updatedOffsets.get('p-2')?.yOffset, 108);
  assert.strictEqual(updatedOffsets.get('p-4')?.yOffset, 216);

  editor.destroy();
});

test('Challenger 2 Suite 1.2: Right margin note anchor binding, target resolution and fallback', async () => {
  const harness = setupMarginHarness();
  const { repo, margin, editorOffsets, editorMock } = harness;
  await repo.init();
  await repo.saveDocument({ id: 'doc-anchoring', title: 'Anchor Test', content: 'Sample' });
  await margin.loadDocumentNotes('doc-anchoring');

  editorOffsets.set('p-intro', { yOffset: 120, height: 35, text: 'Intro' });
  editorOffsets.set('p-body', { yOffset: 340, height: 80, text: 'Body' });

  // 1. Explicit anchor target
  const note1 = await margin.createNote('p-intro');
  assert.strictEqual(note1.paragraph_anchor_id, 'p-intro');

  // 2. Active block target when targetAnchorId omitted
  editorMock.activeBlockId = 'p-body';
  const note2 = await margin.createNote();
  assert.strictEqual(note2.paragraph_anchor_id, 'p-body');

  // 3. Fallback to first available paragraph when activeBlockId does not exist
  editorMock.activeBlockId = 'nonexistent-block';
  const note3 = await margin.createNote();
  assert.strictEqual(note3.paragraph_anchor_id, 'p-intro', 'Should fallback to first available paragraph in offsets map');

  // 4. Fallback to 'p-0' when editor offsets map is completely empty
  editorOffsets.clear();
  const note4 = await margin.createNote();
  assert.strictEqual(note4.paragraph_anchor_id, 'p-0', 'Should fallback to p-0 when no paragraphs exist');

  margin.destroy();
});

// ============================================================================
// SUITE 2: 50+ Dense Margin Notes Clustered on Adjacent Paragraphs (Collision Avoidance)
// ============================================================================

test('Challenger 2 Suite 2.1: 60 dense notes across 5 adjacent paragraphs maintain strictly >=16px vertical gap', async () => {
  const harness = setupMarginHarness();
  const { repo, margin, editorOffsets, leaderSvg } = harness;
  await repo.init();
  await repo.saveDocument({ id: 'doc-dense-60', title: 'Dense 60 Notes', content: 'Text' });
  await margin.loadDocumentNotes('doc-dense-60');

  // 5 adjacent paragraphs, each 25px tall, spaced 30px apart (y: 100, 130, 160, 190, 220)
  for (let p = 0; p < 5; p++) {
    editorOffsets.set(`p-${p}`, {
      yOffset: 100 + p * 30,
      height: 25,
      text: `Dense paragraph ${p}`,
    });
  }

  // Clump 12 notes onto EACH of the 5 paragraphs = 60 notes total
  const createdNoteIds: string[] = [];
  for (let p = 0; p < 5; p++) {
    for (let n = 0; n < 12; n++) {
      const note = await margin.createNote(`p-${p}`);
      margin.updateNoteContent(note.id, `Paragraph ${p} thought #${n}`);
      createdNoteIds.push(note.id);
    }
  }

  assert.strictEqual(createdNoteIds.length, 60);
  assert.strictEqual(margin.notes.size, 60);

  // Compute layout offsets
  const topOffsets = margin.calculateNoteTopOffsets();
  assert.strictEqual(topOffsets.size, 60);

  // Sort notes by computed topOffset
  const sortedLayout = Array.from(topOffsets.entries()).sort((a, b) => a[1] - b[1]);

  // INVARIANT 1: Minimum separation between EVERY adjacent pair of notes must be >= 16px
  let minObservedGap = Infinity;
  for (let i = 1; i < sortedLayout.length; i++) {
    const prevNoteId = sortedLayout[i - 1][0];
    const prevTop = sortedLayout[i - 1][1];
    const currTop = sortedLayout[i][1];

    const prevHeight = margin.measuredHeights.get(prevNoteId) ?? margin.defaultNoteHeight;
    const gap = currTop - (prevTop + prevHeight);

    if (gap < minObservedGap) {
      minObservedGap = gap;
    }

    assert.ok(
      gap >= 16,
      `Pair ${i-1}->${i} collision violation: gap is ${gap}px (expected >= 16px). PrevTop: ${prevTop}, currTop: ${currTop}`
    );
  }

  assert.strictEqual(minObservedGap >= 16, true, `Min observed gap across 60 dense notes was ${minObservedGap}px (>=16px)`);

  // INVARIANT 2: No note top is higher than its anchor paragraph baseline
  for (const [noteId, top] of topOffsets.entries()) {
    const note = margin.notes.get(noteId)!;
    const anchor = editorOffsets.get(note.paragraph_anchor_id)!;
    assert.ok(
      top >= anchor.yOffset,
      `Note ${noteId} top (${top}) cannot be higher than anchor baseline (${anchor.yOffset})`
    );
  }

  // Update layout and verify DOM cards & Leader Lines
  margin.updateLayout();

  const svgPaths = leaderSvg.querySelectorAll('path');
  assert.strictEqual(svgPaths.length, 60, 'All 60 notes must have leader line paths');

  for (let i = 0; i < svgPaths.length; i++) {
    const d = svgPaths[i].getAttribute('d');
    assert.ok(d && d.length > 0, 'Path data must not be empty');
    assert.ok(!d.includes('NaN'), `Path must not contain NaN: ${d}`);
    assert.ok(!d.includes('undefined'), `Path must not contain undefined: ${d}`);
  }

  margin.destroy();
});

test('Challenger 2 Suite 2.2: Heterogeneous variable heights (40px to 350px) maintain strictly >=16px gap', async () => {
  const harness = setupMarginHarness();
  const { repo, margin, editorOffsets } = harness;
  await repo.init();
  await repo.saveDocument({ id: 'doc-var-heights', title: 'Variable Heights', content: 'Text' });
  await margin.loadDocumentNotes('doc-var-heights');

  // 10 paragraphs spaced 40px apart
  for (let p = 0; p < 10; p++) {
    editorOffsets.set(`p-${p}`, { yOffset: p * 40, height: 30, text: `Para ${p}` });
  }

  // Create 50 notes across the 10 paragraphs (5 notes per paragraph)
  const simulatedHeights = [40, 65, 80, 115, 150, 200, 250, 320, 95, 140];
  const noteIds: string[] = [];

  for (let i = 0; i < 50; i++) {
    const pId = `p-${i % 10}`;
    const note = await margin.createNote(pId);
    noteIds.push(note.id);

    // Assign varied heights to measuredHeights
    const h = simulatedHeights[i % simulatedHeights.length];
    margin.measuredHeights.set(note.id, h);
  }

  const topOffsets = margin.calculateNoteTopOffsets();
  const sortedLayout = Array.from(topOffsets.entries()).sort((a, b) => a[1] - b[1]);

  for (let i = 1; i < sortedLayout.length; i++) {
    const prevNoteId = sortedLayout[i - 1][0];
    const prevTop = sortedLayout[i - 1][1];
    const currTop = sortedLayout[i][1];

    const prevHeight = margin.measuredHeights.get(prevNoteId)!;
    const gap = currTop - (prevTop + prevHeight);

    assert.ok(
      gap >= 16,
      `Variable height pair ${i-1}->${i} failed: gap ${gap}px < 16px (prevHeight: ${prevHeight}, prevTop: ${prevTop}, currTop: ${currTop})`
    );
  }

  margin.destroy();
});

test('Challenger 2 Suite 2.3: Extreme stress: 100 notes clustered on a single paragraph (p-0)', async () => {
  const harness = setupMarginHarness();
  const { repo, margin, editorOffsets } = harness;
  await repo.init();
  await repo.saveDocument({ id: 'doc-100-single-p', title: '100 Notes on P0', content: 'Text' });
  await margin.loadDocumentNotes('doc-100-single-p');

  editorOffsets.set('p-0', { yOffset: 0, height: 30, text: 'The solitary anchor paragraph.' });

  for (let i = 0; i < 100; i++) {
    await margin.createNote('p-0');
  }

  assert.strictEqual(margin.notes.size, 100);

  const topOffsets = margin.calculateNoteTopOffsets();
  assert.strictEqual(topOffsets.size, 100);

  const sortedTops = Array.from(topOffsets.values()).sort((a, b) => a - b);

  // Invariant: strict step of (80 + 16) = 96px for every note
  for (let i = 0; i < 100; i++) {
    const expectedTop = i * 96;
    assert.strictEqual(
      sortedTops[i],
      expectedTop,
      `Note ${i} on p-0 must be stacked at exactly ${expectedTop}px, got ${sortedTops[i]}`
    );
  }

  margin.destroy();
});

// ============================================================================
// SUITE 3: Paragraph Deletion & Orphan Preservation
// ============================================================================

test('Challenger 2 Suite 3.1: Alternating wholesale paragraph deletion retains orphaned notes with zero data loss', async () => {
  const harness = setupMarginHarness();
  const { repo, margin, editorOffsets, orphanedSection, orphanedList, orphanedCountBadge, leaderSvg } = harness;
  await repo.init();
  await repo.saveDocument({ id: 'doc-orphan-stress', title: 'Orphan Stress', content: 'Text' });
  await margin.loadDocumentNotes('doc-orphan-stress');

  // Create 40 paragraphs and 40 notes
  const totalCount = 40;
  const noteIds: string[] = [];
  for (let i = 0; i < totalCount; i++) {
    editorOffsets.set(`p-${i}`, { yOffset: i * 100, height: 40, text: `Paragraph ${i}` });
    const note = await margin.createNote(`p-${i}`);
    margin.updateNoteContent(note.id, `Critical critique #${i}`);
    noteIds.push(note.id);
  }

  // Allow debounce save
  await new Promise((resolve) => setTimeout(resolve, 30));

  // Initial verification
  margin.updateLayout();
  assert.strictEqual(orphanedSection.style.display, 'none');
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 40);

  // Delete alternating 30 paragraphs: delete all except indices divisible by 4 (0, 4, 8, 12, 16, 20, 24, 28, 32, 36)
  // Surviving = 10, Deleted = 30
  const survivingIds = new Set<string>();
  for (let i = 0; i < totalCount; i++) {
    if (i % 4 === 0) {
      survivingIds.add(`p-${i}`);
    } else {
      editorOffsets.delete(`p-${i}`);
    }
  }
  assert.strictEqual(editorOffsets.size, 10);

  // Trigger layout update
  margin.updateLayout();

  // 1. In-memory and repository zero data loss
  assert.strictEqual(margin.notes.size, 40, 'All 40 notes remain in memory cache');
  const storedNotes = await repo.getNotesForDocument('doc-orphan-stress');
  assert.strictEqual(storedNotes.length, 40, 'All 40 notes remain in SQLite repository');
  for (const stored of storedNotes) {
    assert.strictEqual(stored.deleted_at, null, 'No note was soft-deleted');
  }

  // 2. Orphan UI indications
  assert.strictEqual(orphanedSection.style.display, 'flex');
  assert.strictEqual(orphanedCountBadge.textContent, '30');
  assert.strictEqual(orphanedList.querySelectorAll('.orphaned-note-item').length, 30);

  // 3. Card visual classes
  let orphanedCardCount = 0;
  let activeCardCount = 0;
  for (const noteId of noteIds) {
    const card = margin.cardElements.get(noteId);
    assert.ok(card);
    if (card?.classList.contains('orphaned')) {
      orphanedCardCount++;
      const badge = card.querySelector('.thought-note-anchor-badge');
      assert.ok(badge?.textContent?.includes('(deleted)'));
    } else {
      activeCardCount++;
    }
  }
  assert.strictEqual(orphanedCardCount, 30);
  assert.strictEqual(activeCardCount, 10);

  // 4. Leader Lines: exactly 10 leader lines for surviving notes
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 10);

  margin.destroy();
});

test('Challenger 2 Suite 3.2: Interactive re-anchoring and paragraph resurrection', async () => {
  const harness = setupMarginHarness();
  const { repo, margin, editorOffsets, orphanedSection, orphanedCountBadge, leaderSvg } = harness;
  await repo.init();
  await repo.saveDocument({ id: 'doc-reanchor-resurrect', title: 'Reanchor', content: 'Text' });
  await margin.loadDocumentNotes('doc-reanchor-resurrect');

  editorOffsets.set('p-1', { yOffset: 100, height: 30, text: 'P1' });
  editorOffsets.set('p-2', { yOffset: 300, height: 30, text: 'P2' });

  const noteA = await margin.createNote('p-1');
  const noteB = await margin.createNote('p-2');

  // Delete p-2 -> noteB becomes orphaned
  editorOffsets.delete('p-2');
  margin.updateLayout();
  assert.strictEqual(orphanedCountBadge.textContent, '1');
  assert.strictEqual(margin.cardElements.get(noteB.id)?.classList.contains('orphaned'), true);

  // 1. Re-anchor noteB to surviving p-1
  await margin.reanchorNote(noteB.id, 'p-1');
  // When count is 0, orphanedSection is hidden with display: none
  assert.strictEqual(orphanedSection.style.display, 'none', 'Orphan section must be hidden when count drops to 0');
  // REMEDIATION VERIFIED: updateOrphanedSection(count) resets orphanedCountBadge.textContent to '0' when count === 0
  assert.strictEqual(orphanedCountBadge.textContent, '0', 'Orphaned count badge is reset to "0" when count is 0');
  assert.strictEqual(margin.cardElements.get(noteB.id)?.classList.contains('orphaned'), false);
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 2);

  // 2. Paragraph Resurrection Test:
  // Create noteC on p-ghost (not currently existing)
  const noteC = await margin.createNote('p-ghost');
  margin.updateLayout();
  assert.strictEqual(orphanedSection.style.display, 'flex');
  assert.strictEqual(orphanedCountBadge.textContent, '1');
  assert.strictEqual(margin.cardElements.get(noteC.id)?.classList.contains('orphaned'), true);

  // Now "resurrect" p-ghost by creating it in editorOffsets
  editorOffsets.set('p-ghost', { yOffset: 800, height: 40, text: 'Resurrected Ghost Paragraph' });
  margin.updateLayout();

  // NoteC should automatically bind and lose orphan status
  assert.strictEqual(orphanedSection.style.display, 'none');
  assert.strictEqual(orphanedCountBadge.textContent, '0', 'Orphaned count badge is reset to "0" on resurrection');
  assert.strictEqual(margin.cardElements.get(noteC.id)?.classList.contains('orphaned'), false);
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 3);

  margin.destroy();
});

// ============================================================================
// SUITE 4: High-Speed Synchronized Scrolling (5,000 px/s)
// ============================================================================

test('Challenger 2 Suite 4.1: High-speed 5,000 px/s scroll tracking at 60Hz and 120Hz framerates', async () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  const editorScrollContainer = doc.createElement('div');
  const marginScrollContainer = doc.createElement('div');
  const editorCanvas = doc.createElement('div');
  const marginNotesList = doc.createElement('div');

  Object.defineProperty(editorCanvas, 'scrollHeight', { value: 20000, configurable: true });
  Object.defineProperty(editorCanvas, 'offsetHeight', { value: 20000, configurable: true });

  const engine = new SynchronizedScrollEngine({
    editorScrollContainer: editorScrollContainer as unknown as HTMLElement,
    marginScrollContainer: marginScrollContainer as unknown as HTMLElement,
    editorCanvas: editorCanvas as unknown as HTMLElement,
    marginNotesList: marginNotesList as unknown as HTMLElement,
    deadbandEpsilon: 1.0,
    bidirectional: true,
  });

  // Verification 1: 60Hz velocity (83.33 px/frame across 100 frames = 5,000 px/s)
  const frames60Hz = 100;
  const velocity60Hz = 83.333;

  for (let frame = 0; frame < frames60Hz; frame++) {
    const targetScroll = frame * velocity60Hz;
    (editorScrollContainer as unknown as HTMLElement).scrollTop = targetScroll;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);

    assert.strictEqual(
      (marginScrollContainer as unknown as HTMLElement).scrollTop,
      targetScroll,
      `60Hz Frame ${frame}: margin scrollTop must match editor scrollTop`
    );

    // Drain microtasks
    await Promise.resolve();
  }

  // Verification 2: 120Hz fluid LivePaper framerate (41.67 px/frame across 120 frames = 5,000 px/s)
  const frames120Hz = 120;
  const velocity120Hz = 41.667;

  for (let frame = 0; frame < frames120Hz; frame++) {
    const targetScroll = frame * velocity120Hz;
    (editorScrollContainer as unknown as HTMLElement).scrollTop = targetScroll;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);

    assert.strictEqual(
      (marginScrollContainer as unknown as HTMLElement).scrollTop,
      targetScroll,
      `120Hz Frame ${frame}: margin scrollTop must match editor scrollTop`
    );

    await Promise.resolve();
  }

  // Verification 3: High-speed reversal (flick from 10,000 to 0 in steps of 250px)
  for (let targetScroll = 10000; targetScroll >= 0; targetScroll -= 250) {
    (editorScrollContainer as unknown as HTMLElement).scrollTop = targetScroll;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);

    assert.strictEqual(
      (marginScrollContainer as unknown as HTMLElement).scrollTop,
      targetScroll,
      `Reverse scroll at ${targetScroll}: margin scrollTop must match`
    );

    await Promise.resolve();
  }

  engine.destroy();
});

test('Challenger 2 Suite 4.2: Spatial 1:1 ScreenY Parity Identity across multiple checkpoints', async () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  const editorScrollContainer = doc.createElement('div');
  const marginScrollContainer = doc.createElement('div');

  const engine = new SynchronizedScrollEngine({
    editorScrollContainer: editorScrollContainer as unknown as HTMLElement,
    marginScrollContainer: marginScrollContainer as unknown as HTMLElement,
    deadbandEpsilon: 0.5,
  });

  // Paragraph anchors distributed across a 15,000px document
  const anchors = [
    { id: 'p-1', yOffset: 300 },
    { id: 'p-2', yOffset: 1250 },
    { id: 'p-3', yOffset: 3500 },
    { id: 'p-4', yOffset: 6800 },
    { id: 'p-5', yOffset: 11200 },
    { id: 'p-6', yOffset: 14500 },
  ];

  const checkpoints = [0, 250, 1000, 3200, 6500, 11000, 14000];

  for (const scrollY of checkpoints) {
    (editorScrollContainer as unknown as HTMLElement).scrollTop = scrollY;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);
    await Promise.resolve();

    for (const anchor of anchors) {
      // In uncollided state, note top === anchor yOffset
      const noteTop = anchor.yOffset;
      const screenYEditor = anchor.yOffset - (editorScrollContainer as unknown as HTMLElement).scrollTop;
      const screenYMargin = noteTop - (marginScrollContainer as unknown as HTMLElement).scrollTop;

      assert.strictEqual(
        screenYMargin,
        screenYEditor,
        `Checkpoint ${scrollY} for anchor ${anchor.id}: ScreenY must match exactly (${screenYMargin} === ${screenYEditor})`
      );
    }
  }

  engine.destroy();
});

// ============================================================================
// SUITE 5: Keyboard Shortcuts & Backdrop Dismissal
// ============================================================================

test('Challenger 2 Suite 5.1: DrawerStateManager shortcut state machine and backdrop dismissal', () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const shell = doc.createElement('div');
  const backdrop = doc.createElement('div');
  const target = doc.createElement('div');

  const manager = new DrawerStateManager(shell as unknown as HTMLElement, backdrop as unknown as HTMLElement);
  manager.bindKeyboardShortcuts(target as unknown as HTMLElement);

  // 1. Initial State
  assert.strictEqual(manager.isZeroChrome, true);
  assert.strictEqual(shell.classList.contains('zero-chrome'), true);

  // 2. Cmd+] toggles right drawer
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', metaKey: true }) as unknown as Event);
  assert.strictEqual(manager.rightOpen, true);
  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.isZeroChrome, false);
  assert.strictEqual(shell.classList.contains('right-open'), true);
  assert.strictEqual(shell.classList.contains('zero-chrome'), false);

  // 3. Cmd+] again closes right drawer
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', metaKey: true }) as unknown as Event);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.strictEqual(shell.classList.contains('zero-chrome'), true);

  // 4. Cmd+[ toggles left drawer
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', metaKey: true }) as unknown as Event);
  assert.strictEqual(manager.leftOpen, true);
  assert.strictEqual(manager.isZeroChrome, false);
  assert.strictEqual(shell.classList.contains('left-open'), true);

  // 5. Simultaneous dual open: while left is open, open right with Cmd+]
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', metaKey: true }) as unknown as Event);
  assert.strictEqual(manager.leftOpen, true);
  assert.strictEqual(manager.rightOpen, true);
  assert.strictEqual(shell.classList.contains('left-open'), true);
  assert.strictEqual(shell.classList.contains('right-open'), true);

  // 6. Escape dismisses both simultaneously
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.rightOpen, false);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.strictEqual(shell.classList.contains('zero-chrome'), true);

  // 7. Backdrop Click Dismissal
  manager.openLeft();
  manager.openRight();
  backdrop.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.strictEqual(shell.classList.contains('zero-chrome'), true);

  // 8. Backdrop Touch Dismissal
  manager.openRight();
  backdrop.dispatchEvent(new win.Event('touchstart', { bubbles: true, cancelable: true }) as unknown as Event);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.strictEqual(shell.classList.contains('zero-chrome'), true);

  manager.destroy();
});

test('Challenger 2 Suite 5.2: Keyboard Escape dismissal from focused input/textarea target', () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const shell = doc.createElement('div');
  const backdrop = doc.createElement('div');

  const manager = new DrawerStateManager(shell as unknown as HTMLElement, backdrop as unknown as HTMLElement);
  manager.bindKeyboardShortcuts(win as unknown as HTMLElement);

  const textarea = doc.createElement('textarea');
  doc.body.appendChild(textarea);

  manager.openRight();
  assert.strictEqual(manager.isZeroChrome, false);

  // Dispatch Escape from focused textarea
  textarea.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);

  assert.strictEqual(manager.isZeroChrome, true, 'Escape inside textarea must bubble and dismiss drawers');
  assert.strictEqual(shell.classList.contains('zero-chrome'), true);

  manager.destroy();
});

test('Challenger 2 Suite 2.4: Order-independence stress: RightMarginDrawer and calculateAlignedNoteOffsets both sort correctly', () => {
  // Scenario: Notes inserted in reverse paragraph order (e.g. note for p-5 created before note for p-1)
  const harness = setupMarginHarness();
  const { margin, editorOffsets } = harness;

  editorOffsets.set('p-1', { yOffset: 100, height: 30, text: 'P1' });
  editorOffsets.set('p-2', { yOffset: 300, height: 30, text: 'P2' });
  editorOffsets.set('p-3', { yOffset: 500, height: 30, text: 'P3' });

  // Manually populate margin.notes in REVERSE order: p-3, then p-2, then p-1
  margin.notes.set('n-3', {
    id: 'n-3',
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-3',
    content: 'Note on P3',
    created_at: 1000,
    updated_at: 1000,
    deleted_at: null,
  });
  margin.notes.set('n-2', {
    id: 'n-2',
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-2',
    content: 'Note on P2',
    created_at: 2000,
    updated_at: 2000,
    deleted_at: null,
  });
  margin.notes.set('n-1', {
    id: 'n-1',
    document_id: 'doc-1',
    paragraph_anchor_id: 'p-1',
    content: 'Note on P1',
    created_at: 3000,
    updated_at: 3000,
    deleted_at: null,
  });

  // RightMarginDrawer.calculateNoteTopOffsets() sorts items by baseTop:
  const drawerOffsets = margin.calculateNoteTopOffsets();
  assert.strictEqual(drawerOffsets.get('n-1'), 100, 'RightMarginDrawer correctly positions n-1 at 100 despite reverse insertion');
  assert.strictEqual(drawerOffsets.get('n-2'), 300, 'RightMarginDrawer correctly positions n-2 at 300');
  assert.strictEqual(drawerOffsets.get('n-3'), 500, 'RightMarginDrawer correctly positions n-3 at 500');

  // VERIFY calculateAlignedNoteOffsets() in sync-scroll.ts:
  // When passed notes in reverse order, pre-sorting guarantees identical correct positioning:
  const blocks: ParagraphBlockInfo[] = [
    { id: 'p-1', type: 'paragraph', text: 'P1', yOffset: 100, height: 30 },
    { id: 'p-2', type: 'paragraph', text: 'P2', yOffset: 300, height: 30 },
    { id: 'p-3', type: 'paragraph', text: 'P3', yOffset: 500, height: 30 },
  ];
  const reverseNotes: ThoughtNoteAnchor[] = [
    { id: 'n-3', paragraphAnchorId: 'p-3', content: 'Note on P3', topOffset: 0 },
    { id: 'n-1', paragraphAnchorId: 'p-1', content: 'Note on P1', topOffset: 0 },
  ];

  const rawOffsets = calculateAlignedNoteOffsets(blocks, reverseNotes, 80, 16);
  const n1Top = rawOffsets.get('n-1')!;
  const n3Top = rawOffsets.get('n-3')!;
  assert.strictEqual(n1Top, 100, 'REMEDIATION VERIFIED: calculateAlignedNoteOffsets pre-sorts notes, correctly positioning n-1 at 100');
  assert.strictEqual(n3Top, 500, 'REMEDIATION VERIFIED: calculateAlignedNoteOffsets correctly positions n-3 at 500');

  margin.destroy();
});

test('Challenger 2 Suite 5.3: Rapid concurrent fuzzing across 250 shortcut and gesture combinations', () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const shell = doc.createElement('div');
  const backdrop = doc.createElement('div');
  const target = doc.createElement('div');

  const manager = new DrawerStateManager(shell as unknown as HTMLElement, backdrop as unknown as HTMLElement);
  manager.bindKeyboardShortcuts(target as unknown as HTMLElement);

  const actions = [
    () => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event),
    () => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', metaKey: true }) as unknown as Event),
    () => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', metaKey: true }) as unknown as Event),
    () => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', ctrlKey: true }) as unknown as Event),
    () => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', ctrlKey: true }) as unknown as Event),
    () => backdrop.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event),
    () => backdrop.dispatchEvent(new win.Event('touchstart', { bubbles: true, cancelable: true }) as unknown as Event),
    () => manager.toggleRight(),
    () => manager.toggleLeft(),
    () => manager.openRight(),
    () => manager.openLeft(),
    () => manager.closeRight(),
    () => manager.closeLeft(),
    () => manager.dismissAll(),
  ];

  for (let i = 0; i < 250; i++) {
    const fn = actions[i % actions.length];
    fn();

    // Verify invariants
    const expectedZero = !manager.leftOpen && !manager.rightOpen;
    assert.strictEqual(manager.isZeroChrome, expectedZero, `Iter ${i}: isZeroChrome`);
    assert.strictEqual(shell.classList.contains('zero-chrome'), expectedZero, `Iter ${i}: .zero-chrome`);
    assert.strictEqual(shell.classList.contains('left-open'), manager.leftOpen, `Iter ${i}: .left-open`);
    assert.strictEqual(shell.classList.contains('right-open'), manager.rightOpen, `Iter ${i}: .right-open`);
  }

  manager.destroy();
});
