# Dead Ends & Failed Approaches: Daylight Writer

This document logs approaches that failed during development to prevent oscillation and repeated failed strategies across agent iterations.

| Iteration | Approach Tried | Why It Failed | Files Touched |
|-----------|---------------|---------------|---------------|
| M3 Iteration 2 | Regex-based tag whitelist in `sanitizeSnippetHtml` (`/<\/?([a-zA-Z0-9_-]+)(?:\s+[^>]*)?>/g`) | Solidus attribute delimiters (`<svg/onload=alert(1)>`) and unclosed/truncated tags (`<svg on...`) do not match whitespace `\s+` or trailing `>`, bypassing the regex completely and creating live DOM nodes in `card.innerHTML`. Must use tokenized placeholder replacement (`\uE000` / `\uE001`) instead. | `src/drawers/left-library.ts` |
| M3 Iteration 2 | Double escaping `this.searchQuery` in `renderEmptyState` | `renderEmptyState` already calls `escapeHtml(message)`. Calling `escapeHtml(this.searchQuery)` before passing to `renderEmptyState` results in `&amp;lt;`, rendering ugly `&lt;` in the UI. Must pass unescaped query to `renderEmptyState`. | `src/drawers/left-library.ts` |
| M5 Iteration 1 | Prepending Catalog & Pages via `this.objects.unshift()` | Shifts all previously allocated object indices by +2, causing `/Kids [4 0 R]` to reference a Font instead of a Page dictionary, breaking ISO 32000-1 and CoreGraphics/pypdf loaders. Must allocate Objects 1 & 2 upfront and mutate in-place. | `src/export/pdf-exporter.ts` |
| M5 Iteration 2 | Unconditional `commitBatch()` in `OfflineMutationQueue.drain()` | When `adapter.sync()` returns `pushedCount === 0` (e.g. mid-drain offline event), `commitBatch()` deletes the acquired batch from SQLite despite zero rows reaching remote, permanently losing user mutations. Must rollback unpushed batch when zero pushed or offline. | `src/sync/offline-mutation-queue.ts` |
| M5 Iteration 2 | Retaining unpurged staged mutations in `MockGoogleDocsSyncAdapter.queue` on error | Retaining items across thrown errors causes subsequent syncs to push duplicate items or ghost-push dead-letter records. Staging queue must be cleared or isolated. | `src/sync/mock-google-docs-sync-adapter.ts` |

