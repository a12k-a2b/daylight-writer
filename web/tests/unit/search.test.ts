/**
 * tests/unit/search.test.ts
 * Unit tests for Sub-50ms Fuzzy Search, Tokenizer & Hierarchical Tag Parser
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  extractTagsFromText,
  getTagAncestors,
  isTagMatch,
  parseSearchQuery,
  scoreSubsequenceMatch,
  escapeHtml,
  formatHighlightSnippet,
  searchDocumentsInMemory,
  buildTagTree,
  getSearchBlocks,
} from '../../src/storage/search.ts';
import type { DocumentRecord, TagRecord } from '../../src/storage/schema.ts';

test('Tag Parser: extracts simple and nested tags from markdown', () => {
  const text = `
    # Heading 1
    This is a draft for #novel/chapter1 and #ideas/plot-twist.
    Also check out #draft.
  `;
  const tags = extractTagsFromText(text);
  assert.ok(tags.includes('novel/chapter1'));
  assert.ok(tags.includes('ideas/plot-twist'));
  assert.ok(tags.includes('draft'));
  assert.ok(!tags.includes('Heading')); // Heading 1 is markdown heading, not a tag
});

test('Tag Parser: strips punctuation at boundaries', () => {
  const text = 'Look at #project/drafts. And what about #urgent! (#important)?';
  const tags = extractTagsFromText(text);
  assert.deepStrictEqual(tags, ['project/drafts', 'urgent', 'important']);
});

test('Tag Hierarchy: deconstructs hierarchical tag path into ancestors', () => {
  assert.deepStrictEqual(getTagAncestors('novel/chapter1/scene2'), [
    'novel',
    'novel/chapter1',
    'novel/chapter1/scene2',
  ]);
  assert.deepStrictEqual(getTagAncestors('draft'), ['draft']);
  assert.deepStrictEqual(getTagAncestors(''), []);
});

test('Tag Match: matches exact tag path and prefix descendants', () => {
  assert.strictEqual(isTagMatch('project/drafts/v1', 'project'), true);
  assert.strictEqual(isTagMatch('project/drafts/v1', 'project/drafts'), true);
  assert.strictEqual(isTagMatch('project/drafts/v1', 'project/drafts/v1'), true);
  assert.strictEqual(isTagMatch('project/drafts/v1', 'drafts'), false);
  assert.strictEqual(isTagMatch('other/tag', 'project'), false);
});

test('Search Tokenizer: separates tag directives from text tokens', () => {
  const parsed = parseSearchQuery('typewriter #project/drafts focus #urgent');
  assert.deepStrictEqual(parsed.tagFilters, ['project/drafts', 'urgent']);
  assert.deepStrictEqual(parsed.textTerms, ['typewriter', 'focus']);
});

test('Subsequence Match: matches exact and subsequence needle in haystack', () => {
  const exact = scoreSubsequenceMatch('typewriter', 'typewriter');
  assert.ok(exact !== null);
  assert.ok(exact!.score > 100);

  const sub = scoreSubsequenceMatch('typwrtr', 'typewriter');
  assert.ok(sub !== null);
  assert.ok(sub!.score > 0);

  const nonMatch = scoreSubsequenceMatch('xyz', 'typewriter');
  assert.strictEqual(nonMatch, null);
});

test('Subsequence Match: awards word boundary bonuses', () => {
  const atStart = scoreSubsequenceMatch('draft', 'draft copy');
  const midWord = scoreSubsequenceMatch('draft', 'redrafting');
  assert.ok(atStart!.score > midWord!.score);
});

test('Highlight Formatting: formats Sol:OS search highlight snippet', () => {
  const snippet = formatHighlightSnippet('The quick typewriter jumped over the lazy keyboard', [[10, 20]]);
  assert.ok(snippet.includes('<mark class="os-search-highlight">typewriter</mark>'));
});

test('In-Memory Fuzzy Search: performs sub-50ms search with weighted multi-attribute ranking', () => {
  const mockDocs: DocumentRecord[] = [
    {
      id: '1',
      title: 'Morning Reflections',
      content: 'Writing on the Daylight DC1 LivePaper screen is serene.',
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
    {
      id: '2',
      title: 'Draft Novel Chapter 1',
      content: 'The typewriter keys clicked softly in the night.',
      created_at: 1000,
      updated_at: 3000,
      deleted_at: null,
      is_title_custom: true,
      format_version: 1,
      sync_status: 'synced',
    },
    {
      id: '3',
      title: 'Deleted Notes',
      content: 'Should not appear in search.',
      created_at: 1000,
      updated_at: 4000,
      deleted_at: 5000, // soft deleted
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
  ];

  const docTags = new Map<string, string[]>([
    ['1', ['journal/morning', 'daily']],
    ['2', ['novel/chapter1']],
  ]);

  const start = performance.now();
  const results = searchDocumentsInMemory('typewriter', mockDocs, docTags);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 50, `Search must complete <50ms, took ${elapsed.toFixed(2)}ms`);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].document.id, '2');
});

test('Tag Tree Builder: constructs nested hierarchy with correct counts', () => {
  const tags: TagRecord[] = [
    { id: 't1', name: 'novel', path: 'novel', created_at: 1000 },
    { id: 't2', name: 'drafts', path: 'novel/drafts', created_at: 1000 },
    { id: 't3', name: 'research', path: 'research', created_at: 1000 },
  ];

  const docTags = new Map<string, string[]>([
    ['doc1', ['novel/drafts']],
    ['doc2', ['novel']],
    ['doc3', ['research']],
  ]);

  const tree = buildTagTree(tags, docTags);
  assert.strictEqual(tree.length, 2); // 'novel' and 'research'

  const novelRoot = tree.find(t => t.name === 'novel');
  assert.ok(novelRoot);
  assert.strictEqual(novelRoot!.directCount, 1);
  assert.strictEqual(novelRoot!.count, 2); // 1 direct + 1 in novel/drafts
  assert.strictEqual(novelRoot!.children.length, 1);
  assert.strictEqual(novelRoot!.children[0].name, 'drafts');
  assert.strictEqual(novelRoot!.children[0].count, 1);
});

test('Search: finds keywords beyond 5,000 characters in long manuscripts', () => {
  // Generate a manuscript of ~12,000 characters
  const preamble = 'Paragraph text exploring the nuances of reflective paper and natural amber light.\n\n'.repeat(100);
  const needleParagraph = 'Deep inside chapter forty two, the mysterious albatross appeared on the horizon.\n\n';
  const postamble = 'More contemplative reflections on quiet computing and focus.\n\n'.repeat(50);
  const fullContent = preamble + needleParagraph + postamble;

  assert.ok(preamble.length > 5000, `Preamble should be > 5,000 chars, got ${preamble.length}`);
  assert.ok(fullContent.length > 10000, `Manuscript should be > 10,000 chars, got ${fullContent.length}`);

  const mockDocs: DocumentRecord[] = [
    {
      id: 'long-doc-1',
      title: 'Epic Manuscript',
      content: fullContent,
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
      is_title_custom: true,
      format_version: 1,
      sync_status: 'synced',
    },
  ];

  const results = searchDocumentsInMemory('albatross', mockDocs, new Map());
  assert.strictEqual(results.length, 1, 'Should find keyword even when located beyond 5,000 chars');
  assert.strictEqual(results[0].document.id, 'long-doc-1');
  assert.ok(results[0].matchHighlights.length > 0);
  assert.ok(results[0].matchHighlights.some(h => h.includes('albatross')));
  assert.ok(results[0].matchHighlights.some(h => h.includes('<mark class="os-search-highlight">albatross</mark>')));
});

test('Search Chunking: getSearchBlocks preserves full text and bounds chunk sizes', () => {
  const paragraphs = [
    'Paragraph 1: Introduction to reflective paper displays.',
    'Paragraph 2: Detailed architecture of the Sol:OS storage engine.',
    'Paragraph 3: Explaining debounced flushes and monotonic revision counters.',
    'Paragraph 4: ' + 'Very long sentence. '.repeat(200), // > 4000 chars
  ];
  const content = paragraphs.join('\n\n');

  const blocks = getSearchBlocks(content, 2500);
  assert.ok(blocks.length >= 2, 'Should divide into multiple bounded blocks');
  for (const block of blocks) {
    assert.ok(block.length <= 2500, `Block should be <= 2500 chars, got ${block.length}`);
    assert.ok(content.includes(block));
  }
});

test('escapeHtml: properly escapes &, <, >, ", and \'', () => {
  const raw = `Special chars: & < > " ' and clean text`;
  const escaped = escapeHtml(raw);
  assert.strictEqual(escaped, 'Special chars: &amp; &lt; &gt; &quot; &#039; and clean text');
});

test('Highlight Formatting: escapes dangerous HTML tags while preserving <mark> highlights', () => {
  const hostileContent = 'Dangerous content with <script>alert("xss")</script> and <img src="x" onerror="evil()" /> in text.';
  // Highlight "content" at index 10..17
  const snippet = formatHighlightSnippet(hostileContent, [[10, 17]], 120);

  // 1. Must contain official Sol:OS search highlight mark
  assert.ok(
    snippet.includes('<mark class="os-search-highlight">content</mark>'),
    'Highlight mark must wrap matched term'
  );

  // 2. Dangerous raw HTML tags must NOT be present unescaped
  assert.strictEqual(snippet.includes('<script>'), false, 'Raw <script> tag must not be present');
  assert.strictEqual(snippet.includes('<img'), false, 'Raw <img> tag must not be present');

  // 3. Escaped entities must be present
  assert.ok(snippet.includes('&lt;script&gt;'), 'Snippet must contain escaped &lt;script&gt;');
  assert.ok(snippet.includes('&lt;img'), 'Snippet must contain escaped &lt;img');
});

test('Highlight Formatting: math expressions with < and > render cleanly and are preserved', () => {
  const mathContent = 'Mathematical theorem: where 0 < x && y > 100 with delta < epsilon.';
  // Highlight "theorem" at index 13..20
  const snippet = formatHighlightSnippet(mathContent, [[13, 20]], 120);

  assert.ok(snippet.includes('<mark class="os-search-highlight">theorem</mark>'));
  assert.ok(snippet.includes('&lt; x &amp;&amp; y &gt; 100'));
  assert.ok(snippet.includes('delta &lt; epsilon'));
});

test('Highlight Formatting: zero-range fallback returns escaped text', () => {
  const hostileRaw = '<script>alert(1)</script>';
  const fallback = formatHighlightSnippet(hostileRaw, [], 120);
  assert.strictEqual(fallback, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('In-Memory Fuzzy Search: escapes title and tag match highlights', () => {
  const mockDocs: DocumentRecord[] = [
    {
      id: 'doc-xss-title',
      title: 'Review: <img src=x onerror=alert(1)>',
      content: 'Standard content.',
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
      is_title_custom: true,
      format_version: 1,
      sync_status: 'synced',
    },
  ];

  const tagsMap = new Map<string, string[]>([
    ['doc-xss-title', ['status/<script>malicious</script>']],
  ]);

  const results = searchDocumentsInMemory('Review', mockDocs, tagsMap);
  assert.strictEqual(results.length, 1);
  assert.ok(results[0].matchHighlights.some(h => h.includes('&lt;img')));
  assert.ok(!results[0].matchHighlights.some(h => h.includes('<img')));

  const tagResults = searchDocumentsInMemory('#status', mockDocs, tagsMap);
  assert.strictEqual(tagResults.length, 1);
  assert.ok(tagResults[0].matchHighlights.some(h => h.includes('&lt;script&gt;')));
  assert.ok(!tagResults[0].matchHighlights.some(h => h.includes('<script>')));
});
