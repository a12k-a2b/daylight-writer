import test from 'node:test';
import assert from 'node:assert';
import { DaylightDOMSimulator, DC1_VIEWPORT } from '../helpers/dom-simulator.ts';

test('Tier 2 Boundary: Rapid virtual keyboard toggle (open -> close -> open) maintains correct scroll midpoint', () => {
  const dom = new DaylightDOMSimulator();
  
  // Set up 15 paragraphs
  for (let i = 0; i < 15; i++) {
    dom.blocks.push({
      id: `p-${i}`,
      type: 'paragraph',
      text: `Paragraph line ${i}`,
      yOffset: i * 80 + 100,
      height: 50,
    });
  }

  dom.activeBlockId = 'p-10'; // yOffset = 900

  // 1. Full height (1184px) -> midpoint 592px
  dom.recalculateCenterScroll();
  assert.strictEqual(dom.scrollTop, 900 - 592);
  assert.strictEqual(dom.caretPosition.screenY, 592);

  // 2. Keyboard opens: 500px keyboard -> remaining height 684px -> midpoint 342px
  dom.setVirtualKeyboardHeight(500);
  assert.strictEqual(dom.effectiveViewportHeight, 684);
  assert.strictEqual(dom.typewriterMidpoint, 342);
  assert.strictEqual(dom.scrollTop, 900 - 342);
  assert.strictEqual(dom.caretPosition.screenY, 342);

  // 3. Keyboard closes -> 0px keyboard -> height 1184px -> midpoint 592px
  dom.setVirtualKeyboardHeight(0);
  assert.strictEqual(dom.effectiveViewportHeight, 1184);
  assert.strictEqual(dom.typewriterMidpoint, 592);
  assert.strictEqual(dom.scrollTop, 900 - 592);
  assert.strictEqual(dom.caretPosition.screenY, 592);

  // 4. Keyboard opens with split thumb keyboard: 380px -> height 804px -> midpoint 402px
  dom.setVirtualKeyboardHeight(380);
  assert.strictEqual(dom.typewriterMidpoint, 402);
  assert.strictEqual(dom.scrollTop, 900 - 402);
  assert.strictEqual(dom.caretPosition.screenY, 402);
});

test('Tier 2 Boundary: Extreme keyboard height (>70% of screen) leaves minimum readable space', () => {
  const dom = new DaylightDOMSimulator();
  // Keyboard takes 900px of 1184px height -> remaining height is 284px
  dom.setVirtualKeyboardHeight(900);
  assert.strictEqual(dom.effectiveViewportHeight, 284);
  assert.strictEqual(dom.typewriterMidpoint, 142);
  assert.ok(dom.typewriterMidpoint > 100, 'Visible typewriter center must remain above keyboard top');
});
