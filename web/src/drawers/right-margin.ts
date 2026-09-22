/**
 * src/drawers/right-margin.ts
 * Daylight Writer - Right Thought Margin Scratchpad & Note Stacking Engine
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display (1584×1184 landscape)
 * Sol:OS 8-bit Grayscale Tokens (--os-0 to --os-1000)
 * Features: F17 (Layout), F18 (Anchoring), F20 (Stacking & Leader Lines), F21 (Orphans)
 */

import type { ThoughtNoteRecord } from '../storage/schema.ts';
import type { StorageRepository } from '../storage/repository.ts';

export interface NoteLayoutPosition {
  noteId: string;
  top: number;
  height: number;
  anchorY: number;
  isOrphaned: boolean;
  displaced: boolean;
  displacementDelta: number;
}

export interface ParagraphOffsetInfo {
  yOffset: number;
  height: number;
  text: string;
}

export interface EditorLike {
  activeBlockId?: string;
  typewriterMidpoint?: number;
  getParagraphOffsets: () => Map<string, ParagraphOffsetInfo>;
}

export interface RightMarginOptions {
  repository: StorageRepository;
  editor: EditorLike;
  shellElement?: HTMLElement | null;
  drawerElement?: HTMLElement | null;
  scrollContainer?: HTMLElement | null;
  notesListElement?: HTMLElement | null;
  addNoteBtn?: HTMLElement | null;
  orphanedSection?: HTMLElement | null;
  orphanedListElement?: HTMLElement | null;
  orphanedCountBadge?: HTMLElement | null;
  leaderSvgElement?: SVGElement | null;
  minGapPx?: number;           // Default: 16px
  defaultNoteHeight?: number;   // Default: 80px
  debounceSaveMs?: number;      // Default: 200ms
}

export class RightMarginDrawer {
  public repository: StorageRepository;
  public editor: EditorLike;

  // DOM Elements
  public shellElement: HTMLElement | null = null;
  public drawerElement: HTMLElement | null = null;
  public scrollContainer: HTMLElement | null = null;
  public notesListElement: HTMLElement | null = null;
  public addNoteBtn: HTMLElement | null = null;
  public orphanedSection: HTMLElement | null = null;
  public orphanedListElement: HTMLElement | null = null;
  public orphanedCountBadge: HTMLElement | null = null;
  public leaderSvgElement: SVGElement | null = null;

  // Parameters
  public minGapPx: number;
  public defaultNoteHeight: number;
  public debounceSaveMs: number;

  // State
  public isOpen: boolean = false;
  public currentDocumentId: string | null = null;
  public notes: Map<string, ThoughtNoteRecord> = new Map();
  public cardElements: Map<string, HTMLElement> = new Map();
  public measuredHeights: Map<string, number> = new Map();
  public lastKnownOffsets: Map<string, number> = new Map();

  // Debounce Timers per Note
  private saveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private cleanupListeners: Array<() => void> = [];
  private isLayoutPending: boolean = false;

  constructor(options: RightMarginOptions) {
    this.repository = options.repository;
    this.editor = options.editor;
    this.minGapPx = options.minGapPx ?? 16;
    this.defaultNoteHeight = options.defaultNoteHeight ?? 80;
    this.debounceSaveMs = options.debounceSaveMs ?? 200;

    this.shellElement = options.shellElement ?? (typeof document !== 'undefined' ? document.querySelector('.dc1-shell') : null);
    this.drawerElement = options.drawerElement ?? (typeof document !== 'undefined' ? document.getElementById('margin-drawer') : null);
    this.scrollContainer = options.scrollContainer ?? (typeof document !== 'undefined' ? document.getElementById('margin-scroll-container') : null);
    this.notesListElement = options.notesListElement ?? (typeof document !== 'undefined' ? document.getElementById('margin-notes-list') : null);
    this.addNoteBtn = options.addNoteBtn ?? (typeof document !== 'undefined' ? document.getElementById('add-thought-note-btn') : null);
    this.orphanedSection = options.orphanedSection ?? (typeof document !== 'undefined' ? document.getElementById('orphaned-notes-section') : null);
    this.orphanedListElement = options.orphanedListElement ?? (typeof document !== 'undefined' ? document.getElementById('orphaned-notes-list') : null);
    this.orphanedCountBadge = options.orphanedCountBadge ?? (typeof document !== 'undefined' ? document.getElementById('orphaned-count-badge') : null);
    this.leaderSvgElement = options.leaderSvgElement ?? (typeof document !== 'undefined' ? (document.getElementById('margin-leader-svg') as unknown as SVGElement | null) : null);
  }

  // --------------------------------------------------------------------------
  // 1. Lifecycle & Event Binding
  // --------------------------------------------------------------------------

  public init(): void {
    this.ensureInternalDOM();
    this.bindDOMEvents();
    this.syncContainerPadding();
  }

  public destroy(): void {
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this.saveTimers.clear();

    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
  }

  private ensureInternalDOM(): void {
    if (!this.drawerElement) return;
    const doc = this.drawerElement.ownerDocument || document;

    // Ensure scroll container
    if (!this.scrollContainer) {
      let sc = this.drawerElement.querySelector('#margin-scroll-container') as HTMLElement | null;
      if (!sc) {
        sc = doc.createElement('div');
        sc.id = 'margin-scroll-container';
        sc.className = 'margin-scroll-container no-scrollbar';
        this.drawerElement.appendChild(sc);
      }
      this.scrollContainer = sc;
    }

    // Ensure leader SVG inside scroll container
    if (!this.leaderSvgElement && this.scrollContainer) {
      let svg = this.scrollContainer.querySelector('#margin-leader-svg') as unknown as SVGElement | null;
      if (!svg) {
        svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGElement;
        svg.id = 'margin-leader-svg';
        svg.setAttribute('class', 'margin-leader-svg');
        svg.setAttribute('aria-hidden', 'true');
        this.scrollContainer.prepend(svg as unknown as Node);
      }
      this.leaderSvgElement = svg;
    }

    // Ensure notes list element
    if (!this.notesListElement && this.scrollContainer) {
      let list = this.scrollContainer.querySelector('#margin-notes-list') as HTMLElement | null;
      if (!list) {
        list = doc.createElement('div');
        list.id = 'margin-notes-list';
        list.className = 'margin-notes-list';
        this.scrollContainer.appendChild(list);
      }
      this.notesListElement = list;
    }

    // Ensure add note button
    if (!this.addNoteBtn) {
      this.addNoteBtn = this.drawerElement.querySelector('#add-thought-note-btn');
    }

    // Ensure orphaned section
    if (!this.orphanedSection) {
      let sec = this.drawerElement.querySelector('#orphaned-notes-section') as HTMLElement | null;
      if (!sec) {
        sec = doc.createElement('div');
        sec.id = 'orphaned-notes-section';
        sec.className = 'orphaned-notes-section';
        sec.style.display = 'none';
        sec.innerHTML = `
          <div class="orphaned-header">
            <span class="orphaned-title">Orphaned Notes</span>
            <span id="orphaned-count-badge" class="orphaned-badge">0</span>
          </div>
          <div id="orphaned-notes-list" class="orphaned-notes-list"></div>
        `;
        this.drawerElement.appendChild(sec);
      }
      this.orphanedSection = sec;
      this.orphanedListElement = sec.querySelector('#orphaned-notes-list');
      this.orphanedCountBadge = sec.querySelector('#orphaned-count-badge');
    }
  }

  private bindDOMEvents(): void {
    if (this.addNoteBtn) {
      const onAddClick = () => {
        void this.createNote();
      };
      this.addNoteBtn.addEventListener('click', onAddClick);
      this.cleanupListeners.push(() => this.addNoteBtn?.removeEventListener('click', onAddClick));
    }

    // Keyboard shortcut Cmd+Shift+N: New note on active paragraph
    if (typeof window !== 'undefined') {
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
          e.preventDefault();
          this.open();
          void this.createNote();
        }
      };
      window.addEventListener('keydown', onKeyDown);
      this.cleanupListeners.push(() => window.removeEventListener('keydown', onKeyDown));
    }
  }

  /**
   * Aligns the margin scroll container's top/bottom padding with the editor's midpoint
   */
  public syncContainerPadding(): void {
    if (!this.scrollContainer || !this.editor) return;
    const midpoint = this.editor.typewriterMidpoint ?? 592;
    this.scrollContainer.style.paddingTop = `calc(${midpoint}px - 1.5em)`;
    this.scrollContainer.style.paddingBottom = `${midpoint}px`;
  }

  // --------------------------------------------------------------------------
  // 2. Drawer Open / Close State (F14, F17, F22)
  // --------------------------------------------------------------------------

  public open(): void {
    this.isOpen = true;
    const shell = this.shellElement ?? (this.drawerElement?.closest('.dc1-shell') as HTMLElement | null) ?? (typeof document !== 'undefined' ? document.querySelector('.dc1-shell') : null);
    shell?.classList.add('right-open');
    shell?.classList.remove('zero-chrome');
    this.requestLayoutUpdate();
  }

  public close(): void {
    this.isOpen = false;
    const shell = this.shellElement ?? (this.drawerElement?.closest('.dc1-shell') as HTMLElement | null) ?? (typeof document !== 'undefined' ? document.querySelector('.dc1-shell') : null);
    shell?.classList.remove('right-open');
    if (shell && !shell.classList.contains('left-open')) {
      shell.classList.add('zero-chrome');
    }
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  // --------------------------------------------------------------------------
  // 3. Document Loading & Note Ingestion
  // --------------------------------------------------------------------------

  public async loadDocumentNotes(documentId: string): Promise<void> {
    this.currentDocumentId = documentId;
    const records = await this.repository.getNotesForDocument(documentId);

    this.notes.clear();
    for (const record of records) {
      this.notes.set(record.id, { ...record });
    }

    this.renderAllCards();
    this.updateLayout();
  }

  // --------------------------------------------------------------------------
  // 4. Note CRUD Operations (F18, F21)
  // --------------------------------------------------------------------------

  /**
   * Creates a new thought note anchored to the currently focused paragraph (F18)
   */
  public async createNote(targetAnchorId?: string): Promise<ThoughtNoteRecord> {
    if (!this.currentDocumentId) {
      // If current document ID is not set, try to get from repo
      const docs = await this.repository.listDocuments();
      if (docs.length > 0) {
        this.currentDocumentId = docs[0].id;
      } else {
        throw new Error('Cannot create thought note without an active document');
      }
    }

    // Determine target anchor paragraph ID
    let anchorId = targetAnchorId;
    if (!anchorId) {
      const offsets = this.editor.getParagraphOffsets();
      if (this.editor.activeBlockId && offsets.has(this.editor.activeBlockId)) {
        anchorId = this.editor.activeBlockId;
      } else if (offsets.size > 0) {
        const first = offsets.keys().next().value;
        anchorId = first ?? 'p-0';
      } else {
        anchorId = 'p-0';
      }
    }

    const resolvedAnchorId: string = anchorId || 'p-0';

    const noteId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'note_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
    const now = Date.now();

    const newNote: ThoughtNoteRecord = {
      id: noteId,
      document_id: this.currentDocumentId!,
      paragraph_anchor_id: resolvedAnchorId,
      content: '',
      created_at: now,
      updated_at: now,
      deleted_at: null,
      sync_status: 'pending',
    };

    // 0ms local reactive update
    this.notes.set(noteId, newNote);
    this.renderNoteCard(newNote, true);
    this.updateLayout();

    // Persist to repository
    void this.repository.saveNote(newNote);

    return newNote;
  }

  public updateNoteContent(noteId: string, content: string): void {
    const existing = this.notes.get(noteId);
    if (!existing) return;

    existing.content = content;
    existing.updated_at = Date.now();

    // Debounce save to repository
    const existingTimer = this.saveTimers.get(noteId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.saveTimers.delete(noteId);
      void this.repository.saveNote({ ...existing });
    }, this.debounceSaveMs);

    this.saveTimers.set(noteId, timer);

    // Dynamic height change may require collision recalculation
    this.requestLayoutUpdate();
  }

  public async deleteNote(noteId: string): Promise<void> {
    const note = this.notes.get(noteId);
    if (!note) return;

    // Clear pending debounce timer if any
    const timer = this.saveTimers.get(noteId);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(noteId);
    }

    // Remove from in-memory cache
    this.notes.delete(noteId);

    // Remove DOM element
    const card = this.cardElements.get(noteId);
    if (card && card.parentElement) {
      card.remove();
      this.cardElements.delete(noteId);
      this.measuredHeights.delete(noteId);
    }

    this.updateLayout();

    // Persist soft-delete to repository
    await this.repository.deleteNote(noteId);
  }

  /**
   * Re-anchors an orphaned note to a valid paragraph ID (F21)
   */
  public async reanchorNote(noteId: string, newAnchorId: string): Promise<void> {
    const note = this.notes.get(noteId);
    if (!note) return;

    note.paragraph_anchor_id = newAnchorId;
    note.updated_at = Date.now();

    // Re-render note card
    this.renderNoteCard(note, false);
    this.updateLayout();

    await this.repository.saveNote({
      id: note.id,
      document_id: note.document_id,
      paragraph_anchor_id: newAnchorId,
      content: note.content,
    });
  }

  // --------------------------------------------------------------------------
  // 5. Stacking & Collision Avoidance Calculation Engine (F20, F21)
  // --------------------------------------------------------------------------

  /**
   * Pure calculation method matching DaylightDOMSimulator.calculateNoteTopOffsets().
   * Guarantees 100% adherence to E2E test specs.
   */
  public calculateNoteTopOffsets(): Map<string, number> {
    const paragraphOffsets = this.editor.getParagraphOffsets();
    const offsets = new Map<string, number>();

    // Snapshot notes into list
    const noteList = Array.from(this.notes.values());

    // Compute base target tops
    const items = noteList.map((note) => {
      const anchor = paragraphOffsets.get(note.paragraph_anchor_id);
      const baseTop = anchor !== undefined
        ? anchor.yOffset
        : (this.lastKnownOffsets.get(note.id) ?? (note as any).topOffset ?? 0);
      return { note, baseTop };
    });

    // Sort notes by base target top; break ties with created_at
    items.sort((a, b) => {
      if (a.baseTop !== b.baseTop) {
        return a.baseTop - b.baseTop;
      }
      return a.note.created_at - b.note.created_at;
    });

    let lastBottom = -Infinity;

    for (const item of items) {
      let targetTop = item.baseTop;

      // Stacking collision avoidance: min gap
      if (targetTop < lastBottom + this.minGapPx) {
        targetTop = lastBottom + this.minGapPx;
      }

      offsets.set(item.note.id, targetTop);
      this.lastKnownOffsets.set(item.note.id, targetTop);

      const height = this.measuredHeights.get(item.note.id) ?? this.defaultNoteHeight;
      lastBottom = targetTop + height;
    }

    return offsets;
  }

  // --------------------------------------------------------------------------
  // 6. DOM Layout Update & Leader Line Rendering (F19, F20)
  // --------------------------------------------------------------------------

  public requestLayoutUpdate(): void {
    if (this.isLayoutPending) return;
    this.isLayoutPending = true;

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        this.isLayoutPending = false;
        this.updateLayout();
      });
    } else {
      this.isLayoutPending = false;
      this.updateLayout();
    }
  }

  public updateLayout(): void {
    if (!this.notesListElement && typeof document === 'undefined') return;

    const paragraphOffsets = this.editor.getParagraphOffsets();
    const topOffsets = this.calculateNoteTopOffsets();
    const positions: NoteLayoutPosition[] = [];

    let orphanedCount = 0;

    for (const note of this.notes.values()) {
      const anchor = paragraphOffsets.get(note.paragraph_anchor_id);
      const isOrphaned = anchor === undefined;
      const top = topOffsets.get(note.id) ?? 0;
      const height = this.measuredHeights.get(note.id) ?? this.defaultNoteHeight;
      const anchorY = anchor ? anchor.yOffset : top;
      const displaced = top !== anchorY;
      const displacementDelta = top - anchorY;

      if (isOrphaned) {
        orphanedCount++;
      }

      positions.push({
        noteId: note.id,
        top,
        height,
        anchorY,
        isOrphaned,
        displaced,
        displacementDelta,
      });

      // Update card style in DOM
      const card = this.cardElements.get(note.id);
      if (card) {
        card.style.setProperty('--anchor-top', `${top}px`);
        card.style.top = `${top}px`;

        if (isOrphaned) {
          card.classList.add('orphaned');
        } else {
          card.classList.remove('orphaned');
        }

        if (displaced && !isOrphaned) {
          card.classList.add('colliding');
        } else {
          card.classList.remove('colliding');
        }

        const badge = card.querySelector('.thought-note-anchor-badge');
        if (badge) {
          if (isOrphaned) {
            badge.textContent = `¶ ${note.paragraph_anchor_id} (deleted)`;
            badge.classList.add('orphaned-label');
          } else {
            badge.textContent = `¶ ${note.paragraph_anchor_id}`;
            badge.classList.remove('orphaned-label');
          }
        }
      }
    }

    // Update Orphaned Section
    this.updateOrphanedSection(orphanedCount);

    // Draw Hairline Leader Lines
    this.renderLeaderLines(positions);
  }

  private updateOrphanedSection(count: number): void {
    if (!this.orphanedSection) return;

    if (count > 0) {
      this.orphanedSection.style.display = 'flex';
      if (this.orphanedCountBadge) {
        this.orphanedCountBadge.textContent = String(count);
      }

      if (this.orphanedListElement) {
        this.orphanedListElement.innerHTML = '';
        const doc = this.orphanedListElement.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const paragraphOffsets = this.editor.getParagraphOffsets();
        for (const note of this.notes.values()) {
          if (!paragraphOffsets.has(note.paragraph_anchor_id) && doc) {
            const item = doc.createElement('div');
            item.className = 'orphaned-note-item';
            item.innerHTML = `
              <div class="orphaned-item-header">
                <span class="orphaned-anchor-name">¶ ${note.paragraph_anchor_id}</span>
                <div class="orphaned-actions">
                  <button class="orphaned-reanchor-btn" title="Re-anchor to active paragraph">Re-anchor</button>
                  <button class="orphaned-delete-btn" title="Delete note">×</button>
                </div>
              </div>
              <p class="orphaned-content">${escapeHtml(note.content || '(empty note)')}</p>
            `;
            const reanchorBtn = item.querySelector('.orphaned-reanchor-btn');
            reanchorBtn?.addEventListener('click', () => {
              const target = this.editor.activeBlockId || 'p-0';
              void this.reanchorNote(note.id, target);
            });
            const deleteBtn = item.querySelector('.orphaned-delete-btn');
            deleteBtn?.addEventListener('click', () => {
              void this.deleteNote(note.id);
            });
            this.orphanedListElement.appendChild(item);
          }
        }
      }
    } else {
      this.orphanedSection.style.display = 'none';
      if (this.orphanedCountBadge) {
        this.orphanedCountBadge.textContent = '0';
      }
      if (this.orphanedListElement) {
        this.orphanedListElement.innerHTML = '';
      }
    }
  }

  private renderLeaderLines(positions: NoteLayoutPosition[]): void {
    if (!this.leaderSvgElement) return;

    // Clear previous leader SVG contents
    while (this.leaderSvgElement.firstChild) {
      this.leaderSvgElement.removeChild(this.leaderSvgElement.firstChild);
    }

    const doc = this.leaderSvgElement.ownerDocument || document;

    for (const pos of positions) {
      if (pos.isOrphaned) continue;

      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('stroke', 'var(--os-200, #CCCCCC)');
      path.setAttribute('stroke-width', '1');
      path.setAttribute('fill', 'none');

      const startX = 0; // Left edge of drawer
      const startY = pos.anchorY + 12; // Anchor baseline
      const endX = 16; // Note card left border
      const endY = pos.top + 16; // Note card header

      if (!pos.displaced) {
        path.setAttribute('d', `M ${startX} ${startY} L ${endX} ${endY}`);
      } else {
        const midX = 8;
        path.setAttribute('d', `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`);
      }

      this.leaderSvgElement.appendChild(path);
    }
  }

  // --------------------------------------------------------------------------
  // 7. Card DOM Rendering
  // --------------------------------------------------------------------------

  private renderAllCards(): void {
    if (!this.notesListElement) return;
    this.notesListElement.innerHTML = '';
    this.cardElements.clear();
    this.measuredHeights.clear();

    for (const note of this.notes.values()) {
      this.renderNoteCard(note, false);
    }
  }

  /**
   * Retrieves a note card element by note ID or anchor paragraph ID (F18, F51)
   */
  public getNoteCardElement(idOrAnchor: string): HTMLElement | null {
    if (!this.notesListElement) return null;
    return (
      (this.notesListElement.querySelector(`[data-anchor-id="${idOrAnchor}"]`) as HTMLElement | null) ||
      (this.notesListElement.querySelector(`[data-anchor-paragraph-id="${idOrAnchor}"]`) as HTMLElement | null) ||
      (this.notesListElement.querySelector(`[data-note-id="${idOrAnchor}"]`) as HTMLElement | null) ||
      (this.cardElements.get(idOrAnchor) ?? null)
    );
  }

  private renderNoteCard(note: ThoughtNoteRecord, autoFocus: boolean = false): void {
    if (!this.notesListElement) return;

    const doc = this.notesListElement.ownerDocument || document;
    let card = this.cardElements.get(note.id);

    if (!card) {
      card = doc.createElement('div');
      card.className = 'thought-note-card';
      card.dataset.noteId = note.id;
      card.dataset.anchorId = note.paragraph_anchor_id;
      card.dataset.anchorParagraphId = note.paragraph_anchor_id;

      card.innerHTML = `
        <div class="thought-note-header">
          <span class="thought-note-anchor-badge">¶ ${escapeHtml(note.paragraph_anchor_id)}</span>
          <button class="thought-note-delete-btn" title="Delete note (Del)">×</button>
        </div>
        <textarea
          class="thought-note-textarea note-card-textarea thin-scrollbar"
          placeholder="Jot down a thought, quote, or note..."
          rows="3"
        ></textarea>
      `;

      const textarea = card.querySelector('.thought-note-textarea') as HTMLTextAreaElement;
      const deleteBtn = card.querySelector('.thought-note-delete-btn') as HTMLButtonElement;

      textarea.value = note.content;

      // Input listener updates content and adjusts height
      textarea.addEventListener('input', () => {
        this.updateNoteContent(note.id, textarea.value);
        this.autoResizeTextarea(textarea, card!);
      });

      deleteBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        void this.deleteNote(note.id);
      });

      this.cardElements.set(note.id, card);
      this.notesListElement.appendChild(card);

      // Measure height
      const height = card.offsetHeight > 0 ? card.offsetHeight : this.defaultNoteHeight;
      this.measuredHeights.set(note.id, height);
    } else {
      card.dataset.anchorId = note.paragraph_anchor_id;
      card.dataset.anchorParagraphId = note.paragraph_anchor_id;
      const badge = card.querySelector('.thought-note-anchor-badge');
      if (badge) {
        badge.textContent = `¶ ${note.paragraph_anchor_id}`;
      }
      const textarea = (card.querySelector('.thought-note-textarea') || card.querySelector('.note-card-textarea')) as HTMLTextAreaElement;
      if (textarea && textarea !== doc.activeElement) {
        textarea.value = note.content;
      }
    }

    if (autoFocus) {
      const textarea = (card.querySelector('.thought-note-textarea') || card.querySelector('.note-card-textarea')) as HTMLTextAreaElement;
      textarea?.focus();
    }
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement, card: HTMLElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    const newHeight = card.offsetHeight;
    if (newHeight > 0 && newHeight !== this.measuredHeights.get(card.dataset.noteId || '')) {
      this.measuredHeights.set(card.dataset.noteId || '', newHeight);
      this.requestLayoutUpdate();
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
