# TODO: Turn Current AI Chat Into A Modern Production-Grade LLM Implementation

This roadmap is for the current FDO chat stack in:
- `src/ipc/ai/ai_chat.js`
- `src/ipc/ai/ai_chat_core.js`
- `src/ipc/ai/tools/index.js`

Goal:
- keep chat stateless at the provider level
- reduce repeated token waste
- separate behavior, memory, and product knowledge
- make FDO answers grounded through tools instead of a giant prompt

## Phase 0: Freeze The Current Baseline

- [x] Capture a baseline with current behavior:
  - image attachments
  - PDF attachments
  - normal text chat
  - weather tool flow
  - summarization/compression
- [x] Add a short architecture note in code comments:
  - `system prompt = behavior`
  - `session messages = memory`
  - `tools/retrieval = product knowledge`
- [x] Add a short manual test checklist for AI chat flows in `docs/`.

## Phase 1: Shrink The System Prompt

- [x] Replace the long Junie prompt in `src/ipc/ai/ai_chat_core.js` with a compact behavioral prompt.
- [x] Keep only stable instructions:
  - concise and technically precise
  - analyze attachments when present
  - do not claim direct host execution
  - ask focused follow-up questions when context is insufficient
  - use tools for FDO-specific knowledge instead of guessing
- [x] Remove product-marketing copy and repeated capability statements.
- [x] Keep prompt size low enough that it can be sent on every request without noticeable waste.

Definition of done:
- system prompt is mostly policy, not product documentation
- prompt can be read in under 15 seconds

## Phase 2: Introduce FDO Knowledge Retrieval

- [x] Add a new tool to `src/ipc/ai/tools/`:
  - `search_fdo_knowledge`
- [x] Register it in `src/ipc/ai/tools/index.js`.
- [x] Back it with local repo search first:
  - docs
  - manifests
  - settings-related files
  - AI/chat files
  - plugin/trust/sdk files
- [x] Return compact grounded results:
  - source path
  - short snippet
  - why it matched
- [x] Update the base system prompt so the model is told to use this tool when the question is about FDO behavior, architecture, settings, plugins, certificates, SDK, or UI behavior.

Definition of done:
- FDO-specific questions do not rely on baked-in product prose
- answer path can retrieve local source facts on demand

## Phase 3: Add Lightweight Routing

- [x] Add a lightweight router before tool selection.
- [x] If prompt looks FDO-specific, bias toward enabling `search_fdo_knowledge`.
- [x] Keep general questions on the lightweight path with no extra product context.
- [x] Route examples:
  - weather/internet/tool domains -> existing tools
  - FDO/settings/plugins/manifests/certificates/UI -> FDO knowledge tool
  - generic coding/advice -> plain model
- [x] Make the router deterministic and simple at first:
  - keyword and phrase heuristics
  - no model-based classifier yet

Definition of done:
- general chat stays cheap
- FDO questions reliably get retrieval support

## Phase 4: Ground The Final Answer

- [x] When `search_fdo_knowledge` is used, pass only the selected relevant results into the final model call.
- [x] Include source metadata in the tool result.
- [x] Encourage the model to say when the retrieved context is insufficient.
- [x] Add a renderer/UI pattern for grounded answers:
  - optional “Sources used” section
  - or expandable source references

Definition of done:
- FDO answers are grounded in actual local sources
- user can see where the answer came from

## Phase 5: Clean Memory Boundaries

- [x] Keep session memory separate from product retrieval context.
- [x] Do not store retrieved FDO docs as if they were user conversation.
- [x] Keep summarization focused on:
  - user goals
  - constraints
  - decisions
  - unresolved issues
- [x] Do not let summarization become a replacement for product knowledge retrieval.

Definition of done:
- summaries preserve conversation state, not documentation payload

## Phase 6: Add Observability

- [x] Add structured logs for:
  - route selection
  - active tools
  - tool-call inputs
  - retrieved sources
  - final model used
  - token usage per request
- [x] Add logs for retrieval misses:
  - no FDO source found
  - too many matches
  - ambiguous result set
- [x] Add per-request debug context without logging secrets.

Definition of done:
- when an answer is wrong, we can see whether routing, retrieval, or generation failed

## Phase 7: Harden Tool Contracts

- [x] Standardize tool return shape:
  - `name`
  - `ok`
  - `results`
  - `sources`
  - `error`
- [x] Normalize tool errors into user-safe failures.
- [x] Ensure model-facing tool descriptions are short and precise.
- [x] Prevent giant raw file dumps from going straight into prompts.

Definition of done:
- tools are predictable for orchestration and debugging

## Phase 8: UI Improvements

- [x] Show when an answer used FDO knowledge retrieval.
- [x] Show source references in the chat UI.
- [x] Optionally show “Used tools” for debug mode.
- [x] Keep failure visibility in UI:
  - tool failed
  - no source found
  - partial answer only

Definition of done:
- user can tell whether the answer was grounded or generic

## Phase 9: Verification

- [x] Test general questions with no FDO terms.
- [x] Test FDO-specific questions:
  - assistant settings
  - plugin manifests
  - trust certificates
  - Electron/React UI behavior
  - AI assistant selection/model behavior
- [x] Test mixed questions:
  - “How should FDO expose weather in plugins?”
- [x] Verify token usage drops after removing large baked-in product prompt.
- [x] Verify summarization still works after retrieval changes.

## Suggested Implementation Order

1. Phase 1: shrink system prompt.
2. Phase 2: add `search_fdo_knowledge`.
3. Phase 3: add lightweight routing.
4. Phase 4: ground final answers with source snippets.
5. Phase 6: add observability.
6. Phase 8: expose sources in UI.
7. Phase 5 and 7: tighten boundaries and contracts as cleanup.
8. Phase 9: regression test everything.

## Non-Goals For This Stage

- semantic chunking
- ranking pipelines
- embeddings/vector DB
- hybrid retrieval
- code-aware chunk scoring

Those belong in the next roadmap.
