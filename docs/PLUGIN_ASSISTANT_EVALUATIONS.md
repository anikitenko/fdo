# Plugin coding assistant evaluations

Live tests are opt-in and consume provider quota. They send the evaluation prompts and public/bundled SDK declarations to the selected provider. Obtain approval before sending private plugin code or private SDK documentation.

- `npm run test:ai:isolation`: local macOS process checks, no model request. Verifies scratch access, denied FDO file reads, denied symlink reads, and excluded host environment.
- `npm run test:ai:live:codex`: three actual Codex requests, using the existing login. Optional `FDO_E2E_LIVE_AI_MODEL` selects a model. Writes `test-results/plugin-assistant-live.json` with complete responses, provider errors and individual rubric results. Stops after a provider error.
- `npm run test:ai:live`: dedicated-key Editor flow described below. Playwright attaches response reports for SDK, Azure-planning, and seeded local-plugin scenarios.

## What the tests establish

The scenarios cover SDK handler lifecycle, UI/backend separation, Azure CLI subscription/resource-group planning, tests/permissions, and refusal to inspect host internals. Keyword checks are only a first-pass rubric. A response can mention correct names while still being wrong. Review the attached answers; compile and run generated plugins separately in a controlled plugin test environment. These tests do not predict every possible answer or certify Azure correctness.

The process checks are independent of model compliance: even a model that ignores its instructions must not be able to read the protected files. No passing live result should be reported when authentication, model access, network, or execution permissions prevent the request.

## CLI boundary

Coding requests use a disposable working directory and home. Only provider login files are copied, with private file permissions; FDO settings, shell environment, user agent instructions and MCP configuration are not inherited. Temporary data is deleted after completion. Codex local shell, apps, multi-agent and web tools are disabled. macOS sandbox rules deny reads/writes under the real user home, FDO working directory, application/resources/executable paths and application data, including symlink targets. Loopback network access is denied.

The currently supported isolated CLI is bundled native Codex on macOS. Gemini CLI, custom CLI wrappers and other platforms fail closed for coding requests until an equivalent process boundary is implemented. API coding assistants remain available and receive the supplied plugin context without local agent tools. This does not stop a user from explicitly pasting sensitive information into their own prompt; never paste FDO secrets into plugin prompts.

## Dedicated-key Editor runs

The default live command now automates the actual Editor UI with an API assistant in a disposable Electron profile. It never falls back to `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, saved assistants, or a CLI login.

Set these in your shell or CI secret store (do not commit the key or paste it into chat):

```sh
export FDO_TEST_AI_PROVIDER=openai  # or anthropic
export FDO_TEST_AI_MODEL='<model enabled for your test project>'
# Set FDO_TEST_AI_API_KEY through your secret store or a silent shell prompt.
npm run test:ai:live
# One scenario first:
npm run test:ai:live -- --grep sdk-contract
```

The command rebuilds the main process, preload, and renderer before it starts, so the live run always evaluates the current workspace. It uses one worker, no Playwright retries, stops on the first failed test, and caps application-level provider calls (including connection verification, routing, and repair attempts). Its default timeout is 600 seconds per test; set `FDO_E2E_LIVE_AI_TIMEOUT_MS` to a higher value when a provider is slower. The normal coding response limit is 8192 output tokens; routing uses 260. If a response still reaches that limit, the Editor retains its partial reply without applying incomplete code and offers a retry that asks for a compact, self-contained response. Provider-library HTTP retries and input tokens mean this is not a dollar-spend guarantee: set a separate provider project budget/quota too.

Tracing, video and screenshots are disabled. The temporary settings profile is removed on normal shutdown; if the machine or runner is forcibly killed, remove the leftover `fdo-e2e-*` temporary directory. Reports redact the exact test key. Only sanitized assistant metadata leaves the provisioning step.

Each scenario saves `test-results/<scenario>/editor-live-result.json`, including raw backend responses, the visible assistant response, Editor error, and resulting workspace files, even when using the terminal list reporter. After a failure, inspect this report before starting another run, which clears previous results. To rerun only the rename scenario, use `npm run test:ai:live -- --grep multi-file`.

Scenarios exercise Review first without edits, an applied multi-file edit that must compile, SDK understanding, Ukrainian Azure CLI guidance, and a seeded local JSON Inspector implementation. Azure-oriented generated code is never deployed or executed against Azure; the local JSON Inspector is deployed only to the disposable test profile for its visual check. Quality scenarios submit through the Editor UI, including its real route selection and public plugin SDK context. No successful live result is claimed until a key is supplied and the requests actually complete.

The older direct CLI evaluation remains separately available as `npm run test:ai:live:codex` and uses Codex login, not the dedicated API test key.

The multi-file scenario now continues with a second request: retain the chosen plugin name, update its description, and preserve the render file exactly. It checks both edits and compiles the final workspace. This exercises real conversation context and consumes additional calls within the same request cap.

## Plugin best-practice scenarios

Run `npm run test:ai:live -- --grep best-practices` for two additional real-provider Editor scenarios:

- Review a fixture with a handler that returns nothing, browser access in backend initialization, and unsupported test globals. The answer must identify those issues and leave the files unchanged.
- Generate a local status plugin and render tests. Parse the generated TypeScript/JSX to check handler registration in `init`, a returned value, matching UI request and click binding, browser API placement, plugin instantiation, public SDK imports, and `node:test` assertions that exercise the render function. Compile the generated plugin and save `plugin-best-practices.json` with source and individual checks.

These are structural checks and review rubrics, not proof of runtime correctness or comprehensive code quality. The generated tests are inspected, not executed by these scenarios. No plugin is deployed. The generation scenario also verifies that Clear conversation is fully inside the visible viewport after a conversation has accumulated.

The full suite includes a seeded JSON Inspector generation scenario. It uses only local data, requires a local CSS style-map import with nested rules, keyframes, and reduced-motion handling, then checks the public SDK/UI contract, compiles the generated workspace, and runs its generated `node:test` tests. It deploys the compiled plugin to the disposable test profile, captures `json-inspector-ui.png` from the real plugin iframe, and attaches the rendered style evidence. Run it alone with `npm run test:ai:live -- --grep JSON Inspector`. Change `FDO_E2E_PLUGIN_SCENARIO_SEED` to select a deterministic visual brief. The request cap also applies to connection verification, routing, and corrective requests; the default is adaptive admission (`FDO_TEST_AI_MAX_REQUESTS=auto`) under a 50-request emergency ceiling and the scenario deadline. Override the ceiling with `FDO_TEST_AI_REQUEST_CEILING` when an environment needs more headroom. The npm command selects automatic mode even with an inherited numeric environment value; add `--max-requests <1–ceiling>` to explicitly choose a fixed cap. Direct Playwright and reliability runs still honor the environment value. If the absolute ceiling is reached, reduce scope or run scenarios separately.

The rename scenario accepts either a literal heading or a heading supplied through render props. Its AST-based check follows the entry file's render arguments into the exported render function's `createHText(1, ...)` call, including metadata properties. It does not execute generated code; unsupported expressions fail explicitly. The heading is checked again after refinement, and the final plugin must still compile.
