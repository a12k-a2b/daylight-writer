/**
 * src/ai/agent-collaborator.ts
 * Daylight Writer - AI Agent Co-Writer & CRDT Collaborator
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Sol:OS 8-bit Grayscale Tokens (--os-0 to --os-1000)
 */

import * as Y from 'yjs';
import type { CollaboratorUser } from '../editor/tiptap-collaboration.ts';

export type AIAgentRole = 'copilot' | 'critic' | 'researcher';
export type AIAgentStatus = 'idle' | 'thinking' | 'streaming' | 'reviewing';

export interface AIAgentOptions {
  name?: string;
  role?: AIAgentRole;
  color?: string;
  awareness?: any;
}

export interface ProposedThoughtNote {
  id: string;
  paragraphId: string;
  text: string;
  createdAt: number;
}

export class AIAgentCollaborator {
  public name: string;
  public role: AIAgentRole;
  public color: string;
  public status: AIAgentStatus = 'idle';
  public clientId: number;
  private awareness: any;

  constructor(options: AIAgentOptions = {}) {
    this.name = options.name || 'Daylight AI Agent';
    this.role = options.role || 'copilot';
    // Sol:OS calibrated Amber-Gray for AI presence
    this.color = options.color || '#9D9D9E';
    this.clientId = Math.floor(Math.random() * 900000 + 100000);
    this.awareness = options.awareness || null;

    this.updatePresence();
  }

  public setAwareness(awareness: any): void {
    this.awareness = awareness;
    this.updatePresence();
  }

  public updatePresence(cursorPos?: { anchor: number; head: number }): void {
    if (!this.awareness) return;

    const user: CollaboratorUser = {
      name: this.name,
      color: this.color,
      initials: 'AI',
      clientId: this.clientId,
    };

    this.awareness.setLocalStateField('user', user);
    this.awareness.setLocalStateField('agentRole', this.role);
    this.awareness.setLocalStateField('agentStatus', this.status);

    if (cursorPos) {
      this.awareness.setLocalStateField('cursor', {
        anchor: cursorPos.anchor,
        head: cursorPos.head,
      });
    }
  }

  /**
   * Stream text tokens into a shared Y.Text or ProseMirror fragment concurrently.
   * Does not lock the document; human collaborator can type simultaneously.
   */
  public async streamTextToYText(
    ytext: Y.Text,
    startOffset: number,
    tokens: string[],
    chunkDelayMs = 15
  ): Promise<number> {
    this.status = 'streaming';
    const isAppend = startOffset === -1 || startOffset >= ytext.length;
    let currentOffset = isAppend ? ytext.length : startOffset;
    this.updatePresence({ anchor: currentOffset, head: currentOffset });

    for (const token of tokens) {
      ytext.doc?.transact(() => {
        const insertPos = isAppend ? ytext.length : currentOffset;
        ytext.insert(insertPos, token);
        currentOffset = insertPos + token.length;
      }, this);

      this.updatePresence({ anchor: currentOffset, head: currentOffset });

      if (chunkDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      }
    }

    this.status = 'idle';
    this.updatePresence();
    return currentOffset;
  }

  /**
   * Deposit an AI thought note linked to the active paragraph into the shared notes map
   */
  public depositThoughtNote(
    ydoc: Y.Doc,
    paragraphId: string,
    noteText: string
  ): ProposedThoughtNote {
    const notesMap = ydoc.getMap<ProposedThoughtNote>('daylight_thought_notes');
    const noteId = `ai-note-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const note: ProposedThoughtNote = {
      id: noteId,
      paragraphId,
      text: noteText,
      createdAt: Date.now(),
    };

    ydoc.transact(() => {
      notesMap.set(noteId, note);
    }, this);

    return note;
  }

  /**
   * Format and deposit a tracked suggestion for human review
   */
  public depositTrackedSuggestion(
    ydoc: Y.Doc,
    originalRange: { from: number; to: number },
    replacementText: string,
    rationale: string
  ): string {
    const suggestionsMap = ydoc.getMap('daylight_ai_suggestions');
    const suggestionId = `sugg-${Date.now()}`;

    ydoc.transact(() => {
      suggestionsMap.set(suggestionId, {
        id: suggestionId,
        from: originalRange.from,
        to: originalRange.to,
        replacement: replacementText,
        rationale,
        author: this.name,
        timestamp: Date.now(),
        status: 'pending',
      });
    }, this);

    return suggestionId;
  }
}
