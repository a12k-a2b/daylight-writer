/**
 * Mock Adapters & Interface Implementations for E2E Testing
 * Implements exact interface contracts from PROJECT.md § Interface Contracts
 */

import type {
  DocumentRecord,
  ThoughtNoteRecord,
  TagRecord,
  StorageRepository,
  OutlineTreeNode,
} from '../../../src/storage/repository.ts';

export type {
  DocumentRecord,
  ThoughtNoteRecord,
  TagRecord,
  StorageRepository,
  OutlineTreeNode,
};

export interface AIContinuationOptions {
  documentText: string;
  cursorOffset: number;
  maxTokens?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
}

export interface AITransformOptions {
  selectedText: string;
  instruction: 'summarize' | 'expand' | 'concise' | 'poetic' | 'analytical' | 'casual' | 'fix_grammar' | 'custom';
  customPrompt?: string;
  surroundingContext?: string;
}

export interface AICritiqueCheck {
  id: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  type: 'passive_voice' | 'repetition' | 'clarity' | 'structure';
  message: string;
  suggestion?: string;
}

export interface AIServiceAdapter {
  streamContinuation(options: AIContinuationOptions, onChunk: (chunk: string) => void): Promise<string>;
  transformText(options: AITransformOptions): Promise<string>;
  runCritiqueChecks(text: string): Promise<AICritiqueCheck[]>;
  queryContext(prompt: string, documentText: string, notes: ThoughtNoteRecord[]): Promise<string>;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt: number | null;
  pendingCount: number;
  error?: string;
}

export interface SyncAdapter {
  init(): Promise<void>;
  sync(): Promise<{ pushedCount: number; pulledCount: number }>;
  getStatus(): SyncStatus;
  resolveConflict(localDoc: DocumentRecord, remoteDoc: DocumentRecord): Promise<DocumentRecord>;
  queueMutation(docId: string, type: 'create' | 'update' | 'delete', payload: any): void;
}

export interface ExportResult {
  filename: string;
  mimeType: string;
  data: Uint8Array | string;
}

export interface ExportService {
  exportToMarkdown(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): ExportResult;
  exportToPlainText(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): ExportResult;
  exportToDocx(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): Promise<ExportResult>;
  exportToPdf(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): Promise<ExportResult>;
  shareDocument(doc: DocumentRecord, format: 'md' | 'txt' | 'docx' | 'pdf'): Promise<boolean>;
  composeEmail(doc: DocumentRecord): { url: string; truncated: boolean };
}

// ==========================================
// In-Memory Implementation of StorageRepository
// ==========================================

export class InMemoryStorageRepository implements StorageRepository {
  private documents: Map<string, DocumentRecord> = new Map();
  private notes: Map<string, ThoughtNoteRecord> = new Map();
  private tags: Map<string, TagRecord> = new Map();
  private docTags: Map<string, Set<string>> = new Map(); // docId -> Set of tag paths
  private pendingEdits: Map<string, DocumentRecord> = new Map();
  public flushCount: number = 0;

  async init(): Promise<void> {
    // Initialized
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const doc = this.pendingEdits.get(id) || this.documents.get(id);
    if (!doc || doc.deleted_at !== null) return null;
    return { ...doc };
  }

  async listDocuments(options?: { sortBy?: 'updated_at' | 'created_at'; sortOrder?: 'asc' | 'desc'; tagId?: string }): Promise<DocumentRecord[]> {
    await this.flushPendingEdits();
    const sortBy = options?.sortBy || 'updated_at';
    const sortOrder = options?.sortOrder || 'desc';
    const tagFilter = options?.tagId;

    let list = Array.from(this.documents.values()).filter((d) => d.deleted_at === null);

    if (tagFilter) {
      list = list.filter((d) => {
        const docTagSet = this.docTags.get(d.id);
        return docTagSet && (docTagSet.has(tagFilter) || Array.from(docTagSet).some(t => t.startsWith(tagFilter + '/')));
      });
    }

    list.sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    return list.map((d) => ({ ...d }));
  }

  async saveDocument(doc: Partial<DocumentRecord> & { id: string }): Promise<DocumentRecord> {
    const now = Date.now();
    const existing = this.pendingEdits.get(doc.id) || this.documents.get(doc.id);
    const fullDoc: DocumentRecord = {
      id: doc.id,
      title: (doc.title && doc.title.trim().length > 0) ? doc.title : (existing?.title ?? 'Untitled'),
      content: doc.content ?? existing?.content ?? '',
      created_at: existing?.created_at ?? doc.created_at ?? now,
      updated_at: doc.updated_at ?? now,
      deleted_at: doc.deleted_at !== undefined ? doc.deleted_at : (existing?.deleted_at ?? null),
      is_title_custom: doc.is_title_custom ?? existing?.is_title_custom ?? false,
      format_version: doc.format_version ?? existing?.format_version ?? 1,
      sync_status: doc.sync_status ?? 'pending',
      parent_id: doc.parent_id !== undefined ? doc.parent_id : (existing?.parent_id ?? null),
      sort_order: doc.sort_order !== undefined ? doc.sort_order : (existing?.sort_order ?? 0),
      synopsis: doc.synopsis !== undefined ? doc.synopsis : (existing?.synopsis ?? ''),
      item_type: doc.item_type !== undefined ? doc.item_type : (existing?.item_type ?? 'document'),
    };

    // Reactive write: available immediately
    this.pendingEdits.set(doc.id, fullDoc);
    return { ...fullDoc };
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (doc) {
      doc.deleted_at = Date.now();
      doc.sync_status = 'pending';
      this.pendingEdits.set(id, doc);
    }
  }

  async flushPendingEdits(): Promise<void> {
    for (const [id, doc] of this.pendingEdits.entries()) {
      this.documents.set(id, { ...doc });
    }
    this.pendingEdits.clear();
    this.flushCount++;
  }

  async getNotesForDocument(documentId: string): Promise<ThoughtNoteRecord[]> {
    return Array.from(this.notes.values())
      .filter((n) => n.document_id === documentId && n.deleted_at === null)
      .map((n) => ({ ...n }));
  }

  async saveNote(note: Partial<ThoughtNoteRecord> & { id: string; document_id: string; paragraph_anchor_id: string }): Promise<ThoughtNoteRecord> {
    const now = Date.now();
    const existing = this.notes.get(note.id);
    const fullNote: ThoughtNoteRecord = {
      id: note.id,
      document_id: note.document_id,
      paragraph_anchor_id: note.paragraph_anchor_id,
      content: note.content ?? existing?.content ?? '',
      created_at: existing?.created_at ?? note.created_at ?? now,
      updated_at: note.updated_at ?? now,
      deleted_at: note.deleted_at !== undefined ? note.deleted_at : (existing?.deleted_at ?? null),
    };
    this.notes.set(note.id, fullNote);
    return { ...fullNote };
  }

  async deleteNote(id: string): Promise<void> {
    const note = this.notes.get(id);
    if (note) {
      note.deleted_at = Date.now();
      this.notes.set(id, note);
    }
  }

  async searchDocuments(query: string): Promise<Array<{ document: DocumentRecord; score: number; matchHighlights: string[] }>> {
    await this.flushPendingEdits();
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const results: Array<{ document: DocumentRecord; score: number; matchHighlights: string[] }> = [];

    for (const doc of this.documents.values()) {
      if (doc.deleted_at !== null) continue;
      let score = 0;
      const highlights: string[] = [];

      // Title match (weight 10)
      if (doc.title.toLowerCase().includes(q)) {
        score += 10;
        highlights.push(`Title: ${escapeHtml(doc.title)}`);
      }

      // Tag match (weight 8)
      const tags = this.docTags.get(doc.id);
      if (tags) {
        for (const t of tags) {
          if (t.toLowerCase().includes(q)) {
            score += 8;
            highlights.push(`Tag: #${escapeHtml(t)}`);
          }
        }
      }

      // Body match (weight 5)
      if (doc.content.toLowerCase().includes(q)) {
        score += 5;
        const idx = doc.content.toLowerCase().indexOf(q);
        const snippetStart = Math.max(0, idx - 20);
        const snippetEnd = Math.min(doc.content.length, idx + q.length + 20);
        highlights.push(`...${escapeHtml(doc.content.slice(snippetStart, snippetEnd))}...`);
      }

      if (score > 0) {
        results.push({ document: { ...doc }, score, matchHighlights: highlights });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  async getTags(): Promise<TagRecord[]> {
    return Array.from(this.tags.values()).map((t) => ({ ...t }));
  }

  async setDocumentTags(documentId: string, tagPaths: string[]): Promise<void> {
    const tagSet = new Set<string>();
    for (const path of tagPaths) {
      const cleanPath = path.startsWith('#') ? path.slice(1) : path;
      tagSet.add(cleanPath);
      if (!this.tags.has(cleanPath)) {
        const parts = cleanPath.split('/');
        this.tags.set(cleanPath, {
          id: `tag-${cleanPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
          name: parts[parts.length - 1],
          path: cleanPath,
          created_at: Date.now(),
        });
      }
    }
    this.docTags.set(documentId, tagSet);
  }

  async getOutlineTree(): Promise<OutlineTreeNode[]> {
    await this.flushPendingEdits();
    const allDocs = Array.from(this.documents.values()).filter((d) => d.deleted_at === null);
    const childrenMap = new Map<string | null, DocumentRecord[]>();

    for (const doc of allDocs) {
      const parentKey = doc.parent_id ?? null;
      if (!childrenMap.has(parentKey)) {
        childrenMap.set(parentKey, []);
      }
      childrenMap.get(parentKey)!.push(doc);
    }

    const sortList = (list: DocumentRecord[]) => {
      list.sort((a, b) => {
        const orderA = a.sort_order ?? 0;
        const orderB = b.sort_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.created_at - b.created_at;
      });
    };

    for (const list of childrenMap.values()) {
      sortList(list);
    }

    const visited = new Set<string>();
    const buildNodes = (parentId: string | null, depth: number): OutlineTreeNode[] => {
      const children = childrenMap.get(parentId) || [];
      const nodes: OutlineTreeNode[] = [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        nodes.push({
          document: { ...child },
          children: buildNodes(child.id, depth + 1),
          depth,
        });
      }
      return nodes;
    };

    const rootNodes = buildNodes(null, 0);
    for (const doc of allDocs) {
      if (!visited.has(doc.id)) {
        visited.add(doc.id);
        rootNodes.push({
          document: { ...doc },
          children: buildNodes(doc.id, 1),
          depth: 0,
        });
      }
    }
    return rootNodes;
  }

  async reorderDocument(docId: string, newParentId: string | null, targetIndex: number): Promise<void> {
    await this.flushPendingEdits();
    const doc = this.documents.get(docId);
    if (!doc) return;

    const siblings = Array.from(this.documents.values())
      .filter((d) => d.deleted_at === null && d.id !== docId && (d.parent_id ?? null) === (newParentId ?? null))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at - b.created_at);

    const clampedIndex = Math.max(0, Math.min(targetIndex, siblings.length));
    siblings.splice(clampedIndex, 0, doc);

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      const newOrder = i * 10;
      const isTarget = sibling.id === docId;
      const parentToSet = isTarget ? newParentId : sibling.parent_id;

      if (sibling.sort_order !== newOrder || (isTarget && sibling.parent_id !== newParentId)) {
        await this.saveDocument({
          id: sibling.id,
          sort_order: newOrder,
          parent_id: parentToSet,
        });
      }
    }
    await this.flushPendingEdits();
  }

  async getDescendantDocuments(parentId: string): Promise<DocumentRecord[]> {
    const tree = await this.getOutlineTree();
    const findNode = (nodes: OutlineTreeNode[]): OutlineTreeNode | null => {
      for (const node of nodes) {
        if (node.document.id === parentId) return node;
        const found = findNode(node.children);
        if (found) return found;
      }
      return null;
    };

    const targetNode = findNode(tree);
    if (!targetNode) {
      const doc = await this.getDocument(parentId);
      return doc ? [{ ...doc }] : [];
    }

    const result: DocumentRecord[] = [];
    const collectLeaves = (node: OutlineTreeNode) => {
      if (node.document.item_type !== 'folder' || node.children.length === 0) {
        result.push({ ...node.document });
      }
      for (const child of node.children) {
        collectLeaves(child);
      }
    };
    collectLeaves(targetNode);
    return result;
  }

  async splitDocumentAtCursor(
    docId: string,
    splitOffset: number,
    newDocTitle?: string
  ): Promise<{ original: DocumentRecord; created: DocumentRecord }> {
    const original = await this.getDocument(docId);
    if (!original) throw new Error(`Document ${docId} not found`);

    const fullText = original.content || '';
    const safeOffset = Math.max(0, Math.min(splitOffset, fullText.length));

    const headContent = fullText.slice(0, safeOffset).trimEnd();
    const tailContent = fullText.slice(safeOffset).trimStart();

    let autoTitle = newDocTitle;
    if (!autoTitle) {
      const firstLine = tailContent.split('\n')[0]?.replace(/^[#\s*_\-]+/, '').trim();
      autoTitle = firstLine ? firstLine.slice(0, 40) : `${original.title || 'Untitled'} (Part 2)`;
    }

    const now = Date.now();
    const newDocId = 'doc_' + Math.random().toString(36).substring(2, 11);

    const updatedOriginal = await this.saveDocument({
      id: docId,
      content: headContent,
      updated_at: now,
    });

    const createdDoc = await this.saveDocument({
      id: newDocId,
      title: autoTitle,
      content: tailContent,
      created_at: now,
      updated_at: now,
      parent_id: original.parent_id ?? null,
      sort_order: (original.sort_order ?? 0) + 1,
      item_type: 'document',
      is_title_custom: Boolean(newDocTitle),
    });

    await this.flushPendingEdits();
    return { original: updatedOriginal, created: createdDoc };
  }

  async getDocumentTags(documentId: string): Promise<string[]> {
    const tags = this.docTags.get(documentId);
    return tags ? Array.from(tags) : [];
  }
}

// ==========================================
// Deterministic MockAIServiceAdapter
// ==========================================

export class MockAIServiceAdapter implements AIServiceAdapter {
  public simulatedDelayMs: number = 0;
  public shouldFail: boolean = false;
  public errorMessage: string = 'Simulated AI Service Error';

  async streamContinuation(options: AIContinuationOptions, onChunk: (chunk: string) => void): Promise<string> {
    if (this.shouldFail) throw new Error(this.errorMessage);
    if (options.signal?.aborted) return '';

    const cannedText = 'the landscape unfolds with deliberate quietude, allowing thought to settle.';
    const words = cannedText.split(' ');
    let full = '';

    for (let i = 0; i < words.length; i++) {
      if (options.signal?.aborted) break;
      const chunk = (i === 0 ? ' ' : ' ') + words[i];
      full += chunk;
      onChunk(chunk);
      if (this.simulatedDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.simulatedDelayMs));
      }
    }
    return full;
  }

  async transformText(options: AITransformOptions): Promise<string> {
    if (this.shouldFail) throw new Error(this.errorMessage);
    const { selectedText, instruction, customPrompt } = options;

    switch (instruction) {
      case 'summarize':
        return `Summary: ${selectedText.slice(0, 40)}...`;
      case 'expand':
        return `${selectedText} This insight reveals the profound underpinnings of our core thesis.`;
      case 'concise':
        return selectedText.replace(/\b(?:very|really|quite|extremely)\s+/gi, '');
      case 'poetic':
        return `Like quiet amber light upon paper: ${selectedText}`;
      case 'analytical':
        return `Empirical observation reveals: ${selectedText.toLowerCase()}`;
      case 'casual':
        return `Basically, ${selectedText.toLowerCase()}`;
      case 'fix_grammar':
        return selectedText.replace(/\bthe the\b/gi, 'the').replace(/\bwas written by\b/gi, 'wrote');
      case 'custom':
        return `[Transformed per "${customPrompt}"]: ${selectedText}`;
      default:
        return selectedText;
    }
  }

  async runCritiqueChecks(text: string): Promise<AICritiqueCheck[]> {
    if (this.shouldFail) throw new Error(this.errorMessage);
    const checks: AICritiqueCheck[] = [];

    // Passive voice check
    const passiveRegex = /\b(was|were|is|are|been|being)\s+(\w+ed|written|taken|chosen|seen)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = passiveRegex.exec(text)) !== null) {
      checks.push({
        id: `pv-${match.index}`,
        paragraphIndex: 0,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'passive_voice',
        message: `Passive construction "${match[0]}". Consider active voice.`,
        suggestion: 'active phrasing',
      });
    }

    // Repetition check (adjacent duplicate words)
    const dupRegex = /\b(\w+)\s+\1\b/gi;
    while ((match = dupRegex.exec(text)) !== null) {
      checks.push({
        id: `rep-${match.index}`,
        paragraphIndex: 0,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'repetition',
        message: `Repeated word "${match[1]}".`,
        suggestion: match[1],
      });
    }

    // Clarity check: Wordy phrases
    const wordyRegex = /\bin order to\b/gi;
    while ((match = wordyRegex.exec(text)) !== null) {
      checks.push({
        id: `clr-${match.index}`,
        paragraphIndex: 0,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'clarity',
        message: 'Wordy phrase "in order to". Use "to" instead.',
        suggestion: 'to',
      });
    }

    return checks;
  }

  async queryContext(prompt: string, documentText: string, notes: ThoughtNoteRecord[]): Promise<string> {
    if (this.shouldFail) throw new Error(this.errorMessage);
    const notesSummary = notes.length > 0
      ? ` Referenced margin notes: ${notes.map(n => `[Note:${n.paragraph_anchor_id}]`).join(', ')}.`
      : '';
    return `In response to "${prompt}": The core thesis is established in [¶1].${notesSummary}`;
  }
}

// ==========================================
// Deterministic MockGoogleDocsSyncAdapter
// ==========================================

export class MockGoogleDocsSyncAdapter implements SyncAdapter {
  private status: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    pendingCount: 0,
  };
  private queue: Array<{ id: string; docId: string; type: string; payload: any; timestamp: number }> = [];
  public isOnline: boolean = true;
  public simulateNetworkDelayMs: number = 0;
  public simulateFailure: boolean = false;

  async init(): Promise<void> {
    this.status.state = this.isOnline ? 'idle' : 'offline';
  }

  queueMutation(docId: string, type: 'create' | 'update' | 'delete', payload: any): void {
    this.queue.push({
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docId,
      type,
      payload,
      timestamp: Date.now(),
    });
    this.status.pendingCount = this.queue.length;
  }

  async sync(): Promise<{ pushedCount: number; pulledCount: number }> {
    if (!this.isOnline) {
      this.status.state = 'offline';
      return { pushedCount: 0, pulledCount: 0 };
    }

    if (this.simulateFailure) {
      this.status.state = 'error';
      this.status.error = 'Network connection timed out';
      throw new Error('Sync failed: Network timeout');
    }

    this.status.state = 'syncing';
    if (this.simulateDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulateDelayMs));
    }

    const pushedCount = this.queue.length;
    this.queue = [];
    this.status.pendingCount = 0;
    this.status.lastSyncedAt = Date.now();
    this.status.state = 'idle';
    return { pushedCount, pulledCount: 0 };
  }

  getStatus(): SyncStatus {
    return { ...this.status, state: !this.isOnline ? 'offline' : this.status.state };
  }

  async resolveConflict(localDoc: DocumentRecord, remoteDoc: DocumentRecord): Promise<DocumentRecord> {
    // Chronological integrity: preserve whichever version has latest updated_at
    if (localDoc.updated_at >= remoteDoc.updated_at) {
      return { ...localDoc, sync_status: 'synced' };
    } else {
      return { ...remoteDoc, sync_status: 'synced' };
    }
  }

  setOnline(online: boolean): void {
    this.isOnline = online;
    this.status.state = online ? 'idle' : 'offline';
  }

  get simulateDelayMs(): number {
    return this.simulateNetworkDelayMs;
  }
}

// ==========================================
// Mock Export Service (100% Client-Side)
// ==========================================

export class MockExportService implements ExportService {
  exportToMarkdown(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): ExportResult {
    const frontmatter = [
      '---',
      `title: "${doc.title.replace(/"/g, '\\"')}"`,
      `created_at: "${new Date(doc.created_at).toISOString()}"`,
      `updated_at: "${new Date(doc.updated_at).toISOString()}"`,
      tags && tags.length > 0 ? `tags: [${tags.map((t) => `"${t}"`).join(', ')}]` : 'tags: []',
      '---',
      '',
    ].join('\n');

    let content = frontmatter + doc.content;

    if (notes.length > 0) {
      content += '\n\n---\n\n## Margin Notes & Annotations\n\n';
      notes.forEach((note) => {
        content += `* **[${note.paragraph_anchor_id}]**: ${note.content}\n`;
      });
    }

    return {
      filename: `${doc.title.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.md`,
      mimeType: 'text/markdown; charset=utf-8',
      data: content,
    };
  }

  exportToPlainText(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): ExportResult {
    const banner = [
      '================================================================================',
      doc.title.toUpperCase(),
      `Last Modified: ${new Date(doc.updated_at).toISOString()}`,
      tags && tags.length > 0 ? `Tags: #${tags.join(', #')}` : '',
      '================================================================================',
      '',
    ].filter(Boolean).join('\n');

    // Strip basic markdown syntax for plain text
    let plainContent = doc.content
      .replace(/^#{1,6}\s+(.*)$/gm, '$1')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1');

    let output = banner + '\n' + plainContent;

    if (notes.length > 0) {
      output += '\n\n--------------------------------------------------------------------------------\n';
      output += 'MARGIN NOTES:\n';
      notes.forEach((note) => {
        output += `[${note.paragraph_anchor_id}]: ${note.content}\n`;
      });
    }

    return {
      filename: `${doc.title.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.txt`,
      mimeType: 'text/plain; charset=utf-8',
      data: output,
    };
  }

  async exportToDocx(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): Promise<ExportResult> {
    // Generates a mock valid OOXML package byte array representation
    // PK\x03\x04 ZIP header signature: 0x50, 0x4B, 0x03, 0x04
    const zipHeader = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const mockXmlString = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${doc.title}</w:t></w:r></w:p><w:p><w:r><w:t>${doc.content}</w:t></w:r></w:p></w:body></w:document>`;
    const encoder = new TextEncoder();
    const xmlBytes = encoder.encode(mockXmlString);
    const data = new Uint8Array(zipHeader.length + xmlBytes.length);
    data.set(zipHeader, 0);
    data.set(xmlBytes, zipHeader.length);

    return {
      filename: `${doc.title.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data,
    };
  }

  async exportToPdf(doc: DocumentRecord, notes: ThoughtNoteRecord[], tags?: string[]): Promise<ExportResult> {
    // Generates a mock PDF with %PDF-1.4 binary signature
    const pdfHeader = '%PDF-1.4\n1 0 obj\n<< /Title (' + doc.title + ') >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
    const encoder = new TextEncoder();
    const data = encoder.encode(pdfHeader);

    return {
      filename: `${doc.title.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.pdf`,
      mimeType: 'application/pdf',
      data,
    };
  }

  async shareDocument(doc: DocumentRecord, format: 'md' | 'txt' | 'docx' | 'pdf'): Promise<boolean> {
    // Mock navigator.share
    return true;
  }

  composeEmail(doc: DocumentRecord): { url: string; truncated: boolean } {
    const subject = encodeURIComponent(`Daylight Writer Document: ${doc.title}`);
    let body = doc.content;
    let truncated = false;
    // URL safe limit ~1800 characters
    if (body.length > 1500) {
      body = body.slice(0, 1500) + '\n\n[...Content truncated due to email URI length limit...]';
      truncated = true;
    }
    const encodedBody = encodeURIComponent(body);
    const url = `mailto:?subject=${subject}&body=${encodedBody}`;
    return { url, truncated };
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

