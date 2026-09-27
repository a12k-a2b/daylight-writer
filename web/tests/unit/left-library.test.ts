/**
 * tests/unit/left-library.test.ts
 * Unit tests for Left Library Drawer, Document List, Sorting, Search, and Tag Tree (F14, F15, F16, F22, F32)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { LeftLibraryDrawer, sanitizeSnippetHtml } from '../../src/drawers/left-library.ts';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

test('LeftLibraryDrawer: Layout initialization, open/close/toggle and zero-chrome class', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  shell.className = 'dc1-shell zero-chrome';
  const container = doc.createElement('aside');
  container.className = 'drawer drawer-left';
  const backdrop = doc.createElement('div');
  backdrop.className = 'drawer-backdrop';
  shell.appendChild(container);
  shell.appendChild(backdrop);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  let selectedId: string | null = null;
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    backdropElement: backdrop as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: (id) => {
      selectedId = id;
    },
  });

  await drawer.init();

  // Initially closed
  assert.strictEqual(drawer.getIsOpen(), false);
  assert.ok(!shell.classList.contains('left-open'));

  // Open drawer
  drawer.open();
  assert.strictEqual(drawer.getIsOpen(), true);
  assert.ok(shell.classList.contains('left-open'));
  assert.ok(!shell.classList.contains('zero-chrome'));

  // Close drawer
  drawer.close();
  assert.strictEqual(drawer.getIsOpen(), false);
  assert.ok(!shell.classList.contains('left-open'));
  assert.ok(shell.classList.contains('zero-chrome'));

  // Toggle drawer
  drawer.toggle();
  assert.strictEqual(drawer.getIsOpen(), true);
  assert.ok(shell.classList.contains('left-open'));

  drawer.toggle();
  assert.strictEqual(drawer.getIsOpen(), false);

  drawer.destroy();
});

test('LeftLibraryDrawer: Date sorting toggle between updated_at and created_at', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  const now = Date.now();
  // Doc 1: Created earlier (now - 2000), Updated later (now)
  await repo.saveDocument({
    id: 'doc-alpha',
    title: 'Doc Alpha',
    content: 'First document text',
    created_at: now - 2000,
    updated_at: now,
  });

  // Doc 2: Created later (now - 1000), Updated earlier (now - 500)
  await repo.saveDocument({
    id: 'doc-beta',
    title: 'Doc Beta',
    content: 'Second document text',
    created_at: now - 1000,
    updated_at: now - 500,
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    initialSortBy: 'updated_at',
    onSelectDocument: () => {},
  });

  await drawer.init();

  // 1. By default, sorted by updated_at DESC -> doc-alpha is first
  assert.strictEqual(drawer.getSortBy(), 'updated_at');
  const cards1 = container.querySelectorAll('.document-card');
  assert.strictEqual(cards1.length, 2);
  assert.strictEqual((cards1[0] as unknown as HTMLElement).dataset.id, 'doc-alpha');
  assert.strictEqual((cards1[1] as unknown as HTMLElement).dataset.id, 'doc-beta');

  // 2. Toggle sort to created_at DESC -> doc-beta is first
  await drawer.setSortBy('created_at');
  assert.strictEqual(drawer.getSortBy(), 'created_at');
  const cards2 = container.querySelectorAll('.document-card');
  assert.strictEqual((cards2[0] as unknown as HTMLElement).dataset.id, 'doc-beta');
  assert.strictEqual((cards2[1] as unknown as HTMLElement).dataset.id, 'doc-alpha');

  drawer.destroy();
});

test('LeftLibraryDrawer: + New Document frictionless creation flow', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  let selectedDocId: string | null = null;
  let createdDocId: string | null = null;

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: (id) => {
      selectedDocId = id;
    },
    onCreateDocument: (doc) => {
      createdDocId = doc.id;
    },
  });

  await drawer.init();

  // Create new document
  const newDoc = await drawer.createNewDocument();
  assert.ok(newDoc.id);
  assert.strictEqual(newDoc.title, 'Untitled Document');
  assert.strictEqual(newDoc.content, '');
  assert.strictEqual(createdDocId, newDoc.id);
  assert.strictEqual(selectedDocId, newDoc.id);

  // Document should be present in repository
  const fetched = await repo.getDocument(newDoc.id);
  assert.ok(fetched);
  assert.strictEqual(fetched?.id, newDoc.id);

  // Document card should be highlighted active
  const activeCard = container.querySelector('.document-card.active-doc') as HTMLElement | null;
  assert.ok(activeCard);
  assert.strictEqual(activeCard?.dataset.id, newDoc.id);

  drawer.destroy();
});

test('LeftLibraryDrawer: Instant fuzzy search and snippet match highlighting', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-quantum',
    title: 'Quantum Mechanics',
    content: 'Exploring wave-particle duality and entanglement.',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  await repo.saveDocument({
    id: 'doc-biology',
    title: 'Cellular Biology',
    content: 'Cell division and genetics in plants.',
    created_at: Date.now() - 100,
    updated_at: Date.now() - 100,
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });

  await drawer.init();

  // 1. All documents rendered initially
  let cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 2);

  // 2. Search for "quantum"
  await drawer.executeSearch('quantum');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1);
  assert.strictEqual((cards[0] as unknown as HTMLElement).dataset.id, 'doc-quantum');

  // 3. Clear search restores full list
  await drawer.executeSearch('');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 2);

  drawer.destroy();
});

test('LeftLibraryDrawer: Hierarchical tag tree rendering and tag filtering', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  const doc1 = await repo.saveDocument({
    id: 'doc-1',
    title: 'Draft Essay',
    content: 'Essay text #project/drafts',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await repo.setDocumentTags(doc1.id, ['project/drafts']);

  const doc2 = await repo.saveDocument({
    id: 'doc-2',
    title: 'Research Notes',
    content: 'Notes text #project/research',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await repo.setDocumentTags(doc2.id, ['project/research']);

  const doc3 = await repo.saveDocument({
    id: 'doc-3',
    title: 'Personal Journal',
    content: 'Journal text #personal',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await repo.setDocumentTags(doc3.id, ['personal']);

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });

  await drawer.init();

  // Tag tree container should contain root "All Documents" and tags
  const tagRows = container.querySelectorAll('.tag-tree-row');
  assert.ok(tagRows.length >= 2, 'Should render All Documents and root tags');

  // Filter by tag "project/drafts"
  await drawer.filterByTag('project/drafts');
  assert.strictEqual(drawer.getSelectedTagPath(), 'project/drafts');

  const filteredCards = container.querySelectorAll('.document-card');
  assert.strictEqual(filteredCards.length, 1);
  assert.strictEqual((filteredCards[0] as unknown as HTMLElement).dataset.id, 'doc-1');

  // Clear tag filter
  await drawer.filterByTag(null);
  assert.strictEqual(drawer.getSelectedTagPath(), null);
  const allCards = container.querySelectorAll('.document-card');
  assert.strictEqual(allCards.length, 3);

  drawer.destroy();
});

test('LeftLibraryDrawer: Document selection closes drawer (Single-touch zero-chrome restoration)', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-target',
    title: 'Target Doc',
    content: 'Some text',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  let selectedId: string | null = null;
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: (id) => {
      selectedId = id;
    },
  });

  await drawer.init();
  drawer.open();
  assert.strictEqual(drawer.getIsOpen(), true);

  // Click card
  const card = container.querySelector('.document-card') as unknown as HTMLElement;
  assert.ok(card);
  card.click();

  assert.strictEqual(selectedId, 'doc-target');
  // Drawer must be closed
  assert.strictEqual(drawer.getIsOpen(), false);
  assert.ok(!shell.classList.contains('left-open'));

  drawer.destroy();
});

test('sanitizeSnippetHtml: permits only Sol:OS mark tags and neutralizes hostile tags without double escaping', () => {
  const safeSnippet = 'Hello <mark class="os-search-highlight">world</mark> &amp; friends';
  assert.strictEqual(sanitizeSnippetHtml(safeSnippet), safeSnippet, 'Safe highlight and entity must be preserved');

  const hostile = 'Prefix <script>alert(1)</script> <mark class="os-search-highlight">match</mark> <img src=x onerror=2>';
  const sanitized = sanitizeSnippetHtml(hostile);
  assert.ok(sanitized.includes('<mark class="os-search-highlight">match</mark>'), 'Mark tag must be preserved');
  assert.strictEqual(sanitized.includes('<script>'), false);
  assert.strictEqual(sanitized.includes('<img'), false);
  assert.ok(sanitized.includes('&lt;script&gt;'));
  assert.ok(sanitized.includes('&lt;img'));
});

test('LeftLibraryDrawer: Stored XSS attack vectors in document snippet produce escaped text and zero hostile DOM nodes', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-xss-payload',
    title: 'XSS Injection Attempt: <img src="x" onerror="window.__xssRun=1" />',
    content: 'Payload: <script>alert("xss")</script> <img src="x" onerror="evil()" />',
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  await drawer.executeSearch('Payload');

  const card = container.querySelector('.document-card[data-id="doc-xss-payload"]') as unknown as HTMLElement;
  assert.ok(card, 'Card must be rendered');

  const snippetEl = card.querySelector('.doc-item-snippet') as unknown as HTMLElement;
  assert.ok(snippetEl, 'Snippet container must exist');

  // Assert zero script or img elements were created in the DOM
  assert.strictEqual(snippetEl.querySelectorAll('script').length, 0, 'Zero script tags allowed');
  assert.strictEqual(snippetEl.querySelectorAll('img').length, 0, 'Zero img tags allowed');

  // Assert only <mark class="os-search-highlight">
  const nonMark = snippetEl.querySelectorAll('*:not(mark.os-search-highlight)');
  assert.strictEqual(nonMark.length, 0, 'No elements other than mark allowed');

  // HTML escaping verification
  assert.ok(snippetEl.innerHTML.includes('&lt;script&gt;'), 'Snippet innerHTML must contain &lt;script&gt;');
  assert.strictEqual(snippetEl.innerHTML.includes('<script>'), false, 'Snippet innerHTML must not contain raw <script>');

  // Text content preservation
  assert.ok(snippetEl.textContent?.includes('<script>'), 'Snippet textContent preserves visual text');

  drawer.destroy();
});

test('LeftLibraryDrawer: Scopes fuzzy search results by active tag filter and prefix descendants', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  const now = Date.now();
  // Doc 1: Tagged project/writing/drafts
  const doc1 = await repo.saveDocument({
    id: 'doc-1',
    title: 'Chapter 1 Draft',
    content: 'The typewriter hammer struck the platen with precision.',
    created_at: now,
    updated_at: now,
  });
  await repo.setDocumentTags(doc1.id, ['project/writing/drafts']);

  // Doc 2: Tagged personal/journal
  const doc2 = await repo.saveDocument({
    id: 'doc-2',
    title: 'Morning Reflections',
    content: 'Writing on a vintage typewriter brings immense focus.',
    created_at: now - 100,
    updated_at: now - 100,
  });
  await repo.setDocumentTags(doc2.id, ['personal/journal']);

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  // 1. Global search returns both documents
  await drawer.executeSearch('typewriter');
  let cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 2, 'Global search must return all matching documents');

  // 2. Filter by personal/journal and re-search
  await drawer.filterByTag('personal/journal');
  await drawer.executeSearch('typewriter');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1, 'Search must be scoped to personal/journal');
  assert.strictEqual((cards[0] as unknown as HTMLElement).dataset.id, 'doc-2');

  // Verify banner
  const banner = container.querySelector('#active-filter-banner') as unknown as HTMLElement;
  assert.strictEqual(banner.hidden, false);
  assert.ok(banner.textContent?.includes('Tag: #personal/journal'));
  assert.ok(banner.textContent?.includes('Search: "typewriter"'));

  // 3. Filter by prefix ancestor "project" matches descendant "project/writing/drafts"
  await drawer.filterByTag('project');
  await drawer.executeSearch('typewriter');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1, 'Prefix tag filter must match descendant tag');
  assert.strictEqual((cards[0] as unknown as HTMLElement).dataset.id, 'doc-1');

  // 4. Tag filter with no search matches in that branch
  await drawer.filterByTag('status/done');
  await drawer.executeSearch('typewriter');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 0, 'Must return zero cards when query not in active tag branch');
  const emptyState = container.querySelector('.library-empty-state');
  assert.ok(emptyState, 'Must render empty state message');

  // 5. Clear search query restores tag-filtered list
  await drawer.filterByTag('project');
  await drawer.executeSearch('');
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 1, 'Clearing search must restore tag-filtered document list');
  assert.strictEqual((cards[0] as unknown as HTMLElement).dataset.id, 'doc-1');

  // 6. Clear tag filter restores global search hits
  await drawer.executeSearch('typewriter');
  await drawer.filterByTag(null);
  cards = container.querySelectorAll('.document-card');
  assert.strictEqual(cards.length, 2, 'Clearing tag filter must restore global search hits');

  drawer.destroy();
});

test('sanitizeSnippetHtml: neutralizes slash-delimited and unclosed tags while preserving marks and math', () => {
  // Slash-delimited HTML5 vectors
  const slashVectors = [
    '<svg/onload=alert(1)>',
    '<img/src=x/onerror=alert(1)>',
    '<script/src=data:text/javascript,alert(1)>',
    '<iframe/src=javascript:alert(1)>',
  ];
  for (const vec of slashVectors) {
    const sanitized = sanitizeSnippetHtml(vec);
    assert.ok(!sanitized.includes('<svg'), `Must not contain raw <svg for ${vec}`);
    assert.ok(!sanitized.includes('<img'), `Must not contain raw <img for ${vec}`);
    assert.ok(!sanitized.includes('<script'), `Must not contain raw <script for ${vec}`);
    assert.ok(!sanitized.includes('<iframe'), `Must not contain raw <iframe for ${vec}`);
    assert.ok(sanitized.includes('&lt;'), `Must escape opening angle bracket for ${vec}`);
  }

  // Unclosed and truncated vectors
  const unclosedVectors = [
    '<svg onload="alert(1)"',
    '<img src="x" onerror="alert(1)"',
    '<script>alert(1)',
    '<svg',
  ];
  for (const vec of unclosedVectors) {
    const sanitized = sanitizeSnippetHtml(vec);
    assert.ok(sanitized.includes('&lt;'), `Must escape opening bracket for ${vec}`);
    assert.strictEqual(sanitized.includes('<svg'), false);
    assert.strictEqual(sanitized.includes('<img'), false);
  }

  // Valid mark preservation
  const validMark = 'Prefix <mark class="os-search-highlight">highlighted</mark> suffix';
  assert.strictEqual(sanitizeSnippetHtml(validMark), validMark);

  // Mathematical inequality preservation
  const math = 'a < 10 && b > 20';
  assert.strictEqual(sanitizeSnippetHtml(math), 'a &lt; 10 && b &gt; 20');

  // Spoofed mark tags
  const spoofed = '<mark onclick="evil()">click</mark>';
  assert.strictEqual(sanitizeSnippetHtml(spoofed).includes('<mark '), false);
});

test('LeftLibraryDrawer: displays search query with angle brackets cleanly in empty state without double-escaping', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });
  await drawer.init();

  await drawer.executeSearch('apples < oranges');
  const emptyMsgEl = container.querySelector('.library-empty-state .empty-message');
  assert.strictEqual(emptyMsgEl?.textContent, 'No matches for "apples < oranges"');

  drawer.destroy();
});

class GDocsAwareStorageRepository extends InMemoryStorageRepository {
  override async saveDocument(doc: Partial<DocumentRecord> & { id: string }): Promise<DocumentRecord> {
    const saved = await super.saveDocument(doc);
    if ('google_drive_file_id' in doc) {
      saved.google_drive_file_id = doc.google_drive_file_id ?? null;
      const pending = (this as any).pendingEdits.get(doc.id);
      if (pending) {
        pending.google_drive_file_id = doc.google_drive_file_id ?? null;
      }
      const existing = (this as any).documents.get(doc.id);
      if (existing) {
        existing.google_drive_file_id = doc.google_drive_file_id ?? null;
      }
    }
    return saved;
  }
}

test('LeftLibraryDrawer: Synced document renders .doc-gdocs-badge and a.doc-gdocs-link with valid edit URL', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new GDocsAwareStorageRepository();
  await repo.init();

  const fileId = 'gdoc-test-file-987';
  await repo.saveDocument({
    id: 'doc-synced',
    title: 'Synced Cloud Manuscript',
    content: 'Content synced with Google Docs.',
    created_at: Date.now(),
    updated_at: Date.now(),
    google_drive_file_id: fileId,
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });

  await drawer.init();

  const card = container.querySelector('.document-card[data-id="doc-synced"]') as HTMLElement | null;
  assert.ok(card, 'Card must be rendered');

  // 1. Badge verification
  const badgeEl = card.querySelector('.doc-gdocs-badge');
  assert.ok(badgeEl, 'Must render .doc-gdocs-badge for synced document');
  assert.strictEqual(badgeEl.getAttribute('data-file-id'), fileId, 'Badge must store data-file-id');
  assert.ok(badgeEl.textContent?.includes('Google Docs'), 'Badge text must include Google Docs');

  // 2. Link verification
  const linkEl = card.querySelector('a.doc-gdocs-link') as HTMLAnchorElement | null;
  assert.ok(linkEl, 'Must render a.doc-gdocs-link');
  assert.strictEqual(linkEl.getAttribute('href'), `https://docs.google.com/document/d/${fileId}/edit`, 'Must link directly to Google Docs edit endpoint');
  assert.strictEqual(linkEl.getAttribute('target'), '_blank', 'Must target new tab/window');
  assert.strictEqual(linkEl.getAttribute('rel'), 'noopener noreferrer', 'Must set secure rel attributes');
  assert.strictEqual(linkEl.getAttribute('data-file-id'), fileId, 'Link must also carry data-file-id');

  drawer.destroy();
});

test('LeftLibraryDrawer: Local document omits .doc-gdocs-badge and .doc-gdocs-link', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-local-only',
    title: 'Offline Draft Manuscript',
    content: 'Local text only.',
    created_at: Date.now(),
    updated_at: Date.now(),
    google_drive_file_id: null,
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });

  await drawer.init();

  const card = container.querySelector('.document-card[data-id="doc-local-only"]') as HTMLElement | null;
  assert.ok(card, 'Card must be rendered');

  const badgeEl = card.querySelector('.doc-gdocs-badge');
  assert.strictEqual(badgeEl, null, 'Must omit .doc-gdocs-badge when google_drive_file_id is null');

  const linkEl = card.querySelector('.doc-gdocs-link');
  assert.strictEqual(linkEl, null, 'Must omit .doc-gdocs-link when google_drive_file_id is null');

  drawer.destroy();
});

test('LeftLibraryDrawer: Google Docs badge click stops propagation and does not select card or dismiss drawer', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  shell.className = 'dc1-shell left-open';
  const container = doc.createElement('aside');
  container.className = 'drawer drawer-left';
  shell.appendChild(container);

  const repo = new GDocsAwareStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-click-test',
    title: 'Click Intercept Doc',
    content: 'Testing click propagation stop.',
    created_at: Date.now(),
    updated_at: Date.now(),
    google_drive_file_id: 'gdoc-click-123',
  });

  let selectedId: string | null = null;
  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: (id) => {
      selectedId = id;
    },
  });

  await drawer.init();
  drawer.open();
  assert.strictEqual(drawer.getIsOpen(), true);

  const linkEl = container.querySelector('a.doc-gdocs-link') as HTMLElement | null;
  assert.ok(linkEl, 'Link element must exist');

  // Click on the Google Docs link (prevent happy-dom navigation fetch hang)
  linkEl.addEventListener('click', (e) => e.preventDefault());
  linkEl.click();

  // Document should NOT be selected, and drawer should REMAIN open
  assert.strictEqual(selectedId, null, 'Document must not be selected by badge click');
  assert.strictEqual(drawer.getIsOpen(), true, 'Drawer must not close on badge click');

  drawer.destroy();
});

test('LeftLibraryDrawer: Invokes DaylightBridgeClient.openExternalUrl when present', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  let openedUrl: string | null = null;
  (win as any).DaylightBridgeClient = {
    openExternalUrl: (url: string) => {
      openedUrl = url;
    },
  };

  const repo = new GDocsAwareStorageRepository();
  await repo.init();

  const fileId = 'gdoc-bridge-test';
  await repo.saveDocument({
    id: 'doc-bridge-test',
    title: 'Bridge Dispatch Doc',
    content: 'Testing bridge external url dispatch.',
    created_at: Date.now(),
    updated_at: Date.now(),
    google_drive_file_id: fileId,
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });

  await drawer.init();

  const linkEl = container.querySelector('a.doc-gdocs-link') as HTMLElement | null;
  assert.ok(linkEl, 'Link element must exist');

  linkEl.click();

  assert.strictEqual(
    openedUrl,
    `https://docs.google.com/document/d/${fileId}/edit`,
    'Must dispatch target edit URL to DaylightBridgeClient.openExternalUrl'
  );

  delete (win as any).DaylightBridgeClient;
  drawer.destroy();
});

test('LeftLibraryDrawer: Search results preserve .doc-gdocs-badge for matching documents', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new GDocsAwareStorageRepository();
  await repo.init();

  await repo.saveDocument({
    id: 'doc-cloud-search',
    title: 'Atmospheric Physics',
    content: 'Stratospheric ozone depletion and ultraviolet dynamics.',
    created_at: Date.now(),
    updated_at: Date.now(),
    google_drive_file_id: 'gdoc-physics-42',
  });

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    onSelectDocument: () => {},
  });

  await drawer.init();

  await drawer.executeSearch('ozone');

  const card = container.querySelector('.document-card[data-id="doc-cloud-search"]') as HTMLElement | null;
  assert.ok(card, 'Search hit card must exist');

  const badgeEl = card.querySelector('.doc-gdocs-badge');
  assert.ok(badgeEl, 'Search hit must render .doc-gdocs-badge');
  assert.strictEqual(badgeEl.getAttribute('data-file-id'), 'gdoc-physics-42');

  const linkEl = card.querySelector('a.doc-gdocs-link') as HTMLAnchorElement | null;
  assert.ok(linkEl, 'Search hit must render a.doc-gdocs-link');
  assert.strictEqual(linkEl.getAttribute('href'), 'https://docs.google.com/document/d/gdoc-physics-42/edit');

  drawer.destroy();
});

