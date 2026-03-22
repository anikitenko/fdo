## FDO Hybrid Retrieval

FDO retrieval now uses a two-stage lightweight hybrid process:

1. lexical first-pass scoring
2. second-signal reranking

The second signal is still local and deterministic. It uses:
- title overlap
- source-path overlap
- snippet overlap
- for code mode:
  - imports overlap
  - symbol overlap
  - handler overlap
  - component overlap

Diagnostics now expose:
- `lexicalScore`
- `secondSignalScore`
- `secondSignalReasons`
- final merged `score`

Quick verification:
1. Ask a help-style question like:
   - `what about settings in FDO?`
2. Ask a code-style question like:
   - `where are AI assistant settings handled?`
3. Inspect the latest `[FDO Retrieval]` log.
4. In `topCandidates`, confirm:
   - both `lexicalScore` and `secondSignalScore` are present
   - `secondSignalReasons` is non-empty for at least some top results
   - the final `score` is influenced by both signals
5. Compare a weaker query and a clearer query and confirm the better-aligned result rises in ranking.

Important note:
- this is hybrid lexical + local reranking
- it is not embeddings-based retrieval yet
