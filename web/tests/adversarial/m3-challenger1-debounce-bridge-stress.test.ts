/**
 * web/tests/adversarial/m3-challenger1-debounce-bridge-stress.test.ts
 * Milestone 3 Empirical Challenger 1: Dual-Debounce & Bridge Integration Stress Suite
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SPECIFICATION:
 * 1. Challenge 1 (Rapid keystroke burst):
 *    Simulate 50 typing events within 500ms; verify exactly 0 cloud sync calls during typing,
 *    1 local SQLite save after 250ms pause, and exactly 1 cloud sync call after 1500ms pause.
 * 2. Challenge 2 (Preemption / Debounce cancellation):
 *    Start typing, wait 500ms, then trigger manual sync or flushPendingEdits();
 *    verify that the pending 1500ms cloud timer is cancelled and no duplicate secondary sync occurs at t=1500ms.
 * 3. Challenge 3 (Emergency Save Point):
 *    Call window.DaylightBridgeClient.flushPendingEdits(); verify that editor content is committed to database
 *    and window.DaylightBridge.onFlushCompleted(true, 0) is invoked within <50ms.
 * 4. Challenge 4 (Offline queue buffering during debounce):
 *    Type while offline; verify local database updates after 250ms, mutation enters offline queue,
 *    cloud sync is not called, and status displays offline count (e.g. "Offline (1)").
 * 5. Challenge 5 (Document switching during debounce race):
 *    Rapid typing burst in Document A followed immediately by click on Document B in left library drawer (<250ms and <1500ms):
 *    - Assert Document A edits are not dropped from SQLite.
 *    - Assert Document B is not erroneously pushed to Google Drive for Document A's edits.
 *    - Assert debounce timers are properly cancelled and reset.
 */

import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { DaylightWriterApp } from '../../src/main.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, seedInitialData, SEED_DOCUMENT_ID, type DocumentRecord } from '../../src/storage/schema.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { OfflineMutationQueue } from '../../src/sync/offline-mutation-queue.ts';
import { SyncStatusIndicator } from '../../src/ui/sync-status-indicator.ts';
import { MockGoogleDriveServer } from '../e2e/gdrive-sync/helpers/test-harness.ts';
import { LeftLibraryDrawer } from '../../src/drawers/left-library.ts';

// ----------------------------------------------------------------------------
// Test Environment Fixture
// ----------------------------------------------------------------------------

interface StressHarnessEnv {
  app: DaylightWriterApp;
  db: SqliteDatabase;
  win: Window;
  server: MockGoogleDriveServer;
  cleanup: () => Promise<void>;
}

async function createStressHarness(): Promise<StressHarnessEnv> {
  // 1. Open SQLite database in memory BEFORE attaching HappyDOM window
  // (Prevents wa-sqlite module loader from falling back to browser HTTP fetch)
  const db = await SqliteDatabase.open({
    vfsPreference: 'memory',
    dbName: `stress_debounce_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`,
  });
  await runMigrations(db);
  await seedInitialData(db);

  // 2. Setup mock server & HappyDOM window
  const server = new MockGoogleDriveServer();
  server.seedFolder('folder-mss-test', 'Daylight Manuscripts');

  const win = new Window();
  const prevWindow = (globalThis as any).window;
  const prevDoc = (globalThis as any).document;
  const prevStorage = (globalThis as any).localStorage;
  const prevFetch = globalThis.fetch;
  const prevHTMLElement = (globalThis as any).HTMLElement;
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).localStorage = win.localStorage;
  (globalThis as any).HTMLElement = win.HTMLElement;

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });

  // Intercept fetch with MockGoogleDriveServer
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return Promise.resolve(server.handleRequest(url, init));
  }) as any;

  // Populate DOM with necessary chrome elements
  win.document.body.innerHTML = `
    <div id="app" class="dc1-shell">
      <div id="doc-title" contenteditable="true">Untitled Document</div>
      <div id="sync-status-pill" class="sync-status-pill sync-state-synced" role="status" aria-live="polite">
        <span class="sync-status-glyph" aria-hidden="true">✓</span>
        <span class="sync-status-label">Synced</span>
      </div>
      <div id="editor-scroll-container">
        <div id="editor-canvas" contenteditable="true">
          <p data-block-id="p-0"><br /></p>
        </div>
      </div>
    </div>
  `;

  // 3. Instantiate & wire DaylightWriterApp
  const app = new DaylightWriterApp();
  app.db = db;
  app.repository.setDatabaseDriver(db);
  await app.repository.init();

  app.syncQueue = new OfflineMutationQueue(db);
  await app.syncQueue.init();

  app.googleDriveAdapter = new GoogleDriveSyncAdapter({
    db,
    repository: app.repository,
    mutationQueue: app.syncQueue,
  });
  await app.googleDriveAdapter.init();

  // Configure authenticated session
  app.googleDriveAdapter.setTokens({
    accessToken: 'ya29.valid-token',
    tokenType: 'Bearer',
    timestamp: Date.now(),
    expiresIn: 3600,
  });

  // Attach status indicator
  const pillContainer = win.document.getElementById('sync-status-pill');
  if (pillContainer) {
    app.syncIndicator = new SyncStatusIndicator(pillContainer as any, { format: 'solos' });
    app.syncIndicator.bindSyncAdapter(app.googleDriveAdapter);
  }

  // Setup bridge hooks
  app.setupDaylightBridgeClient();

  // Load document
  const seedDoc = await app.repository.getDocument(SEED_DOCUMENT_ID);
  assert.ok(seedDoc, 'Seed document must exist');
  (app as any).currentDoc = { ...seedDoc };

  const cleanup = async () => {
    app.cancelDebounceTimers();
    if (app.repository) {
      await app.repository.flushPendingEdits().catch(() => {});
      app.repository.destroy();
    }
    app.editor = null;
    app.destroy();
    await db.close().catch(() => {});
    server.reset();

    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDoc;
    (globalThis as any).localStorage = prevStorage;
    (globalThis as any).HTMLElement = prevHTMLElement;
    globalThis.fetch = prevFetch;

    if (prevNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', prevNavigatorDesc);
    } else {
      delete (globalThis as any).navigator;
    }
  };

  return { app, db, win, server, cleanup };
}

// Helper to drain microtasks during mock timer ticks
async function settleAsync(app: DaylightWriterApp, maxRounds = 30): Promise<void> {
  for (let r = 0; r < maxRounds; r++) {
    await Promise.resolve();
  }
}

// ----------------------------------------------------------------------------
// SUITE: Milestone 3 Empirical Adversarial Challenge Tests
// ----------------------------------------------------------------------------

describe('Milestone 3: Dual-Debounce Engine & Bridge Integration Stress', () => {

  // ==========================================================================
  // CHALLENGE 1: Rapid Keystroke Burst (50 typing events within 500ms)
  // ==========================================================================

  describe('Challenge 1: Rapid Keystroke Burst Timing Verification', () => {
    test('Empirical C1.1: 50 keystrokes within 500ms produces 0 cloud calls during typing, 1 local save after 250ms pause, 1 cloud call after 1500ms pause', async () => {
      const { app, cleanup } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        let localSaveCount = 0;
        const origSaveDocument = app.repository.saveDocument.bind(app.repository);
        app.repository.saveDocument = async (doc: Partial<DocumentRecord> & { id: string }) => {
          localSaveCount++;
          return origSaveDocument(doc);
        };

        let cloudSyncCallCount = 0;
        const origSync = app.googleDriveAdapter!.sync.bind(app.googleDriveAdapter!);
        app.googleDriveAdapter!.sync = async () => {
          cloudSyncCallCount++;
          return origSync();
        };

        // --- Phase 1: Rapid Typing Burst (50 events in 500ms, 10ms interval) ---
        for (let i = 0; i < 50; i++) {
          (app as any).currentDoc.content = `Burst keystroke index ${i}`;
          (app as any).queueSaveDocument();

          if (i < 49) {
            mock.timers.tick(10);
            await settleAsync(app, 5);
          }
        }

        // Verification during typing (t=490ms from start, burst ongoing)
        assert.strictEqual(
          cloudSyncCallCount,
          0,
          `Cloud sync must NOT be called during active typing burst (observed: ${cloudSyncCallCount})`
        );
        assert.strictEqual(
          localSaveCount,
          0,
          `Local SQLite debounced save must NOT execute while typing interval < 250ms (observed: ${localSaveCount})`
        );
        assert.ok(app.flushTimer !== null, 'Local flushTimer must remain scheduled');
        assert.ok(app.cloudSyncDebounceTimer !== null, 'Cloud syncDebounceTimer must remain scheduled');

        // --- Phase 2: Pause for 250ms (Local SQLite Debounce Threshold) ---
        mock.timers.tick(250);
        // Allow flushTimer async callback to complete
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        assert.strictEqual(
          localSaveCount,
          1,
          `Exactly 1 local SQLite save must execute after 250ms typing pause (observed: ${localSaveCount})`
        );
        assert.strictEqual(
          cloudSyncCallCount,
          0,
          `Cloud sync must NOT trigger at 250ms pause (observed: ${cloudSyncCallCount})`
        );
        assert.ok(app.cloudSyncDebounceTimer !== null, 'Cloud sync timer must still be pending after 250ms pause');

        // Verify local database reflects latest content after 250ms
        const savedDoc = await app.repository.getDocument(SEED_DOCUMENT_ID);
        assert.strictEqual(savedDoc?.content, 'Burst keystroke index 49');

        // --- Phase 3: Pause for remaining 1250ms (reaching 1500ms Cloud Debounce) ---
        mock.timers.tick(1250);
        // Allow cloudSyncDebounceTimer async callback to complete
        while (app.cloudSyncDebounceTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        assert.strictEqual(
          cloudSyncCallCount,
          1,
          `Exactly 1 cloud sync call must execute after 1500ms typing pause (observed: ${cloudSyncCallCount})`
        );
        assert.strictEqual(app.cloudSyncDebounceTimer, null, 'cloudSyncDebounceTimer must be cleared after firing');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C1.2: Extreme high-frequency fuzzing burst (150 events in 300ms at 2ms interval)', async () => {
      const { app, cleanup } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        let localSaveCount = 0;
        const origSave = app.repository.saveDocument.bind(app.repository);
        app.repository.saveDocument = async (doc) => {
          localSaveCount++;
          return origSave(doc);
        };

        let cloudSyncCount = 0;
        const origSync = app.googleDriveAdapter!.sync.bind(app.googleDriveAdapter!);
        app.googleDriveAdapter!.sync = async () => {
          cloudSyncCount++;
          return origSync();
        };

        // 150 rapid inputs arriving every 2ms
        for (let i = 0; i < 150; i++) {
          (app as any).currentDoc.content = `Ultra-fast keystroke ${i}`;
          (app as any).queueSaveDocument();
          if (i < 149) {
            mock.timers.tick(2);
            await settleAsync(app, 2);
          }
        }

        // At t=298ms: neither timer has elapsed
        assert.strictEqual(localSaveCount, 0, 'Zero local saves during continuous 2ms burst');
        assert.strictEqual(cloudSyncCount, 0, 'Zero cloud syncs during continuous 2ms burst');

        // Advance 250ms
        mock.timers.tick(250);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }
        assert.strictEqual(localSaveCount, 1, 'Exactly 1 local save after 250ms pause');
        assert.strictEqual(cloudSyncCount, 0, 'Cloud sync still deferred');

        // Advance remaining 1250ms
        mock.timers.tick(1250);
        while (app.cloudSyncDebounceTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }
        assert.strictEqual(cloudSyncCount, 1, 'Exactly 1 cloud sync executed after 1500ms pause');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Preemption / Debounce Cancellation
  // ==========================================================================

  describe('Challenge 2: Preemption / Debounce Cancellation Verification', () => {
    test('Empirical C2.1: Preemption via flushPendingEdits() cancels pending 1500ms cloud timer with 0 duplicate syncs', async () => {
      const { app, cleanup, win } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        let cloudSyncCount = 0;
        const origSync = app.googleDriveAdapter!.sync.bind(app.googleDriveAdapter!);
        app.googleDriveAdapter!.sync = async () => {
          cloudSyncCount++;
          return origSync();
        };

        // Step 1: Start typing
        (app as any).currentDoc.content = 'Manuscript drafted prior to preemption';
        (app as any).queueSaveDocument();

        // Step 2: Wait 500ms (local 250ms has executed; cloud 1500ms has 1000ms remaining)
        mock.timers.tick(500);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        assert.strictEqual(cloudSyncCount, 0, 'No cloud sync before 1500ms');
        assert.ok(app.cloudSyncDebounceTimer !== null, 'Cloud sync timer must be actively scheduled');

        // Step 3: Trigger manual preemption via DaylightBridgeClient.flushPendingEdits()
        assert.ok((win as any).DaylightBridgeClient?.flushPendingEdits, 'DaylightBridgeClient.flushPendingEdits must exist');
        await (win as any).DaylightBridgeClient.flushPendingEdits();
        await settleAsync(app, 10);

        // Preemption must have cancelled the debouncer and executed immediate sync
        assert.strictEqual(app.cloudSyncDebounceTimer, null, 'Pending cloud sync timer must be cancelled');
        assert.strictEqual(cloudSyncCount, 1, 'Immediate sync must have executed during flushPendingEdits()');

        // Step 4: Advance time past the original 1500ms boundary (to t=2500ms)
        mock.timers.tick(2000);
        await settleAsync(app, 10);

        // Total cloud sync count must remain strictly 1 (no duplicate second sync at t=1500ms)
        assert.strictEqual(
          cloudSyncCount,
          1,
          `Pending cloud timer must NOT fire a duplicate secondary sync after preemption (observed: ${cloudSyncCount})`
        );
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C2.2: Preemption via manual sync button cancels pending 1500ms cloud timer with 0 duplicate syncs', async () => {
      const { app, cleanup } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        let cloudSyncCount = 0;
        const origSync = app.googleDriveAdapter!.sync.bind(app.googleDriveAdapter!);
        app.googleDriveAdapter!.sync = async () => {
          cloudSyncCount++;
          return origSync();
        };

        // Start typing
        (app as any).currentDoc.content = 'Draft before manual force-sync trigger';
        (app as any).queueSaveDocument();

        // Wait 500ms
        mock.timers.tick(500);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        assert.strictEqual(cloudSyncCount, 0);
        assert.ok(app.cloudSyncDebounceTimer !== null);

        // Trigger manual modal force-sync handler (which calls cancelDebounceTimers + adapter.sync)
        app.cancelDebounceTimers();
        app.googleDriveAdapter!.queueMutation((app as any).currentDoc.id, 'update', { ...(app as any).currentDoc });
        await app.googleDriveAdapter!.sync();
        await settleAsync(app, 10);

        assert.strictEqual(cloudSyncCount, 1);
        assert.strictEqual(app.cloudSyncDebounceTimer, null);

        // Advance 2000ms past the initial debounce window
        mock.timers.tick(2000);
        await settleAsync(app, 10);

        assert.strictEqual(cloudSyncCount, 1, 'Manual trigger must preempt without duplicate debounced call');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C2.3: Interleaved rapid typing and manual preemption stress cycle', async () => {
      const { app, cleanup, win } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        let cloudSyncCount = 0;
        const origSync = app.googleDriveAdapter!.sync.bind(app.googleDriveAdapter!);
        app.googleDriveAdapter!.sync = async () => {
          cloudSyncCount++;
          return origSync();
        };

        // Execute 5 consecutive cycles of typing -> wait 200ms -> emergency flush
        for (let cycle = 1; cycle <= 5; cycle++) {
          (app as any).currentDoc.content = `Cycle ${cycle} content`;
          (app as any).queueSaveDocument();

          mock.timers.tick(200);
          await settleAsync(app, 5);

          // Flush while both timers are active
          await (win as any).DaylightBridgeClient.flushPendingEdits();
          await settleAsync(app, 10);

          assert.strictEqual(app.cloudSyncDebounceTimer, null, `Cycle ${cycle}: timer must be cancelled`);
          assert.strictEqual(cloudSyncCount, cycle, `Cycle ${cycle}: cloud sync count must match cycle`);

          // Tick past 1500ms to guarantee no orphaned timers fire
          mock.timers.tick(1600);
          await settleAsync(app, 5);
          assert.strictEqual(cloudSyncCount, cycle, `Cycle ${cycle}: no orphaned timer fires`);
        }
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Emergency Save Point (<50ms & onFlushCompleted(true, 0))
  // ==========================================================================

  describe('Challenge 3: Emergency Save Point Performance & Bridge Verification', () => {
    test('Empirical C3.1: flushPendingEdits() commits editor content and calls onFlushCompleted(true, 0) within <50ms', async () => {
      const { app, cleanup, win, db } = await createStressHarness();

      try {
        const emergencyContent = `CRITICAL_EMERGENCY_CHAPTER_DATA_${Date.now()}_` + 'A'.repeat(5000);

        // Attach editor mock that simulates active unsaved typing buffer in canvas
        app.editor = {
          getContent: () => emergencyContent,
          destroy: () => {},
        } as any;

        let flushNotificationReceived = false;
        let flushSuccess: boolean | null = null;
        let flushCode: number | null = null;

        // Register native bridge receiver (/dev/input/event3 hall sensor or onPause listener)
        (win as any).DaylightBridge = {
          onFlushCompleted: (success: boolean, code: number) => {
            flushNotificationReceived = true;
            flushSuccess = success;
            flushCode = code;
          },
        };

        // Execute emergency flush and measure real wall-clock execution time
        const startTime = performance.now();
        await (win as any).DaylightBridgeClient.flushPendingEdits();
        const durationMs = performance.now() - startTime;

        // 1. Verify latency requirement: strictly < 50ms (sub-50ms Android save point)
        assert.ok(
          durationMs < 50,
          `Emergency flush execution must be strictly < 50ms (observed: ${durationMs.toFixed(2)}ms)`
        );

        // 2. Verify Android bridge callback was invoked with (true, 0)
        assert.strictEqual(
          flushNotificationReceived,
          true,
          'window.DaylightBridge.onFlushCompleted must be invoked'
        );
        assert.strictEqual(flushSuccess, true, 'onFlushCompleted success parameter must be true');
        assert.strictEqual(flushCode, 0, 'onFlushCompleted code parameter must be 0 (OK)');

        // 3. Verify editor content was committed to SQLite database
        const savedDoc = await app.repository.getDocument(SEED_DOCUMENT_ID);
        assert.strictEqual(
          savedDoc?.content,
          emergencyContent,
          'Committed document in repository must match emergency editor buffer'
        );

        // 4. Verify raw SQLite table has persisted row
        const rows = await db.executeSql<{ content: string }>(
          'SELECT content FROM documents WHERE id = ?;',
          [SEED_DOCUMENT_ID]
        );
        assert.strictEqual(rows[0]?.content, emergencyContent, 'Raw SQLite table row must match editor content');
      } finally {
        await cleanup();
      }
    });

    test('Empirical C3.2: High-throughput burst of 10 sequential emergency flushes all complete in <50ms', async () => {
      const { app, cleanup, win } = await createStressHarness();

      try {
        let callbackCount = 0;
        (win as any).DaylightBridge = {
          onFlushCompleted: (success: boolean, code: number) => {
            if (success && code === 0) callbackCount++;
          },
        };

        const durations: number[] = [];
        for (let i = 0; i < 10; i++) {
          const testContent = `Rapid emergency flush content iteration ${i}`;
          app.editor = {
            getContent: () => testContent,
            destroy: () => {},
          } as any;

          const start = performance.now();
          await (win as any).DaylightBridgeClient.flushPendingEdits();
          const elapsed = performance.now() - start;
          durations.push(elapsed);

          assert.ok(elapsed < 50, `Flush ${i} took ${elapsed.toFixed(2)}ms, exceeding 50ms limit`);

          const doc = await app.repository.getDocument(SEED_DOCUMENT_ID);
          assert.strictEqual(doc?.content, testContent);
        }

        assert.strictEqual(callbackCount, 10, 'All 10 emergency flushes must invoke onFlushCompleted(true, 0)');
        const maxDuration = Math.max(...durations);
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        assert.ok(maxDuration < 50, `Max duration ${maxDuration.toFixed(2)}ms must be < 50ms`);
        assert.ok(avgDuration < 25, `Average duration ${avgDuration.toFixed(2)}ms must be < 25ms`);
      } finally {
        await cleanup();
      }
    });

    test('Empirical C3.3: Emergency flush handles error gracefully and invokes onFlushCompleted(false, 0)', async () => {
      const { app, cleanup, win } = await createStressHarness();

      try {
        let failCallbackInvoked = false;
        let failSuccess: boolean | null = null;
        let failCode: number | null = null;

        (win as any).DaylightBridge = {
          onFlushCompleted: (success: boolean, code: number) => {
            failCallbackInvoked = true;
            failSuccess = success;
            failCode = code;
          },
        };

        // Force repository saveDocument to fail
        app.repository.saveDocument = async () => {
          throw new Error('Simulated I/O Disk Write Failure');
        };

        await (win as any).DaylightBridgeClient.flushPendingEdits();

        assert.strictEqual(
          failCallbackInvoked,
          true,
          'onFlushCompleted must be invoked even when saveDocument encounters failure'
        );
        assert.strictEqual(failSuccess, false, 'onFlushCompleted success must be false upon failure');
        assert.strictEqual(failCode, 0, 'onFlushCompleted code must be 0');
      } finally {
        await cleanup();
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Offline Queue Buffering During Debounce
  // ==========================================================================

  describe('Challenge 4: Offline Queue Buffering During Debounce Verification', () => {
    test('Empirical C4.1: Typing while offline updates SQLite at 250ms, queues mutation, skips cloud sync, and displays offline count', async () => {
      const { app, cleanup, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        // Step 1: Transition into offline mode
        app.googleDriveAdapter!.setOnline(false);
        Object.defineProperty(globalThis, 'navigator', {
          value: { onLine: false },
          configurable: true,
          writable: true,
        });

        const initialServerCallCount = server.callHistory.length;

        // Step 2: User types manuscript draft while offline
        const offlineManuscriptText = 'Chapter 1: Writing offline in the desert on Daylight DC1 LivePaper.';
        (app as any).currentDoc.content = offlineManuscriptText;
        (app as any).queueSaveDocument();

        // Step 3: Advance 250ms (local SQLite debounce threshold)
        mock.timers.tick(250);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        // Verification at t=250ms:
        // A. Local SQLite database has updated with new content
        const savedDoc = await app.repository.getDocument(SEED_DOCUMENT_ID);
        assert.strictEqual(
          savedDoc?.content,
          offlineManuscriptText,
          'Local SQLite repository must persist offline edits at 250ms'
        );

        // B. Mutation enters offline mutation queue
        const pendingQueueCount = await app.syncQueue!.getPendingCount();
        assert.ok(
          pendingQueueCount >= 1,
          `Mutation must enter offline queue at 250ms (observed pendingCount: ${pendingQueueCount})`
        );

        // C. Cloud sync was NOT called over network
        const callsAfter250ms = server.callHistory.length - initialServerCallCount;
        assert.strictEqual(
          callsAfter250ms,
          0,
          `No cloud API requests must be issued while offline (observed: ${callsAfter250ms})`
        );

        // Step 4: Advance another 1500ms (cloud debounce expiration)
        mock.timers.tick(1500);
        while (app.cloudSyncDebounceTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        // Verification after cloud debounce expires:
        // A. Cloud sync still was NOT called
        const callsAfter1500ms = server.callHistory.length - initialServerCallCount;
        assert.strictEqual(
          callsAfter1500ms,
          0,
          `Cloud sync must remain deferred without network requests (observed: ${callsAfter1500ms})`
        );

        // B. Status indicator reflects offline state and displays queued count
        const currentStatus = app.googleDriveAdapter!.getStatus();
        assert.strictEqual(currentStatus.state, 'offline', 'Sync status state must be offline');
        assert.ok(currentStatus.pendingCount >= 1, 'Sync status pendingCount must reflect queued mutation');

        assert.ok(app.syncIndicator, 'syncIndicator must exist');
        assert.ok(
          app.syncIndicator.element?.classList.contains('sync-state-offline'),
          'Pill element must have sync-state-offline class'
        );
        assert.strictEqual(
          app.syncIndicator.glyphEl?.textContent,
          '○',
          'Sol:OS offline glyph must be ○'
        );
        assert.ok(
          app.syncIndicator.labelEl?.textContent?.includes('Offline'),
          `Status label must contain "Offline" (observed: "${app.syncIndicator.labelEl?.textContent}")`
        );
        assert.ok(
          app.syncIndicator.labelEl?.textContent?.includes(String(currentStatus.pendingCount)),
          `Status label must display offline count "${currentStatus.pendingCount}" (observed: "${app.syncIndicator.labelEl?.textContent}")`
        );
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C4.2: Multiple offline document edits coalesce and display accumulated pending count', async () => {
      const { app, cleanup } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        app.googleDriveAdapter!.setOnline(false);
        Object.defineProperty(globalThis, 'navigator', {
          value: { onLine: false },
          configurable: true,
          writable: true,
        });

        // Edit document 1
        (app as any).currentDoc.content = 'Edit version 1 offline';
        (app as any).queueSaveDocument();
        mock.timers.tick(300);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        // Edit document 1 again (coalesces)
        (app as any).currentDoc.content = 'Edit version 2 offline';
        (app as any).queueSaveDocument();
        mock.timers.tick(300);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        // Allow cloud debounce to settle
        mock.timers.tick(1600);
        while (app.cloudSyncDebounceTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        const status = app.googleDriveAdapter!.getStatus();
        assert.strictEqual(status.state, 'offline');
        assert.strictEqual(status.pendingCount, 1, 'Coalesced offline mutation count must be 1');
        assert.strictEqual(app.syncIndicator?.labelEl?.textContent, 'Offline (1)');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C4.3: Network restoration drains buffered offline mutations and transitions indicator to Synced', async () => {
      const { app, cleanup, win, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        // Step 1: Start offline and buffer edit
        app.googleDriveAdapter!.setOnline(false);
        Object.defineProperty(globalThis, 'navigator', {
          value: { onLine: false },
          configurable: true,
          writable: true,
        });

        (app as any).currentDoc.content = 'Restored online manuscript edition';
        (app as any).queueSaveDocument();

        mock.timers.tick(2000);
        while (app.flushTimer !== null || app.cloudSyncDebounceTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        assert.strictEqual(app.googleDriveAdapter!.getStatus().state, 'offline');
        assert.strictEqual(app.syncIndicator?.labelEl?.textContent, 'Offline (1)');

        // Step 2: Bring network back online
        app.googleDriveAdapter!.setOnline(true);
        Object.defineProperty(globalThis, 'navigator', {
          value: { onLine: true },
          configurable: true,
          writable: true,
        });

        // Trigger background sync drain via bridge dispatcher
        const drainResult = await (win as any).DaylightBridgeClient.triggerBackgroundSync();
        await settleAsync(app, 15);

        assert.ok(drainResult.pushed >= 1, `Queue drain must push offline mutations (pushed: ${drainResult.pushed})`);
        assert.strictEqual(
          app.googleDriveAdapter!.getStatus().state,
          'synced',
          'Sync state must transition to synced after drain'
        );
        assert.strictEqual(
          app.googleDriveAdapter!.getStatus().pendingCount,
          0,
          'Pending count must reset to 0 after drain'
        );

        // Verify status pill UI updated to Synced
        assert.ok(
          app.syncIndicator?.element?.classList.contains('sync-state-synced'),
          'Pill must have sync-state-synced class'
        );
        assert.strictEqual(app.syncIndicator?.glyphEl?.textContent, '●');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 5: Document Switching During Debounce Race (<250ms & <1500ms)
  // ==========================================================================

  describe('Challenge 5: Document Switching During Debounce Race Verification', () => {

    test('Empirical C5.1: Rapid typing burst in Document A followed immediately by switch to Document B at t < 250ms (t=100ms)', async () => {
      const { app, cleanup, db, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        // Step 1: Create Document A and Document B in SQLite repository
        const docARecord: Partial<DocumentRecord> & { id: string } = {
          id: 'doc-manuscript-alpha',
          title: 'Manuscript Alpha',
          content: 'Original unedited content of Document A',
          created_at: 1727400000000,
          updated_at: 1727400000000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: null,
        };
        await app.repository.saveDocument(docARecord);

        const docBRecord: Partial<DocumentRecord> & { id: string } = {
          id: 'doc-manuscript-beta',
          title: 'Manuscript Beta',
          content: 'Original unedited content of Document B',
          created_at: 1727400010000,
          updated_at: 1727400010000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: 'gdrive-file-id-beta-002',
        };
        await app.repository.saveDocument(docBRecord);
        server.seedFile({
          id: 'gdrive-file-id-beta-002',
          name: 'Manuscript Beta',
          content: 'Original unedited content of Document B',
          parents: ['folder-mss-test'],
          mimeType: 'application/vnd.google-apps.document',
        });

        // Step 2: Load Document A as active document
        await app.loadActiveDocument('doc-manuscript-alpha');
        assert.strictEqual((app as any).currentDoc?.id, 'doc-manuscript-alpha');
        assert.strictEqual(app.activeDocumentId, 'doc-manuscript-alpha');

        // Setup mock editor reflecting active typing buffer
        let activeEditorContent = 'Original unedited content of Document A';
        app.editor = {
          getContent: () => activeEditorContent,
          setContent: (c: string) => { activeEditorContent = c; },
          loadDocument: (doc: DocumentRecord) => { activeEditorContent = doc.content || ''; },
          destroy: () => {},
        } as any;

        // Step 3: Simulate rapid typing burst in Document A
        const docABurstContent = 'Document A: Groundbreaking research draft typed at 120 WPM burst.';
        activeEditorContent = docABurstContent;
        (app as any).currentDoc.content = docABurstContent;
        (app as any).queueSaveDocument();

        // Step 4: Advance time to t=100ms (< 250ms local debounce threshold)
        mock.timers.tick(100);
        await settleAsync(app, 5);

        // Verify active debounce state at t=100ms
        assert.ok(app.flushTimer !== null, 'flushTimer (250ms) must still be pending at t=100ms');
        assert.ok(app.cloudSyncDebounceTimer !== null, 'cloudSyncDebounceTimer (1500ms) must still be pending at t=100ms');

        // Step 5: User immediately clicks Document B in left library drawer (< 250ms)
        await app.loadActiveDocument('doc-manuscript-beta');
        await settleAsync(app, 10);

        // --- VERIFICATION 1: Debounce timers are properly cancelled and reset ---
        assert.strictEqual(app.flushTimer, null, 'flushTimer must be cancelled and reset to null on doc switch');
        assert.strictEqual(app.cloudSyncDebounceTimer, null, 'cloudSyncDebounceTimer must be cancelled and reset to null on doc switch');
        assert.strictEqual(app.saveDebounceTimer, null, 'saveDebounceTimer alias must be reset to null');

        // --- VERIFICATION 2: Document A edits are NOT dropped from SQLite ---
        const savedDocA = await app.repository.getDocument('doc-manuscript-alpha');
        assert.strictEqual(
          savedDocA?.content,
          docABurstContent,
          'Document A edits must be persisted to SQLite during document switch'
        );

        const rawRowsA = await db.executeSql<{ content: string }>(
          'SELECT content FROM documents WHERE id = ?;',
          ['doc-manuscript-alpha']
        );
        assert.strictEqual(
          rawRowsA[0]?.content,
          docABurstContent,
          'Direct raw SQLite query must confirm Document A edits are safely committed'
        );

        // --- VERIFICATION 3: Document B loaded cleanly without corruption ---
        assert.strictEqual((app as any).currentDoc?.id, 'doc-manuscript-beta', 'Active document must now be Document B');
        assert.strictEqual(app.activeDocumentId, 'doc-manuscript-beta', 'activeDocumentId must be Document B');
        assert.strictEqual((app as any).currentDoc?.content, 'Original unedited content of Document B');
        assert.strictEqual(activeEditorContent, 'Original unedited content of Document B');

        const savedDocB = await app.repository.getDocument('doc-manuscript-beta');
        assert.strictEqual(
          savedDocB?.content,
          'Original unedited content of Document B',
          'Document B in SQLite must NOT contain Document A edits'
        );

        // --- VERIFICATION 4: Document B is NOT erroneously pushed to Google Drive for Document A edits ---
        // Advance time past the original 250ms and 1500ms debounce boundaries (advance by 3000ms)
        mock.timers.tick(3000);
        await settleAsync(app, 10);

        // Ensure no timers fired during the 3000ms window
        assert.strictEqual(app.flushTimer, null);
        assert.strictEqual(app.cloudSyncDebounceTimer, null);

        // Assert no network requests were sent to Google Drive targeting Document B
        const docBCalls = server.callHistory.filter(call =>
          call.url.includes('doc-manuscript-beta') || call.url.includes('gdrive-file-id-beta-002')
        );
        assert.strictEqual(
          docBCalls.length,
          0,
          `Document B must NOT receive any automatic Google Drive calls (observed: ${docBCalls.length})`
        );

        // Assert staged mutations in sync adapter
        const stagedMutations = (app.googleDriveAdapter as any).queue;
        const bMutations = stagedMutations.filter((m: any) => m.entity_id === 'doc-manuscript-beta');
        assert.strictEqual(bMutations.length, 0, 'Document B must NOT be staged in sync adapter queue');

        const aMutations = stagedMutations.filter((m: any) => m.entity_id === 'doc-manuscript-alpha');
        assert.strictEqual(aMutations.length, 1, 'Document A must be staged in sync adapter queue');
        assert.strictEqual(aMutations[0].payload.content, docABurstContent);

        // Drain the sync adapter queue
        await app.googleDriveAdapter!.sync();
        await settleAsync(app, 10);

        // Verify server call history after drain:
        // Document A was synced as new file, Document B was never touched
        const callsWithDocAContent = server.callHistory.filter(call =>
          typeof call.body === 'string' && call.body.includes(docABurstContent)
        );
        assert.ok(callsWithDocAContent.length >= 1, 'Document A burst content must be pushed to Google Drive');

        const callsPatchingDocB = server.callHistory.filter(call =>
          call.url.includes('gdrive-file-id-beta-002')
        );
        assert.strictEqual(
          callsPatchingDocB.length,
          0,
          'Document B remote file must NEVER be patched with Document A burst content'
        );
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C5.2: Rapid typing burst in Document A followed by switch to Document B at 250ms < t < 1500ms (t=500ms)', async () => {
      const { app, cleanup, db, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        const docARecord: Partial<DocumentRecord> & { id: string } = {
          id: 'doc-alpha-500',
          title: 'Manuscript Alpha 500ms',
          content: 'Alpha initial draft content',
          created_at: 1727400000000,
          updated_at: 1727400000000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: 'gdrive-file-alpha-500',
        };
        await app.repository.saveDocument(docARecord);
        server.seedFile({
          id: 'gdrive-file-alpha-500',
          name: 'Manuscript Alpha 500ms',
          content: 'Alpha initial draft content',
          parents: ['folder-mss-test'],
          mimeType: 'application/vnd.google-apps.document',
        });

        const docBRecord: Partial<DocumentRecord> & { id: string } = {
          id: 'doc-beta-500',
          title: 'Manuscript Beta 500ms',
          content: 'Beta initial draft content',
          created_at: 1727400010000,
          updated_at: 1727400010000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: 'gdrive-file-beta-500',
        };
        await app.repository.saveDocument(docBRecord);
        server.seedFile({
          id: 'gdrive-file-beta-500',
          name: 'Manuscript Beta 500ms',
          content: 'Beta initial draft content',
          parents: ['folder-mss-test'],
          mimeType: 'application/vnd.google-apps.document',
        });

        await app.loadActiveDocument('doc-alpha-500');

        let editorText = 'Alpha initial draft content';
        app.editor = {
          getContent: () => editorText,
          setContent: (c: string) => { editorText = c; },
          loadDocument: (doc: DocumentRecord) => { editorText = doc.content || ''; },
          destroy: () => {},
        } as any;

        // Step 1: User types burst in Document A
        const alphaBurst = 'Alpha Revision at 500ms: Extensive prose updates authored prior to switch.';
        editorText = alphaBurst;
        (app as any).currentDoc.content = alphaBurst;
        (app as any).queueSaveDocument();

        // Step 2: Advance 250ms (local SQLite flush fires, but cloud 1500ms timer still has 1250ms remaining)
        mock.timers.tick(250);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        assert.strictEqual(app.flushTimer, null, 'flushTimer must have completed at 250ms');
        assert.ok(app.cloudSyncDebounceTimer !== null, 'cloudSyncDebounceTimer must still be pending');

        // Step 3: Advance to t=500ms (1000ms left before cloud timer would fire)
        mock.timers.tick(250);
        await settleAsync(app, 5);
        assert.ok(app.cloudSyncDebounceTimer !== null, 'cloudSyncDebounceTimer must still be active at t=500ms');

        // Step 4: Click Document B at t=500ms (250ms < t < 1500ms)
        await app.loadActiveDocument('doc-beta-500');
        await settleAsync(app, 10);

        // --- VERIFICATION 1: Debounce timer properly cancelled ---
        assert.strictEqual(
          app.cloudSyncDebounceTimer,
          null,
          'Pending 1500ms cloud timer must be cancelled and reset to null when switching at t=500ms'
        );
        assert.strictEqual(app.flushTimer, null);

        // --- VERIFICATION 2: Document A edits in SQLite ---
        const savedAlpha = await app.repository.getDocument('doc-alpha-500');
        assert.strictEqual(savedAlpha?.content, alphaBurst, 'Document A edits must be preserved in SQLite');

        // --- VERIFICATION 3: Document B not pushed to Google Drive for Document A edits ---
        // Advance time past the original 1500ms boundary (advance 2000ms to t=2500ms)
        const initialCallCount = server.callHistory.length;
        mock.timers.tick(2000);
        await settleAsync(app, 10);

        const callsDuringWait = server.callHistory.length - initialCallCount;
        assert.strictEqual(
          callsDuringWait,
          0,
          `No automatic cloud sync must execute at original t=1500ms (calls observed: ${callsDuringWait})`
        );

        // Document B should not have been modified on server
        const remoteBeta = server.files.get('gdrive-file-beta-500');
        assert.strictEqual(
          remoteBeta?.content,
          'Beta initial draft content',
          'Remote Document B must not contain Document A edits'
        );
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C5.3: End-to-end LeftLibraryDrawer DOM click interaction during active debounce (<150ms)', async () => {
      const { app, cleanup, db, server, win } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        // Create Document A and Document B
        await app.repository.saveDocument({
          id: 'doc-drawer-alpha',
          title: 'Drawer Manuscript Alpha',
          content: 'Drawer Alpha initial content',
          created_at: 1727400000000,
          updated_at: 1727400000000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
        });
        await app.repository.saveDocument({
          id: 'doc-drawer-beta',
          title: 'Drawer Manuscript Beta',
          content: 'Drawer Beta initial content',
          created_at: 1727400010000,
          updated_at: 1727400010000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: 'gdrive-file-drawer-beta',
        });
        server.seedFile({
          id: 'gdrive-file-drawer-beta',
          name: 'Drawer Manuscript Beta',
          content: 'Drawer Beta initial content',
          parents: ['folder-mss-test'],
          mimeType: 'application/vnd.google-apps.document',
        });

        // Initialize LeftLibraryDrawer with DOM container
        const drawerContainer = win.document.createElement('aside');
        drawerContainer.className = 'drawer drawer-left';
        win.document.body.appendChild(drawerContainer);

        let selectPromise: Promise<void> | null = null;
        const leftDrawer = new LeftLibraryDrawer({
          container: drawerContainer as unknown as HTMLElement,
          shellElement: win.document.getElementById('app') as unknown as HTMLElement,
          repository: app.repository,
          onSelectDocument: (docId: string) => {
            selectPromise = app.loadActiveDocument(docId);
            return selectPromise;
          },
        });
        app.leftDrawer = leftDrawer;
        await leftDrawer.init();
        await leftDrawer.refresh();

        // Load Document A
        await app.loadActiveDocument('doc-drawer-alpha');

        let editorBuffer = 'Drawer Alpha initial content';
        app.editor = {
          getContent: () => editorBuffer,
          setContent: (c: string) => { editorBuffer = c; },
          loadDocument: (doc: DocumentRecord) => { editorBuffer = doc.content || ''; },
          destroy: () => {},
        } as any;

        // Locate Document B card in the DOM
        const docBCard = drawerContainer.querySelector('.document-card[data-id="doc-drawer-beta"]') as unknown as HTMLElement;
        assert.ok(docBCard, 'Document B card must exist in LeftLibraryDrawer DOM hierarchy');

        // Step 1: Rapid typing burst in Document A
        const alphaBurstDOM = 'Drawer Alpha Burst: Authored in editor right before user taps drawer card.';
        editorBuffer = alphaBurstDOM;
        (app as any).currentDoc.content = alphaBurstDOM;
        (app as any).queueSaveDocument();

        // Step 2: Wait 120ms (< 250ms)
        mock.timers.tick(120);
        await settleAsync(app, 5);
        assert.ok(app.flushTimer !== null, 'flushTimer pending at 120ms');

        // Step 3: User taps Document B card in the LeftLibraryDrawer DOM
        docBCard.click();
        if (selectPromise) {
          await selectPromise;
        }
        await settleAsync(app, 15);

        // --- VERIFICATIONS ---
        // 1. Timers cancelled
        assert.strictEqual(app.flushTimer, null, 'flushTimer cancelled by DOM card click');
        assert.strictEqual(app.cloudSyncDebounceTimer, null, 'cloudSyncDebounceTimer cancelled by DOM card click');

        // 2. Document A persisted to SQLite
        const savedAlpha = await app.repository.getDocument('doc-drawer-alpha');
        assert.strictEqual(savedAlpha?.content, alphaBurstDOM, 'Document A content safely written to SQLite via drawer click');

        // 3. Document B is now active
        assert.strictEqual((app as any).currentDoc?.id, 'doc-drawer-beta');
        assert.strictEqual(editorBuffer, 'Drawer Beta initial content');

        // 4. Drawer UI highlight updated
        assert.ok(
          docBCard.classList.contains('active-doc'),
          'Document B card must receive active-doc class in LeftLibraryDrawer'
        );

        // 5. Zero accidental sync calls for Document B
        mock.timers.tick(2000);
        await settleAsync(app, 10);
        const betaCalls = server.callHistory.filter(c => c.url.includes('gdrive-file-drawer-beta'));
        assert.strictEqual(betaCalls.length, 0, 'No accidental sync calls for Document B');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C5.4: Ping-Pong / Rapid interleaved document switching stress (<100ms per switch)', async () => {
      const { app, cleanup, db, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        await app.repository.saveDocument({
          id: 'ping-alpha',
          title: 'Ping Alpha',
          content: 'Initial Ping Alpha',
          created_at: 1727400000000,
          updated_at: 1727400000000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
        });
        await app.repository.saveDocument({
          id: 'ping-beta',
          title: 'Ping Beta',
          content: 'Initial Ping Beta',
          created_at: 1727400010000,
          updated_at: 1727400010000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
        });

        await app.loadActiveDocument('ping-alpha');

        let currentEditor = 'Initial Ping Alpha';
        app.editor = {
          getContent: () => currentEditor,
          setContent: (c: string) => { currentEditor = c; },
          loadDocument: (doc: DocumentRecord) => { currentEditor = doc.content || ''; },
          destroy: () => {},
        } as any;

        // Perform 4 rapid interleaved switches with 80ms bursts (< 250ms debounce)
        for (let cycle = 1; cycle <= 4; cycle++) {
          // Type in Alpha
          const textA = `Alpha Iteration ${cycle} typing buffer data`;
          currentEditor = textA;
          (app as any).currentDoc.content = textA;
          (app as any).queueSaveDocument();

          mock.timers.tick(80);
          await settleAsync(app, 5);

          // Switch to Beta at t=80ms
          await app.loadActiveDocument('ping-beta');
          await settleAsync(app, 5);
          assert.strictEqual(app.flushTimer, null);
          assert.strictEqual(app.cloudSyncDebounceTimer, null);

          // Type in Beta
          const textB = `Beta Iteration ${cycle} typing buffer data`;
          currentEditor = textB;
          (app as any).currentDoc.content = textB;
          (app as any).queueSaveDocument();

          mock.timers.tick(80);
          await settleAsync(app, 5);

          // Switch back to Alpha at t=80ms
          await app.loadActiveDocument('ping-alpha');
          await settleAsync(app, 5);
          assert.strictEqual(app.flushTimer, null);
          assert.strictEqual(app.cloudSyncDebounceTimer, null);
        }

        // Verify final persistence in SQLite: both documents must have exact final contents
        const finalA = await app.repository.getDocument('ping-alpha');
        const finalB = await app.repository.getDocument('ping-beta');

        assert.strictEqual(
          finalA?.content,
          'Alpha Iteration 4 typing buffer data',
          'Document Alpha must retain final iteration 4 content without data loss'
        );
        assert.strictEqual(
          finalB?.content,
          'Beta Iteration 4 typing buffer data',
          'Document Beta must retain final iteration 4 content without data loss'
        );

        // Drain sync adapter
        await app.googleDriveAdapter!.sync();
        await settleAsync(app, 15);

        // Verify both documents synced to Google Drive with their distinct contents
        const filesOnServer = Array.from(server.files.values());
        const alphaFile = filesOnServer.find(f => f.name === 'Ping Alpha');
        const betaFile = filesOnServer.find(f => f.name === 'Ping Beta');

        assert.ok(alphaFile, 'Google Drive must have Ping Alpha file');
        assert.ok(betaFile, 'Google Drive must have Ping Beta file');
        assert.strictEqual(alphaFile?.content, 'Alpha Iteration 4 typing buffer data');
        assert.strictEqual(betaFile?.content, 'Beta Iteration 4 typing buffer data');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C5.5: Google Drive file ID isolation and metadata integrity during cross-document switch', async () => {
      const { app, cleanup, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        // Document A: new, no google_drive_file_id
        await app.repository.saveDocument({
          id: 'doc-iso-alpha',
          title: 'Isolation Alpha (Local Only)',
          content: 'Brand new manuscript without cloud file ID',
          created_at: 1727400000000,
          updated_at: 1727400000000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: null,
        });

        // Document B: existing on Google Drive
        await app.repository.saveDocument({
          id: 'doc-iso-beta',
          title: 'Isolation Beta (Cloud Linked)',
          content: 'Pre-existing manuscript with remote file ID',
          created_at: 1727400010000,
          updated_at: 1727400010000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
          google_drive_file_id: 'gdrive-file-iso-beta-777',
        });
        server.seedFile({
          id: 'gdrive-file-iso-beta-777',
          name: 'Isolation Beta (Cloud Linked)',
          content: 'Pre-existing manuscript with remote file ID',
          parents: ['folder-mss-test'],
          mimeType: 'application/vnd.google-apps.document',
        });

        await app.loadActiveDocument('doc-iso-alpha');

        let editorText = 'Brand new manuscript without cloud file ID';
        app.editor = {
          getContent: () => editorText,
          setContent: (c: string) => { editorText = c; },
          loadDocument: (doc: DocumentRecord) => { editorText = doc.content || ''; },
          destroy: () => {},
        } as any;

        // Type burst in Document A
        const alphaBurst = 'Isolation Alpha Content: Written right before switching to Beta.';
        editorText = alphaBurst;
        (app as any).currentDoc.content = alphaBurst;
        (app as any).queueSaveDocument();

        // Switch to Document B at t=100ms
        mock.timers.tick(100);
        await settleAsync(app, 5);
        await app.loadActiveDocument('doc-iso-beta');
        await settleAsync(app, 10);

        // Verify Document A retained null file ID
        const docA = await app.repository.getDocument('doc-iso-alpha');
        assert.strictEqual(docA?.google_drive_file_id, null, 'Document A must retain null file ID');

        // Verify Document B retained its file ID
        const docB = await app.repository.getDocument('doc-iso-beta');
        assert.strictEqual(docB?.google_drive_file_id, 'gdrive-file-iso-beta-777');

        // Verify staged mutation for Document A is 'create', NOT 'update'
        const staged = (app.googleDriveAdapter as any).queue;
        const mutA = staged.find((m: any) => m.entity_id === 'doc-iso-alpha');
        assert.ok(mutA, 'Mutation for Document A must be queued');
        assert.strictEqual(mutA.operation, 'create', 'Operation for Document A must be create');

        // Verify no mutation for Document B was staged
        const mutB = staged.find((m: any) => m.entity_id === 'doc-iso-beta');
        assert.strictEqual(mutB, undefined, 'No mutation for Document B should be queued');
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

    test('Empirical C5.6: Typing resumed in Document B after switch re-arms dual-debounce correctly without stale references', async () => {
      const { app, cleanup, server } = await createStressHarness();
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

      try {
        await app.repository.saveDocument({
          id: 'doc-resume-alpha',
          title: 'Resume Alpha',
          content: 'Alpha initial text',
          created_at: 1727400000000,
          updated_at: 1727400000000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
        });
        await app.repository.saveDocument({
          id: 'doc-resume-beta',
          title: 'Resume Beta',
          content: 'Beta initial text',
          created_at: 1727400010000,
          updated_at: 1727400010000,
          deleted_at: null,
          is_title_custom: false,
          format_version: 1,
          sync_status: 'synced',
        });

        await app.loadActiveDocument('doc-resume-alpha');

        let editorText = 'Alpha initial text';
        app.editor = {
          getContent: () => editorText,
          setContent: (c: string) => { editorText = c; },
          loadDocument: (doc: DocumentRecord) => { editorText = doc.content || ''; },
          destroy: () => {},
        } as any;

        // Step 1: Type in Document A and switch to Document B at t=100ms
        editorText = 'Alpha updated text';
        (app as any).currentDoc.content = editorText;
        (app as any).queueSaveDocument();

        mock.timers.tick(100);
        await settleAsync(app, 5);
        await app.loadActiveDocument('doc-resume-beta');
        await settleAsync(app, 10);

        assert.strictEqual(app.flushTimer, null);
        assert.strictEqual(app.cloudSyncDebounceTimer, null);

        // Step 2: Author starts typing in Document B
        const betaNewText = 'Beta newly typed prose paragraph in resumed document.';
        editorText = betaNewText;
        (app as any).currentDoc.content = betaNewText;
        (app as any).queueSaveDocument();

        // Verify new timers scheduled for Document B
        assert.ok(app.flushTimer !== null, 'New flushTimer must be scheduled for Document B');
        assert.ok(app.cloudSyncDebounceTimer !== null, 'New cloudSyncDebounceTimer must be scheduled for Document B');

        // Step 3: Advance 250ms (Document B local SQLite save fires)
        mock.timers.tick(250);
        while (app.flushTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        const savedB = await app.repository.getDocument('doc-resume-beta');
        assert.strictEqual(savedB?.content, betaNewText, 'Document B must be saved to SQLite at 250ms');

        // Step 4: Advance remaining 1250ms (cloud sync fires for Document B)
        mock.timers.tick(1250);
        while (app.cloudSyncDebounceTimer !== null) {
          mock.timers.tick(1);
          await settleAsync(app, 5);
        }

        // Verify cloud sync results: both Document A (queued during switch) and Document B are synced
        const filesOnServer = Array.from(server.files.values());
        const fileA = filesOnServer.find(f => f.name === 'Resume Alpha');
        const fileB = filesOnServer.find(f => f.name === 'Resume Beta');

        assert.ok(fileA, 'Resume Alpha must be synced to Google Drive');
        assert.ok(fileB, 'Resume Beta must be synced to Google Drive');
        assert.strictEqual(fileA?.content, 'Alpha updated text');
        assert.strictEqual(fileB?.content, betaNewText);
      } finally {
        mock.timers.reset();
        await cleanup();
      }
    });

  });

});
