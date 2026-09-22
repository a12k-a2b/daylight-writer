/**
 * src/storage/schema.ts
 * Daylight Writer - PowerSync-Ready SQLite Relational Schema & Migration Runner
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

export interface DatabaseDriver {
  executeSql<T = any>(sql: string, params?: any[]): Promise<T[]>;
  runTransaction(operations: { sql: string; params: any[] }[]): Promise<void>;
  close?(): Promise<void>;
  onRestore?(callback: () => Promise<void> | void): () => void;
}

// ============================================================================
// 1. Domain Types & Record Interfaces (PROJECT.md § Interface Contracts)
// ============================================================================

export interface DocumentRecord {
  id: string;
  title: string;
  content: string;
  created_at: number; // UTC ms
  updated_at: number; // UTC ms
  deleted_at: number | null; // UTC ms tombstone, null if active
  is_title_custom: boolean;
  format_version: number;
  sync_status: 'synced' | 'pending' | 'conflict' | 'error';
  google_drive_file_id?: string | null;
  google_drive_revision_id?: string | null;
  last_synced_at?: number | null;
  version_vector?: number;
  parent_id?: string | null;
  sort_order?: number;
  synopsis?: string;
  item_type?: 'document' | 'folder';
}

export interface ThoughtNoteRecord {
  id: string;
  document_id: string;
  paragraph_anchor_id: string; // e.g. 'p-0', 'p-1', or stable paragraph hash
  content: string;
  created_at: number; // UTC ms
  updated_at: number; // UTC ms
  deleted_at: number | null; // UTC ms tombstone
  sync_status?: 'synced' | 'pending' | 'conflict' | 'error';
}

export interface TagRecord {
  id: string;
  name: string;
  path: string; // e.g. "project/drafts"
  created_at: number; // UTC ms
}

export interface DocumentTagRecord {
  document_id: string;
  tag_id: string;
  created_at: number; // UTC ms
}

export interface SyncQueueRecord {
  id: string;
  entity_type: 'document' | 'margin_note' | 'tag' | 'document_tag';
  entity_id: string;
  operation: 'create' | 'update' | 'delete';
  payload: string; // JSON serialized
  client_timestamp: number;
  retry_count: number;
  last_error: string | null;
  status: 'pending' | 'in_flight' | 'failed' | 'completed';
}

export interface DatabaseSnapshot {
  schema_version: number;
  exported_at: number;
  documents: DocumentRecord[];
  margin_notes: ThoughtNoteRecord[];
  tags: TagRecord[];
  document_tags: DocumentTagRecord[];
  sync_queue: SyncQueueRecord[];
}

// ============================================================================
// 2. PowerSync-Ready SQL DDL Schema Definition
// ============================================================================

export const INITIAL_SCHEMA_SQL = `
-- Enforce referential integrity
PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- Table: documents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    is_title_custom INTEGER NOT NULL DEFAULT 0,
    format_version INTEGER NOT NULL DEFAULT 1,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    google_drive_file_id TEXT,
    google_drive_revision_id TEXT,
    last_synced_at INTEGER,
    version_vector INTEGER NOT NULL DEFAULT 1
);

-- Partial indexes for active documents (F39 Soft Deletes)
CREATE INDEX IF NOT EXISTS idx_documents_updated_at 
    ON documents(updated_at DESC) 
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_created_at 
    ON documents(created_at DESC) 
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_sync_status 
    ON documents(sync_status);

CREATE INDEX IF NOT EXISTS idx_documents_drive_id 
    ON documents(google_drive_file_id) 
    WHERE google_drive_file_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Table: margin_notes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS margin_notes (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL,
    paragraph_anchor_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_margin_notes_doc_anchor 
    ON margin_notes(document_id, paragraph_anchor_id) 
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_margin_notes_updated_at 
    ON margin_notes(updated_at DESC);

-- ----------------------------------------------------------------------------
-- Table: tags
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(path);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- ----------------------------------------------------------------------------
-- Table: document_tags (Many-to-Many Junction)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (document_id, tag_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_doc ON document_tags(document_id);

-- ----------------------------------------------------------------------------
-- Table: sync_queue (Local-First Offline Mutation Queue)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    client_timestamp INTEGER NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status_time 
    ON sync_queue(status, client_timestamp ASC);

CREATE INDEX IF NOT EXISTS idx_sync_queue_entity 
    ON sync_queue(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- Table: documents_fts (FTS5 Full-Text Virtual Table)
-- ----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    id UNINDEXED,
    title,
    content,
    tokenize = 'porter unicode61'
);

-- FTS Synchronization Triggers with Soft-Delete Awareness & Deduplication
CREATE TRIGGER IF NOT EXISTS trg_documents_fts_ai AFTER INSERT ON documents
BEGIN
    DELETE FROM documents_fts WHERE id = new.id;
    INSERT INTO documents_fts(id, title, content)
    SELECT new.id, new.title, new.content
    WHERE new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_fts_ad AFTER DELETE ON documents
BEGIN
    DELETE FROM documents_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_fts_au AFTER UPDATE ON documents
BEGIN
    DELETE FROM documents_fts WHERE id = old.id;
    INSERT INTO documents_fts(id, title, content)
    SELECT new.id, new.title, new.content
    WHERE new.deleted_at IS NULL;
END;
`;

// ============================================================================
// 3. Migration Runner (Atomic & Idempotent via PRAGMA user_version)
// ============================================================================

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial PowerSync schema, tables, partial indexes, and FTS5 triggers',
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    version: 2,
    description: 'Add Scrivener outline columns, sort_order, synopsis, item_type and parent_sort index',
    sql: `
      ALTER TABLE documents ADD COLUMN parent_id TEXT;
      ALTER TABLE documents ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
      ALTER TABLE documents ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
      ALTER TABLE documents ADD COLUMN item_type TEXT NOT NULL DEFAULT 'document';
      CREATE INDEX IF NOT EXISTS idx_documents_parent_sort ON documents(parent_id, sort_order ASC) WHERE deleted_at IS NULL;
    `,
  },
];

export async function runMigrations(driver: DatabaseDriver): Promise<number> {
  const versionRows = await driver.executeSql<{ user_version: number }>('PRAGMA user_version;');
  let currentVersion = versionRows[0]?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      await driver.runTransaction([
        { sql: migration.sql, params: [] },
        { sql: `PRAGMA user_version = ${migration.version};`, params: [] },
      ]);
      currentVersion = migration.version;
    }
  }

  return currentVersion;
}

// ============================================================================
// 4. Initial Seed Data Generator (DC1 First-Boot Experience)
// ============================================================================

export const SEED_DOCUMENT_ID = 'doc-welcome-01';
export const SEED_NOTE_1_ID = 'note-welcome-01';
export const SEED_NOTE_2_ID = 'note-welcome-02';
export const SEED_TAG_GETTING_STARTED_ID = 'tag-getting-started';
export const SEED_TAG_WELCOME_ID = 'tag-daylight-welcome';

export async function seedInitialData(driver: DatabaseDriver): Promise<boolean> {
  // Count all rows (including soft-deleted tombstones) to prevent re-seeding existing databases
  const countRows = await driver.executeSql<{ count: number }>(
    'SELECT COUNT(*) as count FROM documents;'
  );
  if ((countRows[0]?.count ?? 0) > 0) {
    return false; // Database already contains documents (active or tombstoned)
  }

  const now = Date.now();
  const welcomeContent = `# Welcome to Daylight Writer

A distraction-free, landscape typewriter writing experience built specifically for the Daylight Computer (DC1) LivePaper display.

Here are a few quick tips to get you started:

- Typewriter Focus: As you type, the active line remains centered vertically on screen at the 50% midpoint.
- Focus Modes: Dim inactive sentences or paragraphs to enter deep writing flow without visual clutter.
- Dual Drawers: Swipe from the left for your document library and hierarchical tags, or swipe from the right to view thought margin notes anchored to paragraphs. Press Esc or Cmd+[ to return to pure zero-chrome writing.
- Quick AI: Type +++ anywhere to request an inline continuation, or press Cmd+K to transform selected text blocks.
- Offline-First: Every keystroke is saved immediately to your local SQLite database, always ready off-grid for weeks at a time.

Happy writing!`;

  await driver.runTransaction([
    // 1. Insert Welcome Document (INSERT OR IGNORE ensures 100% idempotency)
    {
      sql: `INSERT OR IGNORE INTO documents (
        id, title, content, created_at, updated_at, deleted_at,
        is_title_custom, format_version, sync_status, version_vector
      ) VALUES (?, ?, ?, ?, ?, NULL, 0, 1, 'synced', 1);`,
      params: [
        SEED_DOCUMENT_ID,
        'Welcome to Daylight Writer',
        welcomeContent,
        now,
        now,
      ],
    },
    // 2. Insert Margin Notes (INSERT OR IGNORE ensures 100% idempotency)
    {
      sql: `INSERT OR IGNORE INTO margin_notes (
        id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'synced');`,
      params: [
        SEED_NOTE_1_ID,
        SEED_DOCUMENT_ID,
        'p-2',
        'Try tapping on this note to edit it, or add new margin thoughts from the right drawer.',
        now,
        now,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO margin_notes (
        id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'synced');`,
      params: [
        SEED_NOTE_2_ID,
        SEED_DOCUMENT_ID,
        'p-4',
        'You can customize AI shortcuts, critique rules, and export formats in preferences.',
        now,
        now,
      ],
    },
    // 3. Insert Tags
    {
      sql: `INSERT OR IGNORE INTO tags (id, name, path, created_at) VALUES (?, ?, ?, ?);`,
      params: [SEED_TAG_GETTING_STARTED_ID, 'getting-started', 'getting-started', now],
    },
    {
      sql: `INSERT OR IGNORE INTO tags (id, name, path, created_at) VALUES (?, ?, ?, ?);`,
      params: [SEED_TAG_WELCOME_ID, 'welcome', 'daylight/welcome', now],
    },
    // 4. Link Document Tags
    {
      sql: `INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?);`,
      params: [SEED_DOCUMENT_ID, SEED_TAG_GETTING_STARTED_ID, now],
    },
    {
      sql: `INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?);`,
      params: [SEED_DOCUMENT_ID, SEED_TAG_WELCOME_ID, now],
    },
  ]);

  return true;
}

// ============================================================================
// 5. Bi-Directional Database Row ↔ Domain Record Mappers
// ============================================================================

export function fromDbDocument(row: any): DocumentRecord {
  return {
    id: row.id,
    title: row.title ?? '',
    content: row.content ?? '',
    created_at: typeof row.created_at === 'number' ? row.created_at : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : (row.updated_at ? new Date(row.updated_at).getTime() : Date.now()),
    deleted_at: row.deleted_at === null || row.deleted_at === undefined
      ? null
      : (typeof row.deleted_at === 'number' ? row.deleted_at : new Date(row.deleted_at).getTime()),
    is_title_custom: Boolean(row.is_title_custom),
    format_version: Number(row.format_version ?? 1),
    sync_status: row.sync_status ?? 'pending',
    google_drive_file_id: row.google_drive_file_id ?? null,
    google_drive_revision_id: row.google_drive_revision_id ?? null,
    last_synced_at: row.last_synced_at ? Number(row.last_synced_at) : null,
    version_vector: Number(row.version_vector ?? 1),
  };
}

export function fromDbNote(row: any): ThoughtNoteRecord {
  return {
    id: row.id,
    document_id: row.document_id,
    paragraph_anchor_id: row.paragraph_anchor_id,
    content: row.content ?? '',
    created_at: typeof row.created_at === 'number' ? row.created_at : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : (row.updated_at ? new Date(row.updated_at).getTime() : Date.now()),
    deleted_at: row.deleted_at === null || row.deleted_at === undefined
      ? null
      : (typeof row.deleted_at === 'number' ? row.deleted_at : new Date(row.deleted_at).getTime()),
    sync_status: row.sync_status ?? 'pending',
  };
}

export function fromDbTag(row: any): TagRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    created_at: typeof row.created_at === 'number' ? row.created_at : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
  };
}
