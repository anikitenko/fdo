## FDO Code Retrieval

FDO code-mode retrieval now uses lightweight code-aware metadata from the local index.

What is indexed for JS/TS sources:
- imported module paths
- exported/function symbols
- React-style component names
- IPC/electron handler-like identifiers

What code-aware scoring does:
- boosts code results when query terms align with:
  - symbols
  - imports
  - component names
  - handler names
- adds small scope-aware boosts for:
  - UI/component files
  - settings-related handlers
  - plugin-related flows

Quick verification:
1. Ask code-focused FDO questions such as:
   - `where is plugin loading implemented in FDO code?`
   - `where are AI assistant settings handled?`
   - `which component manages plugins in the UI?`
2. Inspect the latest `[FDO Retrieval]` log.
3. Confirm:
   - `mode: "code"`
   - relevant `src/...` code sources rank near the top
   - `why` strings now include `Code-aware: ...` when symbol/import/component/handler matches were used
4. Compare with a help-style question like:
   - `how do FDO plugins work?`
5. Confirm help-mode still favors user-facing/help sources rather than code-first results.

Important note:
- this is still lightweight lexical + metadata boosting
- it is not yet a full symbol graph or import adjacency graph
