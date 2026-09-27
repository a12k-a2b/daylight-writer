/**
 * tests/adversarial/m2-challenger1-docs-patch-stress.test.ts
 * Milestone 2 Empirical Adversarial Verification Harness
 *
 * Objectives:
 * 1. Duplication Prevention: Repeatedly sync and edit the same document 10 times in sequence;
 *    verify exactly 1 file ID exists in Google Drive and no duplicate files are created.
 * 2. Docs API v1 Patching Boundary Cases: Document with 0 characters, 1 character, 50,000 characters,
 *    unicode/emoji characters, special markdown syntax; verify in-place patch succeeds.
 * 3. Trashed File Recovery: If the remote file is trashed/deleted (HTTP 404),
 *    verify adapter re-creates the document cleanly.
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../src/sync/google-drive-sync-adapter.ts';
import { SqliteDatabase } from '../../src/storage/sqlite-vfs.ts';
import { runMigrations, type DatabaseDriver } from '../../src/storage/schema.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import { MockGoogleDriveServer } from '../e2e/gdrive-sync/helpers/test-harness.ts';

// In-memory localStorage mock for hermetic testing in Node.js
class MockStorage {
  private store: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, val: string): void {
    this.store.set(key, String(val));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }
}

describe('Milestone 2 Empirical Challenger Stress Harness', () => {
  let server: MockGoogleDriveServer;
  let mockStorage: MockStorage;
  let testDb: DatabaseDriver;
  let repo: SQLiteStorageRepository;
  const originalFetch = global.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(async () => {
    mockStorage = new MockStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });

    server = new MockGoogleDriveServer();
    global.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return Promise.resolve(server.handleRequest(url, init));
    }) as any;

    testDb = await SqliteDatabase.open({ vfsPreference: 'memory' });
    await runMigrations(testDb);
    repo = new SQLiteStorageRepository(testDb);
    await repo.init();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalLocalStorage !== undefined) {
      (globalThis as any).localStorage = originalLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
  });

  // ==========================================================================
  // Challenge 1: Duplication Prevention
  // ==========================================================================
  describe('Challenge 1: Duplication Prevention (10 Sequential Edits)', () => {
    test('Empirical C1.1: 10 sequential edit-and-sync cycles produce EXACTLY 1 Google Doc file with 0 duplicates', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const folderId = await adapter.ensureDaylightFolder();
      const docId = 'doc-duplication-stress-1';

      // Seed local document in repository
      await repo.saveDocument({
        id: docId,
        title: 'Initial Version 0',
        content: 'Seed content before any edits.',
        sync_status: 'pending',
      });

      const observedFileIds = new Set<string>();

      // Cycle 0: Initial Creation
      const initialResult = await adapter.syncDocumentMutation(
        {
          id: `mut-init-${Date.now()}`,
          entity_type: 'document',
          entity_id: docId,
          operation: 'create',
          payload: {
            id: docId,
            title: 'Initial Version 0',
            content: 'Seed content before any edits.',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.ok(initialResult.fileId, 'Initial creation must return a valid fileId');
      observedFileIds.add(initialResult.fileId);

      // Verify remote files count is exactly 1
      assert.strictEqual(server.files.size, 1, 'Drive must contain exactly 1 file after initial creation');

      // Now perform 10 sequential edits and syncs
      for (let i = 1; i <= 10; i++) {
        const newTitle = `Manuscript Revision ${i}`;
        const newContent = `Paragraph content at revision ${i}. Total word count is increasing with timestamp ${Date.now()}`;

        // Update local document
        await repo.saveDocument({
          id: docId,
          title: newTitle,
          content: newContent,
          google_drive_file_id: initialResult.fileId,
          sync_status: 'pending',
        });

        // Sync update
        const syncResult = await adapter.syncDocumentMutation(
          {
            id: `mut-edit-${i}-${Date.now()}`,
            entity_type: 'document',
            entity_id: docId,
            operation: 'update',
            payload: {
              id: docId,
              title: newTitle,
              content: newContent,
              google_drive_file_id: initialResult.fileId,
            },
            client_timestamp: Date.now(),
          },
          folderId
        );

        observedFileIds.add(syncResult.fileId);

        // Verification on each step:
        assert.strictEqual(
          syncResult.fileId,
          initialResult.fileId,
          `Edit cycle ${i} must preserve the original file ID without creating a new one`
        );
        assert.strictEqual(
          server.files.size,
          1,
          `Drive must strictly maintain exactly 1 file (no duplicates) after edit cycle ${i}`
        );
      }

      // Final checks:
      assert.strictEqual(observedFileIds.size, 1, 'Exactly 1 unique file ID must be observed across all 10 edits');
      const finalDriveFile = server.files.get(initialResult.fileId);
      assert.ok(finalDriveFile, 'Final Google Doc must exist in Drive');
      assert.strictEqual(finalDriveFile.name, 'Manuscript Revision 10', 'Final title must match 10th revision');
      assert.ok(
        finalDriveFile.content.includes('revision 10'),
        'Final remote content must reflect the 10th revision'
      );

      // Verify SQLite state
      const dbRow = await repo.getDocument(docId);
      assert.strictEqual(dbRow?.google_drive_file_id, initialResult.fileId);
      assert.strictEqual(dbRow?.sync_status, 'synced');
    });

    test('Empirical C1.2: End-to-end adapter.sync() across 10 sequential mutations maintains exactly 1 remote document', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const docId = 'doc-e2e-sync-stress';
      let originalFileId: string | null = null;

      // Seed in repo
      await repo.saveDocument({
        id: docId,
        title: 'Batch Sync Title 0',
        content: 'Batch Sync Content 0',
        sync_status: 'pending',
      });

      // Initial creation through queue
      adapter.queueMutation(docId, 'create', {
        id: docId,
        title: 'Batch Sync Title 0',
        content: 'Batch Sync Content 0',
      });

      const firstSync = await adapter.sync();
      assert.strictEqual(firstSync.pushedCount, 1);
      assert.strictEqual(server.files.size, 1);

      const [firstFile] = Array.from(server.files.values());
      originalFileId = firstFile.id;

      // 10 sequential edits through adapter.sync()
      for (let i = 1; i <= 10; i++) {
        await repo.saveDocument({
          id: docId,
          title: `Batch Sync Title ${i}`,
          content: `Batch Sync Content ${i}`,
          google_drive_file_id: originalFileId,
          sync_status: 'pending',
        });

        adapter.queueMutation(docId, 'update', {
          id: docId,
          title: `Batch Sync Title ${i}`,
          content: `Batch Sync Content ${i}`,
          google_drive_file_id: originalFileId,
        });

        const syncRes = await adapter.sync();
        assert.strictEqual(syncRes.pushedCount, 1);
        assert.strictEqual(
          server.files.size,
          1,
          `Must maintain exactly 1 remote document after sync iteration ${i}`
        );
      }

      const finalFile = server.files.get(originalFileId);
      assert.ok(finalFile);
      assert.strictEqual(finalFile.name, 'Batch Sync Title 10');
      assert.strictEqual(finalFile.content, 'Batch Sync Content 10');
    });
  });

  // ==========================================================================
  // Challenge 2: Docs API v1 Patching Boundary Cases
  // ==========================================================================
  describe('Challenge 2: Docs API v1 Patching Boundary Cases', () => {
    let adapter: GoogleDriveSyncAdapter;
    let folderId: string;
    let seedFileId: string;

    beforeEach(async () => {
      adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });
      folderId = await adapter.ensureDaylightFolder();

      // Seed a document in repo
      await repo.saveDocument({
        id: 'doc-boundary-test',
        title: 'Boundary Test Document',
        content: 'Initial non-empty seed text for patching.',
        sync_status: 'pending',
      });

      // Seed a document in drive
      const initial = await adapter.syncDocumentMutation(
        {
          id: 'mut-seed',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'create',
          payload: {
            id: 'doc-boundary-test',
            title: 'Boundary Test Document',
            content: 'Initial non-empty seed text for patching.',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );
      seedFileId = initial.fileId;
    });

    test('Empirical C2.1: Boundary 0 characters (empty doc) patches cleanly without error', async () => {
      const patchRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-boundary-0',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: {
            id: 'doc-boundary-test',
            title: 'Empty Document',
            content: '',
            google_drive_file_id: seedFileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.strictEqual(patchRes.fileId, seedFileId);
      const remoteFile = server.files.get(seedFileId);
      assert.ok(remoteFile);
      assert.strictEqual(remoteFile.content, '', 'Remote content must be empty string');
      assert.strictEqual(remoteFile.name, 'Empty Document');
    });

    test('Empirical C2.2: Boundary 1 character patches cleanly and preserves single char', async () => {
      const patchRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-boundary-1',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: {
            id: 'doc-boundary-test',
            title: 'Single Char Doc',
            content: 'A',
            google_drive_file_id: seedFileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.strictEqual(patchRes.fileId, seedFileId);
      const remoteFile = server.files.get(seedFileId);
      assert.ok(remoteFile);
      assert.strictEqual(remoteFile.content, 'A');
    });

    test('Empirical C2.3: Boundary 50,000 characters patches in-place and preserves full payload', async () => {
      // Build a 50,000 character string
      const chunk = 'The Daylight Computer DC1 LivePaper 60-120Hz transflective display. '; // 68 chars
      const repeatCount = Math.ceil(50000 / chunk.length);
      const full50kText = chunk.repeat(repeatCount).slice(0, 50000);
      assert.strictEqual(full50kText.length, 50000);

      const patchRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-boundary-50k',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: {
            id: 'doc-boundary-test',
            title: '50,000 Chars Manuscript',
            content: full50kText,
            google_drive_file_id: seedFileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.strictEqual(patchRes.fileId, seedFileId);
      const remoteFile = server.files.get(seedFileId);
      assert.ok(remoteFile);
      assert.strictEqual(remoteFile.content.length, 50000);
      assert.strictEqual(remoteFile.content, full50kText);
    });

    test('Empirical C2.4: Boundary Unicode & Emojis (multilingual, astral plane, zero-width) patches cleanly', async () => {
      const complexUnicodeText = [
        '# Sol:OS LivePaper Multilingual Manuscript',
        'English: Pure amber backlight, zero blue light, 8-bit grayscale.',
        '日本語: 日光コンピュータDC1のLivePaperディスプレイは目に優しい。',
        'العربية: شاشة ورق حيوي فائقة الوضوح مع إضاءة كهرمانية نقية.',
        'עברית: תצוגת נייר חי ללא אור כחול בריכוז מוחלט.',
        'Devanagari: डेलाइट कंप्यूटर सजीव कागज़ प्रदर्शन।',
        'Astral Plane & CJK Ext B: 𠮷野家 𩸽 𠀋 𡈽',
        'Complex Emojis & Modifiers: 👨‍👩‍👧‍👦 🧘🏽‍♀️ 🏳️‍🌈 ⚡ 🖋️ 📜 🌄 💡',
        'Zero-Width & BiDi Markers: \u200Bzero\u200Cwidth\u200Djoiner\uFEFFbom',
      ].join('\n\n');

      const patchRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-boundary-unicode',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: {
            id: 'doc-boundary-test',
            title: 'Unicode & Emoji ✨',
            content: complexUnicodeText,
            google_drive_file_id: seedFileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.strictEqual(patchRes.fileId, seedFileId);
      const remoteFile = server.files.get(seedFileId);
      assert.ok(remoteFile);
      assert.strictEqual(remoteFile.content, complexUnicodeText);
      assert.strictEqual(remoteFile.name, 'Unicode & Emoji ✨');
    });

    test('Empirical C2.5: Boundary Special Markdown Syntax (tables, code fences, HTML, math, links) patches cleanly', async () => {
      const complexMarkdown = `---
title: "Advanced Markdown Test"
author: "Daylight Challenger"
tags: [dc1, livepaper, test]
---

# Title 1
## Subtitle 2
### Section 3

> This is a blockquote with **bold text**, *italic text*, and ~~strikethrough~~.
>> Nested blockquote with \`inline code\`.

- [x] Completed task item
- [ ] Incomplete task item
1. Numbered item 1
2. Numbered item 2

\`\`\`typescript
export function renderLivePaper(frameRate: 60 | 120): void {
  console.log(\`Rendering at \${frameRate}Hz\`);
}
\`\`\`

| Feature | Sol:OS Token | Contrast Ratio |
| :--- | :---: | ---: |
| Background | --os-0 (#FFFFFF) | 1:1 |
| Card Surface | --os-50 (#F7F7F7) | 1.07:1 |
| Hairline Border | --os-100 (#DCD5C9) | 1.34:1 |
| Primary Ink | --os-900 (#1A1A1A) | 18.5:1 |
| Max Black | --os-1000 (#000000) | 21:1 |

<div class="custom-card" data-ref="livepaper">
  <p>Raw HTML embedding test with &amp; &lt; &gt; &quot;</p>
</div>

Math: $E = mc^2$ and $$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$

[Daylight Computer](https://daylightcomputer.com "Official Site")

---
`;

      const patchRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-boundary-markdown',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: {
            id: 'doc-boundary-test',
            title: 'Special Markdown',
            content: complexMarkdown,
            google_drive_file_id: seedFileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.strictEqual(patchRes.fileId, seedFileId);
      const remoteFile = server.files.get(seedFileId);
      assert.ok(remoteFile);
      assert.strictEqual(remoteFile.content, complexMarkdown);
    });

    test('Empirical C2.6: Boundary shrink-and-grow cycle (50,000 -> 0 -> 1 chars) behaves deterministically', async () => {
      // Step 1: Grow to 50k
      const text50k = 'X'.repeat(50000);
      await adapter.syncDocumentMutation(
        {
          id: 'mut-sg-1',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: { id: 'doc-boundary-test', content: text50k, google_drive_file_id: seedFileId },
          client_timestamp: Date.now(),
        },
        folderId
      );
      assert.strictEqual(server.files.get(seedFileId)?.content.length, 50000);

      // Step 2: Shrink to 0
      await adapter.syncDocumentMutation(
        {
          id: 'mut-sg-2',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: { id: 'doc-boundary-test', content: '', google_drive_file_id: seedFileId },
          client_timestamp: Date.now(),
        },
        folderId
      );
      assert.strictEqual(server.files.get(seedFileId)?.content, '');

      // Step 3: Grow to 1
      await adapter.syncDocumentMutation(
        {
          id: 'mut-sg-3',
          entity_type: 'document',
          entity_id: 'doc-boundary-test',
          operation: 'update',
          payload: { id: 'doc-boundary-test', content: 'Z', google_drive_file_id: seedFileId },
          client_timestamp: Date.now(),
        },
        folderId
      );
      assert.strictEqual(server.files.get(seedFileId)?.content, 'Z');
    });
  });

  // ==========================================================================
  // Challenge 3: Trashed File Recovery (HTTP 404)
  // ==========================================================================
  describe('Challenge 3: Trashed File Recovery (HTTP 404)', () => {
    test('Empirical C3.1: When remote file is deleted on Google Drive (HTTP 404), adapter auto-recovers by cleanly re-creating the Google Doc', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const folderId = await adapter.ensureDaylightFolder();
      const docId = 'doc-trashed-test-1';

      // 1. Initial creation in SQLite repo
      await repo.saveDocument({
        id: docId,
        title: 'Document Before Deletion',
        content: 'Original content on Google Drive.',
        sync_status: 'pending',
      });

      const initRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-init',
          entity_type: 'document',
          entity_id: docId,
          operation: 'create',
          payload: {
            id: docId,
            title: 'Document Before Deletion',
            content: 'Original content on Google Drive.',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      const oldFileId = initRes.fileId;
      assert.ok(oldFileId, 'Must have created initial file');
      assert.ok(server.files.has(oldFileId));

      const initialLocalDoc = await repo.getDocument(docId);
      assert.strictEqual(initialLocalDoc?.google_drive_file_id, oldFileId);

      // 2. Remote file is deleted from Google Drive!
      server.files.delete(oldFileId);

      // 3. User edits document locally
      const updatedTitle = 'Re-created Manuscript';
      const updatedContent = 'Content created after remote file was trashed in Drive.';

      // 4. Execute sync mutation — MUST AUTO-RECOVER WITHOUT THROWING
      let thrownError: any = null;
      let recoverRes: any = null;
      try {
        recoverRes = await adapter.syncDocumentMutation(
          {
            id: 'mut-recover',
            entity_type: 'document',
            entity_id: docId,
            operation: 'update',
            payload: {
              id: docId,
              title: updatedTitle,
              content: updatedContent,
              google_drive_file_id: oldFileId,
            },
            client_timestamp: Date.now(),
          },
          folderId
        );
      } catch (err: any) {
        thrownError = err;
      }

      // Assert zero errors thrown
      assert.strictEqual(thrownError, null, 'Auto-recovery must not throw on HTTP 404');
      assert.ok(recoverRes, 'Must return a valid recovery result');
      assert.ok(recoverRes.fileId, 'Must return a valid file ID');
      assert.notStrictEqual(recoverRes.fileId, oldFileId, 'Must assign a brand new file ID');

      // Verify Google Drive state: exactly 1 file exists, matching updated title and content
      assert.strictEqual(server.files.size, 1, 'Google Drive must contain exactly 1 active file');
      assert.ok(server.files.has(recoverRes.fileId), 'New file must exist on Drive');
      const newFile = server.files.get(recoverRes.fileId);
      assert.strictEqual(newFile?.name, updatedTitle);
      assert.strictEqual(newFile?.content, updatedContent);

      // Verify SQLite state: documents table updated with new file ID and synced status
      const localDoc = await repo.getDocument(docId);
      assert.strictEqual(localDoc?.google_drive_file_id, recoverRes.fileId, 'SQLite must update to new file ID');
      assert.strictEqual(localDoc?.sync_status, 'synced', 'SQLite sync_status must be synced');

      // Verify subsequent edit patches the new file in-place (no wedge, no duplicate files)
      const subsequentRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-subsequent',
          entity_type: 'document',
          entity_id: docId,
          operation: 'update',
          payload: {
            id: docId,
            title: 'Subsequent Edit After Recovery',
            content: 'Subsequent content smoothly patched',
            google_drive_file_id: recoverRes.fileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );
      assert.strictEqual(subsequentRes.fileId, recoverRes.fileId, 'Subsequent edit must preserve recovered file ID');
      assert.strictEqual(server.files.size, 1, 'Drive file count must strictly remain 1');
      assert.strictEqual(server.files.get(recoverRes.fileId)?.name, 'Subsequent Edit After Recovery');
    });

    test('Empirical C3.2: When remote file is marked trashed in Google Drive (HTTP 404), adapter auto-recovers and fulfills recovery invariant', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const folderId = await adapter.ensureDaylightFolder();
      const docId = 'doc-trashed-test-2';

      // 1. Initial creation
      await repo.saveDocument({
        id: docId,
        title: 'Doc to be trashed',
        content: 'Initial text.',
        sync_status: 'pending',
      });

      const initRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-init-2',
          entity_type: 'document',
          entity_id: docId,
          operation: 'create',
          payload: {
            id: docId,
            title: 'Doc to be trashed',
            content: 'Initial text.',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      const oldFileId = initRes.fileId;
      const file = server.files.get(oldFileId);
      assert.ok(file);
      file.trashed = true; // Mark as trashed in Drive

      // 2. User edits document locally after remote file was trashed
      let syncError: any = null;
      let recoverRes: any = null;

      try {
        recoverRes = await adapter.syncDocumentMutation(
          {
            id: 'mut-recover-2',
            entity_type: 'document',
            entity_id: docId,
            operation: 'update',
            payload: {
              id: docId,
              title: 'Doc After Remote Trash',
              content: 'New content after remote file was trashed.',
              google_drive_file_id: oldFileId,
            },
            client_timestamp: Date.now(),
          },
          folderId
        );
      } catch (err) {
        syncError = err;
      }

      // Check invariant
      const requirementPassed = syncError === null && recoverRes && recoverRes.fileId !== oldFileId;
      assert.strictEqual(
        requirementPassed,
        true,
        'Requirement fulfilled: Adapter must cleanly re-create trashed documents upon HTTP 404'
      );

      // Verify the new file is not trashed and has the correct content
      const newFile = server.files.get(recoverRes.fileId);
      assert.ok(newFile, 'Re-created document must exist on Drive');
      assert.strictEqual(newFile?.trashed, false, 'Re-created document must not be trashed');
      assert.strictEqual(newFile?.name, 'Doc After Remote Trash');
      assert.strictEqual(newFile?.content, 'New content after remote file was trashed.');

      // Verify SQLite state
      const localDoc = await repo.getDocument(docId);
      assert.strictEqual(localDoc?.google_drive_file_id, recoverRes.fileId);
      assert.strictEqual(localDoc?.sync_status, 'synced');
    });
  });

  // ==========================================================================
  // Challenge 4: Negative Boundary — Transient Errors (HTTP 500, 503) Non-Recreation
  // ==========================================================================
  describe('Challenge 4: Negative Boundary — Transient Errors (HTTP 500, 503) Non-Recreation', () => {
    test('Empirical C4.1: HTTP 500 Internal Server Error during Docs API query does NOT re-create doc or duplicate files', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const folderId = await adapter.ensureDaylightFolder();
      const docId = 'doc-neg-boundary-500';

      // 1. Initial creation
      await repo.saveDocument({
        id: docId,
        title: 'Original Title 500',
        content: 'Original Content 500',
        sync_status: 'pending',
      });

      const initRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-init-500',
          entity_type: 'document',
          entity_id: docId,
          operation: 'create',
          payload: {
            id: docId,
            title: 'Original Title 500',
            content: 'Original Content 500',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      const originalFileId = initRes.fileId;
      assert.strictEqual(server.files.size, 1);

      // 2. Mock transient HTTP 500 on Docs API GET
      const activeFetch = global.fetch;
      let multipartCalled = false;
      global.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes(`/v1/documents/${originalFileId}`) && !url.includes(':batchUpdate')) {
          return new Response(JSON.stringify({ error: { message: 'Internal Server Error', code: 500 } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          multipartCalled = true;
        }
        return activeFetch(input, init);
      }) as any;

      try {
        // Attempt update during HTTP 500 outage
        await assert.rejects(
          async () => {
            await adapter.syncDocumentMutation(
              {
                id: 'mut-update-500',
                entity_type: 'document',
                entity_id: docId,
                operation: 'update',
                payload: {
                  id: docId,
                  title: 'Updated During 500',
                  content: 'Content attempted during 500',
                  google_drive_file_id: originalFileId,
                },
                client_timestamp: Date.now(),
              },
              folderId
            );
          },
          (err: any) => {
            assert.ok(err.message.includes('500'), `Expected 500 error, got: ${err.message}`);
            return true;
          }
        );

        // Invariant 1: Multipart upload (creation) was NEVER triggered
        assert.strictEqual(multipartCalled, false, 'Transient HTTP 500 must NEVER trigger multipart re-creation');

        // Invariant 2: Drive file count is strictly 1 (no duplicates)
        assert.strictEqual(server.files.size, 1, 'Drive must still contain exactly 1 file (no duplicate created)');

        // Invariant 3: SQLite metadata is NOT wiped or corrupted
        const dbDoc = await repo.getDocument(docId);
        assert.strictEqual(
          dbDoc?.google_drive_file_id,
          originalFileId,
          'SQLite google_drive_file_id must remain preserved'
        );
      } finally {
        global.fetch = activeFetch;
      }

      // 3. Connectivity restored: Subsequent sync succeeds with original file ID (zero duplicate files)
      const recoverRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-subsequent-500',
          entity_type: 'document',
          entity_id: docId,
          operation: 'update',
          payload: {
            id: docId,
            title: 'Updated After 500 Resolved',
            content: 'Content successfully synced after 500 resolved',
            google_drive_file_id: originalFileId,
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      assert.strictEqual(recoverRes.fileId, originalFileId, 'Must update existing file ID once transient 500 resolves');
      assert.strictEqual(server.files.size, 1, 'Drive must strictly have 1 file after resolution');
      const finalFile = server.files.get(originalFileId);
      assert.strictEqual(finalFile?.name, 'Updated After 500 Resolved');
      assert.strictEqual(finalFile?.content, 'Content successfully synced after 500 resolved');
    });

    test('Empirical C4.2: HTTP 503 Backend Service Unavailable during batchUpdate does NOT re-create doc or duplicate files', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const folderId = await adapter.ensureDaylightFolder();
      const docId = 'doc-neg-boundary-503';

      await repo.saveDocument({
        id: docId,
        title: 'Original Title 503',
        content: 'Original Content 503',
        sync_status: 'pending',
      });

      const initRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-init-503',
          entity_type: 'document',
          entity_id: docId,
          operation: 'create',
          payload: {
            id: docId,
            title: 'Original Title 503',
            content: 'Original Content 503',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      const originalFileId = initRes.fileId;
      assert.strictEqual(server.files.size, 1);

      // Mock HTTP 503 on batchUpdate
      const activeFetch = global.fetch;
      let multipartCalled = false;
      global.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes(':batchUpdate')) {
          return new Response(JSON.stringify({ error: { message: 'Service Unavailable', code: 503 } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          multipartCalled = true;
        }
        return activeFetch(input, init);
      }) as any;

      try {
        await assert.rejects(
          async () => {
            await adapter.syncDocumentMutation(
              {
                id: 'mut-update-503',
                entity_type: 'document',
                entity_id: docId,
                operation: 'update',
                payload: {
                  id: docId,
                  title: 'Updated During 503',
                  content: 'Content attempted during 503',
                  google_drive_file_id: originalFileId,
                },
                client_timestamp: Date.now(),
              },
              folderId
            );
          },
          (err: any) => {
            assert.ok(err.message.includes('503'), `Expected 503 error, got: ${err.message}`);
            return true;
          }
        );

        assert.strictEqual(multipartCalled, false, 'Transient HTTP 503 must NEVER trigger multipart re-creation');
        assert.strictEqual(server.files.size, 1, 'Drive must still contain exactly 1 file');

        const dbDoc = await repo.getDocument(docId);
        assert.strictEqual(dbDoc?.google_drive_file_id, originalFileId, 'Existing file ID must be retained in SQLite');
      } finally {
        global.fetch = activeFetch;
      }
    });

    test('Empirical C4.3: HTTP 403 Forbidden / Rate Limit does NOT trigger 404 auto-recovery', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const folderId = await adapter.ensureDaylightFolder();
      const docId = 'doc-neg-boundary-403';

      await repo.saveDocument({
        id: docId,
        title: 'Original Title 403',
        content: 'Original Content 403',
        sync_status: 'pending',
      });

      const initRes = await adapter.syncDocumentMutation(
        {
          id: 'mut-init-403',
          entity_type: 'document',
          entity_id: docId,
          operation: 'create',
          payload: {
            id: docId,
            title: 'Original Title 403',
            content: 'Original Content 403',
          },
          client_timestamp: Date.now(),
        },
        folderId
      );

      const originalFileId = initRes.fileId;
      assert.strictEqual(server.files.size, 1);

      // Mock HTTP 403 on Docs GET
      const activeFetch = global.fetch;
      let multipartCalled = false;
      global.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes(`/v1/documents/${originalFileId}`) && !url.includes(':batchUpdate')) {
          return new Response(JSON.stringify({ error: { message: 'The caller does not have permission', code: 403 } }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
          multipartCalled = true;
        }
        return activeFetch(input, init);
      }) as any;

      try {
        await assert.rejects(
          async () => {
            await adapter.syncDocumentMutation(
              {
                id: 'mut-update-403',
                entity_type: 'document',
                entity_id: docId,
                operation: 'update',
                payload: {
                  id: docId,
                  title: 'Updated During 403',
                  content: 'Content attempted during 403',
                  google_drive_file_id: originalFileId,
                },
                client_timestamp: Date.now(),
              },
              folderId
            );
          },
          (err: any) => {
            assert.ok(err.message.includes('403'), `Expected 403 error, got: ${err.message}`);
            return true;
          }
        );

        assert.strictEqual(multipartCalled, false, 'HTTP 403 must NEVER trigger multipart re-creation');
        assert.strictEqual(server.files.size, 1, 'Drive must still contain exactly 1 file');

        const dbDoc = await repo.getDocument(docId);
        assert.strictEqual(dbDoc?.google_drive_file_id, originalFileId, 'Existing file ID must be retained in SQLite');
      } finally {
        global.fetch = activeFetch;
      }
    });

    test('Empirical C4.4: End-to-end queue sync with HTTP 500 outage preserves queue mutation, avoids duplicate files, and recovers upon service restoration', async () => {
      const adapter = new GoogleDriveSyncAdapter({
        accessToken: 'ya29.valid-token',
        db: testDb,
        repository: repo,
      });

      const docId = 'doc-e2e-neg-500';

      await repo.saveDocument({
        id: docId,
        title: 'Initial Queued Doc',
        content: 'Initial Queued Content',
        sync_status: 'pending',
      });

      adapter.queueMutation(docId, 'create', {
        id: docId,
        title: 'Initial Queued Doc',
        content: 'Initial Queued Content',
      });

      const firstSync = await adapter.sync();
      assert.strictEqual(firstSync.pushedCount, 1);
      assert.strictEqual(server.files.size, 1);

      const [firstFile] = Array.from(server.files.values());
      const originalFileId = firstFile.id;

      // Now queue an update mutation
      await repo.saveDocument({
        id: docId,
        title: 'Queued Edit During Outage',
        content: 'Content attempted during 500 outage',
        google_drive_file_id: originalFileId,
        sync_status: 'pending',
      });

      adapter.queueMutation(docId, 'update', {
        id: docId,
        title: 'Queued Edit During Outage',
        content: 'Content attempted during 500 outage',
        google_drive_file_id: originalFileId,
      });

      // Inject 500 outage
      const activeFetch = global.fetch;
      global.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes(`/v1/documents/${originalFileId}`) || url.includes(':batchUpdate')) {
          return new Response(JSON.stringify({ error: { message: 'Internal Server Error', code: 500 } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return activeFetch(input, init);
      }) as any;

      try {
        await assert.rejects(
          async () => {
            await adapter.sync();
          },
          (err: any) => {
            assert.ok(err.message.includes('500'), `Expected 500 error, got: ${err.message}`);
            return true;
          }
        );

        assert.strictEqual(adapter.getStatus().state, 'error', 'Adapter state must transition to error');
        assert.strictEqual(server.files.size, 1, 'No duplicate file created in Drive during 500 outage');

        const dbDoc = await repo.getDocument(docId);
        assert.strictEqual(dbDoc?.google_drive_file_id, originalFileId, 'Existing file ID must remain intact in SQLite');
      } finally {
        global.fetch = activeFetch;
      }

      // Outage resolved: sync() again
      const resolvedSync = await adapter.sync();
      assert.strictEqual(resolvedSync.pushedCount, 1, 'Mutation drained cleanly once 500 resolved');
      assert.strictEqual(server.files.size, 1, 'Drive strictly maintains 1 file (zero duplicates)');

      const finalFile = server.files.get(originalFileId);
      assert.strictEqual(finalFile?.name, 'Queued Edit During Outage');
      assert.strictEqual(finalFile?.content, 'Content attempted during 500 outage');
    });
  });
});

