# Live AI scenarios

Each scenario owns its full workspace-generation, validation, deployment, interaction, and screenshot flow. The shared Electron setup stays in `../ai-coding-agent.live.spec.js`, so every scenario uses the same isolated profile and dedicated test provider credentials.

To add a scenario:

1. Add its prompt and deterministic seed to `src/utils/plugins/authoring/pluginAuthoringScenarioCatalog.js`.
2. Add a focused static rubric in `../helpers/pluginScenarioRubric.cjs` and unit coverage in `tests/unit`.
3. Copy the closest runner in this directory, rename its exported `run…LiveScenario` function, and define its screenshots and interaction assertions.
4. Import the runner, add a small scenario-specific dependency factory, and add one `test.describe` registration in `../ai-coding-agent.live.spec.js`.
5. Run it alone with `npm run test:ai:live -- --grep "Your Scenario Name"`.

Keep real provider requests limited to the final live command. Unit tests should exercise the rubric and scenario selection without provider access.

Live runs (`FDO_E2E=1` and `FDO_E2E_LIVE_AI=1`) automatically approve validated plugin guides in the host without opening the approval dialog. Invalid proposals receive one automatic recovery attempt, then fail with section diagnostics. Normal runs retain manual guide approval.

For reproducible OpenRouter runs, set `FDO_TEST_AI_MODEL` to a specific coding-capable model ID from the current catalog. `openrouter/free` randomly routes requests across free models, so separate generation and repair steps can use different models. If a run repeatedly returns only `User Safety: safe`, it produced a classification instead of code; select a specific model and rerun. Increasing file-repair attempts does not ensure a usable implementation.

The JSON Inspector, Rose Calculator, and Web Tools Workbench prompts describe ordinary DevOps requests: user-visible behavior, visual preferences, and local-only operation. Keep SDK calls, backend transport details, file layouts, CSS rules, and test selectors out of these prompts; the coding assistant should infer implementation details from its platform context. The separate `web-tools-workbench-contract` scenario retains an explicit implementation contract.

The current visual scenarios are `JSON Inspector`, `Rose Calculator`, and `Web Tools Workbench`. Each writes stable screenshots under `artifacts/live-ai` so a successful run can be inspected without opening Playwright's transient attachment directory.

## Manual generation recovery validation

Use a normal FDO profile with a real provider; do not set the automated live-test flags. When a generation attempt exhausts its bounded module recovery:

1. Confirm the workspace still matches the pre-request snapshot and no Apply action is available for the incomplete response.
2. Expand Technical details. Expect schema-backed failure code, failed virtual path, and staged-file count. Staged API and CLI generation save validated sources and its plan separately under the FDO user-data directory. These files have not been applied.
3. Choose Retry with smaller scope. Confirm recovery starts immediately, without another Submit, and the prompt contains the original requirements without appended technical instructions. Previous generated files remain separately available as read-only previews.
4. Confirm the guide and tests are regenerated for the compact core workflow; only standalone helpers with identical file contracts are offered for reuse and pass normal validation. Manually approve SKILL.md when requested. If you want to choose a different feature set, stop recovery and revise your request.
5. Stop a retry once. Late provider events must not restore the recovery warning or apply files. On another retry, confirm a second budget failure offers recovery again, or a successful response proceeds through normal validation and apply behavior.

The failure transport uses `failure.schemaVersion: "1.0.0"`, stable `code`, `stage`, virtual `path`, `workspaceChanged`, `resumable`, and `recoveryActions`. It does not include generated sources or provider response bodies. The UI selects recovery from this metadata, never from the wording of `error`. The recovery controls are backed by atomic, versioned checkpoint files. Resume checks the current workspace and SDK fingerprint, preserves the saved requirements, revalidates completed sources, and asks for guide approval again. Codex and Gemini CLI workspace requests use the same staged validator and checkpoints as API assistants. Short explanations and non-workspace requests can still use bulk text responses.

For restart validation, stop a workspace generation after at least one file is validated, restart FDO, and reopen the same plugin. Saved generation work should offer Resume unfinished generation, Retry with smaller scope using saved helpers, and Discard. Resume prepares a request for explicit Submit; completed helpers should not be requested again. Change a workspace file before resuming and confirm recovery is blocked without overwriting the newer edit. If the original request had a screenshot, reattach the same image for resume; smaller-scope replanning can use a new reference. A saved guide that you edit during resume requires replanning instead of continuing with its old plan.

## CLI setup and platform validation

Codex skills can be configured in Settings → AI Extensions → Codex → Skills. Import an instruction-only SKILL.md with YAML `name` and `description`, select one or more saved Codex assistant entries, and save assignments. Enabled assigned skills initially expose only bounded names and descriptions in the private Codex home. Full instructions load for an explicit skill mention or a host-validated on-demand request by the model. Each staged step resets to metadata plus the user’s explicit selections; automatically selected instructions do not carry into unrelated files. Progress distinguishes available metadata from loaded instructions. On-demand loading requires an additional CLI inference call for that step, within the existing request budgets, timeouts, and cancellation controls. Disabling a skill or removing an assignment affects the next generation, not one already running. Resume refuses changed skill selections; restore the assignments or replan with smaller scope. Imported skill files are separate from the plugin workspace’s generated /SKILL.md approval guide. MCP Tools and Hooks are placeholders and do not execute anything in this version. Supporting resources and scripts are not imported.

In the Coding Agent prompt, type `$` or a lowercase skill-name prefix to open assigned-skill suggestions. Choose with Tab or a click; Escape dismisses the list and Enter retains normal textarea behavior. Literal variables such as `$HOME`, `$myVariable`, `${NAME}`, `$<variable>`, quoted strings, and Markdown code do not become skill suggestions or errors. Completing a skill preserves other text and variables in the prompt, including follow-ups. Unknown dollar tokens are never resolved or expanded by FDO. Skill descriptions are displayed as plain text, even when they contain dollar variables.

Codex is integrated into FDO: Settings, model discovery, authentication, and generation use the bundled native runtime. No separate Codex installation is required. Packages must include the matching native x64/arm64 binary for macOS, Linux, or Windows. The beforePack hook rejects a release missing its target runtime; when cross-building, stage that target’s optional @openai/codex platform package under dist/main/node_modules/@openai before packaging.

Gemini CLI is an external tool, not an FDO dependency. Install and authenticate it separately with `npm install -g @google/gemini-cli` and `gemini`, then select Gemini CLI in Settings. FDO requires version 0.60.0 or later. Leave Executable Path empty for PATH discovery, or select the installed entry point. If an older saved assistant points inside FDO’s former Gemini bundle, clear that path and save it again. Windows npm `.cmd` shims resolve to the package’s JavaScript bin; prompts are sent over stdin without a command shell. See the [official Gemini installation guide](https://geminicli.com/docs/get-started/installation/).

A staged CLI generation shares one private authentication session across its file requests, checks for changed logins before continuing, and preserves runtime-refreshed credentials without restoring a removed login. CLI generation uses a temporary home and empty working directory with model tools disabled; it does not inherit user MCP servers, extensions, shell configuration, or unrelated environment credentials. This portable tool policy is not an OS process sandbox. Bundled Codex on macOS additionally uses sandbox-exec to deny reads of protected host paths. Gemini’s tool allowlist and deny policy follow its [configuration](https://geminicli.com/docs/reference/configuration/) and [policy engine](https://geminicli.com/docs/reference/policy-engine/) contracts. FDO owns validation, guide review, application, and checkpoint recovery.

Run the manual recovery checklist with each CLI on each shipping OS: approve SKILL.md, stop after one validated file, restart FDO, resume, and confirm completed files are reused. Test missing Gemini installation and expired authentication separately; setup errors must remain actionable and must not change workspace files. Windows and Linux launcher branches are covered by unit fixtures, but native runtime/terminal smoke tests still need to run on those systems before release.

### Progressive skill disclosure checks

Run `node scripts/check-codex-skill-disclosure.cjs` for an offline native-runtime check using a localhost mock endpoint and no authentication. It verifies that full skill bodies are absent initially, only the requested body is included after loading, and bodies disappear again for the next step. Run `npm run test:ai:isolation` separately to check skill access under the macOS process sandbox; that sandbox deliberately blocks localhost.

With a real provider, assign two skills with different scopes. Confirm ordinary tasks begin with a metadata catalog, explicit `$skill-name` loads only the named skill without a selection round trip, and an implicit selection logs the specific loaded names. Control responses must not appear in the response, file previews, or generated code. Stop during loading and confirm no changes are applied. Unknown or unassigned names cannot be loaded, and repeated requests stop after bounded recovery. Use `$fdo-skill-smoke-test` explicitly for the activation-marker check; enabling a skill makes it available rather than forcing its instructions into every answer.
