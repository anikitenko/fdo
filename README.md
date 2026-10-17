# FDO (FlexDevOps)

FDO (Flex DevOps) is a modular, plugin-driven DevOps platform built with ElectronJS and React. It empowers developers and SREs to extend core functionality using secure, versioned plugins, offering tools for automation, deployment, monitoring, and workflow customization — all from a unified desktop environment.

## Features

- **Plugin System**: Modular architecture with secure, versioned plugins
- **Code Editor**: Built-in Monaco-based editor for plugin development
- **AI Coding Agent**: Intelligent coding assistant integrated into the editor (NEW!)
- **Live UI**: IDE-connected UI preview, source selection, batched component/text/CSS editing with Undo/Redo, reviewed apply and restore points
- **Certificate Management**: Built-in PKI for plugin signing and trust
- **SDK**: Comprehensive SDK for building plugins with rich UI capabilities

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
then verifies Electron's `gnome_libsecret` encryption before running the suite.
It requires `gnome-keyring`, `libsecret-tools`, `libglib2.0-bin`, `dbus-x11`, and `xvfb`.

## Plugin Development

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

- [GitOps repository collections](docs/GITOPS.md)
- [AI Coding Agent Documentation](docs/AI_CODING_AGENT.md)
- [Plugin sidebar, quickbar, and tray actions](docs/PLUGIN_UI_ACTIONS.md)
- [New plugin templates](docs/PLUGIN_TEMPLATES.md)
- [Live UI Editor direction and roadmap](docs/LIVE_UI_EDITOR.md)
- [FDO SDK Repository](https://github.com/anikitenko/fdo-sdk)

## License

MIT
