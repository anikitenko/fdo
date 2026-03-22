## FDO Query Rewriting

Weak FDO help/code questions now go through a deterministic rewrite layer before retrieval scoring.

Goal:
- improve retrieval for short or underspecified questions by injecting scope-aware FDO terms
- avoid adding another model hop just for retrieval normalization

Current behavior:
- original query is preserved
- scope-aware rewrite terms are appended before token normalization
- retrieval diagnostics now include:
  - `rewrittenQuery`
  - `rewriteTerms`

Quick verification:
1. Ask a weak scoped question such as:
   - `what about settings in FDO?`
   - `and plugins?`
   - `implementation of plugin loading?`
2. Inspect the latest `[FDO Retrieval]` log.
3. Confirm:
   - `rewrittenQuery` is longer than the raw question
   - `rewriteTerms` includes relevant scope hints such as:
     - `settings`, `preferences`, `ai assistants`
     - `plugin management`, `plugin loading`
     - `dialog`, `panel`, `components`
4. Confirm the retrieved sources are more aligned with the intended FDO scope than before.

Important note:
- this is still deterministic lexical rewriting
- it is a Phase 16 improvement, but not embeddings or hybrid retrieval yet
