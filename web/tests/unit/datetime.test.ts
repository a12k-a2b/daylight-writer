/**
 * tests/unit/datetime.test.ts
 * Unit tests for minimalist live date/time formatting and LiveClockController (F13)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  formatDiscreetTimestamp,
  LiveClockController,
} from '../../src/utils/datetime.ts';

test('DateTime Formatter: Formats standard morning time according to Sol:OS format', () => {
  // Sep 21, 2026, 10:42 AM
  const date = new Date(2026, 8, 21, 10, 42, 15);
  const formatted = formatDiscreetTimestamp(date);
  assert.strictEqual(formatted, '10:42 AM · 21 Sep');
});

test('DateTime Formatter: Handles 12:00 PM (Noon) and 12:00 AM (Midnight)', () => {
  const noon = new Date(2026, 8, 21, 12, 0, 0);
  assert.strictEqual(formatDiscreetTimestamp(noon), '12:00 PM · 21 Sep');

  const midnight = new Date(2026, 8, 21, 0, 0, 0);
  assert.strictEqual(formatDiscreetTimestamp(midnight), '12:00 AM · 21 Sep');
});

test('DateTime Formatter: Handles single digit hours and padded minutes', () => {
  const earlyMorning = new Date(2026, 0, 5, 8, 5, 0); // Jan 5, 2026, 8:05 AM
  assert.strictEqual(formatDiscreetTimestamp(earlyMorning), '8:05 AM · 5 Jan');

  const evening = new Date(2026, 11, 31, 23, 59, 59); // Dec 31, 2026, 11:59 PM
  assert.strictEqual(formatDiscreetTimestamp(evening), '11:59 PM · 31 Dec');
});

test('DateTime Formatter: Supports 24-hour mode and weekday options', () => {
  const date = new Date(2026, 8, 21, 14, 30); // Monday Sep 21, 2026, 2:30 PM
  
  const formatted24 = formatDiscreetTimestamp(date, { use24Hour: true });
  assert.strictEqual(formatted24, '14:30 · 21 Sep');

  const formattedWeekday = formatDiscreetTimestamp(date, { includeWeekday: true });
  assert.strictEqual(formattedWeekday, '2:30 PM · Mon, 21 Sep');

  const formattedBoth = formatDiscreetTimestamp(date, { use24Hour: true, includeWeekday: true });
  assert.strictEqual(formattedBoth, '14:30 · Mon, 21 Sep');
});

test('LiveClockController: Renders formatted time into target element and cleans up', () => {
  const win = new Window();
  const doc = win.document;
  const el = doc.createElement('div');
  doc.body.appendChild(el);

  const clock = new LiveClockController(el as unknown as HTMLElement);
  clock.start();

  assert.ok(el.textContent && el.textContent.includes('·'), 'Clock element must contain formatted timestamp');
  
  clock.forceUpdate();
  assert.ok(el.textContent && el.textContent.includes('·'));

  clock.stop();
});
