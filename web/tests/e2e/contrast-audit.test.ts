import test from 'node:test';
import assert from 'node:assert';
import {
  SOL_OS_PALETTE,
  calculateContrastRatio,
  checkMonochromePurity,
  auditElementStyle,
  relativeLuminance,
  parseColor,
} from './helpers/contrast-verifier.ts';

test('Sol:OS Contrast Audit - Official Design Tokens exist and have expected hex values', () => {
  assert.strictEqual(SOL_OS_PALETTE.os0, '#FFFFFF');
  assert.strictEqual(SOL_OS_PALETTE.os50, '#F7F7F7');
  assert.strictEqual(SOL_OS_PALETTE.os100, '#DCD5C9');
  assert.strictEqual(SOL_OS_PALETTE.os150, '#F5F5F5');
  assert.strictEqual(SOL_OS_PALETTE.os200, '#CCCCCC');
  assert.strictEqual(SOL_OS_PALETTE.os300, '#858585');
  assert.strictEqual(SOL_OS_PALETTE.os400, '#535353');
  assert.strictEqual(SOL_OS_PALETTE.os800, '#343434');
  assert.strictEqual(SOL_OS_PALETTE.os900, '#1A1A1A');
  assert.strictEqual(SOL_OS_PALETTE.os1000, '#000000');
});

test('Sol:OS Contrast Audit - All tokens adhere to monochrome purity (max channel delta <= 20)', () => {
  for (const [name, hex] of Object.entries(SOL_OS_PALETTE)) {
    const purity = checkMonochromePurity(hex);
    assert.ok(
      purity.isMonochrome,
      `Token ${name} (${hex}) must be monochrome grayscale, but had channel delta ${purity.maxDelta}`
    );
  }
});

test('Sol:OS Contrast Audit - Primary ink (--os-900 and --os-1000) exceeds WCAG AAA (7.0:1)', () => {
  const contrast900On0 = calculateContrastRatio(SOL_OS_PALETTE.os900, SOL_OS_PALETTE.os0);
  const contrast1000On0 = calculateContrastRatio(SOL_OS_PALETTE.os1000, SOL_OS_PALETTE.os0);
  const contrast900On50 = calculateContrastRatio(SOL_OS_PALETTE.os900, SOL_OS_PALETTE.os50);

  assert.ok(contrast900On0 >= 7.0, `--os-900 contrast ${contrast900On0} must be >= 7.0:1`);
  assert.ok(contrast1000On0 >= 7.0, `--os-1000 contrast ${contrast1000On0} must be >= 7.0:1`);
  assert.ok(contrast900On50 >= 7.0, `--os-900 on cards (${contrast900On50}) must be >= 7.0:1`);
});

test('Sol:OS Contrast Audit - Secondary text ink (--os-400) meets WCAG AA (>= 4.5:1)', () => {
  const contrast400On0 = calculateContrastRatio(SOL_OS_PALETTE.os400, SOL_OS_PALETTE.os0);
  assert.ok(contrast400On0 >= 4.5, `--os-400 contrast ${contrast400On0} must be >= 4.5:1`);
});

test('Sol:OS Contrast Audit - Focus dimmed text (--os-300) satisfies deliberate focus dimming range', () => {
  const contrast300On0 = calculateContrastRatio(SOL_OS_PALETTE.os300, SOL_OS_PALETTE.os0);
  // Dimmed text is intentionally lower contrast (3.0 - 4.2) for cognitive focus
  assert.ok(contrast300On0 >= 3.0, `Dimmed text contrast ${contrast300On0} should remain legible >= 3.0:1`);
  assert.ok(contrast300On0 < 5.0, `Dimmed text contrast ${contrast300On0} should be lower than primary text`);
});

test('Sol:OS Contrast Audit - Rejects chromatic non-grayscale colors (e.g. blue, red, green)', () => {
  const chromaticColors = ['#007AFF', '#FF3B30', '#34C759', 'rgb(20, 100, 240)'];
  for (const color of chromaticColors) {
    const violation = auditElementStyle({
      selector: '.bad-link',
      text: 'Blue link text',
      color,
      backgroundColor: '#FFFFFF',
    });
    assert.ok(violation !== null, `Expected chromatic violation for ${color}`);
    assert.strictEqual(violation?.issue, 'CHROMATIC_COLOR_VIOLATION');
  }
});

test('Sol:OS Contrast Audit - UI elements pass element style auditor with zero violations', () => {
  const elements = [
    { selector: '.editor-heading', color: SOL_OS_PALETTE.os1000, backgroundColor: SOL_OS_PALETTE.os0, fontSizePx: 26, isBold: true },
    { selector: '.editor-body', color: SOL_OS_PALETTE.os900, backgroundColor: SOL_OS_PALETTE.os0, fontSizePx: 20 },
    { selector: '.metadata-label', color: SOL_OS_PALETTE.os400, backgroundColor: SOL_OS_PALETTE.os50, fontSizePx: 14 },
    { selector: '.focus-dimmed-paragraph', color: SOL_OS_PALETTE.os300, backgroundColor: SOL_OS_PALETTE.os0, isFocusDimmed: true },
    { selector: '.command-palette-item.active', color: SOL_OS_PALETTE.os0, backgroundColor: SOL_OS_PALETTE.os800, fontSizePx: 16 },
  ];

  for (const el of elements) {
    const violation = auditElementStyle(el);
    assert.strictEqual(violation, null, `Element ${el.selector} produced unexpected violation: ${violation?.recommendation}`);
  }
});
