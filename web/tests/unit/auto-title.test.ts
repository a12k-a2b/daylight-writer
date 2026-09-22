/**
 * tests/unit/auto-title.test.ts
 * Unit tests for Dynamic Auto-Titling with Manual Override Lock (F11, F12)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  extractAutoTitle,
  AutoTitleManager,
  DEFAULT_UNTITLED,
} from '../../src/editor/auto-title.ts';

test('Auto-Titling: Empty or whitespace-only documents produce Untitled', () => {
  assert.strictEqual(extractAutoTitle(''), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('   \n\n\t  '), DEFAULT_UNTITLED);
});

test('Auto-Titling: Extracts headings of all levels and strips markdown syntax', () => {
  assert.strictEqual(extractAutoTitle('# The Art of Solitude'), 'The Art of Solitude');
  assert.strictEqual(extractAutoTitle('## Chapter 2: The Reflective Canvas'), 'Chapter 2: The Reflective Canvas');
  assert.strictEqual(extractAutoTitle('### Section Notes'), 'Section Notes');
  assert.strictEqual(extractAutoTitle('# '), DEFAULT_UNTITLED);
  assert.strictEqual(extractAutoTitle('###   '), DEFAULT_UNTITLED);
});

test('Auto-Titling: Extracts first punctuated phrase from prose', () => {
  const prose1 = 'In the quiet space before sunrise, thoughts crystallize slowly.';
  assert.strictEqual(extractAutoTitle(prose1), 'In the quiet space before sunrise');

  const prose2 = 'Could this truly work?! It seemed impossible.';
  assert.strictEqual(extractAutoTitle(prose2), 'Could this truly work');

  const prose3 = 'First sentence. Second sentence.';
  assert.strictEqual(extractAutoTitle(prose3), 'First sentence');
});

test('Auto-Titling: Clamps title to maxChars (default 40 chars)', () => {
  const longSentence = 'This is an extraordinarily long opening sentence that definitely exceeds forty characters.';
  const title = extractAutoTitle(longSentence);
  assert.ok(title.length <= 40, `Title length ${title.length} exceeds 40 characters`);
  assert.strictEqual(title, 'This is an extraordinarily long opening');
});

test('Auto-Titling: Single character and short phrase handling', () => {
  assert.strictEqual(extractAutoTitle('A'), 'A');
  assert.strictEqual(extractAutoTitle('A short note'), 'A short note');
});

test('AutoTitleManager: Dynamic update follows document content when unlocked', () => {
  const manager = new AutoTitleManager();
  assert.strictEqual(manager.getTitle(), DEFAULT_UNTITLED);
  assert.strictEqual(manager.getIsCustom(), false);

  const changed = manager.updateFromContent('# First Draft Heading\nBody text');
  assert.strictEqual(changed, true);
  assert.strictEqual(manager.getTitle(), 'First Draft Heading');
  assert.strictEqual(manager.getIsCustom(), false);

  // Subsequent content update updates title
  manager.updateFromContent('# Revised Heading\nBody text');
  assert.strictEqual(manager.getTitle(), 'Revised Heading');
});

test('AutoTitleManager: Manual title override lock protects title against content updates (F12)', () => {
  const manager = new AutoTitleManager();
  manager.updateFromContent('# Initial Heading\nInitial content');
  assert.strictEqual(manager.getTitle(), 'Initial Heading');

  // Author sets manual title
  manager.setManualTitle('My Custom Memoir Chapter 1');
  assert.strictEqual(manager.getTitle(), 'My Custom Memoir Chapter 1');
  assert.strictEqual(manager.getIsCustom(), true);

  // Background body edits should NOT change custom title
  const changed = manager.updateFromContent('# Totally New Heading In Body\nOther content');
  assert.strictEqual(changed, false);
  assert.strictEqual(manager.getTitle(), 'My Custom Memoir Chapter 1');
  assert.strictEqual(manager.getIsCustom(), true);

  // Resetting manual lock re-derives title from body
  const resetTitle = manager.resetManualLock('# Totally New Heading In Body\nOther content');
  assert.strictEqual(resetTitle, 'Totally New Heading In Body');
  assert.strictEqual(manager.getIsCustom(), false);
});

test('AutoTitleManager: bindDOM attaches to DOM element and locks on edit', () => {
  const win = new Window();
  const doc = win.document;
  const titleEl = doc.createElement('div');
  titleEl.contentEditable = 'true';
  titleEl.textContent = 'Original Title';
  doc.body.appendChild(titleEl);

  let savedTitle = '';
  let savedIsCustom = false;

  const manager = new AutoTitleManager('Original Title', false);
  const cleanup = manager.bindDOM(titleEl as unknown as HTMLElement, (title, isCustom) => {
    savedTitle = title;
    savedIsCustom = isCustom;
  });

  // Simulate typing into title element
  titleEl.textContent = 'User Typed Custom Title';
  titleEl.dispatchEvent(new win.Event('input'));

  assert.strictEqual(manager.getTitle(), 'User Typed Custom Title');
  assert.strictEqual(manager.getIsCustom(), true);
  assert.strictEqual(savedTitle, 'User Typed Custom Title');
  assert.strictEqual(savedIsCustom, true);

  // Simulate blur on empty title
  titleEl.textContent = '   ';
  titleEl.dispatchEvent(new win.Event('blur'));
  assert.strictEqual(titleEl.textContent, DEFAULT_UNTITLED);
  assert.strictEqual(manager.getTitle(), DEFAULT_UNTITLED);

  cleanup();
});
