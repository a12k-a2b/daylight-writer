/**
 * tests/adversarial/m3-r2-challenger-stress.test.ts
 * Milestone 3 Iteration 2 Adversarial Challenger Stress Test Suite
 *
 * Empirical verification of:
 * 1. Stored XSS injection vectors in document titles, tags, and content (<script>, <img>, <iframe>, <svg>).
 *    Verifies zero executable DOM elements in .doc-item-snippet, .doc-item-title, .doc-item-tags,
 *    and strict preservation of mathematical inequality brackets (a < 10 && b > 20).
 * 2. Tag-scoped search isolation across deep tag hierarchies (#work/project-a vs #personal/journal and ancestor #work).
 *    Verifies strict isolation, ancestor prefix matching, multi-tag scoping, and sidebar count invariants.
 * 3. Asynchronous keystroke race conditions and monotonic search ID cancellation.
 *    Verifies out-of-order resolution suppression, 100-keystroke concurrent bursts, and search clear invariants.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { LeftLibraryDrawer, sanitizeSnippetHtml } from '../../src/drawers/left-library.ts';
import {
  formatHighlightSnippet,
  escapeHtml,
  searchDocumentsInMemory,
  normalizeTagPath,
  isTagMatch,
  buildTagTree,
  type SearchHit,
} from '../../src/storage/search.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

// Helper to create clean DOM fixture for LeftLibraryDrawer in HappyDOM
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
// 1. XSS INJECTION ATTACKS & MATHEMATICAL TYPOGRAPHY INTEGRITY
// ----------------------------------------------------------------------------

test('Adversarial 1.1: Direct formatHighlightSnippet XSS probe & math bracket preservation', () => {
  const hostilePayloads = [
    '<script>alert("xss")</script>',
    '<img src=x onerror="window.pwned=1" />',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<svg onload="alert(1)"><circle r="5"/></svg>',
    '<a href="javascript:alert(1)">malicious link</a>',
    '<style>body{display:none}</style>',
    '<mark onclick="alert(1)">fake mark</mark>',
    '<<SCRIPT>alert("nested");//<</SCRIPT>',
  ];

  for (const payload of hostilePayloads) {
    const text = `Prefix text before payload ${payload} and suffix text after payload.`;
    const snippet = formatHighlightSnippet(text, [[0, 6]], 150); // Matches "Prefix"

    // Verify that none of the dangerous tags are unescaped in the snippet HTML
    assert.strictEqual(snippet.includes('<script'), false, `Must not contain unescaped <script for payload ${payload}`);
    assert.strictEqual(snippet.includes('<img'), false, `Must not contain unescaped <img for payload ${payload}`);
    assert.strictEqual(snippet.includes('<iframe'), false, `Must not contain unescaped <iframe for payload ${payload}`);
    assert.strictEqual(snippet.includes('<svg'), false, `Must not contain unescaped <svg for payload ${payload}`);
    assert.strictEqual(snippet.includes('<a '), false, `Must not contain unescaped <a for payload ${payload}`);
    assert.strictEqual(snippet.includes('<style'), false, `Must not contain unescaped <style for payload ${payload}`);

    // Verify that the ONLY allowed HTML tags in output are <mark class="os-search-highlight"> and </mark>
    const strippedValidMarks = snippet
      .replaceAll('<mark class="os-search-highlight">', '')
      .replaceAll('</mark>', '');
    assert.strictEqual(/<[a-zA-Z]/.test(strippedValidMarks), false, `No other HTML tags allowed in snippet: ${snippet}`);
  }

  // Verify math bracket preservation
  const mathExpressions = [
    'Boundary verification: a < 10 && b > 20 for loop condition.',
    'Comparison test: 2 < 5 && 10 > 3, along with x < y && z > w.',
    'Loop logic: for (int i = 0; i < n; i++) { if (val > threshold) break; }',
    'HTML entity confusion: &lt;tag&gt; and raw a < b && c > d.',
  ];

  for (const mathText of mathExpressions) {
    // Match "verification" or "test" or "loop" or "entity"
    const snippet = formatHighlightSnippet(mathText, [[0, 4]], 150);

    // Assert that raw < and > are safely escaped to &lt; and &gt;
    assert.strictEqual(snippet.includes('< 10'), false, 'Raw "< 10" must not exist in snippet HTML');
    assert.strictEqual(snippet.includes('> 20'), false, 'Raw "> 20" must not exist in snippet HTML');
    assert.ok(snippet.includes('&lt;'), 'Snippet must contain escaped &lt;');

    // When inserted into DOM, textContent must perfectly match the original math expression
    const win = new Window();
    const el = win.document.createElement('div');
    el.innerHTML = snippet;
    assert.ok(
      el.textContent?.includes('a < 10 && b > 20') ||
      el.textContent?.includes('2 < 5 && 10 > 3') ||
      el.textContent?.includes('i < n') ||
      el.textContent?.includes('&lt;tag&gt;'),
      `DOM textContent must preserve mathematical inequalities: got "${el.textContent}"`
    );
  }
});

test('Adversarial 1.2: Direct sanitizeSnippetHtml defense-in-depth isolation', () => {
  // Test raw unescaped input to sanitizeSnippetHtml
  const maliciousRaw = '<script>alert(1)</script><mark class="os-search-highlight">Match</mark><img src=x onerror=evil()>';
  const sanitized = sanitizeSnippetHtml(maliciousRaw);

  assert.ok(sanitized.includes('<mark class="os-search-highlight">Match</mark>'), 'Must preserve valid Sol:OS mark');
  assert.strictEqual(sanitized.includes('<script>'), false, 'Must neutralize <script>');
  assert.strictEqual(sanitized.includes('<img'), false, 'Must neutralize <img');
  assert.ok(sanitized.includes('&lt;script&gt;'), 'Must escape script tag');
  assert.ok(sanitized.includes('&lt;img'), 'Must escape img tag');

  // Attribute spoofing on mark tag must be rejected and escaped
  const fakeMark1 = '<mark onclick="evil()">Spoofed Mark</mark>';
  const fakeMark2 = '<mark class="os-search-highlight" onmouseover="evil()">Injected Mark</mark>';
  assert.strictEqual(sanitizeSnippetHtml(fakeMark1).includes('<mark '), false, 'Must escape mark with onclick');
  assert.strictEqual(sanitizeSnippetHtml(fakeMark2).includes('<mark '), false, 'Must escape mark with event handler');
  const win = new Window();
  const div = win.document.createElement('div');
  div.innerHTML = sanitizeSnippetHtml(fakeMark2);
  assert.strictEqual(div.querySelectorAll('mark').length, 0, 'No mark element created when event handler is present');
});

test('Adversarial 1.3: DOM security audit across document title, tags, content & search query in LeftLibraryDrawer with SQLiteStorageRepository', async () => {
  const repo = new SQLiteStorageRepository();
  await repo.init();

  const now = Date.now();

  // Create documents with hostile payloads across all fields
  const docScript = await repo.saveDocument({
    id: 'doc-xss-script',
    title: '<script>window.pwnedScript=true</script>Hostile Script Title',
    content: 'Searching for targetTerm. Executable script <script>window.pwnedScriptBody=true</script> embedded here.',
    created_at: now - 5000,
    updated_at: now - 5000,
  });
  await repo.setDocumentTags(docScript.id, ['<script>alert("tag")</script>', 'sec/audit']);

  const docImg = await repo.saveDocument({
    id: 'doc-xss-img',
    title: '<img src="x" onerror="window.pwnedImg=true" />Hostile Img Title',
    content: 'Searching for targetTerm. Image payload <img src="bad.jpg" onerror="window.pwnedImgBody=true" /> inside text.',
    created_at: now - 4000,
    updated_at: now - 4000,
  });
  await repo.setDocumentTags(docImg.id, ['img"onerror="alert(1)']);

  const docIframe = await repo.saveDocument({
    id: 'doc-xss-iframe',
    title: '<iframe src="javascript:alert(1)">Iframe Title</iframe>',
    content: 'Searching for targetTerm. Frame payload <iframe src="data:text/html,<script>alert(1)</script>"></iframe> text.',
    created_at: now - 3000,
    updated_at: now - 3000,
  });

  const docSvg = await repo.saveDocument({
    id: 'doc-xss-svg',
    title: '<svg onload="window.pwnedSvg=true"><circle r="10"/></svg>Svg Title',
    content: 'Searching for targetTerm. SVG vector <svg onload="window.pwnedSvgBody=true"><rect width="10"/></svg> in body.',
    created_at: now - 2000,
    updated_at: now - 2000,
  });

  const docMath = await repo.saveDocument({
    id: 'doc-math-check',
    title: 'Algorithm: a < 10 && b > 20',
    content: 'Searching for targetTerm. Evaluating mathematical inequality: a < 10 && b > 20, where 2 < 5 and x > y.',
    created_at: now - 1000,
    updated_at: now - 1000,
  });

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Phase A: Non-search default document list DOM audit
  const nonSearchCards = container.querySelectorAll('.document-card');
  assert.strictEqual(nonSearchCards.length, 5, 'All 5 documents must be displayed in non-search view');

  // Strict DOM element probe: zero hostile elements in the entire library drawer container
  const hostileElements = container.querySelectorAll('script, img, iframe, svg, style, object, embed');
  assert.strictEqual(
    hostileElements.length,
    0,
    `Zero executable or media DOM tags allowed in non-search view, found ${hostileElements.length}`
  );

  // Phase B: Fuzzy search DOM audit with snippet highlighting
  await drawer.executeSearch('targetTerm');

  const searchCards = container.querySelectorAll('.document-card');
  assert.strictEqual(searchCards.length, 5, 'All 5 documents matching targetTerm must be returned');

  // Verify zero executable elements in cards or snippet when SQLiteStorageRepository is used
  const searchHostileElements = container.querySelectorAll('script, img, iframe, svg, style, object, embed');
  assert.strictEqual(
    searchHostileElements.length,
    0,
    `Zero executable or media DOM tags allowed in search view, found ${searchHostileElements.length}`
  );

  for (const card of searchCards) {
    const cardEl = card as unknown as HTMLElement;
    const snippetEl = cardEl.querySelector('.doc-item-snippet') as unknown as HTMLElement;
    assert.ok(snippetEl, 'Snippet element must exist');

    // Only mark.os-search-highlight is allowed as an element child
    const childElements = snippetEl.querySelectorAll('*');
    for (const child of childElements) {
      assert.strictEqual(child.tagName.toLowerCase(), 'mark');
      assert.strictEqual(child.className, 'os-search-highlight');
    }
  }

  // Phase C: Mathematical inequality verification in rendered DOM
  const mathCard = container.querySelector('[data-id="doc-math-check"]') as unknown as HTMLElement;
  assert.ok(mathCard, 'Math card must exist');
  const mathSnippet = mathCard.querySelector('.doc-item-snippet') as unknown as HTMLElement;
  assert.ok(mathSnippet, 'Math snippet must exist');

  // The text content must preserve angle brackets literally
  assert.ok(
    mathSnippet.textContent?.includes('a < 10 && b > 20'),
    `Math snippet must preserve "a < 10 && b > 20", got "${mathSnippet.textContent}"`
  );

  // Search specifically for Algorithm to verify title highlight and bracket preservation
  await drawer.executeSearch('Algorithm');
  const mathCard2 = container.querySelector('[data-id="doc-math-check"]') as unknown as HTMLElement;
  const mathSnippet2 = mathCard2.querySelector('.doc-item-snippet') as unknown as HTMLElement;
  assert.ok(
    mathSnippet2.textContent?.includes('a < 10 && b > 20'),
    `Title match snippet must preserve "a < 10 && b > 20", got "${mathSnippet2?.textContent}"`
  );

  // Phase D: Search Query XSS probe (empty search results message)
  await drawer.executeSearch('nonexistentxyz<script>alert("queryXSS")</script>');
  const emptyHostile = container.querySelectorAll('script, img, iframe, svg');
  assert.strictEqual(emptyHostile.length, 0, 'Empty state must not execute XSS in query message');
  const emptyStateEl = container.querySelector('.library-empty-state');
  assert.ok(emptyStateEl?.innerHTML.includes('&lt;script&gt;'), 'Empty state properly escapes script tag to &lt;script&gt;');
  assert.strictEqual(emptyStateEl?.innerHTML.includes('&amp;lt;'), false, 'Empty state must not double-escape to &amp;lt;');

  drawer.destroy();
  repo.destroy();
});

test('Adversarial 1.5: Verification that search query double-escaping in empty search state is resolved', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  await drawer.executeSearch('apples < oranges');
  const emptyMsgEl = container.querySelector('.library-empty-state .empty-message');
  assert.ok(emptyMsgEl, 'Empty message element must exist');

  // REMEDIATION VERIFIED:
  // executeSearch() passes unescaped this.searchQuery to renderEmptyState(),
  // which escapes it exactly once into emptyEl.innerHTML.
  // In DOM textContent, angle brackets display cleanly as literal "<"
  assert.strictEqual(
    emptyMsgEl?.textContent,
    'No matches for "apples < oranges"',
    'Query textContent displays clean "<" without literal "&lt;"'
  );

  drawer.destroy();
});

test('Adversarial 1.4: Verification of sanitizeSnippetHtml defense against slash-delimited and unclosed tag injection', () => {
  // Payloads employing HTML5 non-whitespace delimiter syntax and unclosed tags
  const bypassVectors = [
    { name: 'slash-delimited svg onload', payload: '<svg/onload=alert(1)>', tag: 'svg' },
    { name: 'slash-delimited img onerror', payload: '<img/src=x/onerror=alert(1)>', tag: 'img' },
    { name: 'slash-delimited script src', payload: '<script/src=data:text/javascript,alert(1)>', tag: 'script' },
    { name: 'slash-delimited iframe', payload: '<iframe/src=javascript:alert(1)>', tag: 'iframe' },
    { name: 'unclosed svg tag', payload: '<svg onload="alert(1)"', tag: 'svg' },
    { name: 'unclosed img tag', payload: '<img src="x" onerror="alert(1)"', tag: 'img' },
  ];

  for (const vector of bypassVectors) {
    const sanitized = sanitizeSnippetHtml(vector.payload);

    // REMEDIATION VERIFIED:
    // Tokenized placeholder sanitization neutralizes slash-delimited and unclosed tags
    assert.strictEqual(sanitized.includes('<' + vector.tag), false, `Must not contain raw unescaped tag: ${vector.name}`);
    assert.ok(sanitized.includes('&lt;' + vector.tag), `Must escape tag to &lt;${vector.tag}`);

    // When inserted into DOM container matching card.innerHTML:
    const win = new Window();
    const div = win.document.createElement('div');
    div.innerHTML = `<p class="doc-item-snippet">${sanitized}</p>`;

    const elements = div.querySelectorAll(vector.tag);
    assert.strictEqual(
      elements.length,
      0,
      `REMEDIATION VERIFIED: Zero live <${vector.tag}> DOM nodes created in .doc-item-snippet for ${vector.name}`
    );
  }
});

// ----------------------------------------------------------------------------
// 2. TAG-SCOPED SEARCH ISOLATION ACROSS DEEP TAXONOMIES
// ----------------------------------------------------------------------------

test('Adversarial 2.1: Multi-level tag hierarchy isolation and prefix matching under search', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const now = Date.now();

  // Document setup across distinct hierarchical branches
  const docA = await repo.saveDocument({
    id: 'doc-a',
    title: 'Work Project A Drafts',
    content: 'SharedKeyword in project A draft manuscript.',
    created_at: now - 8000,
    updated_at: now - 8000,
  });
  await repo.setDocumentTags(docA.id, ['work/project-a/drafts', 'work/project-a/sprint1']);

  const docB = await repo.saveDocument({
    id: 'doc-b',
    title: 'Work Project A Reviews',
    content: 'SharedKeyword in project A review notes.',
    created_at: now - 7000,
    updated_at: now - 7000,
  });
  await repo.setDocumentTags(docB.id, ['work/project-a/reviews']);

  const docC = await repo.saveDocument({
    id: 'doc-c',
    title: 'Work Project B Spec',
    content: 'SharedKeyword in project B technical specification.',
    created_at: now - 6000,
    updated_at: now - 6000,
  });
  await repo.setDocumentTags(docC.id, ['work/project-b/spec']);

  const docD = await repo.saveDocument({
    id: 'doc-d',
    title: 'Work Root Document',
    content: 'SharedKeyword in root work guidelines.',
    created_at: now - 5000,
    updated_at: now - 5000,
  });
  await repo.setDocumentTags(docD.id, ['work']);

  const docE = await repo.saveDocument({
    id: 'doc-e',
    title: 'Personal Journal Work Note',
    content: 'SharedKeyword in personal journal talking about work.',
    created_at: now - 4000,
    updated_at: now - 4000,
  });
  await repo.setDocumentTags(docE.id, ['personal/journal/work']);

  const docF = await repo.saveDocument({
    id: 'doc-f',
    title: 'Personal Work Subtag',
    content: 'SharedKeyword in personal side projects.',
    created_at: now - 3000,
    updated_at: now - 3000,
  });
  await repo.setDocumentTags(docF.id, ['personal/work']);

  const docG = await repo.saveDocument({
    id: 'doc-g',
    title: 'Untagged Document',
    content: 'SharedKeyword in untagged random thoughts.',
    created_at: now - 2000,
    updated_at: now - 2000,
  });

  const docH = await repo.saveDocument({
    id: 'doc-h',
    title: 'Dual-Branch Multi-Tag Doc',
    content: 'SharedKeyword in dual-tagged document archive.',
    created_at: now - 1000,
    updated_at: now - 1000,
  });
  await repo.setDocumentTags(docH.id, ['work/project-a/drafts', 'archive/2026']);

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Verify total count on "All Documents" root node is 8
  const rootCountEl = container.querySelector('.tag-tree-row.root-item .tag-count');
  assert.strictEqual(rootCountEl?.textContent, '8', 'Initial total library doc count must be 8');

  // 1. Filter by specific sub-branch: work/project-a
  await drawer.filterByTag('work/project-a');
  assert.strictEqual(drawer.getSelectedTagPath(), 'work/project-a');

  // Search for SharedKeyword
  await drawer.executeSearch('SharedKeyword');
  let cards = container.querySelectorAll('.document-card');
  let cardIds = Array.from(cards).map(c => (c as unknown as HTMLElement).dataset.id);

  // Must ONLY match docA, docB, and docH (all under work/project-a)
  assert.strictEqual(cardIds.length, 3, 'Must match exactly 3 documents under work/project-a');
  assert.ok(cardIds.includes('doc-a'), 'Must include doc-a');
  assert.ok(cardIds.includes('doc-b'), 'Must include doc-b');
  assert.ok(cardIds.includes('doc-h'), 'Must include doc-h (multi-tag)');
  assert.strictEqual(cardIds.includes('doc-c'), false, 'Must NOT include doc-c (project-b)');
  assert.strictEqual(cardIds.includes('doc-d'), false, 'Must NOT include doc-d (root work)');
  assert.strictEqual(cardIds.includes('doc-e'), false, 'Must NOT include doc-e (personal)');
  assert.strictEqual(cardIds.includes('doc-f'), false, 'Must NOT include doc-f (personal)');
  assert.strictEqual(cardIds.includes('doc-g'), false, 'Must NOT include doc-g (untagged)');

  // 2. Filter by ancestor branch: work
  await drawer.filterByTag('work');
  assert.strictEqual(drawer.getSelectedTagPath(), 'work');

  await drawer.executeSearch('SharedKeyword');
  cards = container.querySelectorAll('.document-card');
  cardIds = Array.from(cards).map(c => (c as unknown as HTMLElement).dataset.id);

  // Must match docA, docB, docC, docD, docH (all under work taxonomy)
  assert.strictEqual(cardIds.length, 5, 'Must match exactly 5 documents under ancestor work');
  assert.ok(cardIds.includes('doc-a'));
  assert.ok(cardIds.includes('doc-b'));
  assert.ok(cardIds.includes('doc-c'));
  assert.ok(cardIds.includes('doc-d'));
  assert.ok(cardIds.includes('doc-h'));
  // Crucial: personal/journal/work and personal/work must NOT match ancestor work!
  assert.strictEqual(cardIds.includes('doc-e'), false, 'personal/journal/work must not match ancestor work');
  assert.strictEqual(cardIds.includes('doc-f'), false, 'personal/work must not match ancestor work');
  assert.strictEqual(cardIds.includes('doc-g'), false, 'untagged must not match work');

  // 3. Filter by branch: personal
  await drawer.filterByTag('personal');
  await drawer.executeSearch('SharedKeyword');
  cards = container.querySelectorAll('.document-card');
  cardIds = Array.from(cards).map(c => (c as unknown as HTMLElement).dataset.id);

  assert.strictEqual(cardIds.length, 2, 'Must match exactly 2 documents under personal');
  assert.ok(cardIds.includes('doc-e'));
  assert.ok(cardIds.includes('doc-f'));

  // 4. Multi-tag scoping: filter by archive
  await drawer.filterByTag('archive');
  await drawer.executeSearch('SharedKeyword');
  cards = container.querySelectorAll('.document-card');
  cardIds = Array.from(cards).map(c => (c as unknown as HTMLElement).dataset.id);

  assert.strictEqual(cardIds.length, 1, 'Only doc-h has archive tag');
  assert.strictEqual(cardIds[0], 'doc-h');

  // 5. Verify Tag Tree Global Badge Invariant
  // Even while filtered to 'archive' and searching, "All Documents" root badge must remain 8
  const currentRootCountEl = container.querySelector('.tag-tree-row.root-item .tag-count');
  assert.strictEqual(currentRootCountEl?.textContent, '8', 'All Documents count must remain 8 globally');

  // 6. Reset tag filter to null
  await drawer.filterByTag(null);
  assert.strictEqual(drawer.getSelectedTagPath(), null);

  await drawer.executeSearch('SharedKeyword');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 8, 'All 8 documents must appear when tag filter is cleared');

  drawer.destroy();

});

// ----------------------------------------------------------------------------
// 3. ASYNCHRONOUS KEYSTROKE RACE CONDITIONS & MONOTONIC CANCELLATION
// ----------------------------------------------------------------------------

test('Adversarial 3.1: Monotonic search sequence cancels out-of-order delayed promises', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-early',
    title: 'Alpha Document',
    content: 'Early query target matching alpha keyword.',
    created_at: 1000,
    updated_at: 1000,
  });

  await repo.saveDocument({
    id: 'doc-final',
    title: 'Zeta Document',
    content: 'Final query target matching zeta keyword.',
    created_at: 2000,
    updated_at: 2000,
  });

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Create an instrumented search wrapper that simulates network/disk delay inversions
  const originalSearch = repo.searchDocuments.bind(repo);
  const delays: Record<string, number> = {
    'alp': 120, // First keystroke: high latency (120ms)
    'alph': 60, // Second keystroke: medium latency (60ms)
    'zeta': 5,  // Third keystroke: fast latency (5ms)
  };

  repo.searchDocuments = async (query: string): Promise<SearchHit[]> => {
    const delay = delays[query] || 10;
    await new Promise(resolve => setTimeout(resolve, delay));
    return originalSearch(query);
  };

  // Dispatch keystrokes concurrently without awaiting
  const p1 = drawer.executeSearch('alp');
  const p2 = drawer.executeSearch('alph');
  const p3 = drawer.executeSearch('zeta');

  // Wait for all three requests to settle
  await Promise.all([p1, p2, p3]);

  // Assert DOM display:
  // Even though 'alp' resolved last (at 120ms), the rendered cards MUST reflect 'zeta' (searchId = 3)
  const cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1, 'Exactly one document should be rendered for zeta');
  const cardId = (cards[0] as unknown as HTMLElement).dataset.id;
  assert.strictEqual(cardId, 'doc-final', 'Monotonic ID must preserve final search query result');

  drawer.destroy();

});

test('Adversarial 3.2: 100 rapid concurrent keystrokes stress harness', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  for (let i = 0; i < 20; i++) {
    await repo.saveDocument({
      id: `doc-stress-${i}`,
      title: `Document ${i}`,
      content: `Content for document ${i} with common prefix item and unique token_${i}.`,
      created_at: 1000 + i,
      updated_at: 1000 + i,
    });
  }

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  const originalSearch = repo.searchDocuments.bind(repo);
  repo.searchDocuments = async (query: string): Promise<SearchHit[]> => {
    // Randomized delay between 0ms and 30ms to create chaotic completion ordering
    const delay = Math.floor(Math.random() * 30);
    await new Promise(resolve => setTimeout(resolve, delay));
    return originalSearch(query);
  };

  const promises: Promise<void>[] = [];
  const TOTAL_BURST = 100;

  for (let i = 0; i < TOTAL_BURST; i++) {
    const query = i === TOTAL_BURST - 1 ? 'token_7' : `item ${i % 10}`;
    promises.push(drawer.executeSearch(query));
  }

  await Promise.all(promises);

  // The 100th search was 'token_7'. Assert DOM matches token_7 strictly.
  const cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1, 'Only token_7 must match in the final rendered state');
  assert.strictEqual((cards[0] as unknown as HTMLElement).dataset.id, 'doc-stress-7');

  drawer.destroy();

});

test('Adversarial 3.3: In-flight slow search cancellation upon query clear', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-1',
    title: 'Doc One',
    content: 'Common content for doc one.',
    created_at: 1000,
    updated_at: 1000,
  });
  await repo.saveDocument({
    id: 'doc-2',
    title: 'Doc Two',
    content: 'Common content for doc two.',
    created_at: 2000,
    updated_at: 2000,
  });

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Make search slow (80ms)
  const originalSearch = repo.searchDocuments.bind(repo);
  repo.searchDocuments = async (query: string): Promise<SearchHit[]> => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return originalSearch(query);
  };

  // Launch slow search for 'Doc One'
  const pSearch = drawer.executeSearch('Doc One');

  // Immediately clear search field
  const pClear = drawer.executeSearch('');

  // Wait for both to complete
  await Promise.all([pSearch, pClear]);

  // Both documents must be displayed, not just Doc One
  const cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 2, 'Clearing search must restore all documents, not get overwritten by slow search');

  drawer.destroy();

});
