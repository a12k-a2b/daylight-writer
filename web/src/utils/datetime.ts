/**
 * src/utils/datetime.ts
 * Daylight Writer - Minimalist Sol:OS Live Date/Time Formatter (F13)
 * Formats: "10:42 AM · 21 Sep"
 * Designed with power-efficient minute-boundary scheduling for DC1.
 */

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DateTimeFormatOptions {
  includeWeekday?: boolean;
  use24Hour?: boolean;
}

/**
 * Strictly satisfies E2E test F13:
 * Given Sep 21, 2026, 10:42 AM -> returns "10:42 AM · 21 Sep"
 */
export function formatDiscreetTimestamp(date: Date, options: DateTimeFormatOptions = {}): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const day = date.getDate();
  const month = MONTHS_SHORT[date.getMonth()];

  if (options.use24Hour) {
    const hours24 = hours.toString().padStart(2, '0');
    if (options.includeWeekday) {
      const weekday = DAYS_SHORT[date.getDay()];
      return `${hours24}:${minutes} · ${weekday}, ${day} ${month}`;
    }
    return `${hours24}:${minutes} · ${day} ${month}`;
  }

  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;

  if (options.includeWeekday) {
    const weekday = DAYS_SHORT[date.getDay()];
    return `${displayHours}:${minutes} ${ampm} · ${weekday}, ${day} ${month}`;
  }

  return `${displayHours}:${minutes} ${ampm} · ${day} ${month}`;
}

export class LiveClockController {
  private targetEl: HTMLElement | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private options: DateTimeFormatOptions;
  private isDestroyed: boolean = false;

  constructor(targetEl?: HTMLElement | null, options: DateTimeFormatOptions = {}) {
    this.targetEl = targetEl || null;
    this.options = options;
  }

  public start(targetEl?: HTMLElement | null): void {
    if (targetEl) {
      this.targetEl = targetEl;
    }
    if (!this.targetEl) return;

    this.isDestroyed = false;
    this.render();
    this.scheduleNextMinuteBoundary();

    // Attach lifecycle visibility listener for energy saving
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public stop(): void {
    this.isDestroyed = true;
    this.clearTimers();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public forceUpdate(): void {
    this.render();
  }

  private render(): void {
    if (!this.targetEl || this.isDestroyed) return;
    this.targetEl.textContent = formatDiscreetTimestamp(new Date(), this.options);
  }

  private scheduleNextMinuteBoundary(): void {
    this.clearTimers();
    if (this.isDestroyed) return;

    const now = new Date();
    // Milliseconds remaining until the next exact minute turnover
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    this.timeoutId = setTimeout(() => {
      this.render();
      // Set periodic 60-second updates aligned to the minute
      this.intervalId = setInterval(() => {
        this.render();
      }, 60000);
    }, Math.max(msToNextMinute, 50));
  }

  private clearTimers(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;

    if (document.visibilityState === 'visible') {
      // Waking from sleep: update immediately and resynchronize
      this.render();
      this.scheduleNextMinuteBoundary();
    } else {
      // Hidden: sleep and conserve battery
      this.clearTimers();
    }
  };
}
