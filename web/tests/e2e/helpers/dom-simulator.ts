/**
 * DOM Simulator & Layout Engine for E2E Tests
 * Simulates DC1 1584x1184 landscape viewport, typewriter center-scrolling,
 * focus modes, drawer layout, and auto-titling.
 */

export interface ViewportConfig {
  physicalWidth: number;   // 1600
  physicalHeight: number;  // 1200
  hardwareInset: number;   // +8px
  logicalWidth: number;    // 1584
  logicalHeight: number;   // 1184
}

export const DC1_VIEWPORT: ViewportConfig = {
  physicalWidth: 1600,
  physicalHeight: 1200,
  hardwareInset: 8,
  logicalWidth: 1584,
  logicalHeight: 1184,
};

export type FocusMode = 'none' | 'paragraph' | 'sentence';

export interface EditorBlock {
  id: string; // e.g. "p-1", "h1-1"
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
}

export class DaylightDOMSimulator {
  public viewportWidth = DC1_VIEWPORT.logicalWidth;
  public viewportHeight = DC1_VIEWPORT.logicalHeight;
  public keyboardHeight: number = 0; // Virtual keyboard (IME)
  
  // Layout components
  public columnWidth = 720;
  public leftDrawerWidth = 320;
  public rightDrawerWidth = 360;
  
  // Drawer states
  public leftDrawerOpen = false;
  public rightDrawerOpen = false;

  // Typewriter state
  public scrollTop = 0;
  public caretPosition = { blockId: '', charOffset: 0, screenY: 0 };
  
  // Focus mode
  public focusMode: FocusMode = 'none';
  public activeBlockId: string = '';
  public activeSentenceIndex: number = 0;

  // Title state
  public title: string = 'Untitled';
  public isTitleCustom: boolean = false;

  // Blocks in editor
  public blocks: EditorBlock[] = [];
  public notes: ThoughtNoteAnchor[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.viewportWidth = DC1_VIEWPORT.logicalWidth;
    this.viewportHeight = DC1_VIEWPORT.logicalHeight;
    this.keyboardHeight = 0;
    this.leftDrawerOpen = false;
    this.rightDrawerOpen = false;
    this.scrollTop = 0;
    this.focusMode = 'none';
    this.activeBlockId = '';
    this.activeSentenceIndex = 0;
    this.title = 'Untitled';
    this.isTitleCustom = false;
    this.blocks = [];
    this.notes = [];
  }

  get effectiveViewportHeight(): number {
    return this.viewportHeight - this.keyboardHeight;
  }

  get typewriterMidpoint(): number {
    return Math.floor(this.effectiveViewportHeight / 2);
  }

  get isZeroChrome(): boolean {
    return !this.leftDrawerOpen && !this.rightDrawerOpen;
  }

  get centralMargin(): number {
    return (this.viewportWidth - this.columnWidth) / 2; // 432px in zero-chrome mode
  }

  // Keyboard shortcut actions
  handleKeyDown(key: string, meta: boolean = false): void {
    if (key === 'Escape') {
      this.leftDrawerOpen = false;
      this.rightDrawerOpen = false;
    } else if (meta && key === '[') {
      this.leftDrawerOpen = !this.leftDrawerOpen;
    } else if (meta && key === ']') {
      this.rightDrawerOpen = !this.rightDrawerOpen;
    }
  }

  // Auto-titling algorithm (F11, F12)
  updateTitleFromText(text: string): void {
    if (this.isTitleCustom) return; // Protected by manual override lock

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      this.title = 'Untitled';
      return;
    }

    const firstLine = lines[0];
    const stripped = firstLine.replace(/^#{1,6}\s+/, '').trim();
    // Use first phrase/sentence or up to 40 characters
    const firstSentence = stripped.split(/[.!?,]/)[0] || stripped;
    this.title = firstSentence.slice(0, 40).trim() || 'Untitled';
  }

  setManualTitle(newTitle: string): void {
    this.title = newTitle;
    this.isTitleCustom = true;
  }

  // Virtual keyboard simulation (F07)
  setVirtualKeyboardHeight(height: number): void {
    this.keyboardHeight = height;
    this.recalculateCenterScroll();
  }

  // Typewriter Center-Scrolling (F05, F06)
  recalculateCenterScroll(): void {
    const activeBlock = this.blocks.find((b) => b.id === this.activeBlockId);
    if (!activeBlock) return;

    // Center target is typewriterMidpoint
    const desiredCaretScreenY = this.typewriterMidpoint;
    // activeBlock.yOffset - scrollTop = desiredCaretScreenY
    this.scrollTop = Math.max(0, activeBlock.yOffset - desiredCaretScreenY);
    this.caretPosition.screenY = activeBlock.yOffset - this.scrollTop;
  }

  // Spatial alignment for margin notes (F19, F20)
  calculateNoteTopOffsets(): Map<string, number> {
    const offsets = new Map<string, number>();
    let lastBottom = -Infinity;

    for (const note of this.notes) {
      const anchorBlock = this.blocks.find((b) => b.id === note.paragraphAnchorId);
      // If orphaned, keep note at last known offset or bottom
      let targetTop = anchorBlock ? anchorBlock.yOffset : note.topOffset;

      // Stacking collision avoidance: min 16px gap
      if (targetTop < lastBottom + 16) {
        targetTop = lastBottom + 16;
      }

      offsets.set(note.id, targetTop);
      lastBottom = targetTop + 80; // Assuming 80px note height
    }

    return offsets;
  }
}
