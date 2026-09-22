/**
 * src/ui/google-drive-modal.ts
 * Daylight Writer - Google Drive & Google Docs Sync Dialog UI
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 *
 * Adheres strictly to Sol:OS neutral grayscale tokens (--os-0 to --os-1000)
 * Zero EPD waveforms, GPU Skia/HWUI composition.
 */

import { GoogleDriveSyncAdapter } from '../sync/google-drive-sync-adapter.ts';

export interface GoogleDriveModalOptions {
  container?: HTMLElement;
  adapter: GoogleDriveSyncAdapter;
  onSyncTriggered?: () => Promise<void>;
}

export class GoogleDriveModal {
  private container: HTMLElement;
  private adapter: GoogleDriveSyncAdapter;
  private overlay: HTMLElement | null = null;
  private isOpen: boolean = false;
  private onSyncTriggered?: () => Promise<void>;

  constructor(options: GoogleDriveModalOptions) {
    this.container = options.container || document.body;
    this.adapter = options.adapter;
    this.onSyncTriggered = options.onSyncTriggered;
  }

  public open(): void {
    if (this.isOpen) return;
    this.render();
    this.isOpen = true;
  }

  public close(): void {
    if (!this.isOpen || !this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.isOpen = false;
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private render(): void {
    const doc = this.container.ownerDocument || document;
    this.overlay = doc.createElement('div');
    this.overlay.className = 'export-modal-backdrop gdrive-modal-backdrop';

    const modal = doc.createElement('div');
    modal.className = 'export-dialog-card gdrive-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'gdrive-modal-title');

    const currentUser = this.adapter.getCurrentUser();
    const isAuth = this.adapter.isAuthenticated();
    const userEmail = currentUser?.email || (isAuth ? 'a12katta@gmail.com' : 'Not Connected');
    const logs = this.adapter.syncLogs.slice(0, 5);

    modal.innerHTML = `
      <div class="export-modal-header">
        <div>
          <h2 id="gdrive-modal-title" class="export-modal-title">Google Drive & Docs Sync</h2>
          <div class="export-dialog-subtitle">Automated bi-directional manuscript cloud synchronization</div>
        </div>
        <button class="export-modal-close" id="gdrive-modal-close" aria-label="Close">✕</button>
      </div>

      <div class="export-modal-body">
        <!-- Account Status Section -->
        <div class="gdrive-account-card">
          <div class="gdrive-account-info">
            <div class="gdrive-avatar">${userEmail[0].toUpperCase()}</div>
            <div class="gdrive-details">
              <span class="gdrive-user-email">${userEmail}</span>
              <span class="gdrive-status-badge ${isAuth ? 'connected' : 'disconnected'}">
                ${isAuth ? '● Connected & Ready' : '○ Local Offline Mode'}
              </span>
            </div>
          </div>
          <button class="btn-export-secondary" id="gdrive-auth-btn">
            ${isAuth ? 'Disconnect' : 'Connect Account'}
          </button>
        </div>

        <!-- Token Authentication Row -->
        <div class="collab-section">
          <label class="collab-label">OAuth Bearer Token / Test Key</label>
          <div class="collab-room-row">
            <input type="password" class="collab-input" id="gdrive-token-input" 
                   placeholder="Paste Google OAuth token (ya29...)" 
                   value="${this.adapter.getAccessToken() || ''}" />
            <button class="btn-export-secondary" id="gdrive-save-token-btn">Verify Token</button>
          </div>
          <span class="collab-hint">To test with a12katta@gmail.com, paste a token from Google OAuth Playground or click Connect.</span>
        </div>

        <!-- Target Drive Folder -->
        <div class="collab-section">
          <label class="collab-label">Target Google Drive Folder</label>
          <div class="gdrive-folder-pill">
            <span class="gdrive-folder-icon">📁</span>
            <span class="gdrive-folder-name">Daylight Manuscripts</span>
            <span class="gdrive-folder-path">My Drive / Daylight Manuscripts</span>
          </div>
        </div>

        <!-- Live Sync Activity Log -->
        <div class="collab-section">
          <label class="collab-label">Sync Activity Log</label>
          <div class="gdrive-log-box thin-scrollbar" id="gdrive-log-box">
            ${
              logs.length > 0
                ? logs
                    .map(
                      (l) =>
                        `<div class="gdrive-log-line log-${l.type}">
                          <span class="log-time">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
                          <span class="log-msg">${l.message}</span>
                        </div>`
                    )
                    .join('')
                : '<div class="gdrive-log-empty">No recent sync actions. Click "Sync to Drive Now" to upload active draft.</div>'
            }
          </div>
        </div>
      </div>

      <div class="export-modal-footer">
        <button class="btn-export-secondary" id="gdrive-footer-cancel">Close</button>
        <button class="btn-export-primary" id="gdrive-sync-now-btn">
          <span>Sync to Drive Now</span>
        </button>
      </div>
    `;

    this.overlay.appendChild(modal);
    this.container.appendChild(this.overlay);

    // Event listeners
    const closeBtn = modal.querySelector('#gdrive-modal-close') as HTMLElement;
    const cancelBtn = modal.querySelector('#gdrive-footer-cancel') as HTMLElement;
    closeBtn?.addEventListener('click', () => this.close());
    cancelBtn?.addEventListener('click', () => this.close());

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Token save button
    const saveTokenBtn = modal.querySelector('#gdrive-save-token-btn') as HTMLElement;
    const tokenInput = modal.querySelector('#gdrive-token-input') as HTMLInputElement;
    saveTokenBtn?.addEventListener('click', async () => {
      const val = tokenInput.value.trim();
      if (val) {
        this.adapter.setAccessToken(val);
        saveTokenBtn.textContent = 'Verifying...';
        try {
          const user = await this.adapter.verifyAuthentication();
          saveTokenBtn.textContent = 'Verified ✓';
          this.refreshLog();
          setTimeout(() => this.render(), 400);
        } catch (err: any) {
          saveTokenBtn.textContent = 'Failed';
          this.refreshLog();
        }
      } else {
        this.adapter.setAccessToken(null);
        this.render();
      }
    });

    // Auth / Disconnect button
    const authBtn = modal.querySelector('#gdrive-auth-btn') as HTMLElement;
    authBtn?.addEventListener('click', () => {
      if (this.adapter.isAuthenticated()) {
        this.adapter.setAccessToken(null);
        this.render();
      } else {
        // Quick demo token or real prompt
        tokenInput.focus();
      }
    });

    // Sync now button
    const syncBtn = modal.querySelector('#gdrive-sync-now-btn') as HTMLButtonElement;
    syncBtn?.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing to Drive...';
      try {
        if (this.onSyncTriggered) {
          await this.onSyncTriggered();
        } else {
          await this.adapter.sync();
        }
        syncBtn.textContent = 'Synced Successfully ✓';
        this.refreshLog();
        setTimeout(() => {
          syncBtn.textContent = 'Sync to Drive Now';
          syncBtn.disabled = false;
        }, 1500);
      } catch (err: any) {
        syncBtn.textContent = 'Sync Failed';
        this.refreshLog();
        setTimeout(() => {
          syncBtn.textContent = 'Retry Sync';
          syncBtn.disabled = false;
        }, 2000);
      }
    });

    // Keydown Esc to close
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);
  }

  private refreshLog(): void {
    const logBox = this.overlay?.querySelector('#gdrive-log-box');
    if (!logBox) return;
    const logs = this.adapter.syncLogs.slice(0, 5);
    logBox.innerHTML = logs
      .map(
        (l) =>
          `<div class="gdrive-log-line log-${l.type}">
            <span class="log-time">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
            <span class="log-msg">${l.message}</span>
          </div>`
      )
      .join('');
  }
}
