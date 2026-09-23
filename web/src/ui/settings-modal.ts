/**
 * src/ui/settings-modal.ts
 * Daylight Writer - Settings & Theme Configuration Modal
 * Allows switching between Daylight Sol:OS, Day One (iOS), and Scrivener themes.
 */

import { ThemeManager, AVAILABLE_THEMES, type AppTheme } from './theme-manager.ts';

export interface SettingsModalOptions {
  container: HTMLElement;
  themeManager: ThemeManager;
  onThemeChanged?: (theme: AppTheme) => void;
}

export class SettingsModal {
  private container: HTMLElement;
  private themeManager: ThemeManager;
  private overlay: HTMLElement | null = null;
  private isOpen: boolean = false;
  private onThemeChanged?: (theme: AppTheme) => void;

  constructor(options: SettingsModalOptions) {
    this.container = options.container;
    this.themeManager = options.themeManager;
    this.onThemeChanged = options.onThemeChanged;
  }

  public init(): void {
    // Lazy mount on first open
  }

  public open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.render();
  }

  public close(): void {
    if (!this.isOpen || !this.overlay) return;
    this.isOpen = false;
    this.overlay.classList.remove('modal-open');
    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;
    }, 150);
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private render(): void {
    const currentTheme = this.themeManager.getTheme();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay settings-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Daylight Writer Settings');

    const themeCardsHtml = AVAILABLE_THEMES.map((theme) => {
      const isSelected = theme.id === currentTheme;
      return `
        <div class="theme-card ${isSelected ? 'active' : ''}" data-theme-id="${theme.id}" role="button" tabindex="0">
          <div class="theme-card-header">
            <span class="theme-card-icon">${theme.icon}</span>
            <div class="theme-card-titles">
              <span class="theme-card-name">${escapeHtml(theme.name)}</span>
              <span class="theme-card-subtitle">${escapeHtml(theme.subtitle)}</span>
            </div>
            <div class="theme-radio-circle ${isSelected ? 'checked' : ''}"></div>
          </div>
          <p class="theme-card-desc">${escapeHtml(theme.description)}</p>
          <div class="theme-preview-box preview-${theme.id}">
            <div class="preview-mini-header"></div>
            <div class="preview-mini-body">
              <div class="preview-mini-card"></div>
              <div class="preview-mini-card"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="modal-card settings-card" tabindex="-1">
        <div class="modal-header settings-header">
          <div class="modal-title-group">
            <h2 class="modal-title">Settings & Appearance</h2>
            <p class="modal-subtitle">Configure Daylight Writer interface themes and ergonomics</p>
          </div>
          <button class="modal-close-btn" id="settings-close-btn" title="Close (Esc)" aria-label="Close settings">&times;</button>
        </div>

        <div class="settings-body thin-scrollbar">
          <section class="settings-section">
            <h3 class="settings-section-title">Interface Theme & Aesthetic</h3>
            <p class="settings-section-hint">Select a signature theme for sidebar chrome, cards, and inspectors while keeping the typewriter writing canvas 100% focused.</p>
            <div class="theme-selector-grid">
              ${themeCardsHtml}
            </div>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Keyboard Shortcuts</h3>
            <div class="shortcuts-grid">
              <div class="shortcut-row">
                <span class="shortcut-label">Toggle Document Outline</span>
                <kbd class="shortcut-key">Cmd + [</kbd>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-label">Toggle Margin Notes</span>
                <kbd class="shortcut-key">Cmd + ]</kbd>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-label">Cycle Themes Instantly</span>
                <kbd class="shortcut-key">Cmd + Alt + T</kbd>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-label">Cycle Focus Mode (iA Writer)</span>
                <kbd class="shortcut-key">Cmd + D</kbd>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-label">Split at Cursor (Scrivener)</span>
                <kbd class="shortcut-key">Cmd + Shift + K</kbd>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-label">AI Actions & Transform</span>
                <kbd class="shortcut-key">Cmd + K</kbd>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-label">Export & Share Sheet</span>
                <kbd class="shortcut-key">Cmd + Shift + E</kbd>
              </div>
            </div>
          </section>
        </div>

        <div class="modal-footer settings-footer">
          <span class="settings-status-note">Theme applied live · Zero page refresh</span>
          <button class="modal-primary-btn" id="settings-done-btn">Done</button>
        </div>
      </div>
    `;

    // Event Handlers
    const closeBtn = overlay.querySelector('#settings-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    const doneBtn = overlay.querySelector('#settings-done-btn');
    doneBtn?.addEventListener('click', () => this.close());

    // Light-dismiss on clicking backdrop
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });

    // Theme selection cards
    const cards = overlay.querySelectorAll('.theme-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const themeId = card.getAttribute('data-theme-id') as AppTheme;
        if (themeId) {
          this.themeManager.setTheme(themeId);
          cards.forEach((c) => {
            const isMatch = c.getAttribute('data-theme-id') === themeId;
            c.classList.toggle('active', isMatch);
            const radio = c.querySelector('.theme-radio-circle');
            radio?.classList.toggle('checked', isMatch);
          });
          if (this.onThemeChanged) {
            this.onThemeChanged(themeId);
          }
        }
      });
    });

    // Escape key listener
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        window.removeEventListener('keydown', keyHandler);
      }
    };
    window.addEventListener('keydown', keyHandler);

    this.container.appendChild(overlay);
    this.overlay = overlay;

    // Trigger animation in next frame
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        overlay.classList.add('modal-open');
      });
    } else {
      overlay.classList.add('modal-open');
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
