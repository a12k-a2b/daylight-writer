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
import type { SyncAdapter, SyncOperation } from './sync/sync-adapter.ts';
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
import { ThemeManager } from './ui/theme-manager.ts';
import { SettingsModal } from './ui/settings-modal.ts';

export class DaylightWriterApp {
  public repository: SQLiteStorageRepository;
  public db: SqliteDatabase | null = null;
  public editor: TypewriterEditor | null = null;
  public focusMode: FocusModeEngine | null = null;
  public autoTitle: AutoTitleManager | null = null;
  public history: HistoryManager | null = null;
  public clock: LiveClockController | null = null;
  public activeDocumentId: string = SEED_DOCUMENT_ID;

  // Theme & Settings
  public themeManager: ThemeManager | null = null;
  public settingsModal: SettingsModal | null = null;

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

  // Dual-Debounce Timers: Local 250ms SQLite persistence vs Cloud 1500ms Google Drive sync
  public flushTimer: ReturnType<typeof setTimeout> | null = null;
  public saveDebounceTimer: ReturnType<typeof setTimeout> | null = null; // Maintained for Android Kotlin bridge compatibility
  public cloudSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

      // 2.5 Initialize M5 Pluggable Sync & Export with Canonical Google Drive Adapter
      this.syncQueue = new OfflineMutationQueue(this.db);
      await this.syncQueue.init();

      this.googleDriveAdapter = new GoogleDriveSyncAdapter({
        db: this.db,
        repository: this.repository,
        mutationQueue: this.syncQueue,
      });
      await this.googleDriveAdapter.init();
      this.syncAdapter = this.googleDriveAdapter;

      this.shareService = new ShareService();
      this.exportService = new ExportService(this.shareService);

      // 3. Attach UI, Editor, and Clock if in browser environment
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        (window as any).__daylightWriterApp = this;
        this.setupThemes();
        this.setupClock();
        this.setupEditor();
        this.setupDaylightBridgeClient();
        this.setupKeyboardShortcuts();
        this.setupDrawers();
        this.setupCollaboration();
        this.setupTypewriterChromePolish();
        await this.loadActiveDocument();
        await this.renderDocumentList();

        // Initial background remote discovery if authenticated and online
        if (this.googleDriveAdapter.isAuthenticated() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
          void this.googleDriveAdapter.pull().catch((err) => {
            console.warn('[DaylightWriter] Initial remote document discovery deferred:', err);
          });
        }
      }
    } catch (err) {
      console.warn('[DaylightWriter] Bootstrapping with in-memory fallback:', err);
      await this.repository.init();
      this.syncQueue = new OfflineMutationQueue();
      await this.syncQueue.init();

      this.googleDriveAdapter = new GoogleDriveSyncAdapter({
        repository: this.repository,
        mutationQueue: this.syncQueue,
      });
      await this.googleDriveAdapter.init();
      this.syncAdapter = this.googleDriveAdapter;

      this.shareService = new ShareService();
      this.exportService = new ExportService(this.shareService);

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        (window as any).__daylightWriterApp = this;
        this.setupThemes();
        this.setupClock();
        this.setupEditor();
        this.setupDaylightBridgeClient();
        this.setupKeyboardShortcuts();
        this.setupDrawers();
        this.setupCollaboration();
        this.setupTypewriterChromePolish();
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

    // 4. Initialize Focus Mode Engine (Default: ADHD Sentence Focus Mode)
    this.focusMode = new FocusModeEngine({
      canvasElement: canvas,
      shellElement: shell,
      initialMode: 'sentence',
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
    if (!this.googleDriveAdapter) {
      this.googleDriveAdapter = new GoogleDriveSyncAdapter({
        db: this.db || undefined,
        repository: this.repository,
        mutationQueue: this.syncQueue || undefined,
      });
      void this.googleDriveAdapter.init();
      this.syncAdapter = this.googleDriveAdapter;
    }

    this.googleDriveModal = new GoogleDriveModal({
      container: document.body,
      adapter: this.googleDriveAdapter,
      onSyncTriggered: async () => {
        // Preempt any active debouncers upon manual force-sync trigger
        this.cancelDebounceTimers();

        if (!this.currentDoc) return;
        const op: SyncOperation = this.currentDoc.google_drive_file_id ? 'update' : 'create';
        this.googleDriveAdapter?.queueMutation(this.currentDoc.id, op, { ...this.currentDoc });
        await this.googleDriveAdapter?.sync();

        if (this.currentDoc) {
          const reloaded = await this.repository.getDocument(this.currentDoc.id);
          if (reloaded) {
            this.currentDoc = reloaded;
          }
        }
        if (this.googleDriveAdapter && this.syncIndicator) {
          this.syncIndicator.update(this.googleDriveAdapter.getStatus());
        }
        if (this.leftDrawer) {
          await this.leftDrawer.refresh();
        }
      },
    });

    const syncPillContainer = document.getElementById('sync-status-pill');
    if (syncPillContainer) {
      this.syncIndicator = new SyncStatusIndicator(syncPillContainer, {
        format: 'solos',
        showTimestamp: true,
        onRetry: () => {
          this.googleDriveModal?.open();
        },
        onRetryClick: () => {
          this.googleDriveModal?.open();
        },
        onClick: () => {
          this.googleDriveModal?.toggle();
        },
      });
      this.syncIndicator.bindSyncAdapter(this.googleDriveAdapter);
    }

    this.networkListener = new NetworkListener(this.googleDriveAdapter, this.syncQueue || undefined);
    this.networkListener.start();

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
    if (this.currentDoc && (this.flushTimer || this.cloudSyncDebounceTimer)) {
      this.cancelDebounceTimers();
      if (this.editor && typeof this.editor.getContent === 'function') {
        this.currentDoc.content = this.editor.getContent();
        if (this.autoTitle) {
          this.currentDoc.title = this.autoTitle.getTitle();
          this.currentDoc.is_title_custom = this.autoTitle.getIsCustom();
        }
      }
      await this.repository.saveDocument(this.currentDoc);
      if (this.syncQueue) {
        await this.syncQueue.enqueue('document', this.currentDoc.id, 'update', { ...this.currentDoc });
      }
      if (this.googleDriveAdapter) {
        const op: SyncOperation = this.currentDoc.google_drive_file_id ? 'update' : 'create';
        this.googleDriveAdapter.queueMutation(this.currentDoc.id, op, { ...this.currentDoc });
      }
      if (typeof this.repository.flushPendingEdits === 'function') {
        await this.repository.flushPendingEdits();
      }
      if (
        typeof (window as any).DaylightBridge !== 'undefined' &&
        typeof (window as any).DaylightBridge.onSyncQueueUpdated === 'function'
      ) {
        try {
          const pendingCount = this.syncQueue
            ? await this.syncQueue.getPendingCount()
            : this.googleDriveAdapter
            ? this.googleDriveAdapter.getStatus().pendingCount
            : 0;
          (window as any).DaylightBridge.onSyncQueueUpdated(pendingCount);
        } catch (bridgeErr) {
          console.warn('[DaylightBridge] onSyncQueueUpdated notification failed:', bridgeErr);
        }
      }
      if (this.syncIndicator && this.googleDriveAdapter) {
        this.syncIndicator.update(this.googleDriveAdapter.getStatus());
      }
    } else {
      this.cancelDebounceTimers();
    }

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

  /**
   * Dual-Debounce Persistence Pipeline:
   * 1. 250ms fast debounce (`flushTimer`): Immediately persists typing bursts locally into wa-sqlite.
   * 2. 1500ms cloud debounce (`cloudSyncDebounceTimer`): Automatically pushes document mutations to Google Drive
   *    after the author pauses typing for 1.5 seconds.
   */
  private queueSaveDocument(): void {
    if (!this.currentDoc) return;

    // 1. Fast Local SQLite Debounce (250ms)
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(async () => {
      if (this.currentDoc) {
        await this.repository.saveDocument(this.currentDoc);
        if (this.syncQueue) {
          await this.syncQueue.enqueue('document', this.currentDoc.id, 'update', { ...this.currentDoc });
        }
      }
      this.flushTimer = null;
      this.saveDebounceTimer = null;
    }, 250);
    this.saveDebounceTimer = this.flushTimer;

    // 2. Background Cloud Sync Debounce (1500ms / 1.5s per Feature 5 & R1)
    if (this.cloudSyncDebounceTimer) {
      clearTimeout(this.cloudSyncDebounceTimer);
    }
    this.cloudSyncDebounceTimer = setTimeout(async () => {
      await this.triggerCloudSyncForActiveDocument();
      this.cloudSyncDebounceTimer = null;
    }, 1500);
  }

  /**
   * Cancels active local and cloud debounce timers to prevent redundant triggers.
   */
  public cancelDebounceTimers(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.saveDebounceTimer = null;
    }
    if (this.cloudSyncDebounceTimer) {
      clearTimeout(this.cloudSyncDebounceTimer);
      this.cloudSyncDebounceTimer = null;
    }
  }

  /**
   * Pushes active document mutation to Google Drive and executes synchronization.
   */
  public async triggerCloudSyncForActiveDocument(): Promise<void> {
    if (!this.currentDoc || !this.googleDriveAdapter) return;

    // Ensure local database snapshot is committed before pushing
    await this.repository.saveDocument(this.currentDoc);

    const operation: SyncOperation = this.currentDoc.google_drive_file_id ? 'update' : 'create';
    this.googleDriveAdapter.queueMutation(this.currentDoc.id, operation, { ...this.currentDoc });

    // Notify Android native bridge WorkManager of updated pending mutation count
    if (
      typeof (window as any).DaylightBridge !== 'undefined' &&
      typeof (window as any).DaylightBridge.onSyncQueueUpdated === 'function'
    ) {
      try {
        (window as any).DaylightBridge.onSyncQueueUpdated(this.googleDriveAdapter.getStatus().pendingCount);
      } catch (bridgeErr) {
        console.warn('[DaylightBridge] onSyncQueueUpdated notification failed:', bridgeErr);
      }
    }

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        await this.googleDriveAdapter.sync();
        if (this.currentDoc) {
          const reloaded = await this.repository.getDocument(this.currentDoc.id);
          if (reloaded) {
            this.currentDoc = reloaded;
          }
        }
      } catch (err) {
        console.warn('[DaylightWriter] Debounced cloud sync failed:', err);
      }
    }

    if (this.syncIndicator) {
      this.syncIndicator.update(this.googleDriveAdapter.getStatus());
    }

    if (this.leftDrawer) {
      void this.leftDrawer.refresh();
    }
  }

  /**
   * Registers reverse dispatcher hooks for Android native wrapper (`window.DaylightBridgeClient`).
   * Provides emergency SQLite WAL flush, WorkManager background sync, and URL redirection.
   */
  public setupDaylightBridgeClient(): void {
    if (typeof window === 'undefined') return;

    const existingClient = (window as any).DaylightBridgeClient || {};

    (window as any).DaylightBridgeClient = {
      ...existingClient,

      /**
       * Emergency SQLite WAL flush and immediate cloud debounce execution.
       * Invoked by Android Folio Hall Sensor (/dev/input/event3 SW_LID),
       * Activity onPause(), or Cmd+S emergency save point.
       */
      flushPendingEdits: async (): Promise<void> => {
        try {
          this.cancelDebounceTimers();

          if (this.editor && this.currentDoc && typeof this.editor.getContent === 'function') {
            const content = this.editor.getContent();
            this.currentDoc.content = content;
            if (this.autoTitle) {
              this.currentDoc.title = this.autoTitle.getTitle();
              this.currentDoc.is_title_custom = this.autoTitle.getIsCustom();
            }
          }

          if (this.currentDoc) {
            await this.repository.saveDocument(this.currentDoc);
          }
          if (typeof this.repository.flushPendingEdits === 'function') {
            await this.repository.flushPendingEdits();
          }

          if (this.currentDoc && this.googleDriveAdapter) {
            const op: SyncOperation = this.currentDoc.google_drive_file_id ? 'update' : 'create';
            this.googleDriveAdapter.queueMutation(this.currentDoc.id, op, { ...this.currentDoc });
            if (this.syncQueue) {
              await this.syncQueue.enqueue('document', this.currentDoc.id, 'update', { ...this.currentDoc });
            }

            if (typeof navigator === 'undefined' || navigator.onLine !== false) {
              try {
                await this.googleDriveAdapter.sync();
              } catch (cloudErr) {
                console.warn('[DaylightBridgeClient] Cloud sync during emergency flush skipped:', cloudErr);
              }
            }
          }

          if (
            typeof (window as any).DaylightBridge !== 'undefined' &&
            typeof (window as any).DaylightBridge.onFlushCompleted === 'function'
          ) {
            (window as any).DaylightBridge.onFlushCompleted(true, 0);
          }
        } catch (err) {
          console.error('[DaylightBridgeClient] flushPendingEdits failed:', err);
          if (
            typeof (window as any).DaylightBridge !== 'undefined' &&
            typeof (window as any).DaylightBridge.onFlushCompleted === 'function'
          ) {
            (window as any).DaylightBridge.onFlushCompleted(false, 0);
          }
        }
      },

      /**
       * Background sync triggered by Android WorkManager (DaylightSyncWorker)
       * when network connectivity is established.
       */
      triggerBackgroundSync: async (): Promise<{ pushed: number; pulled: number }> => {
        let pushed = 0;
        let pulled = 0;

        try {
          if (this.googleDriveAdapter) {
            if (this.syncQueue) {
              const queueResult = await this.syncQueue.drain(this.googleDriveAdapter);
              pushed += queueResult.pushedCount;
            }

            const syncResult = await this.googleDriveAdapter.sync();
            pushed += syncResult.pushedCount;

            if (this.googleDriveAdapter.isAuthenticated()) {
              try {
                const pullResult = await this.googleDriveAdapter.pull();
                pulled += pullResult.pulledCount;
              } catch (pullErr) {
                console.warn('[DaylightBridgeClient] Background pull skipped:', pullErr);
              }
            }

            if (pulled > 0 && this.currentDoc) {
              const reloaded = await this.repository.getDocument(this.currentDoc.id);
              if (reloaded) {
                this.currentDoc = reloaded;
                if (this.editor) {
                  this.editor.setContent(reloaded.content);
                }
              }
              if (this.leftDrawer) {
                await this.leftDrawer.refresh();
              }
            }

            if (this.syncIndicator) {
              this.syncIndicator.update(this.googleDriveAdapter.getStatus());
            }
          }
        } catch (err) {
          console.error('[DaylightBridgeClient] triggerBackgroundSync failed:', err);
        }

        return { pushed, pulled };
      },

      /**
       * Direct alias for immediate synchronization requests.
       */
      requestImmediateSync: (): boolean => {
        void (window as any).DaylightBridgeClient.triggerBackgroundSync();
        return true;
      },

      /**
       * Opens external URL (e.g. Google Docs document edit link) in system browser.
       */
      openExternalUrl: (url: string): boolean => {
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
    };

    // Listen for custom native events dispatched by WebView or Android bridge
    const handleImmediateSyncEvent = async () => {
      await (window as any).DaylightBridgeClient.triggerBackgroundSync();
    };

    window.addEventListener('daylight:requestImmediateSync', handleImmediateSyncEvent);
    window.addEventListener('requestImmediateSync', handleImmediateSyncEvent);
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

      // Cmd+Alt+T : Cycle Themes Instantly (Sol:OS -> Day One -> Scrivener)
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const nextTheme = this.themeManager?.cycleTheme();
        const themeBtn = document.getElementById('header-theme-btn');
        if (themeBtn && nextTheme) {
          const config = this.themeManager?.getThemeConfig();
          themeBtn.textContent = `🎨 ${config?.name.split(' ')[0] || 'Theme'}`;
        }
        return;
      }

      // Cmd+, / Ctrl+, : Toggle Google Drive & Docs Sync Configuration Dialog (Feature 17 & R4)
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        if (this.googleDriveModal) {
          this.googleDriveModal.toggle();
        } else if (this.settingsModal) {
          this.settingsModal.toggle();
        }
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

  public setupThemes(): void {
    this.themeManager = new ThemeManager();
    this.themeManager.init();

    this.settingsModal = new SettingsModal({
      container: document.body,
      themeManager: this.themeManager,
      onThemeChanged: () => {
        const themeBtn = document.getElementById('header-theme-btn');
        if (themeBtn) {
          const config = this.themeManager?.getThemeConfig();
          themeBtn.textContent = `🎨 ${config?.name.split(' ')[0] || 'Theme'}`;
        }
      },
    });

    const themeBtn = document.getElementById('header-theme-btn');
    if (themeBtn) {
      const config = this.themeManager.getThemeConfig();
      themeBtn.textContent = `🎨 ${config.name.split(' ')[0]}`;
      themeBtn.addEventListener('click', () => {
        const nextTheme = this.themeManager?.cycleTheme();
        if (nextTheme) {
          const nextConfig = this.themeManager?.getThemeConfig();
          themeBtn.textContent = `🎨 ${nextConfig?.name.split(' ')[0] || 'Theme'}`;
        }
      });
    }

    const settingsBtn = document.getElementById('header-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.settingsModal?.toggle();
      });
    }
  }

  /**
   * iA Writer Zero-Chrome Polish:
   * Smoothly fades the top header during typing bursts, giving the author
   * an immersive, distraction-free typewriter canvas. Re-reveals on mouseover,
   * pause in typing (2.5s), or Esc.
   */
  public setupTypewriterChromePolish(): void {
    const headerEl = document.querySelector('.editor-header') as HTMLElement | null;
    const viewportEl = document.getElementById('editor-viewport') as HTMLElement | null;
    const canvas = document.getElementById('editor-canvas') as HTMLElement | null;
    if (!headerEl || !viewportEl || !canvas) return;

    let fadeTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerTypingFade = () => {
      headerEl.classList.add('is-typing-faded');
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        headerEl.classList.remove('is-typing-faded');
      }, 2500);
    };

    const revealHeader = () => {
      if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
      }
      headerEl.classList.remove('is-typing-faded');
    };

    canvas.addEventListener('input', triggerTypingFade);
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        revealHeader();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        triggerTypingFade();
      }
    });

    viewportEl.addEventListener('mousemove', (e) => {
      if (e.clientY <= 65) {
        revealHeader();
      }
    });

    headerEl.addEventListener('mouseenter', revealHeader);
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
    this.cancelDebounceTimers();
    this.networkListener?.stop();
    this.syncIndicator?.destroy();
    this.googleDriveModal?.close();
    (this.googleDriveAdapter as any)?.destroy?.();
    this.exportDialog?.destroy();
    this.settingsModal?.close();
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
