/**
 * tests/unit/hocuspocus-ai-agent.test.ts
 * Daylight Writer - Hocuspocus 4 CRDT Server & AI Agent Collaborator Tests
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
// @ts-ignore
import ws from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { DaylightHocuspocusServer } from '../../src/sync/hocuspocus-server.ts';
import { AIAgentCollaborator } from '../../src/ai/agent-collaborator.ts';

describe('Hocuspocus 4 & AI Agent CRDT Collaboration', () => {
  let server: DaylightHocuspocusServer;
  let serverWsUrl: string;

  const waitForSync = (provider: HocuspocusProvider): Promise<void> => {
    if (provider.synced) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const handler = (data: { state: boolean }) => {
        if (data && data.state) {
          provider.off('synced', handler);
          resolve();
        }
      };
      provider.on('synced', handler);
    });
  };

  before(async () => {
    // Start embedded Hocuspocus 4 server on random dynamic port
    server = new DaylightHocuspocusServer({ port: 0, quiet: true });
    serverWsUrl = await server.start();
    assert.ok(serverWsUrl.startsWith('ws://'), `Expected ws:// URL, got ${serverWsUrl}`);
  });

  after(async () => {
    await server.stop();
  });

  test('Hocuspocus Server: starts, binds, and stores document snapshots', async () => {
    const docName = 'test-persistence-doc';
    const testDoc = new Y.Doc();
    testDoc.getText('content').insert(0, 'Initial server document state');

    server.setStoredSnapshot(docName, Y.encodeStateAsUpdate(testDoc));
    const retrieved = server.getStoredSnapshot(docName);
    assert.ok(retrieved);
    assert.ok(retrieved.byteLength > 0);

    testDoc.destroy();
  });

  test('Human Writer + AI Agent: concurrent real-time editing via Hocuspocus converges cleanly', async () => {
    const roomName = 'collab-ai-human-room';

    // 1. Setup Human Writer Client
    const humanDoc = new Y.Doc();
    const humanProvider = new HocuspocusProvider({
      url: serverWsUrl,
      WebSocketPolyfill: ws,
      name: roomName,
      document: humanDoc,
    } as any);

    // 2. Setup AI Agent Client
    const aiDoc = new Y.Doc();
    const aiProvider = new HocuspocusProvider({
      url: serverWsUrl,
      WebSocketPolyfill: ws,
      name: roomName,
      document: aiDoc,
    } as any);

    // 3. Wait for both clients to connect and sync
    await Promise.all([
      waitForSync(humanProvider),
      waitForSync(aiProvider),
    ]);

    // 4. Attach AI Agent Collaborator
    const aiAgent = new AIAgentCollaborator({
      name: 'Daylight AI Agent',
      role: 'copilot',
      awareness: aiProvider.awareness,
    });

    const humanText = humanDoc.getText('prosemirror_text');
    const aiText = aiDoc.getText('prosemirror_text');

    const waitForCondition = async (predicate: () => boolean, timeoutMs = 1500): Promise<void> => {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`Condition timed out. Current state: human='${humanText.toString()}', ai='${aiText.toString()}'`);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    // 5. Initial state from human
    humanText.insert(0, 'Chapter 1: The reflective screen. ');
    await waitForCondition(() => aiText.toString() === 'Chapter 1: The reflective screen. ');

    // 6. CONCURRENT WRITES:
    // Human types at the beginning: prepends "[Title: Dawn] "
    // AI Agent streams tokens at the end concurrently: "Ambient sunlight illuminates each letter."
    const humanPromise = (async () => {
      humanText.insert(0, '[Title: Dawn] ');
    })();

    const aiTokens = ['Ambient ', 'sunlight ', 'illuminates ', 'each ', 'letter.'];
    const aiPromise = aiAgent.streamTextToYText(aiText, aiText.length, aiTokens, 5);

    await Promise.all([humanPromise, aiPromise]);

    // Wait for both sides to converge
    await waitForCondition(() => humanText.toString() === aiText.toString() && humanText.toString().includes('Ambient sunlight illuminates each letter.'));

    // 7. Verify converged text structure
    assert.equal(humanText.toString(), aiText.toString());
    assert.ok(humanText.toString().startsWith('[Title: Dawn] '));
    assert.ok(humanText.toString().includes('Chapter 1: The reflective screen. '));
    assert.ok(humanText.toString().includes('Ambient sunlight illuminates each letter.'));

    // Teardown providers
    humanProvider.destroy();
    aiProvider.destroy();
    humanDoc.destroy();
    aiDoc.destroy();
  });

  test('AI Agent Awareness & Presence: broadcasts Sol:OS identity and cursor', async () => {
    const roomName = 'collab-awareness-room';

    const humanDoc = new Y.Doc();
    const humanProvider = new HocuspocusProvider({
      url: serverWsUrl,
      WebSocketPolyfill: ws,
      name: roomName,
      document: humanDoc,
    } as any);

    const aiDoc = new Y.Doc();
    const aiProvider = new HocuspocusProvider({
      url: serverWsUrl,
      WebSocketPolyfill: ws,
      name: roomName,
      document: aiDoc,
    } as any);

    await Promise.all([
      waitForSync(humanProvider),
      waitForSync(aiProvider),
    ]);

    const aiAgent = new AIAgentCollaborator({
      name: 'Daylight AI Agent',
      role: 'critic',
      color: '#9D9D9E',
      awareness: aiProvider.awareness,
    });

    // Update presence with cursor position
    aiAgent.updatePresence({ anchor: 42, head: 42 });

    // Wait for awareness propagation
    await new Promise((r) => setTimeout(r, 60));

    // Check human's view of awareness states
    const states = humanProvider.awareness?.getStates() || new Map();
    let foundAIAgent = false;

    states.forEach((state: any) => {
      if (state.user && state.user.name === 'Daylight AI Agent') {
        foundAIAgent = true;
        assert.equal(state.user.color, '#9D9D9E');
        assert.equal(state.user.initials, 'AI');
        assert.equal(state.agentRole, 'critic');
        assert.equal(state.cursor.anchor, 42);
      }
    });

    assert.ok(foundAIAgent, 'Human provider must see AI Agent in awareness states');

    humanProvider.destroy();
    aiProvider.destroy();
    humanDoc.destroy();
    aiDoc.destroy();
  });

  test('AI Agent: deposits thought notes and tracked suggestions into shared CRDT state', () => {
    const doc = new Y.Doc();
    const agent = new AIAgentCollaborator({
      name: 'Daylight AI Critic',
      role: 'critic',
    });

    // Deposit margin thought note
    const note = agent.depositThoughtNote(
      doc,
      'p-0',
      'Consider simplifying the opening clause for stronger impact on the reader.'
    );

    assert.ok(note.id.startsWith('ai-note-'));
    assert.equal(note.paragraphId, 'p-0');

    const notesMap = doc.getMap('daylight_thought_notes');
    const storedNote: any = notesMap.get(note.id);
    assert.ok(storedNote);
    assert.equal(storedNote.text, note.text);

    // Deposit tracked suggestion
    const suggId = agent.depositTrackedSuggestion(
      doc,
      { from: 10, to: 25 },
      'crisp sunlight',
      'More vivid imagery'
    );

    assert.ok(suggId.startsWith('sugg-'));
    const suggestionsMap = doc.getMap('daylight_ai_suggestions');
    const storedSugg: any = suggestionsMap.get(suggId);
    assert.ok(storedSugg);
    assert.equal(storedSugg.replacement, 'crisp sunlight');
    assert.equal(storedSugg.author, 'Daylight AI Critic');

    doc.destroy();
  });
});
