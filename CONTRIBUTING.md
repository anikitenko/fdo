# Contributing to FDO

Contributions to FDO (FlexDevOps) are welcome: bug reports, documentation,
accessibility improvements, plugin examples, tests, and application changes.
For a substantial feature or a change to plugin contracts, open an issue first
so we can discuss the behavior and scope before implementation.

## Choose the right repository

- [FDO](https://github.com/anikitenko/fdo): the Electron host, editor, CLI,
  permissions, desktop integration, and website.
- [FDO SDK](https://github.com/anikitenko/fdo-sdk): SDK APIs and
  [SDK examples](https://github.com/anikitenko/fdo-sdk/tree/main/examples).
- [FDO plugins](https://github.com/anikitenko/fdo-plugins): example plugins and a
  collection you can use through FDO's GitOps integration. See the
  [GitOps guide](docs/GITOPS.md) for collection configuration.

## Report a bug or suggest a feature

Search [existing issues](https://github.com/anikitenko/fdo/issues) before opening
a new one. For a bug, include the FDO version, operating system and architecture,
steps to reproduce, expected behavior, and actual behavior. Add relevant logs or
screenshots, with credentials and private data removed. For CLI problems, include
the command, exit status, and relevant `fdo doctor` output. For plugin problems,
identify the plugin and SDK version and provide a small reproducer if possible.

For a feature request, describe the workflow you want to improve and a concrete
example of the desired behavior.

For accessibility barriers and review guidance, see [ACCESSIBILITY.md](ACCESSIBILITY.md).

Do not publish vulnerabilities, private keys, access tokens, or sensitive logs in
an issue. Follow the [security policy](SECURITY.md) for private reporting.

## Set up the application

Use Git, npm, and Node.js **24.11 or newer**; Node 24 matches `.nvmrc` and CI.
Fork the repository on GitHub, clone your fork, and create a branch for your work.
From the checkout root:

```bash
# If you use nvm
nvm install
nvm use

npm ci
npm run dev
```

`npm run dev` builds and watches the main process, preload, and renderer, then
launches Electron. Restart it when a change requires restarting the main process.
Use `npm run build` for a production build. Website-only work has a separate,
dependency-free preview described below.

## Find your way around

| Location                                 | Purpose                                        |
| ---------------------------------------- | ---------------------------------------------- |
| `src/main.js`, `src/bootstrap_main.js`   | Application startup and CLI/profile bootstrap  |
| `src/components/`                        | Desktop UI and editor                          |
| `src/ipc/`                               | Main/renderer IPC handlers and channels        |
| `src/utils/system/`                      | CLI and operating-system integration           |
| `src/utils/plugins/`                     | Plugin authoring, security, and runtime        |
| `tests/unit/`, `tests/components/`       | Jest unit and component tests                  |
| `tests/e2e/`                             | Playwright and Electron scenarios              |
| `website/`, `scripts/website/`           | Public site and its preview/staging tools      |
| `.github/workflows/`, `scripts/release/` | CI, packaging, and release automation          |
| `docs/`                                  | Architecture, behavior, and development guides |

## Make and verify a change

Keep each pull request focused. Match the surrounding code style and avoid
unrelated refactoring or formatting. Update documentation when commands,
permissions, SDK contracts, or user-visible behavior change. If dependencies
change, update both `package.json` and `package-lock.json` and explain why the
dependency is needed.

Start with the tests that cover the affected behavior. Add a regression test for
a bug when it can reliably reproduce the failure; favor observable behavior over
implementation details. Do not weaken assertions or remove safety checks just to
make a test pass.

```bash
# A focused unit suite; substitute the suite relevant to your change
npm run test:unit -- tests/unit/fdo-cli.test.js --runInBand

# All unit and component suites
npm run test:unit

# Build before running Electron tests
npm run build
npx playwright install chromium
npm run test:e2e -- tests/e2e/cli.spec.js --workers=1 --retries=0

# Broader deterministic checks used by CI
npm run test:e2e:ci
npm run test:e2e:fixtures:matrix

# Dependency audit, especially when dependency files change
npm run check:dependencies
```

Do not rebuild while Electron tests are running. On Linux, install the browser
dependencies with `npx playwright install --with-deps chromium`. Electron tests
also need `gnome-keyring`, `libsecret-tools`, `libglib2.0-bin`, `dbus-x11`, and
`xvfb`. Run them through the isolated display and credential-store wrapper:

```bash
bash scripts/run-linux-e2e.sh npm run test:e2e -- tests/e2e/cli.spec.js --workers=1 --retries=0
```

Automatic CI does not use live AI providers. Real-provider tests require explicit
configuration and may spend credits; see the
[live AI testing guide](tests/e2e/live-ai-scenarios/README.md) before running them.
The `npm run lint` script is currently a placeholder; it is not evidence that a
change passes static analysis. Check affected files with your IDE as well as
running the relevant tests.

## Plugin and SDK changes

Start from the built-in templates or the linked example repositories. With the
desktop CLI enabled in **Settings → General**, a typical local workflow is:

```bash
fdo init ./my-plugin --template blank
fdo validate ./my-plugin
fdo test ./my-plugin --json
fdo dev ./my-plugin
```

Review declared capabilities and request only the access the plugin needs. Use
the SDK's host-mediated actions for privileged operations and preserve signing,
scope checks, and user approvals. New plugins require activation and capability
approval in the desktop app after deployment. See the
[capability model](docs/PLUGIN_CAPABILITY_MODEL.md),
[SDK/host boundary](docs/SDK_HOST_BOUNDARY.md), and
[CLI guide](website/cli.html).

## Website contributions

The website is plain HTML, CSS, and JavaScript. With Node installed, no application
dependency installation or Electron build is needed:

```bash
npm run website:dev
# Open http://127.0.0.1:4173
npm run website:check
```

Check desktop and mobile layouts, keyboard navigation, image alternatives, and
links. Use genuine app captures for product screenshots. Keep the local CLI guide
consistent with the README and the actual command behavior. Add new public assets
to the explicit file list in `scripts/website/site.cjs`; only listed files deploy.
See the [website guide](website/README.md) for more details.

Website-only pushes and pull requests skip App UI Tests when all changed paths
are in `website/`, `scripts/website/`, or `.github/workflows/website.yml`. The
Website workflow validates those changes and deploys changes on `main`. Mixed
application/website changes still run App UI Tests; scheduled, manual,
merge-queue, and release-invoked application checks remain enabled.

## Open a pull request

Target `main`. Explain the problem, the resulting behavior, and how you verified
the change. Link related issues and include before/after screenshots for visual
changes. State which commands passed and any checks you could not run. Draft
pull requests are welcome for work in progress.

Before requesting review:

- Keep the diff focused and remove temporary debugging code and generated output.
- Ensure relevant tests pass and documentation reflects the final behavior.
- Exclude credentials, signing identities, local profiles, and private data.
- Call out compatibility changes, migrations, and platform-specific limitations.

Use a descriptive title, for example `fix: preserve plugin grants during CLI
deployment` or `docs: clarify GitOps collection setup`. Maintainers use labels
such as `feature`, `bug`, `security`, `dependencies`, and `documentation` to group
the automatically generated release notes.

Review AI-assisted contributions as carefully as any other code. Check SDK APIs,
permissions, dependencies, and test results yourself before submitting.

Version bumps, release tags, publishing, and signing credentials are handled by
maintainers. Ordinary contributions do not need a version bump or release tag;
see the [release process](README.md#releases) for how releases are assembled.

Keep discussions respectful and focused on the change. FDO declares the MIT
license; contributions should be compatible with the project's license.
