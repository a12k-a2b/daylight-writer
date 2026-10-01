/**
 * src/ai/command-palette.ts
 * Daylight Writer - Floating Cmd+K Contextual Command Palette & Diff Preview
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display (1584x1184 landscape)
 * Sol:OS 8-bit Grayscale Tokens (--os-0 to --os-1000)
 * Features: F45 (Cmd+K Palette), F46 (Viewport Clamping), F47 (AI Text Transforms)
 */

import type { TypewriterEditor } from '../editor/editor.ts';
import type { HistoryManager } from '../editor/history.ts';
import type { StorageRepository } from '../storage/repository.ts';
import type { AIServiceAdapter, AITransformOptions } from './service-adapter.ts';

export interface SelectionAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height?: number;
}

export interface CapturedSelection {
  text: string;
  rect: SelectionAnchorRect;
  range: Range | null;
  blockId: string;
  startOffset: number;
  endOffset: number;
}

export interface QuickActionItem {
  id: string;
  label: string;
  description: string;
  instruction?: AITransformOptions['instruction'];
  glyph: string;
  shortcut?: string;
  category?: 'ai' | 'export';
  actionId?: string;
}

export interface DiffChunk {
  type: 'equal' | 'delete' | 'insert';
  text: string;
}

export interface CommandPaletteOptions {
  editor: TypewriterEditor;
  history: HistoryManager;
  aiAdapter: AIServiceAdapter;
  repository?: StorageRepository;
  shellElement?: HTMLElement | null;
  onApply?: (original: string, transformed: string) => void;
  onClose?: () => void;
  onExportAction?: (actionId: string) => Promise<void> | void;
}

export const BUILT_IN_ACTIONS: QuickActionItem[] = [
  { id: 'rewrite', label: 'Rewrite tone', description: 'Warmer, plainer, sharper', instruction: 'summarize', glyph: '↺', shortcut: '1' },
  { id: 'summarize', label: 'Summarize', description: 'In one line', instruction: 'summarize', glyph: '≡', shortcut: '2' },
  { id: 'expand', label: 'Expand thought', description: 'Add the next beat', instruction: 'expand', glyph: '⇤⇥', shortcut: '3' },
  { id: 'fix_grammar', label: 'Check passive voice', description: 'Flag passive voice & clean syntax', instruction: 'fix_grammar', glyph: '✓', shortcut: '4' },
  { id: 'concise', label: 'Fix flow', description: 'Smooth the handoff & tighten phrasing', instruction: 'concise', glyph: '⇥⇤', shortcut: '5' },
  { id: 'casual', label: 'Tone: Casual', description: 'Direct, conversational, and approachable', instruction: 'casual', glyph: '💬', shortcut: '6' },
  { id: 'analytical', label: 'Tone: Professional', description: 'Empirical precision and academic rigor', instruction: 'analytical', glyph: '§', shortcut: '7' },
  { id: 'poetic', label: 'Tone: Literary', description: 'Lyrical imagery and evocative rhythm', instruction: 'poetic', glyph: '✦', shortcut: '8' },
];

export const EXPORT_COMMANDS: QuickActionItem[] = [
  { id: 'export_dialog', category: 'export', label: 'Export Document...', description: 'Open format & share selection dialog', glyph: '⎋', shortcut: 'E', actionId: 'export_dialog' },
  { id: 'export_md', category: 'export', label: 'Export as Markdown (.md)', description: 'Download CommonMark with frontmatter', glyph: '📄', shortcut: 'M', actionId: 'export_md' },
  { id: 'export_docx', category: 'export', label: 'Export as Word (.docx)', description: 'Download Microsoft Word OOXML package', glyph: '📝', shortcut: 'W', actionId: 'export_docx' },
  { id: 'export_pdf', category: 'export', label: 'Export as PDF (.pdf)', description: 'Open print stylesheet / vector PDF', glyph: '📑', shortcut: 'P', actionId: 'export_pdf' },
  { id: 'share_native', category: 'export', label: 'Share Document...', description: 'Trigger host OS Web Share Sheet', glyph: '⇪', shortcut: 'S', actionId: 'share_native' },
  { id: 'compose_email', category: 'export', label: 'Compose Email (mailto:)', description: 'Draft new email with manuscript text', glyph: '✉', shortcut: '@', actionId: 'compose_email' },
];

export class CommandPalette {
  public editor: TypewriterEditor;
  public history: HistoryManager;
  public aiAdapter: AIServiceAdapter;
  public repository?: StorageRepository;
  public shellElement: HTMLElement | null = null;
  public options: CommandPaletteOptions;

  // DOM Elements
  public paletteEl: HTMLElement | null = null;
  public inputEl: HTMLInputElement | null = null;
  public actionListEl: HTMLElement | null = null;
  public previewContainerEl: HTMLElement | null = null;
  public footerEl: HTMLElement | null = null;

  // State
  public isOpen: boolean = false;
  public mode: 'actions' | 'loading' | 'diff_preview' = 'actions';
  public capturedSelection: CapturedSelection | null = null;
  public activeActionIndex: number = 0;
  public filteredActions: QuickActionItem[] = [...BUILT_IN_ACTIONS];
  public transformedResult: string = '';
  public diffChunks: DiffChunk[] = [];
  public errorMessage: string | null = null;

  // Viewport metrics (DC1: 1584x1184)
  public viewportWidth: number = 1584;
  public viewportHeight: number = 1184;
  public paletteWidth: number = 320;
  public paletteHeight: number = 240;

  // Cleanup references
  private cleanupListeners: Array<() => void> = [];

  constructor(options: CommandPaletteOptions) {
    this.options = options;
    this.editor = options.editor;
    this.history = options.history;
    this.aiAdapter = options.aiAdapter;
    this.repository = options.repository;
    this.shellElement =
      options.shellElement ||
      (typeof document !== 'undefined'
        ? (document.querySelector('.dc1-shell') as HTMLElement) || document.body
        : null);
  }

  // --------------------------------------------------------------------------
  // 1. Initialization & Event Binding
  // --------------------------------------------------------------------------
  public init(): void {
    const win =
      this.shellElement?.ownerDocument?.defaultView ||
      (typeof window !== 'undefined' ? window : null);
    if (!win) return;

    // Listen for Cmd+K / Ctrl+K globally
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      if (isMetaOrCtrl && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
      }
    };

    win.addEventListener('keydown', onGlobalKeyDown as any, { capture: true });
    this.cleanupListeners.push(() =>
      win.removeEventListener('keydown', onGlobalKeyDown as any, { capture: true })
    );
  }

  public destroy(): void {
    this.close();
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
  }

  // --------------------------------------------------------------------------
  // 2. Open / Close Lifecycle (Esc Dismissal)
  // --------------------------------------------------------------------------
  public open(): void {
    if (this.isOpen) return;

    // 1. Capture selection or active paragraph
    const sel = this.captureSelection();
    this.capturedSelection = sel;

    // 2. Create palette DOM elements
    this.createPaletteDOM();

    // 3. Position and boundary clamp
    this.updatePosition();

    // 4. Reset state
    this.mode = 'actions';
    this.activeActionIndex = 0;
    this.filteredActions =
      sel && sel.text.trim().length > 0
        ? [...BUILT_IN_ACTIONS, ...EXPORT_COMMANDS]
        : [...EXPORT_COMMANDS];
    this.errorMessage = null;
    this.renderActionList();

    // 5. Mount to DOM
    if (this.shellElement && this.paletteEl) {
      this.shellElement.appendChild(this.paletteEl);
    }
    this.isOpen = true;

    // 6. Focus input immediately for 0ms typing lag
    setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  public close(): void {
    if (!this.isOpen) return;

    if (this.paletteEl && this.paletteEl.parentNode) {
      this.paletteEl.parentNode.removeChild(this.paletteEl);
    }
    this.paletteEl = null;
    this.inputEl = null;
    this.actionListEl = null;
    this.previewContainerEl = null;
    this.footerEl = null;
    this.isOpen = false;
    this.mode = 'actions';
    this.transformedResult = '';
    this.diffChunks = [];
    this.errorMessage = null;

    // Restore focus to editor canvas
    if (this.editor && this.editor.canvas) {
      this.editor.canvas.focus();
    }
  }

  // --------------------------------------------------------------------------
  // 3. Selection Capture & Viewport Clamping (F45, F46)
  // --------------------------------------------------------------------------
  public captureSelection(): CapturedSelection | null {
    const doc =
      this.editor?.canvas?.ownerDocument ||
      this.shellElement?.ownerDocument ||
      (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    const sel =
      doc.defaultView?.getSelection() ||
      (typeof window !== 'undefined' ? window.getSelection() : null);

    let text = '';
    let range: Range | null = null;
    let blockId = this.editor?.activeBlockId || 'p-0';
    let rect: SelectionAnchorRect = {
      left: 600,
      top: 400,
      right: 700,
      bottom: 430,
      width: 100,
      height: 30,
    };

    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      range = sel.getRangeAt(0).cloneRange();
      const rangeText = range.toString();
      if (rangeText.trim()) {
        text = rangeText;
        const domRect = range.getBoundingClientRect();
        if (domRect.width > 0 && domRect.height > 0) {
          rect = {
            left: domRect.left,
            top: domRect.top,
            right: domRect.right,
            bottom: domRect.bottom,
            width: domRect.width,
            height: domRect.height,
          };
        }
        // Determine containing blockId
        const containerEl = (
          range.startContainer.nodeType === 1
            ? range.startContainer
            : range.startContainer.parentElement
        ) as HTMLElement | null;
        const blockEl = containerEl?.closest('[data-block-id]') as HTMLElement | null;
        if (blockEl?.dataset.blockId) {
          blockId = blockEl.dataset.blockId;
        }
      }
    }

    if (!text && this.editor?.canvas) {
      // Fallback: active paragraph
      const blockEl = this.editor.canvas.querySelector(
        `[data-block-id="${blockId}"]`
      ) as HTMLElement | null;
      if (blockEl) {
        text = blockEl.textContent || '';
        const bRect = blockEl.getBoundingClientRect();
        if (bRect.width > 0 && bRect.height > 0) {
          rect = {
            left: bRect.left,
            top: bRect.top,
            right: bRect.right,
            bottom: bRect.bottom,
            width: bRect.width,
            height: bRect.height,
          };
        }
      }
    }

    return {
      text,
      rect,
      range,
      blockId,
      startOffset: 0,
      endOffset: text.length,
    };
  }

  public calculatePalettePosition(
    selectionRect: SelectionAnchorRect,
    paletteWidth: number = this.paletteWidth,
    paletteHeight: number = this.paletteHeight
  ): { left: number; top: number; flipped: boolean } {
    const vWidth = this.viewportWidth;
    const vHeight = this.viewportHeight;

    // Center horizontally on selection
    let left = selectionRect.left + selectionRect.width / 2 - paletteWidth / 2;

    // Boundary clamp X with 16px safety margins
    left = Math.max(16, Math.min(left, vWidth - paletteWidth - 16));

    // Default: 8px below selection
    let top = selectionRect.bottom + 8;
    let flipped = false;

    // Flip if overflowing bottom (vHeight - 24px safety buffer)
    if (top + paletteHeight > vHeight - 24) {
      top = selectionRect.top - paletteHeight - 8;
      flipped = true;
    }

    // Viewport boundary clamp Y with 16px safety margins
    top = Math.max(16, Math.min(top, vHeight - paletteHeight - 16));

    return {
      left: Math.round(left),
      top: Math.round(top),
      flipped,
    };
  }

  public updatePosition(): void {
    if (!this.paletteEl || !this.capturedSelection) return;
    const currentHeight = this.mode === 'diff_preview' ? 320 : this.paletteHeight;
    const pos = this.calculatePalettePosition(
      this.capturedSelection.rect,
      this.paletteWidth,
      currentHeight
    );
    this.paletteEl.style.left = `${pos.left}px`;
    this.paletteEl.style.top = `${pos.top}px`;
    this.paletteEl.dataset.flipped = pos.flipped ? 'true' : 'false';
  }

  // --------------------------------------------------------------------------
  // 4. DOM Construction & Sol:OS Grayscale Styling
  // --------------------------------------------------------------------------
  private createPaletteDOM(): void {
    const doc = this.shellElement?.ownerDocument || document;
    const palette = doc.createElement('div');
    palette.className = 'command-palette';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-modal', 'true');
    palette.setAttribute('aria-label', 'AI Command Palette');

    // Header with search/custom prompt input
    const header = doc.createElement('div');
    header.className = 'command-palette-header';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'command-palette-input';
    input.placeholder = 'Transform text or ask custom instruction...';
    input.setAttribute('aria-autocomplete', 'list');

    input.addEventListener('input', () => this.handleFilterInput(input.value));
    input.addEventListener('keydown', (e) => this.handleInputKeyDown(e));

    header.appendChild(input);
    palette.appendChild(header);

    // Action list container
    const actionList = doc.createElement('div');
    actionList.className = 'command-palette-actions thin-scrollbar';
    palette.appendChild(actionList);

    // Preview / Diff container (initially hidden)
    const previewContainer = doc.createElement('div');
    previewContainer.className = 'command-palette-preview thin-scrollbar';
    previewContainer.style.display = 'none';
    palette.appendChild(previewContainer);

    // Footer with keyboard hint badges
    const footer = doc.createElement('div');
    footer.className = 'command-palette-footer';
    footer.innerHTML = `
      <div class="footer-hint"><kbd class="palette-kbd">↑↓</kbd> Navigate</div>
      <div class="footer-hint"><kbd class="palette-kbd">↵</kbd> Select</div>
      <div class="footer-hint"><kbd class="palette-kbd">Esc</kbd> Dismiss</div>
    `;
    palette.appendChild(footer);

    this.paletteEl = palette;
    this.inputEl = input;
    this.actionListEl = actionList;
    this.previewContainerEl = previewContainer;
    this.footerEl = footer;
  }

  // --------------------------------------------------------------------------
  // 5. Action Filtering & Keyboard Navigation
  // --------------------------------------------------------------------------
  private handleFilterInput(query: string): void {
    const q = query.trim().toLowerCase();
    const hasSelection = Boolean(
      this.capturedSelection && this.capturedSelection.text.trim().length > 0
    );
    const availableActions = hasSelection
      ? [...BUILT_IN_ACTIONS, ...EXPORT_COMMANDS]
      : [...EXPORT_COMMANDS];

    if (!q) {
      this.filteredActions = availableActions;
    } else {
      const allActions = [...BUILT_IN_ACTIONS, ...EXPORT_COMMANDS];
      this.filteredActions = allActions.filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          (a.instruction && a.instruction.toLowerCase().includes(q)) ||
          a.id.toLowerCase().includes(q)
      );
    }
    this.activeActionIndex = 0;
    this.renderActionList(query.trim());
  }

  private handleInputKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.mode === 'diff_preview') {
        this.cancelReplacement();
      } else {
        this.close();
      }
      return;
    }

    if (this.mode === 'diff_preview') {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.acceptReplacement();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = this.hasCustomOption()
        ? this.filteredActions.length
        : this.filteredActions.length - 1;
      if (this.activeActionIndex < max) {
        this.activeActionIndex++;
        this.renderActionList(this.inputEl?.value.trim());
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.activeActionIndex > 0) {
        this.activeActionIndex--;
        this.renderActionList(this.inputEl?.value.trim());
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const customQuery = this.inputEl?.value.trim() || '';
      if (this.activeActionIndex === this.filteredActions.length && customQuery) {
        void this.executeCustomInstruction(customQuery);
      } else if (this.filteredActions[this.activeActionIndex]) {
        void this.executeAction(this.filteredActions[this.activeActionIndex]);
      } else if (customQuery) {
        void this.executeCustomInstruction(customQuery);
      }
      return;
    }

    // Number hotkeys (1-8) when input is empty
    if (!this.inputEl?.value && /^[1-8]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      if (this.filteredActions[idx]) {
        e.preventDefault();
        void this.executeAction(this.filteredActions[idx]);
      }
    }
  }

  private hasCustomOption(): boolean {
    const q = this.inputEl?.value.trim() || '';
    return q.length > 0;
  }

  private renderActionList(customQuery: string = ''): void {
    if (!this.actionListEl) return;
    this.actionListEl.innerHTML = '';
    const doc = this.shellElement?.ownerDocument || document;

    this.filteredActions.forEach((action, idx) => {
      const item = doc.createElement('div');
      item.className = 'command-action-item';
      if (idx === this.activeActionIndex) {
        item.classList.add('active');
      }
      item.dataset.index = idx.toString();

      item.innerHTML = `
        <span class="action-glyph">${action.glyph}</span>
        <div class="action-details">
          <div class="action-label">${action.label}</div>
          <div class="action-desc">${action.description}</div>
        </div>
        ${action.shortcut ? `<span class="action-shortcut">${action.shortcut}</span>` : ''}
      `;

      item.addEventListener('click', () => void this.executeAction(action));
      this.actionListEl!.appendChild(item);
    });

    // Custom prompt fallback item
    if (customQuery) {
      const customIndex = this.filteredActions.length;
      const customItem = doc.createElement('div');
      customItem.className = 'command-action-item custom-action-item';
      if (customIndex === this.activeActionIndex) {
        customItem.classList.add('active');
      }
      customItem.dataset.index = customIndex.toString();
      customItem.innerHTML = `
        <span class="action-glyph">✎</span>
        <div class="action-details">
          <div class="action-label">Run Custom Prompt</div>
          <div class="action-desc">"${escapeHtml(customQuery)}"</div>
        </div>
        <span class="action-shortcut">↵</span>
      `;
      customItem.addEventListener('click', () => void this.executeCustomInstruction(customQuery));
      this.actionListEl.appendChild(customItem);
    }
  }

  // --------------------------------------------------------------------------
  // 6. Action Execution & Loading State
  // --------------------------------------------------------------------------
  public async executeAction(action: QuickActionItem): Promise<void> {
    if (action.category === 'export' || action.actionId) {
      this.close();
      if (this.options.onExportAction) {
        await this.options.onExportAction(action.actionId || action.id);
      }
      return;
    }
    if (!this.capturedSelection || !action.instruction) return;
    await this.runTransformation({
      selectedText: this.capturedSelection.text,
      instruction: action.instruction,
      surroundingContext: this.editor ? this.editor.getContent() : undefined,
    });
  }

  public async executeCustomInstruction(prompt: string): Promise<void> {
    if (!this.capturedSelection) return;
    await this.runTransformation({
      selectedText: this.capturedSelection.text,
      instruction: 'custom',
      customPrompt: prompt,
      surroundingContext: this.editor ? this.editor.getContent() : undefined,
    });
  }

  private async runTransformation(options: AITransformOptions): Promise<void> {
    this.mode = 'loading';
    this.renderLoadingState();

    try {
      const result = await this.aiAdapter.transformText(options);
      this.transformedResult = result;
      this.diffChunks = this.computeDiff(this.capturedSelection!.text, result);
      this.mode = 'diff_preview';
      this.renderDiffPreview();
      this.updatePosition();
    } catch (err: any) {
      this.mode = 'actions';
      this.errorMessage = err?.message || 'Transformation failed. Please try again.';
      this.renderActionList();
    }
  }

  private renderLoadingState(): void {
    if (!this.actionListEl) return;
    this.actionListEl.innerHTML = `
      <div class="palette-loading-state">
        <div class="loading-indicator-dot"></div>
        <div class="loading-label">Refining manuscript ink...</div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // 7. Token Diff Calculation (LCS Algorithm)
  // --------------------------------------------------------------------------
  public computeDiff(textA: string, textB: string): DiffChunk[] {
    const tokensA = textA.match(/\S+|\s+/g) || [];
    const tokensB = textB.match(/\S+|\s+/g) || [];

    const m = tokensA.length;
    const n = tokensB.length;

    // LCS dynamic programming table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (tokensA[i] === tokensB[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // Backtrack to extract insertions and deletions
    let i = m;
    let j = n;
    const rawChunks: DiffChunk[] = [];

    while (i > 0 && j > 0) {
      if (tokensA[i - 1] === tokensB[j - 1]) {
        rawChunks.push({ type: 'equal', text: tokensA[i - 1] });
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        rawChunks.push({ type: 'delete', text: tokensA[i - 1] });
        i--;
      } else {
        rawChunks.push({ type: 'insert', text: tokensB[j - 1] });
        j--;
      }
    }

    while (i > 0) {
      rawChunks.push({ type: 'delete', text: tokensA[i - 1] });
      i--;
    }

    while (j > 0) {
      rawChunks.push({ type: 'insert', text: tokensB[j - 1] });
      j--;
    }

    rawChunks.reverse();

    // Merge consecutive identical chunks
    const merged: DiffChunk[] = [];
    for (const chunk of rawChunks) {
      if (merged.length > 0 && merged[merged.length - 1].type === chunk.type) {
        merged[merged.length - 1].text += chunk.text;
      } else {
        merged.push({ ...chunk });
      }
    }

    return merged;
  }

  // --------------------------------------------------------------------------
  // 8. Diff Preview Rendering (Sol:OS Grayscale Styling)
  // --------------------------------------------------------------------------
  private renderDiffPreview(): void {
    if (!this.actionListEl || !this.previewContainerEl || !this.footerEl) return;
    const doc = this.shellElement?.ownerDocument || document;

    this.actionListEl.style.display = 'none';
    this.previewContainerEl.style.display = 'block';
    this.previewContainerEl.innerHTML = '';

    const diffHeader = doc.createElement('div');
    diffHeader.className = 'diff-preview-header';
    diffHeader.textContent = 'Proposed Transformation Preview:';
    this.previewContainerEl.appendChild(diffHeader);

    const diffBody = doc.createElement('div');
    diffBody.className = 'diff-preview-body';

    for (const chunk of this.diffChunks) {
      if (chunk.type === 'equal') {
        const span = doc.createElement('span');
        span.className = 'diff-equal';
        span.textContent = chunk.text;
        diffBody.appendChild(span);
      } else if (chunk.type === 'delete') {
        const del = doc.createElement('del');
        del.className = 'diff-delete';
        del.textContent = chunk.text;
        diffBody.appendChild(del);
      } else if (chunk.type === 'insert') {
        const ins = doc.createElement('ins');
        ins.className = 'diff-insert';
        ins.textContent = chunk.text;
        diffBody.appendChild(ins);
      }
    }

    this.previewContainerEl.appendChild(diffBody);

    // Update footer for Accept/Cancel actions
    this.footerEl.innerHTML = `
      <button class="palette-btn palette-btn-accept" id="btn-accept-diff">
        <kbd class="palette-kbd">↵</kbd> Accept Replacement
      </button>
      <button class="palette-btn palette-btn-cancel" id="btn-cancel-diff">
        <kbd class="palette-kbd">Esc</kbd> Cancel
      </button>
    `;

    this.footerEl
      .querySelector('#btn-accept-diff')
      ?.addEventListener('click', () => this.acceptReplacement());
    this.footerEl
      .querySelector('#btn-cancel-diff')
      ?.addEventListener('click', () => this.cancelReplacement());
  }

  // --------------------------------------------------------------------------
  // 9. Atomic Undo Commit & Rejection (F44)
  // --------------------------------------------------------------------------
  public acceptReplacement(): void {
    if (!this.capturedSelection || !this.transformedResult) {
      this.close();
      return;
    }

    const { blockId, range } = this.capturedSelection;
    const originalContent = this.editor ? this.editor.getContent() : '';
    const originalCaret = this.editor ? this.editor.caretPosition.charOffset : 0;
    const doc = this.editor?.canvas?.ownerDocument || this.shellElement?.ownerDocument || document;

    // 1. Begin atomic transaction in HistoryManager
    this.history.beginAtomicTransaction('atomic', originalContent, originalCaret);

    // 2. Apply transformation in DOM while preserving blockId
    if (range && !range.collapsed) {
      range.deleteContents();
      const textNode = doc.createTextNode(this.transformedResult);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
    } else if (this.editor?.canvas) {
      // Direct block mutation (preserves blockId so attached margin notes stay aligned)
      const blockEl = this.editor.canvas.querySelector(
        `[data-block-id="${blockId}"]`
      ) as HTMLElement | null;
      if (blockEl) {
        blockEl.textContent = this.transformedResult;
      }
    }

    // 3. Update editor geometry & notify listeners
    if (this.editor) {
      this.editor.updateCaretPosition();
      this.editor.recalculateCenterScroll(false);

      const newContent = this.editor.getContent();
      const newCaret = this.editor.caretPosition.charOffset;

      // 4. Commit atomic transaction (single-step Cmd+Z restores originalContent)
      this.history.commitAtomicTransaction(newContent, newCaret);

      // 5. Trigger auto-save and drawer updates
      if (this.editor.callbacks.onContentChange) {
        this.editor.callbacks.onContentChange(newContent);
      }
    }

    // 6. Dismiss palette
    this.close();
  }

  public cancelReplacement(): void {
    // Esc cancels transformation without any side-effects
    this.history.abortAtomicTransaction();
    this.close();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
