## FDO Retrieval Debugging

FDO help/code retrieval now emits structured debug logs in the main process:

- `[FDO Retrieval]`

Each log includes:

- `tool`
- `query`
- `mode`
- `scope`
- `diagnostics.filesScanned`
- `diagnostics.candidateCount`
- `diagnostics.selectedCount`
- `diagnostics.droppedCount`
- `diagnostics.retrievalTimeMs`
- `diagnostics.topCandidates`
- `diagnostics.droppedCandidates`

Use this when:

- a grounded FDO answer looks weak
- the wrong sources are selected
- the retriever feels slow
- a source you expected is being dropped

Recommended debugging workflow:

1. Ask the FDO question in chat.
2. Inspect the latest `[FDO Retrieval]` log entry.
3. Compare:
   - `topCandidates`
   - `droppedCandidates`
   - `scope`
   - `retrievalTimeMs`
4. If the right source is in `droppedCandidates`, adjust scoring/scope rules instead of changing the prompt first.
