/**
 * src/ui/settings-modal.ts
 * Daylight Writer - Settings & Theme Configuration Modal
 * Allows switching between Daylight Sol:OS, Day One (iOS), and Scrivener themes.
 */

import { ThemeManager, AVAILABLE_THEMES, type AppTheme } from './theme-manager.ts';

export interface SettingsModalOptions {
  container: HTMLElement;
  themeManager: ThemeManager;
  focusModeEngine?: any;
  onThemeChanged?: (theme: AppTheme) => void;
  onFocusModeChanged?: (mode: string) => void;
  onFontSizeChanged?: (size: number) => void;
  onLineHeightChanged?: (lh: number) => void;
  onFontFamilyChanged?: (font: string) => void;
}

export class SettingsModal {
  private container: HTMLElement;
  private themeManager: ThemeManager;
  private focusModeEngine?: any;
  private overlay: HTMLElement | null = null;
  private isOpen: boolean = false;
  private onThemeChanged?: (theme: AppTheme) => void;
  private onFocusModeChanged?: (mode: string) => void;
  private onFontSizeChanged?: (size: number) => void;
  private onLineHeightChanged?: (lh: number) => void;
  private onFontFamilyChanged?: (font: string) => void;

  constructor(options: SettingsModalOptions) {
    this.container = options.container;
    this.themeManager = options.themeManager;
    this.focusModeEngine = options.focusModeEngine;
    this.onThemeChanged = options.onThemeChanged;
    this.onFocusModeChanged = options.onFocusModeChanged;
    this.onFontSizeChanged = options.onFontSizeChanged;
    this.onLineHeightChanged = options.onLineHeightChanged;
    this.onFontFamilyChanged = options.onFontFamilyChanged;
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
            <p class="modal-subtitle">hi future me 👋 · Configure Daylight Writer interface themes and ergonomics</p>
          </div>
          <button class="modal-close-btn" id="settings-close-btn" title="Close (Esc)" aria-label="Close settings">&times;</button>
        </div>

        <div class="settings-body thin-scrollbar">
          <section class="settings-section">
            <h3 class="settings-section-title">Focus & ADHD Mode</h3>
            <p class="settings-section-hint">Active writing focus mode. Default: <strong>Sentence Focus (Active sentence sharp, surrounding text faded)</strong>.</p>
            <div class="settings-segmented-group" id="settings-focus-group" role="group" aria-label="Focus mode selection" style="display: flex; gap: 4px; padding: 4px; background: var(--os-150); border: 1px solid var(--color-border-hairline); border-radius: var(--pill-radius); margin-top: 8px;">
              <button class="settings-seg-btn active" data-focus-mode="sentence" type="button" style="flex: 1; padding: 6px 12px; border: none; border-radius: calc(var(--pill-radius) - 2px); font-size: 12px; font-weight: 600; cursor: pointer;">Sentence (Default)</button>
              <button class="settings-seg-btn" data-focus-mode="paragraph" type="button" style="flex: 1; padding: 6px 12px; border: none; border-radius: calc(var(--pill-radius) - 2px); font-size: 12px; font-weight: 500; cursor: pointer;">Paragraph</button>
              <button class="settings-seg-btn" data-focus-mode="none" type="button" style="flex: 1; padding: 6px 12px; border: none; border-radius: calc(var(--pill-radius) - 2px); font-size: 12px; font-weight: 500; cursor: pointer;">Focus Off</button>
            </div>
            <div class="settings-future-me-banner" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--os-150); border: 1px solid var(--color-border-hairline); border-radius: var(--pill-radius); margin-top: 8px;">
              <span style="font-size: 13px; font-weight: 600; color: var(--color-text-primary);">hi future me</span>
              <span id="settings-focus-status-text" style="font-size: 11px; color: var(--color-text-secondary); font-family: var(--font-mono);">ADHD Sentence Focus Active</span>
            </div>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Typography & LivePaper Metrics</h3>
            <p class="settings-section-hint">Calibrated typography metrics for the 10.5" 4:3 LivePaper display (270 DPI).</p>
            
            <div style="margin-top: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 12px; font-weight: 600; color: var(--color-text-primary);">Typeface Family</span>
              </div>
              <div class="settings-segmented-group" id="settings-font-group" role="group" aria-label="Font family selection" style="display: flex; gap: 4px; padding: 4px; background: var(--os-150); border: 1px solid var(--color-border-hairline); border-radius: var(--pill-radius);">
                <button class="settings-font-btn active" data-font="mono" type="button" style="flex: 1; padding: 6px 12px; border: none; border-radius: calc(var(--pill-radius) - 2px); font-family: var(--font-mono); font-size: 12px; font-weight: 600; cursor: pointer;">Mono</button>
                <button class="settings-font-btn" data-font="sans" type="button" style="flex: 1; padding: 6px 12px; border: none; border-radius: calc(var(--pill-radius) - 2px); font-family: sans-serif; font-size: 12px; font-weight: 500; cursor: pointer;">Sans</button>
                <button class="settings-font-btn" data-font="serif" type="button" style="flex: 1; padding: 6px 12px; border: none; border-radius: calc(var(--pill-radius) - 2px); font-family: serif; font-size: 12px; font-weight: 500; cursor: pointer;">Serif</button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px;">
              <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="font-size: 12px; font-weight: 600; color: var(--color-text-primary);">Text Size</span>
                  <span id="font-size-val" style="font-size: 12px; font-family: var(--font-mono); color: var(--color-text-secondary);">20px</span>
                </div>
                <input id="font-size-slider" type="range" min="16" max="26" step="1" value="20" style="width: 100%; accent-color: var(--color-text-emphasis);" />
              </div>
              <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="font-size: 12px; font-weight: 600; color: var(--color-text-primary);">Line Spacing</span>
                  <span id="line-height-val" style="font-size: 12px; font-family: var(--font-mono); color: var(--color-text-secondary);">1.70</span>
                </div>
                <input id="line-height-slider" type="range" min="1.4" max="2.2" step="0.05" value="1.70" style="width: 100%; accent-color: var(--color-text-emphasis);" />
              </div>
            </div>
          </section>

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
          <span class="settings-status-note">hi future me · Theme applied live · Zero page refresh</span>
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

    // Focus mode segmented controls
    const currentFocus = this.focusModeEngine ? this.focusModeEngine.getMode() : 'sentence';
    const focusButtons = overlay.querySelectorAll('.settings-seg-btn');
    const focusStatusText = overlay.querySelector('#settings-focus-status-text');
    focusButtons.forEach((btn) => {
      const mode = btn.getAttribute('data-focus-mode');
      const isMatch = mode === currentFocus;
      btn.classList.toggle('active', isMatch);
      btn.addEventListener('click', () => {
        focusButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (mode) {
          if (this.focusModeEngine) {
            this.focusModeEngine.setMode(mode);
          }
          if (focusStatusText) {
            focusStatusText.textContent = mode === 'sentence' ? 'ADHD Sentence Focus Active' : (mode === 'paragraph' ? 'Paragraph Focus Active' : 'Focus Disabled');
          }
          if (this.onFocusModeChanged) {
            this.onFocusModeChanged(mode);
          }
        }
      });
    });

    // Font family selection
    const savedFont = (typeof localStorage !== 'undefined' ? localStorage.getItem('daylight_writer_font_family') : null) || 'mono';
    const fontButtons = overlay.querySelectorAll('.settings-font-btn');
    fontButtons.forEach((btn) => {
      const font = btn.getAttribute('data-font');
      btn.classList.toggle('active', font === savedFont);
      btn.addEventListener('click', () => {
        fontButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (font) {
          let fontVal = 'var(--font-mono)';
          if (font === 'sans') fontVal = 'system-ui, -apple-system, sans-serif';
          else if (font === 'serif') fontVal = '"Charis SIL", "Georgia", serif';
          if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty('--editor-font-family', fontVal);
          }
          try { localStorage.setItem('daylight_writer_font_family', font); } catch(e){}
          if (this.onFontFamilyChanged) this.onFontFamilyChanged(font);
        }
      });
    });

    // Text size slider
    const savedSize = (typeof localStorage !== 'undefined' ? localStorage.getItem('daylight_writer_font_size') : null) || '20';
    const sizeSlider = overlay.querySelector('#font-size-slider') as HTMLInputElement | null;
    const sizeVal = overlay.querySelector('#font-size-val');
    if (sizeSlider) {
      sizeSlider.value = savedSize;
      if (sizeVal) sizeVal.textContent = `${savedSize}px`;
      sizeSlider.addEventListener('input', () => {
        const val = sizeSlider.value;
        if (sizeVal) sizeVal.textContent = `${val}px`;
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--editor-font-size', `${val}px`);
        }
        try { localStorage.setItem('daylight_writer_font_size', val); } catch(e){}
        if (this.onFontSizeChanged) this.onFontSizeChanged(Number(val));
      });
    }

    // Line spacing slider
    const savedLh = (typeof localStorage !== 'undefined' ? localStorage.getItem('daylight_writer_line_height') : null) || '1.70';
    const lhSlider = overlay.querySelector('#line-height-slider') as HTMLInputElement | null;
    const lhVal = overlay.querySelector('#line-height-val');
    if (lhSlider) {
      lhSlider.value = savedLh;
      if (lhVal) lhVal.textContent = Number(savedLh).toFixed(2);
      lhSlider.addEventListener('input', () => {
        const val = lhSlider.value;
        if (lhVal) lhVal.textContent = Number(val).toFixed(2);
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--editor-line-height', val);
        }
        try { localStorage.setItem('daylight_writer_line_height', val); } catch(e){}
        if (this.onLineHeightChanged) this.onLineHeightChanged(Number(val));
      });
    }

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
