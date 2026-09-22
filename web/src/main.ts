/**
 * src/main.ts
 * Daylight Writer - Application Bootstrap
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import { SqliteDatabase } from './storage/sqlite-vfs.ts';
import { runMigrations, seedInitialData, SEED_DOCUMENT_ID, type DocumentRecord } from './storage/schema.ts';
import { SQLiteStorageRepository } from './storage/repository.ts';
import { buildTagTree } from './storage/search.ts';
import { TypewriterEditor } from './editor/editor.ts';
import { FocusModeEngine } from './editor/focus-mode.ts';
import { AutoTitleManager } from './editor/auto-title.ts';
import { HistoryManager } from './editor/history.ts';
import { LiveClockController } from './utils/datetime.ts';
import { LeftLibraryDrawer, sanitizeSnippetHtml } from './drawers/left-library.ts';
import { RightMarginDrawer } from './drawers/right-margin.ts';
import { SynchronizedScrollEngine, DrawerStateManager } from './drawers/sync-scroll.ts';
import { MockAIServiceAdapter } from './ai/mock-adapter.ts';
import type { AIServiceAdapter } from './ai/service-adapter.ts';
import { InlineContinuationEngine } from './ai/inline-continuation.ts';
import { CommandPalette } from './ai/command-palette.ts';
import { CritiqueEngine } from './ai/critique-engine.ts';
import { ContextAssistant } from './ai/context-assistant.ts';
import type { SyncAdapter } from './sync/sync-adapter.ts';
import { MockGoogleDocsSyncAdapter } from './sync/mock-google-docs-sync-adapter.ts';
import { OfflineMutationQueue } from './sync/offline-mutation-queue.ts';
import { NetworkListener } from './sync/network-listener.ts';
import { SyncStatusIndicator } from './ui/sync-status-indicator.ts';
import { ExportService } from './export/export-service.ts';
import { ShareService } from './export/share-service.ts';
import { ExportDialog } from './ui/export-dialog.ts';
import { CollaborationManager } from './editor/tiptap-collaboration.ts';
import { CollaborationModal } from './ui/collaboration-modal.ts';
import { GoogleDriveSyncAdapter } from './sync/google-drive-sync-adapter.ts';
import { GoogleDriveModal } from './ui/google-drive-modal.ts';

export class DaylightWriterApp {
  public repository: SQLiteStorageRepository;
  public db: SqliteDatabase | null = null;
  public editor: TypewriterEditor | null = null;
  public focusMode: FocusModeEngine | null = null;
  public autoTitle: AutoTitleManager | null = null;
  public history: HistoryManager | null = null;
  public clock: LiveClockController | null = null;
  public activeDocumentId: string = SEED_DOCUMENT_ID;

  // Milestone 3 Components
  public leftDrawer: LeftLibraryDrawer | null = null;
  public rightDrawer: RightMarginDrawer | null = null;
  public scrollSync: SynchronizedScrollEngine | null = null;
  public drawerState: DrawerStateManager | null = null;

  // Milestone 4 AI Components
  public aiAdapter: AIServiceAdapter | null = null;
  public inlineContinuation: InlineContinuationEngine | null = null;
  public commandPalette: CommandPalette | null = null;
  public critiqueEngine: CritiqueEngine | null = null;
  public contextAssistant: ContextAssistant | null = null;

  // Milestone 5 Sync & Export Components
  public syncAdapter: SyncAdapter | null = null;
  public syncQueue: OfflineMutationQueue | null = null;
  public syncIndicator: SyncStatusIndicator | null = null;
  public networkListener: NetworkListener | null = null;
  public exportService: ExportService | null = null;
  public shareService: ShareService | null = null;
  public exportDialog: ExportDialog | null = null;

  // TipTap & Live Collaboration Components
  public collaborationManager: CollaborationManager | null = null;
  public collaborationModal: CollaborationModal | null = null;

  // Google Drive & Cloud Sync Components
  public googleDriveAdapter: GoogleDriveSyncAdapter | null = null;
  public googleDriveModal: GoogleDriveModal | null = null;

  private currentDoc: DocumentRecord | null = null;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSortBy: 'updated_at' | 'created_at' = 'updated_at';

  constructor() {
    this.repository = new SQLiteStorageRepository();
  }

  public async bootstrap(): Promise<void> {
    try {
      // 1. Initialize SQLite Database via wa-sqlite
      this.db = await SqliteDatabase.open({ vfsPreference: 'auto' });
      await runMigrations(this.db);
      await seedInitialData(this.db);

      // 2. Initialize Reactive Storage Repository
      this.repository.setDatabaseDriver(this.db);
      await this.repository.init();

      // 2.5 Initialize M5 Pluggable Sync & Export
      this.syncQueue = new OfflineMutationQueue(this.db);
      this.syncAdapter = new MockGoogleDocsSyncAdapter();
      await this.syncAdapter.init();

      this.shareService = new ShareService();
      this.exportService = new ExportService(this.shareService);

      // 3. Attach UI, Editor, and Clock if in browser environment
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        (window as any).__daylightWriterApp = this;
        this.setupClock();
        this.setupEditor();
        this.setupKeyboardShortcuts();
        this.setupDrawers();
        this.setupCollaboration();
        await this.loadActiveDocument();
        await this.renderDocumentList();
      }
    } catch (err) {
      console.warn('[DaylightWriter] Bootstrapping with in-memory fallback:', err);
      await this.repository.init();
      this.syncQueue = new OfflineMutationQueue();
      this.syncAdapter = new MockGoogleDocsSyncAdapter();
      await this.syncAdapter.init();

      this.shareService = new ShareService();
      this.exportService = new ExportService(this.shareService);

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        this.setupClock();
        this.setupEditor();
        this.setupKeyboardShortcuts();
        this.setupDrawers();
        this.setupCollaboration();
        await this.loadActiveDocument();
        await this.renderDocumentList();
      }
    }
  }

  public setupClock(): void {
    const clockEl = document.getElementById('live-datetime');
    if (!clockEl) return;
    this.clock = new LiveClockController(clockEl);
    this.clock.start();
  }

  public setupEditor(): void {
    const scrollContainer = document.getElementById('editor-scroll-container');
    const canvas = document.getElementById('editor-canvas');
    const titleEl = document.getElementById('doc-title');
    const shell = document.querySelector('.dc1-shell') as HTMLElement | null;

    if (!scrollContainer || !canvas) return;

    // 1. Initialize Auto-Title Manager
    this.autoTitle = new AutoTitleManager('Untitled Document', false);
    if (titleEl) {
      this.autoTitle.bindDOM(titleEl, (title, isCustom) => {
        if (this.currentDoc) {
          this.currentDoc.title = title;
          this.currentDoc.is_title_custom = isCustom;
          this.queueSaveDocument();
        }
      });
      this.autoTitle.setOnTitleChange((state) => {
        if (titleEl && document.activeElement !== titleEl) {
          titleEl.textContent = state.title;
        }
      });
    }

    // 2. Initialize History Manager (Undo/Redo)
    this.history = new HistoryManager({
      typingBurstDebounceMs: 500,
    });
    this.history.bindKeyboardShortcuts(canvas, {
      getContent: () => (this.editor ? this.editor.getContent() : canvas.textContent || ''),
      getCaret: () => (this.editor ? this.editor.caretPosition.charOffset : 0),
      restoreState: (snapshot) => {
        if (this.editor) {
          this.editor.setContent(snapshot.content);
          this.autoTitle?.updateFromContent(snapshot.content);
          this.queueSaveDocument();
        }
      },
    });

    // 3. Initialize Typewriter Editor
    this.editor = new TypewriterEditor({
      callbacks: {
        onScroll: (scrollTop) => {
          this.scrollSync?.syncFromEditor(scrollTop);
        },
        onCaretChange: () => {
          this.rightDrawer?.requestLayoutUpdate();
        },
        onContentChange: (content) => {
          if (this.editor && this.history) {
            this.history.recordTyping(content, this.editor.caretPosition.charOffset);
          }
          if (this.autoTitle) {
            this.autoTitle.updateFromContent(content);
          }
          if (this.currentDoc) {
            this.currentDoc.content = content;
            if (this.autoTitle) {
              this.currentDoc.title = this.autoTitle.getTitle();
              this.currentDoc.is_title_custom = this.autoTitle.getIsCustom();
            }
            this.queueSaveDocument();
          }
          this.rightDrawer?.requestLayoutUpdate();
          this.scrollSync?.updateContentHeights();
        },
      },
    });
    this.editor.init(scrollContainer, canvas, titleEl);

    // 4. Initialize Focus Mode Engine
    this.focusMode = new FocusModeEngine({
      canvasElement: canvas,
      shellElement: shell,
      initialMode: 'none',
    });

    // 5. Initialize AI Service Adapter & Affordances (Milestone 4)
    this.aiAdapter = new MockAIServiceAdapter({
      simulatedDelayMs: 0,
    });

    if (this.history) {
      this.inlineContinuation = new InlineContinuationEngine(
        this.editor,
        this.aiAdapter,
        this.history
      );
      this.inlineContinuation.attach(canvas);

      this.commandPalette = new CommandPalette({
        editor: this.editor,
        history: this.history,
        aiAdapter: this.aiAdapter,
        repository: this.repository,
        shellElement: shell,
        onExportAction: async (format) => {
          if (this.currentDoc) {
            await this.exportDialog?.open(this.currentDoc, format as any);
          }
        },
      });
      this.commandPalette.init();

      this.critiqueEngine = new CritiqueEngine({
        editor: this.editor,
        history: this.history,
        debounceMs: 400,
      });
      this.critiqueEngine.init();
    }

    this.contextAssistant = new ContextAssistant({
      aiAdapter: this.aiAdapter,
      onNavigateParagraph: (idx) => {
        const blockEl = this.editor?.canvas?.querySelector(`[data-block-id="p-${idx - 1}"]`) as HTMLElement | null;
        if (blockEl && this.editor) {
          this.editor.activeBlockId = `p-${idx - 1}`;
          this.editor.recalculateCenterScroll(false);
        }
      },
      onNavigateNote: (anchorId) => {
        if (this.rightDrawer) {
          this.drawerState?.openRight();
          const card =
            (typeof this.rightDrawer.getNoteCardElement === 'function'
              ? this.rightDrawer.getNoteCardElement(anchorId)
              : null) ||
            (this.rightDrawer.notesListElement?.querySelector(
              `[data-anchor-id="${anchorId}"], [data-anchor-paragraph-id="${anchorId}"], [data-note-id="${anchorId}"]`
            ) as HTMLElement | null);
          card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const textarea = card?.querySelector('.thought-note-textarea, .note-card-textarea') as HTMLElement | null;
          textarea?.focus();
        }
      },
    });

    // 6. Initialize Sync Indicator, Google Drive Modal & Network Listener (Milestone 5)
    this.googleDriveAdapter = new GoogleDriveSyncAdapter();
    void this.googleDriveAdapter.init();

    this.googleDriveModal = new GoogleDriveModal({
      container: document.body,
      adapter: this.googleDriveAdapter,
      onSyncTriggered: async () => {
        if (!this.currentDoc) return;
        this.googleDriveAdapter?.queueMutation(this.currentDoc.id, 'update', { ...this.currentDoc });
        await this.googleDriveAdapter?.sync();
        if (this.currentDoc) {
          this.currentDoc.sync_status = 'synced';
          this.currentDoc.last_synced_at = Date.now();
          await this.repository.saveDocument(this.currentDoc);
        }
        if (this.googleDriveAdapter && this.syncIndicator) {
          this.syncIndicator.update(this.googleDriveAdapter.getStatus());
        }
      },
    });

    const syncPillContainer = document.getElementById('sync-status-pill');
    if (syncPillContainer) {
      this.syncIndicator = new SyncStatusIndicator(syncPillContainer, {
        onRetry: async () => {
          this.googleDriveModal?.open();
        },
      });
      this.syncIndicator.bindSyncAdapter(this.googleDriveAdapter || this.syncAdapter!);
      syncPillContainer.addEventListener('click', () => {
        this.googleDriveModal?.toggle();
      });
    }

    if (this.syncAdapter) {
      this.networkListener = new NetworkListener(this.syncAdapter, this.syncQueue || undefined);
      this.networkListener.start();
    }

    // 7. Initialize Export Dialog & Header Export Button (Milestone 5)
    if (this.exportService && this.repository) {
      this.exportDialog = new ExportDialog(this.exportService, this.repository);
      this.exportDialog.init();
    }

    const headerExportBtn = document.getElementById('header-export-btn');
    if (headerExportBtn) {
      headerExportBtn.addEventListener('click', async () => {
        if (this.currentDoc) {
          await this.exportDialog?.open(this.currentDoc);
        }
      });
    }
  }

  public async loadActiveDocument(docId: string = this.activeDocumentId): Promise<void> {
    this.activeDocumentId = docId;
    let doc = await this.repository.getDocument(docId);
    if (!doc) {
      const docs = await this.repository.listDocuments();
      if (docs.length > 0) {
        doc = docs[0];
        this.activeDocumentId = doc.id;
      }
    }

    if (doc) {
      this.currentDoc = doc;
      if (this.autoTitle) {
        const titleEl = document.getElementById('doc-title');
        if (doc.is_title_custom) {
          this.autoTitle.setManualTitle(doc.title || 'Untitled');
        } else {
          this.autoTitle.resetManualLock(doc.content || '');
        }
        if (titleEl) {
          titleEl.textContent = this.autoTitle.getTitle();
        }
      }
      if (this.editor) {
        this.editor.loadDocument(doc);
      }
      if (this.history) {
        this.history.clear();
      }
      if (this.focusMode) {
        this.focusMode.updateFocus(true);
      }
      if (this.rightDrawer) {
        await this.rightDrawer.loadDocumentNotes(doc.id);
      }
      if (this.leftDrawer) {
        this.leftDrawer.setActiveDocumentId(doc.id);
      }
      if (this.scrollSync) {
        this.scrollSync.updateContentHeights();
      }
    }
  }

  private queueSaveDocument(): void {
    if (!this.currentDoc) return;
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(async () => {
      if (this.currentDoc) {
        await this.repository.saveDocument(this.currentDoc);
        if (this.syncQueue && !this.db) {
          await this.syncQueue.enqueue('document', this.currentDoc.id, 'update', this.currentDoc);
        }
        if (this.syncQueue && this.syncAdapter && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
          void this.syncQueue.drain(this.syncAdapter);
        }
      }
      this.saveDebounceTimer = null;
    }, 250);
  }

  public setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Cmd+Shift+C : Open Live Collaboration Dialog
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.collaborationModal?.open();
        return;
      }

      // Cmd+Shift+E : Open Export & Share Dialog
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (this.currentDoc) {
          void this.exportDialog?.open(this.currentDoc);
        }
        return;
      }

      // Cmd+D : Cycle Focus Mode (none -> sentence -> paragraph -> none)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (this.focusMode) {
          this.focusMode.cycleMode();
        }
        return;
      }

      // Cmd+Shift+K : Split Document at Cursor (Steven Johnson Scrivener flow)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        void this.splitCurrentDocumentAtCursor();
        return;
      }

      // Cmd+S : Emergency Disk Flush
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void this.repository.flushPendingEdits();
        return;
      }
    });
  }

  /**
   * Splits current document at cursor offset into two consecutive binder sections (Steven Johnson flow).
   */
  public async splitCurrentDocumentAtCursor(): Promise<void> {
    if (!this.editor) return;
    const splitInfo = this.editor.getCurrentSplitOffset();
    if (!splitInfo || splitInfo.offset <= 0) return;

    if (this.repository.splitDocumentAtCursor) {
      const result = await this.repository.splitDocumentAtCursor(splitInfo.docId, splitInfo.offset);
      if (this.currentDoc && this.currentDoc.id === splitInfo.docId) {
        this.currentDoc.content = result.original.content;
        this.editor.setContent(result.original.content);
      }
      if (this.leftDrawer) {
        await this.leftDrawer.refresh();
      }
    }
  }

  public setupCollaboration(): void {
    const collabBtn = document.getElementById('header-collab-btn');
    if (!collabBtn) return;

    this.collaborationManager = new CollaborationManager(
      {
        documentId: this.activeDocumentId,
        enableWebRtc: false,
      },
      {
        onStatusChange: ({ connected, provider }) => {
          if (collabBtn) {
            collabBtn.textContent = connected ? `Collab (${provider})` : 'Collab';
            collabBtn.classList.toggle('active', connected);
          }
        },
        onPeersChange: (peers) => {
          if (this.collaborationModal) {
            this.collaborationModal.updatePeers(peers);
          }
        },
      }
    );

    this.collaborationModal = new CollaborationModal({
      container: document.body,
      manager: this.collaborationManager,
    });

    collabBtn.addEventListener('click', () => {
      this.collaborationModal?.open();
    });
  }

  public setupDrawers(): void {
    const libraryDrawerEl = document.getElementById('library-drawer');
    const marginDrawerEl = document.getElementById('margin-drawer');
    const shellEl = document.querySelector('.dc1-shell') as HTMLElement | null;
    const backdropEl = document.getElementById('drawer-backdrop') as HTMLElement | null;
    const editorScrollContainer = document.getElementById('editor-scroll-container');
    const marginScrollContainer = document.getElementById('margin-scroll-container');
    const editorCanvas = document.getElementById('editor-canvas');
    const marginNotesList = document.getElementById('margin-notes-list');

    if (!shellEl) return;

    // 1. Initialize Drawer State Manager
    this.drawerState = new DrawerStateManager(shellEl, backdropEl);
    this.drawerState.bindKeyboardShortcuts(window);

    // 2. Initialize Left Library Drawer
    if (libraryDrawerEl) {
      this.leftDrawer = new LeftLibraryDrawer({
        container: libraryDrawerEl,
        shellElement: shellEl,
        backdropElement: backdropEl,
        repository: this.repository,
        initialSortBy: this.currentSortBy,
        initialViewMode: 'outline',
        onSelectDocument: async (docId: string) => {
          await this.loadActiveDocument(docId);
        },
        onSelectScrivenings: async (childDocs, folderId) => {
          if (this.editor) {
            await this.editor.loadScrivenings(childDocs, folderId);
          }
        },
        onCreateDocument: async (newDoc) => {
          this.activeDocumentId = newDoc.id;
        },
        onExportDocument: async (doc) => {
          await this.exportDialog?.open(doc);
        },
      });
      void this.leftDrawer.init();
    }

    // 3. Initialize Right Thought Margin Drawer
    if (this.editor && marginDrawerEl) {
      this.rightDrawer = new RightMarginDrawer({
        repository: this.repository,
        editor: this.editor,
        drawerElement: marginDrawerEl,
        scrollContainer: marginScrollContainer,
        notesListElement: marginNotesList,
      });
      this.rightDrawer.init();
    }

    // 4. Initialize Synchronized Scroll Engine
    if (editorScrollContainer && marginScrollContainer) {
      this.scrollSync = new SynchronizedScrollEngine({
        editorScrollContainer,
        marginScrollContainer,
        editorCanvas,
        marginNotesList,
        deadbandEpsilon: 1.0,
        bidirectional: true,
      });
    }

    // 5. Wire Header Drawer Buttons (Touch & Click Affordance)
    const headerOutlineBtn = document.getElementById('header-outline-btn');
    if (headerOutlineBtn) {
      headerOutlineBtn.addEventListener('click', () => {
        this.drawerState?.toggleLeft();
      });
    }

    const headerNotesBtn = document.getElementById('header-notes-btn');
    if (headerNotesBtn) {
      headerNotesBtn.addEventListener('click', () => {
        this.drawerState?.toggleRight();
      });
    }
  }

  public setupDrawerInteractions(): void {
    this.setupDrawers();
  }

  public async handleSearch(query: string): Promise<void> {
    if (this.leftDrawer) {
      await this.leftDrawer.executeSearch(query);
    } else {
      const hits = await this.repository.searchDocuments(query);
      this.renderSearchResults(hits);
    }
  }

  public async renderDocumentList(): Promise<void> {
    if (this.leftDrawer) {
      await this.leftDrawer.refresh();
      return;
    }

    const listContainer = document.getElementById('document-list-container');
    const tagTreeContainer = document.getElementById('tag-tree-container');
    if (!listContainer) return;

    const docs = await this.repository.listDocuments({ sortBy: this.currentSortBy });
    listContainer.innerHTML = '';

    for (const doc of docs) {
      const card = document.createElement('div');
      card.className = 'document-card';
      if (doc.id === this.activeDocumentId) {
        card.classList.add('active-doc');
      }
      card.dataset.id = doc.id;
      card.innerHTML = `
        <div class="doc-item-title">${escapeHtml(doc.title || 'Untitled')}</div>
        <div class="doc-item-snippet">${escapeHtml(doc.content.slice(0, 60))}</div>
      `;
      card.addEventListener('click', () => {
        void this.loadActiveDocument(doc.id);
        const shell = document.querySelector('.dc1-shell');
        shell?.classList.remove('left-open');
        this.renderDocumentList();
      });
      listContainer.appendChild(card);
    }

    if (tagTreeContainer) {
      const tags = await this.repository.getTags();
      const docTagsMap = new Map<string, string[]>();
      for (const doc of docs) {
        docTagsMap.set(doc.id, await this.repository.getDocumentTags(doc.id));
      }
      const tree = buildTagTree(tags, docTagsMap);
      tagTreeContainer.innerHTML = '';
      for (const node of tree) {
        const tagEl = document.createElement('div');
        tagEl.className = 'tag-tree-item';
        tagEl.textContent = `#${node.path} (${node.count})`;
        tagTreeContainer.appendChild(tagEl);
      }
    }
  }

  public renderSearchResults(hits: Array<{ document: any; score: number; matchHighlights: string[] }>): void {
    const listContainer = document.getElementById('document-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    for (const hit of hits) {
      const card = document.createElement('div');
      card.className = 'document-card';
      card.dataset.id = hit.document.id;
      card.innerHTML = `
        <div class="doc-item-title">${escapeHtml(hit.document.title || 'Untitled')}</div>
        <div class="doc-item-snippet">${hit.matchHighlights.length > 0 ? sanitizeSnippetHtml(hit.matchHighlights[0]) : escapeHtml(hit.document.content.slice(0, 60))}</div>
      `;
      card.addEventListener('click', () => {
        void this.loadActiveDocument(hit.document.id);
        const shell = document.querySelector('.dc1-shell');
        shell?.classList.remove('left-open');
      });
      listContainer.appendChild(card);
    }
  }

  public destroy(): void {
    if (this.clock) {
      this.clock.stop();
      this.clock = null;
    }
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    this.networkListener?.stop();
    this.syncIndicator?.destroy();
    this.exportDialog?.destroy();
    this.editor?.destroy();
    this.focusMode?.destroy();
    this.leftDrawer?.destroy();
    this.rightDrawer?.destroy();
    this.scrollSync?.destroy();
    this.drawerState?.destroy();
    this.inlineContinuation?.destroy();
    this.commandPalette?.destroy();
    this.critiqueEngine?.destroy();
    this.repository.destroy();
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Auto-bootstrap when loaded in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const app = new DaylightWriterApp();
  void app.bootstrap();
}
