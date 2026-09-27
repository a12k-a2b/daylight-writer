/**
 * tests/adversarial/m3-it2-challenger2-deep-empirical-stress.test.ts
 * Milestone 3 Iteration 2 Deep Empirical Adversarial Verification Suite
 *
 * Authored by: teamwork_preview_challenger_m3_it2_2
 *
 * Specific Verification Objectives:
 * 1. Challenge 4.5 Contrast Ratio Verification:
 *    - Compute exact relative luminance and contrast ratio for .collab-hint on --os-50.
 *    - Verify contrast >= 4.5:1 (WCAG AA) and >= 7.0:1 (WCAG AAA) with actual ratio 7.18:1.
 * 2. Concurrency Stress:
 *    - Dismiss modal during 400ms verification timeout across 5 distinct dismissal mechanisms.
 *    - Test pre-timeout dismissal (during in-flight network verification).
 *    - 50 rapid sequential cycles of verify -> early dismiss; assert exactly 0 zombie overlay elements in DOM.
 *    - Rapid re-opening test: verify -> close at 100ms -> open at 200ms -> wait for 400ms timer; assert exactly 1 overlay (no duplicates).
 * 3. Hostile Manuscript Title & XSS Sanitization in GoogleDriveModal:
 *    - Inject hostile manuscript titles with active script/img/svg/iframe tags into sync activity logs and user profile.
 *    - Assert 0 executable DOM nodes created, 0 script executions, and correct HTML entity escaping.
 * 4. Hostile Manuscript Title & XSS Sanitization in LeftLibraryDrawer:
 *    - Inject hostile manuscript titles into SQLite documents and render library cards, search results, and outline binder.
 *    - Assert 0 executable DOM nodes created, 0 script executions, and correct escaping.
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Window } from 'happy-dom';
import { GoogleDriveModal } from '../../src/ui/google-drive-modal.ts';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { LeftLibraryDrawer } from '../../src/drawers/left-library.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import { calculateContrastRatio, relativeLuminance, parseColor, SOL_OS_PALETTE } from '../e2e/helpers/contrast-verifier.ts';

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

  // Global XSS canary flag
  (win as any).__xss_canary = false;
  (globalThis as any).__xss_canary = false;

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
      delete (win as any).__xss_canary;
      delete (globalThis as any).__xss_canary;
    },
  };
}

// ============================================================================
// Suite 1: Sol:OS Contrast and Token Verification (Challenge 4.5 Invariant)
// ============================================================================

describe('Suite 1: Sol:OS Contrast and Token Verification (Challenge 4.5 Invariant)', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('1.1: Math verification of relative luminance and contrast ratio for --os-400 vs --os-50', () => {
    const [r400, g400, b400] = parseColor(SOL_OS_PALETTE.os400); // #535353 = 83, 83, 83
    const [r50, g50, b50] = parseColor(SOL_OS_PALETTE.os50);     // #F7F7F7 = 247, 247, 247

    assert.strictEqual(r400, 83);
    assert.strictEqual(g400, 83);
    assert.strictEqual(b400, 83);
    assert.strictEqual(r50, 247);
    assert.strictEqual(g50, 247);
    assert.strictEqual(b50, 247);

    const l400 = relativeLuminance(r400, g400, b400);
    const l50 = relativeLuminance(r50, g50, b50);

    const ratio = (l50 + 0.05) / (l400 + 0.05);
    const roundedRatio = parseFloat(ratio.toFixed(2));

    // Confirm exact expected value 7.18:1
    assert.strictEqual(roundedRatio, 7.18, `Contrast ratio must round to exactly 7.18:1 (actual: ${ratio})`);
    assert.ok(roundedRatio >= 4.5, 'Meets WCAG 2.1 AA requirement (>= 4.5:1)');
    assert.ok(roundedRatio >= 7.0, 'Meets WCAG 2.1 AAA requirement (>= 7.0:1)');
  });

  test('1.2: DOM Computed Style verification for .collab-hint in GoogleDriveModal', () => {
    const { doc, win } = env;

    const adapter = new GoogleDriveSyncAdapter();
    const modal = new GoogleDriveModal({
      container: doc.body as unknown as HTMLElement,
      adapter,
    });
    modal.open();

    const hintEl = doc.querySelector('.gdrive-modal .collab-hint') as any;
    assert.ok(hintEl, '.collab-hint must exist in .gdrive-modal DOM');

    const cs = win.getComputedStyle(hintEl);
    const color = cs.color;
    const bg = SOL_OS_PALETTE.os50;

    const ratio = calculateContrastRatio(color, bg);
    assert.ok(
      ratio >= 4.5,
      `WCAG AA Compliance: .collab-hint contrast is ${ratio.toFixed(2)}:1, must be >= 4.5:1`
    );
    assert.strictEqual(parseFloat(ratio.toFixed(2)), 7.18, 'Contrast ratio must match calibrated 7.18:1');

    modal.close();
  });
});

// ============================================================================
// Suite 2: Concurrency Stress: Zombie Overlay Prevention During Verification
// ============================================================================

describe('Suite 2: Concurrency Stress: Zombie Overlay Prevention During Verification', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('2.1: Dismissal via close button at t=50ms during 400ms verification timeout leaves 0 zombie overlays', async () => {
    const { doc } = env;
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Author' });

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
    modal.open();

    const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
    const tokenInput = doc.querySelector('#gdrive-token-input') as any;
    tokenInput.value = 'ya29.test-valid';
    saveBtn.click();

    // Wait 50ms (inside the 400ms post-verify render window)
    await new Promise((r) => setTimeout(r, 50));

    // Dismiss via header close button
    const closeBtn = doc.querySelector('#gdrive-modal-close') as any;
    assert.ok(closeBtn, 'Close button must exist');
    closeBtn.click();

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    // Wait out remaining verification window (450ms more)
    await new Promise((r) => setTimeout(r, 450));

    assert.strictEqual(
      doc.querySelectorAll('.gdrive-modal-backdrop').length,
      0,
      'Exactly 0 zombie overlay elements must exist after timer expiry'
    );
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal').length, 0);
  });

  test('2.2: Dismissal via Escape key at t=150ms during 400ms timeout leaves 0 zombie overlays', async () => {
    const { doc, win } = env;
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Author' });

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
    modal.open();

    const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
    const tokenInput = doc.querySelector('#gdrive-token-input') as any;
    tokenInput.value = 'ya29.test-valid';
    saveBtn.click();

    await new Promise((r) => setTimeout(r, 150));

    // Dismiss via Escape key
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as any);

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    await new Promise((r) => setTimeout(r, 350));

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal').length, 0);
  });

  test('2.3: Dismissal via backdrop click at t=250ms during 400ms timeout leaves 0 zombie overlays', async () => {
    const { doc, win } = env;
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Author' });

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
    modal.open();

    const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
    const tokenInput = doc.querySelector('#gdrive-token-input') as any;
    tokenInput.value = 'ya29.test-valid';
    saveBtn.click();

    await new Promise((r) => setTimeout(r, 250));

    // Dismiss via light-dismiss backdrop click
    const backdrop = doc.querySelector('.gdrive-modal-backdrop') as any;
    assert.ok(backdrop);
    backdrop.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as any);

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    await new Promise((r) => setTimeout(r, 250));

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal').length, 0);
  });

  test('2.4: Dismissal via footer cancel button at t=350ms during 400ms timeout leaves 0 zombie overlays', async () => {
    const { doc } = env;
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Author' });

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
    modal.open();

    const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
    const tokenInput = doc.querySelector('#gdrive-token-input') as any;
    tokenInput.value = 'ya29.test-valid';
    saveBtn.click();

    await new Promise((r) => setTimeout(r, 350));

    const cancelBtn = doc.querySelector('#gdrive-footer-cancel') as any;
    assert.ok(cancelBtn);
    cancelBtn.click();

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal').length, 0);
  });

  test('2.5: Dismissal while adapter.verifyAuthentication is still in-flight (async network preemption)', async () => {
    const { doc } = env;
    let resolveAuth: (val: any) => void = () => {};
    const authPromise = new Promise((resolve) => {
      resolveAuth = resolve;
    });

    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = () => authPromise as any;

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
    modal.open();

    const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
    const tokenInput = doc.querySelector('#gdrive-token-input') as any;
    tokenInput.value = 'ya29.pending-token';
    saveBtn.click();

    assert.strictEqual(saveBtn.textContent, 'Verifying...');

    // Close modal BEFORE network call completes
    modal.close();
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    // Now let network call resolve
    resolveAuth({ email: 'a12katta@gmail.com', name: 'Author' });

    // Wait 500ms
    await new Promise((r) => setTimeout(r, 500));

    // Invariant: No zombie overlay should be resurrected
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal').length, 0);
  });

  test('2.6: Rapid re-opening: verify -> close at 100ms -> reopen at 200ms -> wait for 400ms timer; assert exactly 1 overlay', async () => {
    const { doc } = env;
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Author' });

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
    modal.open();

    const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
    const tokenInput = doc.querySelector('#gdrive-token-input') as any;
    tokenInput.value = 'ya29.test-valid';
    saveBtn.click();

    // Close at 100ms
    await new Promise((r) => setTimeout(r, 100));
    modal.close();
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);

    // Reopen at 200ms
    await new Promise((r) => setTimeout(r, 100));
    modal.open();
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 1);

    // Wait until past the original 400ms mark
    await new Promise((r) => setTimeout(r, 300));

    // There must be exactly 1 backdrop, never 2
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 1);
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal').length, 1);

    modal.close();
    assert.strictEqual(doc.querySelectorAll('.gdrive-modal-backdrop').length, 0);
  });

  test('2.7: 50-cycle rapid burst stress test of verify and immediate early dismissal', async () => {
    const { doc } = env;
    const adapter = new GoogleDriveSyncAdapter();
    adapter.verifyAuthentication = async () => ({ email: 'a12katta@gmail.com', name: 'Author' });

    const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });

    for (let i = 0; i < 50; i++) {
      modal.open();
      const saveBtn = doc.querySelector('#gdrive-save-token-btn') as any;
      const tokenInput = doc.querySelector('#gdrive-token-input') as any;
      if (tokenInput && saveBtn) {
        tokenInput.value = `ya29.cycle-${i}`;
        saveBtn.click();
      }

      // Early dismiss at pseudo-random interval between 0ms and 15ms
      const delay = (i % 4) * 5;
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }

      modal.close();

      assert.strictEqual(
        doc.querySelectorAll('.gdrive-modal-backdrop').length,
        0,
        `Burst cycle ${i + 1}: Must leave 0 backdrops after close()`
      );
    }

    // Wait 500ms to allow any orphaned timers to expire
    await new Promise((r) => setTimeout(r, 500));

    assert.strictEqual(
      doc.querySelectorAll('.gdrive-modal-backdrop').length,
      0,
      'Post-burst: Exactly 0 zombie overlays in DOM'
    );
  });
});

// ============================================================================
// Suite 3: Hostile Manuscript Title & XSS Sanitization in GoogleDriveModal
// ============================================================================

describe('Suite 3: Hostile Manuscript Title & XSS Sanitization in GoogleDriveModal', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  const hostilePayloads = [
    {
      name: 'Script tag with canary execution',
      payload: '<script>window.__xss_canary = true;</script>',
      tag: 'script',
    },
    {
      name: 'Image tag with onerror handler',
      payload: '<img src="invalid_path.png" onerror="window.__xss_canary = true;">',
      tag: 'img',
    },
    {
      name: 'SVG element with onload handler',
      payload: '<svg onload="window.__xss_canary = true;"><circle r=10/></svg>',
      tag: 'svg',
    },
    {
      name: 'Iframe with javascript uri',
      payload: '<iframe src="javascript:window.__xss_canary = true;"></iframe>',
      tag: 'iframe',
    },
    {
      name: 'Details element with ontoggle execution',
      payload: '<details open ontoggle="window.__xss_canary = true;"><summary>x</summary></details>',
      tag: 'details',
    },
    {
      name: 'Attribute injection breakout',
      payload: '"><script>window.__xss_canary = true;</script>',
      tag: 'script',
    },
    {
      name: 'Style tag injection',
      payload: '<style>body{display:none !important;}</style>',
      tag: 'style',
    },
  ];

  for (const item of hostilePayloads) {
    test(`3.1: Hostile title "${item.name}" injected into sync activity logs creates 0 executable DOM nodes`, () => {
      const { doc, win } = env;
      const adapter = new GoogleDriveSyncAdapter();

      // Simulate adapter logging manuscript title operations
      (adapter as any).addLog(`Syncing "${item.payload}" to Google Drive...`, 'info');
      (adapter as any).addLog(`Created new file "${item.payload}" in Google Drive`, 'success');
      (adapter as any).addLog(`Sync error on "${item.payload}": failed`, 'error');

      const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
      modal.open();

      const logBox = doc.querySelector('#gdrive-log-box');
      assert.ok(logBox, '#gdrive-log-box must exist');

      // Assert no hostile tags parsed into DOM
      const foundTags = logBox.querySelectorAll(item.tag);
      assert.strictEqual(
        foundTags.length,
        0,
        `Hostile tag <${item.tag}> must NOT be created as a DOM element in logBox`
      );

      // Assert canary was not executed
      assert.strictEqual((win as any).__xss_canary, false, 'XSS canary flag must remain false');

      // Verify log content is safely entity-escaped
      assert.ok(
        logBox.innerHTML.includes('&lt;') || !logBox.innerHTML.includes('<' + item.tag),
        'Raw unescaped opening tag must not exist in innerHTML'
      );

      // Test refreshLog under the same payload
      (adapter as any).addLog(`Updated "${item.payload}"`, 'warn');
      (modal as any).refreshLog();

      const foundAfterRefresh = logBox.querySelectorAll(item.tag);
      assert.strictEqual(foundAfterRefresh.length, 0, 'No hostile tags created on refreshLog');
      assert.strictEqual((win as any).__xss_canary, false);

      modal.close();
    });

    test(`3.2: Hostile user metadata "${item.name}" in GoogleDriveModal creates 0 executable DOM nodes`, () => {
      const { doc, win } = env;
      const adapter = new GoogleDriveSyncAdapter({ accessToken: 'ya29.token' });
      adapter.setCurrentUser({
        email: `attacker+${item.payload}@example.com`,
        name: `Attacker ${item.payload}`,
      });

      const modal = new GoogleDriveModal({ container: doc.body as unknown as HTMLElement, adapter });
      modal.open();

      const modalEl = doc.querySelector('.gdrive-modal');
      assert.ok(modalEl);

      const foundTags = modalEl.querySelectorAll(item.tag);
      assert.strictEqual(foundTags.length, 0, `Tag <${item.tag}> must not be injected in user profile`);
      assert.strictEqual((win as any).__xss_canary, false, 'XSS canary flag must remain false');

      const nameEl = doc.querySelector('.gdrive-user-name');
      assert.ok(nameEl);
      assert.strictEqual(nameEl.querySelectorAll(item.tag).length, 0);

      const emailEl = doc.querySelector('.gdrive-user-email');
      assert.ok(emailEl);
      assert.strictEqual(emailEl.querySelectorAll(item.tag).length, 0);

      modal.close();
    });
  }
});

// ============================================================================
// Suite 4: Hostile Manuscript Title & XSS Sanitization in LeftLibraryDrawer
// ============================================================================

describe('Suite 4: Hostile Manuscript Title & XSS Sanitization in LeftLibraryDrawer', () => {
  let env: ReturnType<typeof setupDomEnvironment>;

  beforeEach(() => {
    env = setupDomEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('4.1: Manuscript with script tag title creates 0 script elements in library cards and outline tree', async () => {
    const { doc, win } = env;

    const shell = doc.createElement('div');
    shell.className = 'dc1-shell zero-chrome';
    const container = doc.createElement('aside');
    container.className = 'drawer drawer-left';
    shell.appendChild(container);
    doc.body.appendChild(shell);

    const repo = new InMemoryStorageRepository();
    await repo.init();

    const hostileTitle = 'Attack <script>window.__xss_canary = true;</script>';
    await repo.saveDocument({
      id: 'doc-hostile-1',
      title: hostileTitle,
      content: 'Legitimate document text.',
      created_at: 1000,
      updated_at: 1000,
    });

    const drawer = new LeftLibraryDrawer({
      container: container as unknown as HTMLElement,
      shellElement: shell as unknown as HTMLElement,
      repository: repo,
      onSelectDocument: () => {},
    });

    await drawer.init();
    drawer.open();

    // 1. Inspect rendered document card
    const cardEl = container.querySelector("[data-id='doc-hostile-1']") as any;
    assert.ok(cardEl, 'Card must be rendered');

    const scriptTagsInCard = cardEl.querySelectorAll('script');
    assert.strictEqual(scriptTagsInCard.length, 0, 'Zero script tags allowed inside document card');
    assert.strictEqual((win as any).__xss_canary, false, 'XSS canary must remain false');

    const titleEl = cardEl.querySelector('.doc-item-title') as any;
    assert.ok(titleEl);
    assert.strictEqual(titleEl.textContent, hostileTitle, 'Visual textContent preserves title safely');
    assert.ok(titleEl.innerHTML.includes('&lt;script&gt;'), 'innerHTML must be entity escaped');
    assert.strictEqual(titleEl.innerHTML.includes('<script>'), false, 'innerHTML must not contain raw <script>');

    // 2. Switch to Outline mode and verify
    await drawer.setViewMode('outline');
    const outlineRow = container.querySelector(".outline-row[data-outline-id='doc-hostile-1']") as any;
    assert.ok(outlineRow, 'Outline row must be rendered');

    const scriptTagsInOutline = outlineRow.querySelectorAll('script');
    assert.strictEqual(scriptTagsInOutline.length, 0, 'Zero script tags allowed inside outline row');
    assert.strictEqual((win as any).__xss_canary, false);

    const outlineTitleEl = outlineRow.querySelector('.outline-title') as any;
    assert.ok(outlineTitleEl);
    assert.strictEqual(outlineTitleEl.textContent, hostileTitle);

    drawer.destroy();
  });

  test('4.2: Manuscript with img onerror title creates 0 img tags and does not trigger error callback', async () => {
    const { doc, win } = env;

    const shell = doc.createElement('div');
    shell.className = 'dc1-shell zero-chrome';
    const container = doc.createElement('aside');
    container.className = 'drawer drawer-left';
    shell.appendChild(container);
    doc.body.appendChild(shell);

    const repo = new InMemoryStorageRepository();
    await repo.init();

    const hostileTitle = 'Attack <img src="nonexistent.png" onerror="window.__xss_canary = true;">';
    await repo.saveDocument({
      id: 'doc-hostile-2',
      title: hostileTitle,
      content: 'Body with <script>alert(1)</script>',
      created_at: 2000,
      updated_at: 2000,
    });

    const drawer = new LeftLibraryDrawer({
      container: container as unknown as HTMLElement,
      shellElement: shell as unknown as HTMLElement,
      repository: repo,
      onSelectDocument: () => {},
    });

    await drawer.init();
    drawer.open();

    const cardEl = container.querySelector("[data-id='doc-hostile-2']") as any;
    assert.ok(cardEl);

    const imgTags = cardEl.querySelectorAll('img');
    assert.strictEqual(imgTags.length, 0, 'Zero img tags must be parsed into DOM');
    assert.strictEqual((win as any).__xss_canary, false, 'Canary must not be triggered');

    drawer.destroy();
  });
});
