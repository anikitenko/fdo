## AI Chat Metrics

The chat runtime now stores lightweight aggregate metrics under `ai.metrics` in the Electron settings store.

Tracked aggregates:
- retrieval hit/miss counts
- low-confidence and conflict counts
- candidate vs selected vs dropped retrieval counts
- cumulative retrieval time
- recent retrieval miss patterns
- tool-call frequency by tool name
- assistant reply groundedness counters
- token totals for prompt vs retrieval vs output

Current structure:
- `ai.metrics.retrieval`
- `ai.metrics.tools`
- `ai.metrics.answers`
- `ai.metrics.tokens`

Notes:
- retrieval "selection quality" is currently tracked via proxies:
  - `candidateCount`
  - `selectedCount`
  - `droppedCount`
  - confidence totals
- retrieval token usage is estimated from the retrieved tool payload passed into tool follow-up synthesis
- there is no dedicated UI for these aggregates yet; they are persisted for debugging and regression tracking

Quick verification:
1. Ask a few FDO help/code questions.
2. Trigger at least one tool-backed weather/web/FDO answer.
3. Inspect the persisted settings store and confirm:
   - retrieval counters increase
   - `countsByTool` includes used tool names
   - token totals move after normal and tool-follow-up answers
   - `recentMisses` records no-result or low-confidence retrieval cases
