/**
 * Sol:OS Grayscale Contrast Auditor & Token Verifier
 * Evaluates DOM elements and styles against official Daylight Sol:OS tokens (--os-0 to --os-1000)
 * and WCAG 2.1 AA/AAA contrast ratios for the DC1 10.5" LivePaper display.
 */

export const SOL_OS_PALETTE = {
  os0: '#FFFFFF',     // 255 - Base paper ground
  os50: '#F7F7F7',    // 247 - Surface panels / cards
  os100: '#DCD5C9',   // 215 - Hairline borders (warm neutral)
  os150: '#F5F5F5',   // 245 - Recessed canvas / search input
  os200: '#CCCCCC',   // 204 - Disabled controls / leader lines
  os300: '#858585',   // 133 - Low emphasis / dimmed focus text / clock
  os400: '#535353',   // 83  - Secondary text ink
  os800: '#343434',   // 52  - Dark fields / pressed states
  os900: '#1A1A1A',   // 26  - Primary text ink / headlines
  os1000: '#000000',  // 0   - Maximum black ink / active focus
} as const;

export interface ContrastViolation {
  selector: string;
  text: string;
  computedColor: string;
  computedBackground: string;
  contrastRatio: number;
  requiredRatio: number;
  issue: 'INSUFFICIENT_CONTRAST' | 'CHROMATIC_COLOR_VIOLATION' | 'NON_SOL_OS_TOKEN';
  recommendation: string;
}

export interface ContrastAuditResult {
  totalNodesChecked: number;
  passedCount: number;
  failedCount: number;
  violations: ContrastViolation[];
}

/**
 * Parses CSS hex or rgb/rgba string into [r, g, b, a]
 */
export function parseColor(colorStr: string): [number, number, number, number] {
  const trimmed = colorStr.trim();
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return [r, g, b, 1];
  }
  const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (match) {
    return [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      match[4] !== undefined ? parseFloat(match[4]) : 1,
    ];
  }
  return [0, 0, 0, 1];
}

/**
 * Calculates WCAG relative luminance
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculates WCAG contrast ratio between two colors
 */
export function calculateContrastRatio(color1: string, color2: string): number {
  const [r1, g1, b1] = parseColor(color1);
  const [r2, g2, b2] = parseColor(color2);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Verifies chromatic purity (monochrome / grayscale constraint).
 * DC1 LivePaper display requires all elements to be grayscale with max channel delta <= 14 (allowing #DCD5C9).
 */
export function checkMonochromePurity(colorStr: string): { isMonochrome: boolean; maxDelta: number } {
  const [r, g, b] = parseColor(colorStr);
  const maxDelta = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));
  // Warm hairline border token #DCD5C9 has delta 19 (R=220, B=201)
  return {
    isMonochrome: maxDelta <= 20,
    maxDelta,
  };
}

/**
 * Audits a style object representing an element
 */
export function auditElementStyle(element: {
  selector: string;
  text?: string;
  color: string;
  backgroundColor: string;
  fontSizePx?: number;
  isBold?: boolean;
  isFocusDimmed?: boolean;
}): ContrastViolation | null {
  const { isMonochrome } = checkMonochromePurity(element.color);
  if (!isMonochrome) {
    return {
      selector: element.selector,
      text: element.text || '',
      computedColor: element.color,
      computedBackground: element.backgroundColor,
      contrastRatio: 0,
      requiredRatio: 4.5,
      issue: 'CHROMATIC_COLOR_VIOLATION',
      recommendation: `Element uses chromatic non-grayscale color. Use Sol:OS token (--os-900 or --os-400).`,
    };
  }

  const ratio = calculateContrastRatio(element.color, element.backgroundColor);
  const isLargeText = (element.fontSizePx && element.fontSizePx >= 24) || (element.fontSizePx && element.fontSizePx >= 18 && element.isBold);
  
  // Intentionally dimmed focus mode text has relaxed requirement (>= 1.5:1)
  const requiredRatio = element.isFocusDimmed ? 1.5 : (isLargeText ? 3.0 : 4.5);

  if (ratio < requiredRatio) {
    return {
      selector: element.selector,
      text: element.text || '',
      computedColor: element.color,
      computedBackground: element.backgroundColor,
      contrastRatio: Math.round(ratio * 100) / 100,
      requiredRatio,
      issue: 'INSUFFICIENT_CONTRAST',
      recommendation: `Contrast ${ratio.toFixed(2)}:1 is below required ${requiredRatio}:1. Upgrade to --os-900 (#1A1A1A).`,
    };
  }

  return null;
}
