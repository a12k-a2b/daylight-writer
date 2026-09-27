# Dead Ends Log

| Iteration | Milestone | Approach Tried | Why It Failed | Files Touched |
|-----------|-----------|---------------|---------------|---------------|
| Survey | M2 | Media PATCH to Google Drive v3 `upload/drive/v3/files/{id}?uploadType=media` for native Google Docs | Google Drive v3 rejects media uploads for native Google Docs with HTTP 403. Must use Google Docs API v1 `documents.batchUpdate` (`deleteContentRange` + `insertText`). | `src/sync/google-drive-sync-adapter.ts` |
