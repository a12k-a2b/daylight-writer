import test from 'node:test';
import assert from 'node:assert';

/**
 * Abbreviation-aware sentence segmenter according to Sol:OS sentence focus specification (Survey 1)
 */
function segmentSentencesWithAbbreviations(text: string): string[] {
  const abbrevRegex = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|e\.g|i\.e)\./gi;
  const masked = text.replace(abbrevRegex, (match) => match.replace(/\./g, '__DOT__'));
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const rawSegments = Array.from(segmenter.segment(masked)).map((s) => s.segment.trim());
  return rawSegments.map((s) => s.replace(/__DOT__/g, '.')).filter(Boolean);
}

test('Tier 2 Boundary: Sentence segmentation with abbreviations (Dr. Smith, e.g., i.e., vs.)', () => {
  // Test case 1: Title abbreviation
  const text1 = 'Dr. Smith arrived at the station early. The train was on schedule.';
  const segs1 = segmentSentencesWithAbbreviations(text1);
  assert.strictEqual(segs1.length, 2, `Expected 2 sentences, got ${segs1.length}: ${JSON.stringify(segs1)}`);
  assert.strictEqual(segs1[0], 'Dr. Smith arrived at the station early.');
  assert.strictEqual(segs1[1], 'The train was on schedule.');

  // Test case 2: e.g. and i.e.
  const text2 = 'Consider diverse tools, e.g., fountain pens and typewriters. Both encourage deliberate thought.';
  const segs2 = segmentSentencesWithAbbreviations(text2);
  assert.strictEqual(segs2.length, 2, `Expected 2 sentences, got ${segs2.length}: ${JSON.stringify(segs2)}`);
  assert.strictEqual(segs2[0], 'Consider diverse tools, e.g., fountain pens and typewriters.');
  assert.strictEqual(segs2[1], 'Both encourage deliberate thought.');

  // Test case 3: vs.
  const text3 = 'The debate was analog vs. digital tools. Neither side was completely wrong.';
  const segs3 = segmentSentencesWithAbbreviations(text3);
  assert.strictEqual(segs3.length, 2, `Expected 2 sentences, got ${segs3.length}: ${JSON.stringify(segs3)}`);
  assert.strictEqual(segs3[0], 'The debate was analog vs. digital tools.');
  assert.strictEqual(segs3[1], 'Neither side was completely wrong.');
});

test('Tier 2 Boundary: Sentence segmentation with decimal numbers', () => {
  const text = 'The ratio was 3.14159 in the textbook. Next came the calculation.';
  const segs = segmentSentencesWithAbbreviations(text);

  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0], 'The ratio was 3.14159 in the textbook.');
  assert.strictEqual(segs[1], 'Next came the calculation.');
});

test('Tier 2 Boundary: Sentence segmentation with nested quotes and dialogue', () => {
  const text = 'He whispered, "Do not forget the notebook!" She nodded quietly.';
  const segs = segmentSentencesWithAbbreviations(text);

  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0], 'He whispered, "Do not forget the notebook!"');
  assert.strictEqual(segs[1], 'She nodded quietly.');
});

test('Tier 2 Boundary: Sentence segmentation with ellipses (...)', () => {
  const text = 'We waited in the cold silence... nothing moved. Then a light appeared.';
  const segs = segmentSentencesWithAbbreviations(text);

  assert.ok(segs.length >= 2);
  assert.ok(segs[segs.length - 1].includes('Then a light appeared.'));
});

test('Tier 2 Boundary: Sentence segmentation with multiple punctuation marks (?!)', () => {
  const text = 'Could this truly work?! It seemed impossible. We tried nonetheless.';
  const segs = segmentSentencesWithAbbreviations(text);

  assert.strictEqual(segs.length, 3);
  assert.strictEqual(segs[0], 'Could this truly work?!');
  assert.strictEqual(segs[1], 'It seemed impossible.');
  assert.strictEqual(segs[2], 'We tried nonetheless.');
});
