/**
 * tests/adversarial/m3-r3-challenger1-stress.test.ts
 * Milestone 3 Iteration 3 Challenger 1: Adversarial Stress & Empirical Verification Suite
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST FOR:
 * 1. Solidus-delimited hostile HTML tags (<svg/onload=alert(1)>, <img/src=x/onerror=alert(1)>, etc.)
 *    and unclosed/truncated tags (<svg onload="alert(1)", <img src="x" onerror="evil()").
 *    Verifies ZERO elements created in .doc-item-snippet DOM.
 * 2. PUA token collision & bypass attacks (\uE000<script>alert(1)</script>\uE001).
 * 3. Query angle brackets and mathematical inequalities in empty search state:
 *    ("apples < oranges", "2 > 1", "x < y && a > b").
 *    Verifies clean text in textContent without double-escaped &amp;lt; or &amp;gt;.
 * 4. End-to-end LeftLibraryDrawer DOM card creation with SQLite and InMemory repositories.
 * 5. ReDoS and high-volume adversarial fuzzing.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

import { LeftLibraryDrawer, sanitizeSnippetHtml } from '../../src/drawers/left-library.ts';
import {
  formatHighlightSnippet,
  escapeHtml,
} from '../../src/storage/search.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';

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
// SUITE 1: SOLIDUS-DELIMITED TAG MATRIX (25+ ATTACK VECTORS)
// ----------------------------------------------------------------------------

test('Adversarial R3.1: Solidus-delimited hostile tags produce ZERO elements in .doc-item-snippet DOM', () => {
  const solidusPayloads = [
    { name: 'svg onload slash', payload: '<svg/onload=alert(1)>', tag: 'svg' },
    { name: 'img onerror slash', payload: '<img/src=x/onerror=alert(1)>', tag: 'img' },
    { name: 'script data src slash', payload: '<script/src=data:text/javascript,alert(1)>', tag: 'script' },
    { name: 'iframe javascript slash', payload: '<iframe/src=javascript:alert(1)>', tag: 'iframe' },
    { name: 'object data slash', payload: '<object/data=javascript:alert(1)>', tag: 'object' },
    { name: 'embed src slash', payload: '<embed/src=javascript:alert(1)>', tag: 'embed' },
    { name: 'body onload slash', payload: '<body/onload=alert(1)>', tag: 'body' },
    { name: 'video onerror slash', payload: '<video/src=x/onerror=alert(1)>', tag: 'video' },
    { name: 'audio onerror slash', payload: '<audio/src=x/onerror=alert(1)>', tag: 'audio' },
    { name: 'details ontoggle slash', payload: '<details/open/ontoggle=alert(1)>', tag: 'details' },
    { name: 'input onfocus slash', payload: '<input/autofocus/onfocus=alert(1)>', tag: 'input' },
    { name: 'triple slash svg', payload: '<svg///onload=alert(1)>', tag: 'svg' },
    { name: 'double slash img', payload: '<img//src="x"//onerror="alert(1)">', tag: 'img' },
    { name: 'svg multiple slashes and path', payload: '<svg/something/onload=alert(1)>', tag: 'svg' },
    { name: 'uppercase SVG slash', payload: '<SvG/OnLoAd=alert(1)>', tag: 'svg' },
    { name: 'mixed-case sCrIpT slash', payload: '<sCrIpT/sRc=data:text/javascript,alert(1)>', tag: 'script' },
    { name: 'uppercase IMG slash', payload: '<IMG/SRC=X/ONERROR=alert(1)>', tag: 'img' },
    { name: 'svg tab delimiter', payload: '<svg\tonload=alert(1)>', tag: 'svg' },
    { name: 'svg newline delimiter', payload: '<svg\nonload=alert(1)>', tag: 'svg' },
    { name: 'svg crlf delimiter', payload: '<svg\r\nonload=alert(1)>', tag: 'svg' },
    { name: 'svg slash quoted attribute', payload: '<svg/onload="alert(document.domain)">', tag: 'svg' },
    { name: 'script slash quote injection', payload: '<script/x=">"/src=data:text/javascript,alert(1)>', tag: 'script' },
    { name: 'img slash quoted onerror', payload: '<img/src="x"/onerror=alert(1)>', tag: 'img' },
    { name: 'nested slash svg with script', payload: '<svg/<script>alert(1)</script>>', tag: 'svg' },
    { name: 'anchor href javascript slash', payload: '<a/href="javascript:alert(1)">click</a>', tag: 'a' },
  ];

  for (const item of solidusPayloads) {
    const sanitized = sanitizeSnippetHtml(item.payload);

    // Assert raw angle brackets are escaped
    assert.strictEqual(
      sanitized.includes('<' + item.tag) || sanitized.includes('<' + item.tag.toUpperCase()),
      false,
      `Sanitized string must not contain opening tag for ${item.name}: got "${sanitized}"`
    );

    // Mount in HappyDOM inside .doc-item-snippet
    const win = new Window();
    const wrapper = win.document.createElement('div');
    wrapper.innerHTML = `<p class="doc-item-snippet">${sanitized}</p>`;

    const snippetEl = wrapper.querySelector('.doc-item-snippet');
    assert.ok(snippetEl, 'Snippet element must exist');

    // Strict invariant: ZERO elements of the hostile tag type created in DOM
    const matchingElements = snippetEl.querySelectorAll(item.tag);
    assert.strictEqual(
      matchingElements.length,
      0,
      `Must create ZERO <${item.tag}> elements in .doc-item-snippet DOM for ${item.name}`
    );

    // Verify ZERO executable or unexpected elements of any kind
    const allChildElements = snippetEl.querySelectorAll('*');
    for (const child of allChildElements) {
      assert.strictEqual(
        child.tagName.toLowerCase(),
        'mark',
        `Unexpected element <${child.tagName}> created in .doc-item-snippet DOM for ${item.name}`
      );
      assert.strictEqual(child.className, 'os-search-highlight');
    }
  }
});

// ----------------------------------------------------------------------------
// SUITE 2: UNCLOSED, TRUNCATED & MALFORMED TAGS (20+ ATTACK VECTORS)
// ----------------------------------------------------------------------------

test('Adversarial R3.2: Unclosed, truncated and malformed tags produce ZERO elements in .doc-item-snippet DOM', () => {
  const unclosedPayloads = [
    { name: 'unclosed svg onload double-quote', payload: '<svg onload="alert(1)"', tag: 'svg' },
    { name: 'unclosed img onerror double-quote', payload: '<img src="x" onerror="evil()"', tag: 'img' },
    { name: 'unclosed script src', payload: '<script src="https://evil.com/x.js"', tag: 'script' },
    { name: 'unclosed iframe javascript', payload: '<iframe src="javascript:alert(1)"', tag: 'iframe' },
    { name: 'bare svg tag open', payload: '<svg', tag: 'svg' },
    { name: 'bare script tag open', payload: '<script', tag: 'script' },
    { name: 'bare iframe tag open', payload: '<iframe', tag: 'iframe' },
    { name: 'bare img tag open', payload: '<img', tag: 'img' },
    { name: 'bare body tag open', payload: '<body', tag: 'body' },
    { name: 'svg tag with trailing space', payload: '<svg ', tag: 'svg' },
    { name: 'img tag with trailing space', payload: '<img ', tag: 'img' },
    { name: 'double open svg tag', payload: '<<svg onload=alert(1)>', tag: 'svg' },
    { name: 'nested unclosed svg tag', payload: '<svg<svg onload=alert(1)>>', tag: 'svg' },
    { name: 'mark with unclosed svg tag', payload: '<mark <svg onload=alert(1)>>', tag: 'svg' },
    { name: 'valid mark class with unclosed svg tag', payload: '<mark class="os-search-highlight" <svg onload=alert(1)>>', tag: 'svg' },
    { name: 'unclosed svg single-quote', payload: "<svg onload='alert(1)'", tag: 'svg' },
    { name: 'unclosed img unquoted onerror', payload: '<img src=x onerror=alert(1)', tag: 'img' },
    { name: 'unclosed closing svg tag', payload: '</svg', tag: 'svg' },
    { name: 'unclosed closing script tag', payload: '</script', tag: 'script' },
    { name: 'unclosed closing img tag', payload: '</img', tag: 'img' },
    { name: 'slash without closing svg', payload: '<svg/', tag: 'svg' },
    { name: 'slash without closing img', payload: '<img/', tag: 'img' },
  ];

  for (const item of unclosedPayloads) {
    const sanitized = sanitizeSnippetHtml(item.payload);

    // Mount in HappyDOM inside .doc-item-snippet
    const win = new Window();
    const wrapper = win.document.createElement('div');
    wrapper.innerHTML = `<p class="doc-item-snippet">${sanitized}</p>`;

    const snippetEl = wrapper.querySelector('.doc-item-snippet');
    assert.ok(snippetEl, 'Snippet element must exist');

    const matchingElements = snippetEl.querySelectorAll(item.tag);
    assert.strictEqual(
      matchingElements.length,
      0,
      `Must create ZERO <${item.tag}> elements in .doc-item-snippet DOM for ${item.name}`
    );

    const allChildElements = snippetEl.querySelectorAll('*');
    for (const child of allChildElements) {
      assert.strictEqual(
        child.tagName.toLowerCase(),
        'mark',
        `Unexpected element <${child.tagName}> created in .doc-item-snippet DOM for ${item.name}`
      );
      assert.strictEqual(child.className, 'os-search-highlight');
    }
  }
});

// ----------------------------------------------------------------------------
// SUITE 3: PUA TOKEN COLLISION & BYPASS ATTACKS
// ----------------------------------------------------------------------------

test('Adversarial R3.3: PUA token collision attempts are completely neutralized', () => {
  const puaPayloads = [
    { name: 'script wrapped in PUA markers', payload: '\uE000<script>alert(1)</script>\uE001', tag: 'script' },
    { name: 'bare open PUA marker', payload: '\uE000', tag: 'none' },
    { name: 'bare close PUA marker', payload: '\uE001', tag: 'none' },
    { name: 'consecutive PUA markers', payload: '\uE000\uE001\uE000\uE001', tag: 'none' },
    { name: 'inverted PUA markers', payload: '\uE001\uE000', tag: 'none' },
    { name: 'double PUA script wrapper', payload: '\uE000\uE000<script>alert(1)</script>\uE001\uE001', tag: 'script' },
    { name: 'PUA with valid mark tag', payload: '\uE000<mark class="os-search-highlight">valid</mark>\uE001', tag: 'mark' },
    { name: 'mark class attribute spoof with PUA', payload: '<mark class="\uE000">injection</mark>', tag: 'mark' },
    { name: 'PUA inline event injection', payload: '\uE000onload=alert(1)\uE001', tag: 'none' },
    { name: 'PUA img onerror injection', payload: 'prefix\uE000<img src=x onerror=alert(1)>\uE001suffix', tag: 'img' },
    { name: 'PUA nested script inside mark', payload: '\uE000<mark class="os-search-highlight"><script>alert(1)</script></mark>\uE001', tag: 'script' },
  ];

  for (const item of puaPayloads) {
    const sanitized = sanitizeSnippetHtml(item.payload);

    // Verify output does not leak unescaped hostile tags
    if (item.tag !== 'none' && item.tag !== 'mark') {
      assert.strictEqual(
        sanitized.includes('<' + item.tag),
        false,
        `Sanitized string must not contain <${item.tag} for ${item.name}`
      );
    }

    // Mount in HappyDOM inside .doc-item-snippet
    const win = new Window();
    const wrapper = win.document.createElement('div');
    wrapper.innerHTML = `<p class="doc-item-snippet">${sanitized}</p>`;

    const snippetEl = wrapper.querySelector('.doc-item-snippet');
    assert.ok(snippetEl, 'Snippet element must exist');

    if (item.tag !== 'none' && item.tag !== 'mark') {
      const hostileEls = snippetEl.querySelectorAll(item.tag);
      assert.strictEqual(
        hostileEls.length,
        0,
        `Must create ZERO <${item.tag}> elements in DOM for ${item.name}`
      );
    }

    // Verify that NO script, img, iframe, or svg elements are created
    const dangerousElements = snippetEl.querySelectorAll('script, img, iframe, svg, object, embed, details, input');
    assert.strictEqual(
      dangerousElements.length,
      0,
      `Must create ZERO dangerous elements in DOM for ${item.name}`
    );
  }
});

// ----------------------------------------------------------------------------
// SUITE 4: LEGITIMATE <mark> & MATHEMATICAL INEQUALITIES PRESERVATION
// ----------------------------------------------------------------------------

test('Adversarial R3.4: Legitimate Sol:OS marks and mathematical inequalities are preserved cleanly', () => {
  // 1. Valid highlight snippet
  const validSnippet = 'Before <mark class="os-search-highlight">highlighted word</mark> After';
  const sanitizedValid = sanitizeSnippetHtml(validSnippet);
  assert.strictEqual(
    sanitizedValid,
    'Before <mark class="os-search-highlight">highlighted word</mark> After',
    'Valid Sol:OS mark must be preserved exactly'
  );

  const win1 = new Window();
  const div1 = win1.document.createElement('div');
  div1.innerHTML = `<p class="doc-item-snippet">${sanitizedValid}</p>`;
  const marks1 = div1.querySelectorAll('mark.os-search-highlight');
  assert.strictEqual(marks1.length, 1, 'Exactly 1 mark element in DOM');
  assert.strictEqual(marks1[0].textContent, 'highlighted word');

  // 2. Mathematical inequalities with and without highlights
  const mathCases = [
    'Math: 2 < 5 && 10 > 3',
    'Inequality: a < 10 && b > 20 for loops',
    'Condition: if (x < y && z > w) return true;',
    'Marked math: <mark class="os-search-highlight">a < 10 && b > 20</mark>',
    'Split math: x < <mark class="os-search-highlight">y</mark> && a > <mark class="os-search-highlight">b</mark>',
  ];

  for (const mathText of mathCases) {
    const sanitized = sanitizeSnippetHtml(mathText);

    // Verify angle brackets are escaped into entities in the HTML string
    if (mathText.includes('2 < 5')) {
      assert.ok(sanitized.includes('2 &lt; 5 &amp;&amp; 10 &gt; 3') || sanitized.includes('2 &lt; 5 && 10 &gt; 3'));
    }

    // Verify DOM textContent preservation
    const win = new Window();
    const div = win.document.createElement('div');
    div.innerHTML = `<p class="doc-item-snippet">${sanitized}</p>`;
    const snippetEl = div.querySelector('.doc-item-snippet');

    assert.ok(
      snippetEl?.textContent?.includes('2 < 5 && 10 > 3') ||
      snippetEl?.textContent?.includes('a < 10 && b > 20') ||
      snippetEl?.textContent?.includes('x < y && z > w') ||
      snippetEl?.textContent?.includes('x < y && a > b'),
      `DOM textContent must preserve mathematical comparison verbatim: got "${snippetEl?.textContent}"`
    );

    // Verify zero illegal tags created
    const nonMarkTags = snippetEl?.querySelectorAll(':not(mark)');
    assert.strictEqual(nonMarkTags?.length, 0, 'No tags other than mark allowed');
  }
});

// ----------------------------------------------------------------------------
// SUITE 5: QUERY ANGLE BRACKETS & EMPTY STATE RENDERING (NO &amp;lt;)
// ----------------------------------------------------------------------------

test('Adversarial R3.5: Search queries with angle brackets render cleanly without double-escaping &amp;lt;', async () => {
  const queries = [
    'apples < oranges',
    '2 > 1',
    'x < y && a > b',
    'alpha < beta < gamma > delta',
    'i < n && j > 0',
    '<script>alert(1)</script>',
    '<<< hostile >>>',
    'a < b & c > d "quoted" \'single\'',
  ];

  const repo = new InMemoryStorageRepository();
  await repo.init();

  for (const query of queries) {
    const { shell, container } = createDrawerDOMFixture();
    const drawer = new LeftLibraryDrawer({
      container: container as unknown as HTMLElement,
      shellElement: shell as unknown as HTMLElement,
      repository: repo,
      onSelectDocument: () => {},
    });
    await drawer.init();

    await drawer.executeSearch(query);

    const emptyStateEl = container.querySelector('.library-empty-state');
    assert.ok(emptyStateEl, `Empty state element must exist for query "${query}"`);

    const emptyMsgEl = container.querySelector('.library-empty-state .empty-message');
    assert.ok(emptyMsgEl, `Empty message element must exist for query "${query}"`);

    // 1. INVARIANT: textContent in DOM must render clean text matching the query
    const expectedText = `No matches for "${query}"`;
    assert.strictEqual(
      emptyMsgEl.textContent,
      expectedText,
      `Empty message textContent must match query verbatim without literal entities. Got "${emptyMsgEl.textContent}"`
    );

    // 2. INVARIANT: innerHTML must NEVER contain double-escaped &amp;lt; or &amp;gt;
    assert.strictEqual(
      emptyStateEl.innerHTML.includes('&amp;lt;'),
      false,
      `Empty state HTML must NOT contain double-escaped &amp;lt; for query "${query}"`
    );
    assert.strictEqual(
      emptyStateEl.innerHTML.includes('&amp;gt;'),
      false,
      `Empty state HTML must NOT contain double-escaped &amp;gt; for query "${query}"`
    );

    // 3. INVARIANT: ZERO hostile elements created in empty state
    const hostileElements = emptyStateEl.querySelectorAll('script, img, iframe, svg, object, embed');
    assert.strictEqual(
      hostileElements.length,
      0,
      `Empty state must create ZERO hostile DOM elements for query "${query}"`
    );

    drawer.destroy();
  }
});

// ----------------------------------------------------------------------------
// SUITE 6: END-TO-END CARD CREATION WITH HOSTILE PAYLOADS IN SQLITE & INMEMORY
// ----------------------------------------------------------------------------

test('Adversarial R3.6: Full LeftLibraryDrawer card creation with solidus & unclosed vectors in SQLite repository', async () => {
  const repo = new SQLiteStorageRepository();
  await repo.init();

  const now = Date.now();

  // Insert documents containing solidus and unclosed tags across content and titles
  await repo.saveDocument({
    id: 'doc-solidus-svg',
    title: 'Solidus SVG Doc <svg/onload=alert(1)>',
    content: 'TargetSearchTerm document content with <svg/onload=alert(1)> embedded.',
    created_at: now - 3000,
    updated_at: now - 3000,
  });

  await repo.saveDocument({
    id: 'doc-solidus-img',
    title: 'Solidus IMG Doc <img/src=x/onerror=alert(1)>',
    content: 'TargetSearchTerm document content with <img/src=x/onerror=alert(1)> embedded.',
    created_at: now - 2000,
    updated_at: now - 2000,
  });

  await repo.saveDocument({
    id: 'doc-unclosed-svg',
    title: 'Unclosed SVG Doc <svg onload="alert(1)"',
    content: 'TargetSearchTerm document content with <svg onload="alert(1)" embedded.',
    created_at: now - 1000,
    updated_at: now - 1000,
  });

  await repo.saveDocument({
    id: 'doc-pua-script',
    title: 'PUA Script Doc \uE000<script>alert(1)</script>\uE001',
    content: 'TargetSearchTerm document content with \uE000<script>alert(1)</script>\uE001 embedded.',
    created_at: now - 500,
    updated_at: now - 500,
  });

  const { shell, container } = createDrawerDOMFixture();
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // Non-search view: verify cards rendered cleanly
  const nonSearchCards = container.querySelectorAll('.document-card');
  assert.strictEqual(nonSearchCards.length, 4, 'All 4 documents must be rendered');

  // Strict DOM check in non-search view
  const nonSearchHostile = container.querySelectorAll('script, img, iframe, svg, object, embed');
  assert.strictEqual(
    nonSearchHostile.length,
    0,
    `Non-search view must have zero hostile DOM nodes, found ${nonSearchHostile.length}`
  );

  // Search view with highlight snippets
  await drawer.executeSearch('TargetSearchTerm');
  const searchCards = container.querySelectorAll('.document-card');
  assert.strictEqual(searchCards.length, 4, 'All 4 documents must match search');

  // Strict DOM check in search view: ZERO hostile tags anywhere in the container
  const searchHostile = container.querySelectorAll('script, img, iframe, svg, object, embed');
  assert.strictEqual(
    searchHostile.length,
    0,
    `Search view must have zero hostile DOM nodes, found ${searchHostile.length}`
  );

  // Specifically check every .doc-item-snippet
  for (const card of searchCards) {
    const cardEl = card as unknown as HTMLElement;
    const snippetEl = cardEl.querySelector('.doc-item-snippet') as unknown as HTMLElement;
    assert.ok(snippetEl, 'Snippet element must exist in card');

    const hostileInSnippet = snippetEl.querySelectorAll('script, img, iframe, svg, object, embed');
    assert.strictEqual(
      hostileInSnippet.length,
      0,
      `Snippet must contain zero hostile elements, found ${hostileInSnippet.length}`
    );

    // Only mark tags allowed
    const children = snippetEl.querySelectorAll('*');
    for (const child of children) {
      assert.strictEqual(child.tagName.toLowerCase(), 'mark');
      assert.strictEqual(child.className, 'os-search-highlight');
    }
  }

  drawer.destroy();
  repo.destroy();
});

// ----------------------------------------------------------------------------
// SUITE 7: REDOS & HIGH-VOLUME ADVERSARIAL FUZZING
// ----------------------------------------------------------------------------

test('Adversarial R3.7: High-volume adversarial fuzzing and ReDoS resistance', () => {
  // Construct 10,000 character hostile string
  const chunks: string[] = [];
  const vectors = [
    '<svg/onload=alert(1)>',
    '<img/src=x/onerror=alert(1)>',
    '<script/src=data:...>',
    '<svg onload="alert(1)"',
    '<img src="x" onerror="evil()"',
    '\uE000<script>alert(1)</script>\uE001',
    '<<< >>> &&& <mark class="os-search-highlight">highlight</mark> ',
    'apples < oranges && 2 > 1 ',
  ];

  for (let i = 0; i < 500; i++) {
    chunks.push(vectors[i % vectors.length]);
  }
  const hugePayload = chunks.join('');
  assert.ok(hugePayload.length > 10000, 'Payload must be >10,000 characters');

  const startTime = Date.now();
  const sanitized = sanitizeSnippetHtml(hugePayload);
  const elapsedMs = Date.now() - startTime;

  // ReDoS check: Must complete rapidly (< 100ms)
  assert.ok(elapsedMs < 100, `Sanitization of 10KB payload took ${elapsedMs}ms, must be < 100ms`);

  // DOM mount check
  const win = new Window();
  const wrapper = win.document.createElement('div');
  wrapper.innerHTML = `<p class="doc-item-snippet">${sanitized}</p>`;
  const snippetEl = wrapper.querySelector('.doc-item-snippet')!;

  const hostileTags = snippetEl.querySelectorAll('script, img, iframe, svg, object, embed');
  assert.strictEqual(hostileTags.length, 0, 'Zero hostile tags in huge payload DOM');

  const markTags = snippetEl.querySelectorAll('mark.os-search-highlight');
  assert.ok(markTags.length > 0, 'Legitimate mark tags survived fuzzing');
});
