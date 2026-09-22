/**
 * src/sync/sync-adapter.ts
 * Daylight Writer - Pluggable Sync Adapter Contract
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';

/**
 * Synchronization lifecycle states:
 * - 'idle' / 'synced': Up-to-date, zero mutations in flight or pending.
 * - 'syncing': Pushing local mutations or pulling remote updates.
 * - 'offline': Disconnected from network; edits safely queueing in SQLite.
 * - 'error': Synchronization interrupted by network or remote provider failure.
 */
export type SyncState = 'idle' | 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  pendingCount: number;
  inFlightCount?: number;
  error?: string | null;
}

export type SyncEntityType = 'document' | 'margin_note' | 'tag' | 'document_tag';
export type SyncOperation = 'create' | 'update' | 'delete';

export interface SyncMutation<T = any> {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperation;
  payload: T;
  client_timestamp: number;
  retry_count?: number;
  last_error?: string | null;
}

export interface SyncPushResult {
  pushedCount: number;
  failedIds?: string[];
  errors?: Array<{ entityId: string; error: string }>;
}

export interface SyncPullResult {
  documents: DocumentRecord[];
  notes: ThoughtNoteRecord[];
  remoteTimestamp: number;
}

export interface SyncResult {
  pushedCount: number;
  pulledCount: number;
  errors?: Array<{ entityId: string; error: string }>;
  durationMs?: number;
}

export type ConflictResolutionStrategy =
  | 'last-write-wins'
  | 'local-wins'
  | 'remote-wins'
  | 'manual';

export type SyncEventType =
  | 'status_change'
  | 'sync_start'
  | 'sync_complete'
  | 'sync_error'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'mutation_enqueued';

export interface SyncEvent {
  type: SyncEventType;
  status: SyncStatus;
  timestamp: number;
  details?: {
    pushedCount?: number;
    pulledCount?: number;
    error?: string;
    conflict?: {
      localDoc: DocumentRecord;
      remoteDoc: DocumentRecord;
      resolvedDoc?: DocumentRecord;
      strategy?: ConflictResolutionStrategy;
    };
    mutation?: SyncMutation;
  };
}

export type SyncEventListener = (event: SyncEvent) => void;

/**
 * Universal SyncAdapter Contract
 * Strictly adheres to PROJECT.md § Interface Contracts while providing
 * full push/pull batch lifecycle and event listener capabilities.
 */
export interface SyncAdapter {
  readonly id: string;
  readonly name: string;

  /** Initialize adapter credentials, connection, and initial state */
  init(): Promise<void>;

  /** Execute bi-directional sync (push pending local mutations, pull remote updates) */
  sync(): Promise<{ pushedCount: number; pulledCount: number }>;

  /** Retrieve snapshot of current sync status */
  getStatus(): SyncStatus;

  /** Resolve conflicts between local and remote document states */
  resolveConflict(
    localDoc: DocumentRecord,
    remoteDoc: DocumentRecord,
    strategy?: ConflictResolutionStrategy
  ): Promise<DocumentRecord>;

  /** Subscribe to sync status changes and lifecycle events */
  subscribe(listener: SyncEventListener): () => void;

  /** Fast-path / test helper to queue a mutation directly */
  queueMutation(docId: string, type: SyncOperation, payload: any): void;

  /** Set online / offline status manually or via network listener */
  setOnline(online: boolean): void;

  /** Clear staged mutations in memory */
  clearStagedMutations(): void;

  /** Push batch of mutations to cloud provider */
  push?(mutations: SyncMutation[]): Promise<SyncPushResult>;

  /** Pull changes updated since given timestamp */
  pull?(sinceTimestamp?: number): Promise<SyncPullResult>;

  /** Teardown listeners and resources */
  destroy?(): void;
}
