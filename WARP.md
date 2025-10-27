# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development Commands

### Build and Run
- `npm start` - Start the Electron application in development mode with hot reload
- `npm run build` - Build the application for production
- `npm run package` - Build and package the app using electron-builder
- `npm run dist` - Build platform-specific installers/packages
- `npm run dist:mac` - Build macOS-specific packages (DMG, ZIP)
- `npm run dist:linux` - Build Linux-specific packages (DEB, RPM, AppImage)
- `npm run dist:win` - Build Windows-specific packages (NSIS, Portable)
- `npm run publish` - Build and publish to configured distribution channels

### Development Commands
- `npm run dev` - Start development with file watching
- `npm run build:main` - Build main process only
- `npm run build:preload` - Build preload script only
- `npm run build:renderer` - Build renderer process only

### Testing
- `npm test` - Run Jest tests (located in `tests/` directory)
- `npm test -- tests/components/editor/utils/VirtualFS.test.js` - Run a single test file

### Plugin Development
The application includes a CLI for plugin development:
- `fdo compile <path>` - Compile a plugin at the given path using esbuild
- `fdo deploy <path>` - Compile, sign, and deploy a plugin 
- `fdo deploy <path> --label <cert_label>` - Deploy using a specific certificate

### Linting
Note: Linting is not currently configured (`npm run lint` returns "No linting configured")

## High-Level Architecture

### Core Application Structure
FDO is an **Electron-based desktop application** with a **React frontend** that implements a **secure, plugin-driven DevOps platform**. The architecture follows Electron's main/renderer process model:

#### Main Process (`src/main.js`)
- **Plugin Management**: Loads and manages plugins using `PluginManager` with isolated `utilityProcess` instances
- **Security**: Certificate-based plugin signing and verification system via `Certs` utility
- **CLI Integration**: Built-in CLI commands for plugin development and deployment
- **IPC Handlers**: Manages communication between main and renderer processes through structured channels

#### Renderer Process
- **React App** (`src/App.jsx`): Hash router with three main routes:
  - `/` - Main dashboard (`Home.jsx`)
  - `/editor` - Code editor interface (`EditorPage.jsx`) 
  - `/live-ui` - Live UI components (`LiveUI.jsx`)

### Plugin System Architecture
The core value proposition of FDO is its **modular plugin architecture**:

#### Plugin Lifecycle
1. **Installation**: Plugins installed to `~/.config/FDO/plugins/` (or OS equivalent)
2. **Compilation**: TypeScript/JavaScript plugins compiled using esbuild with virtual filesystem
3. **Signing**: Cryptographic signing using certificates stored in app data
4. **Loading**: Plugins run in isolated utility processes for security
5. **Communication**: IPC-based messaging between plugins and main application

#### Plugin Security
- **Certificate System**: Root CA and plugin-specific certificates for signing/verification
- **Process Isolation**: Each plugin runs in separate utility process
- **Signature Verification**: All plugins verified before loading

### Key Components

#### IPC Communication (`src/ipc/`)
Structured channel system with prefixed namespaces:
- `NotificationChannels` - App notification system
- `PluginChannels` - Plugin lifecycle and communication
- `SettingsChannels` - Application settings (certificates, etc.)
- `SystemChannels` - System-level operations

#### UI Framework
- **Blueprint.js** - Primary UI component library
- **Monaco Editor** - Code editing capabilities
- **React Flow** - Visual workflow/diagram support
- **React Router** - Client-side routing

#### Development Tools
- **esbuild** - Fast plugin compilation with virtual filesystem support
- **webpack** - Main application bundling via Electron Forge
- **Virtual Filesystem** - In-memory file system for plugin development

### Data Management

#### Storage Strategy
- **electron-store** - Settings and configuration persistence
- **JSONORM** - Simple JSON-based ORM for data management
- **UserORM** / **PluginORM** - Specialized ORMs for user and plugin data

#### File Locations
- Plugins: `app.getPath('userData')/plugins/`
- Configuration: `app.getPath('userData')/config.json`
- Plugin Registry: `app.getPath('userData')/plugins.json`

### Build System
- **Electron Builder** for packaging and distribution
- **Webpack** for bundling main process, preload script, and renderer process
- **Multi-platform builds**: macOS (DMG, ZIP), Linux (DEB, RPM, AppImage), Windows (NSIS, Portable)
- **Asset handling**: Icons, CSS, and static assets copied to dist/renderer/assets
- **Development**: Concurrent building with file watching and hot reload
- **Build outputs**: `dist/main/` (main process), `dist/renderer/` (UI assets)

### Security Considerations
- **ASAR packaging** with asset validation
- **Certificate-based signing** for plugin integrity
- **Process isolation** for plugin execution  
- **Content Security Policy** configured for development

The architecture enables extending core DevOps functionality through secure, isolated plugins while maintaining a unified desktop interface for automation, deployment, monitoring, and workflow customization.