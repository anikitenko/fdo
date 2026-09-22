# AI Coding Agent reliability checks

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

CSS split compositions receive exact relative `@import` paths computed from the
host's split plan. For a completed CSS response only, a missing relative import
can be corrected when its filename matches exactly one of that composition's
known helpers. Existing resolving imports, ambiguous filenames, unknown helpers,
external URLs and malformed CSS are left unchanged for normal validation.
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

FDO uses pinned official libraries directly: `openai` (Responses and legacy Chat Completions), `@anthropic-ai/sdk` (Messages), `@google/genai` (Interactions), `cloudflare` (Workers AI), and `ollama` (native HTTP chat). Codex CLI and Gemini CLI retain their existing process integrations. There is no LLM.js or Vercel AI SDK dependency. Model identifiers remain configurable; selecting a model does not imply it supports images, tools or every optional parameter. The [provider adapter README](../src/utils/aiProviders/README.md) explains where SDK versions are configured, how API versions differ, and the Cloudflare path compatibility note.

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

Cloudflare coding generation and routing honor the assistant's saved thinking preference. Live tests and the short probe accept `FDO_TEST_AI_THINKING_MODE=auto|on|off`: Cloudflare defaults to `off` so optional reasoning does not consume the entire stream before any source files arrive; other providers retain `auto`. Explicit `auto` and `on` overrides are respected. Normal app assistant preferences are unchanged. The live runner logs the selected provider, model, thinking mode and first-response deadline and includes them in `editor-live-result.json`. Existing temporary assistants are reused only when their effective settings match, and the UI explicitly selects that assistant. Cloudflare stream errors additionally report the actual requested thinking mode, including when reasoning arrived despite `enable_thinking=false`.

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

Cloudflare's default first-answer deadline is **300 seconds**, including connection setup, prompt/image processing, and reasoning. This is FDO's local deadline, independent of your Cloudflare plan and the overall Playwright timeout. In Settings, use **First answer timeout (seconds)** to set 10–600 seconds. For a live test, set `FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS=420000` to allow seven minutes; reliability matrix entries can override it with `"firstResponseTimeoutMs":420000`. The same bounded policy applies to normal editor requests. Other hosted providers retain their 90-second default; Ollama retains 300 seconds.

Timeout messages and waiting status distinguish whether Cloudflare HTTP headers arrived and how many parsed stream events FDO received. These diagnostics do not include prompts, generated code, reasoning text, or credentials, and they do not claim to identify a Cloudflare queue or billing issue. Reasoning events do not reset the first-answer deadline. Stop remains available throughout. A longer deadline can allow a slow model to start, but does not guarantee completion. Cloudflare's [Qwen 3.8 model schema](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/workers-ai-models/qwen3.8-27b.json) enables reasoning by default, so time to the first answer can include reasoning.

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

The endpoint defaults to `http://127.0.0.1:11434`; the context defaults to 32,768 tokens. Increasing context needs more memory. Context must accommodate the SDK guide, workspace, prompt, image, and output; a model/server may have a smaller maximum than your configured value. Local models have a five-minute first-content deadline for cold starts. The example extends the overall live-test deadline to 30 minutes; it does not relax assertions or guarantee completion within that time. Request limits, repair bounds, functional checks, and screenshot artifacts remain the same as hosted runs.

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

API-backed Coding Agent requests retry a recognized temporary provider failure once after a 2–3 second delay. This is application behavior, shared by ordinary editor use and live tests. Stop cancels the delay; the partial response is cleared before restarting the same task and image. Billing, authentication, validation, ambiguous network failures, and incomplete-stream errors are not retried by this policy. If the provider remains unavailable, the request and live test still fail. The temporary-error budget is shared across the existing single output-limit recovery, allowing at most three generation attempts for an ordinary backend request rather than multiplying retries. Staged scaffolds allow one output-limit recovery per step and share the same single temporary-error retry across the whole operation. File-stage HTTP 408 errors instead go directly to the bounded response-mode recovery described below; they do not first replay the same buffered request. All attempts count against the live run's request limit.

`--repeat` accepts 1–10 (default 3), with at most 30 total runs. `FDO_TEST_AI_MAX_REQUESTS=auto` (the default when unset) admits requests according to pending work, up to an absolute ceiling of 50 per run. An explicit integer (1–50) sets a fixed cap. Recovery attempts count in either mode. The displayed plan includes the aggregate maximum request count. Each run retains the live suite's timeouts, one worker, zero test retries, and fail-fast behavior within that run. Use `--grep` to select a particular scenario or group. There is no fallback to personal credentials.

### Cloudflare scaffold generation

Cloudflare Coding Agent scaffold requests use a staged transaction in both the editor and live tests: a file manifest (up to 2,048 output tokens), then one complete file per request (up to 3,072 output tokens for CSS and 6,144 for other files, or the configured coding limit if lower). The initial manifest can use the existing 36-file transaction ceiling, subject to the remaining request budget; it is no longer restricted to 12 files. Composition, navigation/actions, styles and tests must be planned alongside feature modules. The 6,000-character manifest and 2,048-output-token limits still require concise contracts. Each file receives the original requirements, shared interface contracts, and already completed pending files. Other coding operations and regular chat keep their existing request flow. The orchestration is independent of the provider adapter.

This avoids requiring an entire workspace to fit in one long inference stream. Observed Cloudflare runs closed at 300 seconds while still generating answer text; this is an observed cutoff, not a documented universal service limit. A longer Playwright timeout cannot make an upstream stream continue. Each staged response still requires explicit provider completion; incomplete output is never treated as a complete file. Files remain pending until all steps succeed, after which the existing editor validation/application path receives one combined response. Stop prevents further steps. The progress popover shows the current file; all inference calls and recovery attempts are billed and counted against the existing live request limit.

Staging can increase input-token usage and total task duration because context is repeated. It does not guarantee that an individual large file will finish, and failed transactions do not persist resumable checkpoints. Test deterministically with `npx playwright test tests/e2e/staged-workspace-generation.spec.js --workers=1` after building; this uses real native SDK/IPC paths with simulated HTTP responses, including an interrupted final file.

Splitting reduces the initial response allowance. An unsplit code module allows 6,144 output tokens; first-level helpers start at 3,072 and second-level helpers at 1,536. CSS starts at 3,072, then 1,536 and 1,024. Composition files initially use at most 2,048 or the smaller allowance for their branch. Both planning and file prompts state the actual allowance, including the JSON envelope.

If a file explicitly exhausts a reduced output allowance, it can retry once with double that allowance, capped at its unsplit ceiling (3,072 for CSS, 6,144 for code). This happens before enforcing the split-depth guard: a second-level helper can still finish when the initial allowance was too small. The retry is admitted against remaining requests and the existing deadline, counts as an actual inference attempt, and regenerates one complete file; truncated text is discarded. Timeouts, ambiguous EOF, cancellation and validation errors do not enlarge the allowance. Re-splitting resets the composition allowance without renewing its larger-response retry. A repeated failure follows existing bounded splitting or stops. Complete responses and source validation remain mandatory, and no branch-depth, workspace-size, live request ceiling or timeout is raised.

Live result artifacts retain the bounded main-process coding lifecycle on ordinary provider failures as well as transport failures. Each staged request records its step/path, prompt and system character counts, image presence, structured-output flag, output ceiling, elapsed time and HTTP failure status. Successful steps include provider-reported input/output token counts when available. This metadata excludes prompt/source bodies and credentials; it helps assess later failures without assuming every timeout is caused by file size. At most 500 lifecycle entries are retained to cover the 50-request live ceiling.

The planner returns a compact file inventory, with one short sentence per module (target 80–160 characters, maximum 240) and at most 6,000 characters overall. Implementation details, markup and CSS belong in the subsequent file requests. The original task and compact declarations from completed dependencies supply the detailed contracts. A truncated inventory, invalid JSON, or repairable schema error shares **one** plan retry per transaction, still within 2,048 output tokens. A second failure reports a planning-specific error. Unsafe or duplicate paths, cancellation, and incomplete streams without an explicit output-limit reason are not retried as plan validation failures.

If a source file explicitly reaches its output limit, the orchestrator asks for a helper inventory. Code-module helpers must be new; CSS inventories may also reference exact completed or pending CSS paths. The host retains the oversized module path and contract, schedules it after its dependencies as a composition module, and preserves the original contracts of retained files. It validates that completed paths are not overwritten, pending paths are not dropped, and each helper inventory stays within the 12-entry planning-response limit. The full transaction may grow beyond the initial inventory only through admitted helper splits. Completed files remain pending and are not regenerated. At most **two split levels per dependency branch** are allowed. Unrelated modules have independent allowances, while all branches share the single plan-validation retry, 36-file ceiling and existing transient/request budgets. The generic “retry a complete answer” recovery is bypassed for staged requests. Truncated source is discarded; only an entirely successful transaction emits completion. File-creation restrictions remain part of every prompt; if the model cannot produce an acceptable split, the request fails without applying changes. Usage includes unsuccessful attempts and replanning calls. File plans, split plans and initial individual-file requests start with native Cloudflare JSON-schema output and streaming disabled. After a file-stage HTTP 408, subsequent file requests use streamed source while plans retain structured JSON. A completed file with invalid JSON uses its existing format retry to request a buffered fenced-source response instead, as described below. The schema requires paths and short contracts: up to 36 files initially and up to 12 references per helper inventory. The adapter accepts both native response objects and chat-shaped JSON responses; chat-shaped responses still require a successful finish reason. It emits structured response text only after checking completion. Each source-file schema requires exactly the requested path and an array of physical source lines; the host joins lines with LF characters, then validates and encodes the editor file section. Heartbeats, cancellation, request budgets and usage accounting apply to both paths. A completed individual-file response that fails local JSON parsing can select the fenced-source format retry. Separately, a typed retryable file-stage HTTP 408 switches to streamed source once; schema rejection, authentication errors and incomplete streams do not authorize this fallback. Local path, duplicate, size and contract validation remains mandatory. See [Cloudflare JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

### Modular workspace generation

The shared authoring guide instructs every coding provider to use cohesive modules for multi-feature plugins: thin entry/lifecycle and rendering composition files, feature or screen modules, self-contained action handlers, styles, and focused tests. There is no minimum line count or file count; small plugins and explicit user file restrictions take precedence. Plans record imports/exports, selectors, and dependencies before source generation. Serialized iframe handlers must not capture ordinary module imports or outer variables.

The Web Tools Workbench scenario retains its entry files but permits helper modules and nested test suites, without an arbitrary final changed-file count; the host bounds each inventory and admits split helpers against remaining requests. Its repair prompts follow the owning modules instead of forcing everything into render.tsx. The rubric checks implementation across source modules and node:test coverage across test modules, while still excluding assertions from implementation evidence. Functional and screenshot checks remain unchanged. Every staged file request still counts toward the run's existing request budget.

The shared TypeScript guidance also covers feature folders, colocated types/tests, relative and type-only imports, explicit exported interfaces, runtime validation of unknown input, discriminated state unions, cancellation/resource cleanup, and behavioral tests. Existing workspace conventions and explicit user instructions take precedence; the assistant must not change package/compiler configuration just to impose a preferred layout. Build success must not be reported as proof of TypeScript type correctness.

Cloudflare's structured requests use a buffered response even though FDO exposes an event iterator to the editor. Progress therefore says that the complete answer arrives all at once, alongside the current workspace file and elapsed time. Pending HTTP headers are described as waiting for a response, not as a connection attempt: headers can arrive only after generation. The adapter reports its actual response mode, and the shared client resets transport counters for each request. No synthetic tokens or completion estimates are displayed.

During staged workspace generation, both progress views use the orchestrator's current file/stage as the heading. A provider retry on an earlier file does not relabel later files as code corrections or carry an attempt number into their headings. Transport details appear separately, while explicit repair and split stages retain their own labels. “File 2 of 12” identifies the file currently being generated, and elapsed time covers the entire operation across file transitions and retries.

The editor's local issue classifier is a context hint, not an AI diagnosis. A generic error mention no longer displays a warning callout in the composer; request status only notes that the reported error was included. Specific SDK/runtime hints and actual request failures retain their existing presentation.


### Modular stylesheets

The shared authoring guide applies modular design to CSS, feature logic, rendering, fixtures, types and tests. Large stylesheets should be split by feature/component, with responsive, state and reduced-motion rules alongside the owning styles. A thin root stylesheet can use quoted relative imports such as `@import "./styles/layout.css";`; feature renderers may also import their own style maps. Imports precede local rules. The Workbench scenario and its repair prompts preserve this organization rather than forcing all CSS into `/styles.css`.

The native virtual compiler resolves nested workspace CSS imports and merges declarations recursively. Later imports and local declarations override conflicting properties while preserving other base/state/media properties. Shared dependencies are resolved in each branch's order. Missing imports, cycles and unsupported import forms fail compilation instead of silently omitting styles. This remains FDO's style-map format, not a general browser CSS/Sass loader: quoted relative `.css` paths are supported; URL/package imports, import qualifiers and Sass are not. Every visible style still needs registration through the DOM instance and application to markup.

The staged generator budgets CSS files separately and, after an explicit output limit, requests smaller CSS modules composed with `@import`. Each inventory remains limited to 12 files; additional helpers must fit the remaining request budget, and the transaction still permits at most two splits. Splitting reduces individual response size and enables focused repairs, but extra requests and repeated context can increase total latency and input-token cost; avoid one-file-per-rule fragmentation. The CSS runtime regression compiles, deploys and renders nested feature styles and checks declaration overrides, interactive state and reduced motion without provider calls.

When a module exceeds its output limit, the model proposes only new helpers in dependency order. The host retains the original module path and contract and schedules it after those helpers as a thin composition module; completed source and other pending files remain unchanged. A redundant original-module entry is ignored wherever it appears in a completed, valid inventory. This does not repair JSON or source code. Local validation still rejects unsafe/duplicate paths, collisions with other retained files (including case variants), helper-free splits, excessive helper counts, and non-CSS helpers for a stylesheet. The helper schema bounds only new inventory entries; retained paths remain host-owned and do not consume helper slots. The host checks the concrete helpers plus all pending work against the remaining request budget before scheduling any helper. Explicit composition instructions list all helpers, including those from an earlier split of the same module, to avoid regenerating their implementations. Invalid splits share the existing single file-plan retry across the transaction; output splitting, budgets and cancellation remain bounded.

### Provider timeouts during generation

Native HTTP 408 responses (including the observed Cloudflare Workers AI `3046` timeout) use the existing single transient-recovery allowance shared across a coding request. SDK retries remain disabled to avoid uncounted or multiplied attempts. In staged generation, only the failed plan/file request is retried after a short backoff; completed files remain pending and unchanged. Cancellation, request-budget admission and the run deadline are checked before another provider attempt. After transient recovery is exhausted, a file-stage HTTP 408 can use the shared module-split allowance described below; planning timeouts and other unhandled failures end the transaction without applying incomplete files. The first-answer timeout is not extended by this change. Local timeout text alone is not enough to trigger recovery; explicit aborts, Workers AI aborted code `3008`, billing errors and `x-should-retry: false` are not retried. Failed attempts remain in usage accounting. See the [native Cloudflare SDK retry policy](https://github.com/cloudflare/cloudflare-typescript#retries) and [Workers AI error definitions](https://developers.cloudflare.com/workers-ai/platform/errors/).

### Request budgets for staged generation

The standard command `npm run test:ai:live -- --grep "Web Tools Workbench"` automatically selects adaptive budgeting, even if an old `FDO_TEST_AI_MAX_REQUESTS` value remains exported. It logs when it replaces that inherited value, without changing your shell. To choose a fixed cap for the npm command, add `--max-requests 20` (any integer from 1 to the configured ceiling). Direct Playwright/IDE launches and the reliability runner continue to honor `FDO_TEST_AI_MAX_REQUESTS`; unset or `auto` selects adaptive mode there. Before a plan, file group, retry or module split starts, admission expands only to cover used requests plus the concrete pending work. Checks do not spend requests; actual provider attempts do. Explicit fixed caps are never raised automatically.

Adaptive admission is bounded by the absolute request ceiling (50 by default), a non-renewing run deadline from the first admitted request (using the scenario duration), and the existing per-transaction retry/split limits. Set `FDO_TEST_AI_REQUEST_CEILING` to a positive integer to raise or lower that ceiling for an environment; it bounds `--max-requests`, `FDO_TEST_AI_MAX_REQUESTS`, the reliability planner's per-run limit, and the adaptive allowance together, and invalid values fail before any provider request. Playwright still owns the overall scenario timeout and teardown. Admission does not guarantee quality or estimate dollar cost, and cannot extend the deadline or turn repeated failures into unlimited retries. Normal application usage remains outside this live-test budget. Console configuration identifies adaptive/fixed mode; `editor-live-result.json` records used requests, admitted allowance, ceiling and deadline.

Acceptance stages that converge over several rounds (the Web Tools Workbench stylesheet and markup repairs) use `FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS`, a positive integer defaulting to 3. Each attempt is a real provider request, so raising it also requires ceiling and deadline headroom; the loops still stop as soon as their checks pass.

A staged workspace uses one planning request plus one request per file. A 12-file plan therefore needs at least 13 requests. Planning retries, transient failures, module splits, routing and later validation repairs consume additional requests. Before generating source, retrying a step or splitting a module, the agent checks that the remaining cap can cover the minimum pending work. If it cannot, the request fails early with used, remaining and required counts; pending files are not applied. A passing budget check does not guarantee completion if later recovery needs more requests. Normal application usage is not subject to this live-test cap.

Completed provider responses must describe exactly one complete file for the requested path. The staged protocol requests JSON `{path, lines}` under a native response schema, removing the model-authored Markdown heading/fence requirement. Each array item is one physical source line; blank lines and indentation are preserved. The host joins items with LF characters rather than asking the model to encode a whole module in a single multiline JSON string. This addresses recorded flattened responses where a `//` comment swallowed declarations and instantiation. Line arrays are limited to 2,000 entries and the existing 48,000-character assembled-source limit; non-string entries and embedded CR/LF characters are rejected. Literal backslashes in source remain unchanged. The path is constrained to the planned file; the host checks the decoded path, exact object shape, non-empty source and size before producing the editor file section. Invalid JSON is never repaired heuristically by the host. Completed legacy `{path, content}` objects and strict Markdown file sections remain accepted for compatibility and receive the same source checks. The host never guesses missing newlines, removes comments or salvages truncated source. Embedded triple-backtick delimiters remain unsupported by the editor file-section parser and are rejected before serialization. Wrong paths, empty or oversized source, extra properties/files and malformed responses produce specific validation reasons. The staged generator may repair the response format once per planned path, respecting the remaining request budget and deadline. If a completed response contains malformed JSON, this existing retry changes to exactly one closed fenced source block. The host supplies the already approved file path; the model no longer JSON-escapes each source line. This is an explicit request format change, not local JSON repair or extraction of partial code. Once a source-block recovery passes both format and source validation, remaining files and any newly split helpers in this transaction use buffered source blocks directly. This avoids paying for the same failed JSON encoding again on every file. Plan and split inventories keep their schemas. A new transaction starts with schema output again; failed or unvalidated recovery never changes the preference. That path retains the source-block format for any subsequent source repair or output recovery. The Cloudflare adapter sends this recovery with `stream: false` and no `response_format`, requires a successful finish reason for chat-shaped replies, and exposes source only after provider completion checks. Missing/extra fences, prose, empty/oversized content and mismatching explicit paths remain errors. Source syntax and entry lifecycle checks still run before accepting the file. No retry allowance, output ceiling or deadline increases. Decoded source has a separate one-time repair allowance; correcting an envelope does not consume the source repair. Neither allowance renews after splitting or output-limit recovery. Previously validated dependencies are retained; rejected source is never appended or applied. A transport failure or missing provider completion event does not qualify for this format recovery. Compilation and runtime checks remain separate requirements after file assembly.


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

Plan IPC requests now carry the current virtual workspace snapshot. Problems-panel repair prompts use that snapshot, including unchanged files, instead of replaying stale pre-generation context; the original task is labeled as reference requirements. File-plan instructions explicitly distinguish the plugin bootstrap from the rendering composition and include requested styles/tests for new scaffolds. Per-file bootstrap instructions apply only to the root entry.

Staged files also validate static local imports before acceptance. Resolution follows the virtual builder's extension/directory order, allows pending planned files and unchanged workspace dependencies, and rejects self-imports and unplanned missing targets. Named/default imports and re-exports are checked against available generated or unchanged module exports. Pending targets are checked when their source arrives. A failure uses the existing single source repair for the current file, retaining completed files and all budget/deadline limits. CSS maps, JSON, CommonJS and star-export shapes are left to compilation where exports cannot be established safely by this check. This is not a substitute for full TypeScript or runtime validation. The recorded live renderer self-import is a regression fixture.

Every staged source file also passes the shared editor file-local rules before becoming a completed dependency. TypeScript/JavaScript (including tests), CSS and JSON are parsed without executing code. The entry check uses executable syntax, so comments, strings or an uncalled function containing `new Plugin()` cannot satisfy it. Missing instantiation and invalid source trigger a repair of that file only; completed dependencies stay intact. Each path gets at most one source-validation repair, separate from its one response-format repair, bounded by the existing workspace file ceiling, request budget and deadline. File-local checks do not require wrappers or handlers that belong to pending modules. Full-workspace rules, compilation, type correctness and runtime behavior remain distinct checks; syntax validation cannot prove functionality.

When file-local source validation fails, the single targeted repair receives the exact rejected source together with its diagnostics and completed dependencies. Diagnostic positions refer to that source. Numbered excerpts show up to three locations with surrounding lines, including preceding lines when a missing delimiter is reported at the next token. String repairs are instructed to distinguish physical source lines, escaped string characters, and JSON escaping. The repair returns a complete corrected file; the host never inserts guessed commas or applies rejected source. Rejected source is retained only as repair context and cleared when the module completes or splits. When a completed file response fails format validation, the one format repair receives the exact rejected envelope as untrusted data, plus the JSON error position, line and column when available. For malformed JSON, the retry rewrites the intended source using the explicit source-block protocol instead of asking the model to repair JSON escaping again. The envelope is retained only up to 48,000 characters; larger responses are omitted entirely, not partially salvaged. The corrected response must pass both envelope and source validation before it can enter the pending transaction. No malformed JSON is decoded heuristically. Rejected envelopes are cleared after success, source validation failure or splitting and never included in staged content or lifecycle logs. Both repair stages share the existing request budget and deadline; repeating a failure in either stage stops rather than alternating through unlimited retries. Live lifecycle metadata records the validation kind, whether that stage has an unused repair, and numeric JSON error locations when available, without retaining rejected source or envelopes.

The live AI Playwright configuration disables generic slow-file reporting (`reportSlowTests: null`). Long provider requests are expected in this intentionally serial suite; scenario deadlines, failure reporting and elapsed durations stay enabled. Ordinary E2E tests keep their existing slow-file reporting.

Initial planning and final workspace size share the 36-file ceiling. An initial plan with twelve feature modules can also include the plugin entry, rendering composition, styles and tests. Helper splits can add files only while transaction capacity remains. Each helper inventory contains at most 12 entries, further limited by the remaining capacity under the explicit 36-file ceiling. A module and its descendants may split through at most two levels; media or social splits do not consume a separate renderer branch’s allowance. The transaction remains bounded to 36 files even outside live tests. Live admission may stop it much earlier: all used requests, pending files, repairs, cancellation and the existing deadline continue to count. No file is applied until the transaction succeeds.

A file-stage upstream HTTP 408 now switches the transaction from buffered JSON/source responses to streamed source, once. It retries the same file with the same output allowance and retains completed files and any source-repair context. Subsequent file requests, including split helpers, use streaming; inventories still use structured JSON. The generic transient retry does not replay this buffered file request before the switch. This addresses repeated ~120-second buffered timeouts observed in live artifacts without claiming a universal Cloudflare time limit or guaranteed recovery. [Cloudflare JSON Mode does not support streaming](https://developers.cloudflare.com/workers-ai/features/json-mode/).

A repeated HTTP 408 while streaming stops with a provider-timeout diagnostic. Timeouts no longer trigger module splitting; only explicit output-limit errors do. Streaming output still requires a recognized successful completion and a complete file envelope before source validation and application. EOF, aborts (including Cloudflare code 3008), billing errors and local deadlines never authorize the switch. Cancellation, remaining-request admission, source-repair allowances and the transaction deadline remain enforced. Planning retains its existing bounded transient retry because it has no known file target to recover.

Provider error normalization preserves sanitized nested error codes and an explicit do-not-retry flag, not raw bodies or headers. This keeps the native Cloudflare 3008 abort distinct from retryable HTTP 408 after errors pass through the shared client; SDK user-abort identity is also retained. Native HTTP regression tests cover this boundary as well as timeout recovery, persistent failure, split admission and cancellation.

Completed dependency context is compacted before later file and split requests. Long TypeScript/JavaScript modules expose parsed declarations, imports, exports, supporting types and typed signatures with implementation bodies omitted. Inferred return implementations and untyped values remain available rather than inventing types. Long CSS modules expose selectors, imports, keyframe names and custom property names. Short files and unsupported syntax retain their complete source. These labeled excerpts are context only: original source is retained in the pending transaction and final output, and syntax repairs still receive the exact rejected file. Compaction reduces repeated input; it does not establish why any particular upstream request timed out or guarantee provider availability.

Live wait diagnostics classify a recorded Playwright test timeout before considering page/transport closure. Main-process snapshots guard each window and webContents access during teardown so a destroyed window cannot erase the coding lifecycle, request budget, or diagnostics for other windows. A missing window observation is not treated as proof of a live renderer.

CSS split inventories distinguish new helpers from reusable paths. Exact retained CSS paths reuse the host-owned contracts, ignoring replacement descriptions in the split response. Completed CSS is not regenerated. If a pending CSS dependency is referenced, its retained prefix moves before the composition, preserving the prefix order; new helpers follow that prefix. Only new files consume additional workspace slots or increase the remaining request count. Reuse-only inventories are valid and still consume a split level, so repeated composition attempts remain bounded. Case-variant collisions, retained non-CSS paths, and references to an ancestor in the host's composition graph are rejected. Full source/import validation remains required; a dependency inventory alone does not prove the final stylesheet has no import cycles.

The Workbench live scenario requests implementation repair for missing declarative actions, visible states and style-map application even when role names are present. A skipped test run or missing node:test coverage triggers the existing bounded test-repair step. Final rubric, compilation, executed-test and browser-interaction assertions remain required; the larger inventory is capacity for a complete implementation, not proof that the model supplied one.
