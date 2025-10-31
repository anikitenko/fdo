---
applyTo: '**'
---
# Copilot Instructions for AI Coding Agents

These are practical, project-specific notes to help AI agents be productive immediately in this repo.

## Big picture
- FDO is an Electron 37.x + React 18.3 app built with Webpack 5. Output lives in `dist/` and is packaged by `electron-builder` into `release/` (ASAR enabled).
- Entry points: main (`src/main.js` → `dist/main/index.js`), preload (`src/preload.js` → `dist/main/preload.js`), renderer (`src/renderer.js` → `dist/renderer/index.html`). Plugin host page: `src/plugin_host.html` + `src/renderer_plugin_host.js`.
- Specs-driven development: each change lives under `specs/<id>-<name>/` with plan/spec/tasks. Reference the relevant spec when editing code (e.g., 002/003 for ASAR, 006 editor close, 008 e2e tests).

## Key flows and boundaries
- Main process (`src/main.js`): creates the BrowserWindow, wires custom protocols, logs startup metrics, and exposes CLI commands. In dev it loads from `dist/renderer/index.html`; in packaged mode it resolves via `process.resourcesPath`.
- Preload (`src/preload.js`): the only bridge to IPC. It exposes a stable API on `window.electron` grouped by feature areas: `startup`, `notifications`, `settings.certificates`, `system`, `plugin`.
- Renderer (`src/App.jsx`, `src/Home.jsx`): uses `window.electron.*` for all side effects. React Router routes: `/` Home, `/editor`, `/live-ui`.
- IPC channels are centralized in `src/ipc/channels.js` using `withPrefix()`. Example: `StartupChannels.LOG_METRIC` pairs with `window.electron.startup.logMetric(event, meta)`.
- Custom protocols: `static://` serves built assets; `plugin://` serves `plugin_host.html` and related assets via `getPluginFilePath()`.

## window.electron surface (examples)
- Startup metrics from renderer: `window.electron.startup.logMetric('renderer-process-start')` (see `src/renderer.js` and `src/ipc/channels.js`).
- Notifications: `window.electron.notifications.get()` and subscribe via `window.electron.notifications.on.updated(cb)`; update UI like in `src/Home.jsx`.
- Settings → certificates: `window.electron.settings.certificates.create()`, `renew(label)`, etc.
- System: `openEditorWindow(data)`, `openLiveUiWindow(data)`, `getModuleFiles()`, `confirmEditorCloseApproved()`; events `on.confirmEditorClose(cb)`/`on.confirmEditorReload(cb)`.
- Plugins: activation lifecycle `activate(id)`, `deactivate(id)`, `getAll()`, plus events `on.ready(cb)`, `on.init(cb)`, `on.unloaded(cb)`, `on.deployFromEditor(cb)` used extensively in `src/Home.jsx`.

## Plugin system highlights
- Manager: `src/utils/PluginManager` loads plugins on app ready and tracks the main window; persistence via `PluginORM` (`plugins.json` in userData).
- Editor/deploy flow: CLI `deploy <path>` writes a signal file and triggers `PluginChannels.on_off.DEPLOY_FROM_EDITOR` to the renderer; renderer reacts in `Home.jsx` to refresh/activate.
- Signing/certs: `src/utils/certs` manages CA; on startup root cert is validated/renewed with user notifications.

## Local development and builds
- Start dev (watch main/preload/renderer and launch Electron): `npm run dev` (uses concurrently + wait-on to ensure `dist/main/index.js` and `dist/main/preload.js` exist).
- Production build: `npm run build` (runs `build:main`, `build:preload`, `build:renderer`). Analyze bundles: `npm run build:analyze`.
- Package installers: `npm run package` or platform targets `dist:mac|linux|win`. electron-builder config is in `package.json > build` (outputs to `release/`).

## Testing
- Unit: Jest (`npm run test` or `test:unit`) with `jest.setup.js` mocking `electron`. `pretest` builds the app first.
- E2E: Playwright (`npm run test:e2e`), tests in `tests/e2e/` with `workers: 1`. Global setup adds a 1s delay.
- Lint: `npm run lint` is a placeholder (no linter configured yet).

## ASAR and native deps (packaging gotchas)
- Main webpack copies runtime deps into `dist/main/node_modules` (esbuild, @esbuild, @anikitenko/fdo-sdk) via `CopyWebpackPlugin` (see `webpack.main.config.js`).
- electron-builder marks these as extra resources to land in `app.asar.unpacked` (see `package.json > build.extraResources`). Keep both lists in sync when touching ASAR-related work (see specs 002 and 003).

## Where to look first
- IPC contracts: `src/ipc/channels.js` and their usage in `src/preload.js` and `src/main.js`.
- Renderer patterns: `src/Home.jsx` for plugin lifecycle, notifications, and command palette; styles via `*.module.scss`.
- Build configs: `webpack.*.config.js` for targets/entries and asset copying; `package.json` scripts for workflows.
- Specs: `specs/*` are the single source of truth for feature intent and verification steps.

Questions or missing details? Point to the exact file/flow you’re extending, and we’ll expand these notes accordingly.

## BlueprintJS v6 usage
- CSS imports live in `src/renderer.js`: `normalize.css`, `@blueprintjs/core/lib/css/blueprint.css`, and `@blueprintjs/icons/lib/css/blueprint-icons.css` (icons CSS is required for `<Icon>` and icon strings).
- Use the v6 class prefix `bp6-`; apply dark theme by putting `bp6-dark` on a top-level container (see `src/Home.jsx`).
- Common components in use: `Navbar`, `Button`, `Icon`, `InputGroup`, `Tag`, `HotkeysTarget` (see `Home.jsx`). Icons can be passed as strings, e.g. `<Icon icon="share" size={16} />` or `leftIcon="search"` on inputs.
- Toaster pattern: use the shared wrapper in `src/components/AppToaster.jsx`. Example from `Home.jsx`: `(await AppToaster).show({ message: '...', intent: 'danger' })` for errors.
- Styling: keep Blueprint classes intact and layer app styles via SCSS (e.g., `Home.module.scss`) combined with `classNames(...)`.
- Bundling: Blueprint assets are split into a dedicated chunk via `cacheGroups.blueprint` in `webpack.renderer.config.js` to keep vendor size predictable.
