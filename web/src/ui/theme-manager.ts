/**
 * src/ui/theme-manager.ts
 * Daylight Writer - Theme Management Engine
 *
 * Supported Themes:
 * - 'solos': Daylight Sol:OS Minimalist Calibrated Grayscale (Default, 8-bit LivePaper)
 * - 'dayone': Day One iOS Journaling App Aesthetic (Calendar date badges, soft rounded cards, pill controls)
 * - 'scrivener': Scrivener Classic macOS Writing Studio (Binder, folder/draft icons, corkboard index cards)
 */

export type AppTheme = 'solos' | 'dayone' | 'scrivener';

export interface ThemeConfig {
  id: AppTheme;
  name: string;
  subtitle: string;
  description: string;
  icon: string;
}

export const AVAILABLE_THEMES: ThemeConfig[] = [
  {
    id: 'solos',
    name: 'Daylight Sol:OS',
    subtitle: 'Calibrated Grayscale',
    description: 'Clean, distraction-free neutral grayscale optimized for the DC1 LivePaper 8-bit display.',
    icon: '☀️',
  },
  {
    id: 'dayone',
    name: 'Day One (iOS)',
    subtitle: 'Journaling Studio',
    description: 'Modeled after the iOS version of Day One: calendar date badges, soft rounded cards, and pill controls.',
    icon: '📖',
  },
  {
    id: 'scrivener',
    name: 'Scrivener Studio',
    subtitle: 'Classic Mac Authoring',
    description: 'Muted binder sidebar, manuscript folder/draft icons, and corkboard index card thought notes.',
    icon: '📚',
  },
];

const THEME_STORAGE_KEY = 'daylight_writer_theme';

export class ThemeManager {
  private currentTheme: AppTheme = 'solos';
  private listeners: Set<(theme: AppTheme) => void> = new Set();

  constructor() {
    this.currentTheme = this.loadSavedTheme();
  }

  /**
   * Initializes theme engine and applies theme attributes to the document root.
   */
  public init(): void {
    this.applyTheme(this.currentTheme);
  }

  public getTheme(): AppTheme {
    return this.currentTheme;
  }

  public getThemeConfig(): ThemeConfig {
    return AVAILABLE_THEMES.find((t) => t.id === this.currentTheme) || AVAILABLE_THEMES[0];
  }

  /**
   * Sets active theme and persists to localStorage.
   */
  public setTheme(theme: AppTheme): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    this.saveTheme(theme);
    this.applyTheme(theme);
    this.notifyListeners();
  }

  /**
   * Cycles to the next available theme in sequence.
   */
  public cycleTheme(): AppTheme {
    const themeIds: AppTheme[] = ['solos', 'dayone', 'scrivener'];
    const currentIndex = themeIds.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % themeIds.length;
    const nextTheme = themeIds[nextIndex];
    this.setTheme(nextTheme);
    return nextTheme;
  }

  /**
   * Subscribes to theme changes.
   */
  public subscribe(listener: (theme: AppTheme) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyTheme(theme: AppTheme): void {
    if (typeof document === 'undefined') return;

    // Apply to <html> root
    document.documentElement.setAttribute('data-theme', theme);

    // Apply to .dc1-shell if present
    const shell = document.querySelector('.dc1-shell');
    if (shell) {
      shell.setAttribute('data-theme', theme);
      shell.classList.remove('theme-solos', 'theme-dayone', 'theme-scrivener');
      shell.classList.add(`theme-${theme}`);
    }
  }

  private loadSavedTheme(): AppTheme {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return 'solos';
    }
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) as AppTheme | null;
      if (saved && (saved === 'solos' || saved === 'dayone' || saved === 'scrivener')) {
        return saved;
      }
    } catch {
      // Fallback
    }
    return 'solos';
  }

  private saveTheme(theme: AppTheme): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentTheme);
      } catch (err) {
        console.error('[ThemeManager] Listener error:', err);
      }
    }
  }
}
