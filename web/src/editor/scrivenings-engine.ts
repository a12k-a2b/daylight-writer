/**
 * src/editor/scrivenings-engine.ts
 * Daylight Writer - Scrivener-Style Concatenated Writing Engine (Steven Johnson Workflow)
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 *
 * Capabilities:
 * - Macro-Concatenation ("Scrivenings Mode"): seamlessly merges multiple modular chunks into a unified canvas
 * - Sol:OS calibrated hairline dividers (--os-100) and section header pills (--os-50 / --os-300 / --os-800)
 * - Two-Way Block Attribution: accurately routes edits back to the specific child DocumentRecord in SQLite
 * - Micro-Focus Affordance: quick button to isolate any section back to single-document typewriter mode
 * - Pacing & Word Count: computes live per-section word counts and total composite manuscript metrics
 */

import type { DocumentRecord } from '../storage/schema.ts';

export interface ScriveningsCallbacks {
  onDocumentChange?: (documentId: string, content: string, wordCount: number) => void;
  onFocusSingleChunk?: (documentId: string) => void;
  onActiveSectionChange?: (documentId: string) => void;
}

export interface ScriveningsOptions {
  container: HTMLElement;
  callbacks?: ScriveningsCallbacks;
}

export class ScriveningsEngine {
  public container: HTMLElement;
  public documents: DocumentRecord[] = [];
  public activeDocumentId: string | null = null;
  public callbacks: ScriveningsCallbacks;
  private isConcatenated: boolean = false;

  constructor(options: ScriveningsOptions) {
    this.container = options.container;
    this.callbacks = options.callbacks || {};
  }

  /**
   * Returns whether editor is currently in concatenated Scrivenings mode
   */
  public getIsConcatenated(): boolean {
    return this.isConcatenated;
  }

  /**
   * Loads an array of documents in concatenated Scrivenings mode
   */
  public loadConcatenatedDocuments(docs: DocumentRecord[], initialActiveId?: string): void {
    this.documents = docs.map(d => ({ ...d }));
    this.isConcatenated = docs.length > 1;
    this.activeDocumentId = initialActiveId || (docs[0]?.id ?? null);
    this.renderConcatenatedView();
  }

  /**
   * Renders the composite DOM hierarchy with Sol:OS dividers
   */
  public renderConcatenatedView(): void {
    const doc = this.container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    this.container.innerHTML = '';

    if (this.documents.length === 0) {
      const p = doc.createElement('p');
      p.className = 'editor-paragraph';
      p.dataset.blockId = 'p-0';
      p.innerHTML = '<br />';
      this.container.appendChild(p);
      return;
    }

    let globalBlockIndex = 0;

    for (let i = 0; i < this.documents.length; i++) {
      const docItem = this.documents[i];
      const isFirst = i === 0;

      // 1. Divider between sections (omitted before the first section)
      if (!isFirst) {
        const dividerEl = doc.createElement('div');
        dividerEl.className = 'scrivenings-divider';
        dividerEl.setAttribute('contenteditable', 'false');
        dividerEl.dataset.dividerAfterDocId = this.documents[i - 1].id;
        dividerEl.dataset.dividerBeforeDocId = docItem.id;
        dividerEl.innerHTML = `
          <div class="scrivenings-divider-line"></div>
          <div class="scrivenings-divider-glyph">§</div>
          <div class="scrivenings-divider-line"></div>
        `;
        this.container.appendChild(dividerEl);
      }

      // 2. Section Container
      const sectionEl = doc.createElement('section');
      sectionEl.className = 'scrivenings-section';
      sectionEl.dataset.sectionDocId = docItem.id;
      if (docItem.id === this.activeDocumentId) {
        sectionEl.classList.add('active-section');
      }

      // 3. Section Header Pill
      const headerEl = doc.createElement('header');
      headerEl.className = 'scrivenings-section-header';
      headerEl.setAttribute('contenteditable', 'false');

      const wordCount = this.countWords(docItem.content || '');
      const title = docItem.title && docItem.title.trim().length > 0 ? docItem.title : 'Untitled Section';

      headerEl.innerHTML = `
        <div class="scrivenings-header-pill">
          <span class="scrivenings-section-index">${i + 1}</span>
          <span class="scrivenings-section-title">${this.escapeHtml(title)}</span>
          <span class="scrivenings-section-count" data-doc-count-id="${docItem.id}">${wordCount} words</span>
        </div>
        <button class="scrivenings-focus-btn" data-focus-doc-id="${docItem.id}" title="Focus this section exclusively (Micro-Focus)">
          Isolate
        </button>
      `;

      // Single chunk focus button handler
      const focusBtn = headerEl.querySelector('.scrivenings-focus-btn');
      focusBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks.onFocusSingleChunk) {
          this.callbacks.onFocusSingleChunk(docItem.id);
        }
      });

      sectionEl.appendChild(headerEl);

      // 4. Section Body Paragraphs
      const bodyEl = doc.createElement('div');
      bodyEl.className = 'scrivenings-section-body';
      bodyEl.dataset.sectionDocId = docItem.id;

      const paragraphs = (docItem.content || '').split(/\n\n+/);
      if (paragraphs.length === 0 || (paragraphs.length === 1 && paragraphs[0].trim() === '')) {
        const p = doc.createElement('p');
        p.className = 'editor-paragraph';
        p.dataset.blockId = `p-${globalBlockIndex++}`;
        p.dataset.docId = docItem.id;
        p.innerHTML = '<br />';
        bodyEl.appendChild(p);
      } else {
        paragraphs.forEach((paraText) => {
          const p = doc.createElement('p');
          p.className = 'editor-paragraph';
          p.dataset.blockId = `p-${globalBlockIndex++}`;
          p.dataset.docId = docItem.id;
          p.textContent = paraText;
          bodyEl.appendChild(p);
        });
      }

      sectionEl.appendChild(bodyEl);
      this.container.appendChild(sectionEl);
    }
  }

  /**
   * Scans changed paragraphs in the container, attributes them to their respective
   * DocumentRecord, and triggers callbacks for modified documents.
   */
  public handleContentInput(): void {
    if (!this.isConcatenated) return;

    for (const docItem of this.documents) {
      const bodyEl = this.container.querySelector(`.scrivenings-section-body[data-section-doc-id="${docItem.id}"]`);
      if (!bodyEl) continue;

      const paragraphs = Array.from(bodyEl.querySelectorAll('.editor-paragraph'));
      const newContent = paragraphs
        .map((p) => p.textContent || '')
        .join('\n\n');

      if (newContent !== docItem.content) {
        docItem.content = newContent;
        const newWordCount = this.countWords(newContent);

        // Update word count badge
        const badge = this.container.querySelector(`[data-doc-count-id="${docItem.id}"]`);
        if (badge) {
          badge.textContent = `${newWordCount} words`;
        }

        if (this.callbacks.onDocumentChange) {
          this.callbacks.onDocumentChange(docItem.id, newContent, newWordCount);
        }
      }
    }
  }

  /**
   * Identifies which document corresponds to a given DOM node
   */
  public getDocumentIdForNode(node: Node | null): string | null {
    if (!node) return null;
    let curr: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
    while (curr && curr !== this.container) {
      if (curr.dataset && curr.dataset.docId) {
        return curr.dataset.docId;
      }
      if (curr.dataset && curr.dataset.sectionDocId) {
        return curr.dataset.sectionDocId;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  /**
   * Sets the active section based on caret / selection
   */
  public setActiveSection(docId: string): void {
    if (this.activeDocumentId === docId) return;
    this.activeDocumentId = docId;

    const sections = this.container.querySelectorAll('.scrivenings-section');
    sections.forEach((sec) => {
      const el = sec as HTMLElement;
      if (el.dataset.sectionDocId === docId) {
        el.classList.add('active-section');
      } else {
        el.classList.remove('active-section');
      }
    });

    if (this.callbacks.onActiveSectionChange) {
      this.callbacks.onActiveSectionChange(docId);
    }
  }

  /**
   * Returns total word count across all concatenated documents
   */
  public getTotalWordCount(): number {
    return this.documents.reduce((sum, d) => sum + this.countWords(d.content || ''), 0);
  }

  /**
   * Returns manuscript metrics (word count and section count)
   */
  public getManuscriptMetrics(): { totalWordCount: number; sectionCount: number } {
    return {
      totalWordCount: this.getTotalWordCount(),
      sectionCount: this.documents.length,
    };
  }

  /**
   * Alias for handleContentInput
   */
  public handleInput(_node?: Node | null): void {
    this.handleContentInput();
  }

  /**
   * Retrieves content of a specific child document
   */
  public getDocumentContent(docId: string): string | null {
    const docItem = this.documents.find(d => d.id === docId);
    return docItem ? docItem.content : null;
  }

  /**
   * Utility for counting words
   */
  public countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
