/**
 * src/editor/focus-mode.ts
 * Focus Mode Engine for Daylight Writer
 * Supports: Paragraph Focus Mode (F08) & Sentence Focus Mode via Intl.Segmenter (F09)
 * Optimized for Daylight Computer (DC1) 8-bit Grayscale Sol:OS Design Tokens
 */

export type FocusMode = 'none' | 'sentence' | 'paragraph';

export interface SentenceSpan {
  index: number;
  start: number;
  end: number;
  rawText: string;
  text: string;
}

export interface FocusState {
  mode: FocusMode;
  activeParagraphId: string | null;
  activeParagraphElement: HTMLElement | null;
  activeSentenceIndex: number;
  activeSentenceSpan: SentenceSpan | null;
  caretOffset: number;
}

export type FocusChangeCallback = (state: FocusState) => void;
export type ModeChangeCallback = (mode: FocusMode) => void;

export interface FocusModeOptions {
  canvasElement: HTMLElement;
  shellElement?: HTMLElement | null;
  initialMode?: FocusMode;
  locale?: string;
  enableCssHighlightFallback?: boolean;
}

/**
 * Known abbreviation regex for boundary masking
 */
export const ABBREVIATION_REGEX = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|e\.g|i\.e)\./gi;

/**
 * Mask abbreviations with length-preserving underscore substitution.
 * Guaranteed 1:1 character index parity with original string.
 */
export function maskAbbreviationsLengthPreserving(text: string): string {
  return text.replace(ABBREVIATION_REGEX, (match) => match.replace(/\./g, '_'));
}

/**
 * Robust sentence segmenter using Intl.Segmenter with length-preserving abbreviation masking.
 * Pure functional, 100% unit-testable without DOM.
 */
export function segmentSentences(text: string, locale: string = 'en'): SentenceSpan[] {
  if (!text || !text.trim()) return [];

  const maskedText = maskAbbreviationsLengthPreserving(text);
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const spans: SentenceSpan[] = [];
  let index = 0;

  for (const s of segmenter.segment(maskedText)) {
    const raw = s.segment;
    const start = s.index;
    const end = start + raw.length;
    const originalSlice = text.slice(start, end);
    const trimmed = originalSlice.trim();

    if (trimmed.length > 0) {
      spans.push({
        index: index++,
        start,
        end,
        rawText: originalSlice,
        text: trimmed,
      });
    }
  }

  return spans;
}

/**
 * Locate active sentence index within sentence spans based on character offset.
 */
export function findActiveSentenceIndex(sentences: SentenceSpan[], caretOffset: number): number {
  if (sentences.length === 0) return 0;
  if (caretOffset <= sentences[0].start) return 0;
  if (caretOffset >= sentences[sentences.length - 1].end) return sentences.length - 1;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (caretOffset >= s.start && caretOffset <= s.end) {
      if (caretOffset === s.end && i + 1 < sentences.length) {
        if (caretOffset >= sentences[i + 1].start) {
          return i + 1;
        }
      }
      return i;
    }
  }

  return 0;
}

/**
 * Cycle order: none -> sentence -> paragraph -> none
 */
export function getNextFocusMode(current: FocusMode): FocusMode {
  switch (current) {
    case 'none':
      return 'sentence';
    case 'sentence':
      return 'paragraph';
    case 'paragraph':
      return 'none';
  }
}

/**
 * Focus Mode Engine Implementation
 */
export class FocusModeEngine {
  private canvas: HTMLElement;
  private shell: HTMLElement | null;
  private mode: FocusMode = 'sentence';
  private locale: string = 'en';

  private activeParagraph: HTMLElement | null = null;
  private activeSentenceIndex: number = 0;
  private activeSpan: SentenceSpan | null = null;

  private isComposing: boolean = false;
  private isSuspended: boolean = false;
  private updateScheduled: boolean = false;

  private focusChangeListeners: Set<FocusChangeCallback> = new Set();
  private modeChangeListeners: Set<ModeChangeCallback> = new Set();

  // Bound event handlers for clean teardown
  private onSelectionChangeBound: () => void;
  private onInputBound: (e: Event) => void;
  private onCompositionStartBound: () => void;
  private onCompositionEndBound: () => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(options: FocusModeOptions) {
    this.canvas = options.canvasElement;
    this.shell = options.shellElement || null;
    this.locale = options.locale || 'en';
    this.mode = options.initialMode || 'sentence';

    this.onSelectionChangeBound = this.handleSelectionChange.bind(this);
    this.onInputBound = this.handleInput.bind(this);
    this.onCompositionStartBound = () => { this.isComposing = true; };
    this.onCompositionEndBound = () => {
      this.isComposing = false;
      this.scheduleUpdate();
    };
    this.onKeyDownBound = this.handleKeyDown.bind(this);

    this.attachEventListeners();
    this.applyModeClasses();
    if (this.mode !== 'none') {
      this.updateFocus(false);
    }
  }

  public getMode(): FocusMode {
    return this.mode;
  }

  public setMode(newMode: FocusMode): void {
    if (this.mode === newMode) return;
    this.cleanupCurrentStyling();
    this.mode = newMode;
    this.applyModeClasses();
    this.updateFocus(true);
    this.notifyModeChange();
  }

  public cycleMode(): FocusMode {
    const next = getNextFocusMode(this.mode);
    this.setMode(next);
    return next;
  }

  public getActiveParagraphId(): string | null {
    if (!this.activeParagraph) return null;
    return this.activeParagraph.getAttribute('data-block-id') || this.activeParagraph.id || null;
  }

  public getActiveParagraphElement(): HTMLElement | null {
    return this.activeParagraph;
  }

  public getActiveSentenceIndex(): number {
    return this.activeSentenceIndex;
  }

  public onFocusChange(fn: FocusChangeCallback): () => void {
    this.focusChangeListeners.add(fn);
    return () => this.focusChangeListeners.delete(fn);
  }

  public onModeChange(fn: ModeChangeCallback): () => void {
    this.modeChangeListeners.add(fn);
    return () => this.modeChangeListeners.delete(fn);
  }

  public suspend(): void {
    this.isSuspended = true;
  }

  public resume(): void {
    this.isSuspended = false;
    this.scheduleUpdate();
  }

  public destroy(): void {
    this.detachEventListeners();
    this.cleanupCurrentStyling();
    const targets = [this.canvas, this.shell].filter(Boolean) as HTMLElement[];
    targets.forEach((target) => {
      target.classList.remove('focus-mode-paragraph', 'focus-mode-sentence');
    });
    this.focusChangeListeners.clear();
    this.modeChangeListeners.clear();
  }

  /**
   * Main focus evaluation pass.
   */
  public updateFocus(force: boolean = false): void {
    if (this.isSuspended || this.isComposing) return;
    if (this.mode === 'none') return;

    const sel = this.getSelection();
    let targetParagraph: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      targetParagraph = this.findEnclosingParagraph(range.startContainer);
    }

    if (!targetParagraph && force) {
      targetParagraph = (this.canvas.querySelector('.editor-paragraph, p') as HTMLElement | null);
    }

    if (!targetParagraph) {
      return;
    }

    if (this.mode === 'paragraph') {
      this.applyParagraphFocus(targetParagraph, force);
    } else if (this.mode === 'sentence') {
      this.applySentenceFocus(targetParagraph, force);
    }
  }

  /* --------------------------------------------------------------------------
     Internal Focus Application Methods
     -------------------------------------------------------------------------- */

  private applyParagraphFocus(paragraph: HTMLElement, force: boolean): void {
    if (!force && this.activeParagraph === paragraph) {
      return; // O(1) intra-paragraph typing efficiency
    }

    if (this.activeParagraph && this.activeParagraph !== paragraph) {
      this.activeParagraph.classList.remove('os-focus-active');
    }

    paragraph.classList.add('os-focus-active');
    this.activeParagraph = paragraph;
    this.activeSentenceIndex = 0;
    this.activeSpan = null;

    this.notifyFocusChange(0);
  }

  private applySentenceFocus(paragraph: HTMLElement, force: boolean): void {
    const caretOffset = this.getCaretOffset(paragraph);
    const textContent = paragraph.textContent || '';
    const sentences = segmentSentences(textContent, this.locale);

    if (sentences.length === 0) {
      this.cleanupSentenceSpans(paragraph);
      return;
    }

    const newSentenceIdx = findActiveSentenceIndex(sentences, caretOffset);
    const newSpan = sentences[newSentenceIdx] || null;

    // Check if intra-sentence typing (zero DOM mutation path)
    const isSameParagraph = this.activeParagraph === paragraph;
    const isSameSentence = isSameParagraph && this.activeSentenceIndex === newSentenceIdx;
    const existingActiveSpan = paragraph.querySelector('.os-sentence-active');

    if (!force && isSameSentence && existingActiveSpan) {
      // Zero DOM work required
      return;
    }

    // Changing paragraph or changing sentence: atomic caret preservation
    if (this.activeParagraph && this.activeParagraph !== paragraph) {
      this.activeParagraph.classList.remove('os-focus-active-p');
      this.cleanupSentenceSpans(this.activeParagraph);
    }

    paragraph.classList.add('os-focus-active-p');
    this.activeParagraph = paragraph;
    this.activeSentenceIndex = newSentenceIdx;
    this.activeSpan = newSpan;

    if (newSpan) {
      this.wrapActiveSentence(paragraph, newSpan.start, newSpan.end, caretOffset);
    }

    this.notifyFocusChange(caretOffset);
  }

  private wrapActiveSentence(
    paragraph: HTMLElement,
    start: number,
    end: number,
    savedCaretOffset: number
  ): void {
    // 1. Remove old spans and normalize text nodes
    this.cleanupSentenceSpans(paragraph);

    // 2. Create DOM Range for new sentence
    const range = this.createRangeFromOffsets(paragraph, start, end);
    if (!range) return;

    // 3. Wrap in .os-sentence-active
    const ownerDoc = paragraph.ownerDocument || document;
    const span = ownerDoc.createElement('span');
    span.className = 'os-sentence-active';

    try {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    } catch {
      // Fallback if range crosses complex boundary
      return;
    }

    // 4. Restore exact caret offset
    this.setCaretOffset(paragraph, savedCaretOffset);
  }

  private cleanupSentenceSpans(paragraph: HTMLElement): void {
    const spans = paragraph.querySelectorAll('.os-sentence-active');
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    }
    paragraph.normalize();
  }

  private cleanupCurrentStyling(): void {
    if (this.activeParagraph) {
      this.activeParagraph.classList.remove('os-focus-active', 'os-focus-active-p');
      this.cleanupSentenceSpans(this.activeParagraph);
      this.activeParagraph = null;
    }
    const allActiveParas = this.canvas.querySelectorAll('.os-focus-active, .os-focus-active-p');
    allActiveParas.forEach((el) => el.classList.remove('os-focus-active', 'os-focus-active-p'));

    const allSpans = this.canvas.querySelectorAll('.os-sentence-active');
    allSpans.forEach((span) => {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
    });
  }

  private applyModeClasses(): void {
    const targets = [this.canvas, this.shell].filter(Boolean) as HTMLElement[];
    targets.forEach((target) => {
      target.classList.remove('focus-mode-paragraph', 'focus-mode-sentence');
      if (this.mode === 'paragraph') {
        target.classList.add('focus-mode-paragraph');
      } else if (this.mode === 'sentence') {
        target.classList.add('focus-mode-sentence');
      }
    });
  }

  /* --------------------------------------------------------------------------
     DOM Tree & Caret Helpers
     -------------------------------------------------------------------------- */

  private findEnclosingParagraph(node: Node | null): HTMLElement | null {
    let curr = node;
    while (curr && curr !== this.canvas) {
      if (curr.nodeType === 1 /* ELEMENT_NODE */) {
        const el = curr as HTMLElement;
        if (el.classList.contains('editor-paragraph') || el.hasAttribute('data-block-id')) {
          return el;
        }
      }
      curr = curr.parentNode;
    }
    return null;
  }

  private getCaretOffset(element: HTMLElement): number {
    const sel = this.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return 0;

    const preRange = range.cloneRange();
    preRange.selectNodeContents(element);
    try {
      preRange.setEnd(range.endContainer, range.endOffset);
      return preRange.toString().length;
    } catch {
      return 0;
    }
  }

  private setCaretOffset(element: HTMLElement, targetOffset: number): boolean {
    const doc = element.ownerDocument || document;
    const walker = doc.createTreeWalker(element, 4 /* SHOW_TEXT */, null);
    let currentOffset = 0;
    let textNode: Text | null;
    let lastNode: Text | null = null;

    while ((textNode = walker.nextNode() as Text | null)) {
      lastNode = textNode;
      const len = textNode.nodeValue?.length || 0;
      if (currentOffset + len >= targetOffset) {
        const offsetInNode = Math.min(len, Math.max(0, targetOffset - currentOffset));
        const sel = this.getSelection();
        if (sel) {
          const r = doc.createRange();
          r.setStart(textNode, offsetInNode);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          return true;
        }
      }
      currentOffset += len;
    }

    if (lastNode) {
      const sel = this.getSelection();
      if (sel) {
        const r = doc.createRange();
        r.setStart(lastNode, lastNode.nodeValue?.length || 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
    }
    return false;
  }

  private createRangeFromOffsets(root: Node, startOffset: number, endOffset: number): Range | null {
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, null);
    let current = 0;
    let startNode: Text | null = null;
    let startNodeOffset = 0;
    let endNode: Text | null = null;
    let endNodeOffset = 0;
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const len = node.nodeValue?.length || 0;
      if (!startNode && current + len >= startOffset) {
        startNode = node;
        startNodeOffset = Math.max(0, startOffset - current);
      }
      if (!endNode && current + len >= endOffset) {
        endNode = node;
        endNodeOffset = Math.min(len, endOffset - current);
        break;
      }
      current += len;
    }

    if (!startNode || !endNode) return null;

    const range = doc.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    return range;
  }

  private getSelection(): Selection | null {
    const doc = this.canvas.ownerDocument || document;
    return doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
  }

  /* --------------------------------------------------------------------------
     Event Listeners & Scheduling
     -------------------------------------------------------------------------- */

  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        this.updateScheduled = false;
        this.updateFocus();
      });
    } else {
      setTimeout(() => {
        this.updateScheduled = false;
        this.updateFocus();
      }, 0);
    }
  }

  private handleSelectionChange(): void {
    this.scheduleUpdate();
  }

  private handleInput(): void {
    this.scheduleUpdate();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Cmd+D or Ctrl+D: Cycle Focus Mode
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.cycleMode();
    }
  }

  private attachEventListeners(): void {
    const doc = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    doc.addEventListener('selectionchange', this.onSelectionChangeBound);
    this.canvas.addEventListener('input', this.onInputBound);
    this.canvas.addEventListener('compositionstart', this.onCompositionStartBound);
    this.canvas.addEventListener('compositionend', this.onCompositionEndBound);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDownBound);
    }
  }

  private detachEventListeners(): void {
    const doc = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      doc.removeEventListener('selectionchange', this.onSelectionChangeBound);
    }
    this.canvas.removeEventListener('input', this.onInputBound);
    this.canvas.removeEventListener('compositionstart', this.onCompositionStartBound);
    this.canvas.removeEventListener('compositionend', this.onCompositionEndBound);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDownBound);
    }
  }

  private notifyFocusChange(caretOffset: number): void {
    const state: FocusState = {
      mode: this.mode,
      activeParagraphId: this.getActiveParagraphId(),
      activeParagraphElement: this.activeParagraph,
      activeSentenceIndex: this.activeSentenceIndex,
      activeSentenceSpan: this.activeSpan,
      caretOffset,
    };
    this.focusChangeListeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error('[FocusModeEngine] Listener error:', e); }
    });
  }

  private notifyModeChange(): void {
    this.modeChangeListeners.forEach((fn) => {
      try { fn(this.mode); } catch (e) { console.error('[FocusModeEngine] Listener error:', e); }
    });
  }
}
