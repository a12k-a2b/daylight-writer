/**
 * tests/unit/share-service.test.ts
 * Unit tests for ShareService (F58, F59)
 * Web Share API, AbortError handling, download fallback, and RFC 6068 mailto: clamping.
 */

import test from 'node:test';
import assert from 'node:assert';
import { ShareService } from '../../src/export/share-service.ts';
import type { DocumentRecord } from '../../src/storage/schema.ts';

function createSampleDoc(contentLength: number = 200): DocumentRecord {
  return {
    id: 'doc_share_1',
    title: 'Sharing Thoughts',
    content: 'A'.repeat(contentLength),
    is_title_custom: false,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700000000000,
    deleted_at: null,
  };
}

test('ShareService: canShare returns boolean based on environment capabilities', () => {
  const capable = ShareService.canShare();
  assert.strictEqual(typeof capable, 'boolean');
});

test('ShareService: shareDocument falls back to download when Web Share API is absent', async () => {
  const service = new ShareService();
  const doc = createSampleDoc(50);

  const res = await service.shareDocument({
    doc,
    exportResult: {
      filename: 'sample.txt',
      mimeType: 'text/plain',
      data: 'Hello World',
    },
  });

  // In Node.js / happy-dom without navigator.share, fallback to download
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.method, 'download-fallback');
  assert.strictEqual(res.filename, 'sample.txt');
});

test('ShareService: composeEmail builds RFC 6068 mailto: URI for short documents', () => {
  const service = new ShareService();
  const doc = createSampleDoc(100);

  const result = service.composeEmail(doc);
  assert.strictEqual(result.truncated, false);
  assert.ok(result.url.startsWith('mailto:?subject=Daylight%20Writer%20Document%3A%20Sharing%20Thoughts&body='));
  assert.ok(result.charCount <= 2500);
});

test('ShareService: composeEmail truncates body when exceeding 1500 chars', () => {
  const service = new ShareService();
  const doc = createSampleDoc(3000); // 3000 characters

  const result = service.composeEmail(doc);
  assert.strictEqual(result.truncated, true);
  assert.ok(result.url.includes(encodeURIComponent('[...Content truncated due to email URI length limit...]')));
  assert.ok(result.charCount <= 2500, `URI length ${result.charCount} must be <= 2500`);
});

test('ShareService: composeEmail hard-clamps total URL length to strictly <= 2500 chars', () => {
  const service = new ShareService();
  // Multi-byte Unicode characters expand to 3x (%XX%XX%XX) when URI encoded
  const doc: DocumentRecord = {
    id: 'doc_unicode',
    title: '🚀'.repeat(100),
    content: '🌟'.repeat(2000),
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  };

  const result = service.composeEmail(doc);
  assert.strictEqual(result.truncated, true);
  assert.ok(result.charCount <= 2500, `Total URI length was ${result.charCount}, must be <= 2500 chars`);

  // Verify that URI does not end with broken % hex slice
  const match = result.url.match(/%[0-9a-fA-F]?$/);
  assert.strictEqual(match, null, 'URI must not terminate with broken percent-encoding');
});

test('ShareService: shareDocument handles AbortError gracefully', async () => {
  const service = new ShareService();
  const doc = createSampleDoc(50);

  const originalShare = (globalThis.navigator as any)?.share;
  const originalCanShare = (globalThis.navigator as any)?.canShare;
  try {
    Object.defineProperty(globalThis.navigator, 'share', {
      value: async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis.navigator, 'canShare', {
      value: () => true,
      configurable: true,
      writable: true,
    });

    const res = await service.shareDocument({
      doc,
      exportResult: {
        filename: 'notes.md',
        mimeType: 'text/markdown',
        data: '# Content',
      },
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.method, 'aborted');
  } finally {
    if (originalShare) {
      Object.defineProperty(globalThis.navigator, 'share', { value: originalShare, configurable: true, writable: true });
    } else {
      delete (globalThis.navigator as any).share;
    }
    if (originalCanShare) {
      Object.defineProperty(globalThis.navigator, 'canShare', { value: originalCanShare, configurable: true, writable: true });
    } else {
      delete (globalThis.navigator as any).canShare;
    }
  }
});
