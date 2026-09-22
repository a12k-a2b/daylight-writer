/**
 * tests/adversarial/drawer-right-stress.test.ts
 * Milestone 3 Adversarial Stress Test Suite
 * Empirical Challenger Verification for Daylight Writer Right Thought Margin,
 * Collision Stacking, Leader Lines, Orphaned Note Retention & 1:1 Scroll Sync.
 *
 * Covers:
 * 1. Dense Paragraph Collision & Note Stacking (50+ Notes, Multi-Note Clumping, >=16px Separation, Leader Lines)
 * 2. Wholesale Paragraph Deletions & Orphaned Note Retention (Zero Data Loss, #orphaned-notes-section, Re-anchoring)
 * 3. High-Velocity Momentum Scroll Synchronization (5000px/s, Zero Desync, 1:1 ScreenY Parity, Deadband Stability)
 * 4. Zero-Chrome Dismissal Concurrency & Fuzzing (500 Rapid-Fire Interleaved Events, Esc, Cmd+[, Cmd+], Backdrop)
 * 5. Boundary Conditions & Degenerate Margin States (Empty Docs, Massive Notes, Lifecycle Cleanup)
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
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';

// ----------------------------------------------------------------------------
// Test Fixture Helpers
// ----------------------------------------------------------------------------

interface RightMarginFixture {
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
  editor: {
    activeBlockId: string;
    typewriterMidpoint: number;
    getParagraphOffsets: () => Map<string, { yOffset: number; height: number; text: string }>;
  };
  offsets: Map<string, { yOffset: number; height: number; text: string }>;
  margin: RightMarginDrawer;
}

function createRightMarginFixture(): RightMarginFixture {
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
  const offsets = new Map<string, { yOffset: number; height: number; text: string }>();
  const editor = {
    activeBlockId: 'p-0',
    typewriterMidpoint: 592,
    getParagraphOffsets: () => offsets,
  };

  const margin = new RightMarginDrawer({
    repository: repo,
    editor,
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
    editor,
    offsets,
    margin,
  };
}

// ----------------------------------------------------------------------------
// Test 1: Dense Paragraph Collision & Note Stacking (50+ Notes)
// ----------------------------------------------------------------------------
test('Adversarial Stress 1: Dense Paragraph Collision & Note Stacking (70 Notes, >=16px Separation, Leader Lines)', async () => {
  const { repo, margin, offsets, leaderSvg } = createRightMarginFixture();
  await repo.init();
  await repo.saveDocument({ id: 'doc-stress-stack', title: 'Dense Stacking Manuscript', content: 'Dense manuscript' });
  await margin.loadDocumentNotes('doc-stress-stack');

  // Setup 60 tightly spaced paragraphs:
  // Each paragraph is 25px tall, spaced 30px apart (yOffsets: 0, 30, 60, ... 1770)
  // Since each note requires 80px + 16px = 96px, collision stacking is heavily triggered.
  const paragraphCount = 60;
  for (let i = 0; i < paragraphCount; i++) {
    offsets.set(`p-${i}`, {
      yOffset: i * 30,
      height: 25,
      text: `Paragraph ${i} prose content.`,
    });
  }

  // Create 60 notes: one per paragraph
  const createdNotes: string[] = [];
  for (let i = 0; i < paragraphCount; i++) {
    const note = await margin.createNote(`p-${i}`);
    margin.updateNoteContent(note.id, `Thought comment on paragraph ${i}`);
    createdNotes.push(note.id);
  }

  // Add 10 additional notes clumped on the same paragraph ('p-15', yOffset = 450)
  // to stress multi-note collision on identical anchor block
  for (let j = 0; j < 10; j++) {
    const extraNote = await margin.createNote('p-15');
    margin.updateNoteContent(extraNote.id, `Multi-thought clumping #${j} on p-15`);
    createdNotes.push(extraNote.id);
  }

  assert.strictEqual(margin.notes.size, 70, 'Total 70 notes created');

  // Calculate top offsets
  const topOffsets = margin.calculateNoteTopOffsets();
  assert.strictEqual(topOffsets.size, 70, 'All 70 notes must have calculated top offsets');

  // Sort notes by their computed topOffset
  const layoutOrder = Array.from(topOffsets.entries()).sort((a, b) => a[1] - b[1]);

  // Assert Invariant 1: Monotonic downward stacking with strictly >= 16px separation
  for (let i = 1; i < layoutOrder.length; i++) {
    const prevNoteId = layoutOrder[i - 1][0];
    const prevTop = layoutOrder[i - 1][1];
    const currTop = layoutOrder[i][1];

    const prevHeight = margin.measuredHeights.get(prevNoteId) ?? margin.defaultNoteHeight;
    const requiredMinTop = prevTop + prevHeight + 16;

    assert.ok(
      currTop >= requiredMinTop,
      `Note ${i} (top: ${currTop}) must be >= requiredMinTop: ${requiredMinTop} (gap >= 16px)`
    );
  }

  // Assert Invariant 2: No note is ever positioned above its anchor paragraph baseline
  for (const [noteId, top] of topOffsets.entries()) {
    const note = margin.notes.get(noteId)!;
    const anchor = offsets.get(note.paragraph_anchor_id)!;
    assert.ok(
      top >= anchor.yOffset,
      `Note ${noteId} top (${top}) cannot be higher than anchor yOffset (${anchor.yOffset})`
    );
  }

  // Update layout and assert DOM rendering & Leader Lines
  margin.updateLayout();

  // SVG Leader Lines Assertions
  const svgPaths = leaderSvg.querySelectorAll('path');
  assert.strictEqual(svgPaths.length, 70, 'All 70 active notes must render an SVG leader line');

  for (let i = 0; i < svgPaths.length; i++) {
    const path = svgPaths[i];
    const stroke = path.getAttribute('stroke');
    const strokeWidth = path.getAttribute('stroke-width');
    const d = path.getAttribute('d');

    assert.strictEqual(stroke, 'var(--os-200, #CCCCCC)', 'Leader line must use Sol:OS --os-200 token');
    assert.strictEqual(strokeWidth, '1', 'Leader line must be 1px hairline');
    assert.ok(d && d.length > 0, 'Path data must not be empty');
    assert.ok(!d.includes('NaN'), `Path data must not contain NaN: ${d}`);
    assert.ok(!d.includes('undefined'), `Path data must not contain undefined: ${d}`);

    // If straight line: "M 0 Y1 L 16 Y2"
    // If stepped line: "M 0 Y1 H 8 V Y2 H 16"
    assert.ok(d.startsWith('M 0 '), `Path must originate from left margin (X=0): ${d}`);
    assert.ok(d.endsWith('H 16') || d.endsWith('16'), `Path must terminate at card border: ${d}`);
  }

  // Also stress-test the algorithmic pure function calculateDetailedNoteLayouts with 70 notes
  const pureBlocks: ParagraphBlockInfo[] = Array.from(offsets.entries()).map(([id, info]) => ({
    id,
    type: 'paragraph' as const,
    text: info.text,
    yOffset: info.yOffset,
    height: info.height,
  }));

  const pureNotes: ThoughtNoteAnchor[] = createdNotes.map((id) => ({
    id,
    paragraphAnchorId: margin.notes.get(id)!.paragraph_anchor_id,
    content: margin.notes.get(id)!.content,
    topOffset: 0,
  }));

  const detailedLayouts = calculateDetailedNoteLayouts(pureBlocks, pureNotes, 80, 16);
  assert.strictEqual(detailedLayouts.length, 70);

  for (let i = 1; i < detailedLayouts.length; i++) {
    const prev = detailedLayouts[i - 1];
    const curr = detailedLayouts[i];
    assert.ok(
      curr.topOffset >= prev.topOffset + 80 + 16,
      `Pure layout note ${i} topOffset ${curr.topOffset} must be >= ${prev.topOffset + 96}`
    );
  }

  margin.destroy();
});

// ----------------------------------------------------------------------------
// Test 2: Wholesale Paragraph Deletions & Orphaned Note Retention
// ----------------------------------------------------------------------------
test('Adversarial Stress 2: Wholesale Paragraph Deletion (90% & 100% Deletion, Zero Data Loss, Re-anchoring)', async () => {
  const { repo, margin, offsets, orphanedSection, orphanedList, orphanedCountBadge, leaderSvg, editor } = createRightMarginFixture();
  await repo.init();
  await repo.saveDocument({ id: 'doc-wholesale-del', title: 'Manuscript with Mass Deletions', content: 'Manuscript content' });
  await margin.loadDocumentNotes('doc-wholesale-del');

  // Create 50 paragraphs with 50 notes
  const totalNotes = 50;
  const noteIds: string[] = [];
  for (let i = 0; i < totalNotes; i++) {
    offsets.set(`p-${i}`, {
      yOffset: i * 80,
      height: 40,
      text: `Paragraph ${i} text`,
    });
    const note = await margin.createNote(`p-${i}`);
    margin.updateNoteContent(note.id, `Irreplaceable critique for paragraph ${i}`);
    noteIds.push(note.id);
  }

  // Await debounce save timers (debounceSaveMs = 10ms) so repo has updated contents
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Initial layout verification: 50 notes, 0 orphans
  margin.updateLayout();
  assert.strictEqual(orphanedSection.style.display, 'none');
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 50);

  // --------------------------------------------------------------------------
  // Step A: Wholesale deletion of 90% of manuscript paragraphs (45 out of 50 deleted)
  // Only 5 paragraphs survive: p-0, p-10, p-20, p-30, p-40
  // --------------------------------------------------------------------------
  const survivingIds = new Set(['p-0', 'p-10', 'p-20', 'p-30', 'p-40']);
  for (let i = 0; i < totalNotes; i++) {
    const pId = `p-${i}`;
    if (!survivingIds.has(pId)) {
      offsets.delete(pId);
    }
  }
  assert.strictEqual(offsets.size, 5, 'Exactly 5 paragraphs survive in editor');

  // Trigger layout recalculation
  margin.updateLayout();

  // 1. Zero Data Loss in Storage Repository
  const storedNotes = await repo.getNotesForDocument('doc-wholesale-del');
  assert.strictEqual(storedNotes.length, 50, 'Zero data loss: all 50 notes must remain in repository');
  for (const stored of storedNotes) {
    assert.strictEqual(stored.deleted_at, null, 'Deleted paragraph must NEVER soft-delete or erase note');
    assert.ok(stored.content.startsWith('Irreplaceable critique'), 'Note content must remain completely intact');
  }

  // 2. Orphaned Notes Section UI State
  assert.strictEqual(orphanedSection.style.display, 'flex', '#orphaned-notes-section must be visible');
  assert.strictEqual(orphanedCountBadge.textContent, '45', 'Badge must accurately count 45 orphaned notes');

  const orphanedItems = orphanedList.querySelectorAll('.orphaned-note-item');
  assert.strictEqual(orphanedItems.length, 45, 'Orphaned list must contain 45 recovery items');

  // 3. Card Styling and Badging
  let orphanedCardsCount = 0;
  let activeCardsCount = 0;

  for (const noteId of noteIds) {
    const card = margin.cardElements.get(noteId);
    assert.ok(card, `Card for note ${noteId} must exist in DOM`);
    const badge = card?.querySelector('.thought-note-anchor-badge');

    if (card?.classList.contains('orphaned')) {
      orphanedCardsCount++;
      assert.ok(badge?.classList.contains('orphaned-label'), 'Orphaned card badge must have .orphaned-label');
      assert.ok(badge?.textContent?.includes('(deleted)'), `Badge must indicate paragraph was deleted: ${badge?.textContent}`);
    } else {
      activeCardsCount++;
      assert.ok(!badge?.classList.contains('orphaned-label'));
      assert.ok(!badge?.textContent?.includes('(deleted)'));
    }
  }

  assert.strictEqual(orphanedCardsCount, 45, 'Exactly 45 cards must have .orphaned class');
  assert.strictEqual(activeCardsCount, 5, 'Exactly 5 cards must have active styling');

  // 4. Leader Lines: Only active notes render leader lines; orphans do not draw into empty void
  const activeLeaderPaths = leaderSvg.querySelectorAll('path');
  assert.strictEqual(activeLeaderPaths.length, 5, 'Leader lines rendered only for the 5 surviving notes');

  // --------------------------------------------------------------------------
  // Step B: Re-anchoring Orphaned Notes
  // --------------------------------------------------------------------------
  // Re-anchor 5 notes via direct API
  const orphansToReanchor = noteIds.filter((id) => !survivingIds.has(margin.notes.get(id)!.paragraph_anchor_id)).slice(0, 5);
  for (const orphanId of orphansToReanchor) {
    await margin.reanchorNote(orphanId, 'p-0');
    assert.strictEqual(margin.notes.get(orphanId)!.paragraph_anchor_id, 'p-0');
  }

  // Re-anchor 5 notes via DOM button simulation (.orphaned-reanchor-btn)
  editor.activeBlockId = 'p-10';
  const reanchorButtons = orphanedList.querySelectorAll('.orphaned-reanchor-btn');
  for (let i = 0; i < 5; i++) {
    (reanchorButtons[i] as HTMLButtonElement).click();
  }

  margin.updateLayout();

  // 10 notes were re-anchored: 45 - 10 = 35 orphans remaining
  assert.strictEqual(orphanedCountBadge.textContent, '35', 'Orphan count must decrement to 35');
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 15, '15 active notes now render leader lines (5 + 10)');

  // --------------------------------------------------------------------------
  // Step C: Nuclear 100% Deletion (Empty Document)
  // --------------------------------------------------------------------------
  offsets.clear(); // 0 paragraphs survive
  margin.updateLayout();

  assert.strictEqual(orphanedCountBadge.textContent, '50', 'All 50 notes now marked as orphaned');
  assert.strictEqual(leaderSvg.querySelectorAll('path').length, 0, 'Zero leader lines drawn when 0 paragraphs exist');

  const finalStored = await repo.getNotesForDocument('doc-wholesale-del');
  assert.strictEqual(finalStored.length, 50, 'Absolute zero data loss even on total document clearing');

  margin.destroy();
});

// ----------------------------------------------------------------------------
// Test 3: High-Velocity Momentum Scroll Synchronization (5000px/s)
// ----------------------------------------------------------------------------
test('Adversarial Stress 3: High-Velocity Momentum Scroll Sync (5000px/s, Zero Desync, 1:1 ScreenY Parity)', async () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  const editorScrollContainer = doc.createElement('div');
  const marginScrollContainer = doc.createElement('div');
  const editorCanvas = doc.createElement('div');
  const marginNotesList = doc.createElement('div');

  // 12000px long document
  Object.defineProperty(editorCanvas, 'scrollHeight', { value: 12000, configurable: true });
  Object.defineProperty(editorCanvas, 'offsetHeight', { value: 12000, configurable: true });

  const syncLog: Array<{ scrollTop: number; source: string }> = [];
  const engine = new SynchronizedScrollEngine({
    editorScrollContainer: editorScrollContainer as unknown as HTMLElement,
    marginScrollContainer: marginScrollContainer as unknown as HTMLElement,
    editorCanvas: editorCanvas as unknown as HTMLElement,
    marginNotesList: marginNotesList as unknown as HTMLElement,
    deadbandEpsilon: 1.0,
    bidirectional: true,
    onScrollSync: (scrollTop, source) => {
      syncLog.push({ scrollTop, source });
    },
  });

  // Verify padding & height setup
  assert.strictEqual(marginScrollContainer.style.paddingTop, 'calc(592px - 1.5em)');
  assert.strictEqual(marginScrollContainer.style.paddingBottom, '592px');
  assert.strictEqual(marginNotesList.style.minHeight, '12000px');

  // High Velocity Momentum Scroll Stress:
  // 5000 px/sec at 60fps = ~83.33 px/frame across 100 frames
  const frameCount = 100;
  const velocityPxPerFrame = 83.333;

  for (let frame = 0; frame < frameCount; frame++) {
    const targetScrollTop = frame * velocityPxPerFrame;
    (editorScrollContainer as unknown as HTMLElement).scrollTop = targetScrollTop;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);

    assert.strictEqual(
      (marginScrollContainer as unknown as HTMLElement).scrollTop,
      targetScrollTop,
      `Frame ${frame}: Margin scrollTop must immediately match editor scrollTop`
    );

    // Drain microtasks to reset isSyncing
    await Promise.resolve();
  }

  // Sudden Directional Reversal (Flick Backwards from 8333 to 0)
  for (let frame = frameCount - 1; frame >= 0; frame--) {
    const targetScrollTop = frame * velocityPxPerFrame;
    (editorScrollContainer as unknown as HTMLElement).scrollTop = targetScrollTop;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);

    assert.strictEqual(
      (marginScrollContainer as unknown as HTMLElement).scrollTop,
      targetScrollTop,
      `Reverse frame ${frame}: Margin scrollTop must track deceleration without drift`
    );

    await Promise.resolve();
  }

  // 1:1 ScreenY Alignment Identity Verification
  // When note is anchored to paragraph P, screenY(note) === screenY(paragraph)
  const paragraphs = [
    { id: 'p-100', yOffset: 500 },
    { id: 'p-200', yOffset: 1800 },
    { id: 'p-300', yOffset: 4200 },
    { id: 'p-400', yOffset: 7500 },
    { id: 'p-500', yOffset: 10500 },
  ];

  const scrollCheckpoints = [0, 400, 1200, 3500, 6000, 9500];

  for (const checkpoint of scrollCheckpoints) {
    (editorScrollContainer as unknown as HTMLElement).scrollTop = checkpoint;
    editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);
    await Promise.resolve();

    for (const p of paragraphs) {
      // In 1:1 aligned uncollided state, note topOffset === paragraph yOffset
      const noteTop = p.yOffset;
      const screenYParagraph = p.yOffset - (editorScrollContainer as unknown as HTMLElement).scrollTop;
      const screenYNote = noteTop - (marginScrollContainer as unknown as HTMLElement).scrollTop;

      assert.strictEqual(
        screenYNote,
        screenYParagraph,
        `At scrollTop ${checkpoint}: screenY(note) [${screenYNote}] must strictly equal screenY(paragraph) [${screenYParagraph}]`
      );
    }
  }

  // Bidirectional Synchronization Stress: Scroll from Margin side
  for (let step = 0; step < 50; step++) {
    const marginTarget = step * 120;
    (marginScrollContainer as unknown as HTMLElement).scrollTop = marginTarget;
    marginScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);

    assert.strictEqual(
      (editorScrollContainer as unknown as HTMLElement).scrollTop,
      marginTarget,
      `Margin->Editor Step ${step}: Editor must mirror margin scroll`
    );
    await Promise.resolve();
  }

  // Reentrancy and Micro-Jitter Deadband Test
  // 1. Micro-jitter delta < 1.0px should NOT trigger re-sync
  const baseScroll = (editorScrollContainer as unknown as HTMLElement).scrollTop;
  engine.syncFromEditor(baseScroll + 0.4);
  assert.strictEqual(
    (marginScrollContainer as unknown as HTMLElement).scrollTop,
    baseScroll,
    'Delta of 0.4px is within 1.0px deadband epsilon: must not re-sync'
  );

  // 2. Rapid alternating scroll events must never trigger infinite loops or recursion crashes
  for (let i = 0; i < 200; i++) {
    if (i % 2 === 0) {
      (editorScrollContainer as unknown as HTMLElement).scrollTop = 2000 + i * 5;
      editorScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);
    } else {
      (marginScrollContainer as unknown as HTMLElement).scrollTop = 2000 + i * 5;
      marginScrollContainer.dispatchEvent(new win.Event('scroll') as unknown as Event);
    }
  }
  // If we reach here without Maximum call stack size exceeded, reentrancy lock held firmly!
  assert.ok(true, 'Rapid alternating scroll reentrancy resolved cleanly');

  engine.destroy();
});

// ----------------------------------------------------------------------------
// Test 4: Zero-Chrome Dismissal Concurrency & Fuzzing State Machine
// ----------------------------------------------------------------------------
test('Adversarial Stress 4: Zero-Chrome Dismissal Concurrency & 500-Action Fuzzing', () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const shell = doc.createElement('div');
  const backdrop = doc.createElement('div');
  const target = doc.createElement('div');

  const manager = new DrawerStateManager(shell as unknown as HTMLElement, backdrop as unknown as HTMLElement);
  manager.bindKeyboardShortcuts(target as unknown as HTMLElement);

  // Verify Initial Invariant
  assert.strictEqual(manager.isZeroChrome, true);
  assert.ok(shell.classList.contains('zero-chrome'));
  assert.ok(!shell.classList.contains('left-open'));
  assert.ok(!shell.classList.contains('right-open'));

  // 500 Rapid-Fire Interleaved Events
  const totalIterations = 500;
  for (let iter = 0; iter < totalIterations; iter++) {
    const action = iter % 14;

    switch (action) {
      case 0:
        // Keydown Escape
        target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
        break;
      case 1:
        // Keydown Cmd+[ (toggle left)
        target.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', metaKey: true }) as unknown as Event);
        break;
      case 2:
        // Keydown Cmd+] (toggle right)
        target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', metaKey: true }) as unknown as Event);
        break;
      case 3:
        // Keydown Ctrl+[
        target.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', ctrlKey: true }) as unknown as Event);
        break;
      case 4:
        // Keydown Ctrl+]
        target.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', ctrlKey: true }) as unknown as Event);
        break;
      case 5:
        // Backdrop Click
        backdrop.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
        break;
      case 6:
        // Backdrop Touchstart
        backdrop.dispatchEvent(new win.Event('touchstart', { bubbles: true, cancelable: true }) as unknown as Event);
        break;
      case 7:
        manager.toggleLeft();
        break;
      case 8:
        manager.toggleRight();
        break;
      case 9:
        manager.openLeft();
        break;
      case 10:
        manager.openRight();
        break;
      case 11:
        manager.closeLeft();
        break;
      case 12:
        manager.closeRight();
        break;
      case 13:
        manager.dismissAll();
        break;
    }

    // Invariant Checks after EVERY single action
    const isZeroExpected = !manager.leftOpen && !manager.rightOpen;
    assert.strictEqual(
      manager.isZeroChrome,
      isZeroExpected,
      `Iter ${iter}: isZeroChrome must equal (!leftOpen && !rightOpen)`
    );

    assert.strictEqual(
      shell.classList.contains('zero-chrome'),
      isZeroExpected,
      `Iter ${iter}: shell zero-chrome class must match state`
    );

    assert.strictEqual(
      shell.classList.contains('left-open'),
      manager.leftOpen,
      `Iter ${iter}: shell left-open class must match state`
    );

    assert.strictEqual(
      shell.classList.contains('right-open'),
      manager.rightOpen,
      `Iter ${iter}: shell right-open class must match state`
    );

    // Mutual exclusivity assertion: zero-chrome NEVER coexists with open drawers
    if (manager.leftOpen || manager.rightOpen) {
      assert.ok(!shell.classList.contains('zero-chrome'), `Iter ${iter}: zero-chrome must not be present when open`);
    } else {
      assert.ok(shell.classList.contains('zero-chrome'), `Iter ${iter}: zero-chrome must be present when closed`);
    }
  }

  // Explicit Scenario: Simultaneous Dual Open -> Escape
  manager.openLeft();
  manager.openRight();
  assert.strictEqual(manager.isZeroChrome, false);
  assert.ok(shell.classList.contains('left-open'));
  assert.ok(shell.classList.contains('right-open'));

  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
  assert.strictEqual(manager.isZeroChrome, true);
  assert.strictEqual(manager.leftOpen, false);
  assert.strictEqual(manager.rightOpen, false);
  assert.ok(shell.classList.contains('zero-chrome'));

  // Explicit Scenario: Simultaneous Dual Open -> Backdrop Touch
  manager.openLeft();
  manager.openRight();
  backdrop.dispatchEvent(new win.Event('touchstart', { bubbles: true, cancelable: true }) as unknown as Event);
  assert.strictEqual(manager.isZeroChrome, true);

  // Burst of 25 Escape keys in zero-chrome state
  for (let k = 0; k < 25; k++) {
    target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    assert.strictEqual(manager.isZeroChrome, true);
  }

  manager.destroy();
});

// ----------------------------------------------------------------------------
// Test 5: Boundary Conditions & Degenerate Margin States
// ----------------------------------------------------------------------------
test('Adversarial Stress 5: Boundary Conditions, Variable Heights & Lifecycle Cleanup', async () => {
  const { repo, margin, offsets } = createRightMarginFixture();
  await repo.init();
  await repo.saveDocument({ id: 'doc-bounds', title: 'Bounds Test', content: 'Text' });
  await margin.loadDocumentNotes('doc-bounds');

  // 1. Empty Document & Empty Notes: zero-throw guarantee
  offsets.clear();
  margin.notes.clear();
  const emptyOffsets = margin.calculateNoteTopOffsets();
  assert.strictEqual(emptyOffsets.size, 0);
  assert.doesNotThrow(() => margin.updateLayout(), 'Empty margin layout must not throw');

  // 2. Note with massive height (500px tall)
  offsets.set('p-huge', { yOffset: 100, height: 40, text: 'Huge note anchor' });
  offsets.set('p-next', { yOffset: 150, height: 40, text: 'Next paragraph' });

  const note1 = await margin.createNote('p-huge');
  const note2 = await margin.createNote('p-next');

  // Override measured height of note1 to 500px
  margin.measuredHeights.set(note1.id, 500);

  const topOffsets = margin.calculateNoteTopOffsets();
  const top1 = topOffsets.get(note1.id)!;
  const top2 = topOffsets.get(note2.id)!;

  assert.strictEqual(top1, 100);
  // note2 must be pushed below note1: 100 + 500 + 16 = 616
  assert.strictEqual(top2, 616, `Note 2 must be pushed below 500px tall Note 1: expected 616, got ${top2}`);

  // 3. Extreme note content (5,000 characters)
  const hugeContent = 'A'.repeat(5000);
  margin.updateNoteContent(note1.id, hugeContent);
  assert.strictEqual(margin.notes.get(note1.id)!.content.length, 5000);

  // 4. Lifecycle Destroy cleanup
  assert.doesNotThrow(() => margin.destroy(), 'Destroy must execute cleanly without lingering timers or memory leaks');
});
