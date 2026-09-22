/**
 * src/sync/offline-mutation-queue.ts
 * Daylight Writer - SQLite-Persisted Offline Mutation Queue
 * Manages local-first sync_queue table, coalescing, batch draining,
 * and exponential backoff on the Daylight Computer (DC1).
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type { DatabaseDriver, SyncQueueRecord } from '../storage/schema.ts';
import type { SyncAdapter, SyncOperation, SyncEntityType } from './sync-adapter.ts';

export interface OfflineQueueOptions {
  batchSize?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class OfflineMutationQueue {
  private db: DatabaseDriver | null = null;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  // In-memory fallback queue when SQLite driver is unavailable
  private memoryQueue: SyncQueueRecord[] = [];
  private isDraining: boolean = false;
  private hasRecoveredOnStartup: boolean = false;

  constructor(db?: DatabaseDriver, options: OfflineQueueOptions = {}) {
    if (db) this.db = db;
    this.batchSize = options.batchSize || 50;
    this.maxRetries = options.maxRetries || 5;
    this.baseBackoffMs = options.baseBackoffMs || 1000;
    this.maxBackoffMs = options.maxBackoffMs || 60000;
  }

  public setDatabaseDriver(driver: DatabaseDriver): void {
    this.db = driver;
    this.hasRecoveredOnStartup = false;
  }

  /**
   * Recovers abandoned in-flight mutations left over from an unexpected
   * termination, browser crash, or reload, restoring them to 'pending' state.
   * Operates safely in both SQLite persistent mode and memory fallback mode.
   * Returns the count of recovered mutations.
   */
  public async recoverInFlight(): Promise<number> {
    if (!this.db) {
      let recovered = 0;
      for (const item of this.memoryQueue) {
        if (item.status === 'in_flight') {
          item.status = 'pending';
          recovered++;
        }
      }
      return recovered;
    }

    const inFlightRows = await this.db.executeSql<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'in_flight';`
    );
    const count = inFlightRows[0]?.count ?? 0;
    if (count > 0) {
      await this.db.executeSql(
        `UPDATE sync_queue SET status = 'pending' WHERE status = 'in_flight';`
      );
    }
    return count;
  }

  /**
   * Initializes the queue, executing the in-flight mutation recovery sweep.
   */
  public async init(): Promise<number> {
    const count = await this.recoverInFlight();
    this.hasRecoveredOnStartup = true;
    return count;
  }

  private async ensureStartupRecovery(): Promise<void> {
    if (!this.hasRecoveredOnStartup) {
      await this.recoverInFlight();
      this.hasRecoveredOnStartup = true;
    }
  }

  /**
   * Enqueues a local mutation. Automatically coalesces with any existing
   * pending mutation for the same entity to prevent queue bloat.
   */
  public async enqueue(
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperation,
    payload: any,
    clientTimestamp: number = Date.now()
  ): Promise<void> {
    await this.ensureStartupRecovery();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    if (!this.db) {
      this.enqueueMemory(entityType, entityId, operation, payloadStr, clientTimestamp);
      return;
    }

    // Coalesce against existing pending row for this entity
    const existing = await this.db.executeSql<SyncQueueRecord>(
      `SELECT * FROM sync_queue WHERE entity_type = ? AND entity_id = ? AND status = 'pending' LIMIT 1;`,
      [entityType, entityId]
    );

    if (existing.length > 0) {
      const prev = existing[0];

      if (prev.operation === 'create' && operation === 'delete') {
        // Entity was created and deleted offline before ever reaching cloud -> discard both
        await this.db.executeSql(`DELETE FROM sync_queue WHERE id = ?;`, [prev.id]);
        return;
      }

      if (prev.operation === 'create' && operation === 'update') {
        // Keep as 'create' but update payload to latest state
        await this.db.executeSql(
          `UPDATE sync_queue SET payload = ?, client_timestamp = ? WHERE id = ?;`,
          [payloadStr, clientTimestamp, prev.id]
        );
        return;
      }

      // Existing update + new update or delete -> overwrite with latest
      await this.db.executeSql(
        `UPDATE sync_queue SET operation = ?, payload = ?, client_timestamp = ? WHERE id = ?;`,
        [operation, payloadStr, clientTimestamp, prev.id]
      );
      return;
    }

    // Insert new pending row
    const id = 'sync_' + Math.random().toString(36).substring(2, 11);
    await this.db.executeSql(
      `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, payload, client_timestamp, retry_count, last_error, status
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'pending');`,
      [id, entityType, entityId, operation, payloadStr, clientTimestamp]
    );
  }

  private enqueueMemory(
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperation,
    payloadStr: string,
    clientTimestamp: number
  ): void {
    const idx = this.memoryQueue.findIndex(
      (q) => q.entity_type === entityType && q.entity_id === entityId && q.status === 'pending'
    );

    if (idx !== -1) {
      const prev = this.memoryQueue[idx];
      if (prev.operation === 'create' && operation === 'delete') {
        this.memoryQueue.splice(idx, 1);
        return;
      }
      if (prev.operation === 'create' && operation === 'update') {
        prev.payload = payloadStr;
        prev.client_timestamp = clientTimestamp;
        return;
      }
      prev.operation = operation;
      prev.payload = payloadStr;
      prev.client_timestamp = clientTimestamp;
      return;
    }

    this.memoryQueue.push({
      id: 'sync_' + Math.random().toString(36).substring(2, 11),
      entity_type: entityType,
      entity_id: entityId,
      operation,
      payload: payloadStr,
      client_timestamp: clientTimestamp,
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  /**
   * Retrieves current pending mutation count.
   */
  public async getPendingCount(): Promise<number> {
    await this.ensureStartupRecovery();
    if (!this.db) {
      return this.memoryQueue.filter((q) => q.status === 'pending').length;
    }
    const rows = await this.db.executeSql<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending';`
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Drains the mutation queue to the specified adapter in batches.
   * Emits batch requests, prunes completed rows on success, and applies
   * exponential backoff upon failure.
   */
  public async drain(adapter: SyncAdapter): Promise<{ pushedCount: number; failedCount: number }> {
    if (this.isDraining) {
      return { pushedCount: 0, failedCount: 0 };
    }
    if (adapter.getStatus().state === 'offline') {
      return { pushedCount: 0, failedCount: 0 };
    }

    this.isDraining = true;
    let totalPushed = 0;
    let totalFailed = 0;

    try {
      // Automatic recovery sweep: reset abandoned in_flight rows to pending before draining
      await this.recoverInFlight();
      this.hasRecoveredOnStartup = true;

      while (true) {
        const batch = await this.acquireBatch(this.batchSize);
        if (batch.length === 0) break;

        try {
          // Push items into adapter
          for (const item of batch) {
            let parsedPayload: any;
            try {
              parsedPayload = JSON.parse(item.payload);
            } catch {
              parsedPayload = item.payload;
            }
            adapter.queueMutation(
              item.entity_id,
              item.operation as SyncOperation,
              parsedPayload
            );
          }

          const syncRes = await adapter.sync();
          totalPushed += syncRes.pushedCount;

          if (syncRes.pushedCount === 0 || adapter.getStatus().state === 'offline') {
            if (syncRes.pushedCount > 0 && syncRes.pushedCount < batch.length) {
              const committed = batch.slice(0, syncRes.pushedCount);
              const unpushed = batch.slice(syncRes.pushedCount);
              await this.commitBatch(committed.map((b) => b.id));
              await this.rollbackBatch(unpushed.map((b) => b.id));
            } else if (syncRes.pushedCount === 0) {
              await this.rollbackBatch(batch.map((b) => b.id));
            } else {
              await this.commitBatch(batch.map((b) => b.id));
            }

            if (typeof (adapter as any).clearStagedMutations === 'function') {
              (adapter as any).clearStagedMutations();
            }
            break;
          }

          if (syncRes.pushedCount < batch.length) {
            const committed = batch.slice(0, syncRes.pushedCount);
            const unpushed = batch.slice(syncRes.pushedCount);
            await this.commitBatch(committed.map((b) => b.id));
            await this.rollbackBatch(unpushed.map((b) => b.id));
            if (typeof (adapter as any).clearStagedMutations === 'function') {
              (adapter as any).clearStagedMutations();
            }
            break;
          }

          // Commit batch: delete completed records from sync_queue
          await this.commitBatch(batch.map((b) => b.id));
        } catch (err: any) {
          totalFailed += batch.length;
          const errorMsg = err?.message || 'Unknown network error';
          if (typeof (adapter as any).clearStagedMutations === 'function') {
            (adapter as any).clearStagedMutations();
          }
          await this.rollbackBatch(batch.map((b) => b.id), errorMsg);
          break; // Stop draining on error
        }
      }
    } finally {
      this.isDraining = false;
    }

    return { pushedCount: totalPushed, failedCount: totalFailed };
  }

  /**
   * Acquires pending mutations, atomically marking them 'in_flight'.
   */
  public async acquireBatch(limit: number): Promise<SyncQueueRecord[]> {
    await this.ensureStartupRecovery();
    if (!this.db) {
      const pending = this.memoryQueue.filter((q) => q.status === 'pending').slice(0, limit);
      for (const p of pending) p.status = 'in_flight';
      return pending;
    }

    const rows = await this.db.executeSql<SyncQueueRecord>(
      `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY client_timestamp ASC LIMIT ?;`,
      [limit]
    );

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await this.db.executeSql(
      `UPDATE sync_queue SET status = 'in_flight' WHERE id IN (${placeholders});`,
      ids
    );

    return rows;
  }

  /**
   * Prunes completed records from the database upon successful sync.
   */
  private async commitBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    if (!this.db) {
      this.memoryQueue = this.memoryQueue.filter((q) => !ids.includes(q.id));
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    await this.db.executeSql(
      `DELETE FROM sync_queue WHERE id IN (${placeholders});`,
      ids
    );
  }

  /**
   * Reverts in-flight records back to 'pending' (or 'failed' if max retries exceeded)
   * and increments retry_count.
   */
  private async rollbackBatch(ids: string[], error: string = 'Network offline or sync failed'): Promise<void> {
    if (ids.length === 0) return;
    if (!this.db) {
      for (const item of this.memoryQueue) {
        if (ids.includes(item.id)) {
          item.retry_count += 1;
          item.last_error = error;
          item.status = item.retry_count >= this.maxRetries ? 'failed' : 'pending';
        }
      }
      return;
    }

    const placeholders = ids.map(() => '?').join(',');
    await this.db.executeSql(
      `UPDATE sync_queue 
       SET retry_count = retry_count + 1,
           last_error = ?,
           status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END
       WHERE id IN (${placeholders});`,
      [error, this.maxRetries, ...ids]
    );
  }

  /**
   * Calculates exponential backoff with 10% jitter.
   */
  public calculateBackoffMs(retryCount: number): number {
    const expDelay = Math.min(this.maxBackoffMs, this.baseBackoffMs * Math.pow(2, retryCount));
    const jitter = expDelay * 0.1 * Math.random();
    return Math.floor(expDelay + jitter);
  }

  public calculateBackoff(retryCount: number): number {
    return this.calculateBackoffMs(retryCount);
  }

  /**
   * Purges all queue rows (used in tests and database resets).
   */
  public async clear(): Promise<void> {
    if (!this.db) {
      this.memoryQueue = [];
      return;
    }
    await this.db.executeSql(`DELETE FROM sync_queue;`);
  }
}
