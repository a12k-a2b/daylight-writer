/**
 * tests/unit/context-assistant.test.ts
 * Unit tests for Context-Aware Query Assistant (F51, F52, F53)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { ContextAssistant } from '../../src/ai/context-assistant.ts';
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import type { ThoughtNoteRecord } from '../../src/storage/schema.ts';

test('ContextAssistant: indexDocument parses and numbers paragraphs [¶1], [¶2]', () => {
  const assistant = new ContextAssistant();
  const doc = 'First paragraph introducing the premise.\n\nSecond paragraph delving into historical context.\n\nThird paragraph summarizing findings.';

  const indexed = assistant.indexDocument(doc);
  assert.strictEqual(indexed.length, 3);
  assert.strictEqual(indexed[0].index, 1);
  assert.strictEqual(indexed[0].label, '[¶1]');
  assert.strictEqual(indexed[0].text, 'First paragraph introducing the premise.');
  assert.strictEqual(indexed[1].label, '[¶2]');
  assert.strictEqual(indexed[2].label, '[¶3]');
});

test('ContextAssistant: indexNotes filters deleted notes and catalogs labels [Note:anchor]', () => {
  const assistant = new ContextAssistant();
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-1',
      content: 'Note on ancient libraries',
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    },
    {
      id: 'n-2',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-3',
      content: 'Soft deleted note',
      created_at: 2000,
      updated_at: 2000,
      deleted_at: 3000,
    },
    {
      id: 'n-3',
      document_id: 'doc-1',
      paragraph_anchor_id: '¶4',
      content: 'Alternative anchor notation',
      created_at: 4000,
      updated_at: 4000,
      deleted_at: null,
    },
  ];

  const indexed = assistant.indexNotes(notes);
  assert.strictEqual(indexed.length, 2);
  assert.strictEqual(indexed[0].label, '[Note:p-1]');
  assert.strictEqual(indexed[1].label, '[Note:¶4]');
});

test('ContextAssistant: query with AI adapter delegates and catalogs citations', async () => {
  const aiAdapter = new MockAIServiceAdapter();
  const assistant = new ContextAssistant({ aiAdapter });

  const docText = 'Paragraph 1 introduces the premise of reflection.';
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-1',
      content: 'Historical thought note.',
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    },
  ];

  const result = await assistant.query('What is the core thesis?', docText, notes);
  assert.strictEqual(result.query, 'What is the core thesis?');
  assert.ok(result.response.includes('[¶1]'));
  assert.ok(result.response.includes('[Note:p-1]'));
  assert.ok(result.citedParagraphs.includes('[¶1]'));
  assert.ok(result.citedNotes.includes('[Note:p-1]'));
});

test('ContextAssistant: synthesizeOfflineAnswer provides deterministic keyword matching', () => {
  const assistant = new ContextAssistant();
  const docText = 'This chapter examines the migration across the mountain pass.\n\nAnother chapter looks at seasonal farming.';
  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-pass',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-1',
      content: 'Archival sources show winter pass migration data.',
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    },
  ];

  const answer = assistant.synthesizeOfflineAnswer('Tell me about the migration pass', docText, notes);
  assert.ok(answer.includes('[¶1]'), 'Should cite paragraph 1 containing migration pass');
  assert.ok(answer.includes('[Note:p-1]'), 'Should cite note containing migration pass');
});

test('ContextAssistant: formatAnswerHtml converts citations to interactive pill buttons', () => {
  const assistant = new ContextAssistant();
  const answer = {
    query: 'test',
    response: 'The thesis is in [¶2]. See also [Note:p-3].',
    citedParagraphs: ['[¶2]'],
    citedNotes: ['[Note:p-3]'],
    timestamp: Date.now(),
  };

  const html = assistant.formatAnswerHtml(answer);
  assert.ok(html.includes('class="citation-pill citation-paragraph" data-para-index="2"'));
  assert.ok(html.includes('class="citation-pill citation-note" data-note-anchor="p-3"'));
  assert.ok(html.includes('[¶2]'));
  assert.ok(html.includes('[Note:p-3]'));
});

test('ContextAssistant: bindCitationClickHandlers dispatches to navigation callbacks', () => {
  const win = new Window();
  const doc = win.document;

  let navigatedParagraph = -1;
  let navigatedAnchor = '';

  const assistant = new ContextAssistant({
    onNavigateParagraph: (idx) => {
      navigatedParagraph = idx;
    },
    onNavigateNote: (anchor) => {
      navigatedAnchor = anchor;
    },
  });

  const container = doc.createElement('div');
  container.innerHTML = `
    <button class="citation-pill citation-paragraph" data-para-index="3">[¶3]</button>
    <button class="citation-pill citation-note" data-note-anchor="note-anchor-42">[Note:note-anchor-42]</button>
  `;
  doc.body.appendChild(container);

  assistant.bindCitationClickHandlers(container as any);

  const paraBtn = container.querySelector('.citation-paragraph') as unknown as HTMLElement;
  const noteBtn = container.querySelector('.citation-note') as unknown as HTMLElement;

  paraBtn.click();
  assert.strictEqual(navigatedParagraph, 3);

  noteBtn.click();
  assert.strictEqual(navigatedAnchor, 'note-anchor-42');
});
