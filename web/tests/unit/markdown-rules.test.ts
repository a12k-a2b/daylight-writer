/**
 * tests/unit/markdown-rules.test.ts
 * Unit tests for Real-Time Markdown Syntax Formatting (F10) & TreeWalker Caret Stability
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  parseMarkdownInline,
  parseMarkdownToBlocks,
  blocksToMarkdown,
  detectMarkdownTrigger,
  getCaretCharacterOffset,
  setCaretCharacterOffset,
} from '../../src/editor/markdown-rules.ts';

test('Markdown Rules: Inline syntax conversion satisfies F10 specification', () => {
  // Headings
  assert.strictEqual(parseMarkdownInline('# Daylight Note'), '<h1>Daylight Note</h1>');
  assert.strictEqual(parseMarkdownInline('## Subheading'), '<h2>Subheading</h2>');
  assert.strictEqual(parseMarkdownInline('### Section'), '<h3>Section</h3>');
  assert.strictEqual(parseMarkdownInline('#### Subsection'), '<h4>Subsection</h4>');

  // Blockquotes
  assert.strictEqual(parseMarkdownInline('> Quotation from a philosopher'), '<blockquote>Quotation from a philosopher</blockquote>');

  // Lists
  assert.strictEqual(parseMarkdownInline('- Bullet item'), '<li>Bullet item</li>');
  assert.strictEqual(parseMarkdownInline('* Alternative bullet'), '<li>Alternative bullet</li>');
  assert.strictEqual(parseMarkdownInline('1. Ordered item'), '<li>Ordered item</li>');

  // Inline styling
  assert.strictEqual(parseMarkdownInline('This is **bold** text'), 'This is <strong>bold</strong> text');
  assert.strictEqual(parseMarkdownInline('This is *italic* text'), 'This is <em>italic</em> text');
  assert.strictEqual(parseMarkdownInline('This is ***bold and italic*** text'), 'This is <strong><em>bold and italic</em></strong> text');
  assert.strictEqual(parseMarkdownInline('Here is `inline code` snippet'), 'Here is <code>inline code</code> snippet');
  assert.strictEqual(parseMarkdownInline('This is ~~strikethrough~~ text'), 'This is <del>strikethrough</del> text');
});

test('Markdown Rules: Block parsing and serialization round-trip', () => {
  const markdown = [
    '# Chapter 1',
    '',
    'First paragraph of the chapter.',
    '',
    '## Section 1.1',
    '',
    '- Point A',
    '- Point B',
    '',
    '> A quiet reflection',
  ].join('\n');

  const blocks = parseMarkdownToBlocks(markdown);
  assert.ok(blocks.length >= 5);

  const h1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  assert.ok(h1);
  assert.strictEqual(h1.text, 'Chapter 1');

  const p = blocks.find((b) => b.type === 'paragraph');
  assert.ok(p);
  assert.strictEqual(p.text, 'First paragraph of the chapter.');

  const bq = blocks.find((b) => b.type === 'blockquote');
  assert.ok(bq);
  assert.strictEqual(bq.text, '> A quiet reflection');

  // Serialize back
  const serialized = blocksToMarkdown(blocks);
  assert.ok(serialized.includes('# Chapter 1'));
  assert.ok(serialized.includes('First paragraph of the chapter.'));
});

test('Markdown Rules: Detects markdown trigger tokens on input', () => {
  assert.deepStrictEqual(detectMarkdownTrigger('# '), { isTrigger: true, type: 'h1' });
  assert.deepStrictEqual(detectMarkdownTrigger('## '), { isTrigger: true, type: 'h2' });
  assert.deepStrictEqual(detectMarkdownTrigger('### '), { isTrigger: true, type: 'h3' });
  assert.deepStrictEqual(detectMarkdownTrigger('> '), { isTrigger: true, type: 'blockquote' });
  assert.deepStrictEqual(detectMarkdownTrigger('- '), { isTrigger: true, type: 'bullet_list' });
  assert.deepStrictEqual(detectMarkdownTrigger('* '), { isTrigger: true, type: 'bullet_list' });
  assert.deepStrictEqual(detectMarkdownTrigger('1. '), { isTrigger: true, type: 'numbered_list' });
  assert.deepStrictEqual(detectMarkdownTrigger('Hello '), { isTrigger: false });
});

test('Markdown Rules: TreeWalker caret offset calculation across child text nodes', () => {
  const win = new Window();
  const doc = win.document;
  const container = doc.createElement('p');
  container.innerHTML = 'Hello <strong>bold</strong> world!';
  doc.body.appendChild(container);

  // Caret in bold text node
  const boldEl = container.querySelector('strong')!;
  const textNodeInBold = boldEl.firstChild!;

  const range = doc.createRange();
  range.setStart(textNodeInBold as any, 2); // 'bo|ld'
  range.collapse(true);

  const sel = win.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range as any);

  // Container has: "Hello " (6 chars) + "bo" (2 chars) = 8
  const offset = getCaretCharacterOffset(container as unknown as Node);
  assert.strictEqual(offset, 8);

  // Restore caret to offset 10 ("Hello bold")
  setCaretCharacterOffset(container as unknown as Node, 10);
  const restoredOffset = getCaretCharacterOffset(container as unknown as Node);
  assert.strictEqual(restoredOffset, 10);
});
