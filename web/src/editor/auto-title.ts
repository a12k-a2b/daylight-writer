/**
 * src/editor/auto-title.ts
 * Daylight Writer - Dynamic Auto-Titling with Manual Override Lock (F11, F12)
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

export const DEFAULT_UNTITLED = 'Untitled';
export const MAX_AUTO_TITLE_LENGTH = 40;

/**
 * Extracts a dynamic document title from text content.
 * Strictly satisfies E2E tests F11 and Tier 2 Boundaries:
 * 1. Empty or whitespace-only -> "Untitled"
 * 2. Heading extraction: "# The Art of Writing" -> "The Art of Writing"
 * 3. Sentence extraction: Splits on [.!?,] taking the first phrase
 * 4. Length clamping: Clamped to maxChars (default 40), trimmed
 */
export function extractAutoTitle(text: string, maxChars: number = MAX_AUTO_TITLE_LENGTH): string {
  if (!text || text.trim().length === 0) {
    return DEFAULT_UNTITLED;
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return DEFAULT_UNTITLED;
  }

  const firstLine = lines[0];
  // Strip markdown heading indicators (# to ######)
  const stripped = firstLine.replace(/^#{1,6}(\s+|$)/, '').trim();
  if (stripped.length === 0) {
    return DEFAULT_UNTITLED;
  }

  // Use first phrase/sentence delimited by punctuation [.!?,]
  const firstSentence = stripped.split(/[.!?,]/)[0] || stripped;
  const clamped = firstSentence.slice(0, maxChars).trim();

  return clamped.length > 0 ? clamped : DEFAULT_UNTITLED;
}

export interface AutoTitleState {
  title: string;
  isCustom: boolean;
}

export class AutoTitleManager {
  private title: string = DEFAULT_UNTITLED;
  private isCustom: boolean = false;
  private readonly maxChars: number;
  private onTitleChange?: (state: AutoTitleState) => void;

  constructor(initialTitle?: string, isCustom: boolean = false, maxChars: number = MAX_AUTO_TITLE_LENGTH) {
    this.title = (initialTitle && initialTitle.trim().length > 0) ? initialTitle.trim() : DEFAULT_UNTITLED;
    this.isCustom = isCustom;
    this.maxChars = maxChars;
  }

  public getTitle(): string {
    return this.title;
  }

  public getIsCustom(): boolean {
    return this.isCustom;
  }

  public getState(): AutoTitleState {
    return { title: this.title, isCustom: this.isCustom };
  }

  public setOnTitleChange(callback: (state: AutoTitleState) => void): void {
    this.onTitleChange = callback;
  }

  /**
   * Updates title derived from content if manual lock is not active (F11, F12).
   * Returns true if title actually changed.
   */
  public updateFromContent(content: string): boolean {
    if (this.isCustom) {
      // F12: Manual Title Override Lock - Protected against auto-titling updates
      return false;
    }

    const derived = extractAutoTitle(content, this.maxChars);
    if (derived !== this.title) {
      this.title = derived;
      this.notify();
      return true;
    }

    return false;
  }

  /**
   * User explicitly sets a manual title, locking it from auto-title overwrites.
   */
  public setManualTitle(newTitle: string): void {
    const trimmed = newTitle.trim();
    this.title = trimmed.length > 0 ? trimmed : DEFAULT_UNTITLED;
    this.isCustom = true;
    this.notify();
  }

  /**
   * Resets the manual override lock and recalculates from document content.
   */
  public resetManualLock(content: string): string {
    this.isCustom = false;
    this.title = extractAutoTitle(content, this.maxChars);
    this.notify();
    return this.title;
  }

  /**
   * Binds auto-titling to the #doc-title DOM element in index.html.
   * Listens for user focus and typing to automatically engage manual override lock.
   */
  public bindDOM(
    titleEl: HTMLElement,
    onSave?: (title: string, isCustom: boolean) => void
  ): () => void {
    const onInput = () => {
      const text = titleEl.textContent || '';
      this.title = text.trim() || DEFAULT_UNTITLED;
      this.isCustom = true;
      if (onSave) onSave(this.title, this.isCustom);
      this.notify();
    };

    const onBlur = () => {
      const text = (titleEl.textContent || '').trim();
      if (!text) {
        titleEl.textContent = DEFAULT_UNTITLED;
        this.title = DEFAULT_UNTITLED;
      }
      this.isCustom = true;
      if (onSave) onSave(this.title, this.isCustom);
      this.notify();
    };

    titleEl.addEventListener('input', onInput);
    titleEl.addEventListener('blur', onBlur);

    return () => {
      titleEl.removeEventListener('input', onInput);
      titleEl.removeEventListener('blur', onBlur);
    };
  }

  private notify(): void {
    if (this.onTitleChange) {
      this.onTitleChange(this.getState());
    }
  }
}
