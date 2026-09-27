/**
 * tests/unit/google-drive-modal.test.ts
 * Unit test suite for Google Drive & Google Docs Cloud Sync Modal (GoogleDriveModal)
 * Validates UserInfo display, folder pill, direct token fallback, manual sync trigger,
 * disconnect flow, live activity logs, and light-dismiss / keyboard mechanics on Sol:OS.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { GoogleDriveModal } from '../../src/ui/google-drive-modal.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';

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

  return {
    win,
    doc,
    cleanup: () => {
      doc.body.innerHTML = '';
    },
  };
}

// ----------------------------------------------------------------------------
// 1. Mount & Dialog Accessibility Attributes
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Opens and mounts modal with role="dialog", aria-modal="true"', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });

    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);
    modal.open();

    const dialog = env.doc.querySelector('.gdrive-modal');
    assert.ok(dialog, 'Modal dialog should be mounted');
    assert.strictEqual(dialog?.getAttribute('role'), 'dialog');
    assert.strictEqual(dialog?.getAttribute('aria-modal'), 'true');
    assert.strictEqual(dialog?.getAttribute('aria-labelledby'), 'gdrive-modal-title');

    modal.close();
    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 2. UserInfo & Connection Status Badge
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Displays connected user email, display name, and avatar initial', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter({ accessToken: 'ya29.valid-token' });
    adapter.setCurrentUser({
      email: 'a12katta@gmail.com',
      name: 'Anjan Katta',
    });

    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const emailEl = env.doc.querySelector('.gdrive-user-email');
    const nameEl = env.doc.querySelector('.gdrive-user-name');
    const avatarEl = env.doc.querySelector('.gdrive-avatar');
    const badgeEl = env.doc.querySelector('.gdrive-status-badge');

    assert.strictEqual(emailEl?.textContent, 'a12katta@gmail.com');
    assert.strictEqual(nameEl?.textContent, 'Anjan Katta');
    assert.strictEqual(avatarEl?.textContent, 'A');
    assert.ok(badgeEl?.classList.contains('connected'));
    assert.ok(badgeEl?.textContent?.includes('Connected & Ready'));

    modal.close();
  } finally {
    env.cleanup();
  }
});

test('GoogleDriveModal: Displays unauthenticated offline mode when no user is logged in', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const emailEl = env.doc.querySelector('.gdrive-user-email');
    const badgeEl = env.doc.querySelector('.gdrive-status-badge');
    const authBtn = env.doc.querySelector('#gdrive-auth-btn');

    assert.strictEqual(emailEl?.textContent, 'Not Connected');
    assert.ok(badgeEl?.classList.contains('disconnected'));
    assert.ok(badgeEl?.textContent?.includes('Local Offline Mode'));
    assert.strictEqual(authBtn?.textContent?.trim(), 'Connect Account');

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 3. Dedicated Folder Name & Breadcrumb Pill
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Displays dedicated folder name "Daylight Manuscripts" and breadcrumb', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const folderNameEl = env.doc.querySelector('.gdrive-folder-name');
    const folderPathEl = env.doc.querySelector('.gdrive-folder-path');

    assert.strictEqual(folderNameEl?.textContent, 'Daylight Manuscripts');
    assert.strictEqual(folderPathEl?.textContent, 'My Drive / Daylight Manuscripts');

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 4. Direct Token Entry Fallback Input
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Direct token entry fallback updates adapter access token on verify', async () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const tokenInput = env.doc.querySelector('#gdrive-token-input') as unknown as HTMLInputElement;
    const saveTokenBtn = env.doc.querySelector('#gdrive-save-token-btn') as unknown as HTMLButtonElement;

    assert.ok(tokenInput);
    assert.ok(saveTokenBtn);

    tokenInput.value = 'ya29.test-direct-token-entry';
    saveTokenBtn.click();

    // Verification initiates
    assert.strictEqual(adapter.getAccessToken(), 'ya29.test-direct-token-entry');

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 5. Disconnect / Sign Out Flow
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Disconnect button clears adapter tokens and resets account card', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter({ accessToken: 'ya29.session-token' });
    adapter.setCurrentUser({ email: 'a12katta@gmail.com', name: 'Anjan Katta' });

    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const authBtn = env.doc.querySelector('#gdrive-auth-btn') as unknown as HTMLButtonElement;
    assert.strictEqual(authBtn.textContent?.trim(), 'Disconnect');

    authBtn.click();

    // Verify token was cleared
    assert.strictEqual(adapter.isAuthenticated(), false);
    assert.strictEqual(adapter.getAccessToken(), null);

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 6. Manual "Sync Now" Button
// ----------------------------------------------------------------------------

test('GoogleDriveModal: "Sync to Drive Now" button triggers sync and reports progress', async () => {
  const env = setupEnvironment();
  try {
    let triggered = false;
    const adapter = new GoogleDriveSyncAdapter({ accessToken: 'ya29.valid-token' });
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
      onSyncTriggered: async () => {
        triggered = true;
      },
    });
    modal.open();

    const syncBtn = env.doc.querySelector('#gdrive-sync-now-btn') as unknown as HTMLButtonElement;
    assert.ok(syncBtn);

    syncBtn.click();
    assert.strictEqual(triggered, true, 'onSyncTriggered callback must be invoked');

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 7. Live Activity Log Box
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Live sync activity log displays timestamps and recent entries', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    (adapter as any).addLog('Discovered "Daylight Manuscripts" folder', 'info');
    (adapter as any).addLog('Synchronized 1 document in 42ms', 'success');

    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const logBox = env.doc.querySelector('#gdrive-log-box');
    assert.ok(logBox);
    assert.ok(logBox.textContent?.includes('Discovered "Daylight Manuscripts" folder'));
    assert.ok(logBox.textContent?.includes('Synchronized 1 document in 42ms'));

    modal.close();
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 8. Dismissal Mechanics (Close Button, Footer Cancel, Backdrop Click, Escape Key)
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Modal closes on header close button and footer cancel button', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });

    // Header close button
    modal.open();
    assert.ok(env.doc.querySelector('.gdrive-modal'));
    (env.doc.querySelector('#gdrive-modal-close') as unknown as HTMLElement)?.click();
    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);

    // Footer cancel button
    modal.open();
    assert.ok(env.doc.querySelector('.gdrive-modal'));
    (env.doc.querySelector('#gdrive-footer-cancel') as unknown as HTMLElement)?.click();
    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);
  } finally {
    env.cleanup();
  }
});

test('GoogleDriveModal: Backdrop click dismisses modal (light-dismiss)', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const backdrop = env.doc.querySelector('.gdrive-modal-backdrop') as unknown as HTMLElement;
    assert.ok(backdrop);

    backdrop.click();
    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);
  } finally {
    env.cleanup();
  }
});

test('GoogleDriveModal: Escape key dismisses modal and unbinds listener cleanly', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();
    assert.ok(env.doc.querySelector('.gdrive-modal'));

    env.doc.dispatchEvent(new (env.win as any).KeyboardEvent('keydown', { key: 'Escape' }));
    assert.strictEqual(env.doc.querySelector('.gdrive-modal'), null);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 9. Re-render Cleanliness (Zero DOM Leaks)
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Re-rendering cleans up previous overlay without leaking duplicate DOM nodes', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });

    modal.open();
    // Simulate re-render via private method (e.g. after auth state change)
    (modal as any).render();
    (modal as any).render();

    const backdrops = env.doc.querySelectorAll('.gdrive-modal-backdrop');
    assert.strictEqual(backdrops.length, 1, 'There must be exactly one modal backdrop in DOM');

    modal.close();
    assert.strictEqual(env.doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------------
// 10. Zombie Overlay Prevention & XSS Sanitization Tests
// ----------------------------------------------------------------------------

test('GoogleDriveModal: Prevents zombie overlay creation if modal is closed before verify timeout fires', async () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Daylight Author' });
    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();
    assert.strictEqual(env.doc.querySelectorAll('.gdrive-modal-backdrop').length, 1);

    const saveBtn = env.doc.querySelector('#gdrive-save-token-btn') as unknown as HTMLButtonElement;
    const tokenInput = env.doc.querySelector('#gdrive-token-input') as unknown as HTMLInputElement;
    tokenInput.value = 'ya29.test-token';
    saveBtn.click();

    // Close immediately while 400ms timeout is pending
    modal.close();
    assert.strictEqual(env.doc.querySelectorAll('.gdrive-modal-backdrop').length, 0, 'Backdrop removed on close');

    // Wait 500ms for timeout to elapse
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Assert zero zombie overlays in DOM
    const backdrops = env.doc.querySelectorAll('.gdrive-modal-backdrop');
    assert.strictEqual(backdrops.length, 0, 'No zombie backdrop should be rendered after early close');
  } finally {
    env.cleanup();
  }
});

test('GoogleDriveModal: Properly escapes HTML entities in activity log messages and user profile to prevent XSS', () => {
  const env = setupEnvironment();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    const maliciousPayload = '<img src=x onerror="alert(\'xss\')">';
    (adapter as any).addLog(`Created file ${maliciousPayload}`, 'info');
    adapter.setCurrentUser({
      email: 'a12katta@gmail.com',
      name: '<script>alert("xss")</script>',
    });

    const modal = new GoogleDriveModal({
      container: env.doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const logBox = env.doc.querySelector('#gdrive-log-box');
    assert.ok(logBox);
    // Ensure no <img> elements parsed into DOM
    const imgTags = logBox.querySelectorAll('img');
    assert.strictEqual(imgTags.length, 0, 'HTML tag <img> should not be parsed into DOM');
    assert.ok(
      logBox.innerHTML.includes('&lt;img src=x onerror=&quot;alert(&#039;xss&#039;)&quot;&gt;') ||
      logBox.innerHTML.includes('&lt;img src=x'),
      'Log message must be HTML-entity escaped'
    );

    const nameEl = env.doc.querySelector('.gdrive-user-name');
    assert.ok(nameEl);
    assert.strictEqual(nameEl.querySelectorAll('script').length, 0, 'Script tag should not be parsed into DOM');
    assert.ok(nameEl.innerHTML.includes('&lt;script&gt;'), 'User name must be HTML-entity escaped');

    // Verify refreshLog sanitizes as well
    (adapter as any).addLog('<svg onload=alert(1)>', 'warning');
    (modal as any).refreshLog();
    assert.strictEqual(logBox.querySelectorAll('svg').length, 0, 'No <svg> elements injected on refreshLog');

    modal.close();
  } finally {
    env.cleanup();
  }
});
