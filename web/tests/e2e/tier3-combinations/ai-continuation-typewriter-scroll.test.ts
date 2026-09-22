import test from 'node:test';
import assert from 'node:assert';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';
import { MockAIServiceAdapter } from '../helpers/mock-adapters.ts';

test('Tier 3 Combination: Typing +++ continuation while typewriter center-scrolling is active', async () => {
  const dom = new DaylightDOMSimulator();
  const ai = new MockAIServiceAdapter();

  // Populate editor with 8 paragraphs so active paragraph is in typewriter scroll zone
  for (let i = 0; i < 8; i++) {
    dom.blocks.push({
      id: `p-${i}`,
      type: 'paragraph',
      text: `Paragraph ${i} exploring the solitude of landscape writing.`,
      yOffset: i * 100 + 80,
      height: 70,
    });
  }

  // Active block is p-7 at yOffset 780
  dom.activeBlockId = 'p-7';
  dom.recalculateCenterScroll();

  // Initial scroll position locks active block to 592px midpoint
  assert.strictEqual(dom.scrollTop, 780 - 592); // 188px
  assert.strictEqual(dom.caretPosition.screenY, 592);

  // User types ' +++' at end of paragraph 7
  let p7 = dom.blocks.find((b) => b.id === 'p-7')!;
  const originalText = p7.text;
  const historyCheckpoint = { text: originalText, scrollTop: dom.scrollTop };

  // Trigger continuation stream
  const fullContinuation = await ai.streamContinuation(
    { documentText: originalText, cursorOffset: originalText.length },
    (chunk) => {
      p7.text += chunk;
      // In real editor, height may expand as text wraps, increasing yOffset for following blocks
      p7.height += 5;
      dom.recalculateCenterScroll();
      // Caret screenY must remain at exactly 592px throughout streaming
      assert.strictEqual(dom.caretPosition.screenY, 592);
    }
  );

  assert.ok(p7.text.length > originalText.length);
  assert.ok(fullContinuation.length > 0);
  assert.strictEqual(dom.caretPosition.screenY, 592);

  // Single Cmd+Z undo restores original text and original scroll state
  p7.text = historyCheckpoint.text;
  p7.height = 70;
  dom.recalculateCenterScroll();

  assert.strictEqual(p7.text, originalText);
  assert.strictEqual(dom.scrollTop, 188);
  assert.strictEqual(dom.caretPosition.screenY, 592);
});
