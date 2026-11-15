# Signed plugin export

FDO has one built-in official registry and supports organization private registries. Settings → Certificates obtains the official root certificate automatically and checks it against the fingerprint bundled with the FDO release. The official registry is https://plugins.fdo.alexvwan.me. Organization connections use their own HTTPS origins and independently supplied root SHA-256 fingerprints. They reuse the same validation, encrypted key storage, signing, export and lifecycle services. See [private registry deployment and onboarding](PRIVATE_REGISTRIES.md) for AWS, Azure, GCP and Vault examples.

1. Generate your developer signing identity in your registry profile.
2. In Settings → Certificates, import the downloaded developer certificate chain and matching private key. FDO validates the chain, validity, code-signing usage and key match, then protects the private key with the OS credential store.
3. In Manage Plugins → Export As, choose the normal **FDO plugin archive (.zip)** and export. Choose the signing certificate in the shared signing dialog, including when only one is available. A remembered session choice can be reused. There is no registry-specific export format.
4. Upload that ZIP on the registry website. It checks the signature using the certificate already stored for your signed-in account. Review the extracted metadata, choose a category for a new plugin, accept source-sharing consent and publish. No pasted JSON, separate signature upload or browser private key is needed for signed exports.

The ZIP contains source files plus `fdo.meta.json` and binary `fdo.signature`. Metadata uses `format: "fdo-registry-v1"`, SHA-256 file hashes keyed by exact relative path, signer public-key fingerprint, signing time and algorithm identifiers. RSA PKCS#1 v1.5/SHA-256 signs the recursively key-sorted canonical metadata JSON. Every source file, including `.fdoignore`, must be present exactly as listed; extra, missing, renamed or modified files fail verification. The ZIP contains no developer certificate or private key. A signer fingerprint is only a reference: trust comes from the authenticated account's server-stored registry-issued certificate.

The registry verifies the account certificate against its configured root and issuer, checks its active/revoked status, verifies the signature, and binds inspection/reservation to the exact ZIP SHA-256 and size. It rechecks status before reserving and promoting the release. Category remains registry-managed; source metadata, declared capabilities and compatibility are extracted from signed source. Existing browser signing remains available for unsigned source ZIPs. Legacy local directory signatures are a different format and are not accepted as registry signatures.

When signing with an imported developer identity, export honors `.fdoignore` and excludes build output, dependencies, stale local signing files and common credential files before creating a fresh registry signature. With a root certificate selected, the archive is signed using the same local directory signer as the editor. With no signing identities available, export preserves the existing files and local signature. Export does not modify the installed plugin. Registry source policy and static checks remain authoritative. A verified registry signature never grants capabilities or bypasses execution approval. Organization identities appear in the same signing dialog with their private registry name; they cannot be substituted for an identity from a different registry.

# CLI and local publishing checks

```sh
fdo sign import-root ./shared-root.crt
fdo sign import-developer ./developer-chain.pem ./developer.key
fdo sign list --json
fdo validate ./publishing-source --publishing --json
fdo sign archive ./publishing-source --certificate 'registry:<id-from-sign-list>' --output ./release.zip
# Existing editor-format local signing also accepts the developer selector:
fdo sign plugin ./workspace --label 'registry:<id-from-sign-list>'
# Organization registries reuse these commands with a scoped selector:
fdo sign registry list --json
fdo sign import-developer ./developer-chain.pem ./developer.key --registry 'org-<connection-id>'
fdo sign archive ./publishing-source --certificate 'organization:<id-from-sign-list>' --output ./private-release.zip
```

Root and developer imports are explicit. The developer command accepts the chain
and key together, in either file order, or a combined PEM. These commands use the
same validation and OS-protected key storage as Settings. `sign list` returns only
public identity metadata and reusable selectors. No private key or PEM certificate
is printed. Profiles use the existing `fdo --profile <name> ...` convention.

`validate --publishing` is a read-only source preflight. `sign archive` repeats that
check before accessing a signing key, then uses the existing registry lifecycle,
revocation, RSA signing and ZIP logic shared with Export As. It creates a new ZIP
without modifying the workspace or overwriting an existing output. Import and
signing can prompt for OS credential-store access. The commands never upload or
publish: upload the result through your registry account for final validation.
Local directory signatures from `sign plugin` are for local execution; they are
not a replacement for the registry ZIP signature from `sign archive`.

The public source-policy validators are included in
`src/utils/plugins/publishing/registryPolicy`, with SHA-256 provenance. They were
synchronized from the private production registry repository. Access to that
repository is not required to build FDO, run publishing preflight, or implement a
compatible server. `registry:check-policy` and `registry:sync-policy` are maintainer
tools requiring that private checkout; they are not self-hosting setup steps. A dedicated
parser package pins the registry's TypeScript AST API separately from FDO's native
compiler. There is no runtime dependency on the sibling checkout and no AWS code
is copied or executed.

The check covers source paths/types/UTF-8, file and size limits, static metadata and
capability extraction, allowed package fields/dependencies, compatibility ranges
and reserved placeholder IDs. Signing also enforces the final ZIP size. Registry
account ownership, release availability, authenticated status, signature validation
and server-side scans remain authoritative; a local pass does not promise upload
acceptance. Fix one reported metadata/package error and re-run to reveal the next.
Keep a publishing copy when development scripts or dependencies are needed locally.

`declareCapabilities()` is derived statically; plugin and SDK code never run. Accepted
values are string literals, `const`/readonly constants, spreads of those, and SDK
helpers imported from `@anikitenko/fdo-sdk` with constant arguments (for example
`createCapabilityBundle`, `create*CapabilityBundle`, `create*ScopeCapability`,
`createOperatorToolCapabilityPreset`, `sharedLogicCapability`). The body may hold only
`const` declarations followed by one `return`. `createNetworkCapabilityBundle` accepts
the no-argument form, a transport array, or `{transports, scopeId}` with any SDK
transport (`https`, `http`, `websocket`, `tcp`, `udp`, `dns`).

Network access in source needs `system.network`, the transport capability and a
`system.network.scope.<id>` capability: `fetch` (http/https) and `WebSocket`
(websocket) outside UI handlers, and imports of `net`/`tls` (tcp), `dgram` (udp),
`dns` (dns), `http` (http) and `https`/`http2` (https). Other Node built-ins stay
blocked. Failed checks list numbered "How to fix" steps for these cases.

The coding agent receives the public publishing workflow for generic and publishing
requests. For supplied workspaces it also receives concrete source-policy diagnostics,
without profile data or signing keys. Those diagnostics are advisory for generic
edits and must not cause unrelated package changes. Signing and upload remain
explicit developer actions.

# Automatic lifecycle and deployment

The official registry's maintainers provision and renew its root and issuer certificates with separate non-exportable KMS keys. FDO never downloads private CA keys. `registry:sync-trust` updates the official registry's bundled pin and is a maintainer tool tied to its private infrastructure; it is not a public self-hosting prerequisite. For your own registry, use the public [hosting guide](PRIVATE_REGISTRIES.md) and [protocol contract](REGISTRY_PROTOCOL.md), then enroll its independently supplied root pin through Settings or the CLI. Subsequent planned root rotations are verified using root-signed transitions from `/api/v1/registry/trust`; unrelated replacements, stale documents and persisted-sequence rollbacks are rejected.

FDO refreshes trust while in use, checks identities on startup/every six hours, and checks online certificate status before signing. Active certificate/release responses must carry a fresh issuer signature bound to FDO’s random request nonce, purpose, exact response and a two-minute deadline. Captured or altered active responses cannot be replayed. Within 30 days of expiry it saves a fresh RSA-3072 key in the OS credential store before sending a renewal proof. Only the public key and old/new-key signatures are sent. A protected pending key allows recovery if the server renews successfully but its response is lost. The old local identity is replaced only after the renewed certificate and new key are durable.

A revoked/expired identity cannot renew by possession. Recover through the authenticated registry profile, then import the new developer chain/key. Profile renewal does not revoke old signatures; explicit revocation does. Historical valid certificates remain available for verification and publication.

Registry-signed plugin directories are checked against the published signing metadata, current plugin/release/certificate status, chain and source hashes before activation. Existing capability approval and compatibility checks still apply. Running registry plugins are rechecked every five minutes and stopped if verification fails, including a registry outage. Organization registry identities use these same checks and renewals against their own configured registry. Locally signed directories using a registry identity also require current online certificate status; legacy local root trust remains separate. A plugin's self-declared signing date is not a trusted timestamp; expired certificates require re-signing and a new published version.

Revoking a developer certificate blocks its plugins; revoking a release blocks that version; revoking a plugin blocks all its versions. Issuer revocation blocks its chains. Planned root changes preserve valid historical chains. Root compromise or expiry before a trustworthy transition requires a new trusted FDO recovery release pinned to the replacement; a compromised root cannot securely authorize its own recovery. For your own registry, follow the public [hosting and recovery guide](PRIVATE_REGISTRIES.md#6-operate-recover-and-validate) and [wire protocol](REGISTRY_PROTOCOL.md). Production infrastructure variables are specific to the private deployment and are not required for self-hosting.

These source changes do not deploy AWS or publish an FDO release. Before announcing readiness, deploy the registry, generate/review/release the initial pin, and exercise sign-in, automatic renewal, revocation and runtime blocking against the deployed environment.

## Frontend callback checks

The security scan recognizes inline callbacks serialized by `defineRenderOnLoad`
and `defineRenderOnLoadActions` (`setup` and `handlers`), including named import
aliases, SDK namespace imports, quoted property names, destructured document/window
context parameters and transparent TypeScript casts or satisfies wrappers. Supported DOM queries and `UI_MESSAGE` RPC
are permitted in those callbacks. Immediate expressions used to construct the
options remain backend code; wrapping a call in an immediately invoked function
does not grant a frontend exception. Cookie access, arbitrary browser networking,
dynamic execution and host-process access remain blocked. Runtime API errors
include source line and column; Export As preserves diagnostic line breaks.
