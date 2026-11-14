# Registry installation links

The registry's **Install in FDO** button uses:

```
fdo-fiddle://registry/plugins/<plugin-id>/<exact-semver>
```

The desktop registers `fdo-fiddle` through electron-builder and Electron. macOS
`open-url`, Windows/Linux startup arguments, and running-instance arguments use
the same parser and bounded installation queue. Links received before startup
finishes wait for plugin storage and IPC initialization. Duplicate links are
coalesced while their installation is in progress. The desktop opens an installation
progress dialog as soon as the link is handled, including while release status or
the archive is loading. A status snapshot preserves progress across startup or
window recreation; revision ordering prevents stale snapshots from replacing newer
events. Success, cancellation and errors stay visible until dismissed. The catalog provides
the human display name while the archive downloads; verified source metadata
provides the final name. Internal IDs are not used as the dialog title. Registry
network failures report DNS, TLS, timeout or connection errors instead of a generic
"fetch failed" message.

Only the configured official registry can supply archives. Links cannot choose
an origin, filesystem path, credentials, query parameters or action. Installation
requires an embedded-signed FDO source ZIP; legacy TGZ releases are unsupported.
The desktop checks online signed release status, archive SHA-256, bounded ZIP
structure, source policy, signer identity, file hashes and host compatibility
before presenting the native Install/Cancel dialog. Cancel is the default.
It compiles approved source without running plugin code or package scripts, then
rechecks release and certificate status before committing the installation.
Original signed sources and package.json stay intact. The version may be declared
in the statically inspected plugin source metadata instead of package.json, matching
the registry publishing contract. Only hash-checked source determines that identity. Activation rebuilds from
verified source through the existing registry runtime verification pipeline.

Plugins are installed inactive with no capabilities granted. A notification links
to Manage Plugins for capability review and activation. Registry origin, plugin ID, release version, archive digest and publisher fingerprint
are durably recorded in plugins.json and visible through the Registry badge in
Manage Plugins. A same-version link verifies the installed source and reports
Already installed without downloading or changing it. Modified source requires an
explicit repair. Newer and older versions require explicit Update or Downgrade
approval. Signed registry installs created before provenance tracking are adopted
only after successful verification against the official registry. Local and GitOps
ID collisions are never overwritten. Registry-managed source and signatures cannot
be replaced through local editor/CLI deployment; export a separate source copy
for development.

Replacement stages verified code in a separate directory, serializes registry
installs with an OS-backed lock, then commits a fresh compare-and-swap record via
fsync and atomic rename. Concurrent grant or source edits abort the replacement.
The old code is retained until startup succeeds; startup failure restores the old
record. Plugin data is stored separately under the unchanged local ID. Existing
capability grants can be retained or reduced; new capabilities are never granted
automatically. An update requiring additional grants deactivates the plugin for
review. Otherwise its activation state is preserved.

Revoked/expired releases and publisher certificates block manually constructed
links, including same-version requests. Online status is checked before download
and again after review. Certificate settings show Revoked or Status unavailable
instead of a green validity claim when signing is blocked. Recovery guidance is
below the certificate summary, with imported identities still visible offline.
Cancellation, verification failure and build failure remove staged files. Registry
IDs outside the desktop ID format map to stable hashed local IDs; the original
registry identity remains in signed package.json.

The registry CDN already serves published `/packages/*` archives. No backend or
AWS infrastructure change is needed for this flow. Desktop requests do not count
as authenticated community download metrics. Deploy the registry frontend and
ship a newly packaged desktop release to expose the completed integration.

Validation:

```
node scripts/run-jest.cjs tests/unit/deep-links.test.js tests/unit/registry-install.test.js --runInBand
npx playwright test tests/e2e/deep-links.spec.js --workers=1
npm run registry:check-policy
npm run build:main
npm run website:check
```

ZIP inspection is synchronized from the registry's validator with
`scripts/sync-registry-policy.cjs`. Its embedded-signature snapshot includes only
inert file inspection; certificate trust uses the desktop's pinned registry trust
implementation.

For an explicit real-network check (revoked releases are rejected; active releases
reach approval and are then cancelled; GitHub HTTPS and bundled Git connectivity):

```
FDO_E2E_LIVE_NETWORK=1 npx playwright test tests/e2e/deep-links.spec.js --workers=1
```
