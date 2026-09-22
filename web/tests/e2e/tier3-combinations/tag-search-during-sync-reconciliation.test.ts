import test from 'node:test';
import assert from 'node:assert';
import {
  InMemoryStorageRepository,
  MockGoogleDocsSyncAdapter,
} from '../helpers/mock-adapters.ts';

test('Tier 3 Combination: Tag search during background sync reconciliation', async () => {
  const repo = new InMemoryStorageRepository();
  const sync = new MockGoogleDocsSyncAdapter();
  await repo.init();
  await sync.init();

  // Create baseline documents
  await repo.saveDocument({
    id: 'doc-sync-1',
    title: 'Archive of Epistemology',
    content: 'Foundational epistemological questions.',
  });
  await repo.setDocumentTags('doc-sync-1', ['#philosophy/epistemology']);

  await repo.saveDocument({
    id: 'doc-sync-2',
    title: 'Modern Ethics in Technology',
    content: 'Ethical considerations for autonomous systems.',
  });
  await repo.setDocumentTags('doc-sync-2', ['#philosophy/ethics']);

  // Simulate background sync cycle with 20ms network latency
  sync.simulateNetworkDelayMs = 20;
  sync.queueMutation('doc-sync-1', 'update', { content: 'Updated epistemological questions.' });

  // Concurrently run fuzzy search and tag filtering while sync is running
  const syncPromise = sync.sync();

  const searchResultsPromise = repo.searchDocuments('epistemology');
  const tagFilterPromise = repo.listDocuments({ tagId: 'philosophy/ethics' });

  const [syncRes, searchResults, tagFilteredDocs] = await Promise.all([
    syncPromise,
    searchResultsPromise,
    tagFilterPromise,
  ]);

  // Verify sync completed cleanly
  assert.strictEqual(syncRes.pushedCount, 1);
  assert.strictEqual(sync.getStatus().pendingCount, 0);

  // Verify search completed with full accuracy without interference
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].document.id, 'doc-sync-1');

  // Verify tag query completed accurately
  assert.strictEqual(tagFilteredDocs.length, 1);
  assert.strictEqual(tagFilteredDocs[0].id, 'doc-sync-2');
});
