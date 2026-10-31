# Deployment requirements in AI Coding and Live UI

Every engineer sees the same **Deployment requirements** assessment in AI Coding
and Live UI. It uses the current workspace source and the running host's tool catalog,
not an installed plugin's old manifest or version numbers copied into the UI.

The assessment keeps four distinct checks visible:

| Check                  | What the editor can establish                                        |
|------------------------|----------------------------------------------------------------------|
| Source declaration     | Validate package.json fdo.deployment and trace static CLI references |
| Installed tools        | Not run in the editor; the exported image installs/probes them       |
| CLI authentication     | Not verified by source/build/preview; authenticate in deployment     |
| Resource authorization | Not verified here; configure cloud roles and permitted resources     |

A tool mentioned in a permitted process scope is not automatically a required
dependency. Source defaults are suggestions; literal SDK process calls provide
stronger evidence. Dynamic commands, unknown binaries and unavailable source remain
explicit engineer decisions. Nothing is downloaded, authenticated or granted during
assessment, static preview or declaration editing.

## Engineer workflow

1. In AI Coding, open **Deployment requirements**. Read the detected source paths,
   declared tools and unverified checks. **Manage in Live UI** opens the owning
   workspace's deployment section. **Open package.json** is the direct source route.
2. In Live UI's **Inspector → Deployment requirements**, choose **Review detected tools**
   or **Manage deployment requirements**.
   Select catalog tools and version constraints, or define a custom Debian package,
   platform-specific checksum-pinned artifact, or executable provided by a pinned
   Node/Debian image. The UI validates the same schema as the exporter.
3. Choose **Preview deployment changes**. Inspect the package-only diff. Apply, Undo,
   Redo or discard it using the ordinary Live UI draft controls. Drafts have source
   revision checks, local recovery and restore points. Support policy, scripts,
   dependencies, source code and capability grants cannot change through this editor.
   Deployment metadata can be reviewed even when a custom render path has no preview.
4. To involve AI, choose **Prepare AI deployment review**. Live UI selects the current
   package in its owning IDE and prepares a workspace review prompt. Existing engineer
   prompt text is preserved. The composer previews a workspace deployment review rather
   than a selection edit. No AI/provider request is sent until the engineer submits.
5. Rebuild/redeploy the plugin, then **Manage Plugins → Export As → Standalone web
   application / Docker**. Build the exported image and run `node tools.cjs check` in
   the deployment. Installation results and authentication are not inferred from the
   source checks shown in either editor.

## AI behavior

The host supplies deployment assessment and catalog facts on every coding request;
this is not dependent on a lucky documentation search. Staged generation and the
final candidate apply gate validate tool metadata as well as source/SDK contracts.
CLI-backed scaffolds must include the actual dependency declaration. New CLI code
cannot silently apply without its metadata. Read-only workspace review includes host
source findings for invalid or uncovered declarations, while runtime setup remains a
separate limitation or engineer decision.

AI may use justified catalog requirements. It must preserve required tools and must
not weaken version constraints to silence installer checks. It preserves image
pins and custom installer definitions. Removing requirements to silence a diagnostic,
inventing artifact URLs/checksums, or changing a custom installer/base image is rejected
at apply time and directed to the Live UI review workflow. Editing object formatting
alone is not an installer change. This validation cannot establish publisher trust,
installed binaries, a working login or cloud RBAC.

Missing credentials or cloud roles are not source fixes. AI must not disable working
operations, add automatic login to render/init, copy desktop caches, embed secrets,
or widen capability scopes to make a review look successful. Known source declaration
issues can enter normal Review & Repair; unknown/dynamic dependencies require an
engineer's concrete decision. Each generated change still uses the standard diff,
validation and restore workflow.

## Authentication

When Azure CLI is detected or declared, both editors show host-catalog authentication
guidance. For a running exported service:

```sh
docker compose exec application az login --use-device-code
docker compose exec application az account set --subscription "<subscription-id>"
docker compose exec application az account show
```

If the app needs Azure before startup, use `docker compose run --rm --no-deps
application` with these CLI commands, then start the service. CLI state is under
`/data/azure`; it is sensitive and separate from the application vault. Application
sign-in and CLI identity are different. Unattended deployments need an attached
managed identity or an explicitly configured service principal/federated identity,
with the required resource roles. No editor status claims this has been completed.

See [tool schema and installer examples](PLUGIN_DEPLOYMENT_TOOLS.md),
[web export](WEB_APPLICATION_EXPORT.md) and [host versioning](PLUGIN_HOST_CONTRACT.md).
Tool/deployment authoring does not change desktop host API versions or grant semantics.
