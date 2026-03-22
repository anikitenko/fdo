# TODO: Go Beyond "Pretty Modern" To A Seriously Modern LLM Architecture

This roadmap starts after `TODO_MODERN_LLM_PRODUCTION_GRADE.md` is complete.

Goal:
- move from repo-search retrieval to a proper knowledge pipeline
- improve recall, precision, grounding, and debuggability
- make FDO knowledge retrieval production-grade at scale

## Phase 1: Build A Real Knowledge Corpus

- [ ] Define source categories:
  - docs
  - code
  - JSON schemas
  - plugin manifests
  - settings/config definitions
  - prompts/tool definitions
- [ ] Exclude low-value noise:
  - `dist/`
  - generated files
  - minified content
  - lockfiles
  - vendored dependencies
- [ ] Add a corpus builder step that produces normalized source documents.
- [ ] Store metadata for every document:
  - path
  - source type
  - title
  - section
  - language
  - last modified timestamp

Definition of done:
- retrieval works on a curated corpus, not ad hoc raw repo search

## Phase 2: Chunking

- [ ] Add chunking by source type:
  - markdown/doc sections
  - code by symbol or logical block
  - schemas by object/definition block
  - manifests by top-level section
- [ ] Preserve provenance per chunk:
  - file path
  - heading/symbol
  - line metadata if available
- [ ] Avoid chunks that are too small or too large.
- [ ] Add overlap only where it materially improves retrieval.

Definition of done:
- knowledge is retrieved as focused chunks rather than giant files

## Phase 3: Ranking

- [ ] Implement first-pass retrieval:
  - lexical/BM25-style or equivalent
- [ ] Implement second-pass reranking:
  - cheap heuristic scoring first
  - optional model-based reranker later
- [ ] Rank using:
  - exact keyword hits
  - file/source type
  - heading relevance
  - symbol proximity
  - assistant domain hints
- [ ] Return top-N chunks with score explanations.

Definition of done:
- retrieval results are ordered by likely usefulness, not raw grep order

## Phase 4: Retrieval Assembly

- [ ] Build a retrieval orchestrator:
  - query normalization
  - source filtering
  - candidate retrieval
  - reranking
  - context budget trimming
- [ ] Add context assembly rules:
  - diverse but relevant chunks
  - deduplicate near-identical snippets
  - prefer authoritative sources
- [ ] Keep a hard token budget for retrieved context.

Definition of done:
- the model sees a compact, high-signal, budgeted context pack

## Phase 5: Separate Tools By Knowledge Type

- [x] Split generic `search_fdo_knowledge` into specialized tools:
  - `search_fdo_help`
  - `search_fdo_code`
  - `get_fdo_settings_help`
  - `get_plugin_manifest_schema`
  - `get_trust_certificate_info`
- [x] Keep a top-level meta-tool or router if useful.
- [x] Bias to the most authoritative tool for the question type.
- [x] Keep source-code retrieval out of general user-facing FDO help unless the user is explicitly asking about implementation, development, debugging, or improvement work.

Definition of done:
- tooling is domain-specific and easier for the model to use correctly

## Phase 6: Source Identity For Packaged Builds

- [x] Replace raw repo file paths in user-facing answers with stable source identifiers that still make sense in packaged builds (`DMG`, `RPM`, `DEB`).
- [x] Define user-facing source labels such as:
  - `FDO Docs / AI Chat`
  - `FDO Settings / AI Assistants`
  - `FDO Plugin System / Certificates`
- [x] Keep raw code paths only for development/debug-oriented tools or debug mode.
- [x] Ensure retrieval metadata can distinguish:
  - user-facing help sources
  - code/development sources
  - settings/schema sources
- [x] Ensure packaged builds do not depend on the presence of raw `src/` paths for source attribution.

Definition of done:
- source attribution remains understandable and stable outside the development workspace
- user-facing FDO help does not expose raw code paths by default

## Phase 7: Add Source Trust And Answer Policy

- [x] Define source priority:
  - explicit product docs
  - source of truth config/schema
  - code behavior
  - comments/examples
- [x] If sources conflict, instruct the assistant to say so.
- [x] If retrieval confidence is low, require a follow-up question or a qualified answer.
- [x] Add confidence metadata to retrieval output.

Definition of done:
- the assistant behaves conservatively when knowledge is weak or conflicting

## Phase 8: Memory Architecture

- [x] Separate memory classes:
  - short-term turn history
  - compressed conversation summary
  - durable user preferences
  - retrieved product knowledge
- [x] Do not mix retrieved documentation into durable memory.
- [x] Keep user preferences in a structured store instead of free-text summary.

Definition of done:
- memory and retrieval are fully separated and maintainable

## Phase 9: Conversational Routing State

- [x] Add explicit per-session routing state instead of relying mainly on keyword heuristics.
- [x] Store lightweight structured state such as:
  - `activeRoute`
  - `activeTool`
  - `activeTaskShape`
  - `activeScope`
  - `routeConfidence`
  - `lastToolUsedAt`
  - `lastRouteChangeAt`
  - `recentToolHistory`
- [x] Add explicit scope awareness in addition to route and task shape.
- [x] Track scope separately, for example:
  - `ui`
  - `settings`
  - `plugins`
  - `trust`
  - `sdk`
  - `docs_help`
  - `code_dev`
  - `general`
- [x] Use scope to narrow retrieval and answer style before generating the final response.
- [x] If route is clear but scope is vague, ask a short scope clarification instead of giving a broad abstract answer.
- [x] Persist scope in `session.routing` so follow-up questions can keep the right product area without repeating it.
- [x] Track the active task shape separately from route, for example:
  - `general_chat`
  - `translation`
  - `rewriting`
  - `qa`
  - `coding_help`
  - `retrieval_grounded_help`
- [x] Use the latest-turn intent to override stale task shape when the user changes what they are trying to do.
- [x] Prevent old task shapes from leaking into later turns:
  - do not keep translating unless the current turn explicitly asks for translation
  - do not keep rewriting unless the current turn explicitly asks for rewriting
  - do not keep code-fixing or retrieval-grounding as the response format when the user has moved back to plain conversation
- [x] Use routing precedence like:
  1. direct intent in the current message
  2. explicit session routing state
  3. semantic router step when deterministic routing is weak or ambiguous
  4. fallback heuristics
  5. clarification when confidence is low
- [x] Add a semantic router stage for turns where keywords are missing or ambiguous.
- [x] The semantic router should return structured output such as:
  - `route`
  - `taskShape`
  - `confidence`
  - `needsClarification`
- [x] Run the semantic router only when:
  - direct route is `general`
  - multiple route candidates are present
  - session routing confidence is low
- [x] Persist semantic routing output into `session.routing` instead of keeping it only in transient model state.
- [x] Use confidence thresholds so weak semantic routing asks for clarification instead of silently forcing a route.
- [x] Add route decay/reset rules so old context does not leak into unrelated later turns.
- [x] Reset or lower confidence when:
  - the user clearly changes topic
  - the user asks a broad unrelated question
  - multiple domains are equally plausible
- [x] Preserve route continuity for follow-up questions even when they do not repeat trigger keywords.
- [x] Keep routing state separate from summarized conversation text.
- [x] Ensure routing state is not treated as product knowledge.

Best-practice notes:
- Prefer explicit state over re-inferring intent from raw text on every turn.
- Keep the state small, typed, and easy to inspect.
- Add confidence and decay instead of assuming the previous tool is always still correct.
- Separate `route/domain` from `task shape/response mode`; they solve different failures and should not be collapsed into one field.
- Separate `route`, `task shape`, and `scope`; they solve different failures and should not be collapsed into one field.
- Let the latest turn win over stale task shape unless confidence is very low.
- Use a dedicated semantic router step for ambiguous turns instead of relying on the main answer model to "implicitly" pick the right domain.
- When confidence is low, ask a follow-up instead of silently picking a stale route.

Definition of done:
- follow-up questions can continue the right tool/domain without repeating keywords
- unrelated turns do not accidentally inherit stale tool routing
- the assistant does not keep translating, rewriting, or otherwise reusing an old response mode after the user has changed intent

## Phase 10: Tool Policy And Scope Control

- [x] Separate the full tool registry from the subset allowed for the current turn.
- [x] Dynamically pass only the tools relevant to the current route/state.
- [x] Add route-scoped tool allowlists to reduce unintended tool use over long conversations.
- [x] For complex multi-domain turns, support either:
  - multi-tool planning, or
  - explicit clarification before tool execution
- [x] Prevent the model from seeing irrelevant tools when the route is narrow.

Best-practice notes:
- Restrict allowed tools per turn rather than exposing the full toolset all the time.
- Keep tool descriptions concise, explicit, and action-oriented.
- Validate tool outputs server-side and never trust free-form tool arguments blindly.

Definition of done:
- tool selection is safer, more predictable, and less brittle over long chats

## Phase 11: Router Evaluation Harness

- [x] Add evaluation cases specifically for routing continuity across turns.
- [x] Include cases like:
  - direct domain question -> follow-up without keywords
  - domain switch after several follow-ups
  - ambiguous follow-up requiring clarification
  - mixed-domain turn needing scoped tool choice
- [x] Track routing metrics:
  - route accuracy
  - stale-route errors
  - unnecessary clarifications
  - wrong-tool activations
- [x] Keep a regression set for weather/FDO/web/general follow-up behavior.

Definition of done:
- routing quality is measured and regressions are visible

## Phase 12: Safe Bundled Codex Upgrade

- [ ] Upgrade `@openai/codex` only to a non-vulnerable version that fixes the known sandbox-bypass advisory.
- [ ] Rework the current Codex provider to support bundled runtime only after that safe upgrade is verified.
- [x] Keep `Codex CLI (ChatGPT)` provider architecture separate from generic chat assistants.
- [ ] Verify packaged runtime behavior on:
  - `DMG`
  - `RPM`
  - `DEB`
- [x] Add an explicit security gate so vulnerable bundled Codex versions are never shipped.
- [x] Add a manual verification checklist for:
  - bundled Codex resolution
  - ChatGPT sign-in persistence
  - non-interactive coding-agent execution
  - failure states when Codex auth is missing or expired

Definition of done:
- FDO can safely ship a bundled Codex runtime for coding-agent workflows without relying on vulnerable versions or ad hoc packaging

## Phase 13: Evaluation Harness

- [x] Build a small benchmark set of FDO questions.
- [x] Include categories:
  - settings help
  - plugin architecture
  - manifest schema questions
  - trust/security questions
  - UI behavior
  - code behavior questions
- [x] Add pass/fail expectations:
  - relevant sources retrieved
  - correct answer shape
  - no unsupported claims
- [x] Track regressions when retrieval or prompts change.

Definition of done:
- changes are measured, not guessed

## Phase 14: Metrics And Observability

- [x] Track lightweight aggregates for:
  - retrieval hit rate
  - selection-quality proxies (`candidateCount` vs `selectedCount` vs `droppedCount`, confidence sum)
  - answer groundedness
  - tool-call frequency
  - token usage by prompt vs retrieval vs output
  - retrieval miss patterns
- [x] Add a debug panel or debug log mode for:
  - selected route
  - candidate chunks
  - final included chunks
  - dropped chunks
  - tool timing
- [x] Add optional Langfuse integration for production-grade tracing and observability:
  - session-level traces
  - route/scope/task-shape decisions
  - rewritten retrieval queries
  - tool-call spans
  - retrieval candidate/selection metadata
  - token/cost/latency tracking
  - prompt/version association
  - user feedback / eval hooks later

Definition of done:
- retrieval behavior is inspectable in production-like debugging

## Phase 15: Indexing And Refresh

- [x] Add an index build/update workflow.
- [x] Support incremental refresh when docs/code change.
- [x] Version the index format.
- [x] Rebuild when important source classes change.

Definition of done:
- knowledge retrieval remains fresh without manual rework

## Phase 16: Optional Advanced Retrieval

- [x] Add embeddings-based retrieval if lexical retrieval becomes insufficient.
- [x] Consider hybrid retrieval:
  - lexical first-pass
  - embedding recall
  - reranked merge
- [x] Add code-aware retrieval:
  - symbol graph
  - import adjacency
  - component-to-handler linking
- [x] Add intent-aware query rewriting for weak user questions.

Definition of done:
- retrieval quality stays strong as the codebase and docs grow

## Phase 17: UI/UX For Grounded Answers

- [x] Show cited sources in the chat UI.
- [x] Let user inspect retrieved snippets.
- [x] Show when the answer is based on docs vs code vs config/schema.
- [x] Show low-confidence state explicitly.

Definition of done:
- grounded answers are visible and auditable to users

## Phase 18: Composer Intelligence And Expressiveness

- [x] Add modern inline word/phrase pre-completion in the chat composer:
  - low-latency ghost text or inline continuation
  - accept with `Tab` / right-arrow style interaction
  - dismiss cleanly on continued typing
- [x] Keep pre-completion context-aware:
  - current turn text
  - active conversation topic
  - active reply language
  - recent user phrasing/style
- [x] Ensure pre-completion does not silently submit or overwrite user text.
- [x] Add explicit emoji support in the chat composer and rendering path:
  - reliable input/rendering
  - no corruption in streaming or markdown rendering
  - preserve emoji through persistence/reload
- [x] Make emoji behavior multilingual-safe and compatible with reply/pre-completion flows.
- [x] Add manual regression checks for:
  - ghost text acceptance/rejection
  - emoji persistence after restart
  - emoji display during streaming replies

Definition of done:
- the composer supports modern low-friction drafting with safe pre-completion and stable emoji handling

## Phase 19: AI Chat Localization And Ukrainian UX

- [ ] Add first-class Ukrainian support across the AI chat UI, not only model replies:
  - composer labels
  - grounded/retrieval labels
  - clarification labels
  - reply/session actions
  - options/tooling text
- [ ] Introduce proper i18n for AI chat UI strings instead of ad hoc hardcoded English labels.
- [ ] Make reply-language state and UI language work together cleanly:
  - Ukrainian UI can coexist with English/Polish/German/Chinese model replies
  - system labels should not randomly switch language mid-chat
- [ ] Ensure localized labels also work in:
  - grounded answer metadata
  - tool error/fallback messages
  - composer smart-completion affordances
  - reply-from-selection / new-chat-from-selection flows
- [ ] Add regression checks for:
  - Ukrainian UI labels
  - mixed UI language + model response language
  - restart persistence of selected UI language

Definition of done:
- AI chat feels intentionally localized, with Ukrainian supported across the whole chat surface via a maintainable i18n layer

## Suggested Implementation Order

1. Build curated corpus.
2. Add chunking.
3. Add ranking and retrieval assembly.
4. Split specialized FDO tools.
5. Add explicit routing state and scoped tool policy.
6. Add trust/confidence policy.
7. Add routing and retrieval evaluation harnesses.
8. Add metrics and indexing workflow.
9. Only then consider embeddings/hybrid retrieval.

## Guardrails

- Do not jump to embeddings first.
- Do not mix retrieval payload into the system prompt.
- Do not treat summarization as knowledge storage.
- Do not rely only on keyword triggers once multi-turn tool use matters.
- Do not let stale route state override clear new user intent.
- Do not ship retrieval changes without benchmark questions.
