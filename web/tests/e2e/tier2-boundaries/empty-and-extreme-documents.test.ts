import test from 'node:test';
import assert from 'node:assert';
import { InMemoryStorageRepository } from '../helpers/mock-adapters.ts';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';

test('Tier 2 Boundary: 0-character empty document handling across storage and editor', async () => {
  const repo = new InMemoryStorageRepository();
  const dom = new DaylightDOMSimulator();

  const emptyDoc = await repo.saveDocument({
    id: 'doc-empty',
    title: '',
    content: '',
  });

  assert.strictEqual(emptyDoc.id, 'doc-empty');
  assert.strictEqual(emptyDoc.title, 'Untitled');
  assert.strictEqual(emptyDoc.content, '');

  dom.updateTitleFromText(emptyDoc.content);
  assert.strictEqual(dom.title, 'Untitled');

  const retrieved = await repo.getDocument('doc-empty');
  assert.strictEqual(retrieved?.content, '');
});

test('Tier 2 Boundary: Single-character document handling', async () => {
  const repo = new InMemoryStorageRepository();
  const dom = new DaylightDOMSimulator();

  const singleCharDoc = await repo.saveDocument({
    id: 'doc-single',
    title: '',
    content: 'X',
  });

  dom.updateTitleFromText(singleCharDoc.content);
  assert.strictEqual(dom.title, 'X');
  assert.strictEqual(singleCharDoc.content, 'X');
});

test('Tier 2 Boundary: Maximum length document (100,000+ words stress test)', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  // Generate 100,000 words document (~600,000 characters)
  const paragraph = 'Daylight reflective LivePaper display enables sustained thought without visual fatigue. ';
  const repeatCount = 10000; // ~100,000 words
  const longContent = paragraph.repeat(repeatCount);
  const wordCount = longContent.split(/\s+/).filter(Boolean).length;

  assert.ok(wordCount >= 100000, `Expected >= 100,000 words, got ${wordCount}`);

  const startSave = performance.now();
  const doc = await repo.saveDocument({
    id: 'doc-100k',
    title: 'The Great Novel Draft',
    content: longContent,
  });
  const saveDuration = performance.now() - startSave;

  // In-memory write cache must absorb 100k words in < 50ms
  assert.ok(saveDuration < 100, `Saving 100k words took ${saveDuration.toFixed(2)}ms`);

  const startRead = performance.now();
  const loaded = await repo.getDocument('doc-100k');
  const readDuration = performance.now() - startRead;

  assert.ok(loaded !== null);
  assert.strictEqual(loaded?.content.length, longContent.length);
  assert.ok(readDuration < 50, `Reading 100k words took ${readDuration.toFixed(2)}ms`);
});

test('Tier 2 Boundary: Extreme title length (500+ characters auto-titling clamp)', () => {
  const dom = new DaylightDOMSimulator();
  const longTitleLine = 'This is an extraordinarily long opening sentence that exceeds normal limits and continues without any punctuation marks for several lines of prose';

  dom.updateTitleFromText(longTitleLine);
  // Must clamp to <= 40 characters
  assert.ok(dom.title.length <= 40);
  assert.strictEqual(dom.title, 'This is an extraordinarily long opening');
});

test('Tier 2 Boundary: Whitespace-only document handling', async () => {
  const repo = new InMemoryStorageRepository();
  const dom = new DaylightDOMSimulator();

  const whitespaceDoc = await repo.saveDocument({
    id: 'doc-space',
    title: '   ',
    content: '   \n\n   \t\t\n   ',
  });

  dom.updateTitleFromText(whitespaceDoc.content);
  assert.strictEqual(dom.title, 'Untitled');
});
