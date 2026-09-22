/**
 * src/editor/editor.ts
 * Daylight Writer - Core Typewriter Editor & Center-Scrolling Engine
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Active Resolution: 1584x1184 landscape | Refresh: 60Hz-120Hz Fluid
 * Sol:OS 8-bit Grayscale Design Tokens (--os-0 to --os-1000)
 */

import type { DocumentRecord } from '../storage/schema.ts';
import { TipTapTypewriterEngine } from './tiptap-editor.ts';
import type { CollaborationManager } from './tiptap-collaboration.ts';
import { ScriveningsEngine } from './scrivenings-engine.ts';

export interface CaretPosition {
  blockId: string;
  charOffset: number;
  screenY: number;
  docY: number;
  lineHeight: number;
}

export interface ParagraphBlockInfo {
  id: string;
  type: 'paragraph' | 'heading';
  level?: number;
  text: string;
  yOffset: number;
  height: number;
}

export interface EditorCallbacks {
  onCaretChange?: (pos: CaretPosition) => void;
  onScroll?: (scrollTop: number) => void;
  onContentChange?: (content: string) => void;
  onTitleChange?: (title: string, isCustom: boolean) => void;
  onScriveningsDocumentChange?: (docId: string, content: string) => void;
  onFocusSingleChunk?: (docId: string) => void;
}

export interface EditorOptions {
  viewportWidth?: number;       // Default: 1584
  viewportHeight?: number;      // Default: 1184
  columnWidth?: number;         // Default: 720
  lerpLambda?: number;          // Default: 18.0 (150ms settling)
  keyboardHeight?: number;      // Initial virtual keyboard override
  callbacks?: EditorCallbacks;
}

export class TypewriterEditor {
  // DOM Elements
  public scrollContainer!: HTMLElement;
  public canvas!: HTMLElement;
  public titleElement: HTMLElement | null = null;

  // Viewport & Geometry
  public viewportWidth: number;
  public viewportHeight: number;
  public columnWidth: number;
  public keyboardHeight: number = 0;

  // Typewriter Scroll State
  public scrollTop: number = 0;
  public currentScrollY: number = 0;
  public targetScrollTop: number = 0;
  public isRafActive: boolean = false;
  private lastRafTimestamp: number = 0;
  public lerpLambda: number;
  private isProgrammaticScroll: boolean = false;

  // User Manual Scroll Suspension
  public isScrollSuspended: boolean = false;

  // Caret & Block Tracking
  public activeBlockId: string = 'p-0';
  public caretPosition: CaretPosition = {
    blockId: 'p-0',
    charOffset: 0,
    screenY: 592,
    docY: 592,
    lineHeight: 34,
  };

  // Document State
  public currentDocumentId: string | null = null;
  public title: string = 'Untitled';
  public isTitleCustom: boolean = false;

  // Callbacks
  public callbacks: EditorCallbacks;

  // TipTap & Yjs Collaboration Engine
  public tiptapEngine: TipTapTypewriterEngine | null = null;
  public collaborationManager: CollaborationManager | null = null;

  // Scrivenings Multi-Document State (Steven Johnson Workflow)
  public scriveningsEngine: ScriveningsEngine | null = null;
  public isScriveningsMode: boolean = false;
  public scriveningsDocs: DocumentRecord[] = [];

  // Clean-up listeners
  private cleanupListeners: Array<() => void> = [];

  constructor(options: EditorOptions = {}) {
    this.viewportWidth = options.viewportWidth ?? 1584;
    this.viewportHeight = options.viewportHeight ?? 1184;
    this.columnWidth = options.columnWidth ?? 720;
    this.lerpLambda = options.lerpLambda ?? 18.0;
    this.keyboardHeight = options.keyboardHeight ?? 0;
    this.callbacks = options.callbacks ?? {};
  }

  // --------------------------------------------------------------------------
  // 1. Initialization & DOM Binding
  // --------------------------------------------------------------------------
  public init(
    scrollContainerEl: HTMLElement,
    canvasEl: HTMLElement,
    titleEl?: HTMLElement | null
  ): void {
    this.scrollContainer = scrollContainerEl;
    this.canvas = canvasEl;
    this.titleElement = titleEl || null;

    this.applyViewportPadding();
    this.initScrivenings();
    this.bindDOMEvents();
    this.recalculateCenterScroll(true);
  }

  private initScrivenings(): void {
    if (!this.canvas) return;
    this.scriveningsEngine = new ScriveningsEngine({
      container: this.canvas,
      callbacks: {
        onDocumentChange: (docId, content) => {
          if (this.callbacks.onScriveningsDocumentChange) {
            this.callbacks.onScriveningsDocumentChange(docId, content);
          }
        },
        onFocusSingleChunk: (docId) => {
          if (this.callbacks.onFocusSingleChunk) {
            this.callbacks.onFocusSingleChunk(docId);
          }
        },
        onActiveSectionChange: (docId) => {
          this.currentDocumentId = docId;
          const targetDoc = this.scriveningsDocs.find((d) => d.id === docId);
          if (targetDoc && this.titleElement) {
            this.title = targetDoc.title || 'Untitled Section';
            this.titleElement.textContent = `Scrivenings: ${this.title}`;
          }
        },
      },
    });
  }

  /**
   * Enable TipTap rich-text editor engine with optional Yjs live collaboration
   */
  public enableTipTap(options: { collaborationManager?: CollaborationManager | null; content?: string } = {}): TipTapTypewriterEngine {
    if (this.tiptapEngine) {
      return this.tiptapEngine;
    }

    this.collaborationManager = options.collaborationManager || null;
    this.tiptapEngine = new TipTapTypewriterEngine({
      element: this.canvas,
      content: options.content,
      collaborationManager: this.collaborationManager,
      onUpdate: () => {
        this.isScrollSuspended = false;
        this.updateCaretPosition();
        this.recalculateCenterScroll(false);
        if (this.callbacks.onContentChange) {
          this.callbacks.onContentChange(this.getContent());
        }
      },
      onSelectionUpdate: () => {
        this.updateCaretPosition();
        this.recalculateCenterScroll(false);
      },
    });

    return this.tiptapEngine;
  }

  public destroy(): void {
    this.isRafActive = false;
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
    if (this.tiptapEngine) {
      this.tiptapEngine.destroy();
      this.tiptapEngine = null;
    }
    if (this.collaborationManager) {
      this.collaborationManager.destroy();
      this.collaborationManager = null;
    }
  }

  // --------------------------------------------------------------------------
  // 2. Viewport & IME Midpoint Geometry (F05, F07)
  // --------------------------------------------------------------------------
  public get effectiveViewportHeight(): number {
    if (this.keyboardHeight > 0) {
      return Math.max(100, this.viewportHeight - this.keyboardHeight);
    }
    if (typeof window !== 'undefined' && window.visualViewport) {
      return window.visualViewport.height;
    }
    return this.viewportHeight;
  }

  public get typewriterMidpoint(): number {
    return Math.floor(this.effectiveViewportHeight / 2);
  }

  public setVirtualKeyboardHeight(height: number): void {
    this.keyboardHeight = height;
    this.applyViewportPadding();
    this.recalculateCenterScroll(false);
  }

  public applyViewportPadding(): void {
    if (!this.scrollContainer) return;
    const midpoint = this.typewriterMidpoint;
    this.scrollContainer.style.paddingTop = `calc(${midpoint}px - 1.5em)`;
    this.scrollContainer.style.paddingBottom = `${midpoint}px`;
    this.scrollContainer.style.setProperty('--typewriter-midpoint-y', `${midpoint}px`);
    this.scrollContainer.style.setProperty('--effective-viewport-height', `${this.effectiveViewportHeight}px`);
  }

  // --------------------------------------------------------------------------
  // 3. Document Loading & Content Management
  // --------------------------------------------------------------------------
  public loadDocument(doc: DocumentRecord): void {
    this.isScriveningsMode = false;
    this.scriveningsDocs = [doc];
    this.currentDocumentId = doc.id;
    this.title = doc.title || 'Untitled';
    this.isTitleCustom = doc.is_title_custom;

    if (this.titleElement) {
      this.titleElement.textContent = this.title;
    }

    this.setContent(doc.content || '', { resetScroll: true });
  }

  public loadScrivenings(docs: DocumentRecord[], activeDocId?: string): void {
    if (docs.length === 0) return;
    if (docs.length === 1) {
      this.loadDocument(docs[0]);
      return;
    }

    this.isScriveningsMode = true;
    this.scriveningsDocs = docs.map((d) => ({ ...d }));
    this.currentDocumentId = activeDocId || docs[0].id;

    const activeDoc = docs.find((d) => d.id === this.currentDocumentId) || docs[0];
    this.title = activeDoc ? activeDoc.title : 'Manuscript Outline';
    if (this.titleElement) {
      this.titleElement.textContent = `Scrivenings: ${this.title} (${docs.length} sections)`;
    }

    this.scriveningsEngine?.loadConcatenatedDocuments(docs, this.currentDocumentId);
    this.scrollTop = 0;
    this.currentScrollY = 0;
    this.targetScrollTop = 0;
    if (this.scrollContainer) {
      this.scrollContainer.scrollTop = 0;
    }
    this.recalculateCenterScroll(true);
  }

  public setContent(
    text: string,
    options: { resetScroll?: boolean } = {}
  ): void {
    if (!this.canvas) return;

    if (this.tiptapEngine) {
      this.tiptapEngine.setContent(text);
      if (options.resetScroll) {
        this.scrollTop = 0;
        this.currentScrollY = 0;
        this.targetScrollTop = 0;
        if (this.scrollContainer) {
          this.scrollContainer.scrollTop = 0;
        }
        this.recalculateCenterScroll(true);
      }
      return;
    }

    const paragraphs = text.split(/\n\n+/);
    this.canvas.innerHTML = '';
    const ownerDoc = this.canvas.ownerDocument || document;

    if (paragraphs.length === 0 || (paragraphs.length === 1 && paragraphs[0].trim() === '')) {
      const p = ownerDoc.createElement('p');
      p.className = 'editor-paragraph';
      p.dataset.blockId = 'p-0';
      p.innerHTML = '<br />';
      this.canvas.appendChild(p);
      this.activeBlockId = 'p-0';
    } else {
      paragraphs.forEach((paraText, idx) => {
        const p = ownerDoc.createElement('p');
        p.className = 'editor-paragraph';
        p.dataset.blockId = `p-${idx}`;
        p.textContent = paraText;
        this.canvas.appendChild(p);
      });
      this.activeBlockId = 'p-0';
    }

    if (options.resetScroll) {
      this.scrollTop = 0;
      this.currentScrollY = 0;
      this.targetScrollTop = 0;
      if (this.scrollContainer) {
        this.scrollContainer.scrollTop = 0;
      }
      this.recalculateCenterScroll(true);
    }
  }

  public getContent(): string {
    if (this.tiptapEngine) {
      return this.tiptapEngine.getContent();
    }
    if (!this.canvas) return '';
    const paragraphs = Array.from(this.canvas.querySelectorAll('.editor-paragraph'));
    return paragraphs.map((p) => (p.textContent || '').trimEnd()).join('\n\n');
  }

  public insertTextAtCaret(chunk: string): void {
    if (typeof window === 'undefined') return;
    const doc = this.canvas?.ownerDocument || document;
    const sel = doc.defaultView?.getSelection() || window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = doc.createTextNode(chunk);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    this.updateCaretPosition();
    this.recalculateCenterScroll(false);
  }

  // --------------------------------------------------------------------------
  // 4. Caret Coordinate Detection
  // --------------------------------------------------------------------------
  public updateCaretPosition(): CaretPosition {
    const doc = this.canvas?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      return this.caretPosition;
    }

    const sel = doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
    let screenY = this.typewriterMidpoint;
    let docY = this.scrollTop + this.typewriterMidpoint;
    let blockId = this.activeBlockId;
    let charOffset = 0;
    let lineHeight = 34;

    if (sel && sel.rangeCount > 0 && this.canvas && this.canvas.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);

      const targetNode = range.startContainer;
      const targetElement = targetNode.nodeType === 1 /* ELEMENT_NODE */
        ? (targetNode as HTMLElement)
        : targetNode.parentElement;
      const blockEl = targetElement?.closest('[data-block-id]') as HTMLElement | null;

      if (blockEl && blockEl.dataset.blockId) {
        blockId = blockEl.dataset.blockId;
        this.activeBlockId = blockId;

        // Compute char offset within block
        charOffset = this.computeBlockCharOffset(blockEl, range.startContainer, range.startOffset);

        // Compute screen rect if available
        if (this.scrollContainer && typeof blockEl.getBoundingClientRect === 'function') {
          const rects = range.getClientRects();
          const clientRect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
          const containerRect = this.scrollContainer.getBoundingClientRect();

          if (clientRect.height > 0 && clientRect.top > 0) {
            screenY = clientRect.top - containerRect.top;
            lineHeight = clientRect.height;
            docY = screenY + this.scrollContainer.scrollTop;
          } else {
            // Fallback to offsetTop geometry
            const bRect = blockEl.getBoundingClientRect();
            if (bRect.height > 0) {
              screenY = bRect.top - containerRect.top;
              lineHeight = 34;
              docY = screenY + this.scrollContainer.scrollTop;
            } else {
              docY = blockEl.offsetTop;
              screenY = docY - this.scrollTop;
            }
          }
        }
      if (this.isScriveningsMode && this.scriveningsEngine && targetNode) {
        const sectionDocId = this.scriveningsEngine.getDocumentIdForNode(targetNode);
        if (sectionDocId) {
          this.scriveningsEngine.setActiveSection(sectionDocId);
        }
      }
    }
  } else if (this.canvas) {
      const activeEl = this.canvas.querySelector(`[data-block-id="${this.activeBlockId}"]`) as HTMLElement | null;
      if (activeEl) {
        docY = activeEl.offsetTop;
        screenY = docY - this.scrollTop;
      }
    }

    this.caretPosition = {
      blockId,
      charOffset,
      screenY,
      docY,
      lineHeight,
    };

    if (this.callbacks.onCaretChange) {
      this.callbacks.onCaretChange(this.caretPosition);
    }

    return this.caretPosition;
  }

  /**
   * Returns document ID and character offset for cursor-based document splitting
   */
  public getCurrentSplitOffset(): { docId: string; offset: number } | null {
    if (!this.canvas) return null;
    const doc = this.canvas.ownerDocument || document;
    const sel = doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    const targetNode = range.startContainer;
    const targetDocId = this.isScriveningsMode && this.scriveningsEngine
      ? (this.scriveningsEngine.getDocumentIdForNode(targetNode) || this.currentDocumentId)
      : this.currentDocumentId;

    if (!targetDocId) return null;

    const rootScope = this.isScriveningsMode
      ? (this.canvas.querySelector(`.scrivenings-section-body[data-section-doc-id="${targetDocId}"]`) || this.canvas)
      : this.canvas;

    const blockEl = (targetNode instanceof HTMLElement ? targetNode : targetNode.parentElement)?.closest('.editor-paragraph') as HTMLElement | null;

    let totalOffset = 0;
    const paragraphs = Array.from(rootScope.querySelectorAll('.editor-paragraph'));
    for (const p of paragraphs) {
      if (p === blockEl) {
        const offsetInBlock = this.computeBlockCharOffset(p as HTMLElement, targetNode, range.startOffset);
        totalOffset += offsetInBlock;
        break;
      } else {
        totalOffset += (p.textContent?.length || 0) + 2; // +2 for paragraph break
      }
    }

    return { docId: targetDocId, offset: totalOffset };
  }

  private computeBlockCharOffset(blockEl: HTMLElement, node: Node, offset: number): number {
    let count = 0;
    const doc = blockEl.ownerDocument || document;
    const walker = doc.createTreeWalker(blockEl, 4 /* SHOW_TEXT */);
    let current = walker.nextNode();
    while (current) {
      if (current === node) {
        return count + offset;
      }
      count += current.textContent?.length || 0;
      current = walker.nextNode();
    }
    return count;
  }

  // --------------------------------------------------------------------------
  // 5. Typewriter Center-Scrolling Engine (F05, F06)
  // --------------------------------------------------------------------------
  public recalculateCenterScroll(instant: boolean = false): void {
    if (this.isScrollSuspended) return;

    let targetY = 0;

    // Direct DOM measurement if available
    if (this.canvas) {
      const activeEl = this.canvas.querySelector(`[data-block-id="${this.activeBlockId}"]`) as HTMLElement | null;
      if (activeEl) {
        targetY = activeEl.offsetTop;
      } else {
        targetY = this.caretPosition.docY;
      }
    }

    this.targetScrollTop = Math.max(0, targetY - this.typewriterMidpoint);

    if (instant) {
      this.currentScrollY = this.targetScrollTop;
      this.scrollTop = this.targetScrollTop;
      if (this.scrollContainer) {
        this.isProgrammaticScroll = true;
        this.scrollContainer.scrollTop = this.targetScrollTop;
        queueMicrotask(() => { this.isProgrammaticScroll = false; });
      }
      this.caretPosition.screenY = targetY - this.scrollTop;
      this.notifyScroll();
      return;
    }

    this.startRafLerp();
  }

  private startRafLerp(): void {
    if (this.isRafActive) return;
    this.isRafActive = true;
    this.lastRafTimestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(this.stepRafLerp.bind(this));
    } else {
      // Direct step in non-rAF environment
      this.stepRafLerp(this.lastRafTimestamp + 16.67);
    }
  }

  public stepRafLerp(now: number): void {
    if (!this.isRafActive || this.isScrollSuspended || !this.scrollContainer) {
      this.isRafActive = false;
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastRafTimestamp) / 1000));
    this.lastRafTimestamp = now;

    // Frame-rate independent exponential lerp
    const alpha = 1 - Math.exp(-this.lerpLambda * dt);
    const delta = this.targetScrollTop - this.currentScrollY;

    // Anti-jitter deadband threshold
    if (Math.abs(delta) < 0.5) {
      this.currentScrollY = this.targetScrollTop;
      this.scrollTop = Math.round(this.targetScrollTop);
      this.isProgrammaticScroll = true;
      this.scrollContainer.scrollTop = this.scrollTop;
      queueMicrotask(() => { this.isProgrammaticScroll = false; });

      this.isRafActive = false;
      this.caretPosition.screenY = this.typewriterMidpoint;
      this.notifyScroll();
      return;
    }

    this.currentScrollY += delta * alpha;
    this.scrollTop = Math.round(this.currentScrollY);

    this.isProgrammaticScroll = true;
    this.scrollContainer.scrollTop = this.scrollTop;
    queueMicrotask(() => { this.isProgrammaticScroll = false; });

    this.notifyScroll();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(this.stepRafLerp.bind(this));
    }
  }

  private notifyScroll(): void {
    if (this.callbacks.onScroll) {
      this.callbacks.onScroll(this.scrollTop);
    }
  }

  // --------------------------------------------------------------------------
  // 6. User Scroll Suspension (F06)
  // --------------------------------------------------------------------------
  public setScrollSuspended(suspended: boolean): void {
    this.isScrollSuspended = suspended;
    if (suspended) {
      this.isRafActive = false;
      if (this.scrollContainer) {
        this.currentScrollY = this.scrollContainer.scrollTop;
        this.scrollTop = this.scrollContainer.scrollTop;
      }
    } else {
      this.recalculateCenterScroll(false);
    }
  }

  public resumeScroll(): void {
    this.setScrollSuspended(false);
  }

  // --------------------------------------------------------------------------
  // 7. Event Binding & Listeners
  // --------------------------------------------------------------------------
  private bindDOMEvents(): void {
    if (!this.canvas || !this.scrollContainer) return;
    const doc = this.canvas.ownerDocument || document;

    // Input & typing resumes scroll
    const onInput = () => {
      this.isScrollSuspended = false;
      if (this.isScriveningsMode && this.scriveningsEngine) {
        this.scriveningsEngine.handleContentInput();
      }
      this.updateCaretPosition();
      this.recalculateCenterScroll(false);
      if (this.callbacks.onContentChange) {
        this.callbacks.onContentChange(this.getContent());
      }
    };
    this.canvas.addEventListener('input', onInput);
    this.cleanupListeners.push(() => this.canvas.removeEventListener('input', onInput));

    // Selection changes (arrow keys, click)
    const onSelectionChange = () => {
      if (doc.activeElement === this.canvas || this.canvas.contains(doc.activeElement)) {
        this.updateCaretPosition();
      }
    };
    doc.addEventListener('selectionchange', onSelectionChange);
    this.cleanupListeners.push(() => doc.removeEventListener('selectionchange', onSelectionChange));

    // Manual user scroll detection (wheel, touch)
    const onUserWheel = () => {
      this.isScrollSuspended = true;
      this.isRafActive = false;
    };
    this.scrollContainer.addEventListener('wheel', onUserWheel, { passive: true });
    this.cleanupListeners.push(() => this.scrollContainer.removeEventListener('wheel', onUserWheel));

    const onTouchStart = () => {
      this.isScrollSuspended = true;
      this.isRafActive = false;
    };
    this.scrollContainer.addEventListener('touchstart', onTouchStart, { passive: true });
    this.cleanupListeners.push(() => this.scrollContainer.removeEventListener('touchstart', onTouchStart));

    // Container scroll listener (handles scrollbar dragging)
    const onScroll = () => {
      if (!this.isProgrammaticScroll) {
        this.isScrollSuspended = true;
        this.scrollTop = this.scrollContainer.scrollTop;
        this.currentScrollY = this.scrollTop;
      }
      this.notifyScroll();
    };
    this.scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    this.cleanupListeners.push(() => this.scrollContainer.removeEventListener('scroll', onScroll));

    // Visual Viewport resize (IME on-screen keyboard open/close)
    if (typeof window !== 'undefined' && window.visualViewport) {
      const onViewportResize = () => {
        this.applyViewportPadding();
        this.recalculateCenterScroll(false);
      };
      window.visualViewport.addEventListener('resize', onViewportResize);
      this.cleanupListeners.push(() => window.visualViewport?.removeEventListener('resize', onViewportResize));
    }
  }

  // --------------------------------------------------------------------------
  // 8. Spatial Mapping for Thought Margin (Milestone 3 / F18, F19)
  // --------------------------------------------------------------------------
  public getParagraphOffsets(): Map<string, { yOffset: number; height: number; text: string }> {
    const offsets = new Map<string, { yOffset: number; height: number; text: string }>();
    if (!this.canvas) return offsets;

    const blockElements = this.canvas.querySelectorAll('[data-block-id]');
    blockElements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const id = htmlEl.dataset.blockId || '';
      if (id) {
        offsets.set(id, {
          yOffset: htmlEl.offsetTop,
          height: htmlEl.offsetHeight,
          text: htmlEl.textContent || '',
        });
      }
    });

    return offsets;
  }
}
