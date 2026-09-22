/**
 * tests/unit/tiptap-collaboration.test.ts
 * Daylight Writer - TipTap & Yjs Live Collaboration Unit Tests
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import * as Y from 'yjs';
import {
  CollaborationManager,
  SOL_OS_PEER_COLORS,
} from '../../src/editor/tiptap-collaboration.ts';
import { TipTapTypewriterEngine } from '../../src/editor/tiptap-editor.ts';
import { CollaborationModal } from '../../src/ui/collaboration-modal.ts';

describe('TipTap & Yjs Live Collaboration Engine', () => {
  let win: InstanceType<typeof Window>;
  let prevWindow: any;
  let prevDocument: any;
  let prevRaf: any;
  let prevCaf: any;

  beforeEach(() => {
    win = new Window();
    prevWindow = (globalThis as any).window;
    prevDocument = (globalThis as any).document;
    prevRaf = (globalThis as any).requestAnimationFrame;
    prevCaf = (globalThis as any).cancelAnimationFrame;

    (globalThis as any).window = win;
    (globalThis as any).document = win.document;
    (globalThis as any).HTMLElement = win.HTMLElement;
    (globalThis as any).HTMLInputElement = win.HTMLInputElement;
    (globalThis as any).KeyboardEvent = win.KeyboardEvent;
    (globalThis as any).CustomEvent = win.CustomEvent;
    (globalThis as any).Node = win.Node;
    (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  });

  afterEach(() => {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).requestAnimationFrame = prevRaf;
    (globalThis as any).cancelAnimationFrame = prevCaf;
  });

  test('CollaborationManager: initializes with Sol:OS calibrated grayscale tokens', () => {
    const manager = new CollaborationManager({
      documentId: 'doc-test-123',
      user: { name: 'Daylight Author' },
    });

    assert.equal(manager.documentId, 'doc-test-123');
    assert.equal(manager.roomName, 'daylight-writer-doc-test-123');
    assert.equal(manager.activeProviderType, 'offline');
    assert.equal(manager.localUser.name, 'Daylight Author');
    assert.equal(manager.localUser.initials, 'DA');
    assert.ok(SOL_OS_PEER_COLORS.includes(manager.localUser.color));

    manager.destroy();
  });

  test('CollaborationManager: updates user identity and notifies awareness', () => {
    const manager = new CollaborationManager({
      documentId: 'doc-456',
    });

    manager.setLocalUser({ name: 'SolOS Writer', color: '#1A1A1A' });
    assert.equal(manager.localUser.name, 'SolOS Writer');
    assert.equal(manager.localUser.color, '#1A1A1A');
    assert.equal(manager.localUser.initials, 'SW');

    manager.destroy();
  });

  test('CollaborationManager: binary snapshot and multi-client CRDT convergence', () => {
    const clientA = new CollaborationManager({ documentId: 'doc-sync' });
    const clientB = new CollaborationManager({ documentId: 'doc-sync' });

    // Client A writes initial text
    const textA = clientA.ydoc.getText('content');
    textA.insert(0, 'Hello from Daylight DC1');

    // Exchange binary CRDT update with Client B
    const updateA = clientA.getBinarySnapshot();
    assert.ok(updateA.byteLength > 0);

    clientB.applyBinaryUpdate(updateA);
    const textB = clientB.ydoc.getText('content');
    assert.equal(textB.toString(), 'Hello from Daylight DC1');

    // Concurrent offline editing: Client A inserts at end, Client B inserts at start
    textA.insert(textA.length, ' - offline note');
    textB.insert(0, '[Draft] ');

    // Merge updates bidirectionally
    const deltaA = Y.encodeStateAsUpdate(clientA.ydoc, clientB.getStateVector());
    const deltaB = Y.encodeStateAsUpdate(clientB.ydoc, clientA.getStateVector());

    clientB.applyBinaryUpdate(deltaA);
    clientA.applyBinaryUpdate(deltaB);

    // Both clients mathematically converge to the exact same text
    assert.equal(textA.toString(), textB.toString());
    assert.ok(textA.toString().includes('[Draft]'));
    assert.ok(textA.toString().includes('offline note'));

    clientA.destroy();
    clientB.destroy();
  });

  test('TipTapTypewriterEngine: mounts with StarterKit and assigns block IDs for margin sync', () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);

    const engine = new TipTapTypewriterEngine({
      element: container as unknown as HTMLElement,
      content: '<p>The opening sentence on LivePaper.</p><h2>Section Headline</h2>',
    });

    assert.ok(engine.editor);
    const text = engine.getContent();
    assert.ok(text.includes('The opening sentence on LivePaper.'));
    assert.ok(text.includes('Section Headline'));

    // Verify rich-text commands
    const canBold = engine.toggleBold();
    assert.equal(typeof canBold, 'boolean');

    // Verify paragraph blocks for margin note coordinate sync
    const blocks = engine.getParagraphBlocks();
    assert.ok(blocks.length >= 1);

    engine.destroy();
  });

  test('CollaborationModal: opens, renders room code, updates peers, and handles dismissal', () => {
    const container = win.document.body as unknown as HTMLElement;
    const manager = new CollaborationManager({
      documentId: 'doc-modal-test',
      user: { name: 'Local Author' },
    });

    let closed = false;
    const modal = new CollaborationModal({
      container,
      manager,
      onClose: () => {
        closed = true;
      },
    });

    modal.open();
    const modalEl = container.querySelector('.collab-modal');
    assert.ok(modalEl);

    const roomInput = modalEl.querySelector('#collab-room-input') as HTMLInputElement;
    assert.equal(roomInput.value, 'daylight-writer-doc-modal-test');

    // Update peers
    modal.updatePeers([
      {
        clientId: 42,
        user: { name: 'Remote Reviewer', color: '#858585' },
      },
    ]);

    const peerCount = modalEl.querySelector('#collab-peer-count');
    assert.equal(peerCount?.textContent, '1');
    const peerName = modalEl.querySelector('.collab-peer-name');
    assert.equal(peerName?.textContent, 'Remote Reviewer');

    // Test Escape key dismissal
    const escEvent = new (win.KeyboardEvent as any)('keydown', { key: 'Escape' });
    win.document.dispatchEvent(escEvent);

    assert.equal(closed, true);
    assert.equal(container.querySelector('.collab-modal'), null);

    manager.destroy();
  });
});
