/**
 * src/storage/sqlite-vfs.ts
 * Daylight Writer - Multi-Tier wa-sqlite VFS Factory & Database Driver
 * Supports:
 *   1. OPFS AccessHandlePoolVFS (Primary - Web Worker)
 *   2. IDBBatchAtomicVFS (Fallback - Browser Window / WebView)
 *   3. MemoryVFS (Hermetic Test / Node.js Vitest)
 */

import * as SQLite from '@journeyapps/wa-sqlite';
import type { DatabaseDriver, DatabaseSnapshot } from './schema.ts';
import { fromDbDocument, fromDbNote, fromDbTag } from './schema.ts';

export type VfsType = 'AccessHandlePoolVFS' | 'IDBBatchAtomicVFS' | 'MemoryVFS';

export interface SqliteOptions {
  vfsPreference?: 'opfs' | 'idb' | 'memory' | 'auto';
  dbName?: string;
  opfsDir?: string;
  idbName?: string;
}

export interface SqliteConnection {
  sqlite3: any;
  db: number;
  vfsName: VfsType;
  vfs: any;
  dbName: string;
  close: () => Promise<void>;
}

// ============================================================================
// 1. WebAssembly Module Loader & VFS Detection
// ============================================================================

async function loadWaSqliteModule(): Promise<any> {
  const { default: SQLiteAsyncESMFactory } = await import('@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs');
  const config: Record<string, any> = {};

  // If executing under Node.js (Vitest / CLI test suite), locate the .wasm file from disk
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fsMod = 'fs';
      const pathMod = 'path';
      const fs = await import(/* @vite-ignore */ fsMod);
      const path = await import(/* @vite-ignore */ pathMod);
      const wasmPath = path.resolve(
        process.cwd(),
        'node_modules/@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm'
      );
      if (fs.existsSync(wasmPath)) {
        config.wasmBinary = fs.readFileSync(wasmPath);
      }
    } catch {
      // Fall back to default module resolution
    }
  }

  return SQLiteAsyncESMFactory(config);
}

export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory &&
    typeof FileSystemFileHandle !== 'undefined' &&
    typeof (FileSystemFileHandle.prototype as any)?.createSyncAccessHandle === 'function'
  );
}

export function isIdbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

// ============================================================================
// 2. Multi-Tier VFS Factory
// ============================================================================

export async function createSqliteConnection(options: SqliteOptions = {}): Promise<SqliteConnection> {
  const preference = options.vfsPreference ?? 'auto';
  const dbName = options.dbName ?? 'daylight_writer.db';
  const opfsDir = options.opfsDir ?? 'daylight_writer_opfs';
  const idbName = options.idbName ?? 'daylight_writer_idb';

  const module = await loadWaSqliteModule();
  const sqlite3 = SQLite.Factory(module);

  let vfs: any;
  let vfsName: VfsType = 'MemoryVFS';

  // 1. Tier 1: OPFS AccessHandlePoolVFS (Primary in Web Worker)
  if (preference === 'opfs' || (preference === 'auto' && isOpfsSupported())) {
    try {
      const { AccessHandlePoolVFS } = await import('@journeyapps/wa-sqlite/src/examples/AccessHandlePoolVFS.js');
      vfs = await (AccessHandlePoolVFS as any).create(opfsDir, module);
      sqlite3.vfs_register(vfs, true);
      vfsName = 'AccessHandlePoolVFS';
    } catch (err) {
      console.warn('[SQLiteVFS] OPFS initialization failed, falling back to IDBBatchAtomicVFS:', err);
    }
  }

  // 2. Tier 2: IDBBatchAtomicVFS (Fallback in Browser)
  if (!vfs && (preference === 'idb' || (preference === 'auto' && isIdbSupported()))) {
    try {
      const { IDBBatchAtomicVFS } = await import('@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js');
      vfs = await (IDBBatchAtomicVFS as any).create(idbName, module);
      sqlite3.vfs_register(vfs, true);
      vfsName = 'IDBBatchAtomicVFS';
    } catch (err) {
      console.warn('[SQLiteVFS] IDBBatchAtomicVFS failed, falling back to MemoryVFS:', err);
    }
  }

  // 3. Tier 3: MemoryVFS (Hermetic Vitest / Node.js & Ephemeral Fallback)
  if (!vfs) {
    const { MemoryVFS } = await import('@journeyapps/wa-sqlite/src/examples/MemoryVFS.js');
    vfs = await (MemoryVFS as any).create('daylight_writer_mem', module);
    sqlite3.vfs_register(vfs, true);
    vfsName = 'MemoryVFS';
  }

  // Open Database Connection
  const openTarget = dbName;
  const db = await sqlite3.open_v2(openTarget);

  // Apply Performance & Durability PRAGMAs
  await sqlite3.exec(db, `
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -8000;
  `);

  if (vfsName === 'AccessHandlePoolVFS') {
    await sqlite3.exec(db, `
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);
  } else if (vfsName === 'IDBBatchAtomicVFS') {
    await sqlite3.exec(db, `
      PRAGMA synchronous = NORMAL;
    `);
  }

  const conn: SqliteConnection = {
    sqlite3,
    db,
    vfsName,
    vfs,
    dbName,
    close: async () => {
      try {
        if (conn.db) {
          await sqlite3.close(conn.db);
        }
      } finally {
        if (vfs?.close) {
          await vfs.close();
        }
      }
    },
  };

  return conn;
}

// ============================================================================
// 3. High-Level SqliteDatabase Wrapper (Implements DatabaseDriver)
// ============================================================================

export class SqliteDatabase implements DatabaseDriver {
  private conn: SqliteConnection;
  private restoreListeners: Set<() => Promise<void> | void> = new Set();

  constructor(conn: SqliteConnection) {
    this.conn = conn;
  }

  /**
   * Subscribe a callback to be notified whenever a snapshot is restored.
   * Enables repositories and caches to synchronize without process reload.
   */
  public onRestore(callback: () => Promise<void> | void): () => void {
    this.restoreListeners.add(callback);
    return () => {
      this.restoreListeners.delete(callback);
    };
  }

  private async notifyRestore(): Promise<void> {
    for (const listener of Array.from(this.restoreListeners)) {
      try {
        await listener();
      } catch (err) {
        console.warn('[SQLiteVFS] Error in onRestore listener:', err);
      }
    }
  }

  public getDbName(): string {
    return this.conn.dbName;
  }

  public static async open(options: SqliteOptions = {}): Promise<SqliteDatabase> {
    const conn = await createSqliteConnection(options);
    return new SqliteDatabase(conn);
  }

  public getVfsName(): VfsType {
    return this.conn.vfsName;
  }

  public getRawDb(): number {
    return this.conn.db;
  }

  public getRawSqlite(): any {
    return this.conn.sqlite3;
  }

  /**
   * Execute multi-statement SQL script (DDL migrations, pragma statements)
   */
  public async exec(sql: string): Promise<void> {
    await this.conn.sqlite3.exec(this.conn.db, sql);
  }

  /**
   * Query database returning an array of row objects
   */
  public async executeSql<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const { sqlite3, db } = this.conn;
    const results: T[] = [];

    for await (const stmt of sqlite3.statements(db, sql)) {
      if (params && params.length > 0) {
        sqlite3.bind_collection(stmt, params);
      }
      const colNames = sqlite3.column_names(stmt);
      while ((await sqlite3.step(stmt)) === 100 /* SQLITE_ROW */) {
        const rowVals = sqlite3.row(stmt);
        const rowObj: Record<string, any> = {};
        for (let i = 0; i < colNames.length; i++) {
          rowObj[colNames[i]] = rowVals[i];
        }
        results.push(rowObj as T);
      }
    }

    return results;
  }

  /**
   * Execute single mutating SQL statement returning rows affected
   */
  public async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | bigint }> {
    const { sqlite3, db } = this.conn;
    for await (const stmt of sqlite3.statements(db, sql)) {
      if (params && params.length > 0) {
        sqlite3.bind_collection(stmt, params);
      }
      await sqlite3.step(stmt);
    }
    const changes = sqlite3.changes(db);
    const lastInsertId = sqlite3.last_insert_id(db);
    return { changes, lastInsertId };
  }

  /**
   * Execute a sequence of SQL statements atomically in a transaction
   */
  public async runTransaction(operations: { sql: string; params: any[] }[]): Promise<void> {
    const { sqlite3, db } = this.conn;
    await sqlite3.exec(db, 'BEGIN TRANSACTION;');
    try {
      for (const op of operations) {
        for await (const stmt of sqlite3.statements(db, op.sql)) {
          if (op.params && op.params.length > 0) {
            sqlite3.bind_collection(stmt, op.params);
          }
          await sqlite3.step(stmt);
        }
      }
      await sqlite3.exec(db, 'COMMIT;');
    } catch (err) {
      await sqlite3.exec(db, 'ROLLBACK;');
      throw err;
    }
  }

  /**
   * Helper to execute an arbitrary async closure within BEGIN / COMMIT
   */
  public async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const { sqlite3, db } = this.conn;
    await sqlite3.exec(db, 'BEGIN TRANSACTION;');
    try {
      const result = await fn();
      await sqlite3.exec(db, 'COMMIT;');
      return result;
    } catch (err) {
      await sqlite3.exec(db, 'ROLLBACK;');
      throw err;
    }
  }

  // ==========================================================================
  // 4. F40: Database Export & Snapshot Backup Hook
  // ==========================================================================

  /**
   * Export the raw binary SQLite database file as a Uint8Array
   */
  public async exportSnapshot(): Promise<Uint8Array> {
    const { vfs, vfsName, sqlite3, db, dbName } = this.conn;

    // 1. If MemoryVFS: directly extract the internal ArrayBuffer matching dbName
    if (vfsName === 'MemoryVFS' && vfs?.mapNameToFile) {
      const candidates = [
        `/${dbName}`,
        dbName,
        '/daylight_writer.db',
        'daylight_writer.db',
        '/:memory:',
        ':memory:',
      ];
      for (const name of candidates) {
        const file = vfs.mapNameToFile.get(name);
        if (file && file.data) {
          return new Uint8Array(file.data.slice(0, file.size));
        }
      }
      for (const [key, file] of vfs.mapNameToFile.entries()) {
        if ((key.endsWith(dbName) || key.includes(dbName)) && file && file.data) {
          return new Uint8Array(file.data.slice(0, file.size));
        }
      }
      for (const file of vfs.mapNameToFile.values()) {
        if (file && file.data) {
          return new Uint8Array(file.data.slice(0, file.size));
        }
      }
    }

    // 2. Universal VACUUM INTO memory snapshot
    const tempDbName = `snapshot_${Date.now()}.db`;
    try {
      await sqlite3.exec(db, `VACUUM INTO '${tempDbName}';`);
      if (vfs?.mapNameToFile?.has(`/${tempDbName}`)) {
        const tempFile = vfs.mapNameToFile.get(`/${tempDbName}`);
        const bytes = new Uint8Array(tempFile.data.slice(0, tempFile.size));
        vfs.mapNameToFile.delete(`/${tempDbName}`);
        return bytes;
      }
    } catch (vacuumErr) {
      console.warn('[SQLiteVFS] VACUUM INTO export failed, falling back to JSON snapshot:', vacuumErr);
    }

    // Fallback: Dump relational tables into binary JSON representation
    const jsonSnapshot = await this.exportJsonSnapshot();
    const jsonStr = JSON.stringify(jsonSnapshot);
    return new TextEncoder().encode(jsonStr);
  }

  /**
   * Helper to parse a raw SQLite format 3 binary buffer into a relational snapshot
   * using an ephemeral MemoryVFS connection.
   */
  public static async extractSnapshotFromBinary(data: Uint8Array): Promise<DatabaseSnapshot> {
    const tempDbName = `temp_extract_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`;
    const tempDb = await SqliteDatabase.open({ vfsPreference: 'memory', dbName: tempDbName });
    const conn = (tempDb as any).conn;
    const { sqlite3, vfs } = conn;

    await sqlite3.close(conn.db);
    const targetPath = `/${tempDbName}`;
    vfs.mapNameToFile.set(targetPath, {
      pathname: targetPath,
      flags: 0,
      size: data.byteLength,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });

    conn.db = await sqlite3.open_v2(tempDbName);
    const snapshot = await tempDb.exportJsonSnapshot();
    await tempDb.close();
    return snapshot;
  }

  /**
   * Restore the database from a raw binary snapshot
   */
  public async importSnapshot(data: Uint8Array): Promise<void> {
    const { vfs, vfsName, sqlite3, dbName } = this.conn;

    // Check if payload is a JSON snapshot fallback
    if (data[0] === 0x7B /* '{' */) {
      try {
        const jsonStr = new TextDecoder().decode(data);
        const snapshot = JSON.parse(jsonStr) as DatabaseSnapshot;
        if (snapshot.documents) {
          await this.importJsonSnapshot(snapshot);
          return;
        }
      } catch {
        // Not JSON, continue with binary import
      }
    }

    // Fast header check for SQLite format 3 signature
    const isSqliteBinary = data.length >= 16 &&
      data[0] === 0x53 && data[1] === 0x51 && data[2] === 0x4C && data[3] === 0x69 && // 'SQLi'
      data[4] === 0x74 && data[5] === 0x65 && data[6] === 0x20 && data[7] === 0x66 && // 'te f'
      data[8] === 0x6F && data[9] === 0x72 && data[10] === 0x6D && data[11] === 0x61 && // 'orma'
      data[12] === 0x74 && data[13] === 0x20 && data[14] === 0x33; // 't 3'

    if (!isSqliteBinary) {
      throw new Error('Invalid snapshot data: neither valid JSON snapshot nor SQLite format 3 binary.');
    }

    if (vfsName === 'MemoryVFS' && vfs?.mapNameToFile) {
      let targetPath = `/${dbName}`;
      for (const key of vfs.mapNameToFile.keys()) {
        if (key.endsWith(dbName) || key.includes(dbName)) {
          targetPath = key;
          break;
        }
      }

      // 1. Close open SQLite handle to release pager cache and clear mapIdToFile
      await sqlite3.close(this.conn.db);

      // 2. Overwrite file in MemoryVFS
      vfs.mapNameToFile.set(targetPath, {
        pathname: targetPath,
        flags: 0,
        size: data.byteLength,
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      });

      // 3. Reopen SQLite connection on the restored file
      this.conn.db = await sqlite3.open_v2(dbName);

      // 4. Re-apply essential PRAGMAs
      await sqlite3.exec(this.conn.db, `
        PRAGMA foreign_keys = ON;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -8000;
      `);

      // 5. Notify active repositories and caches
      await this.notifyRestore();
      return;
    }

    // Universal fallback for persistent VFS (AccessHandlePoolVFS / IDBBatchAtomicVFS):
    const extractedSnapshot = await SqliteDatabase.extractSnapshotFromBinary(data);
    await this.importJsonSnapshot(extractedSnapshot);
  }

  /**
   * Export all database records as a portable relational JSON snapshot
   */
  public async exportJsonSnapshot(): Promise<DatabaseSnapshot> {
    const docs = await this.executeSql('SELECT * FROM documents;');
    const notes = await this.executeSql('SELECT * FROM margin_notes;');
    const tags = await this.executeSql('SELECT * FROM tags;');
    const docTags = await this.executeSql('SELECT * FROM document_tags;');
    const queue = await this.executeSql('SELECT * FROM sync_queue;');
    const versionRows = await this.executeSql<{ user_version: number }>('PRAGMA user_version;');

    return {
      schema_version: versionRows[0]?.user_version ?? 1,
      exported_at: Date.now(),
      documents: docs.map(fromDbDocument),
      margin_notes: notes.map(fromDbNote),
      tags: tags.map(fromDbTag),
      document_tags: docTags.map((dt: any) => ({
        document_id: dt.document_id,
        tag_id: dt.tag_id,
        created_at: Number(dt.created_at),
      })),
      sync_queue: queue.map((q: any) => ({
        id: q.id,
        entity_type: q.entity_type,
        entity_id: q.entity_id,
        operation: q.operation,
        payload: q.payload,
        client_timestamp: Number(q.client_timestamp),
        retry_count: Number(q.retry_count),
        last_error: q.last_error ?? null,
        status: q.status,
      })),
    };
  }

  /**
   * Restore all database records from a relational JSON snapshot atomically
   */
  public async importJsonSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
    const operations: { sql: string; params: any[] }[] = [];

    // Clear existing tables and FTS5 virtual table
    operations.push(
      { sql: 'DELETE FROM document_tags;', params: [] },
      { sql: 'DELETE FROM margin_notes;', params: [] },
      { sql: 'DELETE FROM documents;', params: [] },
      { sql: 'DELETE FROM documents_fts;', params: [] },
      { sql: 'DELETE FROM tags;', params: [] },
      { sql: 'DELETE FROM sync_queue;', params: [] }
    );

    // Insert Documents
    for (const doc of snapshot.documents) {
      operations.push({
        sql: `INSERT INTO documents (
          id, title, content, created_at, updated_at, deleted_at,
          is_title_custom, format_version, sync_status, google_drive_file_id,
          google_drive_revision_id, last_synced_at, version_vector
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        ],
      });
    }

    // Insert Margin Notes
    for (const note of snapshot.margin_notes) {
      operations.push({
        sql: `INSERT INTO margin_notes (
          id, document_id, paragraph_anchor_id, content, created_at, updated_at, deleted_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
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
    }

    // Insert Tags
    for (const tag of snapshot.tags) {
      operations.push({
        sql: `INSERT INTO tags (id, name, path, created_at) VALUES (?, ?, ?, ?);`,
        params: [tag.id, tag.name, tag.path, tag.created_at],
      });
    }

    // Insert Document Tags
    for (const dt of snapshot.document_tags) {
      operations.push({
        sql: `INSERT INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?);`,
        params: [dt.document_id, dt.tag_id, dt.created_at],
      });
    }

    // Insert Sync Queue Items
    for (const q of snapshot.sync_queue) {
      operations.push({
        sql: `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        params: [
          q.id,
          q.entity_type,
          q.entity_id,
          q.operation,
          q.payload,
          q.client_timestamp,
          q.retry_count,
          q.last_error,
          q.status,
        ],
      });
    }

    await this.runTransaction(operations);
    await this.notifyRestore();
  }

  public async close(): Promise<void> {
    await this.conn.close();
  }
}

// ============================================================================
// 5. Dedicated Web Worker RPC Client (Production PWA Bridge)
// ============================================================================

export interface WorkerRequest {
  id: string;
  type: 'executeSql' | 'runTransaction' | 'exportSnapshot' | 'importSnapshot' | 'close';
  sql?: string;
  params?: any[];
  operations?: { sql: string; params: any[] }[];
  snapshot?: any;
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
}

export class StorageWorkerClient implements DatabaseDriver {
  private worker: Worker;
  private pendingRequests = new Map<string, { resolve: (res: any) => void; reject: (err: any) => void }>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, success, result, error } = event.data;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if (success) {
          pending.resolve(result);
        } else {
          pending.reject(new Error(error || 'Worker operation failed'));
        }
      }
    };
  }

  private sendRequest<T>(type: WorkerRequest['type'], payload: Partial<WorkerRequest> = {}): Promise<T> {
    const id = 'req_' + Math.random().toString(36).substring(2, 9);
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  public executeSql<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.sendRequest<T[]>('executeSql', { sql, params });
  }

  public runTransaction(operations: { sql: string; params: any[] }[]): Promise<void> {
    return this.sendRequest<void>('runTransaction', { operations });
  }

  public exportSnapshot(): Promise<Uint8Array> {
    return this.sendRequest<Uint8Array>('exportSnapshot');
  }

  public importSnapshot(snapshot: Uint8Array): Promise<void> {
    return this.sendRequest<void>('importSnapshot', { snapshot });
  }

  public async close(): Promise<void> {
    await this.sendRequest<void>('close');
    this.worker.terminate();
  }
}
