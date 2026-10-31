# Exporting a plugin as a web application

Manage Plugins → **Export As…** has two formats:

- **FDO plugin archive** preserves the project and compiled desktop bundle.
- **Standalone web application / Docker** converts authored source into an
  independent frontend and backend. The archive includes Docker/Compose files,
  templates for ECS Fargate, Azure Container Apps and Google Cloud Run, converted
  source, a dependency lockfile, configuration examples and deployment instructions.

The web project installs neither Electron nor the FDO SDK package. The exporter
compiles the installed public SDK ABI into `runtime/contract.cjs`, removes the private
desktop communicator, and binds registration, rendering and handlers to its own HTTP
backend. This preserves custom stores, metadata validation and the public helper
surface. License notices are included. It never connects back to desktop FDO.

## Run the exported project

Extract the ZIP and run:

```sh
sh start.sh
```

This generates `.env` once and runs `docker compose up --build`. Read the private
`.env` file to sign in as `engineer` at http://localhost:8080. Existing access and
encryption keys are preserved. Without a local Node installation, setup runs through
the Compose `setup` profile. On Windows use `docker compose --profile setup run --rm
setup`, then `docker compose up --build`.

Every successful application export includes `Dockerfile`, `docker-compose.yml`,
`setup.cjs`, `start.sh`, frontend, backend, converted source, a pinned lockfile and
cloud deployment templates. Configuration requirements do not produce a documentation-only ZIP.

## CLI dependencies and authentication

[Plugin deployment tools](PLUGIN_DEPLOYMENT_TOOLS.md) defines optional
`fdo.deployment.tools`, package/artifact installers and digest-pinned custom images.
The export now includes `deployment/toolchain.json` and `tools.cjs`; image builds
install and verify declared dependencies, and record actual versions in an image-local
receipt. `node tools.cjs check` diagnoses missing or incompatible tools. Process scope
alternatives are not blindly installed. Authentication happens at runtime, separately
from installation; Azure CLI state persists under `/data/azure`. Use a one-off Compose
command for login if initialization needs Azure before the web server can start.

## Contract and deployment configuration

Compatibility is evaluated against the current FDO/SDK/API facts and the declared
requirements. The export embeds a snapshot of the host contract and approved
policies; it does not weaken an incompatible API requirement or approve permissions.
Standard authored, namespace, CommonJS and compatible compiled entries are accepted.
Standard embedded webpack SDK modules are rebound to the public web contract.
Unrecognized embedded formats require source or a standard CommonJS build.

Review reads and bundles source without executing plugin constructors or handlers.
Static capability declarations are inspected; dynamic declarations use only the
existing approved grants and are validated before initialization in the exported
backend. Imported runtime files are analyzed; unimported smoke tooling is excluded.

`deployment/application.json` records contract versions and capability policies.
`deployment/services.json` configures deployment resources independently:

| Family | Standalone implementation / setup |
|---|---|
| UI, registered actions, custom stores | Compiled public ABI and authenticated HTTP frontend/backend |
| Memory / JSON storage | Original store lifecycle; persistent `/data` volume |
| Secrets and SSH profiles | Atomic AES-256-GCM service vault, injected `WEB_APP_SECRET_KEY` |
| HTTP, WebSocket, TCP, UDP, DNS | Transport and destination policy checks; deployment egress still applies |
| Scoped commands | Existing host validators, shell-free bounded execution, browser approval |
| Filesystem operations | Existing validators, scope roots mapped to isolated deployment volumes |
| SSH exec, live status, terminals | Existing host service core, cancellation/quotas, enrolled profiles and pinned host keys |
| AI | Configured OpenAI-compatible API assistants, key environment variable, optional protocol gateway |
| Auth/session broker | Existing checked public protocol; fresh login, memory-only sessions |
| Tray | Browser action menu invoking the same plugin handlers |
| Clipboard / external links | Browser APIs and validated HTTP(S) navigation |
| Sudo / X11 | Explicit privileged-service/display infrastructure; no automatic privilege elevation or browser desktop |

Scoped executables are validated against the original allowlist before a deployment
executable mapping is applied. Argument, environment, timeout and confirmation
restrictions remain in force. Desktop filesystem/working-directory roots map to
isolated `/data/scopes/root-*` directories; requests and policy roots are translated
together. Mount actual project/configuration data there as needed. Credentials and
desktop data are absent. Command output is bounded; approval expires and is bound
to the requesting browser view.

Azure scopes include Azure CLI 2.91.0 in the image. Authenticate it separately using
managed/workload identity or `docker compose exec application az login --use-device-code`;
its configuration lives under `/data/azure`. Do not copy desktop login caches.
Other binaries must be installed in Dockerfile and mapped under `executables`.

SSH setup uses `sshProfiles` and `secretEnvironment` (credential name → injected
environment variable name). AI setup uses `aiAssistants` records with `id`, `name`,
`model`, `purpose`, `provider`, `default`, `endpoint` and `apiKeyEnvironment`.
An optional HTTPS `gateway.url` receives `{pluginId, handler, content}` and returns
the public result envelope; authenticate it with `WEB_APP_GATEWAY_TOKEN`. Elevation
requires a confirmed gateway operation returning `{ok:true, stdout:string}`.

Version compatibility defines public protocol compatibility. It cannot install an
arbitrary binary, translate native OS code, create cloud IAM roles, supply credentials,
or provide an X11 display. Such deployment resources remain explicit configuration.
Unsupported source/bundle formats and unapproved permissions still produce concrete
errors; operations never become silent no-ops. The runtime is for a trusted workspace,
not a security sandbox for hostile Node code or a multi-tenant service.

See the generated README and cloud templates for ECS Fargate, Azure Container Apps
and Cloud Run. Use one replica/active writer per data volume and stop the old revision
before replacing it. Mount durable storage and back up the encryption key separately.

## Snapshot and archive boundaries

Review tokens belong to the requesting window and installed plugin and expire
after ten minutes. Export re-reads source and grants and rejects changed fingerprints.
Renderer-supplied paths, source and permission overrides are ignored. A native
Save As dialog controls the destination; atomic writes prevent partial archives.
Canceled saves leave no output.

Web output contains converted source, not installed desktop runtime/data. Environment
files, dependencies, Git history, logs, credential files and signatures are absent
from the generated image. Authored literals still require normal source-publication
review for credentials.

## Running and deployment

The exported README contains per-project instructions:

1. Run `sh start.sh` with Docker Compose 2.24 or newer; setup creates a private `.env`
   once. Manual setup may instead copy `.env.example` and configure a username and
   random password of at least 24 characters.
2. For credentials, inject `WEB_APP_SECRET_KEY`: base64 encoding of 32 random bytes.
   Keep this key in your secret manager and back it up separately from the volume.
3. Run `docker compose up --build`. Local ingress binds to `127.0.0.1:8080`.
4. Build/push the image and customize the cloud template. Configure TLS, image pull
   identity, secret access, networking and persistent storage. Set `WEB_APP_ORIGIN`
   to the public HTTPS origin for request validation.

The non-root image listens on `0.0.0.0:$PORT`, exposes liveness/readiness endpoints,
and handles SIGTERM. A separate backend process isolates stalled handlers; timeouts
stop it and readiness fails. Export never accesses cloud accounts or deploys resources.

The application is one trusted workspace with shared backend state and application
sign-in. It is not a multi-tenant service. File-backed state requires a persistent
volume and one writer. Cloud revisions can overlap despite a maximum instance count
of one: stop the old writer before handing its volume to a replacement. Adopt
transactional managed state and per-user authorization before horizontal scaling.
Destination checks are application safeguards; configure cloud egress independently.

The templates follow [ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html),
[Container Apps templates](https://learn.microsoft.com/en-us/azure/container-apps/azure-resource-manager-api-spec)
and the [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).
They contain explicit placeholders and do not provision their dependencies.

## Versioning and maintenance

`contracts/web-export.json` versions conversion independently of the desktop
`contracts/plugin-host.json`. An exporter change alone does not bump desktop API
or handshake versions.

- Patch: compatible converter/runtime fixes with unchanged API and policy meaning.
- Minor: optional adapters, configuration or HTTP API additions.
- Major: incompatible API, configuration, persistence or permission semantics;
  provide migration instructions and tests for existing exported apps.

SDK updates do not automatically change this version. Test the public ABI compiler and
generated apps against the new installed artifact. Changed artifact formats or
host-dependent helpers block conversion until the converter is updated.

`contracts/web-export-runtime-lock.json` pins the generated esbuild/Babel/SSH dependency
closure. Refresh it when those host dependencies change; drift tests enforce this.
The main build emits browser libraries and raw templates under `export-runtime/`.
Raw templates prevent desktop bundlers from rewriting generated dependencies.
CSS style maps become adjacent `.css.cjs` modules; after editing original styles,
update those maps or adopt the application's own web styling pipeline.

Tests cover capability coverage, dialog behavior, native saves, review ownership
and an independent browser app that installs without SDK/Electron, rebuilds,
executes actions, encrypts credentials and retains state across restart.

## Recovery

Configuration requirements (CLI login, volume contents, SSH profiles, AI provider
keys, deployment display infrastructure) belong in the runnable exported project.
They do not disable **Export web application**. After editing source, run
`npm run build`; after changing image tools run `docker compose up --build`.

An incompatible declared API, missing permission, invalid source or unrecognized
embedded bundle still requires correction. Review the concrete report, adjust
permissions explicitly or rebuild/deploy the corrected plugin source, then review
again. The optional migration work package remains available for those genuine
source/permission failures; it is not the primary result for configured capabilities.

Export does not change installed source, grants or desktop data. Discarding an export
requires no desktop rollback. Keep generated projects in version control and retain
a backup of their data volume and encryption key before upgrades.

## Azure FinOps verification

The installed GitOps Azure FinOps & Resource Manager exports with its existing scoped
requests. The standalone host retains argument/executable/environment/cwd policies,
confirmation and bounded output/time. Azure CLI is installed in the image. Demo
navigation runs without Azure; real account operations require a fresh deployment
identity and the intended tenant/subscription RBAC permissions.

Browser regression coverage launches a generated app without installed SDK/Electron,
rebuilds it, exercises actions/charts, checks encrypted persistence after restart,
and executes a fake local CLI through the real scoped host adapter. It verifies
approval isolation, cancellation, forbidden executables and forbidden arguments.
No cloud resources are mutated by these checks.
