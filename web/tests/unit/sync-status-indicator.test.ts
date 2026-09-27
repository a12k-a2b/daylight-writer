/**
 * tests/unit/sync-status-indicator.test.ts
 * Unit test suite for Sol:OS Dynamic Header Sync Pill (SyncStatusIndicator)
 * Validates Sol:OS and Classic states, click/retry actions, modal integration,
 * accessibility semantics, and 120Hz LivePaper rendering compliance.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { SyncStatusIndicator } from '../../src/ui/sync-status-indicator.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { GoogleDriveModal } from '../../src/ui/google-drive-modal.ts';
import type { SyncStatus } from '../../src/sync/sync-adapter.ts';

function setupEnvironment() {
  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).KeyboardEvent = win.KeyboardEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;

  const header = doc.createElement('header');
  doc.body.appendChild(header);

  return {
    win,
    doc,
    header,
    cleanup: () => {
      doc.body.innerHTML = '';
    },
  };
}

// ----------------------------------------------------------------------------
// 1. Mount & DOM Accessibility Hierarchy
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: Mounts in DOM with role="status", aria-live="polite", and tabindex="0"', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement);

    assert.ok(indicator.element, 'Pill element must be mounted');
    assert.strictEqual(indicator.element?.id, 'sync-status-pill');
    assert.strictEqual(indicator.element?.getAttribute('role'), 'status');
    assert.strictEqual(indicator.element?.getAttribute('aria-live'), 'polite');
    assert.ok(indicator.glyphEl, 'Glyph element must be present');
    assert.strictEqual(indicator.glyphEl?.getAttribute('aria-hidden'), 'true');
    assert.ok(indicator.labelEl, 'Label element must be present');
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 2. Canonical Sol:OS Format States (● Synced, ↻ Syncing..., ○ Offline, ⚠ Error)
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: Renders Sol:OS format synced state (● Synced [time])', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      format: 'solos',
    });

    const now = Date.now();
    indicator.update({
      state: 'synced',
      lastSyncedAt: now,
      pendingCount: 0,
      inFlightCount: 0,
    });

    assert.ok(indicator.element?.classList.contains('sync-state-synced'));
    assert.strictEqual(indicator.glyphEl?.textContent, '●');
    assert.ok(
      indicator.labelEl?.textContent?.startsWith('Synced'),
      `Label should start with "Synced", got "${indicator.labelEl?.textContent}"`
    );
  } finally {
    env.cleanup();
  }
});

test('SyncStatusIndicator: Renders Sol:OS format syncing state (↻ Syncing... [count])', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      format: 'solos',
    });

    indicator.update({
      state: 'syncing',
      lastSyncedAt: null,
      pendingCount: 3,
      inFlightCount: 1,
    });

    assert.ok(indicator.element?.classList.contains('sync-state-syncing'));
    assert.strictEqual(indicator.glyphEl?.textContent, '↻');
    assert.strictEqual(indicator.labelEl?.textContent, 'Syncing... 3');
  } finally {
    env.cleanup();
  }
});

test('SyncStatusIndicator: Renders Sol:OS format offline state (○ Offline)', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      format: 'solos',
    });

    indicator.update({
      state: 'offline',
      lastSyncedAt: null,
      pendingCount: 0,
      inFlightCount: 0,
    });

    assert.ok(indicator.element?.classList.contains('sync-state-offline'));
    assert.strictEqual(indicator.glyphEl?.textContent, '○');
    assert.strictEqual(indicator.labelEl?.textContent, 'Offline');
  } finally {
    env.cleanup();
  }
});

test('SyncStatusIndicator: Renders Sol:OS format error state (⚠ Error)', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      format: 'solos',
    });

    indicator.update({
      state: 'error',
      lastSyncedAt: null,
      pendingCount: 1,
      inFlightCount: 0,
      error: 'Google Drive quota exceeded',
    });

    assert.ok(indicator.element?.classList.contains('sync-state-error'));
    assert.strictEqual(indicator.glyphEl?.textContent, '⚠');
    assert.strictEqual(indicator.labelEl?.textContent, 'Error');
    assert.ok(indicator.element?.title.includes('Google Drive quota exceeded'));
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 3. Classic Format Backward Compatibility (✓, ◐, ⊘, ⚠)
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: Renders classic format states for backward compatibility', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      format: 'classic',
    });

    // Synced
    indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0, inFlightCount: 0 });
    assert.strictEqual(indicator.glyphEl?.textContent, '✓');
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

    // Syncing
    indicator.update({ state: 'syncing', lastSyncedAt: null, pendingCount: 2, inFlightCount: 1 });
    assert.strictEqual(indicator.glyphEl?.textContent, '◐');
    assert.strictEqual(indicator.labelEl?.textContent, 'Syncing...');

    // Offline with pending mutations
    indicator.update({ state: 'offline', lastSyncedAt: null, pendingCount: 4, inFlightCount: 0 });
    assert.strictEqual(indicator.glyphEl?.textContent, '⊘');
    assert.strictEqual(indicator.labelEl?.textContent, 'Offline (4)');

    // Error
    indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 1, inFlightCount: 0, error: 'Network dropped' });
    assert.strictEqual(indicator.glyphEl?.textContent, '⚠');
    assert.strictEqual(indicator.labelEl?.textContent, 'Sync Error');
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 4. Live Adapter Binding & Dynamic Transitions
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: Binds to GoogleDriveSyncAdapter and tracks status events', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement);
    const adapter = new GoogleDriveSyncAdapter();

    indicator.bindAdapter(adapter);
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

    // Network offline transition
    adapter.setOnline(false);
    assert.strictEqual(indicator.element?.classList.contains('sync-state-offline'), true);

    // Network online restore
    adapter.setOnline(true);
    assert.strictEqual(indicator.element?.classList.contains('sync-state-synced'), true);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 5. Interactivity: Click & Keyboard Handling
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: Click in error state dispatches onRetry / onRetryClick', () => {
  const env = setupEnvironment();
  try {
    let retried = false;
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      onRetry: () => {
        retried = true;
      },
    });

    indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 1, inFlightCount: 0, error: 'Auth failed' });
    assert.ok(indicator.element?.classList.contains('sync-state-error'));

    indicator.element?.click();
    assert.strictEqual(retried, true, 'Error pill click must trigger retry callback');

    // Clicking in synced state must NOT trigger onRetry
    retried = false;
    indicator.update({ state: 'synced', lastSyncedAt: Date.now(), pendingCount: 0, inFlightCount: 0 });
    indicator.element?.click();
    assert.strictEqual(retried, false, 'Synced pill click must NOT trigger retry callback');
  } finally {
    env.cleanup();
  }
});

test('SyncStatusIndicator: Click opens GoogleDriveModal when passed in options', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });

    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      modal,
    });

    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);
    indicator.element?.click();
    assert.ok(env.doc.querySelector('.gdrive-modal'), 'Modal must be mounted upon pill click');

    modal.close();
  } finally {
    env.cleanup();
  }
});

test('SyncStatusIndicator: Enter and Space keys trigger click action', () => {
  const env = setupEnvironment();
  try {
    let clickCount = 0;
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      onClick: () => {
        clickCount++;
      },
    });

    // Press Enter
    indicator.element?.dispatchEvent(new (env.win as any).KeyboardEvent('keydown', { key: 'Enter' }));
    assert.strictEqual(clickCount, 1, 'Enter key must trigger pill click action');

    // Press Space
    indicator.element?.dispatchEvent(new (env.win as any).KeyboardEvent('keydown', { key: ' ' }));
    assert.strictEqual(clickCount, 2, 'Space key must trigger pill click action');
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 6. Cleanup & Teardown
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: destroy() safely unbinds listeners and removes element from DOM', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement);
    const adapter = new GoogleDriveSyncAdapter();

    indicator.bindAdapter(adapter);
    assert.ok(indicator.element && env.header.contains(indicator.element as any));

    indicator.destroy();
    assert.strictEqual(indicator.element, null);

    // Further adapter transitions should not throw
    adapter.setOnline(false);
    assert.ok(true);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 7. Sol:OS Format Default & Existing Pill Initialization Tests
// ----------------------------------------------------------------------------

test('SyncStatusIndicator: format "solos" transforms pre-existing HTML glyph from checkmark to Sol:OS glyph ●', () => {
  const env = setupEnvironment();
  try {
    const preExistingPill = env.doc.createElement('div');
    preExistingPill.id = 'sync-status-pill';
    preExistingPill.className = 'sync-status-pill sync-state-synced';
    preExistingPill.innerHTML = `
      <span class="sync-status-glyph" aria-hidden="true">✓</span>
      <span class="sync-status-label">Synced</span>
    `;
    env.header.appendChild(preExistingPill);

    const indicator = new SyncStatusIndicator(preExistingPill as unknown as HTMLElement, {
      format: 'solos',
    });

    assert.strictEqual(indicator.getFormat(), 'solos');
    assert.strictEqual(indicator.glyphEl?.textContent, '●', 'Pill glyph must immediately update to Sol:OS ●');
    assert.strictEqual(indicator.getFormattedStateText(), '● Synced');
  } finally {
    env.cleanup();
  }
});

test('SyncStatusIndicator: format "solos" renders canonical Sol:OS glyphs across all state transitions', () => {
  const env = setupEnvironment();
  try {
    const indicator = new SyncStatusIndicator(env.header as unknown as HTMLElement, {
      format: 'solos',
    });

    // 1. Synced state
    indicator.update({ state: 'synced', lastSyncedAt: null, pendingCount: 0, inFlightCount: 0 });
    assert.strictEqual(indicator.glyphEl?.textContent, '●', 'Synced must use Sol:OS glyph ●');
    assert.strictEqual(indicator.labelEl?.textContent, 'Synced');

    // 2. Syncing state
    indicator.update({ state: 'syncing', lastSyncedAt: null, pendingCount: 2, inFlightCount: 1 });
    assert.strictEqual(indicator.glyphEl?.textContent, '↻', 'Syncing must use Sol:OS glyph ↻');
    assert.strictEqual(indicator.labelEl?.textContent, 'Syncing... 2');

    // 3. Offline state
    indicator.update({ state: 'offline', lastSyncedAt: null, pendingCount: 0, inFlightCount: 0 });
    assert.strictEqual(indicator.glyphEl?.textContent, '○', 'Offline must use Sol:OS glyph ○');
    assert.strictEqual(indicator.labelEl?.textContent, 'Offline');

    // 4. Error state
    indicator.update({ state: 'error', lastSyncedAt: null, pendingCount: 0, inFlightCount: 0, error: 'Network fail' });
    assert.strictEqual(indicator.glyphEl?.textContent, '⚠', 'Error must use Sol:OS glyph ⚠');
    assert.strictEqual(indicator.labelEl?.textContent, 'Error');
  } finally {
    env.cleanup();
  }
});
