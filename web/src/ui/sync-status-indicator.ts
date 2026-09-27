/**
 * src/ui/sync-status-indicator.ts
 * Daylight Writer - Top-Bar Live Sync Status Indicator Pill
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 *
 * Adheres strictly to Sol:OS neutral grayscale tokens (--os-0 to --os-1000)
 * Zero EPD waveforms, GPU Skia/HWUI composition.
 */

import type { SyncAdapter, SyncStatus, SyncEvent } from '../sync/sync-adapter.ts';

export type SyncIndicatorFormat = 'classic' | 'solos';

export interface SyncStatusIndicatorOptions {
  onRetry?: () => void;
  onRetryClick?: () => void;
  onClick?: () => void;
  modal?: { open: () => void; toggle: () => void };
  format?: SyncIndicatorFormat;
  showTimestamp?: boolean;
}

export class SyncStatusIndicator {
  public element: HTMLElement | null = null;
  public glyphEl: HTMLElement | null = null;
  public labelEl: HTMLElement | null = null;
  private adapter: SyncAdapter | null = null;
  private unsubscribe: (() => void) | null = null;
  private options: SyncStatusIndicatorOptions;
  private currentStatus: SyncStatus = { state: 'synced', pendingCount: 0, inFlightCount: 0, lastSyncedAt: null };
  private format: SyncIndicatorFormat = 'classic';

  constructor(containerOrOptions?: HTMLElement | SyncStatusIndicatorOptions, options?: SyncStatusIndicatorOptions) {
    if (typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement) {
      this.options = options || {};
      this.format = this.options.format || 'classic';
      if (containerOrOptions.id === 'sync-status-pill') {
        this.element = containerOrOptions;
        if (!this.element.hasAttribute('tabindex')) {
          this.element.setAttribute('tabindex', '0');
        }
        this.glyphEl = this.element.querySelector('.sync-status-glyph');
        this.labelEl = this.element.querySelector('.sync-status-label');
        if (this.glyphEl && this.format === 'solos') {
          this.glyphEl.textContent = '●';
        }
        this.attachEventListeners();
      } else {
        this.mount(containerOrOptions);
      }
    } else {
      this.options = (containerOrOptions as SyncStatusIndicatorOptions) || {};
      this.format = this.options.format || 'classic';
    }
  }

  public setFormat(format: SyncIndicatorFormat): void {
    this.format = format;
    this.update(this.currentStatus);
  }

  public getFormat(): SyncIndicatorFormat {
    return this.format;
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
    this.element.setAttribute('tabindex', '0');
    this.element.title = 'All edits saved locally and synced';

    this.glyphEl = doc.createElement('span');
    this.glyphEl.className = 'sync-status-glyph';
    this.glyphEl.setAttribute('aria-hidden', 'true');
    this.glyphEl.textContent = this.format === 'solos' ? '●' : '✓';

    this.labelEl = doc.createElement('span');
    this.labelEl.className = 'sync-status-label';
    this.labelEl.textContent = 'Synced';

    this.element.appendChild(this.glyphEl);
    this.element.appendChild(this.labelEl);

    this.attachEventListeners();

    container.appendChild(this.element);
    return this.element;
  }

  private attachEventListeners(): void {
    if (!this.element) return;

    this.element.addEventListener('click', () => {
      if (this.element?.classList.contains('sync-state-error')) {
        if (this.options.onRetry) {
          this.options.onRetry();
        } else if (this.options.onRetryClick) {
          this.options.onRetryClick();
        }
      } else {
        if (this.options.onClick) {
          this.options.onClick();
        } else if (this.options.modal) {
          this.options.modal.open();
        }
      }
    });

    this.element.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.element?.click();
      }
    });
  }

  private formatTime(timestamp?: number | null): string {
    if (!timestamp) return 'Just now';
    const diffMs = Date.now() - timestamp;
    if (diffMs < 60000 && diffMs >= 0) {
      return 'Just now';
    }
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * Updates visual appearance based on latest SyncStatus snapshot.
   */
  public update(status: SyncStatus): void {
    this.currentStatus = status;
    if (!this.element || !this.glyphEl || !this.labelEl) return;

    // Reset state classes
    this.element.className = 'sync-status-pill';

    const state = status.state;
    const isSolos = this.format === 'solos';

    if (state === 'syncing') {
      this.element.classList.add('sync-state-syncing');
      this.glyphEl.textContent = isSolos ? '↻' : '◐';
      const count = status.pendingCount || 0;
      if (isSolos && count > 0) {
        this.labelEl.textContent = `Syncing... ${count}`;
      } else {
        this.labelEl.textContent = 'Syncing...';
      }
      this.element.title = 'Synchronizing edits with cloud...';
    } else if (state === 'offline') {
      this.element.classList.add('sync-state-offline');
      this.glyphEl.textContent = isSolos ? '○' : '⊘';
      const count = status.pendingCount || 0;
      if (isSolos) {
        this.labelEl.textContent = count > 0 ? `Offline (${count})` : 'Offline';
      } else {
        this.labelEl.textContent = count > 0 ? `Offline (${count})` : 'Offline';
      }
      this.element.title = count > 0
        ? `${count} changes queued locally offline`
        : 'Working offline; changes save locally';
    } else if (state === 'error') {
      this.element.classList.add('sync-state-error');
      this.glyphEl.textContent = '⚠';
      this.labelEl.textContent = isSolos ? 'Error' : 'Sync Error';
      this.element.title = status.error ? `${status.error} (Click to retry)` : 'Sync failed (Click to retry)';
    } else {
      // 'synced' or 'idle'
      this.element.classList.add('sync-state-synced');
      this.glyphEl.textContent = isSolos ? '●' : '✓';
      if (isSolos && (status.lastSyncedAt || this.options.showTimestamp)) {
        this.labelEl.textContent = `Synced ${this.formatTime(status.lastSyncedAt)}`;
      } else {
        this.labelEl.textContent = 'Synced';
      }
      this.element.title = status.lastSyncedAt
        ? `Last synced at ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
        : 'All edits saved locally and synced';
    }
  }

  /**
   * Helper returning the combined formatted text (glyph + space + label)
   */
  public getFormattedStateText(): string {
    const glyph = this.glyphEl?.textContent || '';
    const label = this.labelEl?.textContent || '';
    return `${glyph} ${label}`.trim();
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
