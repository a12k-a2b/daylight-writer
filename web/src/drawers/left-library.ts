/**
 * src/drawers/left-library.ts
 * Daylight Writer - Left Navigation & Library Drawer (F14, F15, F16, F22, F32)
 *
 * Capabilities:
 * - 320px sliding navigation drawer with Sol:OS 8-bit grayscale tokens
 * - Fluid 60Hz-120Hz GPU-accelerated slide animation (150ms cubic-bezier)
 * - Document library list with active document highlight (--os-150 / --os-800)
 * - Sort toggle: Last Modified (updated_at DESC) vs Date Created (created_at DESC)
 * - Instant sub-50ms fuzzy search with Sol:OS snippet match highlights (<mark class="os-search-highlight">)
 * - Expandable/collapsible nested tag tree browser (#project/drafts) using TagTree
 * - Frictionless + New Document creation flow with zero typing friction
 * - Single-keystroke zero-chrome dismissal (Esc, Cmd+[)
 */

import type {
  DocumentRecord,
  TagRecord,
  StorageRepository,
  OutlineTreeNode,
} from '../storage/repository.ts';
import {
  buildTagTree,
  isTagMatch,
  normalizeTagPath,
  type TagTreeNode,
  type SearchHit,
} from '../storage/search.ts';

export type SortField = 'updated_at' | 'created_at';
export type DrawerMode = 'outline' | 'library';

export interface LeftLibraryDrawerOptions {
  container: HTMLElement;                      // Container (#library-drawer)
  shellElement: HTMLElement;                   // Root shell (.dc1-shell)
  backdropElement?: HTMLElement | null;        // Backdrop (#drawer-backdrop)
  repository: StorageRepository;               // Reactive SQLite repository
  initialSortBy?: SortField;                   // Default: 'updated_at'
  initialViewMode?: DrawerMode;                // Default: 'library'
  onSelectDocument: (docId: string) => Promise<void> | void;
  onSelectScrivenings?: (childDocs: DocumentRecord[], folderId: string) => Promise<void> | void;
  onCreateDocument?: (doc: DocumentRecord) => Promise<void> | void;
  onDeleteDocument?: (docId: string) => Promise<void> | void;
  onExportDocument?: (doc: DocumentRecord) => Promise<void> | void;
}

export class LeftLibraryDrawer {
  public container: HTMLElement;
  public shell: HTMLElement;
  public backdrop: HTMLElement | null = null;
  public repository: StorageRepository;

  // State
  private isOpen: boolean = false;
  private activeDocumentId: string | null = null;
  private currentSortBy: SortField = 'updated_at';
  private currentViewMode: DrawerMode = 'library';
  private selectedTagPath: string | null = null;
  private searchQuery: string = '';
  private currentSearchId: number = 0;
  private totalLibraryDocCount: number = 0;
  private expandedTagPaths: Set<string> = new Set<string>();
  private expandedOutlineNodes: Set<string> = new Set<string>();
  private draggedDocId: string | null = null;
  private allDocuments: DocumentRecord[] = [];
  private tags: TagRecord[] = [];
  private docTagsMap: Map<string, string[]> = new Map<string, string[]>();

  // Cached DOM References
  public searchInput!: HTMLInputElement;
  public searchClearBtn!: HTMLButtonElement;
  public sortModifiedBtn!: HTMLButtonElement;
  public sortCreatedBtn!: HTMLButtonElement;
  public sortSegmentedControl!: HTMLElement;
  public newDocBtn!: HTMLButtonElement;
  public newChapterBtn!: HTMLButtonElement;
  public viewModeOutlineBtn!: HTMLButtonElement;
  public viewModeLibraryBtn!: HTMLButtonElement;
  public tagTreeContainer!: HTMLElement;
  public tagTreeSection!: HTMLElement;
  public outlineTreeContainer!: HTMLElement;
  public activeFilterBanner!: HTMLElement;
  public documentListContainer!: HTMLElement;
  public docCountIndicator!: HTMLElement;

  // Cleanup abort controller
  private abortController: AbortController | null = null;
  private options: LeftLibraryDrawerOptions;

  constructor(options: LeftLibraryDrawerOptions) {
    this.container = options.container;
    this.shell = options.shellElement;
    this.backdrop = options.backdropElement || null;
    this.repository = options.repository;
    this.currentSortBy = options.initialSortBy || 'updated_at';
    this.currentViewMode = options.initialViewMode || 'library';
    this.options = options;
  }

  /**
   * Initializes drawer DOM elements, binds event listeners, and loads initial state.
   */
  public async init(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 1. Build Internal Shell Structure if not fully populated
    this.ensureInternalDOM();

    // 2. Cache Internal Element References
    this.cacheDOMReferences();

    // 3. Bind Event Listeners
    this.bindEvents(signal);

    // 4. Apply initial view mode visibility
    this.applyViewModeVisibility();

    // 5. Initial Data Load & Render
    await this.refresh();
  }

  /**
   * Toggles drawer open/closed.
   */
  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Opens the left library drawer with fluid 150ms GPU slide animation.
   */
  public open(): void {
    this.isOpen = true;
    this.shell.classList.add('left-open');
    this.shell.classList.remove('zero-chrome');
    this.container.setAttribute('aria-hidden', 'false');

    // Focus search input after animation settles
    if (typeof setTimeout !== 'undefined') {
      setTimeout(() => {
        if (this.isOpen && this.searchInput) {
          this.searchInput.focus();
        }
      }, 150);
    }
  }

  /**
   * Closes the left library drawer, restoring zero-chrome canvas.
   */
  public close(): void {
    this.isOpen = false;
    this.shell.classList.remove('left-open');
    if (!this.shell.classList.contains('right-open')) {
      this.shell.classList.add('zero-chrome');
    }
    this.container.setAttribute('aria-hidden', 'true');
    if (this.searchInput && typeof this.searchInput.blur === 'function') {
      this.searchInput.blur();
    }
  }

  /**
   * Returns whether the left drawer is currently open.
   */
  public getIsOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Sets the currently active document ID and updates highlighting.
   */
  public setActiveDocumentId(docId: string): void {
    this.activeDocumentId = docId;
    this.updateActiveDocumentHighlight();
  }

  /**
   * Returns the currently active document ID.
   */
  public getActiveDocumentId(): string | null {
    return this.activeDocumentId;
  }

  /**
   * Fully re-queries documents and tags from repository and re-renders UI.
   */
  public async refresh(): Promise<void> {
    // 1. Fetch tags and all active library documents
    this.tags = await this.repository.getTags();
    const allLibraryDocs = await this.repository.listDocuments({
      sortBy: this.currentSortBy,
      sortOrder: 'desc',
    });
    this.totalLibraryDocCount = allLibraryDocs.length;

    // 2. Build complete Doc-to-Tags map across the entire library
    this.docTagsMap.clear();
    for (const doc of allLibraryDocs) {
      const docTags = await this.repository.getDocumentTags(doc.id);
      this.docTagsMap.set(doc.id, docTags);
    }

    // 3. Scope displayed documents by active tag filter if set
    if (this.selectedTagPath) {
      const targetTag = normalizeTagPath(this.selectedTagPath);
      this.allDocuments = allLibraryDocs.filter((doc) => {
        const docTags = this.docTagsMap.get(doc.id) || [];
        return docTags.some((t) => isTagMatch(t, targetTag));
      });
    } else {
      this.allDocuments = allLibraryDocs;
    }

    // 4. Render Views
    this.renderTagTree();
    this.renderActiveFilterBanner();

    if (this.searchQuery.trim().length > 0) {
      await this.executeSearch(this.searchQuery);
    } else {
      this.renderDocumentList(this.allDocuments);
    }

    await this.renderOutlineTree();
    this.applyViewModeVisibility();
    this.updateDocumentCount();
  }

  /**
   * Sets sorting criterion ('updated_at' | 'created_at').
   */
  public async setSortBy(sortBy: SortField): Promise<void> {
    if (this.currentSortBy === sortBy) return;
    this.currentSortBy = sortBy;

    // Update segmented button UI
    if (this.sortModifiedBtn && this.sortCreatedBtn) {
      this.sortModifiedBtn.classList.toggle('active', sortBy === 'updated_at');
      this.sortCreatedBtn.classList.toggle('active', sortBy === 'created_at');
    }

    await this.refresh();
  }

  /**
   * Returns currently active sort field.
   */
  public getSortBy(): SortField {
    return this.currentSortBy;
  }

  /**
   * Sets or clears the active tag filter.
   */
  public async filterByTag(tagPath: string | null): Promise<void> {
    this.selectedTagPath = tagPath ? normalizeTagPath(tagPath) : null;
    await this.refresh();
  }

  /**
   * Returns currently active tag filter path.
   */
  public getSelectedTagPath(): string | null {
    return this.selectedTagPath;
  }

  /**
   * Creates a new document, saves to repository, and switches to it immediately.
   */
  public async createNewDocument(): Promise<DocumentRecord> {
    const now = Date.now();
    const newDoc: DocumentRecord = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
      title: 'Untitled Document',
      content: '',
      created_at: now,
      updated_at: now,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'pending',
    };

    // If a tag is active, automatically apply it to the new document
    if (this.selectedTagPath) {
      await this.repository.setDocumentTags(newDoc.id, [this.selectedTagPath]);
    }

    await this.repository.saveDocument(newDoc);
    this.activeDocumentId = newDoc.id;

    if (this.options.onCreateDocument) {
      await this.options.onCreateDocument(newDoc);
    }

    await this.refresh();
    await this.options.onSelectDocument(newDoc.id);

    return newDoc;
  }

  /**
   * Ensures all internal DOM elements exist inside the container.
   */
  private ensureInternalDOM(): void {
    const doc = this.container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    // Check if container already has header
    let header = this.container.querySelector('.drawer-header') as HTMLElement | null;
    if (!header) {
      header = doc.createElement('div');
      header.className = 'drawer-header';
      this.container.appendChild(header);
    }

    // Title Row
    let titleRow = header.querySelector('.drawer-title-row') as HTMLElement | null;
    if (!titleRow) {
      titleRow = doc.createElement('div');
      titleRow.className = 'drawer-title-row';
      titleRow.innerHTML = `
        <div class="drawer-view-mode-switch" role="tablist">
          <button id="view-mode-outline" class="view-mode-tab ${this.currentViewMode === 'outline' ? 'active' : ''}" data-mode="outline" role="tab" aria-selected="${this.currentViewMode === 'outline'}">Outline</button>
          <button id="view-mode-library" class="view-mode-tab ${this.currentViewMode === 'library' ? 'active' : ''}" data-mode="library" role="tab" aria-selected="${this.currentViewMode === 'library'}">Library</button>
        </div>
        <div class="drawer-actions-group">
          <button id="btn-new-chapter" class="btn-new-chapter" title="New Chapter / Folder">+ Ch</button>
          <button id="btn-new-doc" class="btn-new-doc" title="New Document (Cmd+N)">+ Doc</button>
        </div>
        <span class="drawer-heading" hidden>Library</span>
      `;
      header.prepend(titleRow);
    } else {
      if (!titleRow.querySelector('#view-mode-outline')) {
        const switchEl = doc.createElement('div');
        switchEl.className = 'drawer-view-mode-switch';
        switchEl.setAttribute('role', 'tablist');
        switchEl.innerHTML = `
          <button id="view-mode-outline" class="view-mode-tab ${this.currentViewMode === 'outline' ? 'active' : ''}" data-mode="outline" role="tab" aria-selected="${this.currentViewMode === 'outline'}">Outline</button>
          <button id="view-mode-library" class="view-mode-tab ${this.currentViewMode === 'library' ? 'active' : ''}" data-mode="library" role="tab" aria-selected="${this.currentViewMode === 'library'}">Library</button>
        `;
        titleRow.prepend(switchEl);
      }
      if (!titleRow.querySelector('#btn-new-chapter')) {
        const docBtn = titleRow.querySelector('#btn-new-doc');
        const chBtn = doc.createElement('button');
        chBtn.id = 'btn-new-chapter';
        chBtn.className = 'btn-new-chapter';
        chBtn.title = 'New Chapter / Folder';
        chBtn.textContent = '+ Ch';
        if (docBtn) {
          titleRow.insertBefore(chBtn, docBtn);
        } else {
          titleRow.appendChild(chBtn);
        }
      }
    }

    // Search bar container
    let searchContainer = header.querySelector('.search-bar-container') as HTMLElement | null;
    if (!searchContainer) {
      searchContainer = doc.createElement('div');
      searchContainer.className = 'search-bar-container';
      searchContainer.innerHTML = `
        <input
          id="library-search-input"
          class="search-input"
          type="search"
          placeholder="Search docs, tags, notes... (/)"
          autocomplete="off"
          spellcheck="false"
        />
        <button id="search-clear-btn" class="search-clear-btn" title="Clear search" aria-label="Clear search" hidden>×</button>
      `;
      header.appendChild(searchContainer);
    } else {
      // Ensure clear button exists
      let clearBtn = searchContainer.querySelector('#search-clear-btn') as HTMLElement | null;
      if (!clearBtn) {
        clearBtn = doc.createElement('button');
        clearBtn.id = 'search-clear-btn';
        clearBtn.className = 'search-clear-btn';
        clearBtn.title = 'Clear search';
        clearBtn.setAttribute('aria-label', 'Clear search');
        clearBtn.hidden = true;
        clearBtn.textContent = '×';
        searchContainer.appendChild(clearBtn);
      }
    }

    // Sort Segmented Control
    let sortControl = header.querySelector('.sort-segmented-control') as HTMLElement | null;
    if (!sortControl) {
      sortControl = doc.createElement('div');
      sortControl.className = 'sort-segmented-control';
      sortControl.setAttribute('role', 'group');
      sortControl.setAttribute('aria-label', 'Sort documents');
      sortControl.innerHTML = `
        <button id="sort-modified" class="sort-btn active" data-sort="updated_at">Modified</button>
        <button id="sort-created" class="sort-btn" data-sort="created_at">Created</button>
      `;
      header.appendChild(sortControl);
    } else {
      // Ensure data-sort attributes
      const modBtn = sortControl.querySelector('#sort-modified');
      if (modBtn && !modBtn.getAttribute('data-sort')) {
        modBtn.setAttribute('data-sort', 'updated_at');
      }
      const crtBtn = sortControl.querySelector('#sort-created');
      if (crtBtn && !crtBtn.getAttribute('data-sort')) {
        crtBtn.setAttribute('data-sort', 'created_at');
      }
    }

    // Active Filter Banner
    let banner = this.container.querySelector('#active-filter-banner') as HTMLElement | null;
    if (!banner) {
      banner = doc.createElement('div');
      banner.id = 'active-filter-banner';
      banner.className = 'active-filter-banner';
      banner.hidden = true;
      // Insert after header
      if (header.nextSibling) {
        this.container.insertBefore(banner, header.nextSibling);
      } else {
        this.container.appendChild(banner);
      }
    }

    // Tag Tree Section
    let tagSection = this.container.querySelector('#tag-tree-section') as HTMLElement | null;
    let tagTreeContainer = this.container.querySelector('#tag-tree-container') as HTMLElement | null;
    if (!tagSection && !tagTreeContainer) {
      tagSection = doc.createElement('div');
      tagSection.id = 'tag-tree-section';
      tagSection.className = 'tag-tree-section';
      tagSection.innerHTML = `
        <div class="tag-tree-header">
          <span class="tag-tree-title">Tags</span>
        </div>
        <div id="tag-tree-container" class="tag-tree-container thin-scrollbar"></div>
      `;
      this.container.appendChild(tagSection);
    }

    // Document List Container
    let docList = this.container.querySelector('#document-list-container') as HTMLElement | null;
    if (!docList) {
      docList = doc.createElement('div');
      docList.id = 'document-list-container';
      docList.className = 'document-list-container thin-scrollbar';
      docList.setAttribute('role', 'list');
      this.container.appendChild(docList);
    }

    // Outline Tree Container (Scrivener Binder View)
    let outlineTree = this.container.querySelector('#outline-tree-container') as HTMLElement | null;
    if (!outlineTree) {
      outlineTree = doc.createElement('div');
      outlineTree.id = 'outline-tree-container';
      outlineTree.className = 'outline-tree-container thin-scrollbar';
      this.container.appendChild(outlineTree);
    }

    // Footer with count
    let footer = this.container.querySelector('.drawer-footer') as HTMLElement | null;
    if (!footer) {
      footer = doc.createElement('div');
      footer.className = 'drawer-footer';
      footer.innerHTML = `<span id="doc-count-indicator" class="doc-count-indicator">0 documents</span>`;
      this.container.appendChild(footer);
    }
  }

  /**
   * Caches references to DOM elements.
   */
  private cacheDOMReferences(): void {
    this.searchInput = this.container.querySelector('#library-search-input') as HTMLInputElement;
    this.searchClearBtn = this.container.querySelector('#search-clear-btn') as HTMLButtonElement;
    this.sortModifiedBtn = this.container.querySelector('#sort-modified') as HTMLButtonElement;
    this.sortCreatedBtn = this.container.querySelector('#sort-created') as HTMLButtonElement;
    this.sortSegmentedControl = this.container.querySelector('.sort-segmented-control') as HTMLElement;
    this.newDocBtn = this.container.querySelector('#btn-new-doc') as HTMLButtonElement;
    this.newChapterBtn = this.container.querySelector('#btn-new-chapter') as HTMLButtonElement;
    this.viewModeOutlineBtn = this.container.querySelector('#view-mode-outline') as HTMLButtonElement;
    this.viewModeLibraryBtn = this.container.querySelector('#view-mode-library') as HTMLButtonElement;
    this.tagTreeSection = (this.container.querySelector('#tag-tree-section') || this.container.querySelector('#tag-tree-container')) as HTMLElement;
    this.tagTreeContainer = this.container.querySelector('#tag-tree-container') as HTMLElement;
    this.outlineTreeContainer = this.container.querySelector('#outline-tree-container') as HTMLElement;
    this.activeFilterBanner = this.container.querySelector('#active-filter-banner') as HTMLElement;
    this.documentListContainer = this.container.querySelector('#document-list-container') as HTMLElement;
    this.docCountIndicator = this.container.querySelector('#doc-count-indicator') as HTMLElement;
  }

  /**
   * Binds UI event listeners.
   */
  private bindEvents(signal: AbortSignal): void {
    // Backdrop click: dismiss
    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => this.close(), { signal });
    }

    // View Mode Toggle
    this.viewModeOutlineBtn?.addEventListener('click', () => {
      void this.setViewMode('outline');
    }, { signal });

    this.viewModeLibraryBtn?.addEventListener('click', () => {
      void this.setViewMode('library');
    }, { signal });

    // New Document button
    this.newDocBtn?.addEventListener('click', () => {
      void this.createNewDocument();
    }, { signal });

    // New Chapter button
    this.newChapterBtn?.addEventListener('click', () => {
      void this.createNewChapter();
    }, { signal });

    // Sort Segmented Control
    this.sortModifiedBtn?.addEventListener('click', () => {
      void this.setSortBy('updated_at');
    }, { signal });

    this.sortCreatedBtn?.addEventListener('click', () => {
      void this.setSortBy('created_at');
    }, { signal });

    // Search Input: Instant reactive search
    this.searchInput?.addEventListener('input', () => {
      const val = this.searchInput.value;
      this.searchQuery = val;
      if (this.searchClearBtn) {
        this.searchClearBtn.hidden = val.trim().length === 0;
      }
      void this.executeSearch(val);
    }, { signal });

    // Search Clear Button
    this.searchClearBtn?.addEventListener('click', () => {
      this.searchInput.value = '';
      this.searchQuery = '';
      this.searchClearBtn.hidden = true;
      if (typeof this.searchInput.focus === 'function') {
        this.searchInput.focus();
      }
      void this.executeSearch('');
    }, { signal });

    // Search Input Keydown (Esc clears or dismisses)
    this.searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.searchInput.value.length > 0) {
          this.searchInput.value = '';
          this.searchQuery = '';
          this.searchClearBtn.hidden = true;
          void this.executeSearch('');
        } else {
          this.close();
        }
      }
    }, { signal });

    // Global Keydown: Cmd+[ toggle, Esc dismiss, / search focus
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e: KeyboardEvent) => {
        // Esc: Dismiss left drawer if open
        if (e.key === 'Escape') {
          if (this.isOpen) {
            this.close();
          }
          return;
        }

        // Cmd+[ : Toggle Left Drawer
        if ((e.metaKey || e.ctrlKey) && e.key === '[') {
          e.preventDefault();
          this.toggle();
          return;
        }

        // / : Focus Search Input when outside contenteditable/input
        if (e.key === '/' && !this.isTypingTarget(document.activeElement)) {
          e.preventDefault();
          if (!this.isOpen) {
            this.open();
          }
          this.searchInput?.focus();
          this.searchInput?.select();
          return;
        }

        // Cmd+N : New Document
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
          e.preventDefault();
          void this.createNewDocument();
          return;
        }
      }, { signal });
    }
  }

  private isTypingTarget(target: Element | null): boolean {
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || (target as HTMLElement).isContentEditable;
  }

  /**
   * Executes sub-50ms instant fuzzy search, scoped by active tag filter if set.
   * Employs monotonic request cancellation to prevent out-of-order keystroke race conditions.
   */
  public async executeSearch(query: string): Promise<void> {
    const searchId = ++this.currentSearchId;
    this.searchQuery = query;
    const q = query.trim();

    if (!q) {
      this.renderDocumentList(this.allDocuments);
      this.renderActiveFilterBanner();
      return;
    }

    let hits: SearchHit[] = await this.repository.searchDocuments(q);
    if (searchId !== this.currentSearchId) return;

    // Scope fuzzy search results by active tag filter (exact or prefix descendant match)
    if (this.selectedTagPath) {
      const targetTag = normalizeTagPath(this.selectedTagPath);
      const filteredHits: SearchHit[] = [];
      for (const hit of hits) {
        let docTags = this.docTagsMap.get(hit.document.id);
        if (!docTags) {
          docTags = await this.repository.getDocumentTags(hit.document.id);
          this.docTagsMap.set(hit.document.id, docTags);
        }
        if (docTags.some((t) => isTagMatch(t, targetTag))) {
          filteredHits.push(hit);
        }
      }
      hits = filteredHits;
    }

    if (searchId !== this.currentSearchId) return;

    this.renderSearchResults(hits);
    this.renderActiveFilterBanner();
  }

  /**
   * Renders the hierarchical nested tag tree with expandable nodes.
   */
  private renderTagTree(): void {
    if (!this.tagTreeContainer) return;
    this.tagTreeContainer.innerHTML = '';
    const doc = this.tagTreeContainer.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    // 1. "All Documents" root row
    const allRow = doc.createElement('div');
    allRow.className = `tag-tree-row root-item ${this.selectedTagPath === null ? 'active' : ''}`;
    allRow.innerHTML = `
      <span class="tag-toggle-spacer"></span>
      <span class="tag-icon">📁</span>
      <span class="tag-name">All Documents</span>
      <span class="tag-count">${this.totalLibraryDocCount}</span>
    `;
    allRow.addEventListener('click', () => {
      void this.filterByTag(null);
    });
    this.tagTreeContainer.appendChild(allRow);

    // 2. Build Tag Tree from records and active document tags
    const tree: TagTreeNode[] = buildTagTree(this.tags, this.docTagsMap);
    if (tree.length === 0) return;

    // 3. Render tree recursively
    for (const rootNode of tree) {
      this.renderTagNode(rootNode, 0, this.tagTreeContainer);
    }
  }

  /**
   * Recursively renders a TagTreeNode and its children.
   */
  private renderTagNode(node: TagTreeNode, depth: number, parentEl: HTMLElement): void {
    const doc = parentEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const hasChildren = node.children.length > 0;
    const isExpanded = this.expandedTagPaths.has(node.path);
    const isSelected = this.selectedTagPath === node.path;

    const nodeEl = doc.createElement('div');
    nodeEl.className = 'tag-tree-node';

    const rowEl = doc.createElement('div');
    rowEl.className = `tag-tree-row ${isSelected ? 'active' : ''}`;
    rowEl.style.paddingLeft = `${12 + depth * 14}px`;

    // Toggle button (▸ / ▾)
    const toggleBtn = doc.createElement('button');
    toggleBtn.className = 'tag-toggle-btn';
    if (hasChildren) {
      toggleBtn.textContent = isExpanded ? '▾' : '▸';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isExpanded) {
          this.expandedTagPaths.delete(node.path);
        } else {
          this.expandedTagPaths.add(node.path);
        }
        this.renderTagTree();
      });
    } else {
      toggleBtn.innerHTML = '&nbsp;';
      toggleBtn.style.visibility = 'hidden';
    }
    rowEl.appendChild(toggleBtn);

    // Tag Hash & Name
    const labelEl = doc.createElement('span');
    labelEl.className = 'tag-label-group';
    labelEl.innerHTML = `
      <span class="tag-hash">#</span>
      <span class="tag-name">${escapeHtml(node.name)}</span>
    `;
    rowEl.appendChild(labelEl);

    // Document Count Badge
    const countBadge = doc.createElement('span');
    countBadge.className = 'tag-count';
    countBadge.textContent = String(node.count);
    rowEl.appendChild(countBadge);

    // Row Click: Select/Deselect Tag
    rowEl.addEventListener('click', () => {
      const nextFilter = this.selectedTagPath === node.path ? null : node.path;
      void this.filterByTag(nextFilter);
    });

    nodeEl.appendChild(rowEl);

    // Children container if expanded
    if (hasChildren && isExpanded) {
      const childrenContainer = doc.createElement('div');
      childrenContainer.className = 'tag-tree-children';
      for (const child of node.children) {
        this.renderTagNode(child, depth + 1, childrenContainer);
      }
      nodeEl.appendChild(childrenContainer);
    }

    parentEl.appendChild(nodeEl);
  }

  /**
   * Renders the banner indicating active search or tag filter.
   */
  private renderActiveFilterBanner(): void {
    if (!this.activeFilterBanner) return;

    const hasTag = Boolean(this.selectedTagPath);
    const hasSearch = this.searchQuery.trim().length > 0;

    if (!hasTag && !hasSearch) {
      this.activeFilterBanner.hidden = true;
      this.activeFilterBanner.innerHTML = '';
      return;
    }

    this.activeFilterBanner.hidden = false;
    let label = '';
    if (hasTag && hasSearch) {
      label = `Tag: #${this.selectedTagPath} · Search: "${escapeHtml(this.searchQuery)}"`;
    } else if (hasTag) {
      label = `Filtered by #${this.selectedTagPath}`;
    } else {
      label = `Search: "${escapeHtml(this.searchQuery)}"`;
    }

    this.activeFilterBanner.innerHTML = `
      <span class="filter-text">${label}</span>
      <button class="clear-filter-btn" title="Clear filter" aria-label="Clear filter">×</button>
    `;

    const clearBtn = this.activeFilterBanner.querySelector('.clear-filter-btn');
    clearBtn?.addEventListener('click', () => {
      if (hasTag) this.selectedTagPath = null;
      if (hasSearch) {
        this.searchQuery = '';
        if (this.searchInput) this.searchInput.value = '';
        if (this.searchClearBtn) this.searchClearBtn.hidden = true;
      }
      void this.refresh();
    });
  }

  /**
   * Renders normal document list.
   */
  private renderDocumentList(docs: DocumentRecord[]): void {
    if (!this.documentListContainer) return;
    this.documentListContainer.innerHTML = '';

    if (docs.length === 0) {
      this.renderEmptyState('No documents found');
      return;
    }

    for (const doc of docs) {
      const card = this.createDocumentCard(doc);
      this.documentListContainer.appendChild(card);
    }

    this.updateActiveDocumentHighlight();
  }

  /**
   * Renders search hit cards with snippet match highlights.
   */
  private renderSearchResults(hits: SearchHit[]): void {
    if (!this.documentListContainer) return;
    this.documentListContainer.innerHTML = '';

    if (hits.length === 0) {
      this.renderEmptyState(`No matches for "${this.searchQuery}"`);
      return;
    }

    for (const hit of hits) {
      const firstSnippet = hit.matchHighlights.length > 0 ? hit.matchHighlights[0] : undefined;
      const card = this.createDocumentCard(hit.document, firstSnippet);
      this.documentListContainer.appendChild(card);
    }

    this.updateActiveDocumentHighlight();
  }

  /**
   * Factory for creating a Sol:OS document card DOM element.
   */
  private createDocumentCard(doc: DocumentRecord, highlightSnippet?: string): HTMLElement {
    const docOwner = this.container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const card = docOwner ? docOwner.createElement('article') : ({} as HTMLElement);
    card.className = 'document-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.dataset.id = doc.id;

    if (doc.id === this.activeDocumentId) {
      card.classList.add('active-doc');
    }

    const titleText = doc.title && doc.title.trim().length > 0 ? doc.title : 'Untitled Document';
    const dateText = this.formatRelativeDate(this.currentSortBy === 'created_at' ? doc.created_at : doc.updated_at);
    const snippetHtml = highlightSnippet
      ? sanitizeSnippetHtml(highlightSnippet)
      : escapeHtml(doc.content.slice(0, 75).replace(/\n+/g, ' '));

    const tags = this.docTagsMap.get(doc.id) || [];
    const tagsHtml = tags.slice(0, 3).map(t => `<span class="doc-tag-chip">#${escapeHtml(t)}</span>`).join('');

    const d = new Date(this.currentSortBy === 'created_at' ? doc.created_at : doc.updated_at);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const monthStr = months[d.getMonth()] || 'SEP';
    const dayName = days[d.getDay()] || 'MON';
    const dayNum = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const timeStr = `${hour12}:${minutes} ${ampm}`;

    card.innerHTML = `
      <div class="dayone-date-badge" aria-hidden="true">
        <span class="dayone-date-month">${monthStr} · ${dayName}</span>
        <span class="dayone-date-day">${dayNum}</span>
        <span class="dayone-date-time">${timeStr}</span>
      </div>
      <div class="doc-card-body">
        <div class="doc-card-header">
          <h3 class="doc-item-title">${escapeHtml(titleText)}</h3>
          <time class="doc-item-date">${dateText}</time>
        </div>
        <p class="doc-item-snippet">${snippetHtml}</p>
        <div class="doc-card-footer">
          <div class="doc-item-tags">${tagsHtml}</div>
          <div class="doc-card-actions">
            <button class="doc-action-export-btn" title="Export document" aria-label="Export document">Export</button>
            <span class="doc-sync-status doc-sync-${doc.sync_status || 'synced'}" title="${doc.sync_status || 'synced'}"></span>
          </div>
        </div>
      </div>
    `;

    // Export button handler
    const exportBtn = card.querySelector('.doc-action-export-btn');
    exportBtn?.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      if (this.options.onExportDocument) {
        void this.options.onExportDocument(doc);
      }
    });

    // Click handler: load document and close drawer
    card.addEventListener('click', () => {
      this.activeDocumentId = doc.id;
      this.updateActiveDocumentHighlight();
      void this.options.onSelectDocument(doc.id);
      this.close();
    });

    // Keyboard support: Enter / Space opens doc
    card.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        this.activeDocumentId = doc.id;
        this.updateActiveDocumentHighlight();
        void this.options.onSelectDocument(doc.id);
        this.close();
      }
    });

    return card;
  }

  /**
   * Updates `.active-doc` class across rendered cards and outline rows without DOM teardown.
   */
  private updateActiveDocumentHighlight(): void {
    if (this.documentListContainer) {
      const cards = this.documentListContainer.querySelectorAll('.document-card');
      cards.forEach((card) => {
        const el = card as HTMLElement;
        if (el.dataset.id === this.activeDocumentId) {
          el.classList.add('active-doc');
        } else {
          el.classList.remove('active-doc');
        }
      });
    }

    if (this.outlineTreeContainer) {
      const rows = this.outlineTreeContainer.querySelectorAll('.outline-row');
      rows.forEach((row) => {
        const el = row as HTMLElement;
        if (el.dataset.outlineId === this.activeDocumentId || el.dataset.id === this.activeDocumentId) {
          el.classList.add('active-doc');
        } else {
          el.classList.remove('active-doc');
        }
      });
    }
  }

  /**
   * Applies visibility toggles based on currentViewMode ('outline' vs 'library').
   */
  public applyViewModeVisibility(): void {
    const isOutline = this.currentViewMode === 'outline';

    if (this.viewModeOutlineBtn && this.viewModeLibraryBtn) {
      this.viewModeOutlineBtn.classList.toggle('active', isOutline);
      this.viewModeOutlineBtn.setAttribute('aria-selected', isOutline ? 'true' : 'false');
      this.viewModeLibraryBtn.classList.toggle('active', !isOutline);
      this.viewModeLibraryBtn.setAttribute('aria-selected', !isOutline ? 'true' : 'false');
    }

    if (this.outlineTreeContainer) {
      this.outlineTreeContainer.hidden = !isOutline;
    }
    if (this.tagTreeSection) {
      this.tagTreeSection.hidden = isOutline;
    }
    if (this.documentListContainer) {
      this.documentListContainer.hidden = isOutline;
    }
    if (this.sortSegmentedControl) {
      this.sortSegmentedControl.hidden = isOutline;
    }
    if (this.newChapterBtn) {
      this.newChapterBtn.hidden = !isOutline;
    }
  }

  /**
   * Switches view mode between Scrivener-style Outline (Binder) and flat Library.
   */
  public async setViewMode(mode: DrawerMode): Promise<void> {
    this.currentViewMode = mode;
    this.applyViewModeVisibility();
    if (mode === 'outline') {
      await this.renderOutlineTree();
    } else {
      await this.refresh();
    }
  }

  /**
   * Returns current view mode ('outline' | 'library').
   */
  public getViewMode(): DrawerMode {
    return this.currentViewMode;
  }

  /**
   * Renders the hierarchical Scrivener-style Outline tree.
   */
  public async renderOutlineTree(): Promise<void> {
    if (!this.outlineTreeContainer) return;
    this.outlineTreeContainer.innerHTML = '';
    const docOwner = this.container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!docOwner) return;

    let tree: OutlineTreeNode[] = [];
    if (this.repository.getOutlineTree) {
      tree = await this.repository.getOutlineTree();
    } else {
      tree = this.allDocuments.map(d => ({
        document: { ...d },
        children: [],
        depth: 0,
      }));
    }

    if (tree.length === 0) {
      const emptyEl = docOwner.createElement('div');
      emptyEl.className = 'outline-empty-state';
      emptyEl.innerHTML = `
        <div class="empty-icon">📁</div>
        <p class="empty-message">No chapters or sections yet. Click + Doc or + Ch to outline.</p>
      `;
      this.outlineTreeContainer.appendChild(emptyEl);
      return;
    }

    // Filter tree if search query is active
    const q = this.searchQuery.trim().toLowerCase();
    const filterNode = (node: OutlineTreeNode): OutlineTreeNode | null => {
      const titleMatch = (node.document.title || '').toLowerCase().includes(q);
      const contentMatch = (node.document.content || '').toLowerCase().includes(q);
      const filteredChildren: OutlineTreeNode[] = [];
      for (const child of node.children) {
        const matchingChild = filterNode(child);
        if (matchingChild) {
          filteredChildren.push(matchingChild);
        }
      }
      if (titleMatch || contentMatch || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
      return null;
    };

    const nodesToRender = q.length > 0
      ? tree.map(filterNode).filter((n): n is OutlineTreeNode => n !== null)
      : tree;

    if (nodesToRender.length === 0) {
      const emptyEl = docOwner.createElement('div');
      emptyEl.className = 'outline-empty-state';
      emptyEl.innerHTML = `
        <div class="empty-icon">✎</div>
        <p class="empty-message">No outline matches for "${escapeHtml(this.searchQuery)}"</p>
      `;
      this.outlineTreeContainer.appendChild(emptyEl);
      return;
    }

    for (const rootNode of nodesToRender) {
      this.renderOutlineNode(rootNode, 0, this.outlineTreeContainer);
    }

    this.updateActiveDocumentHighlight();
  }

  /**
   * Recursively renders an OutlineTreeNode with drag handle, chevron, word count, and Scrivenings trigger.
   */
  private renderOutlineNode(node: OutlineTreeNode, depth: number, parentEl: HTMLElement): void {
    const docOwner = parentEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!docOwner) return;

    const item = node.document;
    const isFolder = item.item_type === 'folder';
    const hasChildren = node.children.length > 0;

    // Default folders to expanded initially
    if (!this.expandedOutlineNodes.has(`init_${item.id}`) && isFolder) {
      this.expandedOutlineNodes.add(`init_${item.id}`);
      this.expandedOutlineNodes.add(item.id);
    }
    const isExpanded = this.expandedOutlineNodes.has(item.id);
    const isSelected = item.id === this.activeDocumentId;

    const nodeEl = docOwner.createElement('div');
    nodeEl.className = 'outline-tree-node';
    nodeEl.dataset.outlineId = item.id;

    const rowEl = docOwner.createElement('div');
    rowEl.className = `outline-row ${isSelected ? 'active-doc' : ''} ${isFolder ? 'is-folder' : 'is-document'}`;
    rowEl.dataset.outlineId = item.id;
    rowEl.setAttribute('draggable', 'true');
    rowEl.style.paddingLeft = `${8 + depth * 14}px`;

    // 1. Drag handle
    const dragHandle = docOwner.createElement('span');
    dragHandle.className = 'outline-drag-handle';
    dragHandle.textContent = '⋮⋮';
    dragHandle.title = 'Drag to reorder playlist';
    rowEl.appendChild(dragHandle);

    // 2. Toggle button (chevron)
    const toggleBtn = docOwner.createElement('button');
    toggleBtn.className = 'outline-toggle-btn';
    if (isFolder || hasChildren) {
      toggleBtn.textContent = isExpanded ? '▾' : '▸';
      toggleBtn.title = isExpanded ? 'Collapse' : 'Expand';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isExpanded) {
          this.expandedOutlineNodes.delete(item.id);
        } else {
          this.expandedOutlineNodes.add(item.id);
        }
        void this.renderOutlineTree();
      });
    } else {
      toggleBtn.innerHTML = '&nbsp;';
      toggleBtn.style.visibility = 'hidden';
    }
    rowEl.appendChild(toggleBtn);

    // 3. Icon
    const iconSpan = docOwner.createElement('span');
    iconSpan.className = 'outline-icon';
    iconSpan.textContent = isFolder ? '📁' : '📄';
    rowEl.appendChild(iconSpan);

    // 4. Label Group (Title + optional synopsis)
    const labelGroup = docOwner.createElement('div');
    labelGroup.className = 'outline-label-group';
    const titleText = item.title && item.title.trim().length > 0 ? item.title : (isFolder ? 'Untitled Chapter' : 'Untitled Section');
    const titleSpan = docOwner.createElement('span');
    titleSpan.className = 'outline-title';
    titleSpan.textContent = titleText;
    labelGroup.appendChild(titleSpan);

    if (item.synopsis && item.synopsis.trim().length > 0) {
      const synSpan = docOwner.createElement('span');
      synSpan.className = 'outline-synopsis-preview';
      synSpan.textContent = item.synopsis.trim();
      labelGroup.appendChild(synSpan);
    }
    rowEl.appendChild(labelGroup);

    // 5. Word Count Badge
    const wordCount = this.getNodeWordCount(node);
    const wordBadge = docOwner.createElement('span');
    wordBadge.className = 'outline-word-badge';
    wordBadge.textContent = `${wordCount.toLocaleString()}w`;
    rowEl.appendChild(wordBadge);

    // 5.5 Scrivener Status Label Chip
    const statusChip = docOwner.createElement('span');
    const statusType = isFolder ? 'draft' : 'revised';
    statusChip.className = `scrivener-status-chip status-${statusType}`;
    statusChip.textContent = isFolder ? 'DRAFT' : 'REVISED';
    rowEl.appendChild(statusChip);

    // 6. If folder: Concatenate (Scrivenings) button
    if (isFolder) {
      const scriveningsBtn = docOwner.createElement('button');
      scriveningsBtn.className = 'outline-scrivenings-trigger';
      scriveningsBtn.textContent = '§ Scrivenings';
      scriveningsBtn.title = 'Concatenate and edit entire chapter (Scrivenings Mode)';
      scriveningsBtn.dataset.folderId = item.id;
      scriveningsBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.openScriveningsForFolder(item.id);
      });
      rowEl.appendChild(scriveningsBtn);
    }

    // Row Click Action
    rowEl.addEventListener('click', async () => {
      if (isFolder) {
        if (isExpanded) {
          this.expandedOutlineNodes.delete(item.id);
        } else {
          this.expandedOutlineNodes.add(item.id);
        }
        void this.renderOutlineTree();
      } else {
        this.activeDocumentId = item.id;
        this.updateActiveDocumentHighlight();
        await this.options.onSelectDocument(item.id);
        this.close();
      }
    });

    // Attach playlist drag-and-drop
    this.attachOutlineDragEvents(rowEl, node);

    nodeEl.appendChild(rowEl);

    // Render children if folder and expanded
    if (hasChildren && isExpanded) {
      const childrenContainer = docOwner.createElement('div');
      childrenContainer.className = 'outline-children-container';
      for (const child of node.children) {
        this.renderOutlineNode(child, depth + 1, childrenContainer);
      }
      nodeEl.appendChild(childrenContainer);
    }

    parentEl.appendChild(nodeEl);
  }

  /**
   * Attaches HTML5 playlist drag-and-drop events to an outline row.
   */
  private attachOutlineDragEvents(rowEl: HTMLElement, node: OutlineTreeNode): void {
    const item = node.document;

    rowEl.addEventListener('dragstart', (e: DragEvent) => {
      e.dataTransfer?.setData('text/plain', item.id);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
      }
      this.draggedDocId = item.id;
      rowEl.classList.add('is-dragging');
    });

    rowEl.addEventListener('dragend', () => {
      rowEl.classList.remove('is-dragging');
      this.clearOutlineDropIndicators();
      this.draggedDocId = null;
    });

    rowEl.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.draggedDocId || this.draggedDocId === item.id) return;
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }

      const rect = typeof rowEl.getBoundingClientRect === 'function'
        ? rowEl.getBoundingClientRect()
        : { top: 0, height: 32 };
      const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;

      rowEl.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-inside');
      if (item.item_type === 'folder') {
        if (relY < 0.25) {
          rowEl.classList.add('drop-target-above');
        } else if (relY > 0.75) {
          rowEl.classList.add('drop-target-below');
        } else {
          rowEl.classList.add('drop-target-inside');
        }
      } else {
        if (relY < 0.5) {
          rowEl.classList.add('drop-target-above');
        } else {
          rowEl.classList.add('drop-target-below');
        }
      }
    });

    rowEl.addEventListener('dragleave', () => {
      rowEl.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-inside');
    });

    rowEl.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = this.draggedDocId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
      if (!draggedId || draggedId === item.id) {
        this.clearOutlineDropIndicators();
        return;
      }

      let newParentId: string | null = null;
      let targetIndex = 0;

      const isInside = rowEl.classList.contains('drop-target-inside');
      const isAbove = rowEl.classList.contains('drop-target-above');

      if (isInside) {
        newParentId = item.id;
        targetIndex = node.children.length;
        this.expandedOutlineNodes.add(item.id);
      } else if (isAbove) {
        newParentId = item.parent_id ?? null;
        targetIndex = Math.max(0, Math.floor((item.sort_order ?? 0) / 10));
      } else {
        // below
        newParentId = item.parent_id ?? null;
        targetIndex = Math.floor((item.sort_order ?? 0) / 10) + 1;
      }

      this.clearOutlineDropIndicators();
      this.draggedDocId = null;

      if (this.repository.reorderDocument) {
        await this.repository.reorderDocument(draggedId, newParentId, targetIndex);
        await this.refresh();
      }
    });
  }

  private clearOutlineDropIndicators(): void {
    if (!this.outlineTreeContainer) return;
    const rows = this.outlineTreeContainer.querySelectorAll('.drop-target-above, .drop-target-below, .drop-target-inside');
    rows.forEach((r) => {
      r.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-inside');
    });
  }

  /**
   * Opens composite Scrivenings mode for all descendant documents of a folder.
   */
  public async openScriveningsForFolder(folderId: string): Promise<void> {
    if (this.repository.getDescendantDocuments) {
      const descendants = await this.repository.getDescendantDocuments(folderId);
      if (descendants.length > 0) {
        if (this.options.onSelectScrivenings) {
          await this.options.onSelectScrivenings(descendants, folderId);
        } else {
          await this.options.onSelectDocument(descendants[0].id);
        }
        this.close();
      }
    }
  }

  /**
   * Creates a new Chapter (folder) in the outline binder.
   */
  public async createNewChapter(title: string = 'Untitled Chapter'): Promise<DocumentRecord> {
    const now = Date.now();
    const chapterDoc: DocumentRecord = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'ch_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
      title,
      content: '',
      item_type: 'folder',
      parent_id: null,
      sort_order: 9999,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      is_title_custom: true,
      format_version: 1,
      sync_status: 'pending',
    };
    await this.repository.saveDocument(chapterDoc);
    this.expandedOutlineNodes.add(chapterDoc.id);
    await this.refresh();
    return chapterDoc;
  }

  /**
   * Creates a new Section (document) in the outline binder.
   */
  public async createNewSection(parentId: string | null = null, title: string = 'Untitled Section'): Promise<DocumentRecord> {
    const now = Date.now();
    const newDoc: DocumentRecord = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
      title,
      content: '',
      item_type: 'document',
      parent_id: parentId,
      sort_order: 9999,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'pending',
    };
    await this.repository.saveDocument(newDoc);
    this.activeDocumentId = newDoc.id;
    if (parentId) {
      this.expandedOutlineNodes.add(parentId);
    }
    await this.refresh();
    await this.options.onSelectDocument(newDoc.id);
    return newDoc;
  }

  private getNodeWordCount(node: OutlineTreeNode): number {
    if (node.document.item_type !== 'folder') {
      return this.countWords(node.document.content || '');
    }
    let total = 0;
    for (const child of node.children) {
      total += this.getNodeWordCount(child);
    }
    return total;
  }

  private countWords(text: string): number {
    if (!text) return 0;
    const matches = text.match(/\S+/g);
    return matches ? matches.length : 0;
  }

  /**
   * Renders empty state message.
   */
  private renderEmptyState(message: string): void {
    const docOwner = this.container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!docOwner) return;
    const emptyEl = docOwner.createElement('div');
    emptyEl.className = 'library-empty-state';
    emptyEl.innerHTML = `
      <div class="empty-icon">✎</div>
      <p class="empty-message">${escapeHtml(message)}</p>
    `;
    this.documentListContainer.appendChild(emptyEl);
  }

  /**
   * Updates document counter in drawer footer.
   */
  private updateDocumentCount(): void {
    if (!this.docCountIndicator) return;
    const count = this.allDocuments.length;
    this.docCountIndicator.textContent = `${count} ${count === 1 ? 'document' : 'documents'}`;
  }

  /**
   * Formats relative timestamp for compact display.
   */
  private formatRelativeDate(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;

    const d = new Date(timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  /**
   * Destroys the drawer, cleans up all listeners and DOM references.
   */
  public destroy(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

/**
 * Sanitizes a highlight snippet for safe insertion into card.innerHTML.
 * Allows ONLY official Sol:OS <mark class="os-search-highlight">...</mark> tags.
 * Any other HTML tags and angle brackets are escaped so they cannot execute scripts or corrupt layout.
 *
 * Employs a tokenized placeholder strategy:
 * 1. Strips raw private-use tokens (\uE000 / \uE001) to eliminate token collision/injection.
 * 2. Replaces legitimate <mark class="os-search-highlight"> with \uE000 and </mark> with \uE001.
 * 3. Escapes all remaining raw angle brackets (< to &lt;, > to &gt;) to eliminate all live DOM tags,
 *    including non-whitespace slash-delimited tags (<svg/onload=...>) and unclosed tags (<svg onload=...).
 * 4. Restores \uE000 to <mark class="os-search-highlight"> and \uE001 to </mark>.
 */
export function sanitizeSnippetHtml(snippet: string): string {
  if (!snippet) return '';

  const MARK_OPEN = '\uE000';
  const MARK_CLOSE = '\uE001';

  const cleanInput = snippet.includes(MARK_OPEN) || snippet.includes(MARK_CLOSE)
    ? snippet.replaceAll(MARK_OPEN, '').replaceAll(MARK_CLOSE, '')
    : snippet;

  const tokenized = cleanInput
    .replaceAll('<mark class="os-search-highlight">', MARK_OPEN)
    .replaceAll('</mark>', MARK_CLOSE);

  const escaped = tokenized
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replaceAll(MARK_OPEN, '<mark class="os-search-highlight">')
    .replaceAll(MARK_CLOSE, '</mark>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
