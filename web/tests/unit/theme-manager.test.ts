/**
 * tests/unit/theme-manager.test.ts
 * Unit tests for ThemeManager & SettingsModal (Daylight Sol:OS, Day One iOS, Scrivener)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { ThemeManager, AVAILABLE_THEMES } from '../../src/ui/theme-manager.ts';
import { SettingsModal } from '../../src/ui/settings-modal.ts';

test('ThemeManager: initializes with default solos theme and catalogs all 3 themes', () => {
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).localStorage = win.localStorage;

  const manager = new ThemeManager();
  assert.strictEqual(manager.getTheme(), 'solos');
  assert.strictEqual(AVAILABLE_THEMES.length, 3);
  assert.deepStrictEqual(
    AVAILABLE_THEMES.map((t) => t.id),
    ['solos', 'dayone', 'scrivener']
  );
});

test('ThemeManager: setTheme updates state, attributes, and notifies listeners', () => {
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).localStorage = win.localStorage;

  const shell = win.document.createElement('div');
  shell.className = 'dc1-shell';
  win.document.body.appendChild(shell);

  const manager = new ThemeManager();
  manager.init();

  let notifiedTheme = '';
  manager.subscribe((theme) => {
    notifiedTheme = theme;
  });

  // Switch to Day One iOS theme
  manager.setTheme('dayone');
  assert.strictEqual(manager.getTheme(), 'dayone');
  assert.strictEqual(notifiedTheme, 'dayone');
  assert.strictEqual(win.document.documentElement.getAttribute('data-theme'), 'dayone');
  assert.strictEqual(shell.getAttribute('data-theme'), 'dayone');
  assert.ok(shell.classList.contains('theme-dayone'));

  // Switch to Scrivener theme
  manager.setTheme('scrivener');
  assert.strictEqual(manager.getTheme(), 'scrivener');
  assert.strictEqual(notifiedTheme, 'scrivener');
  assert.strictEqual(win.document.documentElement.getAttribute('data-theme'), 'scrivener');
  assert.strictEqual(shell.getAttribute('data-theme'), 'scrivener');
  assert.ok(shell.classList.contains('theme-scrivener'));
  assert.strictEqual(shell.classList.contains('theme-dayone'), false);
});

test('ThemeManager: cycleTheme advances circularly across all 3 themes', () => {
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).localStorage = win.localStorage;

  const manager = new ThemeManager();
  assert.strictEqual(manager.getTheme(), 'solos');

  assert.strictEqual(manager.cycleTheme(), 'dayone');
  assert.strictEqual(manager.cycleTheme(), 'scrivener');
  assert.strictEqual(manager.cycleTheme(), 'solos');
  assert.strictEqual(manager.cycleTheme(), 'dayone');
});

test('SettingsModal: opens, renders 3 theme preview cards, and switches theme on card click', () => {
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).localStorage = win.localStorage;

  const manager = new ThemeManager();
  let themeChangedTo = '';

  const modal = new SettingsModal({
    container: win.document.body as unknown as HTMLElement,
    themeManager: manager,
    onThemeChanged: (t) => {
      themeChangedTo = t;
    },
  });

  modal.open();
  const overlay = win.document.querySelector('.settings-modal-overlay');
  assert.ok(overlay, 'Settings modal overlay should exist in DOM');

  const themeCards = overlay.querySelectorAll('.theme-card');
  assert.strictEqual(themeCards.length, 3, 'Should render cards for all 3 themes');

  // Click on Scrivener theme card
  const scrivenerCard = overlay.querySelector('.theme-card[data-theme-id="scrivener"]') as unknown as HTMLElement;
  assert.ok(scrivenerCard, 'Scrivener card should exist');
  scrivenerCard.click();

  assert.strictEqual(manager.getTheme(), 'scrivener');
  assert.strictEqual(themeChangedTo, 'scrivener');
  assert.ok(scrivenerCard.classList.contains('active'));

  // Close modal
  modal.close();
});
