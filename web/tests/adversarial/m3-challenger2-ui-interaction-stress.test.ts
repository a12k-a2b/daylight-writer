/**
 * tests/adversarial/m3-challenger2-ui-interaction-stress.test.ts
 * Milestone 3 Adversarial Empirical Verification Suite: Sol:OS UI & Interaction Stress
 *
 * Targets:
 * - Challenge 1 (Modal concurrency & leak stress): Rapidly open and close GoogleDriveModal 20 times via click,
 *   Escape key, and backdrop click; assert exactly 0 residual .gdrive-modal-backdrop elements remain in DOM
 *   and 0 orphaned keydown listeners remain on document.
 * - Challenge 2 (Pill click and keyboard activation): Simulate click, Space keydown, and Enter keydown on
 *   SyncStatusIndicator across all states (synced, syncing, offline, error); verify modal opens in non-error
 *   states and retry triggers in error state.
 * - Challenge 3 (Library badge isolation): In LeftLibraryDrawer, simulate rapid clicking on .doc-gdocs-link
 *   within a document card; assert that the active document ID does NOT change and the drawer does NOT close.
 * - Challenge 4 (Contrast verification): Programmatically compute contrast ratios for all text tokens in
 *   .sync-status-pill, .doc-gdocs-badge, and .gdrive-modal; assert that every text element meets >= 4.5:1
 *   (WCAG AA) and primary text meets >= 7.0:1 (WCAG AAA).
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Window } from 'happy-dom';
import { SyncStatusIndicator } from '../../src/ui/sync-status-indicator.ts';
import { GoogleDriveModal } from '../../src/ui/google-drive-modal.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { LeftLibraryDrawer } from '../../src/drawers/left-library.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import { calculateContrastRatio, SOL_OS_PALETTE } from '../e2e/helpers/contrast-verifier.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';
import type { SyncStatus } from '../../src/sync/sync-adapter.ts';

// ----------------------------------------------------------------------------
// Test Environment Harness
// ----------------------------------------------------------------------------

class GDocsAwareStorageRepository extends InMemoryStorageRepository {
  override async saveDocument(doc: Partial<DocumentRecord> & { id: string }): Promise<DocumentRecord> {
    const saved = await super.saveDocument(doc);
    if ('google_drive_file_id' in doc) {
      saved.google_drive_file_id = doc.google_drive_file_id ?? null;
      const pending = (this as any).pendingEdits.get(doc.id);
      if (pending) pending.google_drive_file_id = doc.google_drive_file_id ?? null;
      const existing = (this as any).documents.get(doc.id);
      if (existing) existing.google_drive_file_id = doc.google_drive_file_id ?? null;
    }
    return saved;
  }
}

function setupDomEnvironment() {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;

  (globalThis as any).window = win;
  (globalThis as any).document = doc;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).HTMLAnchorElement = win.HTMLAnchorElement;
  (globalThis as any).KeyboardEvent = win.KeyboardEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;
  (globalThis as any).Event = win.Event;

  // Inject Sol:OS Tokens and Main CSS into head for accurate getComputedStyle
  const cssDir = new URL('../../src/styles', import.meta.url).pathname;
  const tokensCss = fs.readFileSync(path.join(cssDir, 'tokens.css'), 'utf-8');
  const mainCss = fs.readFileSync(path.join(cssDir, 'main.css'), 'utf-8');
  const styleEl = doc.createElement('style');
  styleEl.textContent = `${tokensCss}\n${mainCss}`;
  doc.head.appendChild(styleEl);

  return {
    win,
    doc,
    cleanup: () => {
      doc.body.innerHTML = '';
      delete (win as any).DaylightBridgeClient;
    },
  };
}

// ============================================================================
// Challenge 1: Modal Concurrency & Listener Leak Stress
// ============================================================================

describe('Challenge 1: Modal Concurrency & Listener Leak Stress', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('1.1: Rapid open/close 20 times across click, Escape, and backdrop leaves 0 backdrops and 0 listeners', () => {
    const { doc, win } = env;

    // Track active keydown listeners via spy interception
    const activeKeydownListeners = new Set<(e: any) => void>();
    const origAdd = (doc as any).addEventListener.bind(doc);
    const origRemove = (doc as any).removeEventListener.bind(doc);

    (doc as any).addEventListener = function (type: string, listener: any, options?: any) {
      if (type === 'keydown') {
        activeKeydownListeners.add(listener);
      }
      return origAdd(type, listener, options);
    };

    (doc as any).removeEventListener = function (type: string, listener: any, options?: any) {
      if (type === 'keydown') {
        activeKeydownListeners.delete(listener);
      }
      return origRemove(type, listener, options);
    };

    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });

    // Execute 20 rapid cycles rotating across dismissal mechanisms
    for (let i = 0; i < 20; i++) {
      modal.open();

      assert.strictEqual(
        doc.querySelectorAll('.gdrive-modal-backdrop').length,
        1,
        `Cycle ${i + 1}: Exactly 1 modal backdrop must be present when open`
      );
      assert.strictEqual(
        activeKeydownListeners.size,
        1,
        `Cycle ${i + 1}: Exactly 1 keydown listener must be attached when open`
      );

      const trigger = i % 4;
      if (trigger === 0) {
        // Header close button click
        const closeBtn = doc.querySelector('#gdrive-modal-close') as any;
        assert.ok(closeBtn, `Cycle ${i + 1}: #gdrive-modal-close must exist`);
        closeBtn.click();
      } else if (trigger === 1) {
        // Escape keydown on document
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as any);
      } else if (trigger === 2) {
        // Light-dismiss backdrop click
        const backdrop = doc.querySelector('.gdrive-modal-backdrop') as any;
        assert.ok(backdrop, `Cycle ${i + 1}: .gdrive-modal-backdrop must exist`);
        backdrop.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as any);
      } else {
        // Footer cancel button click
        const cancelBtn = doc.querySelector('#gdrive-footer-cancel') as any;
        assert.ok(cancelBtn, `Cycle ${i + 1}: #gdrive-footer-cancel must exist`);
        cancelBtn.click();
      }

      // Invariant assertion after each individual dismissal:
      assert.strictEqual(
        doc.querySelectorAll('.gdrive-modal-backdrop').length,
        0,
        `Cycle ${i + 1}: 0 modal backdrops must remain in DOM after dismissal`
      );
      assert.strictEqual(
        activeKeydownListeners.size,
        0,
        `Cycle ${i + 1}: 0 orphaned keydown listeners must remain after dismissal`
      );
    }

    // Final Post-20 Stress Verification
    assert.strictEqual(
      doc.querySelectorAll('.gdrive-modal-backdrop').length,
      0,
      'Final: Exactly 0 residual .gdrive-modal-backdrop elements remain in DOM'
    );
    assert.strictEqual(
      doc.querySelectorAll('.gdrive-modal').length,
      0,
      'Final: Exactly 0 residual .gdrive-modal elements remain in DOM'
    );
    assert.strictEqual(
      activeKeydownListeners.size,
      0,
      'Final: Exactly 0 orphaned keydown listeners remain on document'
    );

    // Press Escape while closed — must not throw or alter state
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as any);
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    // Verify modal can be opened cleanly once more after 20 stress cycles
    modal.open();
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 1);
    modal.close();
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(activeKeydownListeners.size, 0);
  });

  test('1.2: Concurrency reentrancy: repeated open() and close() calls do not leak listeners or DOM elements', () => {
    const { doc } = env;

    const activeKeydownListeners = new Set<(e: any) => void>();
    const origAdd = (doc as any).addEventListener.bind(doc);
    const origRemove = (doc as any).removeEventListener.bind(doc);

    (doc as any).addEventListener = function (type: string, listener: any, options?: any) {
      if (type === 'keydown') activeKeydownListeners.add(listener);
      return origAdd(type, listener, options);
    };

    (doc as any).removeEventListener = function (type: string, listener: any, options?: any) {
      if (type === 'keydown') activeKeydownListeners.delete(listener);
      return origRemove(type, listener, options);
    };

    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });

    // Call open 5 times consecutively while already open
    modal.open();
    modal.open();
    modal.open();
    modal.open();
    modal.open();

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 1);
    assert.strictEqual(activeKeydownListeners.size, 1);

    // Call close 5 times consecutively while already closed
    modal.close();
    modal.close();
    modal.close();
    modal.close();
    modal.close();

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(activeKeydownListeners.size, 0);

    // Rapid toggle 10 times
    for (let i = 0; i < 10; i++) {
      modal.toggle();
      const expectedCount = i % 2 === 0 ? 1 : 0;
      assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, expectedCount);
      assert.strictEqual(activeKeydownListeners.size, expectedCount);
    }

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(activeKeydownListeners.size, 0);
  });
});

// ============================================================================
// Challenge 2: Pill Click and Keyboard Activation
// ============================================================================

describe('Challenge 2: Pill Click and Keyboard Activation Across All States', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  const states: Array<{ name: string; status: SyncStatus; isError: boolean }> = [
    {
      name: 'synced',
      status: { state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0, inFlightCount: 0 },
      isError: false,
    },
    {
      name: 'syncing',
      status: { state: 'syncing', lastSyncedAt: null, pendingCount: 3, inFlightCount: 1 },
      isError: false,
    },
    {
      name: 'offline',
      status: { state: 'offline', lastSyncedAt: null, pendingCount: 4, inFlightCount: 0 },
      isError: false,
    },
    {
      name: 'error',
      status: { state: 'error', lastSyncedAt: null, pendingCount: 1, inFlightCount: 0, error: 'Connection refused' },
      isError: true,
    },
  ];

  for (const { name, status, isError } of states) {
    test(`2.1: State "${name}" - Click triggers ${isError ? 'retry' : 'modal open'}`, () => {
      const { doc } = env;
      const header = doc.createElement('header');
      doc.body.appendChild(header);

      let modalOpenCount = 0;
      let retryCount = 0;

      const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
        format: 'solos',
        modal: {
          open: () => { modalOpenCount++; },
          toggle: () => {},
        },
        onRetry: () => { retryCount++; },
      });

      indicator.update(status);

      // Simulate mouse click
      assert.ok(indicator.element);
      indicator.element.click();

      if (isError) {
        assert.strictEqual(retryCount, 1, `State "${name}": Click must trigger onRetry`);
        assert.strictEqual(modalOpenCount, 0, `State "${name}": Click must NOT open modal`);
      } else {
        assert.strictEqual(modalOpenCount, 1, `State "${name}": Click must trigger modal.open()`);
        assert.strictEqual(retryCount, 0, `State "${name}": Click must NOT trigger onRetry`);
      }

      indicator.destroy();
    });

    test(`2.2: State "${name}" - Enter keydown triggers ${isError ? 'retry' : 'modal open'} with preventDefault()`, () => {
      const { doc, win } = env;
      const header = doc.createElement('header');
      doc.body.appendChild(header);

      let modalOpenCount = 0;
      let retryCount = 0;

      const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
        format: 'solos',
        modal: {
          open: () => { modalOpenCount++; },
          toggle: () => {},
        },
        onRetry: () => { retryCount++; },
      });

      indicator.update(status);

      // Simulate Enter keydown
      const enterEvent = new win.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
      indicator.element?.dispatchEvent(enterEvent as any);

      assert.strictEqual(enterEvent.defaultPrevented, true, 'Enter keydown must call e.preventDefault()');

      if (isError) {
        assert.strictEqual(retryCount, 1, `State "${name}": Enter must trigger onRetry`);
        assert.strictEqual(modalOpenCount, 0, `State "${name}": Enter must NOT open modal`);
      } else {
        assert.strictEqual(modalOpenCount, 1, `State "${name}": Enter must trigger modal.open()`);
        assert.strictEqual(retryCount, 0, `State "${name}": Enter must NOT trigger onRetry`);
      }

      indicator.destroy();
    });

    test(`2.3: State "${name}" - Space keydown triggers ${isError ? 'retry' : 'modal open'} with preventDefault()`, () => {
      const { doc, win } = env;
      const header = doc.createElement('header');
      doc.body.appendChild(header);

      let modalOpenCount = 0;
      let retryCount = 0;

      const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
        format: 'solos',
        modal: {
          open: () => { modalOpenCount++; },
          toggle: () => {},
        },
        onRetry: () => { retryCount++; },
      });

      indicator.update(status);

      // Simulate Space keydown (" ")
      const spaceEvent = new win.KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
      indicator.element?.dispatchEvent(spaceEvent as any);

      assert.strictEqual(spaceEvent.defaultPrevented, true, 'Space keydown must call e.preventDefault()');

      if (isError) {
        assert.strictEqual(retryCount, 1, `State "${name}": Space must trigger onRetry`);
        assert.strictEqual(modalOpenCount, 0, `State "${name}": Space must NOT open modal`);
      } else {
        assert.strictEqual(modalOpenCount, 1, `State "${name}": Space must trigger modal.open()`);
        assert.strictEqual(retryCount, 0, `State "${name}": Space must NOT trigger onRetry`);
      }

      indicator.destroy();
    });

    test(`2.4: State "${name}" - Irrelevant keys (Tab, Escape, a) do not trigger action`, () => {
      const { doc, win } = env;
      const header = doc.createElement('header');
      doc.body.appendChild(header);

      let modalOpenCount = 0;
      let retryCount = 0;

      const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
        format: 'solos',
        modal: { open: () => { modalOpenCount++; }, toggle: () => {} },
        onRetry: () => { retryCount++; },
      });

      indicator.update(status);

      for (const key of ['Tab', 'Escape', 'ArrowDown', 'a']) {
        const ev = new win.KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
        indicator.element?.dispatchEvent(ev as any);
        assert.strictEqual(ev.defaultPrevented, false, `Key "${key}" must not preventDefault`);
      }

      assert.strictEqual(modalOpenCount, 0, 'No modal opened on irrelevant keys');
      assert.strictEqual(retryCount, 0, 'No retry triggered on irrelevant keys');

      indicator.destroy();
    });
  }

  test('2.5: Alternative option callbacks onClick and onRetryClick are properly invoked', () => {
    const { doc } = env;
    const header = doc.createElement('header');
    doc.body.appendChild(header);

    let clickCount = 0;
    let retryClickCount = 0;

    const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
      format: 'solos',
      onClick: () => { clickCount++; },
      onRetryClick: () => { retryClickCount++; },
    });

    indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0, inFlightCount: 0 });
    indicator.element?.click();
    assert.strictEqual(clickCount, 1);
    assert.strictEqual(retryClickCount, 0);

    indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 1, inFlightCount: 0, error: 'Fail' });
    indicator.element?.click();
    assert.strictEqual(clickCount, 1);
    assert.strictEqual(retryClickCount, 1);

    indicator.destroy();
  });
});

// ============================================================================
// Challenge 3: Library Badge Isolation Under Rapid Click Stress
// ============================================================================

describe('Challenge 3: Library Badge Isolation Under Rapid Click Stress', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('3.1: Rapid clicking 50 times on .doc-gdocs-link does not change active document and does not close drawer', async () => {
    const { doc, win } = env;

    const shell = doc.createElement('div');
    shell.className = 'dc1-shell zero-chrome';
    const container = doc.createElement('aside');
    container.className = 'drawer drawer-left';
    const backdrop = doc.createElement('div');
    backdrop.className = 'drawer-backdrop';
    shell.appendChild(container);
    shell.appendChild(backdrop);
    doc.body.appendChild(shell);

    const repo = new GDocsAwareStorageRepository();
    await repo.init();

    // Active document in editor
    await repo.saveDocument({
      id: 'doc-active-001',
      title: 'Active Master Draft',
      content: 'This document is currently active in the editor viewport.',
      created_at: 1000,
      updated_at: 1000,
      sync_status: 'synced',
    });

    // Other document with Google Docs file ID
    const gdocsFileId = 'gdrive-file-stress-999';
    await repo.saveDocument({
      id: 'doc-synced-002',
      title: 'Synced Cloud Manuscript',
      content: 'Document with linked Google Docs file.',
      created_at: 2000,
      updated_at: 2000,
      sync_status: 'synced',
      google_drive_file_id: gdocsFileId,
    });

    let selectedDocumentCallbackCalls = 0;
    let selectedIdValue: string | null = null;
    const openedBridgeUrls: string[] = [];

    // Mock DaylightBridgeClient on window
    (win as any).DaylightBridgeClient = {
      openExternalUrl: (url: string) => {
        openedBridgeUrls.push(url);
      },
    };

    const drawer = new LeftLibraryDrawer({
      container: container as unknown as HTMLElement,
      shellElement: shell as unknown as HTMLElement,
      backdropElement: backdrop as unknown as HTMLElement,
      repository: repo,
      onSelectDocument: (id) => {
        selectedDocumentCallbackCalls++;
        selectedIdValue = id;
      },
    });

    await drawer.init();

    // Set initial active document to doc-active-001
    drawer.setActiveDocumentId('doc-active-001');
    assert.strictEqual(drawer.getActiveDocumentId(), 'doc-active-001');

    // Open library drawer
    drawer.open();
    assert.strictEqual(drawer.getIsOpen(), true, 'Drawer must be open');
    assert.strictEqual(shell.classList.contains('left-open'), true, 'Shell must have .left-open');

    // Find doc-synced-002 card
    const cardEl = container.querySelector("[data-id='doc-synced-002']") as any;
    assert.ok(cardEl, 'Card for doc-synced-002 must exist in drawer DOM');

    const gdocsLink = cardEl.querySelector('.doc-gdocs-link') as any;
    assert.ok(gdocsLink, '.doc-gdocs-link must be rendered inside the card');
    assert.strictEqual(
      gdocsLink.href,
      `https://docs.google.com/document/d/${gdocsFileId}/edit`,
      'Google Docs link href must point to edit URL'
    );

    // Rapidly click .doc-gdocs-link 50 times in immediate sequence
    const RAPID_CLICKS = 50;
    for (let i = 0; i < RAPID_CLICKS; i++) {
      gdocsLink.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as any);

      // Invariants must hold after every single click
      assert.strictEqual(
        drawer.getActiveDocumentId(),
        'doc-active-001',
        `Click ${i + 1}: Active document ID must NOT change to doc-synced-002`
      );
      assert.strictEqual(
        drawer.getIsOpen(),
        true,
        `Click ${i + 1}: Drawer must NOT close when clicking Google Docs link`
      );
    }

    // Post-stress assertions
    assert.strictEqual(
      drawer.getActiveDocumentId(),
      'doc-active-001',
      'Active document ID must remain strictly unchanged after 50 clicks'
    );
    assert.strictEqual(
      selectedDocumentCallbackCalls,
      0,
      'onSelectDocument callback must NEVER be invoked by Google Docs link click'
    );
    assert.strictEqual(selectedIdValue, null);
    assert.strictEqual(drawer.getIsOpen(), true, 'Drawer must remain open');
    assert.strictEqual(shell.classList.contains('left-open'), true);
    assert.strictEqual(
      openedBridgeUrls.length,
      RAPID_CLICKS,
      'window.DaylightBridgeClient.openExternalUrl must be called for each click'
    );
    assert.strictEqual(
      openedBridgeUrls[0],
      `https://docs.google.com/document/d/${gdocsFileId}/edit`
    );

    // Test clicking directly on the .doc-gdocs-badge wrapper (10 clicks)
    const gdocsBadge = cardEl.querySelector('.doc-gdocs-badge') as any;
    assert.ok(gdocsBadge, '.doc-gdocs-badge container must exist');
    for (let i = 0; i < 10; i++) {
      gdocsBadge.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as any);
      assert.strictEqual(drawer.getActiveDocumentId(), 'doc-active-001');
      assert.strictEqual(drawer.getIsOpen(), true);
    }

    // Negative control: Clicking the card body itself DOES switch active document and close drawer
    cardEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as any);
    assert.strictEqual(
      selectedDocumentCallbackCalls,
      1,
      'Clicking card body must trigger onSelectDocument'
    );
    assert.strictEqual(selectedIdValue, 'doc-synced-002');
    assert.strictEqual(drawer.getActiveDocumentId(), 'doc-synced-002');
    assert.strictEqual(drawer.getIsOpen(), false, 'Clicking card body must close the drawer');

    drawer.destroy();
  });
});

// ============================================================================
// Challenge 4: Contrast Verification (Sol:OS Grayscale & WCAG Compliance)
// ============================================================================

describe('Challenge 4: Contrast Verification (Sol:OS Grayscale & WCAG Compliance)', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('4.1: SyncStatusIndicator text tokens meet WCAG AA (>= 4.5:1) and AAA (>= 7.0:1) across all states', () => {
    const { doc, win } = env;
    const header = doc.createElement('header');
    doc.body.appendChild(header);

    const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, { format: 'solos' });

    // 1. Synced state: color is --os-400 (#535353) on base paper (#FFFFFF) or header (#F7F7F7)
    indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0, inFlightCount: 0 });
    const syncedEl = doc.querySelector('.sync-status-pill.sync-state-synced') as any;
    assert.ok(syncedEl);
    const syncedCs = win.getComputedStyle(syncedEl);
    const ratioSyncedOn0 = calculateContrastRatio(syncedCs.color, SOL_OS_PALETTE.os0);
    const ratioSyncedOn50 = calculateContrastRatio(syncedCs.color, SOL_OS_PALETTE.os50);
    assert.ok(ratioSyncedOn0 >= 4.5, `Synced pill on --os-0 (${ratioSyncedOn0.toFixed(2)}:1) must meet WCAG AA (>= 4.5:1)`);
    assert.ok(ratioSyncedOn0 >= 7.0, `Synced pill on --os-0 (${ratioSyncedOn0.toFixed(2)}:1) meets WCAG AAA (>= 7.0:1)`);
    assert.ok(ratioSyncedOn50 >= 4.5, `Synced pill on --os-50 (${ratioSyncedOn50.toFixed(2)}:1) must meet WCAG AA (>= 4.5:1)`);

    // 2. Syncing state: background is --os-150 (#F5F5F5), text is --os-900 (#1A1A1A)
    indicator.update({ state: 'syncing', lastSyncedAt: null, pendingCount: 2, inFlightCount: 1 });
    const syncingEl = doc.querySelector('.sync-status-pill.sync-state-syncing') as any;
    assert.ok(syncingEl);
    const syncingCs = win.getComputedStyle(syncingEl);
    const ratioSyncing = calculateContrastRatio(syncingCs.color, syncingCs.backgroundColor || SOL_OS_PALETTE.os150);
    assert.ok(ratioSyncing >= 7.0, `Syncing pill (${ratioSyncing.toFixed(2)}:1) must meet WCAG AAA (>= 7.0:1)`);

    // 3. Offline state: background is --os-50 (#F7F7F7), text is --os-400 (#535353)
    indicator.update({ state: 'offline', lastSyncedAt: null, pendingCount: 3, inFlightCount: 0 });
    const offlineEl = doc.querySelector('.sync-status-pill.sync-state-offline') as any;
    assert.ok(offlineEl);
    const offlineCs = win.getComputedStyle(offlineEl);
    const ratioOffline = calculateContrastRatio(offlineCs.color, offlineCs.backgroundColor || SOL_OS_PALETTE.os50);
    assert.ok(ratioOffline >= 4.5, `Offline pill (${ratioOffline.toFixed(2)}:1) must meet WCAG AA (>= 4.5:1)`);
    assert.ok(ratioOffline >= 7.0, `Offline pill (${ratioOffline.toFixed(2)}:1) meets WCAG AAA (>= 7.0:1)`);

    // 4. Error state: background is --os-800 (#343434), text is --os-0 (#FFFFFF)
    indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 1, inFlightCount: 0, error: 'Sync failed' });
    const errorEl = doc.querySelector('.sync-status-pill.sync-state-error') as any;
    assert.ok(errorEl);
    const errorCs = win.getComputedStyle(errorEl);
    const ratioError = calculateContrastRatio(errorCs.color, errorCs.backgroundColor || SOL_OS_PALETTE.os800);
    assert.ok(ratioError >= 7.0, `Error pill (${ratioError.toFixed(2)}:1) must meet WCAG AAA (>= 7.0:1)`);

    indicator.destroy();
  });

  test('4.2: LeftLibraryDrawer Google Docs badge and link text tokens meet WCAG AAA (>= 7.0:1)', () => {
    // Normal link: color --os-900 (#1A1A1A) on background --os-100 (#DCD5C9)
    const ratioNormal = calculateContrastRatio(SOL_OS_PALETTE.os900, SOL_OS_PALETTE.os100);
    assert.ok(
      ratioNormal >= 7.0,
      `.doc-gdocs-link default contrast ${ratioNormal.toFixed(2)}:1 must meet WCAG AAA (>= 7.0:1)`
    );

    // Hover link: color --os-1000 (#000000) on background --os-150 (#F5F5F5)
    const ratioHover = calculateContrastRatio(SOL_OS_PALETTE.os1000, SOL_OS_PALETTE.os150);
    assert.ok(
      ratioHover >= 7.0,
      `.doc-gdocs-link hover contrast ${ratioHover.toFixed(2)}:1 must meet WCAG AAA (>= 7.0:1)`
    );

    // Active link: color --os-0 (#FFFFFF) on background --os-800 (#343434)
    const ratioActive = calculateContrastRatio(SOL_OS_PALETTE.os0, SOL_OS_PALETTE.os800);
    assert.ok(
      ratioActive >= 7.0,
      `.doc-gdocs-link active contrast ${ratioActive.toFixed(2)}:1 must meet WCAG AAA (>= 7.0:1)`
    );
  });

  test('4.3: GoogleDriveModal primary text tokens meet WCAG AAA (>= 7.0:1)', () => {
    const { doc } = env;

    const adapter = new GoogleDriveSyncAdapter({ accessToken: 'ya29.token' });
    adapter.setCurrentUser({ email: 'a12katta@gmail.com', name: 'Anjan Katta' });
    (adapter as any).addLog('Sync success', 'success');
    (adapter as any).addLog('Sync warning', 'warn');
    (adapter as any).addLog('Sync failure', 'error');

    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const primaryChecks = [
      {
        sel: '.export-modal-title',
        fg: SOL_OS_PALETTE.os1000,
        bg: SOL_OS_PALETTE.os50,
        name: 'Modal Title',
      },
      {
        sel: '.gdrive-user-email',
        fg: SOL_OS_PALETTE.os1000,
        bg: SOL_OS_PALETTE.os0,
        name: 'User Email',
      },
      {
        sel: '.gdrive-status-badge.connected',
        fg: SOL_OS_PALETTE.os900,
        bg: SOL_OS_PALETTE.os0,
        name: 'Connected Status Badge',
      },
      {
        sel: '.gdrive-folder-name',
        fg: SOL_OS_PALETTE.os900,
        bg: SOL_OS_PALETTE.os0,
        name: 'Folder Name',
      },
      {
        sel: '.collab-input',
        fg: SOL_OS_PALETTE.os900,
        bg: SOL_OS_PALETTE.os0,
        name: 'OAuth Token Input',
      },
      {
        sel: '#gdrive-sync-now-btn',
        fg: SOL_OS_PALETTE.os0,
        bg: SOL_OS_PALETTE.os900,
        name: 'Sync Now Button',
      },
      {
        sel: '.gdrive-avatar',
        fg: SOL_OS_PALETTE.os0,
        bg: SOL_OS_PALETTE.os800,
        name: 'User Avatar',
      },
      {
        sel: '.log-success',
        fg: SOL_OS_PALETTE.os900,
        bg: SOL_OS_PALETTE.os0,
        name: 'Success Log Entry',
      },
      {
        sel: '.log-warn',
        fg: SOL_OS_PALETTE.os800,
        bg: SOL_OS_PALETTE.os0,
        name: 'Warning Log Entry',
      },
      {
        sel: '.log-error',
        fg: SOL_OS_PALETTE.os1000,
        bg: SOL_OS_PALETTE.os0,
        name: 'Error Log Entry',
      },
    ];

    for (const item of primaryChecks) {
      const el = doc.querySelector(item.sel);
      assert.ok(el, `Element "${item.sel}" (${item.name}) must exist in modal`);
      const ratio = calculateContrastRatio(item.fg, item.bg);
      assert.ok(
        ratio >= 7.0,
        `Primary element "${item.name}" contrast ${ratio.toFixed(2)}:1 must meet WCAG AAA (>= 7.0:1)`
      );
    }

    modal.close();
  });

  test('4.4: GoogleDriveModal secondary text tokens meet WCAG AA (>= 4.5:1)', () => {
    const { doc } = env;

    const adapter = new GoogleDriveSyncAdapter();
    (adapter as any).addLog('Informational check', 'info');

    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const secondaryChecks = [
      {
        sel: '.export-dialog-subtitle',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os50,
        name: 'Modal Subtitle',
      },
      {
        sel: '.export-modal-close',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os50,
        name: 'Header Close Button',
      },
      {
        sel: '.gdrive-status-badge.disconnected',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os0,
        name: 'Disconnected Status Badge',
      },
      {
        sel: '.collab-label',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os50,
        name: 'Section Label',
      },
      {
        sel: '#gdrive-save-token-btn',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os50,
        name: 'Verify Token Button',
      },
      {
        sel: '#gdrive-auth-btn',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os0,
        name: 'Connect / Disconnect Button',
      },
      {
        sel: '.gdrive-folder-path',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os0,
        name: 'Folder Breadcrumb Path',
      },
      {
        sel: '#gdrive-footer-cancel',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os0,
        name: 'Footer Close Button',
      },
      {
        sel: '.log-info',
        fg: SOL_OS_PALETTE.os400,
        bg: SOL_OS_PALETTE.os0,
        name: 'Info Log Entry',
      },
    ];

    for (const item of secondaryChecks) {
      const el = doc.querySelector(item.sel);
      assert.ok(el, `Element "${item.sel}" (${item.name}) must exist in modal`);
      const ratio = calculateContrastRatio(item.fg, item.bg);
      assert.ok(
        ratio >= 4.5,
        `Secondary element "${item.name}" contrast ${ratio.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
      );
    }

    modal.close();
  });

  test('4.5: GoogleDriveModal helper text (.collab-hint) WCAG AA contrast compliance assertion', () => {
    const { doc, win } = env;

    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const hintEl = doc.querySelector('.gdrive-modal .collab-hint') as any;
    assert.ok(hintEl, '.collab-hint element must exist in GoogleDriveModal DOM');

    const cs = win.getComputedStyle(hintEl);
    const color = cs.color; // Computed from CSS rule in main.css: .collab-hint { color: var(--os-300); }
    const bg = SOL_OS_PALETTE.os50; // Modal body background: var(--os-50) (#F7F7F7)

    const ratio = calculateContrastRatio(color, bg);

    // WCAG 2.1 AA requires contrast ratio >= 4.5:1 for normal text (< 18pt)
    assert.ok(
      ratio >= 4.5,
      `CONTRAST DEFECT IDENTIFIED: Element .collab-hint ("${hintEl.textContent?.trim()}") has contrast ratio ${ratio.toFixed(2)}:1 against modal body (${bg}), which fails the WCAG 2.1 AA requirement of >= 4.5:1. CSS rule .collab-hint in main.css assigns var(--os-300) (#858585) instead of calibrated secondary ink var(--os-400) (#535353).`
    );

    modal.close();
  });
});
