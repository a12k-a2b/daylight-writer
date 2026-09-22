/**
 * tests/adversarial/drawer-left-stress.test.ts
 * Milestone 3 Adversarial Stress Test Suite
 * Empirical Challenger Verification for Left Navigation Drawer, Fuzzy Search,
 * Deep Tag Tree Browsing, Sort Toggle & Selection Churn
 *
 * Covers:
 * 1. Deep Hierarchical Tag Tree Browsing (5 to 7 levels deep, branch counts,
 *    recursive rollup counts, expand/collapse state persistence across redraws,
 *    prefix filtering, multi-tag associations, and root "All Documents" reset).
 * 2. High-Frequency Fuzzy Search Stress & Benchmarking (1,000 rapid keystroke
 *    cycles, empty/whitespace queries, regex control chars, quotes, unicode/emojis,
 *    long strings, sub-50ms latency assert with p99 < 10ms).
 * 3. HTML Highlighting Sanitization & XSS Security Audit (probing unescaped snippet
 *    injection, script/image DOM element generation, math formula angle-bracket corruption).
 * 4. Rapid Sort Switching & Document Selection Churn (200 rapid sort toggles,
 *    monotonic timestamp validation, 500 active document selection switches,
 *    zero card leaks, active highlight invariant).
 * 5. Drawer Lifecycle, Keyboard Shortcuts & Zero-Chrome Dismissal (Esc, Cmd+[,
 *    Cmd+N, / search focus, backdrop light dismiss, and destroy() listener cleanup).
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { LeftLibraryDrawer } from '../../src/drawers/left-library.ts';
import {
  buildTagTree,
  formatHighlightSnippet,
  searchDocumentsInMemory,
  parseSearchQuery,
  scoreSubsequenceMatch,
  isTagMatch,
  normalizeTagPath,
  type SearchHit,
  type TagTreeNode,
} from '../../src/storage/search.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations } from '../../src/storage/schema.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

// Helper to create standard DOM fixtures for LeftLibraryDrawer
function createDrawerDOMFixture() {
  const win = new Window();
  const doc = win.document;

  const shell = doc.createElement('div');
  shell.className = 'dc1-shell zero-chrome';

  const container = doc.createElement('aside');
  container.id = 'library-drawer';
  container.className = 'drawer drawer-left';

  const backdrop = doc.createElement('div');
  backdrop.id = 'drawer-backdrop';
  backdrop.className = 'drawer-backdrop';

  shell.appendChild(container);
  shell.appendChild(backdrop);

  return { win, doc, shell, container, backdrop };
}

// ----------------------------------------------------------------------------
// 1. DEEP HIERARCHICAL TAG TREE BROWSING & STATE RETENTION STRESS
// ----------------------------------------------------------------------------

test('Adversarial Stress 1.1: Deep nested tag hierarchy (5-7 levels) and mathematical count rollup', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const now = Date.now();

  // Create 6 documents spanning a 5-level nested taxonomy and multiple branches
  const doc1 = await repo.saveDocument({
    id: 'doc-scene-1',
    title: 'Chapter 1 Scene 1',
    content: 'Opening scene in the desert.',
    created_at: now - 5000,
    updated_at: now - 5000,
  });
  await repo.setDocumentTags(doc1.id, [
    'project/writing/drafts/chapter1/scene1',
    'status/done',
  ]);

  const doc2 = await repo.saveDocument({
    id: 'doc-scene-2',
    title: 'Chapter 1 Scene 2',
    content: 'Dialogue by the campfire.',
    created_at: now - 4000,
    updated_at: now - 4000,
  });
  await repo.setDocumentTags(doc2.id, [
    'project/writing/drafts/chapter1/scene2',
    'status/wip',
  ]);

  const doc3 = await repo.saveDocument({
    id: 'doc-scene-3',
    title: 'Chapter 2 Scene 1',
    content: 'Dawn arrives at the mesa.',
    created_at: now - 3000,
    updated_at: now - 3000,
  });
  await repo.setDocumentTags(doc3.id, [
    'project/writing/drafts/chapter2/scene1',
    'status/wip',
  ]);

  const doc4 = await repo.saveDocument({
    id: 'doc-notes',
    title: 'Writing Notes',
    content: 'Plot outline and character arcs.',
    created_at: now - 2000,
    updated_at: now - 2000,
  });
  await repo.setDocumentTags(doc4.id, [
    'project/writing/notes',
    'status/wip',
  ]);

  const doc5 = await repo.saveDocument({
    id: 'doc-research',
    title: 'Geology Research',
    content: 'Sandstone formations and aquifers.',
    created_at: now - 1000,
    updated_at: now - 1000,
  });
  await repo.setDocumentTags(doc5.id, [
    'project/research',
  ]);

  // Deep 7-level tag document
  const doc6 = await repo.saveDocument({
    id: 'doc-archive-deep',
    title: 'Deep Archive Entry',
    content: 'Deeply categorized manuscript.',
    created_at: now,
    updated_at: now,
  });
  await repo.setDocumentTags(doc6.id, [
    'archive/2026/q3/manuscripts/fiction/scifi/ep1',
  ]);

  const { shell, container, backdrop } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // 1. Verify buildTagTree count rollup directly
  const tags = await repo.getTags();
  const docTagsMap = new Map<string, string[]>();
  for (const d of [doc1, doc2, doc3, doc4, doc5, doc6]) {
    docTagsMap.set(d.id, await repo.getDocumentTags(d.id));
  }
  const tree = buildTagTree(tags, docTagsMap);

  const projectNode = tree.find((n) => n.path === 'project');
  assert.ok(projectNode, 'Root tag "project" must exist');
  assert.strictEqual(projectNode!.count, 5, 'project must recursively count 5 documents');

  const writingNode = projectNode!.children.find((n) => n.path === 'project/writing');
  assert.ok(writingNode, 'Child tag "project/writing" must exist');
  assert.strictEqual(writingNode!.count, 4, 'project/writing must recursively count 4 documents');

  const draftsNode = writingNode!.children.find((n) => n.path === 'project/writing/drafts');
  assert.ok(draftsNode, 'Grandchild tag "project/writing/drafts" must exist');
  assert.strictEqual(draftsNode!.count, 3, 'project/writing/drafts must recursively count 3 documents');

  const chapter1Node = draftsNode!.children.find((n) => n.path === 'project/writing/drafts/chapter1');
  assert.ok(chapter1Node, 'Great-grandchild "project/writing/drafts/chapter1" must exist');
  assert.strictEqual(chapter1Node!.count, 2, 'chapter1 must count 2 scenes');

  // Verify status branch
  const statusNode = tree.find((n) => n.path === 'status');
  assert.ok(statusNode, 'Root tag "status" must exist');
  assert.strictEqual(statusNode!.count, 4, 'status must count 4 documents');

  const wipNode = statusNode!.children.find((n) => n.path === 'status/wip');
  assert.ok(wipNode, 'status/wip must exist');
  assert.strictEqual(wipNode!.count, 3, 'status/wip must have count 3');

  // Verify 7-level deep archive branch
  const archiveNode = tree.find((n) => n.path === 'archive');
  assert.ok(archiveNode, 'Root tag "archive" must exist');
  assert.strictEqual(archiveNode!.count, 1, 'archive must count 1 document');

  // 2. Verify DOM rendering of "All Documents" root
  const allDocsRow = container.querySelector('.tag-tree-row.root-item') as unknown as HTMLElement;
  assert.ok(allDocsRow, 'All Documents row must be rendered');
  const countBadge = allDocsRow.querySelector('.tag-count');
  assert.strictEqual(countBadge?.textContent, '6', 'All Documents count badge must show 6');

  drawer.destroy();
});

test('Adversarial Stress 1.2: Deep tag expansion/collapsing state retention across UI redraws', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const doc = await repo.saveDocument({
    id: 'doc-nested',
    title: 'Deep Nested Story',
    content: 'Deeply tagged text',
  });
  await repo.setDocumentTags(doc.id, ['project/writing/drafts/chapter1/scene2']);

  const { shell, container, backdrop } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Initially, root tags are collapsed. Let us find project toggle button
  let projectRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'project'
  ) as unknown as HTMLElement;
  assert.ok(projectRow, 'Project row must exist');

  let toggleBtn = projectRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  assert.strictEqual(toggleBtn.textContent, '▸', 'Project initially shows collapsed ▸');

  // Expand Level 1 (project)
  toggleBtn.click();
  projectRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'project'
  ) as unknown as HTMLElement;
  toggleBtn = projectRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  assert.strictEqual(toggleBtn.textContent, '▾', 'Project now shows expanded ▾');

  // Expand Level 2 (writing)
  let writingRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'writing'
  ) as unknown as HTMLElement;
  assert.ok(writingRow, 'Writing row must appear under project');
  let writingToggle = writingRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  writingToggle.click();

  // Expand Level 3 (drafts)
  let draftsRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'drafts'
  ) as unknown as HTMLElement;
  assert.ok(draftsRow, 'Drafts row must appear');
  let draftsToggle = draftsRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  draftsToggle.click();

  // Expand Level 4 (chapter1)
  let chapterRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'chapter1'
  ) as unknown as HTMLElement;
  assert.ok(chapterRow, 'Chapter 1 row must appear');
  let chapterToggle = chapterRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  chapterToggle.click();

  // Leaf level (scene2) should now be in the DOM
  let sceneRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'scene2'
  ) as unknown as HTMLElement;
  assert.ok(sceneRow, 'Leaf scene2 must be visible in DOM');

  // Collapse Level 1 (project)
  projectRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'project'
  ) as unknown as HTMLElement;
  toggleBtn = projectRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  toggleBtn.click();

  // Scene 2 should no longer be in the DOM because ancestor is collapsed
  sceneRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'scene2'
  ) as unknown as HTMLElement;
  assert.strictEqual(sceneRow, undefined, 'Children must be unmounted when parent collapses');

  // Re-expand Level 1 (project)
  projectRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'project'
  ) as unknown as HTMLElement;
  toggleBtn = projectRow.querySelector('.tag-toggle-btn') as unknown as HTMLButtonElement;
  toggleBtn.click();

  // Invariant: Writing, drafts, chapter1, and scene2 must all be rendered again because
  // inner expansion states were preserved in expandedTagPaths Set!
  sceneRow = Array.from(container.querySelectorAll('.tag-tree-row')).find((r) =>
    r.querySelector('.tag-name')?.textContent === 'scene2'
  ) as unknown as HTMLElement;
  assert.ok(sceneRow, 'Scene 2 must immediately reappear because inner expansion states were preserved');

  drawer.destroy();
});

test('Adversarial Stress 1.3: Tag filtering with hierarchical prefixes and multi-tag associations', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const now = Date.now();
  await repo.saveDocument({ id: 'd1', title: 'Doc 1', content: 'Draft 1', created_at: now, updated_at: now });
  await repo.setDocumentTags('d1', ['project/writing/drafts/chapter1', 'status/wip']);

  await repo.saveDocument({ id: 'd2', title: 'Doc 2', content: 'Draft 2', created_at: now - 100, updated_at: now - 100 });
  await repo.setDocumentTags('d2', ['project/writing/drafts/chapter2', 'status/done']);

  await repo.saveDocument({ id: 'd3', title: 'Doc 3', content: 'Notes', created_at: now - 200, updated_at: now - 200 });
  await repo.setDocumentTags('d3', ['project/writing/notes', 'status/wip']);

  await repo.saveDocument({ id: 'd4', title: 'Doc 4', content: 'Personal Diary', created_at: now - 300, updated_at: now - 300 });
  await repo.setDocumentTags('d4', ['personal/journal']);

  const { shell, container, backdrop } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // 1. Initially all 4 documents listed
  let cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 4, 'All 4 documents displayed initially');

  // 2. Filter by ancestor tag "project/writing" -> matches d1, d2, d3 (3 docs)
  await drawer.filterByTag('project/writing');
  assert.strictEqual(drawer.getSelectedTagPath(), 'project/writing');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 3, 'Prefix filter project/writing must match all 3 sub-tagged documents');
  const cardIds = Array.from(cards).map((c) => (c as unknown as HTMLElement).dataset.id);
  assert.ok(cardIds.includes('d1'));
  assert.ok(cardIds.includes('d2'));
  assert.ok(cardIds.includes('d3'));
  assert.ok(!cardIds.includes('d4'));

  // 3. Filter by leaf tag "project/writing/drafts/chapter1" -> matches only d1
  await drawer.filterByTag('project/writing/drafts/chapter1');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual((cards[0] as unknown as HTMLElement).dataset.id, 'd1');

  // 4. Filter by cross-cutting multi-tag "status/wip" -> matches d1 and d3
  await drawer.filterByTag('status/wip');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 2);
  const wipIds = Array.from(cards).map((c) => (c as unknown as HTMLElement).dataset.id);
  assert.ok(wipIds.includes('d1'));
  assert.ok(wipIds.includes('d3'));

  // 5. Clear filter by selecting null -> restores all 4 documents
  await drawer.filterByTag(null);
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 4);
  assert.strictEqual(drawer.getSelectedTagPath(), null);

  drawer.destroy();
});

// ----------------------------------------------------------------------------
// 2. HIGH-FREQUENCY FUZZY SEARCH STRESS & BENCHMARKING (<50ms, <10ms target)
// ----------------------------------------------------------------------------

test('Adversarial Stress 2.1: 1,000 rapid fuzzy search query burst latency benchmark (p99 < 10ms)', async () => {
  // Generate 100 synthetic documents
  const mockDocs: DocumentRecord[] = [];
  const mockDocTags = new Map<string, string[]>();

  const dictionary = [
    'typewriter', 'livepaper', 'grayscale', 'reflective', 'focus', 'segmenter',
    'margin', 'powersync', 'sqlite', 'manuscript', 'chapter', 'solos', 'daylight',
    'distraction', 'keyboard', 'offline', 'synchronization', 'transaction', 'export',
  ];

  for (let i = 0; i < 100; i++) {
    const docId = `bench-doc-${i}`;
    const word1 = dictionary[i % dictionary.length];
    const word2 = dictionary[(i * 3) % dictionary.length];
    const word3 = dictionary[(i * 7) % dictionary.length];

    mockDocs.push({
      id: docId,
      title: `Manuscript ${i}: ${word1} and ${word2}`,
      content: `The author explored ${word1} techniques while maintaining ${word2} principles in ${word3}. `.repeat(10),
      created_at: 1700000000000 + i * 1000,
      updated_at: 1700000000000 + i * 2000,
      deleted_at: null,
      is_title_custom: i % 2 === 0,
      format_version: 1,
      sync_status: 'synced',
    });

    mockDocTags.set(docId, [`project/${word1}`, `status/${i % 2 === 0 ? 'wip' : 'done'}`]);
  }

  // Execute 1,000 rapid search queries with varying query lengths
  const queryPool = [
    'type', 'typwrt', 'livepaper', 'gray', 'refl', 'focus', 'sqlite', 'sync',
    '#project/typewriter', '#status/wip', 'manuscript', 'daylight', 'solos',
    'nonexistenttermxyz', 'a', 'e', 'the', 'chapter 1', 'trans',
  ];

  const latencies: number[] = [];
  const TOTAL_BURST = 1000;

  const tStart = performance.now();
  for (let q = 0; q < TOTAL_BURST; q++) {
    const query = queryPool[q % queryPool.length];
    const t0 = performance.now();
    const hits = searchDocumentsInMemory(query, mockDocs, mockDocTags);
    const dt = performance.now() - t0;
    latencies.push(dt);
    assert.ok(Array.isArray(hits), 'Search must return an array of hits');
  }
  const totalDuration = performance.now() - tStart;

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const max = latencies[latencies.length - 1];

  // Assertions against performance targets
  assert.ok(
    avg < 2.0,
    `Average search latency must be <2ms; observed ${avg.toFixed(3)}ms`
  );
  assert.ok(
    p99 < 10.0,
    `p99 search latency must be <10ms; observed ${p99.toFixed(3)}ms (target <10ms, spec <50ms)`
  );
  assert.ok(
    totalDuration < 2000,
    `1,000 queries burst must complete in <2,000ms; took ${totalDuration.toFixed(2)}ms`
  );
});

test('Adversarial Stress 2.2: Extreme special characters, regex meta-chars, Unicode, and empty queries', async () => {
  const mockDocs: DocumentRecord[] = [
    {
      id: 'doc-regex-target',
      title: 'Regex Targets: [.*+?^${}()|\\] and quotes "special"',
      content: 'Here are math expressions: if (x < 10 && y > 20) { return true; } emoji: ✍️🚀 and Chinese: 汉字写作.',
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
      is_title_custom: true,
      format_version: 1,
      sync_status: 'synced',
    },
  ];
  const tagsMap = new Map<string, string[]>([['doc-regex-target', ['code/regex', 'unicode/emoji']]]);

  // Hostile search inputs that would crash unshielded regexes or broken parsers
  const hostileQueries = [
    '',                                 // Empty string
    '   ',                              // Whitespace only
    '\t\n\r',                          // Control whitespaces
    '.*+?^${}()|[]\\',                 // Regex metacharacters sequence
    '(((unclosed group',               // Unclosed parenthesis
    '[[[unclosed bracket',             // Unclosed bracket
    '{{{unclosed brace',               // Unclosed curly brace
    '\\',                              // Lone backslash
    '\\\\\\\\',                        // Multiple backslashes
    '""\'\'',                          // Unpaired quotes
    '<script>alert(1)</script>',       // Script tags
    '<img src=x onerror=alert(1)>',    // Malformed HTML
    '✍️🚀',                            // Multibyte emojis
    '汉字',                             // CJK Unicode
    'x < 10 && y > 20',                // Angle brackets and ampersands
    'a'.repeat(1500),                  // Extreme 1500-character single query token
  ];

  for (const hostileQuery of hostileQueries) {
    assert.doesNotThrow(() => {
      const hits = searchDocumentsInMemory(hostileQuery, mockDocs, tagsMap);
      assert.ok(Array.isArray(hits), `Search with "${hostileQuery.slice(0, 20)}" must return array`);
    }, `Hostile query failed: ${hostileQuery}`);
  }

  // Verify empty query returns all active docs
  const emptyHits = searchDocumentsInMemory('', mockDocs, tagsMap);
  assert.strictEqual(emptyHits.length, 1);
  assert.strictEqual(emptyHits[0].document.id, 'doc-regex-target');

  // Verify regex special char match in title without escaping errors
  const regexHits = searchDocumentsInMemory('[.*+?^', mockDocs, tagsMap);
  assert.ok(regexHits.length >= 1, 'Should find substring match for regex symbols without regex error');
});

test('Adversarial Stress 2.3: HTML Highlighting Sanitization & XSS audit', async () => {
  const db = await SqliteDatabase.open({ vfsPreference: 'memory' });
  await runMigrations(db);
  const repo = new SQLiteStorageRepository(db, 250);
  await repo.init();

  // Create document with embedded XSS attack vectors in title and content
  const xssDoc = await repo.saveDocument({
    id: 'doc-xss-test',
    title: 'XSS Test: <img src="x" onerror="window.__xssRun=1" />',
    content: 'Discussion with <script>window.__scriptExecuted=true;</script> and math: a < 10 && b > 20.',
  });
  await repo.flushPendingEdits();

  const { win, doc, shell, container, backdrop } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Search matching the content
  await drawer.executeSearch('Discussion');

  const cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1);
  const card = cards[0] as unknown as HTMLElement;

  // 1. Audit Title rendering:
  // Title text is rendered via <h3 class="doc-item-title">${escapeHtml(titleText)}</h3>
  const titleEl = card.querySelector('.doc-item-title') as unknown as HTMLElement;
  assert.ok(titleEl, 'Title element must exist');
  // Confirm that raw img element from title was NOT parsed into DOM
  const imgInTitle = titleEl.querySelector('img');
  assert.strictEqual(imgInTitle, null, 'Document title must properly escape HTML so <img> is not created');
  assert.ok(titleEl.innerHTML.includes('&lt;img'), 'Title must show escaped &lt;img');

  // 2. Audit Snippet rendering and formatHighlightSnippet behavior:
  const snippetEl = card.querySelector('.doc-item-snippet') as unknown as HTMLElement;
  assert.ok(snippetEl, 'Snippet element must exist');

  // Verify highlight markup contains official Sol:OS search highlight class
  const markEl = snippetEl.querySelector('mark.os-search-highlight');
  assert.ok(markEl, 'Snippet must contain <mark class="os-search-highlight">');
  assert.strictEqual(markEl?.textContent, 'Discussion');

  // 3. Security Audit & Vulnerability Verification:
  // Probe formatHighlightSnippet directly for unescaped HTML injection:
  const rawSnippet = formatHighlightSnippet(
    'Notice: <img src="x" onerror="evil()" /> in text',
    [[0, 6]],
    120
  );
  assert.ok(
    rawSnippet.includes('<mark class="os-search-highlight">Notice</mark>'),
    'formatHighlightSnippet must correctly wrap the matched term in <mark>'
  );

  // Check if formatHighlightSnippet properly escapes HTML tags
  const isUnescapedInSnippet = rawSnippet.includes('<img');
  assert.strictEqual(isUnescapedInSnippet, false, 'formatHighlightSnippet must HTML-escape raw tags');
  assert.ok(rawSnippet.includes('&lt;img'), 'formatHighlightSnippet must contain escaped &lt;img');

  // Inspect DOM of card snippet for injected script or img elements: verify zero hostile elements
  const scriptInSnippet = snippetEl.querySelector('script');
  assert.strictEqual(scriptInSnippet, null, 'No script DOM node must be created in snippet');
  const imgInSnippet = snippetEl.querySelector('img');
  assert.strictEqual(imgInSnippet, null, 'No img DOM node must be created in snippet');
  assert.ok(snippetEl.innerHTML.includes('&lt;script&gt;'), 'Snippet DOM must show escaped &lt;script&gt;');

  // 4. Verify math brackets (a < 10 && b > 20) are preserved visually as text (&lt; / &gt;)
  await drawer.executeSearch('math');
  const mathCard = container.querySelector('.document-card') as unknown as HTMLElement;
  const mathSnippetEl = mathCard.querySelector('.doc-item-snippet') as unknown as HTMLElement;
  assert.ok(mathSnippetEl.innerHTML.includes('&lt; 10'), 'Snippet DOM must show escaped &lt; 10');
  assert.ok(mathSnippetEl.innerHTML.includes('&gt; 20'), 'Snippet DOM must show escaped &gt; 20');
  assert.ok(mathSnippetEl.textContent?.includes('a < 10 && b > 20'), 'Snippet textContent must preserve math brackets');

  const mathRawSnippet = formatHighlightSnippet(
    'Math check: a < 10 && b > 20',
    [[0, 4]],
    120
  );
  assert.ok(mathRawSnippet.includes('&lt; 10'), 'formatHighlightSnippet must escape &lt;');
  assert.ok(mathRawSnippet.includes('&gt; 20'), 'formatHighlightSnippet must escape &gt;');

  drawer.destroy();
  repo.destroy();
  await db.close();
});

// ----------------------------------------------------------------------------
// 3. RAPID SORT SWITCHING & DOCUMENT SELECTION CHURN (ZERO LEAKS, NO DESYNC)
// ----------------------------------------------------------------------------

test('Adversarial Stress 3.1: 200 rapid sort toggles under 50 documents with monotonic invariant validation', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const BASE_TIME = 1700000000000;
  const DOC_COUNT = 50;

  // Populate 50 documents where updated_at and created_at are inversely correlated
  for (let i = 0; i < DOC_COUNT; i++) {
    await repo.saveDocument({
      id: `sort-doc-${i}`,
      title: `Sort Doc ${i}`,
      content: `Content for document ${i}`,
      created_at: BASE_TIME + i * 10000,               // doc-49 created last
      updated_at: BASE_TIME + (DOC_COUNT - i) * 10000, // doc-0 updated last
    });
  }

  const { shell, container, backdrop } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    initialSortBy: 'updated_at',
    onSelectDocument: () => {},
  });
  await drawer.init();

  const sortModifiedBtn = container.querySelector('#sort-modified') as unknown as HTMLButtonElement;
  const sortCreatedBtn = container.querySelector('#sort-created') as unknown as HTMLButtonElement;

  // 200 rapid alternating sort toggles
  const TOGGLES = 200;
  for (let t = 0; t < TOGGLES; t++) {
    const targetSort = t % 2 === 0 ? 'created_at' : 'updated_at';
    await drawer.setSortBy(targetSort);

    assert.strictEqual(drawer.getSortBy(), targetSort);
  }

  // After 200 toggles, ending on 'updated_at' (199 % 2 !== 0)
  assert.strictEqual(drawer.getSortBy(), 'updated_at');
  assert.ok(sortModifiedBtn.classList.contains('active'), 'sort-modified button must be active');
  assert.ok(!sortCreatedBtn.classList.contains('active'), 'sort-created button must not be active');

  // Verify strictly monotonic descending updated_at order
  let renderedCards = container.querySelectorAll('.document-card');
  assert.strictEqual(renderedCards.length, DOC_COUNT, 'Must render exactly 50 cards without DOM leaks');

  let prevTime = Infinity;
  for (const cardEl of renderedCards) {
    const docId = (cardEl as unknown as HTMLElement).dataset.id!;
    const doc = await repo.getDocument(docId);
    assert.ok(doc, 'Doc must exist');
    assert.ok(
      doc!.updated_at <= prevTime,
      `Updated timestamps must be monotonically decreasing; observed ${doc!.updated_at} > ${prevTime}`
    );
    prevTime = doc!.updated_at;
  }
  // doc-0 should be first (highest updated_at)
  assert.strictEqual((renderedCards[0] as unknown as HTMLElement).dataset.id, 'sort-doc-0');

  // Toggle to created_at
  await drawer.setSortBy('created_at');
  assert.ok(sortCreatedBtn.classList.contains('active'));
  renderedCards = container.querySelectorAll('.document-card');
  assert.strictEqual(renderedCards.length, DOC_COUNT);

  prevTime = Infinity;
  for (const cardEl of renderedCards) {
    const docId = (cardEl as unknown as HTMLElement).dataset.id!;
    const doc = await repo.getDocument(docId);
    assert.ok(doc, 'Doc must exist');
    assert.ok(
      doc!.created_at <= prevTime,
      `Created timestamps must be monotonically decreasing; observed ${doc!.created_at} > ${prevTime}`
    );
    prevTime = doc!.created_at;
  }
  // doc-49 should be first (highest created_at)
  assert.strictEqual((renderedCards[0] as unknown as HTMLElement).dataset.id, 'sort-doc-49');

  drawer.destroy();
});

test('Adversarial Stress 3.2: 500 active document selection churn iterations without state desync', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const DOC_COUNT = 25;
  for (let i = 0; i < DOC_COUNT; i++) {
    await repo.saveDocument({
      id: `churn-doc-${i}`,
      title: `Churn Doc ${i}`,
      content: `Text ${i}`,
    });
  }

  let selectedDocId: string | null = null;
  const { shell, container, backdrop } = createDrawerDOMFixture();
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

  // 500 rapid document selection changes
  const CHURN_ROUNDS = 500;
  for (let c = 0; c < CHURN_ROUNDS; c++) {
    const targetId = `churn-doc-${c % DOC_COUNT}`;
    drawer.setActiveDocumentId(targetId);

    // Invariant: Exactly 1 document card has the 'active-doc' class
    const activeCards = container.querySelectorAll('.document-card.active-doc');
    assert.strictEqual(
      activeCards.length,
      1,
      `Round ${c}: Exactly one card must be active, found ${activeCards.length}`
    );
    assert.strictEqual(
      (activeCards[0] as unknown as HTMLElement).dataset.id,
      targetId,
      `Round ${c}: Active card dataset.id must match target`
    );
  }

  // Verify non-existent ID clears all active highlights
  drawer.setActiveDocumentId('non-existent-id-999');
  const activeCardsNone = container.querySelectorAll('.document-card.active-doc');
  assert.strictEqual(activeCardsNone.length, 0, 'Non-existent ID must leave zero active cards');

  // Verify card click switches document and triggers onSelectDocument
  const cardToClick = container.querySelector('.document-card[data-id="churn-doc-7"]') as unknown as HTMLElement;
  assert.ok(cardToClick);
  drawer.open();
  assert.strictEqual(drawer.getIsOpen(), true);

  cardToClick.click();
  assert.strictEqual(selectedDocId, 'churn-doc-7');
  assert.strictEqual(drawer.getIsOpen(), false, 'Selecting document via click must auto-dismiss drawer');

  drawer.destroy();
});

test('Adversarial Stress 3.3: Rapid document creation burst and counter synchronization', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  let createdCount = 0;
  const { shell, container, backdrop } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
    onCreateDocument: () => {
      createdCount++;
    },
  });
  await drawer.init();

  const docCountIndicator = container.querySelector('#doc-count-indicator') as unknown as HTMLElement;
  assert.strictEqual(docCountIndicator.textContent, '0 documents');

  // Rapidly create 15 new documents in succession
  const CREATION_BURST = 15;
  for (let i = 1; i <= CREATION_BURST; i++) {
    const doc = await drawer.createNewDocument();
    assert.ok(doc.id);
    assert.strictEqual(drawer.getActiveDocumentId(), doc.id);
    assert.strictEqual(createdCount, i);
    assert.strictEqual(docCountIndicator.textContent, `${i} ${i === 1 ? 'document' : 'documents'}`);
  }

  const allCards = container.querySelectorAll('.document-card');
  assert.strictEqual(allCards.length, CREATION_BURST);

  drawer.destroy();
});

// ----------------------------------------------------------------------------
// 4. DRAWER LIFECYCLE, KEYBOARD SHORTCUTS & ZERO-CHROME DISMISSAL
// ----------------------------------------------------------------------------

test('Adversarial Stress 4.1: Single-keystroke shortcuts (Esc, Cmd+[, /, Cmd+N) and zero-chrome restoration', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const { win, doc, shell, container, backdrop } = createDrawerDOMFixture();
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  let newDocTriggered = false;
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
    onCreateDocument: () => {
      newDocTriggered = true;
    },
  });
  await drawer.init();

  try {
    // 1. Initial State: Closed & Zero-Chrome
    assert.strictEqual(drawer.getIsOpen(), false);
    assert.ok(shell.classList.contains('zero-chrome'));

    // 2. Cmd+[ opens drawer
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', metaKey: true }));
    assert.strictEqual(drawer.getIsOpen(), true);
    assert.ok(shell.classList.contains('left-open'));
    assert.ok(!shell.classList.contains('zero-chrome'));

    // 3. Esc dismisses drawer and restores zero-chrome
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.strictEqual(drawer.getIsOpen(), false);
    assert.ok(!shell.classList.contains('left-open'));
    assert.ok(shell.classList.contains('zero-chrome'));

    // 4. Backdrop click dismisses drawer
    drawer.open();
    assert.strictEqual(drawer.getIsOpen(), true);
    backdrop.click();
    assert.strictEqual(drawer.getIsOpen(), false);
    assert.ok(shell.classList.contains('zero-chrome'));

    // 5. / shortcut opens drawer and focuses search
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/' }));
    assert.strictEqual(drawer.getIsOpen(), true);

    // 6. Cmd+N creates document
    assert.strictEqual(newDocTriggered, false);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'n', metaKey: true }));
    // Allow promise microtask to resolve
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(newDocTriggered, true);

    // 7. Cleanup via destroy() removes listeners
    drawer.close();
    assert.strictEqual(drawer.getIsOpen(), false);
    drawer.destroy();
    // After destroy, dispatching Cmd+[ should NOT open drawer
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', metaKey: true }));
    assert.strictEqual(drawer.getIsOpen(), false, 'Destroyed drawer must not respond to global shortcuts');

  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  }
});

