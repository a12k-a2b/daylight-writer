/**
 * src/ui/export-dialog.ts
 * Daylight Writer - Sol:OS Grayscale Export & Share Modal Dialog
 * Features: F54-F60 (Export Dialog UI, Sol:OS Grayscale Tokens, Accessibility)
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display (1584x1184 landscape)
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';
import type { StorageRepository } from '../storage/repository.ts';
import type { ExportResult, ExportService } from '../export/export-service.ts';
import { ShareService, type ShareResult, type EmailComposeResult } from '../export/share-service.ts';

export type ExportFormatType = 'md' | 'txt' | 'docx' | 'pdf' | 'share' | 'email';

export interface ExportDialogOptions {
  exportService: ExportService;
  shareService?: ShareService;
  repository?: StorageRepository;
  shellElement?: HTMLElement | null;
  onExportSuccess?: (
    format: ExportFormatType,
    result: ExportResult | ShareResult | EmailComposeResult
  ) => void;
  onClose?: () => void;
}

export interface FormatTileConfig {
  id: ExportFormatType;
  label: string;
  ext: string;
  desc: string;
  glyph: string;
  hotkey: string;
  supportsFrontmatter: boolean;
  supportsNotes: boolean;
}

export const FORMAT_OPTIONS: FormatTileConfig[] = [
  {
    id: 'md',
    label: 'Markdown',
    ext: '.md',
    desc: 'CommonMark with YAML header',
    glyph: '📄',
    hotkey: '1',
    supportsFrontmatter: true,
    supportsNotes: true,
  },
  {
    id: 'txt',
    label: 'Plain Text',
    ext: '.txt',
    desc: 'Clean typography banner',
    glyph: '📝',
    hotkey: '2',
    supportsFrontmatter: false,
    supportsNotes: true,
  },
  {
    id: 'docx',
    label: 'Word Document',
    ext: '.docx',
    desc: 'OOXML format with notes',
    glyph: '📘',
    hotkey: '3',
    supportsFrontmatter: false,
    supportsNotes: true,
  },
  {
    id: 'pdf',
    label: 'PDF Document',
    ext: '.pdf',
    desc: 'Vector printable manuscript',
    glyph: '📑',
    hotkey: '4',
    supportsFrontmatter: false,
    supportsNotes: true,
  },
  {
    id: 'share',
    label: 'Web Share',
    ext: 'Sheet',
    desc: 'System native share sheet',
    glyph: '⇪',
    hotkey: '5',
    supportsFrontmatter: false,
    supportsNotes: false,
  },
  {
    id: 'email',
    label: 'Email Draft',
    ext: 'mailto:',
    desc: 'Compose draft via email app',
    glyph: '✉',
    hotkey: '6',
    supportsFrontmatter: false,
    supportsNotes: false,
  },
];

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class ExportDialog {
  public exportService: ExportService;
  public shareService: ShareService;
  public repository?: StorageRepository;
  public shellElement: HTMLElement;

  // DOM Elements
  public backdropEl: HTMLElement | null = null;
  public dialogEl: HTMLElement | null = null;
  public formatGridEl: HTMLElement | null = null;
  public frontmatterCheckbox: HTMLInputElement | null = null;
  public notesCheckbox: HTMLInputElement | null = null;
  public frontmatterRow: HTMLElement | null = null;
  public notesRow: HTMLElement | null = null;
  public primaryActionBtn: HTMLButtonElement | null = null;
  public cancelBtn: HTMLButtonElement | null = null;
  public statusIndicatorEl: HTMLElement | null = null;

  // State
  public isOpen: boolean = false;
  public currentDoc: DocumentRecord | null = null;
  public currentNotes: ThoughtNoteRecord[] = [];
  public currentTags: string[] = [];
  public selectedFormat: ExportFormatType = 'md';
  public includeFrontmatter: boolean = true;
  public includeNotes: boolean = true;
  public isExporting: boolean = false;

  private previousFocusedElement: HTMLElement | null = null;
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
  private options: ExportDialogOptions;

  constructor(optionsOrExportService: ExportDialogOptions | ExportService, repository?: StorageRepository) {
    if ('exportService' in optionsOrExportService) {
      this.options = optionsOrExportService;
      this.exportService = optionsOrExportService.exportService;
      this.shareService = optionsOrExportService.shareService || new ShareService();
      this.repository = optionsOrExportService.repository;
      this.shellElement =
        optionsOrExportService.shellElement ||
        (typeof document !== 'undefined'
          ? (document.querySelector('.dc1-shell') as HTMLElement) || document.body
          : (null as any));
    } else {
      this.options = { exportService: optionsOrExportService, repository };
      this.exportService = optionsOrExportService;
      this.shareService = new ShareService();
      this.repository = repository;
      this.shellElement =
        typeof document !== 'undefined'
          ? (document.querySelector('.dc1-shell') as HTMLElement) || document.body
          : (null as any);
    }
  }

  public init(): void {
    // Ready to be opened on demand
  }

  public destroy(): void {
    this.close();
  }

  /**
   * Opens the export dialog for a specified document.
   */
  public async open(
    doc: DocumentRecord,
    notesOrFormat?: ThoughtNoteRecord[] | ExportFormatType,
    tags?: string[],
    initialFormat: ExportFormatType = 'md'
  ): Promise<void> {
    if (this.isOpen) return;

    let notes: ThoughtNoteRecord[] | undefined;
    let format = initialFormat;
    if (typeof notesOrFormat === 'string') {
      format = notesOrFormat as ExportFormatType;
      notes = undefined;
    } else if (Array.isArray(notesOrFormat)) {
      notes = notesOrFormat;
    }

    this.currentDoc = doc;
    this.currentNotes = notes || [];
    this.currentTags = tags || [];
    this.selectedFormat = format;
    this.isExporting = false;

    // If notes not passed, query from repository
    if ((!notes || notes.length === 0) && this.repository && doc.id) {
      try {
        this.currentNotes = await this.repository.getNotesForDocument(doc.id);
      } catch {
        this.currentNotes = [];
      }
    }

    // If tags not passed, query from repository
    if ((!tags || tags.length === 0) && this.repository && doc.id) {
      try {
        this.currentTags = await this.repository.getDocumentTags(doc.id);
      } catch {
        this.currentTags = [];
      }
    }

    // Default note inclusion based on whether notes exist
    this.includeNotes = this.currentNotes.length > 0;
    this.includeFrontmatter = true;

    // Cache previously active element for focus restoration
    if (typeof document !== 'undefined') {
      this.previousFocusedElement = document.activeElement as HTMLElement | null;
    }

    this.buildDOM();
    this.bindEvents();
    this.updateUI();

    this.isOpen = true;
    if (this.primaryActionBtn) {
      this.primaryActionBtn.focus();
    }
  }

  /**
   * Closes the export dialog and restores focus.
   */
  public close(): void {
    if (!this.isOpen) return;

    if (this.keydownListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownListener, {
        capture: true,
      });
      this.keydownListener = null;
    }

    if (this.backdropEl && this.backdropEl.parentNode) {
      this.backdropEl.parentNode.removeChild(this.backdropEl);
    }

    this.backdropEl = null;
    this.dialogEl = null;
    this.isOpen = false;
    this.isExporting = false;

    // Restore focus to original element
    if (
      this.previousFocusedElement &&
      typeof this.previousFocusedElement.focus === 'function'
    ) {
      this.previousFocusedElement.focus();
      this.previousFocusedElement = null;
    }

    this.options.onClose?.();
  }

  /**
   * Sets the active export format and updates option toggles.
   */
  public setFormat(format: ExportFormatType): void {
    this.selectedFormat = format;
    this.updateUI();
  }

  /**
   * Executes the export or share workflow based on current dialog state.
   */
  public async executeExport(): Promise<void> {
    if (!this.currentDoc || this.isExporting) return;
    this.isExporting = true;
    this.updateUI();

    try {
      const activeNotes = this.includeNotes ? this.currentNotes : [];
      const activeTags = this.includeFrontmatter ? this.currentTags : [];

      let result: ExportResult | ShareResult | EmailComposeResult;

      switch (this.selectedFormat) {
        case 'md': {
          result = this.exportService.exportToMarkdown(
            this.currentDoc,
            activeNotes,
            activeTags,
            { includeFrontmatter: this.includeFrontmatter, includeThoughtNotes: this.includeNotes }
          );
          this.shareService.downloadFile(result as ExportResult);
          break;
        }

        case 'txt': {
          result = this.exportService.exportToPlainText(
            this.currentDoc,
            activeNotes,
            activeTags,
            { includeThoughtNotes: this.includeNotes }
          );
          this.shareService.downloadFile(result as ExportResult);
          break;
        }

        case 'docx': {
          result = await this.exportService.exportToDocx(
            this.currentDoc,
            activeNotes,
            activeTags,
            { includeThoughtNotes: this.includeNotes }
          );
          this.shareService.downloadFile(result as ExportResult);
          break;
        }

        case 'pdf': {
          result = await this.exportService.exportToPdf(
            this.currentDoc,
            activeNotes,
            activeTags,
            { includeThoughtNotes: this.includeNotes }
          );
          this.shareService.downloadFile(result as ExportResult);
          break;
        }

        case 'share': {
          const exportRes = this.exportService.exportToMarkdown(
            this.currentDoc,
            activeNotes,
            activeTags,
            { includeFrontmatter: this.includeFrontmatter, includeThoughtNotes: this.includeNotes }
          );
          result = await this.shareService.shareDocument({
            doc: this.currentDoc,
            notes: activeNotes,
            tags: activeTags,
            exportResult: exportRes,
          });
          break;
        }

        case 'email': {
          result = this.shareService.launchEmail(this.currentDoc);
          break;
        }
      }

      this.options.onExportSuccess?.(this.selectedFormat, result);
      this.close();
    } catch (err: any) {
      this.isExporting = false;
      if (this.statusIndicatorEl) {
        this.statusIndicatorEl.textContent = `Export failed: ${err?.message || 'Unknown error'}`;
        this.statusIndicatorEl.classList.add('error');
      }
      this.updateUI();
    }
  }

  /**
   * Builds the modal DOM structure.
   */
  private buildDOM(): void {
    const doc = this.shellElement?.ownerDocument || document;

    // 1. Backdrop
    const backdrop = doc.createElement('div');
    backdrop.className = 'export-modal-backdrop';
    backdrop.setAttribute('aria-hidden', 'false');

    // 2. Dialog Container
    const dialog = doc.createElement('div');
    dialog.className = 'export-dialog-card';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'export-dialog-title');

    // 3. Header
    const header = doc.createElement('div');
    header.className = 'export-dialog-header';
    header.innerHTML = `
      <div class="export-header-text">
        <h2 id="export-dialog-title" class="export-dialog-title">Export &amp; Share Manuscript</h2>
        <div class="export-dialog-subtitle">${escapeHtml(this.currentDoc?.title || 'Untitled Document')}</div>
      </div>
      <button class="export-close-btn" aria-label="Close export dialog">×</button>
    `;
    dialog.appendChild(header);

    // 4. Format Selection Grid
    const formatSection = doc.createElement('div');
    formatSection.className = 'export-format-section';
    formatSection.innerHTML = `<div class="export-section-label">Select Format</div>`;

    const grid = doc.createElement('div');
    grid.className = 'export-format-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Export formats');

    FORMAT_OPTIONS.forEach((opt) => {
      const tile = doc.createElement('div');
      tile.className = `export-format-tile ${opt.id === this.selectedFormat ? 'active' : ''}`;
      tile.setAttribute('role', 'radio');
      tile.setAttribute(
        'aria-checked',
        opt.id === this.selectedFormat ? 'true' : 'false'
      );
      tile.setAttribute('tabindex', '0');
      tile.dataset.format = opt.id;

      tile.innerHTML = `
        <div class="tile-glyph">${opt.glyph}</div>
        <div class="tile-body">
          <div class="tile-label">${opt.label} <span class="tile-ext">${opt.ext}</span></div>
          <div class="tile-desc">${opt.desc}</div>
        </div>
        <kbd class="tile-hotkey">${opt.hotkey}</kbd>
      `;

      tile.addEventListener('click', () => this.setFormat(opt.id));
      grid.appendChild(tile);
    });

    formatSection.appendChild(grid);
    dialog.appendChild(formatSection);

    // 5. Options Section (Frontmatter & Notes Toggles)
    const optionsSection = doc.createElement('div');
    optionsSection.className = 'export-options-section';
    optionsSection.innerHTML = `<div class="export-section-label">Options</div>`;

    // Frontmatter Toggle Row
    const fmRow = doc.createElement('label');
    fmRow.className = 'export-option-row';
    fmRow.innerHTML = `
      <input type="checkbox" id="toggle-frontmatter" class="export-checkbox" ${this.includeFrontmatter ? 'checked' : ''} />
      <div class="option-label-group">
        <span class="option-title">Include YAML Frontmatter</span>
        <span class="option-desc">Document title, timestamp metadata, and hierarchical tags</span>
      </div>
    `;
    const fmInput = fmRow.querySelector(
      '#toggle-frontmatter'
    ) as HTMLInputElement;
    fmInput.addEventListener('change', () => {
      this.includeFrontmatter = fmInput.checked;
    });
    optionsSection.appendChild(fmRow);

    // Thought Notes Toggle Row
    const notesRow = doc.createElement('label');
    notesRow.className = 'export-option-row';
    const noteCount = this.currentNotes.length;
    notesRow.innerHTML = `
      <input type="checkbox" id="toggle-notes" class="export-checkbox" ${this.includeNotes ? 'checked' : ''} ${noteCount === 0 ? 'disabled' : ''} />
      <div class="option-label-group">
        <span class="option-title">Include Thought Notes Appendix</span>
        <span class="option-desc">${noteCount > 0 ? `${noteCount} paragraph-anchored margin notes` : 'No attached thought notes'}</span>
      </div>
    `;
    const notesInput = notesRow.querySelector('#toggle-notes') as HTMLInputElement;
    notesInput.addEventListener('change', () => {
      this.includeNotes = notesInput.checked;
    });
    optionsSection.appendChild(notesRow);

    dialog.appendChild(optionsSection);

    // 6. Status / Progress indicator
    const statusEl = doc.createElement('div');
    statusEl.className = 'export-status-indicator';
    dialog.appendChild(statusEl);

    // 7. Footer Action Buttons
    const footer = doc.createElement('div');
    footer.className = 'export-dialog-footer';
    footer.innerHTML = `
      <div class="export-footer-hints">
        <span class="footer-hint"><kbd class="palette-kbd">1-6</kbd> Format</span>
        <span class="footer-hint"><kbd class="palette-kbd">↵</kbd> Export</span>
        <span class="footer-hint"><kbd class="palette-kbd">Esc</kbd> Cancel</span>
      </div>
      <div class="export-footer-buttons">
        <button id="btn-export-cancel" class="btn-export-secondary">Cancel</button>
        <button id="btn-export-confirm" class="btn-export-primary">Export Document</button>
      </div>
    `;
    dialog.appendChild(footer);

    backdrop.appendChild(dialog);
    if (this.shellElement) {
      this.shellElement.appendChild(backdrop);
    } else if (typeof document !== 'undefined') {
      document.body.appendChild(backdrop);
    }

    // Cache References
    this.backdropEl = backdrop;
    this.dialogEl = dialog;
    this.formatGridEl = grid;
    this.frontmatterCheckbox = fmInput;
    this.notesCheckbox = notesInput;
    this.frontmatterRow = fmRow;
    this.notesRow = notesRow;
    this.primaryActionBtn = footer.querySelector(
      '#btn-export-confirm'
    ) as HTMLButtonElement;
    this.cancelBtn = footer.querySelector(
      '#btn-export-cancel'
    ) as HTMLButtonElement;
    this.statusIndicatorEl = statusEl;
  }

  /**
   * Binds click and keyboard events.
   */
  private bindEvents(): void {
    if (!this.dialogEl || !this.backdropEl) return;

    // Backdrop click dismiss
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) {
        this.close();
      }
    });

    // Close button
    const closeBtn = this.dialogEl.querySelector('.export-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    // Cancel button
    this.cancelBtn?.addEventListener('click', () => this.close());

    // Confirm button
    this.primaryActionBtn?.addEventListener('click', () => {
      void this.executeExport();
    });

    // Global Keydown Handler
    this.keydownListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }

      if (e.key === 'Enter' && !this.isExporting) {
        e.preventDefault();
        e.stopPropagation();
        void this.executeExport();
        return;
      }

      // Numeric Hotkeys 1-6
      if (/^[1-6]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (FORMAT_OPTIONS[idx]) {
          e.preventDefault();
          this.setFormat(FORMAT_OPTIONS[idx].id);
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.keydownListener, {
        capture: true,
      });
    }
  }

  /**
   * Re-synchronizes UI classes and button text based on state.
   */
  private updateUI(): void {
    if (!this.dialogEl) return;

    // Update active tiles in grid
    const tiles = this.dialogEl.querySelectorAll('.export-format-tile');
    tiles.forEach((tile) => {
      const el = tile as HTMLElement;
      const isSelected = el.dataset.format === this.selectedFormat;
      el.classList.toggle('active', isSelected);
      el.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    const currentConfig = FORMAT_OPTIONS.find(
      (f) => f.id === this.selectedFormat
    );

    // Frontmatter option visibility
    if (this.frontmatterRow) {
      const showFm = Boolean(currentConfig?.supportsFrontmatter);
      this.frontmatterRow.style.display = showFm ? 'flex' : 'none';
    }

    // Notes option visibility
    if (this.notesRow) {
      const showNotes = Boolean(currentConfig?.supportsNotes);
      this.notesRow.style.display = showNotes ? 'flex' : 'none';
    }

    // Update primary button label
    if (this.primaryActionBtn) {
      if (this.isExporting) {
        this.primaryActionBtn.textContent = 'Generating...';
        this.primaryActionBtn.disabled = true;
      } else {
        this.primaryActionBtn.disabled = false;
        switch (this.selectedFormat) {
          case 'share':
            this.primaryActionBtn.textContent = 'Open Share Sheet';
            break;
          case 'email':
            this.primaryActionBtn.textContent = 'Open Email App';
            break;
          default:
            this.primaryActionBtn.textContent = `Export ${currentConfig?.ext || 'File'}`;
            break;
        }
      }
    }
  }
}
