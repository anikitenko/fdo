## FDO Indexing

FDO retrieval now builds and refreshes a local cached index instead of walking raw files on every query.

Current cache path:
- packaged Electron runtime:
  - `app.getPath("sessionData")/fdo-ai/fdo-ai-index-v1.json`
- fallback for non-Electron/test contexts:
  - `.fdo-cache/fdo-ai-index-v1.json`

Current guarantees:
- versioned index format and testst
- rebuild when the index signature changes
- incremental refresh when tracked docs/code files change
- removal of deleted files from the index

What is stored:
- `version`
- `rootSignature`
- `builtAt`
- `documentCount`
- `manifest`
- `documents`

Quick verification:
1. Delete the current index file from the active cache location if it exists.
2. Ask an FDO question such as `how do FDO plugins work?`
3. Inspect the latest `[FDO Retrieval]` log and confirm:
   - `indexRefreshMode: "rebuild"`
   - `indexDocumentCount` is non-zero
4. Ask another FDO question immediately.
5. Confirm the next `[FDO Retrieval]` log shows:
   - `indexRefreshMode: "incremental"`
   - `indexChangedFiles: 0`
6. Edit a tracked file such as:
   - `src/components/settings/panels/AIAssistantsPanel.jsx`
   - or another file under `docs/`, `src/components/`, `src/ipc/`, `src/utils/`
7. Ask another FDO question.
8. Confirm the next `[FDO Retrieval]` log shows:
   - `indexRefreshMode: "incremental"`
   - `indexChangedFiles` greater than `0`

Important note:
- retrieval quality is still limited by source quality and chunking quality
- this phase improves indexing/refresh behavior, not the full chunking/reranking roadmap from later phases
