import test from 'node:test';
import assert from 'node:assert';
import { MockExportService, type DocumentRecord } from '../helpers/mock-adapters.ts';

test('Tier 2 Boundary: mailto: URI length clamping on massive documents (>1800 chars)', () => {
  const exporter = new MockExportService();

  const docHuge: DocumentRecord = {
    id: 'doc-huge-mail',
    title: 'An Epic Poem of Solitude',
    content: 'Long line of poetry. '.repeat(200), // ~4200 characters
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
  };

  const result = exporter.composeEmail(docHuge);
  assert.strictEqual(result.truncated, true);
  assert.ok(result.url.length <= 2500, `URI length was ${result.url.length}, must be <= 2500`);
  assert.ok(result.url.includes(encodeURIComponent('[...Content truncated due to email URI length limit...]')));
});

test('Tier 2 Boundary: mailto: handles special characters, unicode, and quotes', () => {
  const exporter = new MockExportService();

  const docUnicode: DocumentRecord = {
    id: 'doc-special-chars',
    title: 'Café & "Special" Characters?',
    content: 'Testing & < > " \' emoji: ☀️ 📖 and symbols % / \\',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
  };

  const result = exporter.composeEmail(docUnicode);
  assert.strictEqual(result.truncated, false);
  // Ensure valid mailto URI
  assert.ok(result.url.startsWith('mailto:?subject=Daylight%20Writer%20Document'));
  assert.ok(result.url.includes(encodeURIComponent('Café')));
});

test('Tier 2 Boundary: mailto: handles empty document gracefully', () => {
  const exporter = new MockExportService();

  const docEmpty: DocumentRecord = {
    id: 'doc-empty-mail',
    title: 'Untitled',
    content: '',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
  };

  const result = exporter.composeEmail(docEmpty);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.url, 'mailto:?subject=Daylight%20Writer%20Document%3A%20Untitled&body=');
});
