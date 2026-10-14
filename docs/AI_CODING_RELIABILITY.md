# AI Coding Agent reliability checks

## Realistic requests versus contract regressions

The default Web Tools Workbench live scenario uses a short product request and
an attached screenshot. It does not supply SDK calls, DOM hooks, CSS names,
file layouts, or test syntax. Those platform conventions come from the same
shared authoring guide and installed-SDK retrieval used by normal requests.
Application-specific selectors and module boundaries are implementation choices,
not additional shared-knowledge requirements.

The realistic scenario checks compilation, editor errors, added/executed tests,
and rendered tools using accessible control names and visible results. It
exercises JSON formatting/errors, text transformation/counts, URL encoding and
decoding, HTML analysis, SVG inspection, social previews, library search, and
saving a favourite. It checks narrow-screen overflow and records screenshots.
The screenshots still need human comparison with the reference; passing layout
checks is not proof of visual fidelity. Network observation covers interaction
requests from the plugin frame, not all initialization or background activity.

There is no test-written repair recipe or rubric-coaching loop in this scenario.
Normal agent validation and repair remain active. Failed acceptance is reported
with artifacts rather than teaching the model hidden selectors or CSS rules.
The old detailed scenario remains available by setting
`FDO_LIVE_WORKBENCH_CONTRACT=1` when running the Workbench live test. That mode is
a contract regression and cannot satisfy the realistic-user release gate.
JSON Inspector and Rose Calculator remain separate, prescriptive regressions.

Staged API file requests use streamed source by default, rather than buffered
JSON file envelopes. The shared receiver aborts an attempt as soon as incoming
text exceeds its transport bound (48,000 source characters plus 1,024 envelope
characters). Plans retain structured output with a 9,000-character bound.
Early size failures enter bounded decomposition without applying partial code
or replaying completed files. Request accounting and cancellation still apply.
These are character bounds, not estimates of token counts: smaller responses
can still hit the provider's token limit. Buffered plan responses cannot be
inspected until returned, and aborting a stream does not guarantee that a
provider stops generation or billing immediately.

## SDK evidence and repair context

The shared authoring guide describes the plugin lifecycle, host boundaries,
stylesheet contract, visual expectations and validation workflow. Feature-specific
recipes belong in neither provider adapters nor the common guide. The backend
retrieves bounded excerpts from the installed SDK declarations, docs and examples,
including their source paths, for all workspace requests (API and CLI providers).
Staged generation refreshes that evidence for each file and repair using current
SDK imports and diagnostics. Planning evidence is not repeated in every file
request. Retrieval is local and consumes no model requests.

Declarations take priority over examples. Workspace dependencies and consumers
remain the evidence for cross-file contracts; source/import checks, candidate
compilation, editor diagnostics and behavior tests remain independent gates.
Screenshot routing is preserved for visual generation; syntax-only repairs do
not resend it. Retrieval is heuristic and excerpts can be incomplete. This does
not add autonomous screenshot inspection or a full TypeScript checker, and
controlled provider tests do not establish live model quality.

Focused Problems-panel repairs also pass their original per-file diagnostics to
SDK retrieval, prioritizing the reported types over unrelated imports. If a
repair repeats a diagnostic owner unchanged and no other file changes its
public dependency context, the host requests one additional correction limited
to that owner. It retains successful sibling repairs, respects the existing
request budget, and rejects a second unchanged response without applying the
batch. Unchanged diagnostic files earn no validated-file progress credit.
This catches no-op repairs; changed source still requires semantic validation
in the editor and is not proven correct merely by passing this guard.

Generated TypeScript also checks simple unused trailing callback parameters
before accepting a file, matching the editor's unused-parameter policy. The
diagnostic asks for a behavioral repair; it does not rename or delete code
automatically. Earlier positional parameters, explicit underscore parameters,
destructuring and implicit `arguments`/`eval` usage are left to the editor.

Run the deterministic safety suite without credentials or provider requests:

```sh
npm run test:ai:safety
```

It checks cancellation and late replies, snapshot switching, workspace preservation after truncation/disconnection/rate-limit errors, stream framing, bounded output-limit recovery, plugin scope, and live-test request limits. Provider streams are simulated; these tests do not establish a live model's quality or availability.

## Repeated live runs

Response scope validation recognizes new virtual files declared in complete
`### File:` sections, including `/src/` and `/tests/` folders absent from the
pre-request workspace snapshot. It still rejects unrelated host-file references
and does not use new declarations to authorize machine-absolute paths. Source,
import and workspace-path checks still run before application. This prevents
a completed workspace from being regenerated solely because it added a nested
plugin test file.

In explicit source-response mode, a completed provider answer may include prose
around one closed fenced code block. The host owns the planned target path and
uses only that block as the file; it does not apply surrounding explanation.
Multiple blocks, conflicting file headings, missing fences and truncated provider
streams still fail. Extracted source must pass the same syntax, workspace and
import validation. This tolerance does not apply to JSON planning responses or
select a file from a multi-file answer.

Every CSS generation request receives exact relative import targets computed
from the available workspace paths. Split compositions also receive explicit
`@import` directives for their helpers. For a completed CSS response only, a
missing relative import can be corrected when its filename matches exactly one
of that composition's known helpers. Initial-plan imports are also eligible when
the target belongs to the approved plan and its filename is unique across all
known workspace paths, including unchanged files. An unrelated existing file
cannot become a correction target solely because its name matches. Existing
resolving imports, ambiguous filenames, unknown targets, external URLs and
malformed CSS are left unchanged for normal validation.
Import order, media/layer conditions and local rules are preserved. The result
passes the same file, syntax and import checks before entering the transaction;
this does not add files or consume a model repair request.

Workspace file plans may mark `visualReference: false` for modules that do not
need the reference image. Planning, visual files, and legacy plans without this
field keep the image; written task requirements remain present in every request.
Repairs reuse the same file's image policy. Dependency context retains exported
interfaces, inferred implementations, and their supporting declarations, while
omitting unrelated private helpers and fixtures. Generated source is unchanged
and still undergoes the existing validation before application.

In the saved September 22 timeout run, 28 serial provider calls exhausted the
30-minute scenario budget during stylesheet generation. Applying the context
compaction to its 21 completed files reduced dependency excerpts from 22,464 to
16,109 characters (28%). This is a measured input reduction, not a measured
live speedup or evidence that the scenario now passes. File/line counts are not
generation targets; provider latency and output length still affect completion.

With the existing `FDO_TEST_AI_API_KEY`, `FDO_TEST_AI_MODEL`, and optional `FDO_TEST_AI_PROVIDER` environment variables:

```sh
npm run test:ai:reliability -- --repeat 3 --grep "Web Tools Workbench" --dry-run
npm run test:ai:reliability -- --repeat 3 --grep "Web Tools Workbench"
```

The dry run validates and displays the execution plan without building, launching Electron, or calling providers. Model names must be configured even for a dry run; credentials are required only for execution. The normal single-run command remains unchanged.

To compare providers and models, create a JSON matrix containing environment-variable references, never API keys:

```json
[
  {"provider": "openai", "modelEnv": "FDO_TEST_OPENAI_MODEL", "apiKeyEnv": "FDO_TEST_OPENAI_KEY"},
  {"provider": "anthropic", "modelEnv": "FDO_TEST_ANTHROPIC_MODEL", "apiKeyEnv": "FDO_TEST_ANTHROPIC_KEY"}
]
```

```sh
npm run test:ai:reliability -- --matrix /path/to/matrix.json --repeat 3 --grep "Web Tools Workbench"
```

`model` may replace `modelEnv` with an explicit model identifier. Additional entries can compare models from the same provider. The runner supports OpenAI, Anthropic, Gemini API, Cloudflare Workers AI, and local Ollama models.

## Native provider clients

FDO uses pinned official libraries directly: `openai` (Responses, legacy Chat Completions, and the OpenCode Zen and OpenRouter gateways' Chat Completions endpoints), `@anthropic-ai/sdk` (Messages), `@google/genai` (Interactions), `cloudflare` (Workers AI), and `ollama` (native HTTP chat). Codex CLI and Gemini CLI retain their existing process integrations. There is no LLM.js or Vercel AI SDK dependency. Model identifiers remain configurable; selecting a model does not imply it supports images, tools or every optional parameter. The [provider adapter README](../src/utils/ai/providers/README.md) explains where SDK versions are configured, how API versions differ, and the Cloudflare path compatibility note.

The application boundary maps native events into content, reasoning activity, tool proposals and completed results. Tool execution stays in FDO’s existing authorization path. SDK retries are disabled so they cannot multiply the application’s request budget. Stop aborts the underlying request; interrupted/truncated responses cannot pass completion checks. OpenAI/Anthropic/Gemini settings verification uses model metadata rather than a generation request. Native clients and FDO adapters run in the main process; provider keys are never made available to browser SDKs.

Tests exercise the official SDKs with simulated HTTP responses (including streaming, images, tool calls, usage, errors and cancellation). They establish protocol handling, not live provider availability or generated-plugin quality.

Cloudflare inference uses the official SDK's public `client.post` method for the [Workers AI model route](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). The installed SDK's generated `ai.run` method encodes model path separators as `%2F`; Workers AI routes model IDs as slash-separated paths such as `@cf/qwen/qwen3.8-27b`. FDO validates the account/model path and preserves those separators while retaining SDK authentication, error handling and cancellation. Regression tests inspect the raw outgoing URL, without decoding it before comparison, and the Electron fixture uses a namespaced model ID.

### Investigating an incomplete Cloudflare stream

An HTTP 200 response or usage record alone is not successful generation. FDO still requires a recognized terminal event and usable output. End-of-stream errors include event counts, answer/reasoning character counts and bounded structural descriptions of received fields. Those descriptions exclude generated text, reasoning text, arbitrary keys, tool arguments and provider identifiers. Native and `result`-wrapped stream events use the same completion checks. These diagnostics help distinguish unrecognized payloads from missing terminal events; they do not establish an upstream timeout by themselves.

For a short transport check before the full screenshot scenario, use the same explicit `FDO_TEST_AI_*` credentials and model:

```sh
FDO_TEST_AI_THINKING_MODE=off npm run test:ai:probe
```

The probe makes one small text request through the production native adapter, with a 256-token output limit, a 60-second deadline and no retries. It prints counts and errors, not the answer or reasoning. API usage may be billed. It does not load personal credentials, edit a workspace, build Electron or deploy a plugin. A successful probe verifies a small text request only, not screenshot handling or the full Workbench workload.

Cloudflare and OpenRouter coding generation and routing honor the assistant's saved thinking preference: for OpenRouter, `on`/`off` is forwarded as an explicit `reasoning: {enabled}` block on the Chat Completions request, while `auto` sends nothing and keeps the model's own default. Live tests and the short probe accept `FDO_TEST_AI_THINKING_MODE=auto|on|off`: Cloudflare and OpenRouter default to `off` so optional reasoning does not consume the entire stream before any source files arrive; other providers retain `auto`. Explicit `auto` and `on` overrides are respected. Normal app assistant preferences are unchanged. The live runner logs the selected provider, model, thinking mode and first-response deadline and includes them in `editor-live-result.json`. Existing temporary assistants are reused only when their effective settings match, and the UI explicitly selects that assistant. Cloudflare stream errors additionally report the actual requested thinking mode, including when reasoning arrived despite `enable_thinking=false`.

Reliability matrix entries also accept `thinkingMode`, which overrides `FDO_TEST_AI_THINKING_MODE`; the resolved mode is saved in the run plan and passed to the child test process. These options do not change models, extend deadlines or accept partial output. A reasoning-only stream with no terminal event always fails.

## Provider-specific behavior

OpenAI uses Responses by default, with `store: false`, reasoning summaries when reasoning is requested, native image/file content, function-call proposals and terminal status validation. Legacy Chat Completions models retain a separate path. Anthropic uses Messages, live model discovery, metadata-driven adaptive or manual thinking, supported effort validation, output-limit clamping and a cached system-prompt block. Manual thinking budgets must be at least 1,024 tokens and smaller than the output budget. Adaptive thinking requests summaries without a manual budget or sampling controls. When thinking is not explicitly enabled, provider defaults remain in effect; some models always reason. Model metadata is cached per credential/model in memory for 15 minutes, without retaining raw credentials in cache keys.

Gemini uses the official SDK's [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), with `store: false`, native steps, image/PDF parts, function-call proposals, reasoning summaries, and strict terminal-status checks. Its completed result retains native steps and thought signatures for callers that explicitly replay native history. The existing FDO chat tool-follow-up workflow still owns tool execution; this adapter does not introduce an autonomous provider-side tool loop. Gemini CLI remains a separate login/process integration.

Chat output budgets are separate from context-window capacity. Usage normalizes cache reads/writes and reasoning counts where the provider reports them. These counts are not price estimates. Optional features remain model-dependent; this is not a claim of support for every provider product (such as Realtime, Batch, fine-tuning or hosted agents).

## Usage and cost reporting

Open **Usage & cost** in the regular chat header or Coding Agent header. Chat filters by the current session; the Coding Agent shows coding activity on this device. Each actual native request is recorded, including routing, follow-ups, retries, reviews and repairs. Chat reply tooltips report the whole turn, including those supporting requests. Tokens come from provider usage, rather than estimates based on text length.

Billing calculations are separate by provider:

- OpenAI: uncached input, cached input, cache writes when reported, and output. Reasoning is already included in output and is not charged twice.
- Anthropic: input, cache reads, five-minute/one-hour cache creation and output.
- Gemini Interactions: input, cached input, output and separately reported thought tokens.
- Cloudflare: the exact model's token rates before the account's free allocation or discounts.
- Local Ollama: zero API charges, excluding hardware and electricity. CLI integrations use external account/subscription billing and show no inferred dollar total.

These are token cost estimates, not provider invoices or account balances. Separately billed tools, storage, taxes, credits, free tiers and negotiated discounts are excluded. Rate cards reference the providers' official [OpenAI](https://developers.openai.com/api/docs/pricing), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Gemini](https://ai.google.dev/gemini-api/docs/pricing), and [Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/) pricing pages. The initial catalog was checked on 2026-09-20 and expires by 2026-12-19 (earlier for specific promotions). It covers exact listed model IDs only. Input coverage limits are conservative bounds for the bundled rates, not model context limits.

Unknown models, expired prices, unsupported service tiers, incomplete usage and missing cache rates show **Unknown**, not zero. Mixed totals show a known subtotal plus the number of unresolved requests. Use **Edit rates** beside a provider/model to enter account-specific standard USD rates per million tokens; blank optional rates stay unknown when that category is used. Overrides apply only to future requests. Every priced request retains its original rate and source.

The ledger keeps the latest 5,000 requests across the app, with the latest 100 matching requests shown in details. It persists usage, status and pricing through settings, never prompts, responses or API keys. Requests left pending after an app restart become interrupted with unknown costs; reported charges from failed/truncated attempts remain included. A disk write failure is shown in the popover. This ledger is a bounded local activity record, not an all-time accounting export or reconciliation against the provider's billing API.

`tests/unit/ai-billing.test.js` checks the separate provider formulas, cache categories, unknowns, retry accounting and concurrent chat scopes. `tests/e2e/native-ai-providers.spec.js` checks the built SDK/IPC/settings path for each native provider and regular chat turn accounting, using simulated HTTP without paid requests.

## Gemini API

Choose **Gemini API (Google)** in Settings, enter a Google AI Studio API key, and select a model from live discovery. Chat and coding purposes, provider instructions, review/repair and live-test matrices use the same native client. API-key verification and the live runner preflight inspect model metadata without generating tokens. Use an Interactions-compatible model; the model catalog's generation capability alone does not guarantee all optional features, including vision.

```sh
export FDO_TEST_AI_PROVIDER=gemini
export FDO_TEST_AI_MODEL=YOUR_GEMINI_MODEL_ID
# Supply FDO_TEST_AI_API_KEY securely with a test-only Google AI Studio key.
npm run test:ai:live -- --grep "Web Tools Workbench"
```

A reliability matrix can use `{"provider":"gemini","modelEnv":"GEMINI_TEST_MODEL","apiKeyEnv":"GEMINI_TEST_KEY"}`. The same variables work in GitHub Actions. No local model, CLI login or personal credential fallback is used. Live calls consume the selected account's quota.

## Cloudflare Workers AI

Cloudflare runs inference remotely; neither your Mac nor the CI runner needs a local model or GPU. The app uses the same native Workers AI HTTP endpoint locally and in CI, without Wrangler, a deployed Worker, or a CLI subprocess. Cloudflare is supported for the **Coding Assistant** purpose, including routing, generation, review and repair. Existing workspace validation, retry bounds, cancellation, request budgets and screenshot assertions remain in force.

In **Settings → AI Assistants → Add Assistant**, choose **Cloudflare Workers AI**, enter your account ID and API token, and choose a model from the account's text-generation catalog. Use the Workers AI token template, or grant Workers AI Read and Edit permissions for that account; see [Cloudflare's REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). Provider-specific instructions are available in Coding Instructions. The account ID is persisted with the assistant in the existing encrypted settings store.

For the live test, set explicit test credentials (the runner never falls back to your personal saved assistant):

```sh
export FDO_TEST_AI_PROVIDER=cloudflare
export FDO_TEST_AI_ACCOUNT_ID=YOUR_32_CHARACTER_ACCOUNT_ID
# Set FDO_TEST_AI_API_KEY securely to your Cloudflare Workers AI API token.
export FDO_TEST_AI_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
export FDO_TEST_AI_MAX_REQUESTS=auto
npm run test:ai:live -- --grep "Web Tools Workbench"
```

Replace the account placeholder and supply the token before running. [Llama 4 Scout](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/) supports vision; its suitability for generating the complete Workbench still needs a live run. Choose another available model for other tasks. Screenshot scenarios require a model whose input schema advertises `image_url`; text-only models are rejected before generation. The npm runner checks model metadata before building, and the Coding Agent checks attached images even when launched directly from the editor. Metadata checks do not generate tokens. API access and model availability do not guarantee enough quota or a passing generated plugin.

Requests use Cloudflare’s official `cloudflare` client and native `ai.run` endpoint (`/accounts/{account_id}/ai/run/{model}`), with bearer authentication and redirects disabled. The client’s public `asResponse()` API exposes the native response body. FDO decodes both native `response` events and choice deltas, including `reasoning` and `reasoning_content`, using SSE framing across arbitrary network chunks. A native `[DONE]` or explicit successful finish reason is required, together with usable output. Bare EOF, malformed data, provider errors, token limits, filtered responses and empty answers cannot become completed workspace changes. No automatic fallback request is made. See [Cloudflare’s official client](https://github.com/cloudflare/cloudflare-typescript).

Cloudflare's default initial first-answer silence deadline is **300 seconds**, including connection setup and prompt/image processing. Confirmed reasoning or a declared buffered response can use an absolute allowance of up to **900 seconds** from dispatch. Repeated notifications cannot extend that allowance. This is FDO's local deadline, independent of your Cloudflare plan and the overall Playwright timeout. In Settings, use **First answer timeout (seconds)** to set 10–600 seconds. For a live test, set `FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS=420000` to allow seven minutes; reliability matrix entries can override it with `"firstResponseTimeoutMs":420000`. The same bounded policy applies to normal editor requests. Other hosted providers use a 240-second initial default; Ollama, OpenCode Zen, OpenRouter, Codex and Gemini CLI retain 300 seconds.

Timeout messages and waiting status distinguish whether Cloudflare HTTP headers arrived and how many parsed stream events FDO received. These diagnostics do not include prompts, generated code, reasoning text, or credentials, and they do not claim to identify a Cloudflare queue or billing issue. Reasoning events do not reset the first-answer deadline. Stop remains available throughout. A longer deadline can allow a slow model to start, but does not guarantee completion. Once the answer has begun, FDO bounds the rest of the stream separately: any parsed response event resets an idle watchdog (one third of the configured first-response timeout, at least 30 seconds), and the whole answer must finish within three times the first-response timeout. A stream that opens and then silently stalls — a half-closed upstream socket — therefore fails with an explicit stall diagnosis instead of hanging until the remote side gives up. Stall and unfinished-answer failures carry a typed `stream_stalled` code, so they enter the same single bounded transient retry as an HTTP 502: the atomic workspace step is replayed once, then the error surfaces — message keywords alone never make a failure retryable. Cloudflare's [Qwen 3.8 model schema](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/workers-ai-models/qwen3.8-27b.json) enables reasoning by default, so time to the first answer can include reasoning.

For GitHub Actions, add the account ID and token to repository/environment secrets, then set these on the existing Electron test job:

```yaml
env:
  FDO_TEST_AI_PROVIDER: cloudflare
  FDO_TEST_AI_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  FDO_TEST_AI_API_KEY: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  FDO_TEST_AI_MODEL: '@cf/meta/llama-4-scout-17b-16e-instruct'
  FDO_TEST_AI_MAX_REQUESTS: 'auto'
```

Keep the existing Electron system dependencies/display setup (for Linux, run the command under Xvfb). For a reliability matrix, use `{"provider":"cloudflare","modelEnv":"CF_TEST_MODEL","apiKeyEnv":"CF_TEST_TOKEN","accountIdEnv":"CF_TEST_ACCOUNT"}`. Account IDs are required even for a dry run; tokens stay outside the saved plan. Do not give provider secrets to untrusted pull-request workflows.

Deterministic Cloudflare coverage uses simulated HTTP responses for catalog discovery, schema checks, stream framing, truncation, cancellation and routing. `tests/e2e/cloudflare-settings.spec.js` additionally exercises real native IPC, strict schema validation and encrypted persistence across an app restart, with only remote metadata simulated. These tests require no Cloudflare credentials and do not establish live model quality or availability.

## OpenCode Zen

OpenCode Zen is an OpenCode-curated, OpenAI-compatible gateway that includes free models such as `mimo-v2.6-flash-free`. FDO reaches it at `https://opencode.ai/zen/v1/chat/completions` with the official `openai` client pinned to Chat Completions; the gateway's Responses and Messages routes are separate endpoints and are not used. Zen is supported for the **Coding Assistant** purpose, including routing, generation, review and repair. Existing workspace validation, retry bounds, cancellation, request budgets and screenshot assertions remain in force.

In **Settings → AI Assistants → Add Assistant**, choose **OpenCode Zen (free & curated models)**, paste your Zen key from [opencode.ai/auth](https://opencode.ai/auth) (keys start with `sk-`), and pick a model from the live catalog. Key and model are verified against `https://opencode.ai/zen/v1/models`, a metadata request that never generates tokens. Free-tier models cost nothing during the promotion, but Zen's privacy notice states free-period requests may be used to improve those models; do not send confidential data through the free endpoints. Usage without a saved rate shows **Unknown**, not zero: use **Edit rates** and save `0` input/output rates for free models if you want $0 estimates.

```sh
export FDO_TEST_AI_PROVIDER=opencode
export FDO_TEST_AI_MODEL=mimo-v2.6-flash-free
# Set FDO_TEST_AI_API_KEY securely to your OpenCode Zen key (sk-...).
npm run test:ai:live -- --grep "Web Tools Workbench"
```

A reliability matrix can use `{"provider":"opencode","modelEnv":"ZEN_TEST_MODEL","apiKeyEnv":"ZEN_TEST_KEY"}`. Zen's default first-answer deadline is **300 seconds**; Settings → **First answer timeout (seconds)** accepts 10–600 seconds and `FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS` overrides it for a run. Screenshot scenarios need a model that accepts image input: when the gateway publishes input modalities, text-only models are rejected before generation; otherwise the provider error surfaces on the first image request. The npm runner checks the catalog before building, and the Coding Agent repeats a metadata check (with best-effort vision metadata) immediately before generation. Metadata checks do not generate tokens. API access and model availability do not guarantee a passing generated plugin.

## OpenRouter

Streaming errors may arrive inside SSE after HTTP 200. FDO preserves OpenRouter's numeric embedded error code as the failure status when the SDK supplies none, and retains the bounded `metadata.error_type` identifier without copying raw provider metadata. Embedded 429/5xx errors can enter the existing transient recovery; account/policy failures remain excluded. A generic message such as `JSON error injected into SSE stream` without structured retryable evidence does not itself authorize a retry. Partial source never becomes a completed file. See [OpenRouter streaming errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).

If an endpoint returns HTTP 400 (or an embedded SSE error code 400 before any output or usage) with `Reasoning is mandatory for this endpoint and cannot be disabled` while FDO sent reasoning Off, FDO permits one parameter-recovery retry with the reasoning override omitted. The endpoint uses its default; FDO does not guess supported effort values. The UI reports the adjustment and the lifecycle records `mandatory-reasoning`. Saved assistant settings, model, images, tools, schema and requested output token limit are unchanged. This shares the adapter's single retry with routing recovery; repeated or unrelated 400 errors stop, and cancellation/deadlines/live request budgets still apply. Reasoning may consume output tokens within the provider's accounting rules. See [OpenRouter reasoning capabilities](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

A gateway error matching `Upstream error from <provider>: ResourceExhausted: Worker local total request limit reached (used/limit)` is treated as a worker-capacity rejection, including when HTTP status metadata is missing or 200. It uses the existing single transient retry with an 8–13 second fallback delay; longer valid Retry-After hints, cancellation, request budgets and the retry-wait ceiling still apply. Generic ResourceExhausted, account quota/billing failures, validation diagnostics and explicit non-retryable errors are not reclassified. Persistent capacity failures still stop after the bounded retry.

OpenRouter is supported for the **Coding Assistant** purpose through its Chat Completions endpoint and the pinned OpenAI client. Cloudflare and OpenRouter workspace requests use staged generation: a compact plan followed by bounded per-file requests, validated before application.

Planning, file generation and retries honor the saved thinking preference. Explicit Off sends `reasoning: {enabled: false}`; On enables reasoning; Auto leaves it to the model. If a caller supplies both reasoning controls, an explicit positive token budget takes precedence over effort. The adapter never sends both, and the reasoning budget must be smaller than the total output budget. These controls depend on upstream model support; they do not guarantee latency or a particular answer length. See [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Coding model inspection retains `supported_parameters`. Models advertising `structured_outputs` receive the requested JSON schema and `provider.require_parameters: true`; unknown or unsupported models use the existing prompt and local validation fallback. An HTTP 404 stating "No endpoints found that can handle the requested parameters" permits one routing retry before any response event. If native schema enforcement was requested, the retry removes the native schema and `require_parameters` filter, preserves the schema as explicit prompt instructions and retains local validation. Otherwise it retries the same requirements once for endpoint availability. Model, images, tools, reasoning preferences and token limits stay unchanged. The coding UI reports the retry, the live request budget counts it, and the existing deadline/cancellation still apply. Authentication, account-policy and unrelated 404 errors do not trigger this fallback. A second routing rejection stops the request. See [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection). See [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

A Chat Completions output-limit response remains a failure, including reasoning-only output. The adapter consumes the trailing usage event before reporting the failure so billed tokens can be recorded. Partial files are never accepted as successful output.

In **Settings → AI Assistants → Add Assistant**, choose **OpenRouter**, paste your key from [openrouter.ai/keys](https://openrouter.ai/keys) (keys start with `sk-or-`), and pick a model from the free catalog. The Settings dropdown lists only free, chat-capable models (ids with a `:free` suffix or explicit zero prompt/completion prices; embedding, rerank, moderation and audio-output entries are excluded). Key and model are validated against `GET https://openrouter.ai/api/v1/auth/key` plus the public `GET https://openrouter.ai/api/v1/models` catalog — two metadata requests that do not generate tokens. Account and model rate limits still apply. Usage without a saved rate shows **Unknown**, not zero: use **Edit rates** and save `0` input/output rates for free models if you want $0 estimates.

```sh
export FDO_TEST_AI_PROVIDER=openrouter
export FDO_TEST_AI_MODEL=openrouter/free
# Set FDO_TEST_AI_API_KEY securely to your OpenRouter key (sk-or-...).
npm run test:ai:live -- --grep "Web Tools Workbench"
```

A reliability matrix can use `{"provider":"openrouter","modelEnv":"OPENROUTER_TEST_MODEL","apiKeyEnv":"OPENROUTER_TEST_KEY"}`. OpenRouter's default first-answer deadline is **300 seconds**, matching Zen; `FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS` overrides it for a run. The `openrouter/free` router selects a different underlying free model per request — convenient, but non-deterministic; pin a specific `:free` model id for reproducible runs. Free models may return HTTP 429 at account or model rate limits; a 429 (as a load signal, never as a spending/quota stop) enters the existing single bounded transient retry, with a longer rate-limit backoff of roughly 8–13 seconds instead of the 2–3 second server-blip delay — still one retry, never hidden unbounded retries. Screenshot scenarios need a vision-capable model: when the catalog declares input modalities, text-only models are rejected before generation, otherwise the provider error surfaces on the first image request. The npm runner verifies the key and catalog before building, and the Coding Agent repeats the same metadata check immediately before generation. API access and model availability do not guarantee a passing generated plugin.

## Local Ollama runs

Install and start Ollama on macOS:

```sh
brew install ollama
brew services start ollama
```

Download a model with `ollama pull MODEL_TAG`, replacing `MODEL_TAG` with your chosen model tag. `ollama list` shows downloaded models. The Web Tools Workbench and other screenshot scenarios require a **vision-capable completion model**; a text-only coding model cannot process their reference images. Choose model size and quantization for available memory. A smaller model may run but still fail the same functional requirements.

Check the exact variant as well as its size: for example, Ollama's `qwen3-vl:4b` alias points to the thinking model; `qwen3-vl:4b-instruct` is a separate model. A thinking-only variant may emit reasoning even with `think: false`. The Coding Agent reports reasoning activity without exposing reasoning text, and stops after the visible-answer deadline if no answer arrives. Activity alone does not count as usable output or extend this deadline. On memory-constrained machines, try an explicit instruct variant and a small scenario before the full Workbench test; changing models does not guarantee the full scenario will pass.

```sh
export FDO_TEST_AI_PROVIDER=ollama
export FDO_TEST_AI_MODEL=MODEL_TAG
export FDO_TEST_AI_BASE_URL=http://127.0.0.1:11434
export FDO_TEST_AI_CONTEXT_LENGTH=32768
export FDO_E2E_LIVE_AI_TIMEOUT_MS=1800000
npm run test:ai:live -- --grep "Web Tools Workbench"
```

Replace `MODEL_TAG` before running. No API key is required; inherited test API keys are ignored for Ollama. Before building, the npm runner checks the server's model metadata and, for screenshot scenarios, vision support. The Coding Agent also checks image support on every image request, including direct IDE test launches. Cloud-model metadata is rejected. There is no fallback to a hosted provider. Generation uses native `/api/chat`, image attachments, and NDJSON streaming with explicit completion and truncation checks.

The endpoint defaults to `http://127.0.0.1:11434`; the context defaults to 32,768 tokens. Increasing context needs more memory. Context must accommodate the SDK guide, workspace, prompt, image, and output; a model/server may have a smaller maximum than your configured value. Local models have a five-minute first-content deadline for cold starts. The example sets the initial live-test allowance to 30 minutes; validated file progress can extend it under the adaptive timeout policy below. It does not relax assertions or guarantee completion. Request limits, repair bounds, functional checks, and screenshot artifacts remain the same as hosted runs.

For ordinary editor use, select **Settings → AI Assistants → Add Assistant → Ollama (local)**, choose a downloaded model, and set its server URL and context length. Ollama currently supports the Coding Assistant purpose. Provider instructions are available in Coding Instructions.

Reliability matrices accept a keyless entry such as:

```json
[{"provider":"ollama","modelEnv":"FDO_TEST_AI_MODEL","baseUrl":"http://127.0.0.1:11434","contextLength":32768}]
```

For GitHub Actions, use the same variables on a self-hosted runner with Ollama and the selected model available. A hosted runner does not use the Ollama instance on your Mac automatically. Keep deterministic `npm run test:ai:safety` checks on normal pull requests, and run the expensive local-model scenario on a provisioned runner manually or on a schedule. Self-hosted jobs should run trusted code only. Local inference avoids API credits but is still limited by compute, memory, and runner availability.

The application builds once, then runs each entry sequentially in a fresh Playwright process and isolated Electron profile. There are no Playwright retries to hide intermittent failures. Every entry gets its own screenshots, attachments, HTML report, and outcome report under `artifacts/live-ai/reliability/<timestamp>/<run-id>/`. A `summary.json` is updated after each run with pass rates and durations by provider/model. Failed, skipped, missing, interrupted, and incomplete runs cannot count as successes. Ordinary test failures do not prevent subsequent matrix entries from running; a process signal or launch failure stops the remaining entries.

The process exits unsuccessfully if any planned run does not pass. Keep scenario seeds and application revision constant when comparing models. A small matrix is evidence about those runs, not a guarantee of production reliability.

Both npm live runners also save `playwright-transport.log` in the run's artifact directory. This uses Playwright's `pw:browser` logging to capture websocket close codes and protocol-handler failures that page/context lifecycle events cannot explain. Protocol payloads and provider console output are excluded, and configured credential values are redacted. The log is attached to the test report when available. Direct IDE/Playwright launches bypass this runner-level capture; use the npm runner when investigating a disconnect.

The capture also retains native Chromium socket/server diagnostics, with timestamps. Protocol metadata (direction, command name, ID, numeric error code and logged character count) is now captured by default. Parameters, results and error messages are omitted. Separate bounded buffers preserve the last 50 connection lifecycle records and 150 protocol records so busy protocol traffic cannot erase connection evidence. Set `FDO_E2E_LIVE_AI_PROTOCOL_DIAGNOSTICS=0` to disable protocol logging when comparing its overhead.

For a disconnect investigation without API charges, build once and run `npm run test:ai:transport`. It runs a simulated four-minute fenced CSS stream through the real editor in a temporary Electron profile, resets the stream halfway through, then checks completion. This exercises Markdown/code rendering during generation; set `FDO_TRANSPORT_PROBE_CONTENT=text` for a plain-text comparison (default: `code`). It uses no provider credentials and does not generate or deploy a plugin. Reports go to `artifacts/transport-probe/`. `FDO_TRANSPORT_PROBE_DURATION_MS=5000..600000` controls duration. `FDO_TRANSPORT_PROBE_ARTIFACT_DIR` selects a separate output directory for independent runtime comparisons. This is an automation/streaming diagnostic, not a substitute for the live functional scenario. Run it using the same Node executable as the failing live test when comparing results.

Live scenarios and the probe share a renderer-side completion wait. Polling stays inside the page rather than sending a locator assertion over CDP twice per second during generation. A visible partial reply cannot settle the wait while Stop remains present. Completed replies and immediate errors are recognized; the scenario still validates success separately. Timeouts and closed pages remain failures. This reduces automation traffic but does not establish or repair the cause of every abnormal WebSocket disconnect. `tests/e2e/assistant-request-wait.spec.js` exercises these cases without provider calls.

Live GUI scenarios and the local transport probe acquire Electron's native `powerSaveBlocker.start("prevent-display-sleep")` assertion for the lifetime of their test app. This addresses a reproduced macOS failure: display-off transitions were followed immediately by loss of the browser WebSocket while the main-process inspector remained available, on both Node 22 and Node 24. The assertion is released during cleanup; process termination also removes the OS assertion. No system power preferences are changed, and ordinary application sessions do not acquire this test-only guard. Explicit machine sleep, lid closure, and other transport failures can still interrupt a run.

Electron test cleanup also waits for its owned process to exit. If graceful closure cannot complete after a lost automation connection, cleanup terminates that process after five seconds, before removing its temporary profile. It does not restart the app, rerun provider calls, or turn a failed scenario into a pass.

To reproduce a slow first answer, set `FDO_TRANSPORT_PROBE_WAIT_MS` to the initial period with no answer text. During this period the simulated request sends only ten-second heartbeats. Leave at least 1000ms of the total duration for streaming. For example:

```sh
FDO_TRANSPORT_PROBE_DURATION_MS=210000 FDO_TRANSPORT_PROBE_WAIT_MS=180000 npm run test:ai:transport
```

The probe uses the same long-running completion assertion and inspector lifecycle observer as the live suite. It records delivered chunk and heartbeat counts and verifies completion after a stream reset. A passing probe does not prove an intermittent live disconnect is resolved.

Keep `@playwright/test` and `playwright` on the same version and commit the lockfile; CI should install with `npm ci`. They are pinned to 1.63.0, replacing the older 1.56.1 driver used with Electron 44. Validate Electron or Playwright upgrades with the transport probe and editor smoke tests together. A websocket close code of `1006` means the automation connection closed abnormally; it alone does not establish a provider failure, renderer crash, or version incompatibility. The test must fail on lost automation rather than reconnecting and reporting an interrupted run as successful.

## Cost and execution bounds

API-backed Coding Agent requests retry a recognized temporary provider failure once after a 2–3 second delay — or once after a longer 8–13 second delay for an HTTP 429 rate limit, which needs time to clear. This is application behavior, shared by ordinary editor use and live tests. Stop cancels the delay; the partial response is cleared before restarting the same task and image. Billing, authentication, validation, ambiguous network failures, and incomplete-stream errors are not retried by this policy. If the provider remains unavailable, the request and live test still fail. The temporary-error budget is shared across the existing single output-limit recovery, allowing at most three generation attempts for an ordinary backend request rather than multiplying retries. Staged scaffolds allow one output-limit recovery per step and share the same single temporary-error retry across the whole operation. File-stage HTTP 408 errors instead go directly to the bounded response-mode recovery described below; they do not first replay the same buffered request. All attempts count against the live run's request limit.

`--repeat` accepts 1–10 (default 3), with at most 30 total runs. `FDO_TEST_AI_MAX_REQUESTS=auto` (the default when unset) starts with a 50-request ceiling and admits requests according to pending work. Each distinct workspace path accepted after source and dependency validation earns one extra request, capped at the shared 36-file workspace limit (86 calls maximum with defaults). Repeated paths, including case aliases across later transactions, earn no further capacity. Failed requests, plans and incomplete replies earn none. An explicit integer (1–50 by default) sets a fixed cap; an explicit `FDO_TEST_AI_REQUEST_CEILING` also disables progress-based growth and remains absolute. Recovery attempts count in either mode. The displayed plan includes the aggregate maximum request count. Each run retains the live suite's timeouts, one worker, zero test retries, and fail-fast behavior within that run. Use `--grep` to select a particular scenario or group. There is no fallback to personal credentials.

### Cloudflare scaffold generation

Cloudflare Coding Agent scaffold requests use a staged transaction in both the editor and live tests: a file manifest (up to 2,048 output tokens), then one complete file per request (up to 3,072 output tokens for CSS and 6,144 for other files, or the configured coding limit if lower). The initial manifest can use the existing 36-file transaction ceiling, subject to the remaining request budget; it is no longer restricted to 12 files. Composition, navigation/actions, styles and tests must be planned alongside feature modules. The 6,000-character manifest and 2,048-output-token limits still require concise contracts. Each file receives the original requirements, shared interface contracts, and already completed pending files. Other coding operations and regular chat keep their existing request flow. The orchestration is independent of the provider adapter.

This avoids requiring an entire workspace to fit in one long inference stream. Observed Cloudflare runs closed at 300 seconds while still generating answer text; this is an observed cutoff, not a documented universal service limit. A longer Playwright timeout cannot make an upstream stream continue. Each staged response still requires explicit provider completion; incomplete output is never treated as a complete file. Files remain pending until all steps succeed, after which the existing editor validation/application path receives one combined response. Stop prevents further steps. The progress popover shows the current file; all inference calls and recovery attempts are billed and counted against the existing live request limit.

Staging can increase input-token usage and total task duration because context is repeated. It does not guarantee that an individual large file will finish, and failed transactions do not persist resumable checkpoints. Test deterministically with `npx playwright test tests/e2e/staged-workspace-generation.spec.js --workers=1` after building; this uses real native SDK/IPC paths with simulated HTTP responses, including an interrupted final file.

Splitting reduces the initial response allowance. An unsplit code module allows 6,144 output tokens; first-level helpers start at 3,072 and second-level helpers at 1,536. CSS starts at 3,072, then 1,536 and 1,024. Composition files initially use at most 2,048 or the smaller allowance for their branch. Both planning and file prompts state the actual allowance, including the JSON envelope.

If a file explicitly exhausts a reduced output allowance, it can retry once with double that allowance, capped at its unsplit ceiling (3,072 for CSS, 6,144 for code). This happens before enforcing the split-depth guard: a second-level helper can still finish when the initial allowance was too small. The retry is admitted against remaining requests and the existing deadline, counts as an actual inference attempt, and regenerates one complete file; truncated text is discarded. Timeouts, ambiguous EOF, cancellation and validation errors do not enlarge the allowance. Re-splitting resets the composition allowance without renewing its larger-response retry. A repeated failure follows existing bounded splitting or stops. Complete responses and source validation remain mandatory, and no branch-depth, workspace-size, live request ceiling or timeout is raised.

Live result artifacts retain the bounded main-process coding lifecycle on ordinary provider failures as well as transport failures. Each staged request records its step/path, prompt and system character counts, image presence, structured-output flag, output ceiling, elapsed time and HTTP failure status. Successful steps include provider-reported input/output token counts when available. Renderer-side transitions are mirrored into the same buffer through a dedicated IPC channel: every request status carries its message and phase (consecutive duplicate status lines are collapsed, matching the UI's upsert), and automatic repair rounds additionally record their reason (`plan-retry-validation` includes the generated-file validation errors, `plan-retry-problems` includes the Problems-panel context). This is why a follow-up request that starts within milliseconds of the previous one is still attributable in the artifact after the editor page is torn down. All of this metadata excludes prompt/source bodies and credentials and is length/array bounded; it helps assess later failures without assuming every timeout is caused by file size. At most 500 lifecycle entries are retained to cover the 50-request live ceiling.

The planner returns a compact file inventory, with one short sentence per module (target 80–160 characters, maximum 240) and at most 6,000 characters overall. Implementation details, markup and CSS belong in the subsequent file requests. The original task and compact declarations from completed dependencies supply the detailed contracts. A truncated inventory, invalid JSON, or repairable schema error gets **one** corrective retry per planning request — the initial inventory and each module-split revision own their retry, so an early plan hiccup never disarms split recovery. Plan requests are normally bounded at 2,048 output tokens; only a retry that exists because the response was truncated escalates to 4,096, because repeating the budget that just cut the answer off cannot produce a fitting plan. That escalated retry restates the bound it must actually satisfy — the 6,000-character manifest maximum — together with changed-files-only scoping for an existing workspace, while non-limited retries (invalid JSON or schema shape) keep the original budget. Count and shape rejections state what actually arrived (the received count with sample paths, a missing or mistyped `files` property with its top-level keys, or a top-level array) so the corrective retry and the recorded failure carry a specific diagnosis instead of a generic complaint. A second failure reports a planning-specific error. Unsafe or duplicate paths, cancellation, and incomplete streams without an explicit output-limit reason are not retried as plan validation failures.

If a source file explicitly reaches its output limit, the orchestrator asks for a helper inventory. Code-module helpers must be new; CSS inventories may also reference exact completed or pending CSS paths. The host retains the oversized module path and contract, schedules it after its dependencies as a composition module, and preserves the original contracts of retained files. It validates that completed paths are not overwritten, pending paths are not dropped, and each helper inventory's **new** helpers stay within the 12-entry limit. Split responses may echo the oversized module and retained or completed dependencies alongside those helpers; the parser admits up to 12 plus the host's known entries so `validateSplit` can separate echoes from new helpers and enforce the bounds that matter (new-helper count, workspace safety limit, request budget) instead of rejecting a valid echo-padded reply on a raw total. The full transaction may grow beyond the initial inventory only through admitted helper splits. Completed files remain pending and are not regenerated. At most **two split levels per dependency branch** are allowed. Unrelated modules have independent allowances, while all branches share the single plan-validation retry, 36-file ceiling and live request budget; transient replay remains one per atomic plan or file request. The generic “retry a complete answer” recovery is bypassed for staged requests. Truncated source is discarded; only an entirely successful transaction emits completion. File-creation restrictions remain part of every prompt; if the model cannot produce an acceptable split, the request fails without applying changes. Usage includes unsuccessful attempts and replanning calls. File plans, split plans and initial individual-file requests start with native Cloudflare JSON-schema output and streaming disabled. After a file-stage HTTP 408, subsequent file requests use streamed source while plans retain structured JSON. A completed file with invalid JSON uses its existing format retry to request a buffered fenced-source response instead, as described below. The schema requires paths and short contracts: up to 36 files initially and up to 12 references per helper inventory. The adapter accepts both native response objects and chat-shaped JSON responses; chat-shaped responses still require a successful finish reason. It emits structured response text only after checking completion. Each source-file schema requires exactly the requested path and an array of physical source lines; the host joins lines with LF characters, then validates and encodes the editor file section. Heartbeats, cancellation, request budgets and usage accounting apply to both paths. A completed individual-file response that fails local JSON parsing can select the fenced-source format retry. Separately, a typed retryable file-stage HTTP 408 switches to streamed source once; schema rejection, authentication errors and incomplete streams do not authorize this fallback. Local path, duplicate, size and contract validation remains mandatory. See [Cloudflare JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

### Modular workspace generation

The shared authoring guide instructs every coding provider to use cohesive modules for multi-feature plugins: thin entry/lifecycle and rendering composition files, feature or screen modules, self-contained action handlers, styles, and focused tests. There is no minimum line count or file count; small plugins and explicit user file restrictions take precedence. Plans record imports/exports, selectors, and dependencies before source generation. Serialized iframe handlers must not capture ordinary module imports or outer variables.

The Web Tools Workbench scenario retains its entry files but permits helper modules and nested test suites, without an arbitrary final changed-file count; the host bounds each inventory and admits split helpers against remaining requests. Its repair prompts follow the owning modules instead of forcing everything into render.tsx. The rubric checks implementation across source modules and node:test coverage across test modules, while still excluding assertions from implementation evidence. Functional and screenshot checks remain unchanged. Every staged file request still counts toward the run's existing request budget.

The shared TypeScript guidance also covers feature folders, colocated types/tests, relative and type-only imports, explicit exported interfaces, runtime validation of unknown input, discriminated state unions, cancellation/resource cleanup, and behavioral tests. Existing workspace conventions and explicit user instructions take precedence; the assistant must not change package/compiler configuration just to impose a preferred layout. Build success must not be reported as proof of TypeScript type correctness.

Cloudflare's structured requests use a buffered response even though FDO exposes an event iterator to the editor. Progress therefore says that the complete answer arrives all at once, alongside the current workspace file and elapsed time. Pending HTTP headers are described as waiting for a response, not as a connection attempt: headers can arrive only after generation. The adapter reports its actual response mode, and the shared client resets transport counters for each request. No synthetic tokens or completion estimates are displayed.

During staged workspace generation, both progress views use the orchestrator's current file/stage as the heading. A provider retry on an earlier file does not relabel later files as code corrections or carry an attempt number into their headings. Transport details appear separately, while explicit repair and split stages retain their own labels. “File 2 of 12” identifies the file currently being generated, and elapsed time covers the entire operation across file transitions and retries.

The progress popover and inline AI progress display verification confidence based on observed checks: Not yet assessed, Checking, Limited evidence, Strong evidence, or Needs attention. Expand “What supports this?” to inspect the check statuses. Strong evidence requires contracts, types, build, tests and approved acceptance checks to pass; skipped or unrun groups do not count. This is not a probability, a correctness guarantee or a security audit. A new AI request resets the assessment so previous successful checks cannot certify newly generated code.

The editor's local issue classifier is a context hint, not an AI diagnosis. A generic error mention no longer displays a warning callout in the composer; request status only notes that the reported error was included. Specific SDK/runtime hints and actual request failures retain their existing presentation.


### Modular stylesheets

The shared authoring guide applies modular design to CSS, feature logic, rendering, fixtures, types and tests. Large stylesheets should be split by feature/component, with responsive, state and reduced-motion rules alongside the owning styles. A thin root stylesheet can use quoted relative imports such as `@import "./styles/layout.css";`; feature renderers may also import their own style maps. Imports precede local rules. The Workbench scenario and its repair prompts preserve this organization rather than forcing all CSS into `/styles.css`.

The native virtual compiler resolves nested workspace CSS imports and merges declarations recursively. Later imports and local declarations override conflicting properties while preserving other base/state/media properties. Shared dependencies are resolved in each branch's order. Missing imports, cycles and unsupported import forms fail compilation instead of silently omitting styles. This remains FDO's style-map format, not a general browser CSS/Sass loader: quoted relative `.css` paths are supported; URL/package imports, import qualifiers and Sass are not. Every visible style still needs registration through the DOM instance and application to markup.

The staged generator budgets CSS files separately and, after an explicit output limit, requests smaller CSS modules composed with `@import`. Each inventory is limited to 12 new helpers (echoes of host-retained entries do not consume that limit); additional helpers must fit the remaining request budget, and the transaction still permits at most two splits. Splitting reduces individual response size and enables focused repairs, but extra requests and repeated context can increase total latency and input-token cost; avoid one-file-per-rule fragmentation. The CSS runtime regression compiles, deploys and renders nested feature styles and checks declaration overrides, interactive state and reduced motion without provider calls.

When a module exceeds its output limit, the model proposes only new helpers in dependency order. The host retains the original module path and contract and schedules it after those helpers as a thin composition module; completed source and other pending files remain unchanged. A redundant original-module entry is ignored wherever it appears in a completed, valid inventory. This does not repair JSON or source code. Local validation still rejects unsafe/duplicate paths, collisions with other retained files (verbatim echoes of the printed listings — exact path and contract — are filtered as inert context, matching the oversized-module echo; altered contracts and case variants still reject), helper-free splits, excessive helper counts, and non-CSS helpers for a stylesheet. The helper schema bounds only new inventory entries; retained paths remain host-owned and do not consume helper slots. The host checks the concrete helpers plus all pending work against the remaining request budget before scheduling any helper. Explicit composition instructions list all helpers, including those from an earlier split of the same module, to avoid regenerating their implementations. Invalid splits get their own single corrective retry carrying the exact rejection (for example, a retained host path); a second invalid split fails the transaction. Output splitting, budgets and cancellation remain bounded.

### Provider timeouts during generation

Native HTTP 408 responses (including the observed Cloudflare Workers AI `3046` timeout) use a single bounded transient-recovery allowance. In staged generation that allowance belongs to each atomic plan or file request — one replay per step — so a fault replayed early in a transaction cannot consume a later step's recovery; the generic complete-answer path keeps one allowance shared across the coding request together with output-limit recovery, so its combined recovery paths cannot multiply attempts. SDK retries remain disabled to avoid uncounted or multiplied attempts. In staged generation, only the failed plan/file request is retried after a short backoff; completed files remain pending and unchanged. Cancellation, request-budget admission and the run deadline are checked before another provider attempt. After transient recovery is exhausted, a file-stage HTTP 408 can use the shared module-split allowance described below; planning timeouts and other unhandled failures end the transaction without applying incomplete files. The first-answer timeout is not extended by this change. Local timeout text alone is not enough to trigger recovery; explicit aborts, Workers AI aborted code `3008`, billing errors and `x-should-retry: false` are not retried. Failed attempts remain in usage accounting. See the [native Cloudflare SDK retry policy](https://github.com/cloudflare/cloudflare-typescript#retries) and [Workers AI error definitions](https://developers.cloudflare.com/workers-ai/platform/errors/).

### Request budgets for staged generation

The standard command `npm run test:ai:live -- --grep "Web Tools Workbench"` automatically selects adaptive budgeting, even if an old `FDO_TEST_AI_MAX_REQUESTS` value remains exported. It logs when it replaces that inherited value, without changing your shell. To choose a fixed cap for the npm command, add `--max-requests 20` (any integer from 1 to the configured ceiling). Direct Playwright/IDE launches and the reliability runner continue to honor `FDO_TEST_AI_MAX_REQUESTS`; unset or `auto` selects adaptive mode there. Before a plan, file group, retry or module split starts, admission expands only to cover used requests plus the concrete pending work. Checks do not spend requests; actual provider attempts do. Explicit fixed caps are never raised automatically.

Adaptive admission is bounded by the absolute request ceiling (50 by default), a progress-based run deadline anchored to the first admitted request, and the existing per-transaction retry/split limits. Set `FDO_TEST_AI_REQUEST_CEILING` to a positive integer to raise or lower that ceiling for an environment; it bounds `--max-requests`, `FDO_TEST_AI_MAX_REQUESTS`, the reliability planner's per-run limit, and the adaptive allowance together, and invalid values fail before any provider request. Playwright still owns the overall scenario timeout and teardown. Admission does not guarantee quality or estimate dollar cost. Request admission alone cannot extend the deadline or turn repeated failures into unlimited retries. Normal application usage remains outside this live-test budget. Console configuration identifies adaptive/fixed mode; `editor-live-result.json` records used requests, admitted allowance, ceiling and deadline.

Acceptance stages that converge over several rounds (the Web Tools Workbench stylesheet and markup repairs) use `FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS`, a positive integer defaulting to 3. Each attempt is a real provider request, so raising it also requires ceiling and deadline headroom; the loops still stop as soon as their checks pass.

A staged workspace uses one planning request plus one request per file. A 12-file plan therefore needs at least 13 requests. Planning retries, transient failures, module splits, routing and later validation repairs consume additional requests. Before generating source, retrying a step or splitting a module, the agent checks that the remaining cap can cover the minimum pending work. If it cannot, the request fails early with used, remaining and required counts; pending files are not applied. A passing budget check does not guarantee completion if later recovery needs more requests. Normal application usage is not subject to this live-test cap.

Completed provider responses must describe exactly one complete file for the requested path. The staged protocol requests JSON `{path, lines}` under a native response schema, removing the model-authored Markdown heading/fence requirement. Each array item is one physical source line; blank lines and indentation are preserved. The host joins items with LF characters rather than asking the model to encode a whole module in a single multiline JSON string. This addresses recorded flattened responses where a `//` comment swallowed declarations and instantiation. Line arrays are limited to 2,000 entries and the existing 48,000-character assembled-source limit; non-string entries and embedded CR/LF characters are rejected. Literal backslashes in source remain unchanged. The path is constrained to the planned file; the host checks the decoded path, exact object shape, non-empty source and size before producing the editor file section. Invalid JSON is never repaired heuristically by the host. Completed legacy `{path, content}` objects and strict Markdown file sections remain accepted for compatibility and receive the same source checks. The host never guesses missing newlines, removes comments or salvages truncated source. Embedded triple-backtick delimiters remain unsupported by the editor file-section parser and are rejected before serialization. Wrong paths, empty or oversized source, extra properties/files and malformed responses produce specific validation reasons. The staged generator normally repairs the response format once per planned path, respecting the remaining request budget and deadline. A malformed completed non-JSON reply interrupting source repair can receive one additional final envelope attempt, as described below. If a completed response contains malformed JSON, an invalid line array, or a valid JSON object with the wrong file-envelope fields/types, this existing retry changes to exactly one closed fenced source block. Envelope diagnostics list bounded field names and types; the host never extracts or accepts source from that rejected object. If a source rejection preceded the envelope failure, its diagnostics remain in the source-format retry. The host supplies the already approved file path; the model no longer JSON-escapes each source line. This is an explicit request format change, not local JSON repair or extraction of partial code. Once a source-block recovery passes both format and source validation, remaining files and any newly split helpers in this transaction use buffered source blocks directly. This avoids paying for the same failed JSON encoding again on every file. Plan and split inventories keep their schemas. A new transaction starts with schema output again; failed or unvalidated recovery never changes the preference. That path retains the source-block format for any subsequent source repair or output recovery. The Cloudflare adapter sends this recovery with `stream: false` and no `response_format`, requires a successful finish reason for chat-shaped replies, and exposes source only after provider completion checks. Missing/extra fences, prose, empty/oversized content and mismatching explicit paths remain errors. Source syntax and entry lifecycle checks still run before accepting the file. The output ceiling and deadline remain unchanged. Decoded source has a separate one-time repair allowance; correcting an envelope does not consume the source repair. Neither allowance renews after splitting or output-limit recovery. Previously validated dependencies are retained; rejected source is never appended or applied. A transport failure or missing provider completion event does not qualify for this format recovery. Compilation and runtime checks remain separate requirements after file assembly.


### Structured output across native providers

The shared `AiProviderClient.chat(prompt, {responseSchema})` option is supported by all five native provider adapters. It can be supplied per request or as a client default. A per-request schema does not persist into later chat turns.

| Provider route | Native schema parameter |
| --- | --- |
| OpenAI Responses | `text.format = {type: "json_schema", name: "response", strict: true, schema}` |
| OpenAI Chat Completions (explicit/legacy route) | `response_format = {type: "json_schema", json_schema: {name: "response", strict: true, schema}}` |
| Anthropic Messages | `output_config.format = {type: "json_schema", schema}`; existing reasoning effort is preserved |
| Gemini Interactions | `response_format = {type: "text", mime_type: "application/json", schema}` |
| Ollama Chat | `format = schema` |
| Cloudflare Workers AI | `response_format = {type: "json_schema", json_schema: schema}`; non-streaming HTTP for JSON mode |

Adapters pass the supplied schema without rewriting or dropping constraints. Callers must provide the model's supported JSON Schema subset and validate the completed output locally, as the workspace planner does. Provider support does not mean every model supports structured output. Unsupported models or schemas surface the provider error; there is no downgrade to JSON-only or unconstrained generation. Streaming providers retain their completion checks: a valid-looking JSON fragment does not establish successful completion. Schema support does not change the policy selecting which tasks use staged workspace generation.

The native SDK regression matrix covers streaming and non-streaming requests, schema isolation between turns, usage, truncation, cancellation, provider rejection without retries, and Anthropic effort preservation. Sources: [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini](https://ai.google.dev/gemini-api/docs/structured-output), [Ollama](https://docs.ollama.com/capabilities/structured-outputs), [Cloudflare](https://developers.cloudflare.com/workers-ai/features/json-mode/).

Problems-panel corrections use focused workspace execution mode and include the complete previously applied response instead of a 5,000-character prefix. The latest generated source supersedes stale initial context. Repair prompts request only changed files and directly affected dependencies while preserving other files; budget checks still reject any plan that cannot fit.

Execution-mode and repair prompts describe the final deliverable as complete `### File:` sections, which is the correct contract for providers that answer a single bulk response. Staged providers never do: the staged transport starts with a compact JSON file inventory and then requests one file's source per request. Each staged request therefore states that its own format supersedes any file-sections demand embedded in the task text (the plan header states this for the inventory; the one-file prompt states it for the path/lines schema or source fence), and the staged plan wrapper for execution-mode prompts replaces the file-sections template with host-driven format rules. Without these supersessions the model follows the embedded sections demand, writes file contents where only the ≤6,000-character inventory is admitted, and exhausts the plan's output ceiling on both the first attempt and its single corrective retry.

Plan IPC requests now carry the current virtual workspace snapshot. Problems-panel repair prompts use that snapshot, including unchanged files, instead of replaying stale pre-generation context; the original task is labeled as reference requirements. File-plan instructions explicitly distinguish the plugin bootstrap from the rendering composition and include requested styles/tests for new scaffolds. Per-file bootstrap instructions apply only to the root entry.

Staged files validate static local imports before acceptance. The validator follows the virtual builder's extension and directory resolution, permits pending planned dependencies, rejects self-imports and missing paths, and checks known exports. `.js` specifiers can resolve to TypeScript workspace sources. Diagnostics include valid targets and known export owners; they do not rewrite ambiguous source automatically.

Completed dependencies are retained during bounded repairs. The last source rejection is tracked per file, independently of the active prompt. If a source repair overflows and splits into helpers, accepting those helpers does not erase the parent’s rejection history. When the parent resumes, changed or repeated defects follow the same bounded repair policy as uninterrupted generation; its repair counters, request budget and deadline do not reset. Pending modules receive the names already imported by completed modules. Source is parsed without execution; TypeScript/JavaScript, CSS and JSON use their respective parsers, and plugin entry points are checked for an executable SDK subclass and instantiation. Parser diagnostics may include bounded source excerpts, so E2E artifacts should be treated as development data rather than public portfolio material.

Split leaf files start with a smaller output allowance. When a length-limited leaf succeeds with its bounded larger retry and passes file/source/import validation, remaining leaves in that transaction can start with that proven allowance. CSS and source files have separate records, as do JSON and fenced responses. The allowance never exceeds the original unsplit per-file ceiling; composition modules keep their smaller starting limit. A failed, truncated or unvalidated response cannot teach it, and a new transaction starts fresh. This avoids spending a failed small attempt on every sibling while retaining all request-count, deadline, file-count, branch-depth and repair limits. The allowance is an output ceiling, not a token-usage or cost estimate.

When an expanded file is subsequently split, the retained parent keeps its already-authorized per-path output allowance along with its spent expansion flag. Its split prompt and resumed generation use the same ceiling. Splitting therefore cannot shrink the parent's allowance while leaving its larger retry unavailable. New helpers still start with their own focused limits; a parent's failed expansion does not teach them a larger allowance. This applies to CSS and source modules, grants no extra retry, and never exceeds the existing unsplit file ceiling. The parent must still return complete, valid source, including required imports and any remaining local rules.

Format, source, import, output-limit and transport failures have separate bounded recovery paths. Every actual request still passes the request-budget and deadline checks. A successful HTTP response, syntax parse, or unit test alone does not prove that the generated plugin compiles or satisfies the Workbench behavior rubric. The live scenario retains compilation, node:test, runtime interaction and screenshot checks.

When an import-only rejection combines missing exports required by completed consumers with a matching type import in the pending module, the shared generator can request a focused interface header. It supplies dependency declarations and consumer source so the model can check the required shapes. The host replaces the original imports, retains the remaining implementation byte-for-byte, and accepts only imports, interfaces, type aliases and explicit named exports in the header. It does not infer type aliases from similar names. The assembled module passes the existing source and import checks before acceptance; those checks do not replace TypeScript semantic checking or runtime validation. This recovery uses the existing repair, request and deadline allowances across providers. Malformed or truncated headers cannot replace the retained implementation, trigger module splitting or become accepted source.

When the sole planned stylesheet returns syntactically valid CSS importing absent relative CSS files, the failure can reveal an incomplete inventory. The generator requests a bounded stylesheet dependency plan instead of repeatedly asking the same source-only question. Import references are diagnostics, not approved file paths: every proposed helper must pass the normal path, contract, duplicate, workspace-size and request-budget checks before generation. Helpers are generated first, then the original stylesheet is regenerated and validated against the expanded plan. Existing files and the pending tail remain intact. A malformed stylesheet, incomplete provider response, or ordinary path mismatch when other CSS targets exist keeps its existing recovery path. No missing import is deleted, no empty stylesheet is fabricated, and no validation is bypassed.

Module splitting keeps completed files and host-owned contracts intact. Split responses may echo exact paths from the existing workspace, completed files, pending files or the oversized module. Those entries are discarded before contract and duplicate validation, regardless of paraphrased or malformed annotations; the host keeps its original contracts, image flags, source and schedule. Exact reusable CSS dependencies are the exception: they remain references to host-owned entries. Case-only collisions still fail, every raw path is checked for safety before filtering, and conflicting new helpers still require correction. An all-echo source split cannot claim progress. Filtering does not enlarge request, response-size, file-count or branch-depth limits. Exact references to retained CSS may be reused; ambiguous or invented helper paths are rejected. CSS import correction uses approved split helpers or unique filenames from the approved file plan, as described above; it never creates a dependency outside that plan.

CSS split prompts advertise only dependencies that cannot reach the module being split. The same graph drives validation and combines host-scheduled compositions with imports in existing and completed CSS. Ancestors appear only as forbidden dependencies, never in the reusable list. An unsafe proposal is rejected in full even if it also contains valid new helpers.

If a CSS, JavaScript or TypeScript split proposes no usable dependencies (or a CSS split references a composition ancestor), and space remains for new files, its existing single corrective retry asks for named responsibilities instead of another full workspace inventory. The response contains short helper labels and contracts; the host assigns unused sibling paths derived from the original module and those labels, preserving its language extension, including collision suffixes where needed. Labels cannot contain paths, extensions or duplicates. The resulting manifest goes through the same path, contract, size, file-count and request-budget admission as other split plans. Helpers must still be generated and validated before the original module can compose them. Source helper contracts specify exports and signatures; the retained composition must preserve the public names imported by completed consumers. Data files such as JSON do not use module-decomposition recovery. This does not salvage incomplete source, fabricate implementations, overwrite existing stylesheets or add retry allowance. The focused prompt retains the original requirements but omits unrelated completed source and the initial scaffold inventory instructions.

File inventories collapse identical repeated entries (same exact path, contract
and image-relevance flag) into one scheduled file, preserving first-occurrence
order. Conflicting contracts, image flags or case-only path variants require a
fresh inventory under the existing single plan retry; the host never chooses
one conflicting definition. Every raw path is checked before that retry can
start. Invalid paths identify their array index, bounded path and rejection
reason, and stop immediately. Reserved directories are checked without regard
to case. Response-size and raw entry-count limits still apply before deduplication.
CSS split inventories admit only CSS references after checking every raw path
for safety. Unrelated source/test proposals, including conflicting duplicates,
cannot change the original workspace plan or consume a CSS helper slot. An empty
CSS proposal or conflicting CSS contracts still require the existing bounded
plan retry. This restriction applies only to stylesheet splits, not initial
workspace planning or TypeScript module splitting.

Progress retains the overall operation timer across provider calls, with a separate stage timer. Retries identify the active file; elapsed time is not a completion estimate. The live-test timeout is distinguished from an unexpected transport closure during teardown.

### September 24 review regression coverage

The saved OpenRouter run failed on its first request with HTTP 400 because both `reasoning.effort` and `reasoning.max_tokens` were sent. Its previous wire test asserted that invalid combination. The provider tests now assert mutual exclusion, explicit Off, schema capability selection and usage retention on truncation. `tests/e2e/openrouter-workspace-policy.spec.js` exercises planning and multiple files through the built Electron app with HTTP fixtures for Off, On and Auto. These are deterministic integration checks, not evidence that the paid or free live Workbench scenario passes.

The live budget snapshot reports its starting ceiling, current earned ceiling, maximum ceiling and validated-file count. Credits represent staged validation progress, not compilation success or changes already applied. Request checks do not themselves earn credits or charge calls. The run deadline and per-file repair limits never reset when capacity grows, and live reliability summaries include the full possible request maximum. Normal application requests are unaffected by this E2E-only accounting.


Syntax-only file repairs use a focused context: the rejected module, parser diagnostics, its assigned contract, required inbound exports, and import-preservation rules. They omit the original scaffold request, unrelated dependency implementations and the visual reference. Import and mixed validation failures retain dependency context. The model still returns a complete file through the existing JSON or fenced-source format; full source, import and entry validation runs again before acceptance. TypeScript diagnostics distinguish a function-valued property's `(...) => void` type from a method's `(...): void` annotation when the parser reports that exact mismatch. No syntax is rewritten automatically and no additional repair allowance is granted. Controlled native OpenRouter and Cloudflare regressions cover both response formats in `tests/e2e/workspace-syntax-repair.spec.js`.

Automatic Problems-panel repairs pass diagnostic-owner paths separately from the model prompt. The host validates those paths against the current workspace, skips file planning, and generates only complete replacements for those existing files. Unchanged consumers retain their required imports/exports; unrelated implementations and the workspace-wide response are not copied into the repair prompt. The current target source and its direct dependency declarations remain available. The scope applies to every provider, including providers whose ordinary generation does not use staged requests. An oversized targeted repair cannot split or regenerate unrelated modules. Normal source validation, bounded repair attempts, request accounting, cancellation and deadlines still apply. The regression reproduces the recorded 66/82 budget and verifies that one-file repair finishes at 67/82 without increasing the ceiling. Native-provider coverage is in `tests/e2e/workspace-targeted-repair.spec.js`.

The September 25 recorded workspace also exposed a parser/build mismatch: Babel's TypeScript parser accepted an imported `renderOnLoad` alongside a local function of the same name, but the build transform rejected the duplicate binding. Replaying the saved generation and its Problems-panel correction reproduced that compiler failure. Shared source validation now rejects imported runtime bindings that collide with top-level function, variable, class or enum declarations, with both declaration locations and alias/re-export guidance. Type-only imports, type declarations, re-exports and nested scopes remain separate. The existing bounded syntax-repair flow fixes the owning file before accepting it; import preservation allows the reported local alias to change without inventing dependencies. No request ceiling or retry allowance was increased. The reduced fixture is `tests/fixtures/ai/workspace-import-binding-repair.cjs`, covered through both Cloudflare and OpenRouter in JSON and fenced-source modes. This replay and controlled-provider coverage do not establish that an unrestricted live Workbench generation passes.

A later recorded run repeatedly declared a real `renderDashboard` implementation and an exported function of the same name whose only statement was `return renderDashboard(options)`. Complete-file repairs retained that duplicate wrapper. `generatedModuleExports.js` now handles this narrow pattern structurally before validation: exactly two top-level function declarations, exactly one exported self-forwarder, matching signatures, and unchanged identifier arguments. It removes that wrapper and exports the single retained implementation without rewriting its body. Competing implementations, changed arguments, side effects, defaults/rest/destructuring, asynchronous/generator wrappers, different signatures, and unresolved parser errors are left for normal validation. The candidate must parse cleanly and still pass normal file/import validation. This normalization is shared by staged generation and the editor apply path across providers, is reported in progress, and spends no additional request or repair allowance. The reduced regression fixture is `workspace-self-forwarder.cjs`; it is not a capture of the full rejected file, which the live artifact did not retain.

Missing exports required by completed consumers now receive a focused export-repair prompt in the shared generator. The recorded `/ui/compose.ts` failure returned plugin metadata and a class while `/render.tsx` required `renderDashboard`; the old repair still carried the original scaffold request and generic instructions to substitute existing export names. The focused prompt instead supplies the current module contract, required names, immutable consumer source, relevant dependency declarations and rejected source. It omits the original scaffold request, unrelated implementations and image, and distinguishes implementing an inbound requirement from correcting an outgoing import. The existing type-import header repair retains priority where applicable. No completed consumer is rewritten, no function implementation is guessed by the host, and no request or repair ceiling is increased. Syntax and import validation still run on every reply. Reduced JSON and fenced-source regressions cover success and bounded failure; controlled native Cloudflare/OpenRouter tests verify transport and IPC integration. These tests do not establish that a live model will supply a correct implementation or that the full live Workbench scenario passes.

HTTP rate limits remain external failures, independent of FDO's live request budget. The recorded September 28 run received two HTTP 429 responses during planning, about 13 seconds apart, before any file validation. Shared error normalization now retains a numeric `retryAfterMs` from `Retry-After` (seconds or HTTP-date), including when a native SDK discards response headers. Raw headers and provider bodies remain excluded. The existing single transient retry waits at least that long, with cancellation checks; the workspace status reports the delay. `MAX_PROVIDER_RETRY_WAIT_MS` in `codingRequestPolicy.cjs` bounds automatic waiting at two minutes. A larger server hint stops without another request, rather than retrying before the indicated reset. Existing fallback delays apply when no valid hint is supplied. Retries still consume the same request allowance and never reset the scenario deadline. HTTP 429 messages identify rate limiting and any supplied wait, without claiming whether an account limit or upstream capacity caused it. Controlled Electron coverage is in `workspace-rate-limit-recovery.spec.js`; provider availability and a live Workbench pass are not established by those fixtures.

### Adaptive live scenario timeouts

Live scenarios default to `FDO_E2E_LIVE_AI_TIMEOUT_MODE=adaptive`. `FDO_E2E_LIVE_AI_TIMEOUT_MS` is the initial allowance (with the existing ten-minute scenario minimum). Each distinct host-validated workspace file earns two additional minutes, up to 36 files and an overall ceiling of two hours. `FDO_E2E_LIVE_AI_MAX_TIMEOUT_MS` overrides that ceiling and must be at least the initial allowance; an initial allowance above two hours remains supported. Set `FDO_E2E_LIVE_AI_TIMEOUT_MODE=fixed` to keep the initial allowance as a hard limit. Request-count caps remain independent.

The backend deadline, Playwright test timeout, and assistant UI wait use the same earned extension. The runner refreshes progress every five seconds while waiting and logs each extension. Deadlines remain anchored to the run start across repair transactions. Repeated files, case aliases, rejected source, retries and partial output earn no time; expired runs cannot be revived by late validation. Provider first-answer and stream-stall watchdogs remain active. The result artifact includes the timeout policy, earned milliseconds and deadline. Deterministic unit and Electron tests verify extension, fixed mode, exhaustion, and the real Playwright timer; these checks do not establish a live provider pass.

### Workbench acceptance repair convergence

The saved 37-minute Workbench run reached acceptance with a CSS import cycle and failing node tests, in addition to source-rubric failures. Five category-card roles were false negatives: templates mapped an imported metadata array into `data-role="${meta.dataRole}"`. The rubric now follows literal arrays through relative imports and mapped property interpolation without executing generated code. Test files, comments, unused metadata and unmatched property names do not supply that evidence. The saved fixture is `tests/fixtures/ai/workbench-acceptance-repair.json`; an Electron regression executes its dashboard renderer to confirm the five controls actually exist.

Workbench repairs now run as bounded convergence rounds (`FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS`, default three). Every round rebuilds the current workspace, executes its tests and reevaluates source acceptance, SDK compatibility and editor diagnostics. A combined repair prompt reports concurrent failures and permits corrections in the implementation modules responsible for failed tests; it forbids weakening assertions or deleting test coverage. CSS-only failures retain focused stylesheet repair. A passing result requires successful, non-skipped tests; failures are no longer warnings. Each completed round is saved in `web-tools-workbench-repair-history.json`, including the latest workspace, so subsequent timeouts retain diagnostic evidence. The final failure message includes build and test failures alongside the rubric.

The recorded source still requires implementation repairs: recognizing dynamic category controls does not repair its CSS cycle, missing SDK HTML finalization or failing test contracts. Unit regressions and the local Electron replay verify diagnostics and repair orchestration, not live-provider convergence or deployment success.

The following 20-minute run compiled and passed the rubric but still reported eight node:test failures. Its 73 KB reporter output placed a large HTML dump before the later assertion details. Repair prompts and final console failures now summarize each failed test separately within the existing 12 KB budget, preserving expected/actual evidence and mapping compiled test paths to unique workspace source paths. Complete logs remain in the saved artifacts.

Workbench repair submission also records the terminal-response count before pressing Submit. The UI wait requires a newer response and the end of the running state; an old answer visible before the new request starts cannot complete that repair round. A local Electron regression covers delayed start, disappearance of Stop before a new terminal response, and completion too fast to observe Stop. This repairs orchestration and diagnostic delivery; the generated plugin still must pass its actual tests and deployed interaction checks.

The subsequent recorded repair retained three TypeScript errors in `/render.tsx`: an unbound SDK `DOM` constructor and arguments passed to two zero-parameter renderers. Syntax-only compilation accepted those defects. Shared structural validation now checks these cases during staged generation and before editor application. It follows lexical bindings and explicit relative export aliases without evaluating generated code. Explicit function types, overloads, optional/rest parameters and JavaScript's permissive argument counts are left to their normal validators. A rejected correction reuses the existing bounded source-repair allowance; unchanged invalid source cannot be accepted as repaired. Diagnostics distinguish a writable caller from an immutable caller whose generated dependency must honor its interface. This is a targeted check, not a full TypeScript checker. The recorded sources are preserved in `tests/fixtures/ai/workbench-render-call-errors.json`, with native success and repeated-rejection coverage in `tests/e2e/workspace-render-call-repair.spec.js`.

A later run invented `globalThis.DOM` with a handwritten `createClassFromStyle(style: string)` signature. Its seven CSS-map calls consequently failed TypeScript validation, and the constructor did not exist at runtime. `workspaceSdkDomRepair.js` repairs this specific SDK construction pattern before normal validation: an unshadowed `globalThis.DOM`, no constructor arguments, and a constant local instance used for both `createClassFromStyle` and `renderHTML`. It replaces the constructor expression and attached type assertion with a collision-free SDK value import, preserving style arguments, helper calls and return values. Custom global assignments, shadowed globals, unrelated APIs and already imported constructors are retained. Syntax/binding failures remain owned by ordinary source validation. Both staged generation and editor application use this correction, report it in progress, and spend no additional request. The authoring guide now explicitly distinguishes style-map objects from returned class-name strings. This fixes the observed SDK misuse; it is not a general TypeScript type checker.

Required renderer options are validated in the shared workspace pipeline, independently of provider or model. `generatedWorkspaceOptions.js` follows named local imports/re-exports, interfaces, inherited fields, type aliases and intersections to check statically known object arguments. It catches the recorded CSS-map-as-options call and missing inherited category/title fields before editor application, feeding exact missing fields into the existing bounded repair path. It does not synthesize option values or suppress diagnostics. Overloads, generic/union contracts and uncertain dynamic arguments remain owned by TypeScript; this structural check is not a complete type checker. Staged requests use it during file validation; all providers, including CLI-backed assistants, use it during common candidate validation. Cloudflare's transport adapter is unchanged. Controlled native regressions in `workspace-options-repair.spec.js` cover OpenAI, Anthropic, Gemini, Ollama, Cloudflare, OpenCode and OpenRouter; editor regressions cover the common Codex CLI and Gemini CLI paths. These tests establish repair routing and validation, not live model reliability.

Malformed planning JSON receives one corrective request containing the bounded rejected response as a JSON-quoted data string, parser character/line/column when available, and explicit serialization guidance. The original task and inventory constraints remain in that request. Complete single JSON fences (labelled or unlabelled) are decoded; malformed JSON is never patched or partially admitted locally. Oversized responses and interrupted streams retain their separate recovery policies.

When SDK fingerprint/acceptance checks require a new or migrated guide, the host inserts a missing `/SKILL.md` inventory entry before file-count admission. Its slot counts toward the initial ceiling and remaining request budget, including consolidation. An existing guide entry is not duplicated. The guide is generated first and still requires validation and review before implementation. This does not add files to targeted diagnostic repair scopes or generate a guide when host review is not required.

Initial workspace inventories reserve 12 of the 36 file slots for subsequent split recovery. Both the provider schema and host admission limit initial plans to 24 files; an oversized inventory gets the existing single planning correction before any file generation starts. If that correction still has 25–36 files and is otherwise valid, one final consolidation request groups original paths into at most 24 destinations. The host rejects unknown, duplicate or missing members, mixed code/style/test/guide groups and a moved `/index.ts` bootstrap. Original contracts and the old-to-new path map accompany file generation, so shortening a combined contract does not discard its assigned responsibilities. The grouping preserves visual-reference requirements. Invalid consolidation stops before generating files; it cannot renew itself or raise the file ceiling. Request budgets and cancellation apply to this extra attempt. Group coverage is checked mechanically; whether the implementation fulfills those responsibilities still requires normal validation and tests. This avoids accepting a full 36-file plan that cannot recover from even its first oversized module. Split recovery can still reach the 36-file transaction ceiling, and request budgets, cancellation, and atomic application remain unchanged. Targeted repairs bypass inventory planning and retain their existing scope. This reserve prevents the recorded admission failure; it does not guarantee that all later splits or live generations will succeed.

Editor validation repairs retain the unapplied candidate workspace. When every diagnostic names a generated file, only those owners are sent as repair targets; the backend receives the merged candidate as context and skips replanning. The editor rejects missing, duplicate, or out-of-scope replacements, merges valid repairs with retained generated files, then reruns validation and detached compilation before applying anything. The existing single validation retry remains bounded. Failed repair requests now report their own error instead of hiding it behind the original validation rejection. Diagnostics without identifiable generated owners retain the existing general repair fallback.

Targeted staged repairs also evaluate complete-workspace plugin validation with the proposed owner replacement overlaid on retained candidate files. Workspace diagnostics attributed to that owner enter the existing bounded source-repair loop before the file earns validated progress. Other owners remain outside the repair scope. This catches ignored cross-file foundation fixes while allowing leaf inputs to rely on wrappers in retained modules. The shared authoring guide explicitly describes the injected Pure CSS classes required by validation.

The realistic Workbench scenario seeds its starter workspace after assistant provisioning, since provisioning may remount the editor and discard transient seeded files. It asserts the starter test was initialized before submitting. Initial staged plan admission also recognizes direct affirmative requests to add/write/include/create/implement/generate tests (including common test qualifiers) and requires a test/spec module in the inventory, using the existing bounded planning correction if absent. This is a narrow omission check, not a general natural-language completeness evaluator or proof of useful test coverage; live acceptance still requires changed tests that execute successfully. Targeted repairs bypass this initial inventory check.

Native API adapters mark premature stream EOF without a successful completion signal as `stream_incomplete`. The shared transient policy permits the existing single atomic-step replay under normal cancellation, deadline and request-budget checks. Partial content is still rejected; a second interrupted attempt fails. Explicit finish failures such as content filtering and output-token exhaustion retain their separate handling. OpenAI-compatible providers inherit this behavior through the shared OpenAI adapter.

Editor cross-file validation receives retained workspace sources as well as returned replacements. Form foundation, backend form bindings, and message-handler checks evaluate that merged candidate, with replacements overriding stale versions at the same path. Per-file syntax and forbidden-source checks still apply to returned files. This prevents partial Problems repairs from falsely losing foundation classes supplied by unchanged feature modules, without allowing a replacement to borrow classes from its own obsolete content.

Candidate validation now runs generated and retained Node tests after the detached
workspace compiles, before applying files. Failing tests have one dedicated repair pass, separate from the single source
validation repair pass. A source fix cannot consume the first opportunity to fix
newly observed test failures. Both allowances persist through recursive repairs;
the corrected candidate must compile and pass tests again.
Test runs that fail, skip existing tests, or return no result cannot authorize an
apply. Cancellation and concurrent edits are checked again after the test run.

Compiled test locations are mapped to unique virtual workspace paths. Repair scope
includes failing tests and their direct runtime source imports, allowing setup and
implementation fixes together while retaining unrelated files. Unknown locations
stop automatic repair. Diagnostics retain early startup errors (such as a missing
Electron messaging bridge) alongside individual assertion failures. Tests must
preserve meaningful assertions; a Node test importing a plugin entry must establish
its lifecycle fixture before that import executes.

A length-limited split leaf now uses its normal complete-file allowance on its
single expansion retry: 3,072 tokens for CSS and 6,144 for source. Previously a
depth-two CSS leaf retried from 1,024 to only 2,048 tokens, then exhausted the split
limit without trying the normal CSS allowance. The request count, branch-depth
limit, character cap, cancellation checks and transaction budget are unchanged.
The larger allowance is a ceiling, not a guarantee that arbitrary source fits.

Test diagnostic excerpts allocate space across all failures in each file, keeping
late cases visible. Assertion errors are no longer copied into unrelated files;
early startup errors remain available when a test module fails during loading.

When no workspace slots remain, CSS split planning becomes reuse-only. Its
provider schema enumerates existing non-circular CSS dependency paths, and its
prompt asks for dependency selection instead of new helper files. Local checks
still reject invented paths and cycles even if a provider ignores the schema.
Completed dependencies stay immutable, pending dependencies run once, and the
36-file ceiling and single corrective planning retry remain unchanged.

Scoped diagnostic repairs receive full source for direct dependencies and direct
consumers, including pending implementation files and executable test assertions.
Completed repairs override their original versions in this context. Declaration
compaction remains useful for generation, but cannot supply the literal IDs,
return values, markup or assertions needed to reconcile a failing test. This
reference context does not expand writable scope or grant additional retries.

SDK DOM normalization replaces literal null attributes with an empty object only
for statically identified instances of the SDK's imported DOM constructor. This
preserves element content and prevents createAttributes/Object.entries crashes.
Generated-source validation also flags lastIndex assignments on known regexes
without global or sticky flags, preventing repeated-first-match scanning loops.

The plugin test runner enables source maps. Failure diagnostics retain mapped
workspace stack frames and include actual implementation stack owners in repair
scope, even when they are transitive dependencies of the failing test. External
SDK and Node frames do not grant workspace edit scope.

CSS composition requests now receive the selected stylesheets' complete source,
the retained contract and original user constraints instead of unrelated completed
source declarations. The screenshot is omitted at this step: the dependencies
already implement the design, and composition must import rather than redraw it.
Reuse-only composition preserves the file's current output allowance, avoiding a
3,072-to-1,024-token downgrade after selecting existing dependencies. Retry and
file-count limits remain unchanged; unique residual styles are still required.

At the 36-file ceiling, an overflowing source module gets one focused completion
attempt within its existing path and output ceiling. It receives existing source
interfaces and its contract, without the screenshot or unrelated CSS context, and
must delegate to existing implementations. This does not authorize extra files,
replanning, stubs or partial source. Request-budget and cancellation checks run
before the attempt; another overflow still stops. Explicit scoped repairs retain
their own existing limits and do not acquire this generation recovery allowance.

Project Explorer shows a separate AI pending-files list during generation and
validation. It contains completed staged paths and the file being generated;
it never writes those paths into the editable filesystem. Applied files move to
the normal explorer. Stopped/failed candidates remain labeled as not applied
until the next request.

Candidate testing selects the Tests tab and uses the existing test-output running
state and elapsed-time indicator. It records the final runner output there while
leaving the agent mounted and cancellable. This is an indeterminate running
indicator, not a fabricated per-test completion percentage; test output currently
arrives when the runner completes.

### Explicit CSS delegation

CSS split inventories may declare `importsOnly: true` alongside `files` when
those helpers collectively own all of the retained stylesheet's responsibilities.
The planner must assign layout, component, responsive/state and animation rules
to helper contracts before choosing this mode. After the helpers complete, the
host assembles the retained stylesheet from ordered relative imports and runs
normal source/import validation. No additional model request generates that root.
A failed helper still fails the transaction; truncated styles are never salvaged.

Missing or false `importsOnly` preserves the existing composition request and its
unique residual rules. This avoids silently discarding root styles from older
plans. File, request and split limits remain unchanged. Local regression coverage
checks both response formats, retained residual styles and helper failures; it
does not establish live-model visual completeness.

### Scoped repair output overflow

When a targeted complete-file repair exceeds its token allowance, one fallback
request can return up to 16 exact `before`/`after` replacements for that same file.
The host matches against the original snapshot and rejects missing, repeated,
overlapping, unchanged or out-of-scope edits. It reconstructs the complete source
locally, then runs the existing syntax, import and workspace validation path.
This never salvages truncated output or authorizes helpers or unrelated files.
The fallback remains subject to cancellation, request budgets and source-size
limits; an overflowing fallback stops instead of starting another split loop.

### Source completion at workspace capacity

When all 36 workspace paths are allocated and a source module overflows, its
existing single focused completion attempt requests 8,192 output tokens instead
of repeating the ordinary 6,144-token allowance. Host/provider caps still apply.
This exception belongs only to that file and is not learned as the allowance
for subsequent modules. Request-count, character-size and cancellation guards
remain unchanged. If it overflows again, the error identifies the exhausted
completion attempt and file ceiling; it does not request another split plan.

Exact-edit match failures report the offending edit number, match count and up
to five matching line numbers. A completed proposal with zero or multiple matches
gets one corrective request against the unchanged original snapshot, subject to
cancellation and remaining request budget. All edits remain atomic; no fuzzy
matching, partial application or scope expansion is allowed. A second mismatch
stops with the virtual file path in the error. Output-limit failures and other
invalid proposals do not receive this match-correction request.

The single match-correction request uses inclusive integer line ranges rather
than copied before blocks or hash-prefixed anchor strings. Its schema bounds
start/end to the number of lines in the host-held original snapshot. The
correction has a dedicated prompt and one numbered editable snapshot; it does
not append the obsolete exact-text protocol or rejected proposal. The host
rejects noninteger, out-of-range, reversed and overlapping ranges. All selected
ranges refer to the same immutable original, and reconstructed source still
undergoes full validation. Retry counts and request budgets are unchanged.

### Plugin-local SKILL.md

The staged coding agent reads `/SKILL.md` from the plugin's virtual workspace.
It is a normal plugin file, included in generated file sections and subject to
ordinary candidate validation/application, rather than a host or personal Codex
skill. New-plugin planning requests a concise guide unless the user forbids it;
this is planning guidance, not a mandatory file-admission rule. The guide counts
toward the existing workspace file limit.

When planned, the root guide is generated before implementation files. Its latest
validated content is supplied to subsequent staged planning, generation and
repair requests across providers. Existing guides are read during targeted
repairs without expanding authorized edit paths. Guidance is limited to 16,000
characters with an explicit truncation notice. Nested skill discovery, reference
loading and script execution are not implemented.

Document purpose, canonical identifiers, public contracts, SDK conventions and
test fixtures. User requirements, installed SDK contracts, host response schemas,
repair scope and executable validation take precedence. Generated documentation
can be wrong; it is context, not proof that implementation or tests are correct.

Guide repair diagnostics distinguish declaration-only exports (resolved through the installed TypeScript entry point) from runtime values, recommending `import type` only for verified type-only exports. Unknown accessor methods include up to twelve public signatures from installed declarations as reference, not automatic substitutions. Diagnostics retain their actual Markdown line instead of adding a duplicate guide prefix. These hints do not approve invalid examples or relax acceptance criteria.

Guide example validation respects Markdown fence boundaries, including longer closing fences and indentation. Explicit JavaScript/TypeScript blocks and unlabelled blocks containing SDK imports are checked as source; ordinary unlabelled file trees and command snippets are documentation. Generated guides should label file trees `text` and commands `sh`. Syntax-only errors do not include the runtime export inventory; SDK import failures still provide contract evidence.

Guide code examples now participate in installed SDK validation during staged
file acceptance and candidate builds. Complete JavaScript/TypeScript fenced
examples are parsed without execution; value imports (including unused example
imports) are checked against runtime exports, and existing DOMText/action-source
checks apply. Diagnostics retain `/SKILL.md` ownership and Markdown line numbers
for bounded targeted repair. Generated guides should use tilde fences so they do
not conflict with the host's backtick file-section envelope.

Acceptance-schema diagnostics identify each invalid criterion and field, including
missing strings, duplicate IDs and invalid virtual test paths. A format failure
that interrupts source repair retains those source diagnostics. Completed
non-JSON replies get a focused envelope-repair prompt with the rejected reply,
file contract and unresolved diagnostics instead of the full generation request.
If the first format repair also fails, that interrupted source repair may use
one final format attempt per file (only for non-empty replies within 48,000
characters). The shared request budget and deadline still apply. Repeated
malformed output then stops without applying files. These rules are shared by
all staged providers and models, including OpenRouter's free router; they do not
guarantee equal model quality or a successful generation. In source-response mode, a complete unfenced JavaScript/TypeScript reply may be wrapped locally only when the entire reply parses as a module and contains an import/export declaration. The host preserves every source character and uses its already-approved target path. Markdown fences/headings, prose, malformed syntax, bare trailing identifiers and oversized output fail recognition; the host never extracts fragments or guesses missing delimiters. When a recognizable unfenced module fails parsing, the bounded format repair receives its syntax error and location as well as the envelope instructions; adding fences alone cannot correct invalid source. This format recognition spends no AI request and does not replace source, SDK, typecheck, build, test or approval gates. Provider completion checks still reject interrupted streams before decoding. CSS and other source formats retain their existing transport requirements. Root `/SKILL.md` has a separate Markdown transport: a complete document starting with one top-level title may arrive without an outer fence, or inside a Markdown fence (four backticks are recommended). Balanced backtick example fences are converted to equivalent tilde fences for the editor transport; example contents are retained. Unclosed fences, extra File headings and ambiguous document boundaries are rejected. Missing acceptance criteria are content errors, not a reason to demand source-code fences around Markdown. This decoding does not approve the guide or validate its SDK claims; all existing content checks still run. Guide validation and human approval remain
required after recovery.

Before attaching an existing guide to a staged request, the installed validator
checks it. A failing guide is withheld as instructional context, with diagnostics
supplied instead; this does not authorize editing it outside the repair scope.
Checks are cached per exact guide content for the request. This is not full
TypeScript type checking or semantic verification of prose, reference links,
namespace member access, arbitrary SDK signatures or intended plugin behavior.
The candidate build and executable tests remain required; no live-provider pass
is inferred from guide validation.

### Developer guide review

Staged API-provider generation pauses after a new or changed `/SKILL.md` passes
validation and before any subsequent implementation request. The developer can
edit the guide, approve it, or stop and revise the request. Edited Markdown is
validated again before approval is accepted. The IPC decision is bound to the
active request and originating renderer; cancellation and renderer destruction
cancel the wait. Unchanged existing guides do not prompt again. CLI providers do
not use this staged gate. A guide omitted from the plan cannot trigger it.

The live test driver explicitly clicks the same approval control. This simulates
user acceptance for automation; it does not claim semantic human review. Candidate
build/test gates remain mandatory. A changed guide is reviewed again when it is
generated, but detecting stale prose after implementation changes is not yet
implemented.

### Guide compatibility report

The installed SDK validator also inspects explicit dotted references in guide
prose rooted at `sdk` or an installed export name. It uses property descriptors
and class prototypes, without constructing classes or evaluating getters. Missing
members produce conflicts with a Markdown line, contract source path and a
correction suggestion. Accessor-dependent references and warning statements are
reported as unverified. An existing member verifies existence only, not argument
types, return values or behavioral correctness. Other prose remains unverified.

The review dialog displays this report. Editing invalidates it; Check compatibility
recomputes it without approving or resuming generation. Approval revalidates and
cannot accept a detected conflict. The staged validator repairs conflicting new
guides before review and withholds conflicting existing guides from context.
Runtime/security restrictions, SDK contracts and manifest validity remain hard
constraints. The current user request outranks guide conventions and existing
project conventions within those constraints.

### Visible verification attempts

Candidate verification emits structured snapshots containing changed paths and
per-check states: pending, running, passed, failed, blocked or not-run. The editor
shows the last ten attempts and records snapshots as `workspace-verification`
lifecycle events. A bounded repair creates another attempt instead of erasing
the failed result. Diagnostic detail in candidate report entries is limited to
12,000 characters; the repair still receives the original diagnostics.

The report distinguishes source rules, workspace import/call/CSS checks, candidate
compilation with installed SDK checks, a separate pre-apply TypeScript check,
candidate tests and acceptance evidence. No candidate tests is explicitly
not-run. Editor diagnostics remain a secondary check after application. A dedicated security audit is
also not-run; runtime enforcement is not proof of an audit. This reporting change
does not increase retry budgets, change repair scope, or replace validation gates.
Capability planning, SDK/guide migration fingerprints and approved acceptance
criteria are described below.

### Capability planning, SDK migration and acceptance evidence

Staged API-provider planning now receives a structured inventory read from the
installed SDK runtime exports and declarations. Its fingerprint hashes the SDK
bundle and sorted declaration contents. Exported class methods are read from
TypeScript declarations (including inheritance), without invoking export getters.
Plan contracts referencing unsupported explicit SDK APIs are rejected before
source requests, within the existing one-retry planning budget. The inventory
includes virtual-workspace boundaries; it does not grant permissions or claim to
know enabled external-plugin capabilities. Capability scans are recorded in trace.

New guides and guides lacking the current fingerprint must be included in the
plan and reviewed. Approval stamps `fdo-sdk-fingerprint` into the guide; the
review displays SDK version, migration status and criteria. A narrow repair whose
retained guide is stale fails before inference rather than modifying a guide
outside its authorized scope. Review/migrate that guide in a workspace task first.
Unchanged guides matching the current contract do not prompt again. The
fingerprint detects SDK contract changes, not semantic drift in arbitrary prose.

Guides include one machine-readable acceptance block:

    <!-- fdo-acceptance -->
    ~~~json
    [{"id":"format-json","description":"Format valid JSON","testFile":"/tests/json.test.ts","testName":"formats valid JSON"}]
    ~~~

The developer approves these criteria with the guide. New staged guides require
criteria; legacy workspaces without a block are reported as not-run. The candidate
must contain the referenced direct, top-level node:test cases. Each staged test
file request also receives its exact approved criteria, and file validation checks
those declarations before marking the file complete. Missing cases enter the
existing bounded source-repair flow immediately; pending test files are checked
at their own generation steps. The full candidate check remains in place.
The real runner
uses an additional structured reporter to record test name, virtual file,
pass/fail and skip/todo status. A successful suite alone is insufficient: every
criterion needs matching non-skipped passing evidence. Assertions can still be
inadequate; this verifies execution of approved tests, not arbitrary semantic
correctness of the requirement.

### Detached TypeScript gate

Before compilation, tests or application, the candidate is checked using the
packaged TypeScript compiler and installed SDK declarations in an in-memory
compiler host. All project TS/JS sources and tests participate. Strict checking,
unused-symbol diagnostics and SDK ambient types match the host's plugin model;
CSS imports have the host's style-map declaration. Candidate tsconfig plugins and
compiler overrides are not executed or trusted. Third-party declaration checking
is skipped (`skipLibCheck`); project source diagnostics are not skipped.

Diagnostics retain virtual paths and enter the existing bounded scoped repair
loop. An unavailable checker, invalid result, workspace edit or cancellation does
not authorize application. Editor diagnostics remain a secondary post-apply
check. TypeScript and Node declarations are copied into the packaged runtime.
CLI-provider planning still bypasses the staged guide/capability review workflow;
the editor's candidate typecheck and acceptance gates apply when those responses
are applied through the same candidate pipeline.

Scoped staged repairs also run the detached TypeScript checker against the latest
complete candidate before accepting each repaired file. Only diagnostics owned
by that file enter its bounded source-repair loop; other owners remain with their
scheduled step and the final candidate gate. This catches unresolved or introduced
SDK interface, ambient declaration, union access and unused-symbol errors without
applying files or expanding repair scope. Compiler environment failures stop the
repair rather than being treated as success. Initial generation still receives
its full typecheck at candidate verification, once all dependencies exist.

Candidate verification collects independent workspace-contract, acceptance-presence
and TypeScript diagnostics before choosing the bounded repair scope. A retained
starter test with an outdated import can no longer hide compiler errors in other
files until after the repair allowance is consumed. When generated source rules
already fail, the panel still requests these static checks but blocks build and
test execution. Duplicate paths and concurrent workspace edits still stop validation
immediately because the candidate cannot be interpreted safely.

After the normal test-repair pass, one final scoped repair is allowed only when
structured execution results show a strict subset of the previous failing tests,
no newly failing tests, and every previously reported test still present and
executed without skip/todo. Missing, duplicate or incomparable identities do not
qualify. The extra pass is consumed even if failures decrease again; stagnant
runs stop without further inference. The UI explains this final pass. This can
address a later assertion exposed by an earlier fix without an unbounded loop.

Repair evidence follows explicit TypeScript type imports and type re-exports from
direct dependencies, including nested indexed parameter contracts. Traversal is
cycle-safe and uses the latest candidate sources; it does not follow unrelated
runtime dependency chains or grant permission to edit referenced modules.
Typed-fixture guidance asks for contextual annotations at the fixture declaration
so literal unions and required nested fields are checked together rather than
patched through casts or weakened production interfaces.

### Codex evaluation versus the full Workbench live test

The Codex evaluation uses the bundled CLI and existing Codex login, currently
with macOS plugin isolation. Its model variable differs from the API harness:

```sh
FDO_E2E_LIVE_AI_MODEL=gpt-6-astra npm run test:ai:live:codex
```

This runs `scripts/evaluate-plugin-assistant.cjs` and writes
`test-results/plugin-assistant-live.json`. It does not run the full Workbench UI
scenario. For that scenario with the OpenAI API, supply an API key through the
environment and use:

```sh
FDO_TEST_AI_PROVIDER=openai FDO_TEST_AI_MODEL=gpt-6-astra \
  npm run test:ai:live -- --grep 'Web Tools Workbench'
```

`FDO_TEST_AI_API_KEY` must already be set for the API command. Model access depends
on the account; the live configuration currently rejects `codex-cli` as an API
scenario provider. GPT-6 family model IDs are documented at
https://developers.openai.com/api/docs/guides/latest-model.

### Authenticate the Codex evaluation with an API key

A successful Codex evaluation already has access to saved credentials. An API key
is optional if the existing login works. To switch to API-key authentication, run
the following in an interactive **zsh** terminal on macOS with `codex` available
on `PATH`:

```zsh
read -rs 'OPENAI_API_KEY?OpenAI API key: '
echo
export OPENAI_API_KEY

printenv OPENAI_API_KEY |
  codex -c 'cli_auth_credentials_store="file"' login --with-api-key

unset OPENAI_API_KEY
```

The hidden prompt keeps the key out of terminal output and shell history. Check
that login reports success, then verify the saved authentication method:

```sh
codex -c 'cli_auth_credentials_store="file"' login status
```

This changes the saved Codex login to API-key authentication. API-key requests
use OpenAI Platform billing rather than included ChatGPT plan usage. Codex can
share credentials with other local clients using the same configuration home.

File-backed storage is required by FDO's current isolated runner: it copies
`auth.json` from `CODEX_HOME` (default `~/.codex`) into a temporary isolated home
with owner-only permissions. It does not copy the OS keychain or forward
`OPENAI_API_KEY` into that process. Use the same `CODEX_HOME`, if customized, for
both login and the evaluation. Treat `auth.json` as a secret; do not commit it or
include its contents in test reports.

After login, run from the repository root:

```sh
FDO_E2E_LIVE_AI_MODEL=gpt-6-astra npm run test:ai:live:codex
```

| Runner | Model variable | Credentials |
| --- | --- | --- |
| `test:ai:live:codex` | `FDO_E2E_LIVE_AI_MODEL` | Saved Codex `auth.json`; `FDO_TEST_AI_API_KEY` is not used |
| `test:ai:live` | `FDO_TEST_AI_MODEL` | `FDO_TEST_AI_API_KEY` for hosted API providers; Codex login is not used |

The Codex evaluation prints heuristic scores for SDK knowledge, an Azure CLI
implementation plan, and refusal of host-private access. It also checks a
specific host-file isolation boundary. Passing is not proof that a generated
plugin compiles or works; use the Workbench scenario for build, test, deployment,
and UI coverage. The JSON report includes responses and individual criteria for
investigating failures. Changing documentation or this evaluation script does
not require rebuilding FDO.

See [official Codex authentication documentation](https://learn.chatgpt.com/docs/auth)
for API-key login, credential storage, and billing behavior.

Plugin selection now polls for successful Home selection, rather than assuming
that availability of the Home test API means its asynchronous inventory has
loaded. Failure to select within 15 seconds still fails the scenario.

Targeted complete-file repairs that exceed either the token allowance or response character cap may fall back to compact exact edits. If that edit response exceeds its allowance, the existing single corrective attempt uses numbered line ranges against the immutable original file. Match failures and output overflow share this corrective attempt; they do not start independent retry loops. Repeated overflow stops with a compact-repair diagnostic. Reconstructed source still passes normal validation, and cancellation, request budgets, file scope and atomic application remain enforced.

A recorded preview-logic generation returned textual XML `<tool_call>Read` requests rather than source. The file-generation step does not execute these requests. Its format diagnostic now explicitly identifies this response shape and instructs the existing bounded repair to use supplied workspace context and return a complete file. Repeated pseudo-tool responses fail without completing a file; tool-call text inside syntactically valid source remains ordinary data.

A classification-only reply consisting of `User Safety: safe` contains no implementation. The file decoder identifies this exact response shape in both JSON and source modes and sends an implementation-specific diagnostic through the existing bounded repair. It neither applies the label as code nor retries indefinitely. The same wording inside legitimate source is preserved.

### Structured plugin guide proposals

The staged application flow now requests a JSON proposal for purpose, module responsibilities, conventions, SDK pattern IDs and acceptance criteria. FDO assembles the Markdown, SDK fingerprint and acceptance block. Models cannot supply SDK example code through this protocol: the host offers only built-in patterns that pass the installed SDK validator, then inserts their source. Existing guides remain reference material and migrated guides still require approval.

Each acceptance criterion includes a verbatim requirement quote, an observable description, a unique ID and a test path/name from the approved plan. Quotes must come from the request rather than injected SDK context. These checks establish traceability and structure, not semantic completeness; human review must confirm coverage. Executable acceptance checks remain mandatory after implementation.

There is one initial proposal request and one automatic section repair. Successful sections are retained and cannot be overwritten by subsequent model patches. The repair includes the rejected values and precise errors. After exhaustion, the active request retains the draft in a recovery dialog: edit its JSON and validate it, or explicitly retry only the failed sections once. These actions still respect cancellation, request budgets and deadlines. Valid edited proposals proceed to the ordinary Markdown compatibility check and human approval; they never bypass it. Stopping the active request discards this in-memory recovery state.

Live tests use the same automatic proposal checks and normal validated guide approval. If human editing is required, the test fails promptly instead of approving the invalid proposal or hanging until its deadline. No model fallback or weaker validation is used.

Proposal paths may omit the leading slash only when adding it exactly matches an approved inventory path. FDO canonicalizes that spelling before validation/rendering; it does not resolve traversal, relative dot segments, case differences or unknown files. Proposal-review stops are reported separately from actual live-test deadlines, and lifecycle diagnostics retain bounded section errors for investigation.

### Reasoning and buffered-response waiting

The saved first-answer timeout is the initial silence budget. Confirmed provider reasoning or a declared buffered response grants an absolute allowance of up to three times that setting, measured from request dispatch. Repeated reasoning events, buffering notifications, and FDO heartbeats cannot keep extending it. Completely silent requests retain the initial deadline.

Reasoning after an answer prefix suspends the idle watchdog until content resumes; the total completion deadline remains active. Codex reasoning phase events receive the same treatment, and API adapters notify the backend when a response intentionally returns all at once. Progress reports the current wait state without exposing reasoning text. Stop and cancellation clear the timers. Providers that reveal neither reasoning nor buffering cannot be distinguished from a silent connection; increase the initial timeout for those models if needed.

After answer text begins, API and CLI streams allow silence for the full configured first-response timeout (with a 30-second minimum), rather than one-third of it. A five-minute setting therefore allows a five-minute silent continuation instead of stopping at 100 seconds. API waiting notifications keep the editor responsive without counting as provider activity or extending the backend deadline. Hidden reasoning is not claimed as confirmed activity. The total answer budget remains three times the setting, and tool execution retains its own deadline.


Coding requests now allow four minutes of initial silence for hosted providers; existing five-minute defaults for local, routed, and CLI providers remain unchanged. On startup, legacy saved 90-second coding values are upgraded once to the new provider default. Other saved values are preserved, and subsequent explicit short settings remain supported.

Bundled Codex keeps JSON events enabled even if an older progress-only fallback stored a cooldown. A native `turn.started` event or confirmed reasoning/tool activity grants one absolute generation allowance of up to three times the initial wait. Such activity cannot trigger the old 15-second progress-only restart. Gemini text mode uses the buffered first-answer allowance because it does not expose internal reasoning events. Heartbeats and generic status text do not extend the deadline. API reasoning events also count when they contain no visible reasoning text. Stop and checkpoint resume remain available; requests still have bounded generation and completion budgets.

### Assistant companion window

The AI Coding Agent tab offers **Open assistant window**. It opens a movable,
resizable, modeless companion window with **Show IDE** and **Return to editor**
controls. Closing the companion returns the assistant to its tab; it does not
cancel an active request. Closing the IDE also closes the companion.

One stable React portal host moves between the two documents. The assistant
stays mounted with its prompt, conversation, current provider request and
original editor/VirtualFS references. No second workspace or IPC request is
created. Blueprint dialogs use the current document's portal container, and
assistant shortcuts and clipboard actions use its window. Optional history,
request guidance and keyboard shortcuts start collapsed in the floating view;
workspace review buttons stay visible and warning guidance remains expanded.
Source files and snapshots stay in the IDE. Show IDE uses native window focus
and restores a minimized owner. The companion is an independent native window,
so macOS does not force it to stay above the IDE. Live request progress stays
at the top of the companion, with Submit/Stop actions pinned near its bottom.
The companion overrides the inherited preload
with a dedicated API-free preload at an absolute packaged path.

`tests/e2e/ai-assistant-window.spec.js` verifies native window opening, draft
editing, return/close cycles, confirmation placement, visible Submit controls,
native Show IDE focus, visible workspace review buttons, preload isolation,
and completion of one real IPC request after moving back to the tab. Only
provider HTTP is simulated, with isolated fixture settings and no paid calls.

### Stylesheet generation and repair contract

The virtual CSS loader uses PostCSS syntax nodes for selector lists and
declarations. Grouped controls and pseudo selectors become independent entries;
commas and whitespace inside quoted values or selector functions are preserved.
Top-level media/supports/container rules are attached to class entries at their
original source position before import composition, retaining declaration order.
Plugins register the full entry with dom.createClassFromStyle on their DOM
instance; filtering out object values still discards nested rules. Original
conditional blocks remain available in the map for selector-inventory consumers.

The shared provider guide includes an executable SDK composition example:
CSS imports contain style objects, each render uses one DOM instance shared
with its child renderers, and the deployed plugin calls that composition entry.
Styles are registered before the complete markup is passed to renderHTML.
Palette custom properties belong on an ancestor of their consuming regions.
API and CLI requests, including staged CLI steps, receive the same guide.
Style-related repair evidence repeats this contract even when no declaration
excerpt is retrieved. Repairs must preserve state, handlers and public interfaces.

Complete-workspace validation warns when CSS imports in the static dependency
graph from /index.ts have no createClassFromStyle registration. Unused rendering
modules and tests cannot satisfy that check; retained workspace files are included
for repairs. This conservative check does not prove styles are emitted or the UI
matches its reference. Rendered results still need inspection. The canonical
composition example is tested against the installed SDK for emitted palette and
child CSS, rather than class names alone.

Review workspace and Review & repair include the stylesheet contract and host
style diagnostics in the review context. The host retains those source findings
even if the model reports passing tests with no issues. Review stays read-only;
Review & repair adds the entry and stylesheet-importing modules to its approved
repair paths, preserving the normal snapshot and validation flow. After repair,
the host repeats the style-registration check alongside plugin tests; remaining
registration issues keep the report partial. This detects missing registration,
not every possible visual defect or unused per-component style.

The host's workspace quality review prompts never trigger deployed plugin
lifecycle probes. Words such as stop, verify, and render in those prompts refer
to source review and tests, and do not authorize activate/deactivate/init/render
actions. Review and repair therefore do not require the deployed plugin to be ready.

### Repeated manual validation recovery

When a complete candidate fails validation and its diagnostics identify workspace
files, **Repair failed validation** retains that candidate and the latest diagnostics
in the current assistant session. Automatic repairs remain bounded. Each manual
click authorizes one scoped provider repair followed by candidate validation, with
no automatic cascade; there is no fixed limit on subsequent user-requested attempts.
Unchanged proposed files and retained dependencies are supplied with the candidate.
Failed validation replaces the retained candidate and diagnostics with the latest
version; provider/format failures preserve the last usable candidate. Only a passing
candidate is applied and saved. Provider selection can change between attempts.

Stop prevents a late reply from being applied and leaves the retained candidate
available. Content changes, snapshot restoration, plugin changes, and original
repair-scope restrictions are checked before requests and before accepting replies.
Starting a new request, clearing recovery, or successfully applying the candidate
discards this session recovery. It does not add disk persistence or guarantee that
an arbitrary provider will eventually resolve every defect.
