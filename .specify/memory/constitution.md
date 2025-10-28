<!--
Sync Impact Report

Version change: none → 1.0.0
Created: 2025-10-27
Based on: Project code analysis and stated vision
Modified principles: (new constitution) Plugin-First Architecture; Cryptographic Trust Model; Developer Experience First; Process Isolation; Declarative Metadata; Desktop-Native Platform
Added sections: Core Principles; Technical Foundation; Security Model; Development Workflow; Governance
Removed sections: none
Templates requiring updates:
 - .specify/templates/plan-template.md ⚠ may need plugin development considerations
 - .specify/templates/spec-template.md ⚠ may need security/signing requirements
 - .specify/templates/tasks-template.md ⚠ may need certificate/verification steps
Follow-up TODOs:
 - TODO: Document FDO SDK API surface and versioning strategy
 - TODO: Create plugin developer certification program
 - TODO: Implement plugin registry with incremental updates
 - TODO: Design plugin marketplace/discovery system
-->

# FDO (Flex DevOps) Constitution

**Project Name**: Flex DevOps (FDO)  
**Core Domain**: Modular, Secure, Declarative DevOps Platform  
**Version**: 1.0.0 | **Ratified**: 2025-10-27 | **Last Amended**: 2025-10-27

## Vision

> "A platform where trust is automatic, code is modular, and creativity is never blocked by complexity."

Flex DevOps (FDO) redefines how automation ecosystems evolve by empowering developers to build, share, and run trusted plugins inside a secure, declarative runtime. It balances freedom of innovation with cryptographic trust, and lightweight modularity with consistent governance.

---

## Core Principles

### I. Plugin-First Architecture (NON-NEGOTIABLE)

**All extensibility MUST happen through plugins.** The core application provides runtime, security, and infrastructure; plugins provide features. This is enforced at the architectural level through:

- **Process Isolation**: Each plugin runs in a separate Electron `utilityProcess` with its own memory space
- **IPC Communication**: Plugins communicate with core through structured message channels
- **Lifecycle Management**: Plugins declare `PLUGIN_READY`, `PLUGIN_INIT`, `PLUGIN_RENDER` states
- **No Core Modification**: Adding features never requires modifying the core runtime

**Implementation Evidence**:
- `PluginManager.js` loads plugins as isolated utility processes
- `PluginORM` maintains plugin registry separate from core code
- IPC channels (`PluginChannels`) define plugin/core boundary

**Rationale**: Process isolation prevents plugin failures from crashing the system. Plugins as first-class citizens enable third-party ecosystems without core bloat.

**Enforcement**: 
- New features MUST be evaluated for plugin implementation first
- Core PRs that add feature logic (vs. infrastructure) MUST justify why plugin approach is insufficient
- Plugin SDK MUST provide hooks for common extension points

---

### II. Cryptographic Trust Model (NON-NEGOTIABLE)

**Every plugin MUST be cryptographically signed and verified before execution.** Trust is automatic, transparent, and mandatory. The trust chain is:

```
FDO Root CA (4096-bit RSA)
    ↓ signs
Developer Certificates (issued to plugin authors)
    ↓ signs
Plugin Packages (SHA256 hash + signature)
    ↓ verified by
FDO Runtime (before execution)
```

**Verification Requirements**:
1. **Signature**: Detached signature file (`fdo.signature`) covering all plugin files
2. **Metadata**: JSON manifest (`fdo.meta.json`) with fingerprint, signer info, algorithm
3. **Hash**: SHA256 hash of plugin directory (respecting `.fdoignore`)
4. **Certificate Chain**: Full chain validation against trusted roots
5. **Expiry**: Certificates checked for validity period

**Implementation Evidence**:
- `Certs.js` implements full CA infrastructure (generate, sign, verify)
- `Certs.verifyPlugin()` called before plugin loading in `PluginManager.loadPlugin()`
- node-forge used for RSA-4096, SHA256, X.509 certificates
- Plugin loading fails with notification if verification fails

**Rationale**: Invisible cryptography ensures 100% adoption without friction. Users never manually verify plugins; the system does it automatically.

**Enforcement**:
- Runtime MUST refuse unsigned plugins
- Signing MUST be integrated into build/deploy workflow
- Certificate private keys MUST be stored in OS keychain or secure storage
- Expired certificates MUST trigger renewal warnings 90 days before expiry

---

### III. Developer Experience First (NON-NEGOTIABLE)

**The platform MUST optimize for developer productivity.** This is not aspirational; it's implemented through:

**Built-in Tooling**:
- **CLI**: `fdo compile` and `fdo deploy` handle build and signing automatically
- **Visual Editor**: Full Monaco-based IDE with TypeScript support built into the app
- **Virtual Filesystem**: In-memory FS with versioning, snapshots, and local storage persistence
- **Hot Reload**: Development mode watches files and rebuilds on change
- **esbuild Integration**: Sub-second builds with virtual filesystem plugin

**Metadata as Code**:
```typescript
// Plugins declare metadata inline in source
const metadata = {
  name: "My Plugin",
  version: "1.0.0",
  author: "Developer Name",
  description: "What it does",
  icon: "application"
}
```

**Zero-Config Defaults**:
- Auto-generated `.fdoignore` if not present
- Default TypeScript/React templates
- Automatic node_modules setup in editor
- Monaco language services pre-configured

**Implementation Evidence**:
- `EditorPage.jsx` provides full IDE experience
- `VirtualFS.js` implements versioning with snapshot/restore
- `buildUsingEsbuild()` compiles in-memory without disk writes
- `extractMetadata()` parses inline plugin declarations

**Rationale**: If building plugins is hard, developers won't extend the platform. Friction kills ecosystems.

**Enforcement**:
- Plugin development workflow MUST be testable in < 5 minutes
- Breaking changes to SDK require migration tooling
- New plugin APIs MUST include working examples
- Documentation MUST be written before implementation

---

### IV. Declarative Metadata & SDK (NON-NEGOTIABLE)

**Plugins describe what they do, not how they do it.** The SDK (`@anikitenko/fdo-sdk`) provides a declarative interface for:

- **Identity**: Name, version, author, description, icon (via `PluginMetadata`)
- **Lifecycle**: `init()` and `render()` methods with clear contracts
- **UI Generation**: Server-side HTML generation with DOM builder classes
- **Interactivity**: Message handlers registered declaratively
- **UI Extensions**: Quick actions and side panels via mixins
- **Storage**: Store interface with multiple backends

**Current Implementation**:
```typescript
// Metadata declared in plugin class
private readonly _metadata: PluginMetadata = {
  name: "Plugin Name",
  version: "1.0.0",
  author: "Developer",
  description: "What it does",
  icon: "icon.png"
};

// UI generation is declarative
render(): string {
  const domText = new DOMText();
  return domText.createHText(1, "Hello World");
}

// Handlers registered by name
init(): void {
  PluginRegistry.registerHandler("action", (data) => {
    return this.handleAction(data);
  });
}
```

**SDK Architecture**:
- **Base Class**: `FDO_SDK` with lifecycle hooks
- **Interface**: `FDOInterface` enforces contracts
- **Registry**: `PluginRegistry` for handler routing and store management
- **Communicator**: IPC abstraction for message passing
- **DOM Builders**: 9+ classes for declarative HTML generation
- **Mixins**: Composition pattern for UI extensions
- **Utilities**: Logging, sudo, atomic writes, promise wrappers

**Future Direction** (per stated vision):
- Structured manifest format (JSON Schema validated)
- Permission declarations for filesystem/network access
- SDK version compatibility ranges (`sdkVersion: "^1.0.0"`)
- Inter-plugin dependencies

**Rationale**: Declarative systems are easier to verify, test, and reason about. The SDK hides complexity (IPC, process boundaries, security) while exposing simple, declarative APIs. The runtime makes decisions based on what plugins declare, not what they execute.

**Enforcement**:
- Plugins without valid metadata MUST NOT load
- Plugins MUST extend `FDO_SDK` and implement `FDOInterface`
- Metadata changes require version bump
- Runtime MUST validate metadata before execution
- SDK breaking changes require MAJOR version bump
- Imperative APIs require architectural justification

---

### V. Desktop-Native Platform (NON-NEGOTIABLE)

**FDO is a desktop application first.** Web-based or cloud approaches sacrifice:
- **Security**: Local execution with OS-level security
- **Performance**: Native binaries, no network latency
- **Privacy**: User data never leaves machine
- **Reliability**: Works offline, no service dependencies

**Architecture**:
- **Electron**: Chromium + Node.js for cross-platform desktop
- **Main Process**: Node.js runtime for plugins, IPC, security
- **Renderer Process**: React + Blueprint UI
- **Preload Scripts**: Secure bridge between renderer and main
- **Protocol Handlers**: Custom `static://` protocol for assets

**Platform Support**:
- macOS (DMG, ZIP) - x64 + arm64
- Windows (NSIS, Portable) - x64
- Linux (DEB, RPM, AppImage) - x64

**Implementation Evidence**:
- `main.js` bootstraps Electron app
- `utilityProcess` for plugin isolation
- electron-store for persistent configuration
- electron-builder for platform-specific packages

**Rationale**: Desktop apps provide security, performance, and user control impossible in web contexts. DevOps tools need system access.

**Enforcement**:
- Core features MUST work offline
- Network access MUST be optional
- System integration (sudo, shell) MUST use secure patterns
- User data MUST stay local unless explicitly shared

---

### VI. Process Isolation & Safety by Design (NON-NEGOTIABLE)

**Plugin failures MUST NOT compromise the system.** This is enforced architecturally:

**Isolation Mechanisms**:
- Each plugin = separate Node.js process via `utilityProcess.fork()`
- Plugins communicate only through IPC messages
- Plugin crashes logged but don't affect core or other plugins
- Resource limits enforced by OS process model

**Failure Handling**:
```javascript
child.once("error", (err) => {
    cleanup(); // Remove from loaded plugins
    notify("Plugin error", err); // User notification
});

child.once("exit", (code) => {
    cleanup(); // Graceful removal
    notify("Plugin exited", code);
});
```

**Security Boundaries**:
- Plugins cannot access main window directly
- IPC channels are whitelisted and typed
- File system access goes through validated paths
- Privileged operations (sudo) require user approval

**Implementation Evidence**:
- `PluginManager.loadPlugin()` uses `utilityProcess.fork()` with isolated env
- Cleanup handlers prevent resource leaks
- Error handling doesn't crash main process
- macOS permission dialogs for restricted paths

**Rationale**: Safety must be architectural, not hopeful. A single bad plugin shouldn't bring down the system.

**Enforcement**:
- Plugins MUST run in separate processes (no in-process loading)
- Core MUST handle plugin crashes gracefully
- Privileged operations MUST require explicit user consent
- Audit logs MUST capture security-relevant events

---

### VII. Observability & Transparency (NON-NEGOTIABLE)

**Every significant action MUST be observable.** The system implements:

**Notification System**:
- Queue-based `NotificationCenter` with structured messages
- Plugin lifecycle events logged (loading, ready, error, exit)
- Build/deploy operations emit progress notifications
- Certificate operations (sign, verify) logged

**Audit Trail**:
- Plugin signatures include timestamp and signer identity
- Certificate metadata tracks `createdAt`, `lastUsedAt`, `expiresAt`
- Plugin registry maintains installation history
- Verification failures logged with reason

**Developer Tooling**:
- Build output terminal with structured error messages
- Monaco editor problems panel shows TypeScript errors
- Virtual filesystem versions track change history
- electron-log for structured logging

**Implementation Evidence**:
- `NotificationCenter.js` implements observable notification queue
- `Certs.signPlugin()` creates detailed `fdo.meta.json`
- `virtualFS.notifications` event system for UI updates
- Console logging with styled output in CLI

**Rationale**: You can't fix what you can't see. Observability enables debugging, auditing, and trust.

**Enforcement**:
- Security-relevant events MUST be logged
- User-facing actions MUST provide feedback
- Errors MUST include actionable context
- Logs MUST be queryable for troubleshooting

---

### VIII. Semantic Versioning & Compatibility

**Breaking changes MUST be communicated through versions.** The system follows semver:

- **MAJOR**: Breaking changes to plugin API, SDK, or core contracts
- **MINOR**: New features, backward-compatible additions
- **PATCH**: Bug fixes, documentation updates

**Plugin Metadata**:
```json
{
  "name": "plugin-name",
  "version": "1.2.3",
  "sdkVersion": "^1.0.0"  // Future: SDK compatibility range
}
```

**Compatibility Strategy**:
- Plugins declare SDK version they target
- Runtime validates compatibility at load time
- Deprecation warnings for old APIs
- Migration guides for breaking changes

**Current State**: 
- App version in `package.json`: `1.0.0`
- SDK package: `@anikitenko/fdo-sdk@^1.0.13`
- Plugin versions stored in metadata

**Rationale**: Developers need to know if updating will break their plugins. Semver communicates risk clearly.

**Enforcement**:
- Breaking API changes require MAJOR version bump
- Plugin registry MUST track versions
- Incompatible plugins MUST fail gracefully with version error
- Deprecation period MUST be at least one MAJOR version

---

### IX. Test-First Development (NON-NEGOTIABLE)

**Tests MUST exist before implementation.** This applies to:

**Core Features**:
- Unit tests for utilities (JSONORM, pathHelper, etc.)
- Integration tests for plugin lifecycle
- E2E tests for critical workflows (create, sign, load plugin)

**Plugin Contracts**:
- Contract tests for SDK interfaces
- Breaking changes MUST include backward compatibility tests
- Plugin examples MUST have test coverage

**Current State**:
- Jest configured in `package.json`
- Test file exists: `tests/components/editor/utils/VirtualFS.test.js`
- Test script: `npm test`

**Future Requirements**:
- Pre-merge CI MUST run all tests
- Coverage requirements for new code
- Plugin SDK changes require contract tests

**Rationale**: Tests prevent regressions and enable confident refactoring. Plugin ecosystems die when breaking changes ship unexpectedly.

**Enforcement**:
- PRs touching plugin APIs MUST include tests
- CI MUST fail on test failures
- Coverage MUST NOT decrease
- Test plan required in feature proposals

---

## Technical Foundation

### Application Architecture

**Technology Stack**:
- **Runtime**: Electron 37.2.6 (Chromium + Node.js)
- **UI Framework**: React 18.3.1 + Blueprint.js 6.1.0
- **Editor**: Monaco Editor 0.52.2 with TypeScript support
- **Build System**: webpack 5 + esbuild 0.25.8
- **Cryptography**: node-forge 1.3.1 (RSA-4096, SHA256, X.509)
- **State Management**: React hooks + electron-store
- **Testing**: Jest 30.0.5

**Key Components**:
1. **Main Process** (`src/main.js`): Node.js runtime, plugin management, IPC handlers, CLI
2. **Renderer Process** (`src/App.jsx`): React app with routing, UI components
3. **Preload Scripts** (`src/preload.js`): Secure IPC bridge
4. **Plugin Manager** (`src/utils/PluginManager.js`): Plugin lifecycle, isolation, IPC
5. **Certificate Authority** (`src/utils/certs.js`): CA management, signing, verification
6. **Virtual Filesystem** (`src/components/editor/utils/VirtualFS.js`): In-memory FS with versioning

### Data Model

**Storage Locations**:
- Plugins: `~/.config/FDO/plugins/` (or OS equivalent)
- Configuration: `~/.config/FDO/config.json`
- Plugin Registry: `~/.config/FDO/plugins.json`
- Certificates: electron-store (encrypted OS-specific location)

**ORMs**:
- `JSONORM`: Base class for JSON file persistence
- `PluginORM`: Plugin registry management
- `UserORM`: User preferences and activated plugins

**Plugin Structure**:
```
plugin-uuid/
├── index.ts              # Source code
├── dist/
│   └── index.cjs        # Compiled output
├── package.json          # Metadata and config
├── .fdoignore           # Files to exclude from signing
├── fdo.meta.json        # Signature metadata
└── fdo.signature        # Detached signature (binary)
```

### Security Model

**Certificate Hierarchy**:
1. **Root CA**: Generated locally, 4096-bit RSA, 1-year validity
2. **Developer Certs**: Future: Issued by Root CA for plugin authors
3. **Plugin Signatures**: SHA256 hash + RSA signature

**Signing Process**:
1. Ensure `.fdoignore` exists (auto-generate if missing)
2. Hash plugin directory (SHA256) respecting ignore patterns
3. Sign hash with private key
4. Generate `fdo.meta.json` with fingerprint, timestamp, algorithm
5. Write `fdo.signature` (detached binary)

**Verification Process**:
1. Load `fdo.meta.json` and `fdo.signature`
2. Match certificate by fingerprint
3. Validate certificate chain and expiry
4. Hash plugin directory
5. Verify signature using certificate public key
6. Check hash matches

**Implementation Details**:
- `Certs.generateRootCA()`: Creates self-signed root
- `Certs.signPlugin()`: Signs plugin directory
- `Certs.verifyPlugin()`: Full verification with chain validation
- `Certs.hashPluginDir()`: Recursive SHA256 with ignore patterns

### IPC Architecture

**Structured Channels**:
- `NotificationChannels`: App notifications
- `PluginChannels`: Plugin lifecycle, communication, management
- `SettingsChannels`: Configuration, certificates
- `SystemChannels`: File dialogs, system operations

**Plugin Communication**:
```javascript
// Main → Plugin
plugin.postMessage({ message: "PLUGIN_INIT" });

// Plugin → Main
process.parentPort.postMessage({ 
  type: "PLUGIN_READY",
  response: { /* data */ }
});
```

**Security**:
- IPC channels whitelisted in preload script
- Renderer cannot access Node.js directly
- Context isolation enabled

---

## Development Workflow

### Plugin Development Lifecycle

1. **Create**: Use built-in editor or import existing directory
2. **Develop**: Edit in Monaco with TypeScript, hot reload, versioning
3. **Build**: `fdo compile <path>` or build in editor (esbuild)
4. **Sign**: `fdo deploy <path>` or deploy from editor (automatic)
5. **Install**: Plugin added to registry, UI updates
6. **Activate**: User enables plugin, verification runs
7. **Load**: Plugin spawned as utility process if verified
8. **Run**: Plugin sends PLUGIN_READY, receives PLUGIN_INIT

### Quality Gates

**Pre-Deploy Checklist**:
- [ ] Plugin metadata declared in source
- [ ] TypeScript compiles without errors
- [ ] Plugin signed with valid certificate
- [ ] Signature verification passes
- [ ] No syntax errors in compiled output

**Pre-Release Checklist**:
- [ ] All tests passing
- [ ] Version bumped following semver
- [ ] CHANGELOG updated
- [ ] Release artifacts signed
- [ ] Platform-specific builds tested

### CLI Commands

**Development**:
- `npm start` - Start dev mode with hot reload
- `npm run build` - Production build
- `npm test` - Run Jest tests

**Packaging**:
- `npm run dist:mac` - Build macOS DMG + ZIP
- `npm run dist:linux` - Build DEB, RPM, AppImage
- `npm run dist:win` - Build NSIS, Portable

**Plugin CLI**:
- `fdo compile <path>` - Compile plugin with esbuild
- `fdo deploy <path>` - Compile + sign + install
- `fdo deploy <path> --label <cert>` - Use specific certificate

### Editor Features

**Virtual Filesystem**:
- In-memory file system with Monaco models
- Version history with snapshots
- Local storage persistence
- Undo/redo across snapshots

**Monaco Integration**:
- TypeScript language services
- IntelliSense for FDO SDK
- Problem markers (errors/warnings)
- Go-to-definition, hover info
- Syntax highlighting

**Build System**:
- esbuild with virtual filesystem plugin
- Bundle TypeScript/TSX to CommonJS
- Source maps for debugging
- Sub-second rebuild times

---

## Governance

### Constitution Authority

This constitution governs all technical and architectural decisions for FDO. It supersedes informal practices, preferences, or legacy patterns.

### Amendment Process

1. **Proposal**: Submit PR to `main` branch updating `.specify/memory/constitution.md`
2. **Rationale**: Document why change is needed and what it fixes
3. **Impact Analysis**: Update Sync Impact Report with affected systems
4. **Review Period**: Minimum 7 days for community feedback
5. **Approval**: 
   - Two core maintainers for MINOR/PATCH
   - Unanimous core team for MAJOR (removing NON-NEGOTIABLE principles)
   - Security reviewer for trust model changes
6. **Migration Plan**: Breaking changes require tooling and documentation
7. **Enforcement Update**: Add CI checks or runtime validation if needed

### Versioning Policy

Constitution follows semantic versioning:
- **MAJOR**: Remove or redefine NON-NEGOTIABLE principles
- **MINOR**: Add new principles or expand existing ones
- **PATCH**: Clarify wording without semantic changes

### Compliance

**Enforcement Mechanisms**:
- Code review checklist references constitution
- CI checks validate plugin signatures
- Runtime refuses unsigned/invalid plugins
- Audit logs track security events

**Non-Compliance**:
- PRs violating principles MUST be rejected with explanation
- Exceptions require unanimous core approval + justification
- Security violations result in immediate revert

### Roles & Responsibilities

**Core Maintainers**:
- Enforce constitution in code review
- Approve amendments
- Maintain Root CA infrastructure
- Review security-sensitive changes

**Plugin Developers**:
- Follow SDK contracts
- Sign plugins before distribution
- Respect semver for plugin versions
- Report security issues privately

**Security Reviewers**:
- Audit certificate management
- Review cryptographic code
- Approve trust model changes
- Coordinate vulnerability responses

---

## Appendices

### A. Certificate Management

**Root CA Generation**:
```bash
# In FDO Settings → Certificates
1. Click "Generate Root Certificate"
2. Label: "my-root-ca"
3. Stored in electron-store
4. Valid for 1 year
```

**Certificate Structure**:
```json
{
  "id": "SHA256://base64-fingerprint",
  "label": "my-root-ca",
  "identity": "user@hostname",
  "cert": "-----BEGIN CERTIFICATE-----...",
  "key": "-----BEGIN PRIVATE KEY-----...",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-01T00:00:00.000Z",
  "lastUsedAt": "2025-01-01T00:00:00.000Z",
  "imported": false
}
```

**Certificate Import**:
- Supports PEM format with certificate + optional private key
- Validates expiry and key matching
- Stores in certificate registry

### B. Plugin Manifest Reference

**Current Format** (embedded in source):
```typescript
export const metadata = {
  name: "my-plugin",
  version: "1.0.0",
  author: "Developer Name",
  description: "What this plugin does",
  icon: "application"
};
```

**Future Format** (standalone manifest):
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "developer": "CN=Developer Name,O=Organization",
  "sdkVersion": "^1.0.0",
  "permissions": ["filesystem:read", "network:http"],
  "dependencies": {
    "other-plugin": "^2.0.0"
  },
  "icon": "application",
  "description": "What this plugin does",
  "certificate": "base64-cert",
  "signature": "base64-sig",
  "integrity": "sha256-hash"
}
```

### C. Virtual Filesystem API

**Key Methods**:
```javascript
// File operations
virtualFS.createFile(path, model)
virtualFS.deleteFile(path)
virtualFS.getFileContent(path)
virtualFS.setFileContent(path, content)

// Versioning
virtualFS.fs.create(prevVersion, tabs)  // Snapshot
virtualFS.fs.set(version)               // Restore
virtualFS.fs.list()                     // List versions

// Tree operations
virtualFS.getTreeObjectItemById(id)
virtualFS.setTreeObjectItemBool(id, prop)
virtualFS.updateTreeObjectItem(id, props)

// Tabs
virtualFS.tabs.add(tab, active)
virtualFS.tabs.remove(tab)
virtualFS.tabs.setActiveTab(tab)
virtualFS.tabs.get()

// Notifications
virtualFS.notifications.subscribe(event, callback)
virtualFS.notifications.addToQueue(eventType, data)
```

### D. Build System

**esbuild Configuration**:
```javascript
{
  entryPoints: ["/index.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  plugins: [EsbuildVirtualFsPlugin(virtualData)]
}
```

**Virtual FS Plugin**:
- Resolves imports from in-memory virtual filesystem
- Supports TypeScript, TSX, CSS modules
- Injects FDO SDK types
- No disk I/O during build

### E. FDO SDK API Reference

**SDK Package**: `@anikitenko/fdo-sdk@^1.0.18`

#### Plugin Structure

```typescript
import { FDO_SDK, FDOInterface, PluginMetadata } from "@anikitenko/fdo-sdk";

export default class MyPlugin extends FDO_SDK implements FDOInterface {
  private readonly _metadata: PluginMetadata = {
    name: "My Plugin",
    version: "1.0.0",
    author: "Developer Name",
    description: "Plugin description",
    icon: "icon.png"
  };

  get metadata(): PluginMetadata {
    return this._metadata;
  }

  // Called once on plugin load
  init(): void {
    this.log("Plugin initialized!");
    // Register message handlers
    PluginRegistry.registerHandler("myAction", (data) => {
      return this.handleMyAction(data);
    });
  }

  // Returns HTML string for UI
  render(): string {
    return "<div>Hello World</div>";
  }

  // Optional: JavaScript to run on load
  renderOnLoad(): string {
    return "() => { console.log('Plugin loaded'); }";
  }
}
```

#### Lifecycle Methods

1. **Constructor**: Plugin registered with `PluginRegistry`
2. **init()**: Setup state, register handlers, initialize storage
3. **PLUGIN_READY**: SDK sends ready signal to FDO core
4. **PLUGIN_INIT**: Core requests plugin initialization
5. **PLUGIN_RENDER**: Core requests HTML rendering
6. **UI_MESSAGE**: Bidirectional communication between UI and plugin

#### Message Communication

**Message Types** (from `src/enums.ts`):
- `PLUGIN_READY`: Plugin ready to receive messages
- `PLUGIN_INIT`: Initialize plugin and return quick actions/side panel config
- `PLUGIN_RENDER`: Render plugin UI
- `UI_MESSAGE`: Custom messages with handler routing

**Handler Registration**:
```typescript
PluginRegistry.registerHandler("handlerName", async (data: any) => {
  // Process request
  return { success: true, result: "data" };
});
```

**From UI**:
```javascript
window.fdoSDK.sendMessage('handlerName', { /* data */ });
```

#### UI Generation - DOM Classes

**Text Elements** (`DOMText`):
- `createHText(level, text)` - Headings (h1-h6)
- `createPText(text)` - Paragraphs
- `createStrongText(text)` - Bold text
- `createSpanText(text)` - Inline spans
- `createLabelText(text, forId)` - Form labels

**Buttons** (`DOMButton`):
```typescript
const button = new DOMButton();
button.createButton('Click Me', 
  () => window.fdoSDK.sendMessage('handler', {}),
  { style: { padding: '10px', cursor: 'pointer' } }
);
```

**Forms** (`DOMInput`):
```typescript
const input = new DOMInput("fieldId");
input.createInput("text"); // Text input
input.createTextarea(); // Textarea
input.createSelect(["Option 1", "Option 2"]); // Dropdown
```

**Containers** (`DOMNested`):
```typescript
const nested = new DOMNested();
nested.createBlockDiv([...children], { style: { ... } });
nested.createForm([...formElements]);
nested.createList([...items]); // <ul>
nested.createListItem(['Item content']);
```

**Tables** (`DOMTable`):
```typescript
const table = new DOMTable();
table.createTable([
  table.createTHead([
    table.createTRow([
      table.createTH('Header 1'),
      table.createTH('Header 2')
    ])
  ]),
  table.createTBody([
    table.createTRow([
      table.createTD('Data 1'),
      table.createTD('Data 2')
    ])
  ])
]);
```

**Media** (`DOMMedia`):
```typescript
const media = new DOMMedia();
media.createImage('/path/to/image.png', 'Alt text', {
  style: { width: '100px' }
});
```

**Semantic HTML** (`DOMSemantic`):
- `createArticle()`, `createSection()`, `createNav()`
- `createHeader()`, `createFooter()`, `createAside()`
- `createMain()` - Semantic HTML5 elements

**Styling with Goober**:
```typescript
const dom = new DOM();
const className = dom.createClassFromStyle({
  "background-color": "red",
  "color": "white",
  "padding": "10px",
  "border-radius": "5px"
});

// Use in element
dom.createElement('div', { className }, 'Styled content');
```

#### UI Extensions

**Quick Actions** (keyboard shortcuts/command palette):
```typescript
import { QuickActionMixin, QuickAction } from "@anikitenko/fdo-sdk";

const PluginBase = QuickActionMixin(FDO_SDK);

class MyPlugin extends PluginBase {
  defineQuickActions(): QuickAction[] {
    return [
      {
        name: "Search Plugin Data",
        message_type: "quickSearch",
        subtitle: "Search through plugin data",
        icon: "search.png"
      }
    ];
  }
}
```

**Side Panel** (persistent navigation menu):
```typescript
import { SidePanelMixin, SidePanelConfig } from "@anikitenko/fdo-sdk";

const PluginBase = SidePanelMixin(FDO_SDK);

class MyPlugin extends PluginBase {
  defineSidePanel(): SidePanelConfig {
    return {
      icon: "panel.png",
      label: "My Plugin",
      submenu_list: [
        {
          id: "dashboard",
          name: "Dashboard",
          message_type: "showDashboard"
        }
      ]
    };
  }
}
```

**Combined Mixins**:
```typescript
const PluginBase = SidePanelMixin(QuickActionMixin(FDO_SDK));
```

#### Storage System

**In-Memory Store** (`StoreDefault`):
```typescript
import { PluginRegistry } from "@anikitenko/fdo-sdk";

const store = PluginRegistry.useStore("default");
store.set("key", { data: "value" });
const data = store.get("key");
store.remove("key");
store.clear();
```

**JSON File Store** (`StoreJson`):
```typescript
const store = PluginRegistry.useStore("json");
// Persists to .store.json in plugin directory
store.set("counter", 42);
const counter = store.get("counter");
```

**Custom Store**:
```typescript
import { StoreType } from "@anikitenko/fdo-sdk";

const customStore: StoreType = {
  get: (key) => { /* implementation */ },
  set: (key, value) => { /* implementation */ },
  remove: (key) => { /* implementation */ },
  clear: () => { /* implementation */ },
  has: (key) => { /* implementation */ },
  keys: () => { /* implementation */ }
};

PluginRegistry.registerStore("custom", customStore);
```

#### Utilities

**Logging** (Winston-based):
```typescript
this.log("Info message"); // Uses winston logger
this.error(new Error("Error message"));
```

**Sudo Execution**:
```typescript
import { runWithSudo } from "@anikitenko/fdo-sdk";

const result = await runWithSudo("command", ["arg1", "arg2"], {
  name: "My Plugin"
});
```

**Atomic File Writes**:
```typescript
import { atomicWriteFile, atomicWriteFileSync } from "@anikitenko/fdo-sdk";

await atomicWriteFile("/path/to/file", "content", "utf-8");
atomicWriteFileSync("/path/to/file", "content", "utf-8");
```

**Promise Utilities**:
```typescript
import { pify } from "@anikitenko/fdo-sdk";

const asyncFn = pify(callbackFn);
const result = await asyncFn(arg);
```

#### Error Handling

**Error Handler Decorator** (`@ErrorHandler`):
```typescript
import { ErrorHandler } from "@anikitenko/fdo-sdk/decorators";

class MyPlugin extends FDO_SDK {
  @ErrorHandler((error, context) => {
    console.error('Error in method:', error);
    return { success: false, error: error.message };
  })
  async handleAction(data: any) {
    // Method implementation
  }
}
```

#### Testing

**Jest Integration**:
```typescript
import MyPlugin from "../src/MyPlugin";

describe("MyPlugin", () => {
  let plugin: MyPlugin;

  beforeEach(() => {
    plugin = new MyPlugin();
  });

  test("should initialize correctly", () => {
    expect(plugin.metadata.name).toBe("My Plugin");
  });

  test("should render HTML", () => {
    const html = plugin.render();
    expect(html).toContain("<div>");
  });
});
```

**Coverage**: Jest with full test suite (see `fdo-sdk/tests/`)

#### Examples

**Complete Examples** (in `fdo-sdk/examples/`):
1. `01-basic-plugin.ts` - Minimal plugin structure
2. `02-interactive-plugin.ts` - Buttons, forms, handlers
3. `03-persistence-plugin.ts` - Storage system usage
4. `04-ui-extensions-plugin.ts` - Quick actions & side panels
5. `05-advanced-dom-plugin.ts` - Complex UI with styling
6. `06-error-handling-plugin.ts` - Error decorators

### F. Related Documents

**SDK Documentation**:
- SDK README: `/fdo-sdk/README.md`
- Examples: `/fdo-sdk/examples/`
- Test Suite: `/fdo-sdk/tests/`
- API Types: `/fdo-sdk/src/types.ts`

**Future Documentation**:
- Security Incident Response Plan (TODO)
- Certificate Application Process (TODO)
- Registry Protocol Specification (TODO)
- Plugin Marketplace Guidelines (TODO)

**Current Resources**:
- FDO README: `/fdo/README.md`
- FDO WARP: `/fdo/WARP.md`
- SDK Package: `@anikitenko/fdo-sdk@^1.0.18`
- Homepage: https://plugins.fdo.alexvwan.me

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0   | 2025-10-27 | Initial constitution based on codebase analysis |
|         |            | Added comprehensive SDK API reference |
|         |            | Documented plugin lifecycle, DOM classes, storage |
|         |            | Included examples from fdo-sdk repository |

---

*This constitution represents the architectural principles and technical commitments of the FDO project. It is derived from the actual implementation patterns found in the codebase (fdo + fdo-sdk) and aligned with the stated vision. It evolves with the project while maintaining core identity.*
