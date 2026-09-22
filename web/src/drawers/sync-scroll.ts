/**
 * src/drawers/sync-scroll.ts
 * Daylight Writer - 1:1 Synchronous Spatial Scroll Tracking & Zero-Chrome Dismissal Engine
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display (1584×1184 landscape)
 * Native 60Hz-120Hz Fluid Refresh | Sol:OS 8-bit Grayscale Tokens (--os-0 to --os-1000)
 * Features: F14 (Zero-Chrome Dismissal), F19 (Synchronous Spatial Scroll Tracking), F22 (Keyboard Shortcuts)
 */

export interface ParagraphBlockInfo {
  id: string;
  type: 'paragraph' | 'heading' | 'list_item';
  level?: number;
  text: string;
  yOffset: number;
  height: number;
}

export interface ThoughtNoteAnchor {
  id: string;
  paragraphAnchorId: string;
  content: string;
  topOffset: number;
  created_at?: number;
}

export interface AlignedNoteLayout {
  noteId: string;
  anchorParagraphId: string;
  topOffset: number;
  isOrphaned: boolean;
  hasCollisionOffset: boolean;
  leaderLineTargetY?: number;
}

export interface ScrollSyncOptions {
  editorScrollContainer?: HTMLElement | null;
  marginScrollContainer?: HTMLElement | null;
  editorCanvas?: HTMLElement | null;
  marginNotesList?: HTMLElement | null;
  deadbandEpsilon?: number; // default: 1.0px
  bidirectional?: boolean;  // default: true
  onScrollSync?: (scrollTop: number, source: 'editor' | 'margin') => void;
}

export interface DrawerState {
  leftOpen: boolean;
  rightOpen: boolean;
  isZeroChrome: boolean;
}

export type DrawerStateListener = (state: DrawerState) => void;

/**
 * 1. SynchronizedScrollEngine (F19)
 * Coordinates 1:1 vertical scroll position between editor and thought margin scratchpad.
 * Incorporates reentrancy locking with a deadband epsilon to eliminate event oscillations.
 */
export class SynchronizedScrollEngine {
  public editorContainer: HTMLElement | null = null;
  public marginContainer: HTMLElement | null = null;
  public editorCanvas: HTMLElement | null = null;
  public marginNotesList: HTMLElement | null = null;

  public isSyncing: boolean = false;
  public deadbandEpsilon: number = 1.0;
  public bidirectional: boolean = true;
  public onScrollSync?: (scrollTop: number, source: 'editor' | 'margin') => void;

  private cleanupListeners: Array<() => void> = [];

  constructor(options: ScrollSyncOptions = {}) {
    this.deadbandEpsilon = options.deadbandEpsilon ?? 1.0;
    this.bidirectional = options.bidirectional ?? true;
    this.onScrollSync = options.onScrollSync;

    if (options.editorScrollContainer && options.marginScrollContainer) {
      this.bind(
        options.editorScrollContainer,
        options.marginScrollContainer,
        options.editorCanvas || null,
        options.marginNotesList || null
      );
    }
  }

  public bind(
    editorContainer: HTMLElement,
    marginContainer: HTMLElement,
    editorCanvas: HTMLElement | null = null,
    marginNotesList: HTMLElement | null = null
  ): void {
    this.destroy();

    this.editorContainer = editorContainer;
    this.marginContainer = marginContainer;
    this.editorCanvas = editorCanvas;
    this.marginNotesList = marginNotesList;

    this.applyMatchingPadding();
    this.updateContentHeights();

    // Editor scroll event listener
    const onEditorScroll = () => {
      if (!this.editorContainer || this.isSyncing) return;
      this.syncFromEditor(this.editorContainer.scrollTop);
    };
    this.editorContainer.addEventListener('scroll', onEditorScroll, { passive: true });
    this.cleanupListeners.push(() => {
      this.editorContainer?.removeEventListener('scroll', onEditorScroll);
    });

    // Margin scroll event listener (if bi-directional)
    if (this.bidirectional && this.marginContainer) {
      const onMarginScroll = () => {
        if (!this.marginContainer || this.isSyncing) return;
        this.syncFromMargin(this.marginContainer.scrollTop);
      };
      this.marginContainer.addEventListener('scroll', onMarginScroll, { passive: true });
      this.cleanupListeners.push(() => {
        this.marginContainer?.removeEventListener('scroll', onMarginScroll);
      });
    }
  }

  /**
   * Synchronize matching top and bottom typewriter padding to margin container
   */
  public applyMatchingPadding(midpointPx: number = 592): void {
    if (!this.marginContainer) return;
    this.marginContainer.style.paddingTop = `calc(${midpointPx}px - 1.5em)`;
    this.marginContainer.style.paddingBottom = `${midpointPx}px`;
  }

  /**
   * Keep minHeight of marginNotesList matched to canvas scrollHeight to prevent scroll clamping
   */
  public updateContentHeights(): void {
    if (!this.editorCanvas || !this.marginNotesList) return;
    const canvasHeight = Math.max(
      this.editorCanvas.scrollHeight,
      this.editorCanvas.offsetHeight
    );
    this.marginNotesList.style.minHeight = `${canvasHeight}px`;
  }

  /**
   * Sync editor -> margin container
   */
  public syncFromEditor(scrollTop: number): void {
    if (!this.marginContainer) return;
    const delta = Math.abs(this.marginContainer.scrollTop - scrollTop);
    if (delta < this.deadbandEpsilon) return;

    this.isSyncing = true;
    this.marginContainer.scrollTop = scrollTop;
    if (this.onScrollSync) {
      this.onScrollSync(scrollTop, 'editor');
    }

    if (typeof queueMicrotask !== 'undefined') {
      queueMicrotask(() => {
        this.isSyncing = false;
      });
    } else {
      setTimeout(() => {
        this.isSyncing = false;
      }, 0);
    }
  }

  /**
   * Sync margin -> editor container
   */
  public syncFromMargin(scrollTop: number): void {
    if (!this.editorContainer) return;
    const delta = Math.abs(this.editorContainer.scrollTop - scrollTop);
    if (delta < this.deadbandEpsilon) return;

    this.isSyncing = true;
    this.editorContainer.scrollTop = scrollTop;
    if (this.onScrollSync) {
      this.onScrollSync(scrollTop, 'margin');
    }

    if (typeof queueMicrotask !== 'undefined') {
      queueMicrotask(() => {
        this.isSyncing = false;
      });
    } else {
      setTimeout(() => {
        this.isSyncing = false;
      }, 0);
    }
  }

  public destroy(): void {
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
    this.editorContainer = null;
    this.marginContainer = null;
    this.editorCanvas = null;
    this.marginNotesList = null;
  }
}

/**
 * 2. DrawerStateManager (F14, F22)
 * Manages Left Drawer and Right Drawer visibility, keyboard shortcuts, and zero-chrome mode.
 * Supports simultaneous dual-drawer open on 1584x1184 landscape viewport.
 */
export class DrawerStateManager {
  public leftOpen: boolean = false;
  public rightOpen: boolean = false;
  public shellElement: HTMLElement | null = null;
  public backdropElement: HTMLElement | null = null;

  private listeners: Set<DrawerStateListener> = new Set();
  private cleanupListeners: Array<() => void> = [];

  constructor(shellEl?: HTMLElement | null, backdropEl?: HTMLElement | null) {
    if (shellEl) {
      this.bindDOM(shellEl, backdropEl || null);
    }
  }

  public get isZeroChrome(): boolean {
    return !this.leftOpen && !this.rightOpen;
  }

  public get state(): DrawerState {
    return {
      leftOpen: this.leftOpen,
      rightOpen: this.rightOpen,
      isZeroChrome: this.isZeroChrome,
    };
  }

  public bindDOM(shellEl: HTMLElement, backdropEl: HTMLElement | null = null): void {
    this.shellElement = shellEl;
    this.backdropElement = backdropEl;

    // Bind backdrop click / touch
    if (this.backdropElement) {
      const onBackdropClick = (e: Event) => {
        e.preventDefault();
        this.dismissAll();
      };
      this.backdropElement.addEventListener('click', onBackdropClick);
      this.backdropElement.addEventListener('touchstart', onBackdropClick, { passive: false });
      this.cleanupListeners.push(() => {
        this.backdropElement?.removeEventListener('click', onBackdropClick);
        this.backdropElement?.removeEventListener('touchstart', onBackdropClick);
      });
    }

    this.syncDOM();
  }

  public bindKeyboardShortcuts(target: Window | HTMLElement = (typeof window !== 'undefined' ? window : ({} as any))): void {
    if (!target || typeof target.addEventListener !== 'function') return;

    const onKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      const isMeta = ke.metaKey || ke.ctrlKey;

      if (ke.key === 'Escape') {
        if (!this.isZeroChrome) {
          ke.preventDefault();
          this.dismissAll();
        }
        return;
      }

      if (isMeta && ke.key === '[') {
        ke.preventDefault();
        this.toggleLeft();
        return;
      }

      if (isMeta && ke.key === ']') {
        ke.preventDefault();
        this.toggleRight();
        return;
      }
    };

    target.addEventListener('keydown', onKeyDown);
    this.cleanupListeners.push(() => {
      target.removeEventListener('keydown', onKeyDown);
    });
  }

  public toggleLeft(): boolean {
    this.leftOpen = !this.leftOpen;
    this.syncDOM();
    this.notify();
    return this.leftOpen;
  }

  public toggleRight(): boolean {
    this.rightOpen = !this.rightOpen;
    this.syncDOM();
    this.notify();
    return this.rightOpen;
  }

  public openLeft(): void {
    if (!this.leftOpen) {
      this.leftOpen = true;
      this.syncDOM();
      this.notify();
    }
  }

  public openRight(): void {
    if (!this.rightOpen) {
      this.rightOpen = true;
      this.syncDOM();
      this.notify();
    }
  }

  public closeLeft(): void {
    if (this.leftOpen) {
      this.leftOpen = false;
      this.syncDOM();
      this.notify();
    }
  }

  public closeRight(): void {
    if (this.rightOpen) {
      this.rightOpen = false;
      this.syncDOM();
      this.notify();
    }
  }

  public dismissAll(): void {
    if (this.leftOpen || this.rightOpen) {
      this.leftOpen = false;
      this.rightOpen = false;
      this.syncDOM();
      this.notify();
    }
  }

  public subscribe(listener: DrawerStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const currentState = this.state;
    for (const listener of this.listeners) {
      listener(currentState);
    }
  }

  private syncDOM(): void {
    if (!this.shellElement) return;

    if (this.leftOpen) {
      this.shellElement.classList.add('left-open');
    } else {
      this.shellElement.classList.remove('left-open');
    }

    if (this.rightOpen) {
      this.shellElement.classList.add('right-open');
    } else {
      this.shellElement.classList.remove('right-open');
    }

    if (this.isZeroChrome) {
      this.shellElement.classList.add('zero-chrome');
    } else {
      this.shellElement.classList.remove('zero-chrome');
    }
  }

  public destroy(): void {
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
    this.listeners.clear();
    this.shellElement = null;
    this.backdropElement = null;
  }
}

/**
 * 3. Spatial Alignment & Non-Destructive Stacking Engine (F18, F19, F20, F21)
 * Calculates vertical top coordinates for notes with collision avoidance and leader lines.
 * Strictly satisfies E2E test assertions:
 * - tests/e2e/tier1-features/f14-f22-dual-drawers-margin.test.ts (lines 94-96, 117-119, 134-135)
 * - tests/e2e/tier2-boundaries/paragraph-deletion-margin-orphans.test.ts (lines 41-43, 84-93)
 */
export function calculateAlignedNoteOffsets(
  blocks: ParagraphBlockInfo[],
  notes: ThoughtNoteAnchor[],
  noteHeight: number = 80,
  minGap: number = 16
): Map<string, number> {
  const blockMap = new Map<string, ParagraphBlockInfo>();
  for (const block of blocks) {
    blockMap.set(block.id, block);
  }

  // Pre-sort items by paragraph baseTop; break ties with created_at
  // Matches RightMarginDrawer.calculateNoteTopOffsets() to guarantee order-independent vertical stacking
  const items = notes.map((note) => {
    const anchorBlock = blockMap.get(note.paragraphAnchorId);
    const baseTop = anchorBlock !== undefined ? anchorBlock.yOffset : note.topOffset;
    return { note, baseTop };
  });

  items.sort((a, b) => {
    if (a.baseTop !== b.baseTop) {
      return a.baseTop - b.baseTop;
    }
    return (a.note.created_at ?? 0) - (b.note.created_at ?? 0);
  });

  const offsets = new Map<string, number>();
  let lastBottom = -Infinity;

  for (const item of items) {
    let targetTop = item.baseTop;

    // Collision avoidance: stack downward if note overlaps previous note
    if (targetTop < lastBottom + minGap) {
      targetTop = lastBottom + minGap;
    }

    offsets.set(item.note.id, targetTop);
    lastBottom = targetTop + noteHeight;
  }

  return offsets;
}

/**
 * Calculates complete layout records with leader line targets and orphan detection
 */
export function calculateDetailedNoteLayouts(
  blocks: ParagraphBlockInfo[],
  notes: ThoughtNoteAnchor[],
  noteHeight: number = 80,
  minGap: number = 16
): AlignedNoteLayout[] {
  const blockMap = new Map<string, ParagraphBlockInfo>();
  for (const block of blocks) {
    blockMap.set(block.id, block);
  }

  const items = notes.map((note) => {
    const anchorBlock = blockMap.get(note.paragraphAnchorId);
    const isOrphaned = !anchorBlock;
    const naturalTop = anchorBlock ? anchorBlock.yOffset : note.topOffset;
    return { note, anchorBlock, isOrphaned, naturalTop };
  });

  items.sort((a, b) => {
    if (a.naturalTop !== b.naturalTop) {
      return a.naturalTop - b.naturalTop;
    }
    return (a.note.created_at ?? 0) - (b.note.created_at ?? 0);
  });

  const layouts: AlignedNoteLayout[] = [];
  let lastBottom = -Infinity;

  for (const item of items) {
    let targetTop = item.naturalTop;
    let hasCollisionOffset = false;

    if (targetTop < lastBottom + minGap) {
      targetTop = lastBottom + minGap;
      hasCollisionOffset = true;
    }

    layouts.push({
      noteId: item.note.id,
      anchorParagraphId: item.note.paragraphAnchorId,
      topOffset: targetTop,
      isOrphaned: item.isOrphaned,
      hasCollisionOffset,
      leaderLineTargetY: item.anchorBlock ? item.anchorBlock.yOffset + 12 : undefined,
    });

    lastBottom = targetTop + noteHeight;
  }

  return layouts;
}
