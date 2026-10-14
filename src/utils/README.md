# Shared utilities

Utilities are grouped by the responsibility they own. Filenames stay descriptive so you can find a module by searching for its feature or function name. Import the module directly; there is no root barrel export that loads unrelated Electron, SDK, or provider code.

## Directory map

| Directory | Responsibility and examples |
| --- | --- |
| `ai/assistant/` | Assistant presentation and policy: progress, confidence, failures, instructions, input capabilities, chat statistics, tray state. |
| `ai/providers/` | Provider clients, model catalog, request/stream adapters, retry policy, and provider-specific configuration. See its [provider guide](ai/providers/README.md). |
| `ai/billing/` | Usage ledger, model pricing, and billing catalog. |
| `ai/codex/` | Bundled Codex runtime, invocation, models, skills, hooks, and Codex MCP configuration. |
| `ai/mcp/` | MCP connections, OAuth, discovery, and runtime bridge. |
| `ai/generation/` | Coding request orchestration, streaming deadlines, checkpoints, recovery prompts, response budgets, and Gemini CLI invocation. |
| `ai/testing/` | Live-provider test budgets, policy, and assistant evaluation. |
| `plugins/authoring/` | Plugin guides, proposal/review transport, acceptance criteria, scaffolding, and scenario catalog. |
| `plugins/validation/` | Generated source analysis, dependency contracts, workspace validation, and focused code repairs. |
| `plugins/runtime/` | Plugin loading and lifecycle, runtime bundles/build artifacts, diagnostics, tests, host service bridges, UI actions, and tracing. |
| `plugins/security/` | Plugin isolation, trust, capabilities, privileged actions, and filesystem/process/network scope registries. |
| `sdk/` | Installed SDK discovery and knowledge, host contracts, handshake compatibility, workspace type checking, and migration. |
| `esbuild/` | Build integration, including the virtual filesystem plugin. CSS extraction/composition remains under `src/components/editor/utils/`. |
| `desktop/` | Electron windows, assistant window policy, IPC reply routing, and notifications. |
| `filesystem/` | File reads/writes, path handling, directory trees, and ignore rules. |
| `persistence/` | JSON-backed storage, user/plugin ORM, and application store. |
| `packages/` | Package update orchestration; `update/` contains analysis, validation, execution, and reporting helpers. |
| `presentation/` | Shared formatting, icons, emoticons, and capability/error presentation. |
| `network/` | General network primitives such as fetch with a timeout. |
| `system/` | CLI installation/commands, certificates, asset lookup, startup metrics, elevated execution, and stdio handling. |

## Where to add code

- A provider protocol change belongs in `ai/providers/`; a generation retry or checkpoint change belongs in `ai/generation/`.
- A rule about generated plugin source belongs in `plugins/validation/`; a rule about what plugins may execute belongs in `plugins/security/`.
- SDK discovery and compatibility belong in `sdk/`. Plugin guide content and its approval flow belong in `plugins/authoring/`.
- Keep component-specific UI logic beside its component. Put code here when it serves shared infrastructure or multiple callers.
- Add to an existing responsibility before creating a new directory. Avoid adding loose files at this level.

## Import and runtime boundaries

Directory grouping does **not** imply that every module is safe in every process. Several modules use Electron, Node filesystem/process APIs, native CLI runtimes, or SDK initialization. Check a module's dependencies before importing it in a renderer. Pure formatting and source-analysis helpers should remain free of host initialization.

Use direct relative imports, for example:

```js
import {formatElapsedDuration} from '../utils/presentation/formatElapsedDuration';
```

Keep `.cjs` extensions when importing CommonJS policy/provider modules. Avoid compatibility re-exports at old paths: update callers, Jest mocks, script entry points, package side-effect declarations, and documentation together.

Webpack emits main-process modules into `dist/main` with native `__dirname` behavior. Runtime paths to preloads, bundled CLIs, and copied SDK packages refer to the **build output**, not this source directory hierarchy. Do not adjust those paths solely because a source file moved.

## Verification

Run Jest directly to check imports and behavior without the `npm test` prebuild:

```sh
npx jest --runInBand
npm run build:main
npm run build:preload
npm run build:renderer
```

Tests remain in `tests/unit/` and `tests/components/`; scripts remain in `scripts/`. Neither needs to mirror this directory tree. Live-provider tests are separate and require their configured provider credentials.
