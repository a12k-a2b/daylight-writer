/**
 * src/ui/sync-status-indicator.ts
 * Daylight Writer - Top-Bar Live Sync Status Indicator Pill
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 *
 * Adheres strictly to Sol:OS neutral grayscale tokens (--os-0 to --os-1000)
 * Zero EPD waveforms, GPU Skia/HWUI composition.
 */

import type { SyncAdapter, SyncStatus, SyncEvent } from '../sync/sync-adapter.ts';

export interface SyncStatusIndicatorOptions {
  onRetry?: () => void;
  onRetryClick?: () => void;
}

export class SyncStatusIndicator {
  public element: HTMLElement | null = null;
  public glyphEl: HTMLElement | null = null;
  public labelEl: HTMLElement | null = null;
  private adapter: SyncAdapter | null = null;
  private unsubscribe: (() => void) | null = null;
  private options: SyncStatusIndicatorOptions;

  constructor(containerOrOptions?: HTMLElement | SyncStatusIndicatorOptions, options?: SyncStatusIndicatorOptions) {
    if (typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement) {
      this.options = options || {};
      if (containerOrOptions.id === 'sync-status-pill') {
        this.element = containerOrOptions;
        this.glyphEl = this.element.querySelector('.sync-status-glyph');
        this.labelEl = this.element.querySelector('.sync-status-label');
        this.element.addEventListener('click', () => {
          if (this.element?.classList.contains('sync-state-error')) {
            if (this.options.onRetry) {
              this.options.onRetry();
            } else if (this.options.onRetryClick) {
              this.options.onRetryClick();
            }
          }
        });
      } else {
        this.mount(containerOrOptions);
      }
    } else {
      this.options = (containerOrOptions as SyncStatusIndicatorOptions) || {};
    }
  }

  /**
   * Mounts the indicator inside the specified parent container
   * (e.g. .editor-header right section).
   */
  public mount(container: HTMLElement): HTMLElement {
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return ({} as HTMLElement);

    this.element = doc.createElement('div');
    this.element.id = 'sync-status-pill';
    this.element.className = 'sync-status-pill sync-state-synced';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.title = 'All edits saved locally and synced';

    this.glyphEl = doc.createElement('span');
    this.glyphEl.className = 'sync-status-glyph';
    this.glyphEl.setAttribute('aria-hidden', 'true');
    this.glyphEl.textContent = '✓';

    this.labelEl = doc.createElement('span');
    this.labelEl.className = 'sync-status-label';
    this.labelEl.textContent = 'Synced';

    this.element.appendChild(this.glyphEl);
    this.element.appendChild(this.labelEl);

    this.element.addEventListener('click', () => {
      if (this.element?.classList.contains('sync-state-error')) {
        if (this.options.onRetry) {
          this.options.onRetry();
        } else if (this.options.onRetryClick) {
          this.options.onRetryClick();
        }
      }
    });

    container.appendChild(this.element);
    return this.element;
  }

  /**
   * Updates visual appearance based on latest SyncStatus snapshot.
   */
  public update(status: SyncStatus): void {
    if (!this.element || !this.glyphEl || !this.labelEl) return;

    // Reset state classes
    this.element.className = 'sync-status-pill';

    const state = status.state;

    if (state === 'syncing') {
      this.element.classList.add('sync-state-syncing');
      this.glyphEl.textContent = '◐';
      this.labelEl.textContent = 'Syncing...';
      this.element.title = 'Synchronizing edits with cloud...';
    } else if (state === 'offline') {
      this.element.classList.add('sync-state-offline');
      this.glyphEl.textContent = '⊘';
      const count = status.pendingCount || 0;
      this.labelEl.textContent = count > 0 ? `Offline (${count})` : 'Offline';
      this.element.title = count > 0
        ? `${count} changes queued locally offline`
        : 'Working offline; changes save locally';
    } else if (state === 'error') {
      this.element.classList.add('sync-state-error');
      this.glyphEl.textContent = '⚠';
      this.labelEl.textContent = 'Sync Error';
      this.element.title = status.error ? `${status.error} (Click to retry)` : 'Sync failed (Click to retry)';
    } else {
      // 'synced' or 'idle'
      this.element.classList.add('sync-state-synced');
      this.glyphEl.textContent = '✓';
      this.labelEl.textContent = 'Synced';
      this.element.title = status.lastSyncedAt
        ? `Last synced at ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
        : 'All edits saved locally and synced';
    }
  }

  /**
   * Binds to a SyncAdapter instance, listening to live state events.
   */
  public bindAdapter(adapter: SyncAdapter): void {
    this.adapter = adapter;
    this.update(adapter.getStatus());

    if (typeof adapter.subscribe === 'function') {
      this.unsubscribe = adapter.subscribe((event: SyncEvent) => {
        this.update(event.status);
      });
    }
  }

  public bindSyncAdapter(adapter: SyncAdapter): void {
    this.bindAdapter(adapter);
  }

  public destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
      this.element = null;
    }
  }
}
