/**
 * src/sync/network-listener.ts
 * Daylight Writer - Network Connectivity Listener & Auto-Sync Trigger
 * Implements Features F37 & F38.
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type { SyncAdapter } from './sync-adapter.ts';
import type { OfflineMutationQueue } from './offline-mutation-queue.ts';

export class NetworkListener {
  private adapter: SyncAdapter;
  private queue?: OfflineMutationQueue;
  private boundOnline: () => void;
  private boundOffline: () => void;
  private isListening: boolean = false;

  constructor(adapter: SyncAdapter, queue?: OfflineMutationQueue) {
    this.adapter = adapter;
    this.queue = queue;

    this.boundOnline = () => {
      void this.handleOnline();
    };
    this.boundOffline = () => {
      this.handleOffline();
    };
  }

  public start(): void {
    if (this.isListening || typeof window === 'undefined') return;

    window.addEventListener('online', this.boundOnline);
    window.addEventListener('offline', this.boundOffline);
    this.isListening = true;

    // Initialize with current navigator state if available
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.adapter.setOnline(false);
    }
  }

  public stop(): void {
    if (!this.isListening || typeof window === 'undefined') return;

    window.removeEventListener('online', this.boundOnline);
    window.removeEventListener('offline', this.boundOffline);
    this.isListening = false;
  }

  public async handleOnline(): Promise<void> {
    this.adapter.setOnline(true);

    // If queue is configured, drain queued mutations
    if (this.queue) {
      await this.queue.drain(this.adapter);
    } else {
      await this.adapter.sync();
    }
  }

  public handleOffline(): void {
    this.adapter.setOnline(false);
  }
}
