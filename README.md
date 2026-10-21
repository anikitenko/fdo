# FDO (FlexDevOps)

FDO (Flex DevOps) is a modular, plugin-driven DevOps platform built with ElectronJS and React. It empowers developers and SREs to extend core functionality using secure, versioned plugins, offering tools for automation, deployment, monitoring, and workflow customization — all from a unified desktop environment.

## Features

- **Plugin System**: Modular architecture with secure, versioned plugins
- **Code Editor**: Built-in Monaco-based editor for plugin development
- **AI Coding Agent**: Intelligent coding assistant integrated into the editor (NEW!)
- **Live UI**: IDE-connected UI preview, source selection, batched component/text/CSS editing with Undo/Redo, reviewed apply and restore points
- **Certificate Management**: Built-in PKI for plugin signing and trust
- **SDK**: Comprehensive SDK for building plugins with rich UI capabilities

## Website

The public homepage is maintained in [`website/`](website/README.md) and deploys
to GitHub Pages independently of desktop releases. Preview it with
`npm run website:dev` and validate it with `npm run website:check`. See the
[website setup guide](website/README.md) for the custom-domain configuration.

## AI Coding Agent

The AI Coding Agent provides intelligent coding assistance directly in the FDO editor:

- **Generate Code**: Create new code from natural language descriptions
- **Edit Code**: Modify selected code with AI-powered suggestions
- **Explain Code**: Get detailed explanations of code functionality
- **Fix Code**: Debug and repair code with AI assistance

The AI agent is **FDO SDK-aware** and understands plugin architecture, helping you build better plugins faster.

[Learn more about the AI Coding Agent](docs/AI_CODING_AGENT.md)

## Quick Start

Use Node.js 24.11 or newer (CI uses Node.js 24).

```bash
# Install and select the project's Node.js version
nvm install
nvm use

# Install the locked dependencies
npm ci

# Development mode
npm run dev

# Build for production
npm run build

# Package application
npm run package
```

Linux CI runs Electron tests through `bash scripts/run-linux-e2e.sh <command>`.
The wrapper starts Xvfb and an isolated GNOME keyring on a private D-Bus session,
then verifies `gnome_libsecret` encryption through the same Playwright launch as the suite.
The test preload restores Secret Service after Playwright's plaintext password-store override.
It requires `gnome-keyring`, `libsecret-tools`, `libglib2.0-bin`, `dbus-x11`, and `xvfb`.

## Releases

The **Release Matrix** workflow validates the source, runs the full reusable App UI
Tests workflow, builds on native macOS arm64/x64, Linux x64, and Windows x64
runners, and tests each packaged application before assembling a release. Windows
installers are included unsigned while Windows signing remains unconfigured. It
publishes only after all four builds pass and their nine installer/archive files
have been verified. The publisher alone has release-write permission;
electron-builder publishing is disabled. Release actions and quality-gate actions
are pinned to commit SHAs.

Push a `v<package version>` tag from a commit already merged into the repository's
default branch. `package.json`, the lockfile version and its root package version
must match the tag exactly. For a first prerelease, update the version first:

```bash
npm version 1.0.0-rc.1 --no-git-tag-version
npm run release:check
```

Commit and merge the version files together with the release changes. Then tag the
merged commit and push that tag:

```bash
git tag -a v1.0.0-rc.1 -m "FDO 1.0.0-rc.1"
git push origin v1.0.0-rc.1
```

A version with a SemVer prerelease suffix produces a GitHub prerelease and does not
change Latest. A stable version requires signing and notarization, must increase
the latest published stable version, and becomes Latest. A manual workflow run on
a branch is a build-only rehearsal: it uploads verified Actions artifacts without
signing or creating a GitHub Release. A manual run on a release tag follows the
same publishing rules as a tag push.

Release notes are generated automatically using GitHub's PR changelog categories
in [.github/release.yml](.github/release.yml), plus a linked commit history and full
comparison link. This includes direct commits and handles the first release.
Use PR labels such as `feature`, `bug`, `security`, `breaking-change`,
`dependencies` and `documentation` for grouping. `skip-changelog` excludes a PR
from GitHub's categorized section; the complete commit history remains available.
No manually maintained changelog file is required.

Each release includes `SHA256SUMS`, `release-manifest.json` and GitHub build-provenance
attestations. The manifest records source commit, platforms, hashes and signing
status. A draft is created first, all assets are uploaded and checked, then the
draft is published. Failed uploads leave an unpublished draft. Re-run the failed
job to resume a draft from the same source; matching uploaded bytes are reused.
Published releases are never overwritten. If a tag moves, source validation fails.
Protect `v*` tags against updates/deletion in repository rulesets and keep the
default branch protected.

### Signing setup

Configure these GitHub Actions repository secrets before the first stable release:

| Platform                                 | Secrets                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| macOS signing                            | `MAC_CSC_LINK` (base64 Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD` |
| Apple notarization, API key              | `APPLE_API_KEY_BASE64` (base64 `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`   |
| Apple notarization, Apple ID alternative | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`                      |

Choose one Apple notarization authentication method. Signing secrets are available
only to signing-readiness/package steps on tag runs, and each OS receives only its
own credentials. Temporary Apple key files are removed after packaging. The build
checks macOS signatures, stapled notarization and Gatekeeper assessment. Windows
signing will be configured when Windows releases resume. These settings use
[electron-builder v26's signing configuration](https://www.electron.build/v26/docs/features/code-signing/).

Prereleases may be unsigned when credentials have not been configured. Their
release notes explicitly identify unsigned desktop builds; OS download protections
may block them. Provenance attestations establish build origin and do not replace
OS code signing. Repository policies may need to allow artifact attestations and
workflow release writes. No personal access token is required.

Local distributable scripts use `--publish=never`. The `publish` npm script invokes
the workflow-owned publisher and requires its verified artifact directory and
release metadata; the supported release entry point is the tag workflow. Native
installer installation on clean machines and real signing credentials must still
be exercised before declaring the first stable release.

## Terminal commands

Enable the `fdo` command in **Settings → General**. After moving FDO or switching
between a development and packaged build, use **Repair command** there. Open a
new terminal after installation; if a user-directory fallback was selected, add
its `bin` directory to your shell's PATH.

```bash
fdo --help
fdo --version
fdo open
fdo init ./my-plugin --template blank
fdo doctor
fdo profiles list --json
fdo plugins list
fdo plugins info my-plugin --json
fdo plugins verify --json
fdo plugins logs my-plugin --follow
fdo dev ./my-plugin
fdo test ./my-plugin --json
fdo validate ./my-plugin
fdo compile ./my-plugin
fdo sign list
fdo sign plugin ./my-plugin --label root
fdo deploy ./my-plugin --dry-run --json
fdo deploy ./my-plugin --label root
fdo sdk migrate --target ./my-plugin
fdo sdk migrate --target ./my-plugin --write
```

`test <path>` runs the same workspace test runner as the editor, with TypeScript
and CSS support and structured results under `--json`. It returns nonzero for
failed tests, compilation errors or no tests found. Test files use `node:test` and
`node:assert/strict`; dependencies come from the host runtime. Tests execute from a
temporary workspace and do not write build artifacts to the original directory.
`--timeout <seconds>` sets the per-file timeout (default 30, range 1–3600).

`profiles list` reports default and named profile locations, installed plugin
counts and the current profile. It does not initialize other profiles' settings or
certificates. A corrupt registry is reported on its own row and gives a nonzero
exit status; other profiles remain visible.

`plugins logs <id>` prints recent runtime logs for an installed plugin in the
selected profile. `--lines <count>` controls the initial lines per file (default
100, range 0–10000), bounded to 64 KiB per file and the latest 20 files.
`--follow` polls for appends, truncation and rotation until Ctrl+C. Use
`--follow --lines 0` for new output only. One-shot output supports `--json`;
follow mode streams text. Missing log files are an empty result; unknown plugin
IDs fail. Symlinked log files are skipped and symlinked log directories are refused.

CLI compile/sign/deploy operations on the same workspace are serialized. Concurrent
CLI deployments also serialize registry commits, preserving other plugin entries
and existing grants. Locks are released by the OS if a CLI process crashes; a busy
operation is retried for up to 30 seconds. GUI and GitOps registry edits do not use these CLI locks.

If signing or registry registration fails after compilation, deployment restores
the previous bundle, signature, signing metadata and ignore file, removing newly
created artifacts. Authored source edits are preserved. A newly created signing
identity remains available. GUI refresh happens only after a successful registry
commit; refresh failure does not undo an installed plugin. Rollback covers caught
operation failures, not forced termination or power loss.

`init <path>` creates a workspace from the same templates as the editor, including
source, styles, tests and the development guide. The destination must be new or
empty; existing files are preserved. The plugin ID defaults to the directory name
normalized to lowercase words separated by hyphens. Override it with `--name <id>`
and set a UI title with `--display-name <title>`. Use `fdo init --help` for template
names. Initialization does not install npm dependencies, sign, deploy or activate
the plugin. Follow it with `fdo validate <path>` and `fdo dev <path>`.

`plugins verify [id]` checks one installed plugin, or all installed plugins when
no ID is supplied. It returns `0` only when at least one plugin was checked and all
signatures are valid. Invalid/missing signatures, unknown IDs and an empty registry
return nonzero, making the command suitable for CI. JSON results include `valid`,
`checked`, and per-plugin signature results under `data`. Unlike `plugins info`,
this command treats an invalid signature as a command failure.

Select an isolated profile with `--profile <name>` **before the command**:

```bash
fdo --profile development dev ./my-plugin
fdo --profile development plugins list --json
fdo --profile development open
```

The default profile keeps its existing location. Named profiles live under
`<default userData>/profiles/<name>` and have separate settings, plugin registry,
signing identities, browser sessions and GUI instance locks. Names contain 1–48
lowercase letters, digits, underscores or hyphens and start with a letter or digit.
`--profile default` selects the original profile. Each profile requires its own
activation and capability approvals. Plugin workspace files are shared when you
reuse the same directory; signing in another profile replaces that workspace's
signature. Use a separate checkout per profile when both need valid signed copies.

Generate completion scripts (FDO does not edit your shell startup files):

```bash
# Bash: source this file from ~/.bashrc or ~/.bash_profile
fdo completion bash > ~/.fdo-completion.bash
source ~/.fdo-completion.bash

# Zsh: source after compinit in ~/.zshrc
fdo completion zsh > ~/.fdo-completion.zsh
source ~/.fdo-completion.zsh

# Fish
mkdir -p ~/.config/fish/completions
fdo completion fish > ~/.config/fish/completions/fdo.fish
```

For PowerShell 7+, run `fdo completion powershell > "$HOME/fdo-completion.ps1"`,
then dot-source that file from `$PROFILE`:
`. "$HOME/fdo-completion.ps1"`. Completions include commands, options and
subcommands; Bash/Zsh also explicitly complete workspace paths. Profile names,
certificate labels and plugin IDs are entered manually. Completion uses static
scripts so pressing Tab does not launch Electron. `completion` prints script text
and does not support `--json`.

`dev <path>` performs an initial deployment, then watches for changes and rebuilds,
signs and redeploys automatically. Use `--label <label>` to choose a signing identity.
Builds run one at a time, rapid edits are batched, and generated bundles/signing
files are excluded from watching. Source changes made during a build trigger a
subsequent build. Compilation failures preserve the previous bundle and registry;
the running GUI plugin is refreshed only after a successful deployment. Fix the
source to retry. New plugins still require activation and capability approval in
the GUI. GitOps-managed plugins are rejected. Press Ctrl+C to stop; an in-progress
deployment finishes before exit. This command uses content polling (roughly every
500 ms), respects `.fdoignore`, and excludes `dist`, `node_modules` and `.git`.
It does not support `--json`.

`validate` checks the workspace manifest, source/output paths, metadata and SDK
imports through an in-memory build. It also inspects declared capabilities without
executing plugin code. Unsupported capabilities fail validation; declarations that
cannot be evaluated statically produce a warning and `capabilities: null` in JSON.
It does not write a bundle or perform full TypeScript type checking.

`deploy --dry-run` runs validation and reports install/update, target profile and
registry, signing identity, and preserved grants. A missing default root identity
is shown as `will-create`; a missing custom identity, invalid signing certificate,
unavailable credential store, corrupt registry or GitOps-managed target fails the
preview. It does not write plugin artifacts, registry entries or signing identities,
and does not test private-key decryption. Normal Electron startup may initialize
application settings. Actual deployment rechecks signing and target state.

`compile` preserves source and writes a separate CommonJS bundle. `deploy`
compiles, signs, then installs the plugin. On first signing/deployment with the default `root` label, FDO creates
the missing identity in OS-protected storage even if the GUI has never run.
Help, compilation and certificate listing do not create certificates.
New installations have no capability grants and remain inactive;
updates preserve existing grants and refresh an active plugin in the running
GUI. GitOps-managed plugins must be updated through their repository. Custom
certificate labels must already exist; create or import them in
**Settings → Certificates**. Existing identities are preserved. Signing fails
if the OS credential store is locked or unavailable.

Commands run without terminal input, except migration `--write`, which requires
interactive confirmation. Help, version and successful operations return `0`;
invalid commands, compilation, signing and deployment failures return nonzero.
SDK migration returns `2` for invalid targets/arguments and `3` if its SDK helper
is unavailable. Dry-run migration is the default. CLI commands use Electron;
headless Linux runners still need its system libraries and a display such as Xvfb.

`doctor` checks the wrapper, PATH, profile access, registry/activation configuration,
OS credential store availability and default signing certificate. It prints fixes
and returns `1` when any check needs attention, including a missing first-launch
certificate. It does not create an identity or decrypt private keys.

`plugins list` and `plugins info <id>` report saved enablement, granted capabilities
and verified signature status. Enablement reflects configuration; it does not
assert that a GUI worker is currently running. `info` also shows paths and custom
permission scopes. An invalid signature appears in the result; a missing plugin
ID or unreadable registry fails the command.

Use `--json` before or after the command for `doctor`, plugin inspection/verification, one-shot logs, profile listing, `test`, `init`, `validate`, `compile`,
`deploy`, signing commands and SDK migration. Stdout contains one JSON document:
`{ "ok": true, "command": "plugins list", "data": [] }`. Failures return nonzero
and `{ "ok": false, "error": { "message": "...", "code": "..." } }`; doctor
findings use its `data.checks` array instead. Diagnostics go to stderr. Certificate
listing excludes PEM/key material. Help/version retain normal text output;
`open`, `dev` and `completion` do not support JSON. JSON migration writes still require interactive
confirmation, with the prompt sent to stderr.

For a local checkout, run `npm run build` and replace `fdo` with
`npx electron .` in these examples. Run `npm run test:e2e:ci -- tests/e2e/cli.spec.js`
for the native CLI regression suite.

## Plugin Development

Open a `.md` or `.markdown` file in the built-in IDE to switch between **Code**, **Preview**, and **Split** views. Markdown previews follow unsaved edits; switching views preserves Monaco's cursor and undo history.

Create Plugin → **Select folder** inspects local source projects and extracted FDO exports. A compiled export can be installed with its existing signature, or rebuilt from its included source. Source projects use FDO's compiler and default `root` signing certificate; install/build scripts are not executed. Imports preserve source and binary assets, stay inactive with no grants, and never overwrite installed IDs. Fix missing dependencies or metadata in the source folder and select it again if inspection/build fails. URL import is no longer offered here.

If an undeployed saved workspace occupies an ID, **Safe release ID** archives the draft before releasing it. Close its editor first. Expand **Archived drafts** under that ID to restore it when no current draft or installed plugin uses the ID.

Settings → **Credentials & SSH** manages plugin-scoped encrypted credentials and pinned SSH profiles. Plugins adopting SDK 1.8 must request explicit base and operation grants in Manage Plugins. See [host secret and SSH support](docs/HOST_SECRETS_AND_SSH.md) for policies, limits, verification and profile-aware Git. SSH is bundled. Git operations require an installed, allowlisted Git executable and reuse authorized SSH profiles.

FDO uses the [@anikitenko/fdo-sdk](https://github.com/anikitenko/fdo-sdk) for plugin development.

Example plugin:

```typescript
import { FDO_SDK, FDOInterface, PluginMetadata } from "@anikitenko/fdo-sdk";

export default class MyPlugin extends FDO_SDK implements FDOInterface {
    private readonly _metadata: PluginMetadata = {
        name: "My Plugin",
        version: "1.0.0",
        author: "Your Name",
        description: "Plugin description",
        icon: "COG"
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }

    init(): void {
        this.log("Plugin initialized!");
    }

    render(): string {
        return "<div>Hello World</div>";
    }
}
```

Use the AI Coding Agent in the editor to generate plugins automatically!

## Testing

```bash
# Check all dependencies for vulnerabilities and deprecated packages
npm run check:dependencies

# Run unit tests
npm run test:unit

# Run e2e tests
npm run test:e2e

# Build and run Jest tests (does not run Electron E2E tests)
npm test

# Run the deterministic Electron suite used in CI, after building
npm run test:e2e:ci
```

The dependency check includes production and development packages and runs in
both test and release workflows. The local `packages/node-domexception` package
exports Node's native `DOMException` for `fetch-blob`, replacing its deprecated
polyfill without suppressing npm warnings. `packages/babel-current-node-syntax`
replaces Jest's legacy syntax preset: Babel 7.29 and Babel 8 already parse those
standardized features, so the old Babel-7-only syntax plugins are unnecessary.
The Jest runner enables native ESM loading for Babel 8 and TypeScript 7; this
requires Node.js 24.11+. Tests use two workers, recycled at 512 MB, to bound
ESM module memory. Use `npm run test:handles -- path/to/test` to diagnose open
handles in an individual suite. Blueprint
popovers use `PopoverNext` for React 19 compatibility; the `react-popper` override
aligns the unused legacy dependency's peer range with Blueprint's React 19 support.
Monaco's DOMPurify dependency is overridden to a patched release.

Plugin type checking uses TypeScript 7's native API with an in-memory filesystem.
Packaging includes the target platform's `@typescript` compiler binary and checks
that it is present before building distributables.

See [PR/push coverage and local CI commands](docs/CI_TESTING.md) for platform
coverage, required checks, artifacts, and the separate live-provider tests.

Notification history and AI conversations use worker-backed SQLite databases.
The settings schema contains only active configuration: preferences, assistant/provider
configuration, encrypted credentials, and pricing overrides. History is read and written
only through SQLite; obsolete JSON history fields are removed from the settings file.
Certificates live in `certificates.sqlite`. Private keys are encrypted with Electron's
OS-backed `safeStorage` and decrypted only in the main process for signing. Certificate
lists expose public details and key availability, never private keys. Existing settings
certificates are removed only after a verified, transactional migration; an unavailable
credential store leaves the originals intact. Linux's `basic_text` fallback is rejected.

Settings → Observability manages local AI tracing, optional content capture, Langfuse
project credentials, connection testing, retention, and export retries. Environment
variables override their corresponding Langfuse fields and are identified in the panel.
Secret keys are protected by the OS credential store and never returned to the renderer.

`observability.sqlite` stores AI metrics, usage/cost records, CPU/memory samples, startup
events, and encrypted AI traces. Writes are batched in a worker and drained on clean quit.
Usage updates upsert individual requests; captured queries, trace payloads, and diagnostic
details use OS-backed encryption. A five-minute memory buffer supplies live runtime
charts, with samples persisted every ten seconds for history across restarts.
Retention defaults are seven days for runtime samples, thirty days for diagnostics and
traces, and one year for usage (up to 5,000 requests). Counts and recent history appear
in Settings; numerical AI totals are retained independently. Other safety limits are
250,000 runtime samples, 20,000 startup events, 5,000 traces, and 50 recent retrieval misses.

Langfuse exports use OTLP/HTTP with the v4 ingestion header. Encrypted pending work
survives restarts, retries transient failures with exponential backoff (up to eight
attempts), and can be retried manually. Authentication/configuration errors require a
manual retry after correction. Each trace is tied to its original server and public
project key; changing projects never redirects old work. Disabling export pauses it;
retention limits still apply. Prompt/response/tool content capture is off by default.
Old settings metrics and usage data are staged until the SQLite migration commits.
Existing startup logs are imported before removal; their old format lacks wall-clock
dates, so imported entries use the file date and carry an imported marker.

Notifications identify the affected plugin, collection, certificate, or background
service and separate the user-facing outcome from technical details. History sources
include GitOps, Builds, Plugins, Security, AI, Observability, and System. Failures can
link directly to the plugin, its logs, or the relevant Settings page. Runtime and
background incidents group repeated failures and show a recovery only after a prior
failure; ordinary plugin startup and certificate-validity checks remain quiet.
Deployment, plugin installation/removal, and certificate changes retain outcome
records. Form validation, clipboard feedback, and snapshot actions stay local to their
current UI. Notification diagnostics redact common credential forms and private keys.

## Documentation

- [Contributing to FDO](CONTRIBUTING.md)
- [Accessibility goals and reporting](ACCESSIBILITY.md)
- [Security policy and private reporting](SECURITY.md)
- [GitOps repository collections](docs/GITOPS.md)
- [AI Coding Agent Documentation](docs/AI_CODING_AGENT.md)
- [Plugin sidebar, quickbar, and tray actions](docs/PLUGIN_UI_ACTIONS.md)
- [New plugin templates](docs/PLUGIN_TEMPLATES.md)
- [Live UI Editor direction and roadmap](docs/LIVE_UI_EDITOR.md)
- [FDO SDK Repository](https://github.com/anikitenko/fdo-sdk)

## License

MIT
