/**
 * src/ui/collaboration-modal.ts
 * Daylight Writer - Live Collaboration Settings & Share Modal
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Sol:OS 8-bit Grayscale Tokens (--os-0 to --os-1000)
 */

import type { CollaborationManager, PeerState } from '../editor/tiptap-collaboration.ts';

export interface CollaborationModalOptions {
  container: HTMLElement;
  manager: CollaborationManager;
  onClose?: () => void;
}

export class CollaborationModal {
  private container: HTMLElement;
  private manager: CollaborationManager;
  private overlay: HTMLElement | null = null;
  private onClose?: () => void;
  private keydownHandler?: (e: KeyboardEvent) => void;

  constructor(options: CollaborationModalOptions) {
    this.container = options.container;
    this.manager = options.manager;
    this.onClose = options.onClose;
  }

  public open(): void {
    if (this.overlay) return;

    const doc = this.container.ownerDocument || document;
    this.overlay = doc.createElement('div');
    this.overlay.className = 'export-modal-backdrop collab-modal-backdrop';

    const modal = doc.createElement('div');
    modal.className = 'export-modal collab-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'collab-modal-title');

    modal.innerHTML = `
      <div class="export-modal-header">
        <h2 id="collab-modal-title" class="export-modal-title">Live Collaboration</h2>
        <button class="export-modal-close" aria-label="Close">✕</button>
      </div>

      <div class="export-modal-body">
        <div class="collab-section">
          <label class="collab-label">Room Identifier</label>
          <div class="collab-room-row">
            <input type="text" class="collab-input" id="collab-room-input" readonly value="${this.manager.roomName}" />
            <button class="btn-export-secondary" id="collab-copy-btn">Copy</button>
          </div>
          <span class="collab-hint">Share this room name with another Daylight tablet or desktop browser.</span>
        </div>

        <div class="collab-section" style="margin-top: 16px;">
          <label class="collab-label">Your Collaborator Name</label>
          <div class="collab-room-row">
            <input type="text" class="collab-input" id="collab-name-input" value="${this.manager.localUser.name}" placeholder="Your name" />
            <button class="btn-export-secondary" id="collab-save-name-btn">Update</button>
          </div>
        </div>

        <div class="collab-section" style="margin-top: 16px;">
          <label class="collab-label">Connection Mode</label>
          <div class="collab-mode-group">
            <label class="collab-mode-option">
              <input type="radio" name="collab-mode" value="hocuspocus" ${this.manager.activeProviderType === 'hocuspocus' ? 'checked' : ''} />
              <span>Hocuspocus Server</span>
            </label>
            <label class="collab-mode-option">
              <input type="radio" name="collab-mode" value="webrtc" ${this.manager.activeProviderType === 'webrtc' ? 'checked' : ''} />
              <span>Peer-to-Peer (WebRTC)</span>
            </label>
            <label class="collab-mode-option">
              <input type="radio" name="collab-mode" value="offline" ${this.manager.activeProviderType === 'offline' ? 'checked' : ''} />
              <span>Offline / Local CRDT</span>
            </label>
          </div>
        </div>

        <div class="collab-section" style="margin-top: 16px;">
          <label class="collab-label">Connected Peers (<span id="collab-peer-count">0</span>)</label>
          <div class="collab-peers-list" id="collab-peers-container">
            <div class="collab-peer-empty">No other collaborators currently connected.</div>
          </div>
        </div>
      </div>

      <div class="export-modal-footer">
        <button class="btn-export-primary" id="collab-done-btn">Done</button>
      </div>
    `;

    this.overlay.appendChild(modal);
    this.container.appendChild(this.overlay);

    // Event binding
    const closeBtn = modal.querySelector('.export-modal-close') as HTMLElement;
    const doneBtn = modal.querySelector('#collab-done-btn') as HTMLElement;
    const copyBtn = modal.querySelector('#collab-copy-btn') as HTMLElement;
    const saveNameBtn = modal.querySelector('#collab-save-name-btn') as HTMLElement;
    const nameInput = modal.querySelector('#collab-name-input') as HTMLInputElement;
    const roomInput = modal.querySelector('#collab-room-input') as HTMLInputElement;

    const handleClose = () => this.close();
    closeBtn?.addEventListener('click', handleClose);
    doneBtn?.addEventListener('click', handleClose);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) handleClose();
    });

    copyBtn?.addEventListener('click', () => {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(roomInput.value).catch(() => {});
      }
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = 'Copy';
      }, 1500);
    });

    saveNameBtn?.addEventListener('click', () => {
      const newName = nameInput.value.trim();
      if (newName) {
        this.manager.setLocalUser({ name: newName });
        saveNameBtn.textContent = 'Saved';
        setTimeout(() => {
          if (saveNameBtn) saveNameBtn.textContent = 'Update';
        }, 1200);
      }
    });

    // Handle connection radio toggles
    const modeRadios = modal.querySelectorAll<HTMLInputElement>('input[name="collab-mode"]');
    modeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          if (radio.value === 'hocuspocus') {
            this.manager.connectHocuspocus();
          } else if (radio.value === 'webrtc') {
            this.manager.connectWebRtc();
          } else {
            this.manager.disconnect();
          }
        }
      });
    });

    // Keyboard navigation
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    doc.addEventListener('keydown', this.keydownHandler);
  }

  public updatePeers(peers: PeerState[]): void {
    if (!this.overlay) return;
    const countEl = this.overlay.querySelector('#collab-peer-count');
    const container = this.overlay.querySelector('#collab-peers-container');
    if (countEl) countEl.textContent = String(peers.length);

    if (container) {
      if (peers.length === 0) {
        container.innerHTML = '<div class="collab-peer-empty">No other collaborators currently connected.</div>';
      } else {
        container.innerHTML = peers
          .map(
            (p) => `
            <div class="collab-peer-badge" style="border-left: 3px solid ${p.user.color || '#343434'};">
              <span class="collab-peer-name">${p.user.name}</span>
              <span class="collab-peer-id">ID: ${p.clientId}</span>
            </div>
          `
          )
          .join('');
      }
    }
  }

  public close(): void {
    if (!this.overlay) return;
    const doc = this.container.ownerDocument || document;
    if (this.keydownHandler) {
      doc.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
    this.overlay.remove();
    this.overlay = null;
    if (this.onClose) {
      this.onClose();
    }
  }
}
