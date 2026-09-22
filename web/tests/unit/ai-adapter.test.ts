/**
 * tests/unit/ai-adapter.test.ts
 * Unit test suite for AIServiceAdapter contract and MockAIServiceAdapter implementation (F52, F53)
 */

import test from 'node:test';
import assert from 'node:assert';
import { MockAIServiceAdapter } from '../../src/ai/mock-adapter.ts';
import type { AIContinuationOptions, AITransformOptions, AIContext } from '../../src/ai/service-adapter.ts';
import type { ThoughtNoteRecord } from '../../src/storage/schema.ts';

test('AIAdapter: complete returns full continuation text', async () => {
  const adapter = new MockAIServiceAdapter({
    cannedContinuationText: 'the quiet amber light glows softly.',
  });

  const options: AIContinuationOptions = {
    documentText: 'At dawn,',
    cursorOffset: 8,
  };

  const result = await adapter.complete(options);
  assert.strictEqual(result, ' the quiet amber light glows softly.');
  assert.strictEqual(adapter.callLog.length, 1);
  assert.strictEqual(adapter.callLog[0].method, 'complete');
});

test('AIAdapter: streamCompletion delivers word chunks incrementally', async () => {
  const adapter = new MockAIServiceAdapter({
    cannedContinuationText: 'deliberate quietude settles.',
  });

  const chunks: string[] = [];
  const full = await adapter.streamCompletion(
    { documentText: 'In silence,', cursorOffset: 11 },
    (chunk) => chunks.push(chunk)
  );

  assert.strictEqual(chunks.length, 3);
  assert.strictEqual(chunks[0], ' deliberate');
  assert.strictEqual(chunks[1], ' quietude');
  assert.strictEqual(chunks[2], ' settles.');
  assert.strictEqual(chunks.join(''), full);
});

test('AIAdapter: streamContinuation alias functions identically to streamCompletion', async () => {
  const adapter = new MockAIServiceAdapter({
    cannedContinuationText: 'ink meets paper.',
  });

  const chunks: string[] = [];
  const full = await adapter.streamContinuation(
    { documentText: 'As', cursorOffset: 2 },
    (chunk) => chunks.push(chunk)
  );

  assert.strictEqual(chunks.join(''), full);
  assert.ok(full.includes('ink meets paper'));
});

test('AIAdapter: streamCompletion respects AbortSignal', async () => {
  const adapter = new MockAIServiceAdapter({
    simulatedDelayMs: 20,
    cannedContinuationText: 'one two three four five six seven eight',
  });

  const controller = new AbortController();
  const chunks: string[] = [];

  // Abort after first chunk arrives
  const streamPromise = adapter.streamCompletion(
    {
      documentText: 'Start:',
      cursorOffset: 6,
      signal: controller.signal,
    },
    (chunk) => {
      chunks.push(chunk);
      if (chunks.length === 2) {
        controller.abort();
      }
    }
  );

  const result = await streamPromise;
  assert.ok(chunks.length >= 2 && chunks.length < 8, 'Should abort before all 8 words finish');
  assert.strictEqual(result, chunks.join(''));
});

test('AIAdapter: Pre-aborted signal returns empty string immediately', async () => {
  const adapter = new MockAIServiceAdapter({
    cannedContinuationText: 'should not stream',
  });

  const controller = new AbortController();
  controller.abort();

  const chunks: string[] = [];
  const result = await adapter.streamCompletion(
    { documentText: '', cursorOffset: 0, signal: controller.signal },
    (c) => chunks.push(c)
  );

  assert.strictEqual(result, '');
  assert.strictEqual(chunks.length, 0);
});

test('AIAdapter: shouldFail flag throws on all endpoints', async () => {
  const adapter = new MockAIServiceAdapter({
    shouldFail: true,
    errorMessage: 'Simulated Network Disconnect',
  });

  await assert.rejects(
    async () => adapter.complete({ documentText: '', cursorOffset: 0 }),
    /Simulated Network Disconnect/
  );

  await assert.rejects(
    async () => adapter.streamCompletion({ documentText: '', cursorOffset: 0 }, () => {}),
    /Simulated Network Disconnect/
  );

  await assert.rejects(
    async () => adapter.transformText({ selectedText: 'text', instruction: 'summarize' }),
    /Simulated Network Disconnect/
  );

  await assert.rejects(
    async () => adapter.critiqueText('text'),
    /Simulated Network Disconnect/
  );

  await assert.rejects(
    async () => adapter.queryContext('prompt', 'docText'),
    /Simulated Network Disconnect/
  );
});

test('AIAdapter: transformText covers all standard instructions', async () => {
  const adapter = new MockAIServiceAdapter();

  // 1. Summarize
  const sum = await adapter.transformText({
    selectedText: 'A long paragraph with rich historical analysis and observations.',
    instruction: 'summarize',
  });
  assert.ok(sum.startsWith('Summary:'));

  // 2. Expand
  const exp = await adapter.transformText({
    selectedText: 'Solitude inspires clarity.',
    instruction: 'expand',
  });
  assert.ok(exp.includes('core thesis') || exp.includes('profound'));

  // 3. Concise
  const conc = await adapter.transformText({
    selectedText: 'It was very really quite extremely beautiful.',
    instruction: 'concise',
  });
  assert.strictEqual(conc.trim(), 'It was beautiful.');

  // 4. Poetic
  const poet = await adapter.transformText({
    selectedText: 'The sky is clear.',
    instruction: 'poetic',
  });
  assert.ok(poet.includes('amber light'));

  // 5. Analytical
  const ana = await adapter.transformText({
    selectedText: 'The data suggests change.',
    instruction: 'analytical',
  });
  assert.ok(ana.includes('Empirical observation'));

  // 6. Casual
  const cas = await adapter.transformText({
    selectedText: 'The hypothesis failed.',
    instruction: 'casual',
  });
  assert.ok(cas.startsWith('Basically,'));

  // 7. Fix Grammar
  const gram = await adapter.transformText({
    selectedText: 'The the essay was written by the student.',
    instruction: 'fix_grammar',
  });
  assert.strictEqual(gram, 'The essay wrote the student.');

  // 8. Custom Prompt
  const cust = await adapter.transformText({
    selectedText: 'Draft prose.',
    instruction: 'custom',
    customPrompt: 'make it urgent',
  });
  assert.ok(cust.includes('make it urgent'));
});

test('AIAdapter: cannedTransforms override mechanism works', async () => {
  const adapter = new MockAIServiceAdapter();
  adapter.cannedTransforms['poetic'] = (text) => `*** ${text.toUpperCase()} ***`;

  const transformed = await adapter.transformText({
    selectedText: 'quiet morning',
    instruction: 'poetic',
  });

  assert.strictEqual(transformed, '*** QUIET MORNING ***');
});

test('AIAdapter: critiqueText flags passive voice, repetition, and clarity', async () => {
  const adapter = new MockAIServiceAdapter();
  const text = 'The letter was written in order to explain repetition the the issue.';

  const checks = await adapter.critiqueText(text);
  assert.strictEqual(checks.length, 3);

  const pv = checks.find((c) => c.type === 'passive_voice');
  const clr = checks.find((c) => c.type === 'clarity');
  const rep = checks.find((c) => c.type === 'repetition');

  assert.ok(pv, 'Passive voice flagged');
  assert.ok(clr, 'Clarity flagged');
  assert.ok(rep, 'Repetition flagged');
  assert.strictEqual(clr?.suggestion, 'to');
  assert.strictEqual(rep?.suggestion, 'the');
});

test('AIAdapter: queryContext synthesizes answers with [¶1] and [Note:<anchor>]', async () => {
  const adapter = new MockAIServiceAdapter();

  const notes: ThoughtNoteRecord[] = [
    {
      id: 'n-1',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-0',
      content: 'Important thought note.',
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    },
    {
      id: 'n-2',
      document_id: 'doc-1',
      paragraph_anchor_id: 'p-3',
      content: 'Second thought note.',
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    },
  ];

  // Using string and notes array
  const answer1 = await adapter.queryContext('What is the main topic?', 'Some document text', notes);
  assert.ok(answer1.includes('[¶1]'));
  assert.ok(answer1.includes('[Note:p-0]'));
  assert.ok(answer1.includes('[Note:p-3]'));

  // Using AIContext container
  const context: AIContext = {
    documentText: 'Some document text',
    marginNotes: notes,
  };
  const answer2 = await adapter.queryContext('Summarize', context);
  assert.ok(answer2.includes('[¶1]'));
  assert.ok(answer2.includes('[Note:p-0]'));
});
