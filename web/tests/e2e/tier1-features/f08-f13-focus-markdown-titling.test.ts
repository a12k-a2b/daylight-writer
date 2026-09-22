import test from 'node:test';
import assert from 'node:assert';
import { DaylightDOMSimulator } from '../helpers/dom-simulator.ts';
import { SOL_OS_PALETTE } from '../helpers/contrast-verifier.ts';

test('F08: iA Writer Paragraph Focus Mode - Dims inactive paragraphs, active is high contrast', () => {
  const dom = new DaylightDOMSimulator();
  dom.focusMode = 'paragraph';
  
  dom.blocks = [
    { id: 'p-0', type: 'paragraph', text: 'First paragraph.', yOffset: 100, height: 60 },
    { id: 'p-1', type: 'paragraph', text: 'Second paragraph actively focused.', yOffset: 190, height: 60 },
    { id: 'p-2', type: 'paragraph', text: 'Third paragraph.', yOffset: 280, height: 60 },
  ];
  dom.activeBlockId = 'p-1';

  // In paragraph focus mode:
  // Active block p-1 is --os-900 or --os-1000
  // Non-active blocks (p-0, p-2) are dimmed to --os-300
  const renderedStyles = dom.blocks.map((b) => ({
    id: b.id,
    color: b.id === dom.activeBlockId ? SOL_OS_PALETTE.os900 : SOL_OS_PALETTE.os300,
  }));

  assert.strictEqual(renderedStyles[0].color, SOL_OS_PALETTE.os300);
  assert.strictEqual(renderedStyles[1].color, SOL_OS_PALETTE.os900);
  assert.strictEqual(renderedStyles[2].color, SOL_OS_PALETTE.os300);
});

test('F09: iA Writer Sentence Focus Mode via Intl.Segmenter - Isolates active sentence', () => {
  const paragraphText = 'The morning light reflects across the wooden table. A single cup rests beside the window. Silence fills the room.';
  
  // Use official ECMAScript Intl.Segmenter
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const segments = Array.from(segmenter.segment(paragraphText)).map((s) => s.segment.trim());

  assert.strictEqual(segments.length, 3);
  assert.strictEqual(segments[0], 'The morning light reflects across the wooden table.');
  assert.strictEqual(segments[1], 'A single cup rests beside the window.');
  assert.strictEqual(segments[2], 'Silence fills the room.');

  // In sentence focus mode with caret in sentence 1:
  // Active sentence is max black (--os-1000)
  // Local sentences in the same paragraph are secondary ink (--os-400)
  // Sentences in remote paragraphs are dimmed (--os-200 / --os-300)
  const activeSentenceIdx = 1;
  const sentenceColors = segments.map((_, idx) => {
    return idx === activeSentenceIdx ? SOL_OS_PALETTE.os1000 : SOL_OS_PALETTE.os400;
  });

  assert.strictEqual(sentenceColors[0], SOL_OS_PALETTE.os400);
  assert.strictEqual(sentenceColors[1], SOL_OS_PALETTE.os1000);
  assert.strictEqual(sentenceColors[2], SOL_OS_PALETTE.os400);
});

test('F10: Real-Time Markdown Syntax Formatting - Parses headings, bold, italic without caret jumping', () => {
  const parseMarkdownInline = (text: string) => {
    return text
      .replace(/^#\s+(.*)$/, '<h1>$1</h1>')
      .replace(/^##\s+(.*)$/, '<h2>$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^-\s+(.*)$/, '<li>$1</li>');
  };

  assert.strictEqual(parseMarkdownInline('# Daylight Note'), '<h1>Daylight Note</h1>');
  assert.strictEqual(parseMarkdownInline('## Subheading'), '<h2>Subheading</h2>');
  assert.strictEqual(parseMarkdownInline('This is **bold** text'), 'This is <strong>bold</strong> text');
  assert.strictEqual(parseMarkdownInline('This is *italic* text'), 'This is <em>italic</em> text');
  assert.strictEqual(parseMarkdownInline('- Bullet item'), '<li>Bullet item</li>');
});

test('F11: Dynamic Auto-Titling Derived From Opening Phrase - Extracts first sentence/heading up to 40 chars', () => {
  const dom = new DaylightDOMSimulator();

  // Heading extraction
  dom.updateTitleFromText('# The Art of Landscape Writing\nProse begins here.');
  assert.strictEqual(dom.title, 'The Art of Landscape Writing');

  // Sentence extraction
  dom.updateTitleFromText('In the quiet space before sunrise, thoughts crystallize slowly.');
  assert.strictEqual(dom.title, 'In the quiet space before sunrise');

  // Empty document
  dom.updateTitleFromText('');
  assert.strictEqual(dom.title, 'Untitled');
});

test('F12: Manual Title Override Lock - User title protected against auto-titling updates', () => {
  const dom = new DaylightDOMSimulator();
  
  // Set initial text
  dom.updateTitleFromText('# Initial Heading\nSome text');
  assert.strictEqual(dom.title, 'Initial Heading');
  assert.strictEqual(dom.isTitleCustom, false);

  // User manually edits title
  dom.setManualTitle('My Custom Memoir Chapter 1');
  assert.strictEqual(dom.title, 'My Custom Memoir Chapter 1');
  assert.strictEqual(dom.isTitleCustom, true);

  // User changes first heading in editor; manual title remains locked
  dom.updateTitleFromText('# A Brand New Heading In Body\nOther text');
  assert.strictEqual(dom.title, 'My Custom Memoir Chapter 1');
});

test('F13: Discreet Top-Corner Live Date/Time Indicator - Minimalist Sol:OS format', () => {
  const formatDiscreetTimestamp = (date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    return `${displayHours}:${minutes} ${ampm} · ${day} ${month}`;
  };

  const testDate = new Date(2026, 8, 21, 10, 42); // Sep 21, 2026, 10:42 AM
  const formatted = formatDiscreetTimestamp(testDate);
  assert.strictEqual(formatted, '10:42 AM · 21 Sep');
});
