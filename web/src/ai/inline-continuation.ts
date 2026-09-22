/**
 * src/ai/inline-continuation.ts
 * Daylight Writer - `+++` Inline Continuation Engine
 * Features:
 * - Real-time '+++' trigger detection
 * - Clean trigger token stripping
 * - Ghost ink streaming in Sol:OS --os-400
 * - Solidification into standard prose (--os-900 / --os-1000)
 * - Cancellation via Esc or Backspace
 * - Early acceptance via Tab or Enter
 * - Single-step atomic Cmd+Z undo (F44) via HistoryManager
 * - Fluid typewriter center-scrolling synchronization (592px lock)
 */

import type { AIServiceAdapter } from './service-adapter.ts';
import type { TypewriterEditor } from '../editor/editor.ts';
import type { HistoryManager } from '../editor/history.ts';

export type ContinuationEngineState =
  | 'idle'
  | 'detecting'
  | 'streaming'
  | 'solidifying'
  | 'cancelled'
  | 'error';

export interface InlineContinuationOptions {
  triggerToken?: string; // Default '+++'
  maxTokens?: number;
  onStateChange?: (state: ContinuationEngineState) => void;
  onChunk?: (chunk: string, fullStream: string) => void;
}

/**
 * Pure trigger detection helper (tested in F42 E2E).
 */
export function detectContinuationTrigger(buffer: string): {
  triggered: boolean;
  strippedBuffer: string;
} {
  if (buffer.endsWith('+++')) {
    return { triggered: true, strippedBuffer: buffer.slice(0, -3) };
  }
  return { triggered: false, strippedBuffer: buffer };
}

export class InlineContinuationEngine {
  public editor: TypewriterEditor;
  public aiAdapter: AIServiceAdapter;
  public history: HistoryManager;
  public options: InlineContinuationOptions;

  private state: ContinuationEngineState = 'idle';
  private abortController: AbortController | null = null;
  public activeGhostSpan: HTMLElement | null = null;
  public activeBlockId: string | null = null;
  private baselineContent: string = '';
  private baselineCaret: number = 0;
  private accumulatedText: string = '';

  private cleanupListeners: Array<() => void> = [];

  constructor(
    editor: TypewriterEditor,
    aiAdapter: AIServiceAdapter,
    history: HistoryManager,
    options: InlineContinuationOptions = {}
  ) {
    this.editor = editor;
    this.aiAdapter = aiAdapter;
    this.history = history;
    this.options = options;
  }

  public getState(): ContinuationEngineState {
    return this.state;
  }

  public isStreaming(): boolean {
    return this.state === 'streaming';
  }

  /**
   * Binds input and keydown event listeners to editor canvas.
   */
  public attach(canvasEl: HTMLElement): void {
    const onInput = () => this.handleInput();
    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

    canvasEl.addEventListener('input', onInput);
    canvasEl.addEventListener('keydown', onKeyDown);

    this.cleanupListeners.push(() => {
      canvasEl.removeEventListener('input', onInput);
      canvasEl.removeEventListener('keydown', onKeyDown);
    });
  }

  public destroy(): void {
    if (this.state === 'streaming') {
      this.cancel();
    }
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
  }

  /**
   * Evaluates editor content on each input event for '+++' trigger.
   */
  public handleInput(): void {
    if (this.state === 'streaming') return;

    const blockEl = this.getActiveBlockElement();
    if (!blockEl) return;

    const text = blockEl.textContent || '';
    const detection = detectContinuationTrigger(text);

    if (detection.triggered) {
      void this.triggerContinuation(blockEl, detection.strippedBuffer);
    }
  }

  /**
   * Handles keyboard shortcuts during streaming (Esc/Backspace to cancel, Tab/Enter to accept).
   */
  public handleKeyDown(e: KeyboardEvent): void {
    if (this.state !== 'streaming') return;

    // Esc or Backspace aborts streaming and erases ghost ink
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }

    // Tab or Enter immediately accepts and solidifies current ghost ink
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.accept();
      return;
    }
  }

  /**
   * Initiates continuation stream.
   */
  public async triggerContinuation(
    blockEl: HTMLElement,
    strippedText: string
  ): Promise<string | null> {
    this.setState('detecting');

    // 1. Clean strip '+++' from DOM
    blockEl.textContent = strippedText;
    this.editor.updateCaretPosition();

    // 2. Capture atomic history baseline
    this.baselineContent = this.editor.getContent();
    this.baselineCaret = this.editor.caretPosition.charOffset;
    this.activeBlockId = blockEl.dataset.blockId || this.editor.activeBlockId;
    this.accumulatedText = '';

    this.history.beginAtomicTransaction(
      'ai_continuation',
      this.baselineContent,
      this.baselineCaret
    );

    // 3. Mount ghost ink span
    const ownerDoc = blockEl.ownerDocument || document;
    const ghostSpan = ownerDoc.createElement('span');
    ghostSpan.className = 'ai-streaming-token';
    ghostSpan.dataset.ghost = 'true';
    ghostSpan.textContent = '';
    blockEl.appendChild(ghostSpan);
    this.activeGhostSpan = ghostSpan;

    // 4. Initialize abort controller
    this.abortController = new AbortController();
    this.setState('streaming');

    try {
      const fullText = await this.aiAdapter.streamCompletion(
        {
          documentText: this.baselineContent,
          cursorOffset: this.baselineCaret,
          signal: this.abortController.signal,
          maxTokens: this.options.maxTokens,
        },
        (chunk: string) => {
          if (this.state !== 'streaming') return;

          this.accumulatedText += chunk;
          ghostSpan.textContent = this.accumulatedText;

          // Position caret after newly received chunk
          this.setCaretAfter(ghostSpan);

          // Typewriter center-scrolling synchronization (592px lock)
          this.editor.updateCaretPosition();
          this.editor.recalculateCenterScroll(false);

          if (this.options.onChunk) {
            this.options.onChunk(chunk, this.accumulatedText);
          }
        }
      );

      // Natural stream completion
      if (this.state === 'streaming') {
        this.solidify();
        return fullText;
      }
      return null;
    } catch (err) {
      if (this.abortController?.signal.aborted || this.state === 'cancelled') {
        this.cleanupCancelledGhost(blockEl);
        return null;
      }
      this.cleanupErrorGhost(blockEl, err);
      return null;
    }
  }

  /**
   * Accepts and solidifies ghost ink into permanent prose.
   */
  public accept(): void {
    if (this.state !== 'streaming') return;
    this.abortController?.abort();
    this.solidify();
  }

  /**
   * Cancels continuation stream, erasing ghost ink without history pollution.
   */
  public cancel(): void {
    if (this.state !== 'streaming') return;

    this.setState('cancelled');
    this.abortController?.abort();

    const blockEl = this.getActiveBlockElement();
    if (blockEl) {
      this.cleanupCancelledGhost(blockEl);
    }

    this.history.abortAtomicTransaction();
    this.setState('idle');
  }

  /**
   * Solidifies ghost span to standard paragraph ink and commits atomic history.
   */
  private solidify(): void {
    this.setState('solidifying');

    const ghostSpan = this.activeGhostSpan;
    if (ghostSpan && ghostSpan.parentNode) {
      const parent = ghostSpan.parentNode;
      const ownerDoc = parent.ownerDocument || document;
      const solidNode = ownerDoc.createTextNode(ghostSpan.textContent || '');
      parent.replaceChild(solidNode, ghostSpan);
      parent.normalize(); // Merge text nodes

      // Position caret at end of solidified text
      this.setCaretAfter(solidNode);
    }

    this.activeGhostSpan = null;

    // Update editor caret & geometry
    this.editor.updateCaretPosition();
    this.editor.recalculateCenterScroll(false);

    // Commit single atomic transaction to history (F44)
    const finalContent = this.editor.getContent();
    const finalCaret = this.editor.caretPosition.charOffset;
    this.history.commitAtomicTransaction(finalContent, finalCaret);

    // Notify persistence & listeners
    if (this.editor.callbacks.onContentChange) {
      this.editor.callbacks.onContentChange(finalContent);
    }

    this.setState('idle');
  }

  private cleanupCancelledGhost(blockEl: HTMLElement): void {
    if (this.activeGhostSpan && this.activeGhostSpan.parentNode) {
      this.activeGhostSpan.parentNode.removeChild(this.activeGhostSpan);
    }
    this.activeGhostSpan = null;
    blockEl.normalize();

    this.setCaretAtEnd(blockEl);
    this.editor.updateCaretPosition();
    this.editor.recalculateCenterScroll(false);
  }

  private cleanupErrorGhost(blockEl: HTMLElement, err: any): void {
    console.warn('[InlineContinuation] AI service error during continuation:', err);
    this.setState('error');
    this.cleanupCancelledGhost(blockEl);
    this.history.abortAtomicTransaction();
    this.setState('idle');
  }

  public getActiveBlockElement(): HTMLElement | null {
    if (!this.editor.canvas) return null;
    return (
      (this.editor.canvas.querySelector(
        `[data-block-id="${this.editor.activeBlockId}"]`
      ) as HTMLElement) ||
      (this.editor.canvas.querySelector('.editor-paragraph') as HTMLElement)
    );
  }

  private setCaretAfter(node: Node): void {
    const doc = node.ownerDocument || document;
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!win || typeof win.getSelection !== 'function') return;

    const sel = win.getSelection();
    if (!sel) return;

    try {
      const range = doc.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // Ignore range error in non-standard DOM environments
    }
  }

  private setCaretAtEnd(el: HTMLElement): void {
    const doc = el.ownerDocument || document;
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!win || typeof win.getSelection !== 'function') return;

    const sel = win.getSelection();
    if (!sel) return;

    try {
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // Ignore range error in non-standard DOM environments
    }
  }

  private setState(state: ContinuationEngineState): void {
    this.state = state;
    if (this.options.onStateChange) {
      this.options.onStateChange(state);
    }
  }
}
