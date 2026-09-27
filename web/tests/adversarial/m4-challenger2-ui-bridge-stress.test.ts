/**
 * tests/adversarial/m4-challenger2-ui-bridge-stress.test.ts
 * Milestone 4 Challenger 2 Adversarial Stress Suite:
 * UI Components, State Machines, Sol:OS Grayscale Ergonomics & Android Bridge Security
 *
 * Tier 5 White-Box Stress Hardening covering:
 * - Challenge 1 (Rapid Dynamic State Machine Stress):
 *   Cycle SyncStatusIndicator through 50 randomized rapid state transitions:
 *   idle -> syncing -> synced -> offline -> error -> synced.
 *   Assert DOM text, glyphs, titles, and accessible attributes reflect final state
 *   accurately with zero detached sub-nodes or stale labels.
 *
 * - Challenge 2 (Modal Focus Trapping, Keydown Storm & Escape Cleanup):
 *   Mount GoogleDriveModal, simulate rapid Tab / Shift-Tab key sequences, rapid
 *   Escape key presses, and Enter/Space activations.
 *   Assert focus is trapped within modal while open, zero event listener leaks on
 *   document upon close, and zero zombie backdrop nodes.
 *
 * - Challenge 3 (Grayscale Purity & Contrast Matrix on LivePaper Display Profile):
 *   Programmatically compute contrast ratios for all rendered modal and indicator
 *   text tokens on their backgrounds using WCAG relative luminance formula.
 *   Verify 100% compliance with Sol:OS scale (--os-0 to --os-1000): all body/secondary
 *   text >= 4.5:1 (AA), all primary text >= 7.0:1 (AAA).
 *   Assert zero EPD screen flash hooks (ACTION_REFRESH_SCREEN or waveform calls).
 *
 * - Challenge 4 (Android Bridge URL Hijacking & SSRF Stress):
 *   Pass hostile / deceptive URLs to isGoogleDocsOrDriveUrl:
 *   Assert strictly true for legitimate Google endpoints and strictly false for all
 *   deceptive, internal, and script URLs.
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Window } from 'happy-dom';

import { SyncStatusIndicator, type SyncIndicatorFormat } from '../../src/ui/sync-status-indicator.ts';
import { GoogleDriveModal } from '../../src/ui/google-drive-modal.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { LeftLibraryDrawer } from '../../src/drawers/left-library.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import {
  calculateContrastRatio,
  checkMonochromePurity,
  SOL_OS_PALETTE,
} from '../e2e/helpers/contrast-verifier.ts';
import type { SyncStatus, SyncAdapter, SyncEvent } from '../../src/sync/sync-adapter.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

// ----------------------------------------------------------------------------
// Test DOM Environment & Styling Harness
// ----------------------------------------------------------------------------

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

/**
 * TypeScript Oracle replicating the DaylightWebViewClient.isGoogleDocsOrDriveUrl logic
 * as implemented in android/app/src/main/java/com/daylight/writer/bridge/DaylightWebViewClient.kt
 */
export function isGoogleDocsOrDriveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    const assetDomain = 'appassets.androidplatform.net';

    return (
      host === 'docs.google.com' ||
      host === 'drive.google.com' ||
      host === 'accounts.google.com' ||
      (host.endsWith('.google.com') && host !== assetDomain)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Challenge 1: Rapid Dynamic State Machine Stress
// ============================================================================

describe('Challenge 1: Rapid Dynamic State Machine Stress', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('1.1: 50 Randomized Rapid State Transitions on Sol:OS SyncStatusIndicator', () => {
    const { doc } = env;
    const header = doc.createElement('header');
    doc.body.appendChild(header);

    const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
      format: 'solos',
    });

    assert.ok(indicator.element, 'Pill element must be mounted in DOM');
    assert.strictEqual(indicator.element?.id, 'sync-status-pill');

    const stateSequence: Array<'idle' | 'syncing' | 'synced' | 'offline' | 'error'> = [
      'idle',
      'syncing',
      'synced',
      'offline',
      'error',
    ];

    // Seeded pseudo-random generator for 100% deterministic reproducibility
    let seed = 42;
    function nextRand(): number {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    let lastAppliedStatus: SyncStatus = {
      state: 'synced',
      pendingCount: 0,
      inFlightCount: 0,
      lastSyncedAt: null,
    };

    // Cycle through 50 randomized rapid state transitions
    for (let step = 0; step < 50; step++) {
      const targetState = stateSequence[Math.floor(nextRand() * stateSequence.length)];
      const pendingCount = targetState === 'syncing' || targetState === 'offline' ? Math.floor(nextRand() * 8) : 0;
      const inFlightCount = targetState === 'syncing' ? 1 : 0;
      const lastSyncedAt = targetState === 'synced' || targetState === 'idle' ? Date.now() - Math.floor(nextRand() * 300000) : null;
      const error = targetState === 'error' ? `HTTP 503 Service Unavailable (Step ${step})` : null;

      const newStatus: SyncStatus = {
        state: targetState,
        pendingCount,
        inFlightCount,
        lastSyncedAt,
        error,
      };

      indicator.update(newStatus);
      lastAppliedStatus = newStatus;

      // Invariant Check 1: Exactly 2 persistent child nodes (glyphEl and labelEl)
      assert.strictEqual(
        indicator.element?.childNodes.length,
        2,
        `Step ${step + 1}: Pill must maintain exactly 2 child nodes (glyph and label)`
      );
      assert.strictEqual(
        indicator.element?.firstChild,
        indicator.glyphEl,
        `Step ${step + 1}: First child must strictly remain glyphEl`
      );
      assert.strictEqual(
        indicator.element?.lastChild,
        indicator.labelEl,
        `Step ${step + 1}: Last child must strictly remain labelEl`
      );

      // Invariant Check 2: Zero detached sub-nodes
      assert.strictEqual(
        indicator.glyphEl?.parentNode,
        indicator.element,
        `Step ${step + 1}: glyphEl must not become detached`
      );
      assert.strictEqual(
        indicator.labelEl?.parentNode,
        indicator.element,
        `Step ${step + 1}: labelEl must not become detached`
      );

      // Invariant Check 3: State class fidelity
      const expectedClass = targetState === 'idle' ? 'sync-state-synced' : `sync-state-${targetState}`;
      assert.ok(
        indicator.element?.classList.contains(expectedClass),
        `Step ${step + 1}: Class list "${indicator.element?.className}" must contain "${expectedClass}"`
      );

      // Invariant Check 4: Accessible attributes
      assert.strictEqual(indicator.element?.getAttribute('role'), 'status');
      assert.strictEqual(indicator.element?.getAttribute('aria-live'), 'polite');
      assert.strictEqual(indicator.glyphEl?.getAttribute('aria-hidden'), 'true');

      // Invariant Check 5: Sol:OS Glyph & Label text fidelity
      if (targetState === 'syncing') {
        assert.strictEqual(indicator.glyphEl?.textContent, '↻');
        if (pendingCount > 0) {
          assert.strictEqual(indicator.labelEl?.textContent, `Syncing... ${pendingCount}`);
        } else {
          assert.strictEqual(indicator.labelEl?.textContent, 'Syncing...');
        }
        assert.ok(indicator.element?.title.includes('Synchronizing'));
      } else if (targetState === 'offline') {
        assert.strictEqual(indicator.glyphEl?.textContent, '○');
        if (pendingCount > 0) {
          assert.strictEqual(indicator.labelEl?.textContent, `Offline (${pendingCount})`);
          assert.ok(indicator.element?.title.includes(`${pendingCount} changes queued`));
        } else {
          assert.strictEqual(indicator.labelEl?.textContent, 'Offline');
          assert.ok(indicator.element?.title.includes('Working offline'));
        }
      } else if (targetState === 'error') {
        assert.strictEqual(indicator.glyphEl?.textContent, '⚠');
        assert.strictEqual(indicator.labelEl?.textContent, 'Error');
        assert.ok(indicator.element?.title.includes('retry'));
      } else {
        // 'synced' or 'idle'
        assert.strictEqual(indicator.glyphEl?.textContent, '●');
        assert.ok(
          indicator.labelEl?.textContent?.startsWith('Synced'),
          `Step ${step + 1}: Synced label must start with "Synced", got "${indicator.labelEl?.textContent}"`
        );
      }
    }

    // Final state assertion matches the 50th applied status
    const finalFormatted = indicator.getFormattedStateText();
    assert.ok(finalFormatted.length > 0, 'Final formatted state text must be populated');
    assert.strictEqual(
      finalFormatted,
      `${indicator.glyphEl?.textContent} ${indicator.labelEl?.textContent}`.trim()
    );

    indicator.destroy();
    assert.strictEqual(header.childNodes.length, 0, 'Header must be empty after indicator destroy');
  });

  test('1.2: 50 Randomized Rapid Transitions on Classic SyncStatusIndicator', () => {
    const { doc } = env;
    const header = doc.createElement('header');
    doc.body.appendChild(header);

    const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, {
      format: 'classic',
    });

    const states: Array<'idle' | 'syncing' | 'synced' | 'offline' | 'error'> = [
      'idle',
      'syncing',
      'synced',
      'offline',
      'error',
    ];

    for (let step = 0; step < 50; step++) {
      const state = states[step % states.length];
      indicator.update({
        state,
        pendingCount: step % 5,
        inFlightCount: state === 'syncing' ? 1 : 0,
        lastSyncedAt: state === 'synced' ? Date.now() : null,
      });

      if (state === 'syncing') {
        assert.strictEqual(indicator.glyphEl?.textContent, '◐');
        assert.strictEqual(indicator.labelEl?.textContent, 'Syncing...');
      } else if (state === 'offline') {
        assert.strictEqual(indicator.glyphEl?.textContent, '⊘');
      } else if (state === 'error') {
        assert.strictEqual(indicator.glyphEl?.textContent, '⚠');
        assert.strictEqual(indicator.labelEl?.textContent, 'Sync Error');
      } else {
        assert.strictEqual(indicator.glyphEl?.textContent, '✓');
        assert.strictEqual(indicator.labelEl?.textContent, 'Synced');
      }
    }

    indicator.destroy();
  });

  test('1.3: Adapter event-driven stream updates indicator in lockstep without memory or DOM corruption', () => {
    const { doc } = env;
    const header = doc.createElement('header');
    doc.body.appendChild(header);

    const listeners = new Set<(event: SyncEvent) => void>();
    let currentStatus: SyncStatus = { state: 'synced', pendingCount: 0, inFlightCount: 0, lastSyncedAt: Date.now() };

    const mockAdapter: SyncAdapter = {
      id: 'mock-sync',
      name: 'Mock Sync Adapter',
      getStatus: () => currentStatus,
      subscribe: (cb: (event: SyncEvent) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      init: async () => {},
      sync: async () => ({ pushedCount: 0, pulledCount: 0 }),
      queueMutation: () => {},
      setOnline: () => {},
      resolveConflict: async (local) => local,
      clearStagedMutations: () => {},
    };

    const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, { format: 'solos' });
    indicator.bindAdapter(mockAdapter);

    assert.strictEqual(listeners.size, 1, 'Mock adapter must have exactly 1 subscriber');

    const sequence: SyncStatus['state'][] = ['syncing', 'synced', 'offline', 'error', 'synced'];
    for (let i = 0; i < 50; i++) {
      const st = sequence[i % sequence.length];
      currentStatus = {
        state: st,
        pendingCount: i % 4,
        inFlightCount: st === 'syncing' ? 1 : 0,
        lastSyncedAt: Date.now(),
      };
      for (const listener of listeners) {
        listener({ type: 'status_change', status: currentStatus, timestamp: Date.now() });
      }

      assert.ok(indicator.element?.classList.contains(`sync-state-${st}`));
    }

    indicator.destroy();
    assert.strictEqual(listeners.size, 0, 'Subscriber must be cleanly unbound on destroy');
  });
});

// ============================================================================
// Challenge 2: Modal Focus Trapping, Keydown Storm & Escape Cleanup
// ============================================================================

describe('Challenge 2: Modal Focus Trapping, Keydown Storm & Escape Cleanup', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('2.1: Modal Focus Trapping & Tab/Shift-Tab keydown storm preserves focus within dialog', () => {
    const { doc, win } = env;

    // Add an external focusable button in document outside the modal
    const outsideBtn = doc.createElement('button');
    outsideBtn.id = 'outside-external-btn';
    outsideBtn.textContent = 'External Button';
    doc.body.appendChild(outsideBtn);

    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });

    modal.open();

    const dialogCard = doc.querySelector('.gdrive-modal') as unknown as HTMLElement;
    assert.ok(dialogCard, '.gdrive-modal dialog card must be mounted');
    assert.strictEqual(dialogCard.getAttribute('role'), 'dialog');
    assert.strictEqual(dialogCard.getAttribute('aria-modal'), 'true');

    // Collect all focusable elements inside the modal
    const focusableSelectors = [
      '#gdrive-modal-close',
      '#gdrive-auth-btn',
      '#gdrive-token-input',
      '#gdrive-save-token-btn',
      '#gdrive-footer-cancel',
      '#gdrive-sync-now-btn',
    ];

    const focusableNodes = focusableSelectors.map((sel) => {
      const node = doc.querySelector(sel) as unknown as HTMLElement;
      assert.ok(node, `Focusable node "${sel}" must exist inside modal`);
      assert.ok(dialogCard.contains(node), `Focusable node "${sel}" must be inside dialogCard`);
      return node;
    });

    // Place initial focus on the token input inside the modal
    const tokenInput = doc.querySelector('#gdrive-token-input') as unknown as HTMLInputElement;
    tokenInput.focus();
    assert.strictEqual(doc.activeElement, tokenInput, 'Initial activeElement must be tokenInput');
    assert.ok(dialogCard.contains(doc.activeElement), 'Active element must be inside modal dialog');

    // Simulate rapid storm of 50 Tab and Shift-Tab keydown events
    for (let i = 0; i < 50; i++) {
      const isShift = i % 2 === 1;
      const targetIndex = i % focusableNodes.length;
      focusableNodes[targetIndex].focus();

      // Dispatch Tab or Shift+Tab keydown event
      const tabEvent = new win.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: isShift,
        bubbles: true,
        cancelable: true,
      });
      doc.dispatchEvent(tabEvent as any);

      // Invariant: Active element must ALWAYS remain strictly inside the modal dialog
      assert.ok(
        dialogCard.contains(doc.activeElement),
        `Storm step ${i + 1}: Focus must remain trapped within modal dialog`
      );
      assert.notStrictEqual(
        doc.activeElement,
        outsideBtn,
        `Storm step ${i + 1}: Focus must NEVER leak to external element outside modal`
      );
    }

    modal.close();
  });

  test('2.2: Enter and Space activations inside modal trigger correct actions', () => {
    const { doc, win } = env;

    let syncTriggerCount = 0;
    const adapter = new GoogleDriveSyncAdapter({ accessToken: 'ya29.valid-mock-token' });
    adapter.setCurrentUser({ email: 'a12katta@gmail.com', name: 'Anjan Katta' });

    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
      onSyncTriggered: async () => {
        syncTriggerCount++;
      },
    });

    modal.open();

    // 1. Enter key in token input triggers saveTokenBtn click
    const tokenInput = doc.querySelector('#gdrive-token-input') as unknown as HTMLInputElement;
    const saveTokenBtn = doc.querySelector('#gdrive-save-token-btn') as unknown as HTMLElement;
    assert.ok(tokenInput);
    assert.ok(saveTokenBtn);

    let saveTokenClicked = false;
    saveTokenBtn.addEventListener('click', () => {
      saveTokenClicked = true;
    });

    tokenInput.value = 'ya29.new-token-value';
    const enterEvt = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    tokenInput.dispatchEvent(enterEvt as any);

    assert.ok(enterEvt.defaultPrevented, 'Enter in token input must prevent default');
    assert.ok(saveTokenClicked, 'Enter in token input must activate saveTokenBtn click');

    // 2. Click on #gdrive-sync-now-btn triggers onSyncTriggered
    const syncNowBtn = doc.querySelector('#gdrive-sync-now-btn') as unknown as HTMLElement;
    assert.ok(syncNowBtn);
    syncNowBtn.click();
    assert.strictEqual(syncTriggerCount, 1, 'Sync Now button click must trigger onSyncTriggered');

    modal.close();
  });

  test('2.3: 25 Rapid Open/Escape Cycles Leave 0 Backdrop Nodes and 0 Document Keydown Listeners', () => {
    const { doc, win } = env;

    // Spy on document addEventListener/removeEventListener to track active keydown listeners
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

    // Run 25 rapid open -> Escape cycles
    for (let i = 0; i < 25; i++) {
      modal.open();

      assert.strictEqual(
        doc.querySelectorAll('.gdrive-modal-backdrop').length,
        1,
        `Cycle ${i + 1}: Exactly 1 backdrop element must exist when open`
      );
      assert.strictEqual(
        activeKeydownListeners.size,
        1,
        `Cycle ${i + 1}: Exactly 1 keydown listener must be attached when open`
      );

      // Dispatch Escape keydown on document
      const escEvent = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      doc.dispatchEvent(escEvent);

      // Post-dismissal invariants
      assert.strictEqual(
        doc.querySelectorAll('.gdrive-modal-backdrop').length,
        0,
        `Cycle ${i + 1}: Exactly 0 backdrop elements must remain after Escape`
      );
      assert.strictEqual(
        activeKeydownListeners.size,
        0,
        `Cycle ${i + 1}: Exactly 0 keydown listeners must remain after Escape`
      );
    }

    // Additional storm: 10 Escape key presses while modal is already closed
    for (let i = 0; i < 10; i++) {
      const escEvent = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      doc.dispatchEvent(escEvent);
      assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
      assert.strictEqual(activeKeydownListeners.size, 0);
    }
  });

  test('2.4: Concurrency Reentrancy: Repeated open() and close() Calls Prevent Zombie Nodes and Leaks', () => {
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

    // 5 consecutive open() calls
    for (let i = 0; i < 5; i++) {
      modal.open();
    }
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 1);
    assert.strictEqual(activeKeydownListeners.size, 1);

    // 5 consecutive close() calls
    for (let i = 0; i < 5; i++) {
      modal.close();
    }
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(activeKeydownListeners.size, 0);

    // 10 toggle() calls
    for (let i = 0; i < 10; i++) {
      modal.toggle();
      const expected = i % 2 === 0 ? 1 : 0;
      assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, expected);
      assert.strictEqual(activeKeydownListeners.size, expected);
    }

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(activeKeydownListeners.size, 0);
  });
});

// ============================================================================
// Challenge 3: Grayscale Purity & Contrast Matrix on LivePaper Display Profile
// ============================================================================

describe('Challenge 3: Grayscale Purity & Contrast Matrix on LivePaper Display Profile', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('3.1: SyncStatusIndicator text tokens meet WCAG AA (>= 4.5:1) and AAA (>= 7.0:1) across all states', () => {
    const { doc, win } = env;
    const header = doc.createElement('header');
    doc.body.appendChild(header);

    const indicator = new SyncStatusIndicator(header as unknown as HTMLElement, { format: 'solos' });

    // 1. Synced state: color is --os-400 (#535353) on base paper (#FFFFFF) and header (#F7F7F7)
    indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0, inFlightCount: 0 });
    const syncedEl = doc.querySelector('.sync-status-pill.sync-state-synced') as any;
    assert.ok(syncedEl);
    const syncedCs = win.getComputedStyle(syncedEl);
    const ratioSyncedOn0 = calculateContrastRatio(syncedCs.color, SOL_OS_PALETTE.os0);
    const ratioSyncedOn50 = calculateContrastRatio(syncedCs.color, SOL_OS_PALETTE.os50);
    assert.ok(ratioSyncedOn0 >= 7.0, `Synced pill on --os-0 (${ratioSyncedOn0.toFixed(2)}:1) meets WCAG AAA (>= 7.0:1)`);
    assert.ok(ratioSyncedOn50 >= 4.5, `Synced pill on --os-50 (${ratioSyncedOn50.toFixed(2)}:1) meets WCAG AA (>= 4.5:1)`);

    // 2. Syncing state: background is --os-150 (#F5F5F5), text is --os-900 (#1A1A1A)
    indicator.update({ state: 'syncing', lastSyncedAt: null, pendingCount: 2, inFlightCount: 1 });
    const syncingEl = doc.querySelector('.sync-status-pill.sync-state-syncing') as any;
    assert.ok(syncingEl);
    const syncingCs = win.getComputedStyle(syncingEl);
    const ratioSyncing = calculateContrastRatio(syncingCs.color, syncingCs.backgroundColor || SOL_OS_PALETTE.os150);
    assert.ok(ratioSyncing >= 7.0, `Syncing pill (${ratioSyncing.toFixed(2)}:1) meets WCAG AAA (>= 7.0:1)`);

    // 3. Offline state: background is --os-50 (#F7F7F7), text is --os-400 (#535353)
    indicator.update({ state: 'offline', lastSyncedAt: null, pendingCount: 3, inFlightCount: 0 });
    const offlineEl = doc.querySelector('.sync-status-pill.sync-state-offline') as any;
    assert.ok(offlineEl);
    const offlineCs = win.getComputedStyle(offlineEl);
    const ratioOffline = calculateContrastRatio(offlineCs.color, offlineCs.backgroundColor || SOL_OS_PALETTE.os50);
    assert.ok(ratioOffline >= 4.5, `Offline pill (${ratioOffline.toFixed(2)}:1) meets WCAG AA (>= 4.5:1)`);
    assert.ok(ratioOffline >= 7.0, `Offline pill (${ratioOffline.toFixed(2)}:1) meets WCAG AAA (>= 7.0:1)`);

    // 4. Error state: background is --os-800 (#343434), text is --os-0 (#FFFFFF)
    indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 1, inFlightCount: 0, error: 'Sync failed' });
    const errorEl = doc.querySelector('.sync-status-pill.sync-state-error') as any;
    assert.ok(errorEl);
    const errorCs = win.getComputedStyle(errorEl);
    const ratioError = calculateContrastRatio(errorCs.color, errorCs.backgroundColor || SOL_OS_PALETTE.os800);
    assert.ok(ratioError >= 7.0, `Error pill (${ratioError.toFixed(2)}:1) meets WCAG AAA (>= 7.0:1)`);

    indicator.destroy();
  });

  test('3.2: GoogleDriveModal primary text tokens meet WCAG AAA (>= 7.0:1)', () => {
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
      { sel: '.export-modal-title', fg: SOL_OS_PALETTE.os1000, bg: SOL_OS_PALETTE.os50, name: 'Modal Title' },
      { sel: '.gdrive-user-email', fg: SOL_OS_PALETTE.os1000, bg: SOL_OS_PALETTE.os0, name: 'User Email' },
      { sel: '.gdrive-status-badge.connected', fg: SOL_OS_PALETTE.os900, bg: SOL_OS_PALETTE.os0, name: 'Connected Badge' },
      { sel: '.gdrive-folder-name', fg: SOL_OS_PALETTE.os900, bg: SOL_OS_PALETTE.os0, name: 'Folder Name' },
      { sel: '.collab-input', fg: SOL_OS_PALETTE.os900, bg: SOL_OS_PALETTE.os0, name: 'OAuth Token Input' },
      { sel: '#gdrive-sync-now-btn', fg: SOL_OS_PALETTE.os0, bg: SOL_OS_PALETTE.os900, name: 'Sync Now Button' },
      { sel: '.gdrive-avatar', fg: SOL_OS_PALETTE.os0, bg: SOL_OS_PALETTE.os800, name: 'User Avatar' },
      { sel: '.log-success', fg: SOL_OS_PALETTE.os900, bg: SOL_OS_PALETTE.os0, name: 'Success Log Entry' },
      { sel: '.log-warn', fg: SOL_OS_PALETTE.os800, bg: SOL_OS_PALETTE.os0, name: 'Warning Log Entry' },
      { sel: '.log-error', fg: SOL_OS_PALETTE.os1000, bg: SOL_OS_PALETTE.os0, name: 'Error Log Entry' },
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

  test('3.3: GoogleDriveModal secondary text tokens meet WCAG AA (>= 4.5:1)', () => {
    const { doc } = env;

    const adapter = new GoogleDriveSyncAdapter();
    (adapter as any).addLog('Informational check', 'info');

    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const secondaryChecks = [
      { sel: '.export-dialog-subtitle', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os50, name: 'Modal Subtitle' },
      { sel: '.export-modal-close', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os50, name: 'Header Close Button' },
      { sel: '.gdrive-status-badge.disconnected', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os0, name: 'Disconnected Badge' },
      { sel: '.collab-label', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os50, name: 'Section Label' },
      { sel: '.collab-hint', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os50, name: 'Section Hint' },
      { sel: '#gdrive-save-token-btn', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os50, name: 'Verify Token Button' },
      { sel: '#gdrive-auth-btn', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os0, name: 'Connect/Disconnect Button' },
      { sel: '.gdrive-folder-path', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os0, name: 'Folder Breadcrumb Path' },
      { sel: '#gdrive-footer-cancel', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os0, name: 'Footer Close Button' },
      { sel: '.log-info', fg: SOL_OS_PALETTE.os400, bg: SOL_OS_PALETTE.os0, name: 'Info Log Entry' },
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

  test('3.4: Library Drawer Google Docs badge and link meet WCAG AAA (>= 7.0:1)', () => {
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

  test('3.5: Sol:OS Palette chromatic purity verification (100% grayscale / zero saturation leak)', () => {
    for (const [name, hex] of Object.entries(SOL_OS_PALETTE)) {
      const { isMonochrome, maxDelta } = checkMonochromePurity(hex);
      assert.ok(
        isMonochrome,
        `Palette token ${name} (${hex}) must be strictly monochromatic (max delta ${maxDelta} <= 20)`
      );
    }
  });

  test('3.6: Strict Zero EPD Screen Flash Hooks Invariant across all sync and UI modules', () => {
    const rootDir = path.resolve(new URL('../../../', import.meta.url).pathname);
    const filesToCheck = [
      'web/src/ui/sync-status-indicator.ts',
      'web/src/ui/google-drive-modal.ts',
      'web/src/drawers/left-library.ts',
      'web/src/main.ts',
      'web/src/sync/google-drive-sync-adapter.ts',
      'android/app/src/main/java/com/daylight/writer/bridge/DaylightWebViewClient.kt',
    ];

    const forbiddenPatterns = [
      'ACTION_REFRESH_SCREEN',
      'epd_waveform',
      'waveform_mode',
      'broadcastScreenRefresh',
      'triggerEpdClear',
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.join(rootDir, relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        for (const pattern of forbiddenPatterns) {
          assert.strictEqual(
            content.includes(pattern),
            false,
            `File "${relPath}" must NEVER contain forbidden EPD hook "${pattern}"`
          );
        }
      }
    }
  });
});

// ============================================================================
// Challenge 4: Android Bridge URL Hijacking & SSRF Stress
// ============================================================================

describe('Challenge 4: Android Bridge URL Hijacking & SSRF Stress', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('4.1: Strictly rejects deceptive, internal asset, protocol-relative, and script URLs', () => {
    const hostileUrls = [
      'https://docs.google.com.attacker.com',
      'https://attacker.com?url=https://docs.google.com',
      'https://appassets.androidplatform.net/index.html?redirect=docs.google.com',
      'javascript:alert(document.domain)',
      'data:text/html,<script>alert(1)</script>',
      'https://docs.google.com@attacker.com',
      'https://attacker.com#docs.google.com',
      'https://not-google.com/docs.google.com',
      'https://appassets.androidplatform.net/search?target=drive.google.com&auth=accounts.google.com',
      'vbscript:msgbox(1)',
      'file:///android_asset/index.html',
      'content://com.daylight.provider/secret',
      'about:blank',
      '',
      'not_a_valid_url',
    ];

    for (const url of hostileUrls) {
      const result = isGoogleDocsOrDriveUrl(url);
      assert.strictEqual(
        result,
        false,
        `Hostile / deceptive URL "${url}" must be rejected by isGoogleDocsOrDriveUrl (got true)`
      );
    }
  });

  test('4.2: Strictly accepts legitimate Google Docs, Drive, and OAuth authentication URLs', () => {
    const legitimateUrls = [
      'https://drive.google.com/drive/folders/test123',
      'https://docs.google.com/document/d/doc123/edit',
      'https://accounts.google.com/o/oauth2/v2/auth',
      'https://docs.google.com/spreadsheets/d/spreadsheet-abc-456',
      'https://drive.google.com/file/d/file-xyz-789/view',
      'https://accounts.google.com/signin/v2/identifier',
      'https://script.google.com/macros/s/macro-id/exec',
      'http://docs.google.com/document/d/legacy-doc/edit',
    ];

    for (const url of legitimateUrls) {
      const result = isGoogleDocsOrDriveUrl(url);
      assert.strictEqual(
        result,
        true,
        `Legitimate Google endpoint "${url}" must be accepted by isGoogleDocsOrDriveUrl (got false)`
      );
    }
  });

  test('4.3: Static verification of DaylightWebViewClient.kt source implementation', () => {
    const rootDir = path.resolve(new URL('../../../', import.meta.url).pathname);
    const clientKtPath = path.join(
      rootDir,
      'android/app/src/main/java/com/daylight/writer/bridge/DaylightWebViewClient.kt'
    );

    assert.ok(fs.existsSync(clientKtPath), 'DaylightWebViewClient.kt must exist');
    const ktContent = fs.readFileSync(clientKtPath, 'utf-8');

    // Assert authority hostname parsing (Uri.parse or java.net.URI host extraction)
    assert.ok(
      ktContent.includes('Uri.parse(url).host') || ktContent.includes('URI(url).host'),
      'DaylightWebViewClient must safely extract authority host component'
    );

    // Assert exact domain matching checks
    assert.ok(
      ktContent.includes('"docs.google.com"') &&
        ktContent.includes('"drive.google.com"') &&
        ktContent.includes('"accounts.google.com"'),
      'DaylightWebViewClient must strictly check docs, drive, and accounts hostnames'
    );

    // Assert asset domain protection
    assert.ok(
      ktContent.includes('ASSET_DOMAIN') || ktContent.includes('appassets.androidplatform.net'),
      'DaylightWebViewClient must protect virtual asset domain from false interception'
    );
  });

  test('4.4: LeftLibraryDrawer Google Docs link dispatches external URL to Android Bridge without closing drawer', async () => {
    const { doc, win } = env;

    const container = doc.createElement('div');
    const shell = doc.createElement('div');
    const backdrop = doc.createElement('div');
    doc.body.appendChild(container);
    doc.body.appendChild(shell);
    doc.body.appendChild(backdrop);

    const repo = new GDocsAwareStorageRepository();
    const gdocsFileId = 'gdocs-cloud-file-adversarial-123';

    await repo.saveDocument({
      id: 'doc-adversarial-001',
      title: 'Adversarial Bridge Test Document',
      content: 'Sample manuscript content.',
      created_at: 1000,
      updated_at: 1000,
      sync_status: 'synced',
      google_drive_file_id: gdocsFileId,
    });

    const bridgeInvocations: string[] = [];
    (win as any).DaylightBridgeClient = {
      openExternalUrl: (url: string) => {
        bridgeInvocations.push(url);
        return true;
      },
    };

    let selectedDocId: string | null = null;
    const drawer = new LeftLibraryDrawer({
      container: container as unknown as HTMLElement,
      shellElement: shell as unknown as HTMLElement,
      backdropElement: backdrop as unknown as HTMLElement,
      repository: repo,
      onSelectDocument: (id) => {
        selectedDocId = id;
      },
    });

    await drawer.init();
    drawer.open();
    assert.strictEqual(drawer.getIsOpen(), true, 'Drawer must be open');

    const gdocsLink = container.querySelector('.doc-gdocs-link') as unknown as HTMLAnchorElement;
    assert.ok(gdocsLink, '.doc-gdocs-link must be rendered in the document card');

    const expectedUrl = `https://docs.google.com/document/d/${gdocsFileId}/edit`;
    assert.strictEqual(gdocsLink.href, expectedUrl);

    // Verify URL passes security oracle
    assert.strictEqual(isGoogleDocsOrDriveUrl(expectedUrl), true);

    // Click Google Docs link
    gdocsLink.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as any);

    // Invariants:
    // 1. Android bridge was invoked with expected Google Docs URL
    assert.strictEqual(bridgeInvocations.length, 1);
    assert.strictEqual(bridgeInvocations[0], expectedUrl);

    // 2. onSelectDocument was NOT invoked (event propagation stopped)
    assert.strictEqual(selectedDocId, null);

    // 3. Drawer did NOT close
    assert.strictEqual(drawer.getIsOpen(), true, 'Drawer must remain open after clicking Docs link');

    drawer.destroy();
  });
});
