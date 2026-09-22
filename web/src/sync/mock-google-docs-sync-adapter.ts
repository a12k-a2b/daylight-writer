/**
 * src/sync/mock-google-docs-sync-adapter.ts
 * Daylight Writer - Deterministic Hermetic Mock Google Docs Sync Adapter
 * Implements Acceptance Criteria R6 and Features F34, F35, F36.
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type {
  SyncAdapter,
  SyncStatus,
  SyncMutation,
  SyncEvent,
  SyncEventListener,
  ConflictResolutionStrategy,
  SyncOperation,
} from './sync-adapter.ts';
import type { DocumentRecord } from '../storage/schema.ts';

export interface RemoteDriveFile {
  fileId: string;
  docId: string;
  title: string;
  content: string;
  revisionId: string;
  versionVector: number;
  modifiedTime: number; // UTC ms
  createdTime: number;
  trashed: boolean;
  properties: Record<string, string>;
}

export type MockFailureMode = 'none' | 'timeout' | 'auth_expired' | 'rate_limit' | 'server_error';

export interface MockGoogleDocsSyncConfig {
  initialOnline?: boolean;
  simulateNetworkDelayMs?: number;
  simulatedLatencyMs?: number;
  simulateFailure?: boolean;
  failureMode?: MockFailureMode;
}

export class MockGoogleDocsSyncAdapter implements SyncAdapter {
  public readonly id = 'mock-google-docs';
  public readonly name = 'Google Docs (Mock)';

  private status: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    pendingCount: 0,
    inFlightCount: 0,
    error: null,
  };

  // Virtual Remote Google Drive file storage
  private remoteFiles: Map<string, RemoteDriveFile> = new Map();
  private revisionCounter: number = 0;

  // In-memory pending queue for direct adapter queueMutation calls
  private queue: SyncMutation[] = [];

  // Configurable knobs
  public isOnline: boolean = true;
  public simulateNetworkDelayMs: number = 0;
  public simulateFailure: boolean = false;
  public failureMode: MockFailureMode = 'none';

  // Event listeners
  private listeners: Set<SyncEventListener> = new Set();

  // Audit history
  public callHistory: Array<{ method: string; timestamp: number; args: any }> = [];

  constructor(config: MockGoogleDocsSyncConfig = {}) {
    if (config.initialOnline !== undefined) this.isOnline = config.initialOnline;
    if (config.simulateNetworkDelayMs !== undefined) this.simulateNetworkDelayMs = config.simulateNetworkDelayMs;
    if (config.simulatedLatencyMs !== undefined) this.simulateNetworkDelayMs = config.simulatedLatencyMs;
    if (config.simulateFailure !== undefined) this.simulateFailure = config.simulateFailure;
    if (config.failureMode !== undefined) this.failureMode = config.failureMode;
    this.status.state = this.isOnline ? 'idle' : 'offline';
  }

  public get simulateDelayMs(): number {
    return this.simulateNetworkDelayMs;
  }
  public set simulateDelayMs(val: number) {
    this.simulateNetworkDelayMs = val;
  }

  public async init(): Promise<void> {
    this.recordCall('init', {});
    this.status.state = this.isOnline ? 'idle' : 'offline';
    this.emitEvent('status_change');
  }

  public queueMutation(
    docId: string,
    type: SyncOperation,
    payload: any
  ): void {
    const mutation: SyncMutation = {
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      entity_type: 'document',
      entity_id: docId,
      operation: type,
      payload,
      client_timestamp: Date.now(),
    };
    this.queue.push(mutation);
    this.status.pendingCount = this.queue.length;
    this.emitEvent('mutation_enqueued', { mutation });
  }

  public clearStagedMutations(): void {
    this.queue = [];
    this.status.pendingCount = 0;
  }

  public async sync(): Promise<{ pushedCount: number; pulledCount: number }> {
    this.recordCall('sync', {});

    // 1. Offline Check
    if (!this.isOnline) {
      this.status.state = 'offline';
      this.emitEvent('status_change');
      return { pushedCount: 0, pulledCount: 0 };
    }

    try {
      // 2. Simulated Failure Check
      if (this.simulateFailure || this.failureMode !== 'none') {
        this.status.state = 'error';
        this.status.error = 'Network connection timed out';
        this.emitEvent('sync_error', { error: this.status.error });

        if (this.failureMode === 'auth_expired') {
          throw new Error('Sync failed: Google OAuth token expired (401)');
        }
        if (this.failureMode === 'rate_limit') {
          throw new Error('Sync failed: Google Drive API Rate limit exceeded (429)');
        }
        if (this.failureMode === 'server_error') {
          throw new Error('Sync failed: Internal Server Error (503)');
        }
        // Default matching test assertion: /Sync failed: Network timeout/
        throw new Error('Sync failed: Network timeout');
      }

      // 3. Begin Syncing State
      this.status.state = 'syncing';
      this.status.error = null;
      this.emitEvent('sync_start');

      if (this.simulateNetworkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.simulateNetworkDelayMs));
      }

      // 4. Push Pending Mutations to Virtual Remote Drive
      const mutationsToPush = [...this.queue];
      let pushedCount = 0;

      for (const mut of mutationsToPush) {
        this.applyMutationToRemote(mut);
        pushedCount++;
      }

      this.clearStagedMutations();
      this.status.lastSyncedAt = Date.now();
      this.status.state = 'idle';

      this.emitEvent('sync_complete', { pushedCount, pulledCount: 0 });
      this.emitEvent('status_change');

      return { pushedCount, pulledCount: 0 };
    } catch (err: any) {
      this.clearStagedMutations();
      if (this.status.state !== 'error') {
        const errorMsg = err?.message || 'Sync failed';
        this.status.state = 'error';
        this.status.error = errorMsg;
        this.emitEvent('sync_error', { error: errorMsg });
      }
      throw err;
    }
  }

  private applyMutationToRemote(mut: SyncMutation): void {
    const now = Date.now();
    const docId = mut.entity_id;
    let existing = this.remoteFiles.get(docId);

    if (mut.operation === 'delete') {
      if (existing) {
        existing.trashed = true;
        existing.modifiedTime = mut.client_timestamp || now;
      }
      return;
    }

    const payload = mut.payload || {};
    this.revisionCounter++;
    const revisionId = `rev-${this.revisionCounter}`;

    if (!existing) {
      existing = {
        fileId: `gdoc-${docId}`,
        docId,
        title: payload.title || 'Untitled',
        content: payload.content || '',
        revisionId,
        versionVector: payload.version_vector || 1,
        modifiedTime: mut.client_timestamp || now,
        createdTime: payload.created_at || now,
        trashed: false,
        properties: {},
      };
      this.remoteFiles.set(docId, existing);
    } else {
      existing.title = payload.title !== undefined ? payload.title : existing.title;
      existing.content = payload.content !== undefined ? payload.content : existing.content;
      existing.revisionId = revisionId;
      existing.versionVector = (existing.versionVector || 0) + 1;
      existing.modifiedTime = mut.client_timestamp || now;
      existing.trashed = false;
    }
  }

  public getStatus(): SyncStatus {
    return {
      ...this.status,
      state: !this.isOnline ? 'offline' : this.status.state,
    };
  }

  public async resolveConflict(
    localDoc: DocumentRecord,
    remoteDoc: DocumentRecord,
    strategy: ConflictResolutionStrategy = 'last-write-wins'
  ): Promise<DocumentRecord> {
    this.recordCall('resolveConflict', { localDoc, remoteDoc, strategy });
    this.emitEvent('conflict_detected', { conflict: { localDoc, remoteDoc, strategy } });

    let resolved: DocumentRecord;

    if (strategy === 'local-wins') {
      resolved = { ...localDoc, sync_status: 'synced', last_synced_at: Date.now() };
    } else if (strategy === 'remote-wins') {
      resolved = { ...remoteDoc, sync_status: 'synced', last_synced_at: Date.now() };
    } else {
      // Last-Write-Wins (LWW) based on chronological millisecond integrity
      if (localDoc.updated_at >= remoteDoc.updated_at) {
        resolved = {
          ...localDoc,
          sync_status: 'synced',
          google_drive_file_id: remoteDoc.google_drive_file_id || localDoc.google_drive_file_id,
          google_drive_revision_id: remoteDoc.google_drive_revision_id || localDoc.google_drive_revision_id,
          last_synced_at: Date.now(),
        };
      } else {
        resolved = {
          ...remoteDoc,
          sync_status: 'synced',
          last_synced_at: Date.now(),
        };
      }
    }

    this.emitEvent('conflict_resolved', { conflict: { localDoc, remoteDoc, resolvedDoc: resolved, strategy } });
    return resolved;
  }

  public setOnline(online: boolean): void {
    this.isOnline = online;
    this.status.state = online ? 'idle' : 'offline';
    this.emitEvent('status_change');
  }

  public subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitEvent(type: SyncEvent['type'], details?: SyncEvent['details']): void {
    const event: SyncEvent = {
      type,
      status: this.getStatus(),
      timestamp: Date.now(),
      details,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[MockGoogleDocsSyncAdapter] Listener threw error:', err);
      }
    }
  }

  private recordCall(method: string, args: any): void {
    this.callHistory.push({ method, timestamp: Date.now(), args });
  }

  // Diagnostic / Test Helper Accessors
  public getRemoteFile(docId: string): RemoteDriveFile | undefined {
    return this.remoteFiles.get(docId);
  }

  public seedRemoteDocument(doc: Partial<RemoteDriveFile> & { docId: string }): void {
    this.remoteFiles.set(doc.docId, {
      fileId: doc.fileId || `gdoc-${doc.docId}`,
      docId: doc.docId,
      title: doc.title || 'Untitled',
      content: doc.content || '',
      revisionId: doc.revisionId || `rev-${++this.revisionCounter}`,
      versionVector: doc.versionVector || 1,
      modifiedTime: doc.modifiedTime || Date.now(),
      createdTime: doc.createdTime || Date.now(),
      trashed: doc.trashed || false,
      properties: doc.properties || {},
    });
  }

  public clearRemoteFiles(): void {
    this.remoteFiles.clear();
  }

  public setSimulatedFailure(simulate: boolean, mode: MockFailureMode = 'none'): void {
    this.simulateFailure = simulate;
    this.failureMode = simulate ? (mode !== 'none' ? mode : 'timeout') : 'none';
  }

  public setRemoteDocumentDirectly(doc: DocumentRecord): void {
    this.seedRemoteDocument({
      docId: doc.id,
      title: doc.title || '',
      content: doc.content || '',
      modifiedTime: doc.updated_at,
      createdTime: doc.created_at,
    });
  }

  public async pullDocument(docId: string): Promise<DocumentRecord | null> {
    const file = this.getRemoteFile(docId);
    if (!file || file.trashed) return null;
    return {
      id: file.docId,
      title: file.title,
      content: file.content,
      is_title_custom: true,
      format_version: 1,
      created_at: file.createdTime,
      updated_at: file.modifiedTime,
      deleted_at: null,
      google_drive_file_id: file.fileId,
      google_drive_revision_id: file.revisionId,
      sync_status: 'synced',
    };
  }

  public async pushDocument(doc: DocumentRecord): Promise<{
    success: boolean;
    revisionId?: string;
    conflictResolved?: boolean;
    winner?: 'client' | 'remote';
  }> {
    if (this.simulateFailure || this.failureMode !== 'none') {
      this.status.state = 'error';
      this.status.error = 'Sync failed: Network timeout';
      throw new Error('Sync failed: Network timeout');
    }
    const remote = this.getRemoteFile(doc.id);
    if (remote && remote.modifiedTime > doc.updated_at) {
      // Remote wins
      return {
        success: true,
        revisionId: remote.revisionId,
        conflictResolved: true,
        winner: 'remote',
      };
    }
    this.queueMutation(doc.id, remote ? 'update' : 'create', doc);
    await this.sync();
    const updated = this.getRemoteFile(doc.id);
    return {
      success: true,
      revisionId: updated?.revisionId,
      conflictResolved: false,
      winner: 'client',
    };
  }
}
