/**
 * src/ai/context-assistant.ts
 * Daylight Writer - Context-Aware Query Assistant
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display (1584×1184 landscape)
 * Queries document paragraphs + linked margin thought notes with strict citation synthesis
 * Features: F51 (Query Assistant), F52/F53 (AIServiceAdapter Integration)
 */

import type { ThoughtNoteRecord } from '../storage/schema.ts';
import type { AIServiceAdapter } from './service-adapter.ts';

export interface IndexedParagraph {
  index: number; // 1-based paragraph number
  label: string; // e.g. "[¶1]"
  text: string;
}

export interface IndexedThoughtNote {
  id: string;
  paragraphAnchorId: string; // e.g. "p-1" or "¶3"
  label: string; // e.g. "[Note:p-1]" or "[Note:¶3]"
  content: string;
}

export interface AssistantAnswer {
  query: string;
  response: string;
  citedParagraphs: string[]; // e.g. ["[¶1]"]
  citedNotes: string[]; // e.g. ["[Note:p-1]"]
  timestamp: number;
}

export interface ContextAssistantOptions {
  aiAdapter?: AIServiceAdapter;
  onNavigateParagraph?: (paragraphIndex: number) => void;
  onNavigateNote?: (anchorId: string) => void;
}

export class ContextAssistant {
  public aiAdapter?: AIServiceAdapter;
  public onNavigateParagraph?: (paragraphIndex: number) => void;
  public onNavigateNote?: (anchorId: string) => void;

  constructor(options: ContextAssistantOptions = {}) {
    this.aiAdapter = options.aiAdapter;
    this.onNavigateParagraph = options.onNavigateParagraph;
    this.onNavigateNote = options.onNavigateNote;
  }

  // --------------------------------------------------------------------------
  // 1. Corpus Parsing & Indexing
  // --------------------------------------------------------------------------

  public indexDocument(documentText: string): IndexedParagraph[] {
    const rawParagraphs = documentText
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    return rawParagraphs.map((paraText, i) => {
      const idx = i + 1;
      // Preserve explicit paragraph tags if present (e.g. "[¶1] Text")
      const match = paraText.match(/^\[(¶\d+)\]\s*(.*)$/);
      if (match) {
        return {
          index: idx,
          label: `[${match[1]}]`,
          text: match[2],
        };
      }
      return {
        index: idx,
        label: `[¶${idx}]`,
        text: paraText,
      };
    });
  }

  public indexNotes(notes: ThoughtNoteRecord[]): IndexedThoughtNote[] {
    return notes
      .filter((n) => n.deleted_at === null)
      .map((note) => ({
        id: note.id,
        paragraphAnchorId: note.paragraph_anchor_id,
        label: `[Note:${note.paragraph_anchor_id}]`,
        content: note.content,
      }));
  }

  // --------------------------------------------------------------------------
  // 2. Query Execution & Citation Synthesis (F51)
  // --------------------------------------------------------------------------

  public async query(
    prompt: string,
    documentText: string,
    notes: ThoughtNoteRecord[] = []
  ): Promise<AssistantAnswer> {
    // 1. Delegate to pluggable AIServiceAdapter if available
    let responseText = '';
    if (this.aiAdapter) {
      responseText = await this.aiAdapter.queryContext(prompt, documentText, notes);
    } else {
      // 2. Autonomous Local Offline Heuristic Fallback
      responseText = this.synthesizeOfflineAnswer(prompt, documentText, notes);
    }

    // 3. Extract and catalog citations
    const paraCitations = Array.from(responseText.matchAll(/\[(¶\d+)\]/g)).map((m) => m[0]);
    const noteCitations = Array.from(responseText.matchAll(/\[Note:([^\]]+)\]/g)).map((m) => m[0]);

    return {
      query: prompt,
      response: responseText,
      citedParagraphs: Array.from(new Set(paraCitations)),
      citedNotes: Array.from(new Set(noteCitations)),
      timestamp: Date.now(),
    };
  }

  /**
   * Deterministic local offline synthesizer for zero-network resilience
   */
  public synthesizeOfflineAnswer(
    prompt: string,
    documentText: string,
    notes: ThoughtNoteRecord[] = []
  ): string {
    const indexedParas = this.indexDocument(documentText);
    const indexedNotes = this.indexNotes(notes);

    const queryLower = prompt.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    // Score paragraphs
    const scoredParas = indexedParas
      .map((p) => {
        let score = 0;
        for (const w of queryWords) {
          if (p.text.toLowerCase().includes(w)) score += 2;
        }
        return { p, score };
      })
      .sort((a, b) => b.score - a.score);

    // Score notes
    const scoredNotes = indexedNotes
      .map((n) => {
        let score = 0;
        for (const w of queryWords) {
          if (n.content.toLowerCase().includes(w)) score += 3;
        }
        return { n, score };
      })
      .sort((a, b) => b.score - a.score);

    const topPara = scoredParas[0]?.p || indexedParas[0];
    const topNote = scoredNotes[0]?.n || indexedNotes[0];

    const noteCitation = topNote ? ` Referenced margin note: ${topNote.label}.` : '';
    const paraCitation = topPara ? `${topPara.label}` : '[¶1]';

    return `In response to "${prompt}": The core thesis is established in ${paraCitation}.${noteCitation}`;
  }

  // --------------------------------------------------------------------------
  // 3. Interactive Citation Rendering & Navigation
  // --------------------------------------------------------------------------

  public formatAnswerHtml(answer: AssistantAnswer): string {
    let html = escapeHtml(answer.response);

    // Convert [¶N] into interactive buttons
    html = html.replace(/\[(¶\d+)\]/g, (_match, pLabel) => {
      const pNum = pLabel.replace('¶', '');
      return `<button class="citation-pill citation-paragraph" data-para-index="${pNum}">[¶${pNum}]</button>`;
    });

    // Convert [Note:anchor] into interactive buttons
    html = html.replace(/\[Note:([^\]]+)\]/g, (_match, anchor) => {
      return `<button class="citation-pill citation-note" data-note-anchor="${anchor}">[Note:${anchor}]</button>`;
    });

    return html;
  }

  public bindCitationClickHandlers(container: HTMLElement): void {
    container.querySelectorAll('.citation-paragraph').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const pNum = Number((btn as HTMLElement).dataset.paraIndex);
        if (this.onNavigateParagraph && !isNaN(pNum)) {
          this.onNavigateParagraph(pNum);
        }
      });
    });

    container.querySelectorAll('.citation-note').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const anchor = (btn as HTMLElement).dataset.noteAnchor;
        if (this.onNavigateNote && anchor) {
          this.onNavigateNote(anchor);
        }
      });
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
