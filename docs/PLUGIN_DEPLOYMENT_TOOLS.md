# Plugin deployment tools

Deployment tooling is shared with AI Coding and Live UI: see [Deployment authoring workflow](DEPLOYMENT_AUTHORING.md) for source review, tool editing, authentication and recovery.

Host capabilities authorize operations; they do not describe binary dependencies.
A process allowlist may contain several interchangeable tools and platform paths.
The exporter must not install that entire allowlist or assume that a network grant
requires curl. Declare actual CLI requirements separately in plugin package.json:

```json
{
  "fdo": {
    "deployment": {
      "schemaVersion": 1,
      "tools": [
        {"id": "azure-cli", "version": "^2.91.0"},
        {"id": "jq", "version": ">=1.6 <2"}
      ]
    }
  }
}
```

An explicit tools array is the plugin's complete dependency intent. An empty array
means no additional CLI dependencies. Tool declarations do not add capability grants,
relax argument policies or copy credentials. `fdo.deployment` belongs to web-export
contract 2.1; desktop host API/handshake versions remain independent.

The host-owned catalog is `contracts/web-export-tools.json`. Catalog tools use known
executables, version probes and installers. Legacy plugins with a single command
family in an approved scope can be inferred. Ambiguous scopes require an explicit
list; unknown tools require an installer definition. These requirements appear in
Export As and the generated `deployment/toolchain.json`; configuration is editable
there, or in plugin package.json followed by a new export.

## Custom Debian package

```json
{
  "id": "postgres-client",
  "command": "psql",
  "version": ">=15 <16",
  "executable": "/usr/bin/psql",
  "versionArgs": ["--version"],
  "installer": {"type": "apt", "packages": ["postgresql-client-15"]}
}
```

The base is Debian bookworm. Packages come from configured signed repositories;
package strings are passed as arguments, never as shell snippets. Use a full
`package=debian-version` for an exact pin where available. Dependency availability
in a process scope does not itself select a package or authorize execution.

## Custom executable artifact

This example is a template: replace URLs and SHA256 values with verified release
artifacts from the tool publisher. Do not export placeholder hashes as valid tools.

```json
{
  "id": "example-tool",
  "command": "example-tool",
  "version": "1.2.3",
  "versionArgs": ["--version"],
  "installer": {
    "type": "artifact",
    "platforms": {
      "linux/amd64": {
        "url": "https://publisher.example/releases/1.2.3/tool-linux-amd64.tar.gz",
        "sha256": "REPLACE_WITH_VERIFIED_SHA256",
        "format": "tar.gz",
        "member": "bin/example-tool"
      },
      "linux/arm64": {
        "url": "https://publisher.example/releases/1.2.3/tool-linux-arm64",
        "sha256": "REPLACE_WITH_VERIFIED_SHA256",
        "format": "file"
      }
    }
  }
}
```

Supported formats are `file`, `tar.gz` and `zip`. Each platform has its own public
HTTPS URL and SHA-256 digest. One archive member is streamed to a fixed executable
path under `/opt/fdo-tools/bin`; archive paths are never extracted into the image.
If a tool needs libraries, declare their Debian packages as additional requirements
or choose a suitable packaged tool. A multi-file SDK distribution is not equivalent
to a standalone binary. The installer rejects missing platforms, checksum mismatch,
ambiguous archive members and version mismatch. It does not execute remote shell
installer scripts. Installers run only when the engineer builds the generated image,
not during desktop review/export.

## Multi-file tools and custom images

For SDK distributions needing several binaries, plugins, libraries or a publisher
installer, prepare a Node 24 / Debian bookworm image in your own image pipeline.
Pin its OCI digest using `fdo.deployment.baseImage` and declare its tools as provided:

```json
{
  "fdo": {
    "deployment": {
      "schemaVersion": 1,
      "baseImage": "registry.example/team/node24-cloud-tools@sha256:REPLACE_WITH_IMAGE_DIGEST",
      "tools": [{
        "id": "google-cloud-cli",
        "command": "gcloud",
        "version": ">=500 <600",
        "executable": "/opt/google-cloud-sdk/bin/gcloud",
        "versionArgs": ["--version"],
        "installer": {"type": "provided"}
      }]
    }
  }
}
```

Replace the digest placeholder with the actual 64-character SHA-256 digest. The
image must include Node, npm and the node user from the normal base. The export
still verifies each executable and version; `provided` is not a verification bypass.
This route supports multi-file CLIs without guessing or executing arbitrary publisher
install scripts during desktop export. Cloud images still require separate identity
and resource authorization at runtime.

## Verification and recovery

`Dockerfile` runs `node tools.cjs install` before building the application. It installs
selected dependencies, verifies version constraints, and writes an image-local
`deployment/toolchain.lock.json` receipt. Runtime startup rechecks a built image's
tools before initializing the plugin. Use `node tools.cjs check` or
`docker compose exec application node tools.cjs check` to inspect diagnostics.

If tools are unresolved, update the declaration/recipe and export again, or complete
the generated toolchain.json. Then rebuild with `docker compose build` and restart.
For an unsupported CPU architecture, add an artifact for that platform or deliberately
build for a supported platform. Distribution-managed packages resolve at build time;
retain the image digest and receipt, or pin exact packages/artifacts for repeatable
rebuilds. Version probes accept semver ranges and normalize standard numeric CLI
versions; use `*` when a CLI does not publish a compatible numeric version.

CLI installation, CLI authentication, application sign-in and cloud RBAC are separate
steps. Azure device-code login runs inside the service container and stores its cache
under `/data/azure`. For headless deployments, configure managed identity or a service
principal/federated credential in the deployment startup process. No login or cloud
mutation is performed during export or image build. CLI caches can contain credentials;
treat their volume as sensitive independently of the encrypted application vault.
