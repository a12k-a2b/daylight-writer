/**
 * src/storage/repository.ts
 * Daylight Writer - Reactive Storage Repository
 * In-Memory Write-Ahead Cache, 250ms Debounced WAL Commits & Emergency Lifecycle Flush
 * Strictly compliant with PROJECT.md § Interface Contracts
 */

import type {
  DocumentRecord,
  ThoughtNoteRecord,
  TagRecord,
  DatabaseDriver,
} from './schema.ts';
import {
  searchDocumentsInMemory,
  normalizeTagPath,
  getTagLeafName,
  isTagMatch,
} from './search.ts';

export type {
  DocumentRecord,
  ThoughtNoteRecord,
  TagRecord,
  DatabaseDriver,
};

export interface OutlineTreeNode {
  document: DocumentRecord;
  children: OutlineTreeNode[];
  depth: number;
}

export interface StorageRepository {
  init(): Promise<void>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  listDocuments(options?: {
    sortBy?: 'updated_at' | 'created_at';
    sortOrder?: 'asc' | 'desc';
    tagId?: string;
  }): Promise<DocumentRecord[]>;
  saveDocument(doc: Partial<DocumentRecord> & { id: string }): Promise<DocumentRecord>;
  deleteDocument(id: string): Promise<void>;
  flushPendingEdits(): Promise<void>;

  getNotesForDocument(documentId: string): Promise<ThoughtNoteRecord[]>;
  saveNote(
    note: Partial<ThoughtNoteRecord> & {
      id: string;
      document_id: string;
      paragraph_anchor_id: string;
    }
  ): Promise<ThoughtNoteRecord>;
  deleteNote(id: string): Promise<void>;

  searchDocuments(
    query: string
  ): Promise<Array<{ document: DocumentRecord; score: number; matchHighlights: string[] }>>;
  getTags(): Promise<TagRecord[]>;
  setDocumentTags(documentId: string, tags: string[]): Promise<void>;
  getDocumentTags(documentId: string): Promise<string[]>;

  // Google Drive & Cloud Sync extensions
  findByDriveFileId?(fileId: string): Promise<DocumentRecord | null>;
  updateSyncMetadata?(
    id: string,
    metadata: {
      google_drive_file_id?: string | null;
      google_drive_revision_id?: string | null;
      last_synced_at?: number | null;
      sync_status?: DocumentRecord['sync_status'];
    }
  ): Promise<void>;
  getDatabaseDriver?(): DatabaseDriver | null;

  // Scrivener Outline & Playlist Reordering (Steven Johnson Workflow)
  getOutlineTree?(): Promise<OutlineTreeNode[]>;
  reorderDocument?(docId: string, newParentId: string | null, targetIndex: number): Promise<void>;
  getDescendantDocuments?(parentId: string): Promise<DocumentRecord[]>;
  splitDocumentAtCursor?(docId: string, splitOffset: number, newDocTitle?: string): Promise<{ original: DocumentRecord; created: DocumentRecord }>;
}

export class SQLiteStorageRepository implements StorageRepository {
  private db: DatabaseDriver | null = null;
  private isInitialized = false;

  // In-Memory Reactive Cache
  private documentsCache = new Map<string, DocumentRecord>();
  private notesCache = new Map<string, ThoughtNoteRecord>();
  private tagsCache = new Map<string, TagRecord>();
  private documentTagsCache = new Map<string, Set<string>>(); // docId -> Set<tagId>
  private docTagPathsCache = new Map<string, Set<string>>(); // docId -> Set<tagPath>

  // Dirty Tracking & Debounce
  private dirtyDocumentIds = new Set<string>();
  private dirtyNoteIds = new Set<string>();
  private pendingTagAssociations = new Map<string, string[]>(); // docId -> tagPaths[]
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number = 250;
  public flushCount: number = 0;
  private flushRetryCount: number = 0;
  private static readonly MAX_FLUSH_RETRIES: number = 5;

  // Monotonic Revision Vectors for Dirty Tracking Concurrency
  private documentRevisions = new Map<string, number>();
  private noteRevisions = new Map<string, number>();
  private tagAssociationRevisions = new Map<string, number>();

  // Promise-Chaining Mutex for Flushes
  private inFlightFlush: Promise<void> | null = null;
  private queuedFlush: Promise<void> | null = null;

  private detachLifecycle: (() => void) | null = null;

  constructor(dbDriver?: DatabaseDriver, debounceMs = 250) {
    if (dbDriver) {
      this.setDatabaseDriver(dbDriver);
    }
    this.debounceMs = debounceMs;
  }

  public setDatabaseDriver(driver: DatabaseDriver): void {
    this.db = driver;
    if (this.db && typeof this.db.onRestore === 'function') {
      this.db.onRestore(() => this.reloadFromDatabase());
    }
  }

  public getDatabaseDriver(): DatabaseDriver | null {
    return this.db;
  }

  /**
   * Reload all in-memory caches from SQLite.
   * Invoked automatically on snapshot restore or manual cache refresh.
   */
  public async reloadFromDatabase(): Promise<void> {
    if (!this.db) return;

    // 1. Purge all in-memory caches
    this.documentsCache.clear();
    this.notesCache.clear();
    this.tagsCache.clear();
    this.documentTagsCache.clear();
    this.docTagPathsCache.clear();

    // 2. Clear dirty tracking sets (restored database is the source of truth)
    this.dirtyDocumentIds.clear();
    this.dirtyNoteIds.clear();
    this.pendingTagAssociations.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 3. Load Tags into memory
    const tagRows = await this.db.executeSql<any>(
      `SELECT id, name, path, created_at FROM tags ORDER BY path ASC;`
    );
    for (const row of tagRows) {
      this.tagsCache.set(row.id, {
        id: row.id,
        name: row.name,
        path: row.path,
        created_at: typeof row.created_at === 'number' ? row.created_at : new Date(row.created_at).getTime(),
      });
    }

    // 4. Load Document-Tag Junctions
    const docTagRows = await this.db.executeSql<any>(
      `SELECT document_id, tag_id FROM document_tags;`
    );
    for (const row of docTagRows) {
      if (!this.documentTagsCache.has(row.document_id)) {
        this.documentTagsCache.set(row.document_id, new Set());
      }
      this.documentTagsCache.get(row.document_id)!.add(row.tag_id);

      const tag = this.tagsCache.get(row.tag_id);
      if (tag) {
        if (!this.docTagPathsCache.has(row.document_id)) {
          this.docTagPathsCache.set(row.document_id, new Set());
        }
        this.docTagPathsCache.get(row.document_id)!.add(tag.path);
      }
    }

    // 5. Load Documents into in-memory cache
    const docRows = await this.db.executeSql<any>(
      `SELECT id, title, content, created_at, updated_at, deleted_at, is_title_custom, format_version, sync_status, google_drive_file_id, google_drive_revision_id, last_synced_at, version_vector, parent_id, sort_order, synopsis, item_type FROM documents;`
    );
    for (const row of docRows) {
      this.documentsCache.set(row.id, this.rowToDocumentRecord(row));
    }

    // 6. Load Margin Notes into in-memory cache
    const noteRows = await this.db.executeSql<any>(
      `SELECT id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status FROM margin_notes;`
    );
    for (const row of noteRows) {
      this.notesCache.set(row.id, this.rowToThoughtNoteRecord(row));
    }
  }

  /**
   * Initializes the repository, primes in-memory cache from SQLite,
   * and attaches browser lifecycle emergency flush hooks.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    if (this.db) {
      await this.reloadFromDatabase();
    }

    // Attach Emergency Lifecycle Listeners
    this.attachLifecycleListeners();

    this.isInitialized = true;
  }

  private rowToDocumentRecord(row: any): DocumentRecord {
    return {
      id: row.id,
      title: row.title ?? '',
      content: row.content ?? '',
      created_at: typeof row.created_at === 'number' ? row.created_at : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
      updated_at: typeof row.updated_at === 'number' ? row.updated_at : (row.updated_at ? new Date(row.updated_at).getTime() : Date.now()),
      deleted_at: row.deleted_at
        ? (typeof row.deleted_at === 'number' ? row.deleted_at : new Date(row.deleted_at).getTime())
        : null,
      is_title_custom: Boolean(row.is_title_custom),
      format_version: Number(row.format_version ?? 1),
      sync_status: (row.sync_status as DocumentRecord['sync_status']) || 'pending',
      google_drive_file_id: row.google_drive_file_id ?? null,
      google_drive_revision_id: row.google_drive_revision_id ?? null,
      last_synced_at: row.last_synced_at ? Number(row.last_synced_at) : null,
      version_vector: Number(row.version_vector ?? 1),
      parent_id: row.parent_id ?? null,
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
      synopsis: row.synopsis ?? '',
      item_type: (row.item_type as 'document' | 'folder') || 'document',
    };
  }

  private rowToThoughtNoteRecord(row: any): ThoughtNoteRecord {
    return {
      id: row.id,
      document_id: row.document_id,
      paragraph_anchor_id: row.paragraph_anchor_id,
      content: row.content ?? '',
      created_at: typeof row.created_at === 'number' ? row.created_at : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
      updated_at: typeof row.updated_at === 'number' ? row.updated_at : (row.updated_at ? new Date(row.updated_at).getTime() : Date.now()),
      deleted_at: row.deleted_at
        ? (typeof row.deleted_at === 'number' ? row.deleted_at : new Date(row.deleted_at).getTime())
        : null,
      sync_status: row.sync_status ?? 'pending',
    };
  }

  /**
   * Binds browser lifecycle listeners for emergency synchronous WAL flush.
   */
  public attachLifecycleListeners(): void {
    if (typeof window === 'undefined') return;

    const emergencyFlush = () => {
      void this.flushPendingEdits().catch(err => {
        console.warn('[SQLiteStorageRepository] Emergency flush error:', err);
      });
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        emergencyFlush();
      }
    };

    window.addEventListener('beforeunload', emergencyFlush);
    window.addEventListener('pagehide', emergencyFlush);
    window.addEventListener('blur', emergencyFlush);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    this.detachLifecycle = () => {
      window.removeEventListener('beforeunload', emergencyFlush);
      window.removeEventListener('pagehide', emergencyFlush);
      window.removeEventListener('blur', emergencyFlush);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }

  public destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.detachLifecycle) {
      this.detachLifecycle();
      this.detachLifecycle = null;
    }
  }

  // --- Document Operations ---

  public async getDocument(id: string): Promise<DocumentRecord | null> {
    const cached = this.documentsCache.get(id);
    if (cached) {
      return cached.deleted_at === null ? { ...cached } : null;
    }

    if (!this.db) return null;

    const rows = await this.db.executeSql<any>(
      `SELECT id, title, content, created_at, updated_at, deleted_at, is_title_custom,
              format_version, sync_status, google_drive_file_id, google_drive_revision_id,
              last_synced_at, version_vector, parent_id, sort_order, synopsis, item_type
       FROM documents WHERE id = ? AND deleted_at IS NULL LIMIT 1;`,
      [id]
    );

    if (rows.length === 0) return null;

    const record = this.rowToDocumentRecord(rows[0]);
    this.documentsCache.set(record.id, record);
    return { ...record };
  }

  public async findByDriveFileId(fileId: string): Promise<DocumentRecord | null> {
    if (!fileId || typeof fileId !== 'string' || fileId.trim() === '') return null;

    for (const doc of this.documentsCache.values()) {
      if (doc.google_drive_file_id === fileId && doc.deleted_at === null) {
        return { ...doc };
      }
    }

    if (!this.db) return null;

    const rows = await this.db.executeSql<any>(
      `SELECT id, title, content, created_at, updated_at, deleted_at, is_title_custom,
              format_version, sync_status, google_drive_file_id, google_drive_revision_id,
              last_synced_at, version_vector, parent_id, sort_order, synopsis, item_type
       FROM documents WHERE google_drive_file_id = ? AND deleted_at IS NULL LIMIT 1;`,
      [fileId]
    );

    if (rows.length === 0) return null;

    const record = this.rowToDocumentRecord(rows[0]);
    this.documentsCache.set(record.id, record);
    return { ...record };
  }

  public async updateSyncMetadata(
    id: string,
    metadata: {
      google_drive_file_id?: string | null;
      google_drive_revision_id?: string | null;
      last_synced_at?: number | null;
      sync_status?: DocumentRecord['sync_status'];
    }
  ): Promise<void> {
    const cached = this.documentsCache.get(id);
    if (cached) {
      if (metadata.google_drive_file_id !== undefined) cached.google_drive_file_id = metadata.google_drive_file_id;
      if (metadata.google_drive_revision_id !== undefined) cached.google_drive_revision_id = metadata.google_drive_revision_id;
      if (metadata.last_synced_at !== undefined) cached.last_synced_at = metadata.last_synced_at;
      if (metadata.sync_status !== undefined) cached.sync_status = metadata.sync_status;
    }

    if (this.db) {
      const setClauses: string[] = [];
      const params: any[] = [];

      if (metadata.google_drive_file_id !== undefined) {
        setClauses.push('google_drive_file_id = ?');
        params.push(metadata.google_drive_file_id);
      }
      if (metadata.google_drive_revision_id !== undefined) {
        setClauses.push('google_drive_revision_id = ?');
        params.push(metadata.google_drive_revision_id);
      }
      if (metadata.last_synced_at !== undefined) {
        setClauses.push('last_synced_at = ?');
        params.push(metadata.last_synced_at);
      }
      if (metadata.sync_status !== undefined) {
        setClauses.push('sync_status = ?');
        params.push(metadata.sync_status);
      }

      if (setClauses.length > 0) {
        params.push(id);
        await this.db.executeSql(
          `UPDATE documents 
           SET ${setClauses.join(', ')} 
           WHERE id = ?;`,
          params
        );
      }
    }
  }

  public async listDocuments(options?: {
    sortBy?: 'updated_at' | 'created_at';
    sortOrder?: 'asc' | 'desc';
    tagId?: string;
  }): Promise<DocumentRecord[]> {
    const sortBy = options?.sortBy || 'updated_at';
    const sortOrder = options?.sortOrder || 'desc';
    const tagFilter = options?.tagId;

    let targetTagId: string | null = null;
    let targetPath: string | null = null;

    if (tagFilter) {
      if (this.tagsCache.has(tagFilter)) {
        // Direct tag ID match from getTags()
        const tagRecord = this.tagsCache.get(tagFilter)!;
        targetTagId = tagRecord.id;
        targetPath = normalizeTagPath(tagRecord.path);
      } else {
        const normFilter = normalizeTagPath(tagFilter);
        const matchingTag = Array.from(this.tagsCache.values()).find(
          t => normalizeTagPath(t.path) === normFilter
        );
        if (matchingTag) {
          targetTagId = matchingTag.id;
          targetPath = normalizeTagPath(matchingTag.path);
        } else {
          targetTagId = tagFilter;
          targetPath = normFilter;
        }
      }
    }

    const activeDocs: DocumentRecord[] = [];
    for (const doc of this.documentsCache.values()) {
      if (doc.deleted_at !== null) continue;

      if (tagFilter) {
        let matchesTag = false;

        // 1. Direct tagId check in documentTagsCache
        const docTagIds = this.documentTagsCache.get(doc.id);
        if (docTagIds && targetTagId && docTagIds.has(targetTagId)) {
          matchesTag = true;
        }

        // 2. Hierarchical / prefix path match in docTagPathsCache
        if (!matchesTag && targetPath) {
          const docPaths = this.docTagPathsCache.get(doc.id);
          if (docPaths) {
            matchesTag = Array.from(docPaths).some(path => isTagMatch(path, targetPath!));
          } else if (docTagIds) {
            for (const tId of docTagIds) {
              const tag = this.tagsCache.get(tId);
              if (tag && isTagMatch(tag.path, targetPath!)) {
                matchesTag = true;
                break;
              }
            }
          }
        }

        if (!matchesTag) {
          continue;
        }
      }

      activeDocs.push({ ...doc });
    }

    activeDocs.sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];
      if (sortOrder === 'asc') {
        return valA - valB;
      }
      return valB - valA;
    });

    return activeDocs;
  }

  public async saveDocument(
    doc: Partial<DocumentRecord> & { id: string }
  ): Promise<DocumentRecord> {
    const existing = this.documentsCache.get(doc.id);
    const now = Date.now();

    const nextRev = (this.documentRevisions.get(doc.id) ?? existing?.version_vector ?? 0) + 1;
    this.documentRevisions.set(doc.id, nextRev);

    const title = (doc.title !== undefined && doc.title.trim().length > 0)
      ? doc.title
      : (existing?.title ?? 'Untitled');

    const updated: DocumentRecord = {
      id: doc.id,
      title,
      content: doc.content !== undefined ? doc.content : (existing?.content ?? ''),
      created_at: existing?.created_at ?? doc.created_at ?? now,
      updated_at: doc.updated_at ?? now,
      deleted_at: doc.deleted_at !== undefined ? doc.deleted_at : (existing?.deleted_at ?? null),
      is_title_custom:
        doc.is_title_custom !== undefined
          ? doc.is_title_custom
          : (existing?.is_title_custom ?? false),
      format_version: doc.format_version ?? existing?.format_version ?? 1,
      sync_status: doc.sync_status !== undefined ? doc.sync_status : (existing?.sync_status ?? 'pending'),
      google_drive_file_id:
        doc.google_drive_file_id !== undefined
          ? doc.google_drive_file_id
          : (existing?.google_drive_file_id ?? null),
      google_drive_revision_id:
        doc.google_drive_revision_id !== undefined
          ? doc.google_drive_revision_id
          : (existing?.google_drive_revision_id ?? null),
      last_synced_at:
        doc.last_synced_at !== undefined
          ? doc.last_synced_at
          : (existing?.last_synced_at ?? null),
      version_vector: nextRev,
      parent_id: doc.parent_id !== undefined ? doc.parent_id : (existing?.parent_id ?? null),
      sort_order: doc.sort_order !== undefined ? doc.sort_order : (existing?.sort_order ?? 0),
      synopsis: doc.synopsis !== undefined ? doc.synopsis : (existing?.synopsis ?? ''),
      item_type: doc.item_type !== undefined ? doc.item_type : (existing?.item_type ?? 'document'),
    };

    // 0ms In-Memory Reactive Cache Update
    this.documentsCache.set(updated.id, updated);
    this.dirtyDocumentIds.add(updated.id);

    // Schedule 250ms debounced WAL commit
    this.scheduleDebouncedFlush();

    return { ...updated };
  }

  public async deleteDocument(id: string): Promise<void> {
    const existing = this.documentsCache.get(id);
    const now = Date.now();
    const nextRev = (this.documentRevisions.get(id) ?? existing?.version_vector ?? 0) + 1;
    this.documentRevisions.set(id, nextRev);

    if (existing) {
      existing.deleted_at = now;
      existing.updated_at = now;
      existing.sync_status = 'pending';
      existing.version_vector = nextRev;
      this.dirtyDocumentIds.add(id);
    } else {
      const tombstone: DocumentRecord = {
        id,
        title: '',
        content: '',
        created_at: now,
        updated_at: now,
        deleted_at: now,
        is_title_custom: false,
        format_version: 1,
        sync_status: 'pending',
        version_vector: nextRev,
      };
      this.documentsCache.set(id, tombstone);
      this.dirtyDocumentIds.add(id);
    }

    this.scheduleDebouncedFlush();
  }

  // --- Margin Note Operations ---

  public async getNotesForDocument(documentId: string): Promise<ThoughtNoteRecord[]> {
    const activeNotes: ThoughtNoteRecord[] = [];
    for (const note of this.notesCache.values()) {
      if (note.document_id === documentId && note.deleted_at === null) {
        activeNotes.push({ ...note });
      }
    }

    activeNotes.sort((a, b) => a.created_at - b.created_at);
    return activeNotes;
  }

  public async saveNote(
    note: Partial<ThoughtNoteRecord> & {
      id: string;
      document_id: string;
      paragraph_anchor_id: string;
    }
  ): Promise<ThoughtNoteRecord> {
    const existing = this.notesCache.get(note.id);
    const now = Date.now();
    const nextRev = (this.noteRevisions.get(note.id) ?? 0) + 1;
    this.noteRevisions.set(note.id, nextRev);

    const updated: ThoughtNoteRecord = {
      id: note.id,
      document_id: note.document_id,
      paragraph_anchor_id: note.paragraph_anchor_id,
      content: note.content !== undefined ? note.content : (existing?.content ?? ''),
      created_at: existing?.created_at ?? note.created_at ?? now,
      updated_at: note.updated_at ?? now,
      deleted_at: note.deleted_at !== undefined ? note.deleted_at : (existing?.deleted_at ?? null),
      sync_status: note.sync_status ?? existing?.sync_status ?? 'pending',
    };

    this.notesCache.set(updated.id, updated);
    this.dirtyNoteIds.add(updated.id);

    this.scheduleDebouncedFlush();

    return { ...updated };
  }

  public async deleteNote(id: string): Promise<void> {
    const existing = this.notesCache.get(id);
    const now = Date.now();
    const nextRev = (this.noteRevisions.get(id) ?? 0) + 1;
    this.noteRevisions.set(id, nextRev);

    if (existing) {
      existing.deleted_at = now;
      existing.updated_at = now;
      this.dirtyNoteIds.add(id);
      this.scheduleDebouncedFlush();
      return;
    }

    if (this.db) {
      const rows = await this.db.executeSql<{
        document_id: string;
        paragraph_anchor_id?: string;
        content?: string;
        created_at?: number;
      }>(
        'SELECT document_id, paragraph_anchor_id, content, created_at FROM margin_notes WHERE id = ? AND deleted_at IS NULL;',
        [id]
      );
      if (rows && rows.length > 0) {
        const row = rows[0];
        const tombstone: ThoughtNoteRecord = {
          id,
          document_id: row.document_id,
          paragraph_anchor_id: row.paragraph_anchor_id ?? '',
          content: row.content ?? '',
          created_at: row.created_at ?? now,
          updated_at: now,
          deleted_at: now,
          sync_status: 'pending',
        };
        this.notesCache.set(id, tombstone);
        this.dirtyNoteIds.add(id);
        this.scheduleDebouncedFlush();
      } else {
        this.noteRevisions.delete(id);
      }
    } else {
      this.noteRevisions.delete(id);
    }
  }

  // --- Tag & Junction Operations ---

  public async getTags(): Promise<TagRecord[]> {
    const tags = Array.from(this.tagsCache.values());
    tags.sort((a, b) => a.path.localeCompare(b.path));
    return tags.map(t => ({ ...t }));
  }

  public async setDocumentTags(documentId: string, tags: string[]): Promise<void> {
    const normalizedPaths = Array.from(
      new Set(tags.map(t => normalizeTagPath(t)).filter(Boolean))
    );

    const nextRev = (this.tagAssociationRevisions.get(documentId) ?? 0) + 1;
    this.tagAssociationRevisions.set(documentId, nextRev);

    // Track pending tag changes
    this.pendingTagAssociations.set(documentId, normalizedPaths);

    // Update in-memory tagsCache and documentTagsCache
    const now = Date.now();
    const tagIds = new Set<string>();
    const tagPathSet = new Set<string>();

    for (const path of normalizedPaths) {
      tagPathSet.add(path);
      let existingTag = Array.from(this.tagsCache.values()).find(t => t.path === path);
      if (!existingTag) {
        const newTagId = 'tag_' + Math.random().toString(36).substring(2, 11);
        existingTag = {
          id: newTagId,
          name: getTagLeafName(path),
          path,
          created_at: now,
        };
        this.tagsCache.set(newTagId, existingTag);
      }
      tagIds.add(existingTag.id);
    }

    this.documentTagsCache.set(documentId, tagIds);
    this.docTagPathsCache.set(documentId, tagPathSet);

    this.scheduleDebouncedFlush();
  }

  public async getDocumentTags(documentId: string): Promise<string[]> {
    const tagPaths = this.docTagPathsCache.get(documentId);
    if (tagPaths) {
      return Array.from(tagPaths);
    }
    const tagIdSet = this.documentTagsCache.get(documentId);
    if (!tagIdSet) return [];
    const result: string[] = [];
    for (const tagId of tagIdSet) {
      const tag = this.tagsCache.get(tagId);
      if (tag) result.push(tag.path);
    }
    return result;
  }

  // --- Search Operations ---

  public async searchDocuments(
    query: string
  ): Promise<Array<{ document: DocumentRecord; score: number; matchHighlights: string[] }>> {
    const docTagsMap = new Map<string, string[]>();
    for (const [docId, tagPathSet] of this.docTagPathsCache.entries()) {
      docTagsMap.set(docId, Array.from(tagPathSet));
    }
    // Also include any docs from documentTagsCache if missing
    for (const [docId, tagIdSet] of this.documentTagsCache.entries()) {
      if (!docTagsMap.has(docId)) {
        const paths: string[] = [];
        for (const tagId of tagIdSet) {
          const tag = this.tagsCache.get(tagId);
          if (tag) paths.push(tag.path);
        }
        docTagsMap.set(docId, paths);
      }
    }

    const allDocs = Array.from(this.documentsCache.values());
    return searchDocumentsInMemory(query, allDocs, docTagsMap);
  }

  // --- Debounced & Emergency Flush ---

  private scheduleDebouncedFlush(delayMs: number = this.debounceMs): void {
    if (delayMs === this.debounceMs) {
      this.flushRetryCount = 0;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushPendingEdits().catch(err => {
        console.warn('[SQLiteStorageRepository] Background flush error:', err);
      });
    }, delayMs);
  }

  private hasDirtyEdits(): boolean {
    return (
      this.dirtyDocumentIds.size > 0 ||
      this.dirtyNoteIds.size > 0 ||
      this.pendingTagAssociations.size > 0
    );
  }

  public async flushPendingEdits(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // If an in-flight flush is executing, chain behind it
    if (this.inFlightFlush) {
      if (this.queuedFlush) {
        return this.queuedFlush;
      }
      this.queuedFlush = (async () => {
        try {
          await this.inFlightFlush;
        } catch {
          // Swallow in-flight error so queued flush can attempt remaining edits
        } finally {
          this.queuedFlush = null;
        }
        if (this.hasDirtyEdits()) {
          return this.flushPendingEdits();
        }
      })();
      return this.queuedFlush;
    }

    if (!this.hasDirtyEdits()) {
      return;
    }

    this.inFlightFlush = this.performFlushCycle();
    try {
      await this.inFlightFlush;
    } finally {
      this.inFlightFlush = null;
    }
  }

  private async performFlushCycle(): Promise<void> {
    this.flushCount++;

    if (!this.db) {
      // In pure in-memory mode, flush simply clears dirty sets
      this.dirtyDocumentIds.clear();
      this.dirtyNoteIds.clear();
      this.pendingTagAssociations.clear();
      return;
    }

    // Snapshot revisions and payloads at start of flush cycle
    const docSnapshots = new Map<string, number>();
    const docPayloads = new Map<string, DocumentRecord>();
    for (const id of this.dirtyDocumentIds) {
      const doc = this.documentsCache.get(id);
      if (!doc) continue;
      const rev = this.documentRevisions.get(id) ?? doc.version_vector ?? 0;
      docSnapshots.set(id, rev);
      docPayloads.set(id, { ...doc });
    }

    const noteSnapshots = new Map<string, number>();
    const notePayloads = new Map<string, ThoughtNoteRecord>();
    for (const id of this.dirtyNoteIds) {
      const note = this.notesCache.get(id);
      if (!note) continue;
      // Guard: invalid notes with empty document_id violate schema FOREIGN KEY constraints
      if (!note.document_id) {
        console.warn(`[SQLiteStorageRepository] Note ${id} has empty document_id, removing from dirty set to avoid foreign key failure`);
        this.dirtyNoteIds.delete(id);
        continue;
      }
      const rev = this.noteRevisions.get(id) ?? 0;
      noteSnapshots.set(id, rev);
      notePayloads.set(id, { ...note });
    }

    const tagSnapshots = new Map<string, number>();
    const tagPayloads = new Map<string, string[]>();
    for (const [docId, paths] of this.pendingTagAssociations) {
      const rev = this.tagAssociationRevisions.get(docId) ?? 0;
      tagSnapshots.set(docId, rev);
      tagPayloads.set(docId, [...paths]);
    }

    const operations: { sql: string; params: any[] }[] = [];

    // 1. Process Documents via UPSERT (fires trg_documents_fts_au cleanly)
    for (const [id, doc] of docPayloads) {
      operations.push({
        sql: `INSERT INTO documents (
          id, title, content, created_at, updated_at, deleted_at,
          is_title_custom, format_version, sync_status, google_drive_file_id,
          google_drive_revision_id, last_synced_at, version_vector,
          parent_id, sort_order, synopsis, item_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at,
          is_title_custom = excluded.is_title_custom,
          format_version = excluded.format_version,
          sync_status = excluded.sync_status,
          google_drive_file_id = excluded.google_drive_file_id,
          google_drive_revision_id = excluded.google_drive_revision_id,
          last_synced_at = excluded.last_synced_at,
          version_vector = excluded.version_vector,
          parent_id = excluded.parent_id,
          sort_order = excluded.sort_order,
          synopsis = excluded.synopsis,
          item_type = excluded.item_type;`,
        params: [
          doc.id,
          doc.title,
          doc.content,
          doc.created_at,
          doc.updated_at,
          doc.deleted_at,
          doc.is_title_custom ? 1 : 0,
          doc.format_version,
          doc.sync_status,
          doc.google_drive_file_id ?? null,
          doc.google_drive_revision_id ?? null,
          doc.last_synced_at ?? null,
          doc.version_vector ?? 1,
          doc.parent_id ?? null,
          doc.sort_order ?? 0,
          doc.synopsis ?? '',
          doc.item_type ?? 'document',
        ],
      });

      // Add mutation to sync_queue for offline sync engine (only if not already synced)
      if (doc.sync_status !== 'synced') {
        operations.push({
          sql: `INSERT INTO sync_queue (
            id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?);`,
          params: [
            'sync_' + Math.random().toString(36).substring(2, 11),
            'document',
            doc.id,
            doc.deleted_at ? 'delete' : 'update',
            JSON.stringify(doc),
            doc.updated_at,
            'pending',
          ],
        });
      }
    }

    // 2. Process Margin Notes via UPSERT
    for (const [id, note] of notePayloads) {
      operations.push({
        sql: `INSERT INTO margin_notes (
          id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          document_id = excluded.document_id,
          paragraph_anchor_id = excluded.paragraph_anchor_id,
          content = excluded.content,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at,
          sync_status = excluded.sync_status;`,
        params: [
          note.id,
          note.document_id,
          note.paragraph_anchor_id,
          note.content,
          note.created_at,
          note.updated_at,
          note.deleted_at,
          note.sync_status ?? 'pending',
        ],
      });

      operations.push({
        sql: `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status
        ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?);`,
        params: [
          'sync_' + Math.random().toString(36).substring(2, 11),
          'margin_note',
          note.id,
          note.deleted_at ? 'delete' : 'update',
          JSON.stringify(note),
          note.updated_at,
          'pending',
        ],
      });
    }

    // 3. Process Pending Tag Associations
    for (const [docId, tagPaths] of tagPayloads) {
      operations.push({
        sql: `DELETE FROM document_tags WHERE document_id = ?;`,
        params: [docId],
      });

      for (const path of tagPaths) {
        const tag = Array.from(this.tagsCache.values()).find(t => t.path === path);
        if (tag) {
          operations.push({
            sql: `INSERT OR IGNORE INTO tags (id, name, path, created_at) VALUES (?, ?, ?, ?);`,
            params: [tag.id, tag.name, tag.path, tag.created_at],
          });
          operations.push({
            sql: `INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?);`,
            params: [docId, tag.id, Date.now()],
          });
        }
      }
    }

    if (operations.length === 0) return;

    try {
      await this.db.runTransaction(operations);
      this.flushRetryCount = 0;

      // Version-Gated Post-Commit Cleanup
      for (const [id, snapRev] of docSnapshots) {
        if (this.documentRevisions.get(id) === snapRev) {
          this.dirtyDocumentIds.delete(id);
        }
      }
      for (const [id, snapRev] of noteSnapshots) {
        if (this.noteRevisions.get(id) === snapRev) {
          this.dirtyNoteIds.delete(id);
        }
      }
      for (const [docId, snapRev] of tagSnapshots) {
        if (this.tagAssociationRevisions.get(docId) === snapRev) {
          this.pendingTagAssociations.delete(docId);
        }
      }

      // If new edits arrived during transaction, reschedule flush
      if (this.hasDirtyEdits()) {
        this.scheduleDebouncedFlush();
      }
    } catch (err) {
      this.flushRetryCount++;
      console.warn('[SQLiteStorageRepository] WAL flush transaction failed:', err);

      const isConstraintError =
        String(err).includes('constraint failed') ||
        String(err).includes('FOREIGN KEY') ||
        (err as any)?.code === 19;

      if (isConstraintError) {
        console.error(
          '[SQLiteStorageRepository] Schema constraint violation encountered. Purging invalid entries to prevent bricking WAL queue.'
        );
        for (const [id] of noteSnapshots) {
          const note = this.notesCache.get(id);
          if (!note || !note.document_id) {
            this.dirtyNoteIds.delete(id);
          }
        }
      }

      // Ensure failed transactions do not spin in an infinite tight loop without backoff
      if (!isConstraintError && this.flushRetryCount <= SQLiteStorageRepository.MAX_FLUSH_RETRIES) {
        const backoffMs = Math.min(this.debounceMs * Math.pow(2, this.flushRetryCount), 10000);
        this.scheduleDebouncedFlush(backoffMs);
      } else if (this.flushRetryCount > SQLiteStorageRepository.MAX_FLUSH_RETRIES) {
        console.error(
          `[SQLiteStorageRepository] Exceeded max flush retries (${SQLiteStorageRepository.MAX_FLUSH_RETRIES}), halting automatic retry loop.`
        );
      }
      throw err;
    }
  }

  // ==========================================================================
  // Scrivener Outline & Playlist Reordering (Steven Johnson Workflow)
  // ==========================================================================

  public async getOutlineTree(): Promise<OutlineTreeNode[]> {
    // 1. Get all active documents
    const allDocs = Array.from(this.documentsCache.values()).filter(d => d.deleted_at === null);
    
    // 2. Index by id and group by parent_id
    const childrenMap = new Map<string | null, DocumentRecord[]>();
    const docMap = new Map<string, DocumentRecord>();
    for (const doc of allDocs) {
      docMap.set(doc.id, doc);
      const parentKey = doc.parent_id ?? null;
      if (!childrenMap.has(parentKey)) {
        childrenMap.set(parentKey, []);
      }
      childrenMap.get(parentKey)!.push(doc);
    }

    // Sort helper: by sort_order ASC, then created_at ASC
    const sortList = (list: DocumentRecord[]) => {
      list.sort((a, b) => {
        const orderA = a.sort_order ?? 0;
        const orderB = b.sort_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.created_at - b.created_at;
      });
    };

    // Sort every group
    for (const list of childrenMap.values()) {
      sortList(list);
    }

    // Recursive tree builder
    const buildNodes = (parentId: string | null, depth: number, visited: Set<string>): OutlineTreeNode[] => {
      const children = childrenMap.get(parentId) || [];
      const nodes: OutlineTreeNode[] = [];

      for (const child of children) {
        if (visited.has(child.id)) continue; // cycle guard
        visited.add(child.id);

        const childNodes = buildNodes(child.id, depth + 1, visited);
        nodes.push({
          document: { ...child },
          children: childNodes,
          depth,
        });
      }

      return nodes;
    };

    const visited = new Set<string>();
    const rootNodes = buildNodes(null, 0, visited);

    // Orphan check: any documents whose parent_id doesn't exist in active docs become top-level
    for (const doc of allDocs) {
      if (!visited.has(doc.id)) {
        visited.add(doc.id);
        const childNodes = buildNodes(doc.id, 1, visited);
        rootNodes.push({
          document: { ...doc },
          children: childNodes,
          depth: 0,
        });
      }
    }

    return rootNodes;
  }

  public async reorderDocument(docId: string, newParentId: string | null, targetIndex: number): Promise<void> {
    const doc = this.documentsCache.get(docId);
    if (!doc) return;

    // Get all active siblings under newParentId (excluding current doc)
    const siblings = Array.from(this.documentsCache.values())
      .filter(d => d.deleted_at === null && d.id !== docId && (d.parent_id ?? null) === (newParentId ?? null))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at - b.created_at);

    const clampedIndex = Math.max(0, Math.min(targetIndex, siblings.length));
    siblings.splice(clampedIndex, 0, doc);

    // Re-index siblings with normalized sort_order: 0, 10, 20...
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
  }

  public async getDescendantDocuments(parentId: string): Promise<DocumentRecord[]> {
    const tree = await this.getOutlineTree();
    
    // Find target node in tree
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
      // If parentId itself is a leaf document, return it
      const doc = this.documentsCache.get(parentId);
      return doc && doc.deleted_at === null ? [{ ...doc }] : [];
    }

    // Flatten tree in linear reading order
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

  public async splitDocumentAtCursor(
    docId: string,
    splitOffset: number,
    newDocTitle?: string
  ): Promise<{ original: DocumentRecord; created: DocumentRecord }> {
    const original = this.documentsCache.get(docId);
    if (!original) {
      throw new Error(`Document ${docId} not found`);
    }

    const fullText = original.content || '';
    const safeOffset = Math.max(0, Math.min(splitOffset, fullText.length));

    const headContent = fullText.slice(0, safeOffset).trimEnd();
    const tailContent = fullText.slice(safeOffset).trimStart();

    // Determine title for created section
    let autoTitle = newDocTitle;
    if (!autoTitle) {
      const firstLine = tailContent.split('\n')[0]?.replace(/^[#\s*_\-]+/, '').trim();
      autoTitle = firstLine ? firstLine.slice(0, 40) : `${original.title || 'Untitled'} (Part 2)`;
    }

    const now = Date.now();
    const newDocId = 'doc_' + Math.random().toString(36).substring(2, 11);

    // Save original with head content
    const updatedOriginal = await this.saveDocument({
      id: docId,
      content: headContent,
      updated_at: now,
    });

    // Save created document with tail content immediately following original in sort_order
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

    return { original: updatedOriginal, created: createdDoc };
  }
}
