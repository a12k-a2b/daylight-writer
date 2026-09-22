/**
 * src/editor/history.ts
 * Daylight Writer - Undo/Redo History Transaction Manager
 * Supports typing burst debouncing (500ms), atomic AI continuations (Cmd+Z),
 * and exact caret restoration.
 */

export type TransactionType =
  | 'typing'
  | 'atomic'
  | 'ai_continuation'
  | 'markdown_format'
  | 'paste'
  | 'delete';

export interface HistorySnapshot {
  content: string;
  caretOffset: number;
  timestamp: number;
  type: TransactionType;
}

export interface HistoryOptions {
  maxStackSize?: number;
  typingBurstDebounceMs?: number;
  onStateChange?: (canUndo: boolean, canRedo: boolean) => void;
}

export class HistoryManager {
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private maxStackSize: number;
  private debounceMs: number;
  private lastTypingTimestamp: number = 0;
  private burstActive: boolean = false;
  private pendingAtomicSnapshot: HistorySnapshot | null = null;
  private onStateChange?: (canUndo: boolean, canRedo: boolean) => void;

  constructor(options: HistoryOptions = {}) {
    this.maxStackSize = options.maxStackSize ?? 200;
    this.debounceMs = options.typingBurstDebounceMs ?? 500;
    this.onStateChange = options.onStateChange;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.burstActive = false;
    this.pendingAtomicSnapshot = null;
    this.notify();
  }

  /**
   * Pushes a typing state with 500ms burst debouncing.
   * Continuous typing within 500ms groups into a single undo step.
   */
  public recordTyping(content: string, caretOffset: number): void {
    const now = Date.now();

    if (!this.burstActive || now - this.lastTypingTimestamp > this.debounceMs) {
      // Start a new typing burst transaction
      this.pushSnapshot({
        content,
        caretOffset,
        timestamp: now,
        type: 'typing',
      });
      this.burstActive = true;
    }

    this.lastTypingTimestamp = now;
  }

  /**
   * Closes the active typing burst (e.g. on Enter key, word deletion, or blur).
   */
  public commitBurst(): void {
    this.burstActive = false;
  }

  /**
   * Begins an atomic transaction (e.g. for AI streaming continuation or Cmd+K transform).
   * Freezes the baseline state before changes are injected.
   */
  public beginAtomicTransaction(type: TransactionType, currentContent: string, caretOffset: number): void {
    this.commitBurst();
    this.pendingAtomicSnapshot = {
      content: currentContent,
      caretOffset,
      timestamp: Date.now(),
      type,
    };
  }

  /**
   * Commits the atomic transaction upon completion of streaming or transform.
   * Enables single-step Cmd+Z reversion of the entire operation (F44).
   */
  public commitAtomicTransaction(finalContent: string, _finalCaretOffset: number): void {
    if (!this.pendingAtomicSnapshot) return;

    // Only record if content actually changed
    if (this.pendingAtomicSnapshot.content !== finalContent) {
      this.pushSnapshot(this.pendingAtomicSnapshot);
    }

    this.pendingAtomicSnapshot = null;
  }

  /**
   * Cancels a pending atomic transaction without pushing to history.
   */
  public abortAtomicTransaction(): void {
    this.pendingAtomicSnapshot = null;
  }

  /**
   * Executes Undo (Cmd+Z). Returns previous snapshot state or null.
   */
  public undo(currentContent: string, currentCaretOffset: number): HistorySnapshot | null {
    this.commitBurst();
    if (this.undoStack.length === 0) return null;

    let previous = this.undoStack.pop()!;

    if (previous.content === currentContent) {
      if (this.undoStack.length > 0) {
        this.redoStack.push({
          content: currentContent,
          caretOffset: currentCaretOffset,
          timestamp: Date.now(),
          type: previous.type,
        });
        previous = this.undoStack.pop()!;
      } else {
        this.undoStack.push(previous);
        return null;
      }
    } else {
      this.redoStack.push({
        content: currentContent,
        caretOffset: currentCaretOffset,
        timestamp: Date.now(),
        type: previous.type,
      });
    }

    if (this.redoStack.length > this.maxStackSize) {
      this.redoStack.shift();
    }

    this.notify();
    return previous;
  }

  /**
   * Executes Redo (Cmd+Shift+Z / Cmd+Y). Returns next snapshot state or null.
   */
  public redo(currentContent: string, currentCaretOffset: number): HistorySnapshot | null {
    this.commitBurst();
    if (this.redoStack.length === 0) return null;

    const next = this.redoStack.pop()!;

    // Push current state back onto undo stack
    this.undoStack.push({
      content: currentContent,
      caretOffset: currentCaretOffset,
      timestamp: Date.now(),
      type: next.type,
    });

    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }

    this.notify();
    return next;
  }

  /**
   * Attaches keyboard shortcut listeners (Cmd+Z, Cmd+Shift+Z, Cmd+Y) to a DOM target.
   */
  public bindKeyboardShortcuts(
    targetEl: HTMLElement,
    callbacks: {
      getContent: () => string;
      getCaret: () => number;
      restoreState: (snapshot: HistorySnapshot) => void;
    }
  ): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      if (!isMetaOrCtrl) return;

      // Undo: Cmd+Z (without Shift)
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        const prev = this.undo(callbacks.getContent(), callbacks.getCaret());
        if (prev) {
          callbacks.restoreState(prev);
        }
        return;
      }

      // Redo: Cmd+Shift+Z or Cmd+Y
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault();
        const next = this.redo(callbacks.getContent(), callbacks.getCaret());
        if (next) {
          callbacks.restoreState(next);
        }
        return;
      }
    };

    targetEl.addEventListener('keydown', onKeyDown);
    return () => targetEl.removeEventListener('keydown', onKeyDown);
  }

  private pushSnapshot(snapshot: HistorySnapshot): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
    // Any new change clears redo history
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    if (this.onStateChange) {
      this.onStateChange(this.canUndo(), this.canRedo());
    }
  }
}
