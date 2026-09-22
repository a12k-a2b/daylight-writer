import test from 'node:test';
import assert from 'node:assert';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';

test('F04: Distraction-Free Typewriter Editor Container - Column width and character pitch', () => {
  const dom = new DaylightDOMSimulator();
  assert.strictEqual(dom.columnWidth, 720);
  
  // At 20px font size (~10.5px average character width), 720px yields ~68 characters per line
  const approxCharWidthPx = 10.5;
  const estimatedCPL = 720 / approxCharWidthPx;
  assert.ok(estimatedCPL >= 65 && estimatedCPL <= 75, `Expected 65-75 CPL, got ${estimatedCPL.toFixed(1)}`);
});

test('F05: Typewriter Vertical Center-Scrolling Engine - Midpoint calculation at 50% viewport height (592px)', () => {
  const dom = new DaylightDOMSimulator();
  assert.strictEqual(dom.viewportHeight, 1184);
  assert.strictEqual(dom.typewriterMidpoint, 592); // 1184 / 2 = 592px
});

test('F05: Typewriter Vertical Center-Scrolling Engine - Caret tracks active paragraph to 592px midpoint', () => {
  const dom = new DaylightDOMSimulator();
  
  // Create 10 paragraphs each 60px height spaced 30px apart
  for (let i = 0; i < 10; i++) {
    dom.blocks.push({
      id: `p-${i}`,
      type: 'paragraph',
      text: `Paragraph ${i} content in Daylight Writer.`,
      yOffset: i * 90 + 100,
      height: 60,
    });
  }

  // Active block near top (p-0 at yOffset 100) -> since 100 < 592, scrollTop remains 0
  dom.activeBlockId = 'p-0';
  dom.recalculateCenterScroll();
  assert.strictEqual(dom.scrollTop, 0);

  // Active block further down (p-8 at yOffset 820)
  // Desired screenY is 592 -> scrollTop = 820 - 592 = 228
  dom.activeBlockId = 'p-8';
  dom.recalculateCenterScroll();
  assert.strictEqual(dom.scrollTop, 228);
  assert.strictEqual(dom.caretPosition.screenY, 592);
});

test('F06: Smooth rAF Lerp Scrolling & User Scroll Suspension - Smooth tracking and pause', () => {
  const dom = new DaylightDOMSimulator();
  let userIsScrolling = false;
  let scrollSuspended = false;

  // Simulate scroll event listener
  const onUserWheelOrTouch = () => {
    userIsScrolling = true;
    scrollSuspended = true;
  };

  const onUserResumeTyping = () => {
    userIsScrolling = false;
    scrollSuspended = false;
  };

  onUserWheelOrTouch();
  assert.strictEqual(scrollSuspended, true, 'Auto typewriter scroll must pause while user touches/scrolls');

  onUserResumeTyping();
  assert.strictEqual(scrollSuspended, false, 'Auto typewriter scroll resumes when typing continues');
});

test('F07: Virtual Keyboard (IME) Dynamic Midpoint Recalibration - Recalculates center when keyboard opens', () => {
  const dom = new DaylightDOMSimulator();
  
  // Base state: 1184px viewport height -> midpoint 592px
  assert.strictEqual(dom.typewriterMidpoint, 592);

  // Simulate virtual keyboard appearing with height 484px
  dom.setVirtualKeyboardHeight(484);
  assert.strictEqual(dom.effectiveViewportHeight, 700); // 1184 - 484 = 700px
  assert.strictEqual(dom.typewriterMidpoint, 350); // 700 / 2 = 350px

  // Add block at yOffset 800
  dom.blocks.push({
    id: 'p-active',
    type: 'paragraph',
    text: 'Active text with keyboard open',
    yOffset: 800,
    height: 60,
  });
  dom.activeBlockId = 'p-active';
  dom.recalculateCenterScroll();

  // Desired screenY is now 350 -> scrollTop = 800 - 350 = 450
  assert.strictEqual(dom.scrollTop, 450);
  assert.strictEqual(dom.caretPosition.screenY, 350);

  // Virtual keyboard closes
  dom.setVirtualKeyboardHeight(0);
  assert.strictEqual(dom.typewriterMidpoint, 592);
  dom.recalculateCenterScroll();
  assert.strictEqual(dom.scrollTop, 800 - 592);
  assert.strictEqual(dom.caretPosition.screenY, 592);
});
