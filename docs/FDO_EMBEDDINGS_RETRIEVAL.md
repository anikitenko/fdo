# FDO Embeddings Retrieval Checks

Use this checklist to verify the Phase 16 embeddings-based retrieval slice.

## Goal

Confirm that FDO retrieval now includes a local semantic vector signal in addition to lexical and second-stage reranking.

## How it works

- the FDO index now stores a local semantic embedding for each indexed document
- queries are embedded locally at retrieval time
- retrieval diagnostics now expose:
  - `embeddingSimilarity`
  - `embeddingScore`

## Manual checks

1. Delete the cached FDO index so it rebuilds on the next retrieval.
2. Ask a help-style FDO question with weaker lexical wording, for example:
   - `what about configuration of assistants in FDO?`
   - `question about plugin management UI`
3. Ask a code-style question, for example:
   - `where is plugin loading implemented in FDO code?`
   - `where are AI assistant settings handled?`
4. Inspect the `[FDO Retrieval]` log.

Expected:
- `indexRefreshMode` is `rebuild` on the first run after cache deletion
- `topCandidates` include:
  - `lexicalScore`
  - `secondSignalScore`
  - `embeddingSimilarity`
  - `embeddingScore`
- at least some top candidates have non-zero `embeddingSimilarity`
- final `score` is higher than lexical-only score for semantically relevant candidates

## Regression expectation

- help-mode should still prefer human-meaningful help sources
- code-mode should still prefer relevant `src/...` files
- embeddings should improve weak-lexical matches, not override obviously wrong candidates
