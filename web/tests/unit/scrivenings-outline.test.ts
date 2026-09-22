/**
 * tests/unit/scrivenings-outline.test.ts
 * Comprehensive test suite for Steven Johnson's Scrivener features in Daylight Writer:
 * 1. Outline / Binder tree hierarchy generation and sorting
 * 2. Playlist drag-and-drop reordering with normalized sort indices
 * 3. Split document at cursor offset (Cmd+Shift+K)
 * 4. Scrivenings composite concatenation engine with Sol:OS dividers and two-way edit routing
 * 5. Left Library Drawer Outline view mode, expand/collapse, and Scrivenings triggers
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { InMemoryStorageRepository } from '../e2e/helpers/mock-adapters.ts';
import { ScriveningsEngine } from '../../src/editor/scrivenings-engine.ts';
import { LeftLibraryDrawer } from '../../src/drawers/left-library.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

test('Steven Johnson Outline: Hierarchy generation, nesting, and depth assignment', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  // Create Chapter 1 (folder)
  const ch1 = await repo.saveDocument({
    id: 'ch-1',
    title: 'Chapter 1: The Ghost Map',
    content: '',
    item_type: 'folder',
    parent_id: null,
    sort_order: 10,
    created_at: 1000,
    updated_at: 1000,
  });

  // Create Sections under Chapter 1
  const sec1 = await repo.saveDocument({
    id: 'sec-1',
    title: 'Broad Street Pump',
    content: 'The epidemic began on the night of August 31, 1854.',
    item_type: 'document',
    parent_id: 'ch-1',
    sort_order: 10,
    created_at: 1100,
    updated_at: 1100,
  });

  const sec2 = await repo.saveDocument({
    id: 'sec-2',
    title: 'John Snow Investigates',
    content: 'Dr. John Snow had long suspected water-borne transmission.',
    item_type: 'document',
    parent_id: 'ch-1',
    sort_order: 20,
    created_at: 1200,
    updated_at: 1200,
  });

  // Create Chapter 2 (folder)
  const ch2 = await repo.saveDocument({
    id: 'ch-2',
    title: 'Chapter 2: The Adjacent Possible',
    content: '',
    item_type: 'folder',
    parent_id: null,
    sort_order: 20,
    created_at: 1300,
    updated_at: 1300,
  });

  const tree = await repo.getOutlineTree();
  assert.strictEqual(tree.length, 2, 'Should have 2 top-level chapters');
  
  // Verify Chapter 1
  assert.strictEqual(tree[0].document.id, 'ch-1');
  assert.strictEqual(tree[0].depth, 0);
  assert.strictEqual(tree[0].children.length, 2);
  assert.strictEqual(tree[0].children[0].document.id, 'sec-1');
  assert.strictEqual(tree[0].children[0].depth, 1);
  assert.strictEqual(tree[0].children[1].document.id, 'sec-2');
  assert.strictEqual(tree[0].children[1].depth, 1);

  // Verify Chapter 2
  assert.strictEqual(tree[1].document.id, 'ch-2');
  assert.strictEqual(tree[1].depth, 0);
  assert.strictEqual(tree[1].children.length, 0);
});

test('Steven Johnson Playlist Reordering: Reorders siblings with normalized sort_order', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  // Create Chapter with 3 tracks (scenes)
  await repo.saveDocument({ id: 'ch-1', title: 'Chapter 1', item_type: 'folder', parent_id: null, sort_order: 10 });
  await repo.saveDocument({ id: 'scene-1', title: 'Track 1', item_type: 'document', parent_id: 'ch-1', sort_order: 10 });
  await repo.saveDocument({ id: 'scene-2', title: 'Track 2', item_type: 'document', parent_id: 'ch-1', sort_order: 20 });
  await repo.saveDocument({ id: 'scene-3', title: 'Track 3', item_type: 'document', parent_id: 'ch-1', sort_order: 30 });

  // Reorder: Move Track 3 to the top (index 0)
  await repo.reorderDocument('scene-3', 'ch-1', 0);

  const tree = await repo.getOutlineTree();
  const children = tree[0].children;
  assert.strictEqual(children.length, 3);
  assert.strictEqual(children[0].document.id, 'scene-3', 'Track 3 should now be first');
  assert.strictEqual(children[1].document.id, 'scene-1', 'Track 1 should now be second');
  assert.strictEqual(children[2].document.id, 'scene-2', 'Track 2 should now be third');

  // Verify normalized 10-interval spacing
  assert.strictEqual(children[0].document.sort_order, 0);
  assert.strictEqual(children[1].document.sort_order, 10);
  assert.strictEqual(children[2].document.sort_order, 20);
});

test('Steven Johnson Playlist Reordering: Move scene into a different chapter folder', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  await repo.saveDocument({ id: 'ch-1', title: 'Act I', item_type: 'folder', parent_id: null, sort_order: 10 });
  await repo.saveDocument({ id: 'ch-2', title: 'Act II', item_type: 'folder', parent_id: null, sort_order: 20 });
  await repo.saveDocument({ id: 'scene-1', title: 'Prologue', item_type: 'document', parent_id: 'ch-1', sort_order: 10 });

  // Move scene-1 into Act II (ch-2)
  await repo.reorderDocument('scene-1', 'ch-2', 0);

  const tree = await repo.getOutlineTree();
  assert.strictEqual(tree[0].children.length, 0, 'Act I should be empty');
  assert.strictEqual(tree[1].children.length, 1, 'Act II should have 1 child');
  assert.strictEqual(tree[1].children[0].document.id, 'scene-1');
  assert.strictEqual(tree[1].children[0].document.parent_id, 'ch-2');
});

test('Steven Johnson Split at Cursor: Splits document into two contiguous binder cards', async () => {
  const repo = new InMemoryStorageRepository();
  await repo.init();

  const originalContent = 'First part of paragraph.\n\nSecond part that belongs in a new section.';
  const splitOffset = 'First part of paragraph.'.length;

  const doc = await repo.saveDocument({
    id: 'doc-original',
    title: 'Combined Draft',
    content: originalContent,
    item_type: 'document',
    parent_id: 'ch-1',
    sort_order: 10,
    created_at: 1000,
    updated_at: 1000,
  });

  const { original, created } = await repo.splitDocumentAtCursor(doc.id, splitOffset);

  // Assert original document was trimmed
  assert.strictEqual(original.content, 'First part of paragraph.');
  assert.strictEqual(original.id, 'doc-original');

  // Assert newly created document contains remainder
  assert.strictEqual(created.content, 'Second part that belongs in a new section.');
  assert.strictEqual(created.parent_id, 'ch-1', 'New section inherits parent folder');
  assert.ok((created.sort_order ?? 0) > (original.sort_order ?? 0), 'New section ordered immediately after original');
  assert.ok(created.title.includes('Second part') || created.title.includes('Draft (Part 2)'), 'Title auto-generated from opening sentence');

  // Verify in repository storage
  const fetchedOriginal = await repo.getDocument(doc.id);
  const fetchedCreated = await repo.getDocument(created.id);
  assert.strictEqual(fetchedOriginal?.content, 'First part of paragraph.');
  assert.strictEqual(fetchedCreated?.content, 'Second part that belongs in a new section.');
});

test('ScriveningsEngine: Concatenates multiple chunks with Sol:OS dividers and pills', () => {
  const win = new Window();
  const doc = win.document;
  const container = doc.createElement('div');

  const docs: DocumentRecord[] = [
    {
      id: 'doc-1',
      title: 'Introduction',
      content: 'Opening premise of the book.',
      item_type: 'document',
      parent_id: 'folder-1',
      sort_order: 10,
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
    {
      id: 'doc-2',
      title: 'Evidence',
      content: 'Empirical research findings and case studies.',
      item_type: 'document',
      parent_id: 'folder-1',
      sort_order: 20,
      created_at: 1100,
      updated_at: 1100,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
  ];

  let isolatedId: string | null = null;
  const engine = new ScriveningsEngine({
    container: container as unknown as HTMLElement,
    callbacks: {
      onFocusSingleChunk: (docId) => {
        isolatedId = docId;
      },
    },
  });

  engine.loadConcatenatedDocuments(docs, 'doc-1');
  assert.strictEqual(engine.getIsConcatenated(), true);

  // Verify divider between section 1 and 2
  const dividers = container.querySelectorAll('.scrivenings-divider');
  assert.strictEqual(dividers.length, 1, 'Should have 1 divider between 2 sections');
  const glyph = dividers[0].querySelector('.scrivenings-divider-glyph');
  assert.strictEqual(glyph?.textContent, '§', 'Divider must feature Sol:OS section glyph');

  // Verify section headers and pills
  const headers = container.querySelectorAll('.scrivenings-section-header');
  assert.strictEqual(headers.length, 2);

  const title1 = headers[0].querySelector('.scrivenings-section-title');
  const count1 = headers[0].querySelector('.scrivenings-section-count');
  assert.strictEqual(title1?.textContent, 'Introduction');
  assert.strictEqual(count1?.textContent, '5 words');

  const title2 = headers[1].querySelector('.scrivenings-section-title');
  const count2 = headers[1].querySelector('.scrivenings-section-count');
  assert.strictEqual(title2?.textContent, 'Evidence');
  assert.strictEqual(count2?.textContent, '6 words');

  // Verify total manuscript metrics
  const metrics = engine.getManuscriptMetrics();
  assert.strictEqual(metrics.totalWordCount, 11);
  assert.strictEqual(metrics.sectionCount, 2);

  // Test Isolate button click (Micro-Focus trigger)
  const isolateBtn = headers[1].querySelector('.scrivenings-focus-btn') as unknown as HTMLElement;
  isolateBtn.click();
  assert.strictEqual(isolatedId, 'doc-2', 'Clicking isolate should notify parent with doc ID');
});

test('ScriveningsEngine: Two-way editing routes content changes back to specific child document ID', () => {
  const win = new Window();
  const doc = win.document;
  const container = doc.createElement('div');

  const docs: DocumentRecord[] = [
    {
      id: 'doc-a',
      title: 'Part A',
      content: 'Original content A.',
      item_type: 'document',
      parent_id: null,
      sort_order: 10,
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
    {
      id: 'doc-b',
      title: 'Part B',
      content: 'Original content B.',
      item_type: 'document',
      parent_id: null,
      sort_order: 20,
      created_at: 1100,
      updated_at: 1100,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
  ];

  let mutatedDocId: string | null = null;
  let mutatedContent: string | null = null;

  const engine = new ScriveningsEngine({
    container: container as unknown as HTMLElement,
    callbacks: {
      onDocumentChange: (docId, content) => {
        mutatedDocId = docId;
        mutatedContent = content;
      },
    },
  });

  engine.loadConcatenatedDocuments(docs);

  // Simulate editing section B's paragraph
  const sectionBParagraph = container.querySelector('.scrivenings-section-body[data-section-doc-id="doc-b"] .editor-paragraph') as unknown as HTMLElement;
  assert.ok(sectionBParagraph, 'Paragraph for section B must exist');

  // Mutate DOM content
  sectionBParagraph.textContent = 'Updated content B with new arguments.';
  engine.handleInput(sectionBParagraph);

  // Verify callbacks routed to child doc B, leaving doc A intact
  assert.strictEqual(mutatedDocId, 'doc-b');
  assert.strictEqual(mutatedContent, 'Updated content B with new arguments.');
  assert.strictEqual(engine.getDocumentContent('doc-a'), 'Original content A.');
  assert.strictEqual(engine.getDocumentContent('doc-b'), 'Updated content B with new arguments.');
});

test('LeftLibraryDrawer: Switches between Outline and Library views cleanly', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  shell.className = 'dc1-shell';
  const container = doc.createElement('aside');
  container.className = 'drawer drawer-left';
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    initialViewMode: 'outline',
    onSelectDocument: () => {},
  });

  await drawer.init();

  // Initially in Outline mode
  assert.strictEqual(drawer.getViewMode(), 'outline');
  assert.strictEqual(drawer.outlineTreeContainer.hidden, false);
  assert.strictEqual(drawer.documentListContainer.hidden, true);
  assert.strictEqual(drawer.tagTreeSection.hidden, true);

  // Switch to Library mode
  await drawer.setViewMode('library');
  assert.strictEqual(drawer.getViewMode(), 'library');
  assert.strictEqual(drawer.outlineTreeContainer.hidden, true);
  assert.strictEqual(drawer.documentListContainer.hidden, false);
  assert.strictEqual(drawer.tagTreeSection.hidden, false);

  // Switch back to Outline mode
  await drawer.setViewMode('outline');
  assert.strictEqual(drawer.getViewMode(), 'outline');
  assert.strictEqual(drawer.outlineTreeContainer.hidden, false);

  drawer.destroy();
});

test('LeftLibraryDrawer: Outline view renders folders, chapters, sections, and triggers Scrivenings', async () => {
  const win = new Window();
  const doc = win.document;
  const shell = doc.createElement('div');
  shell.className = 'dc1-shell';
  const container = doc.createElement('aside');
  shell.appendChild(container);

  const repo = new InMemoryStorageRepository();
  await repo.init();

  // Populate Chapter with 2 child sections
  const ch = await repo.saveDocument({ id: 'ch-sci', title: 'Science & Society', item_type: 'folder', parent_id: null, sort_order: 10 });
  await repo.saveDocument({ id: 'sec-1', title: 'The Scientific Method', content: 'Hypothesis and empirical testing.', item_type: 'document', parent_id: 'ch-sci', sort_order: 10 });
  await repo.saveDocument({ id: 'sec-2', title: 'Peer Review', content: 'Rigorous peer criticism.', item_type: 'document', parent_id: 'ch-sci', sort_order: 20 });

  let scriveningsDocs: DocumentRecord[] | null = null;
  let scriveningsFolderId: string | null = null;

  const drawer = new LeftLibraryDrawer({
    container: container as unknown as HTMLElement,
    shellElement: shell as unknown as HTMLElement,
    repository: repo,
    initialViewMode: 'outline',
    onSelectDocument: () => {},
    onSelectScrivenings: (childDocs, folderId) => {
      scriveningsDocs = childDocs;
      scriveningsFolderId = folderId;
    },
  });

  await drawer.init();

  // Find the folder row and Scrivenings trigger button
  const folderRow = drawer.outlineTreeContainer.querySelector('.outline-row.is-folder') as unknown as HTMLElement;
  assert.ok(folderRow, 'Folder row must be rendered in outline tree');

  const scriveningsBtn = folderRow.querySelector('.outline-scrivenings-trigger') as unknown as HTMLElement;
  assert.ok(scriveningsBtn, '§ Scrivenings trigger button must exist on folder');

  // Trigger Scrivenings
  scriveningsBtn.click();
  // Wait a tick for async handler
  await new Promise(r => setTimeout(r, 10));

  assert.strictEqual(scriveningsFolderId, 'ch-sci');
  assert.ok(scriveningsDocs !== null);
  const resolvedDocs = scriveningsDocs as unknown as DocumentRecord[];
  assert.strictEqual(resolvedDocs.length, 2);
  assert.strictEqual(resolvedDocs[0].id, 'sec-1');
  assert.strictEqual(resolvedDocs[1].id, 'sec-2');

  drawer.destroy();
});
