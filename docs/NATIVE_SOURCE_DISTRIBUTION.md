# Native source distribution

Status: implemented in 1.0.7, pending the first CI release run and review. The
Git native ledger item stays pending until the archives below have been produced
by the release matrix and reviewed.

## What ships

Each release target publishes `fdo-<version>-<platform>-native-source.zip` and a
`.json` sidecar beside the installers. They are built by
`scripts/release/native-source.cjs` from the pinned policy
`third_party/native-source.json`, listed in the release checksum inventory and
attestations, and required by `scripts/release/publication-gate.cjs`.

- Unix targets (macOS, Linux): dugite-native build repository, Git, Git LFS,
  Git Credential Manager. Linux also carries `openai/codex` at the Codex
  0.162.1 build commit, which holds the vendored bubblewrap source (LGPL) for
  the Codex Linux helper.
- Windows: dugite-native, the Git for Windows fork, Git LFS, GCM, Git for
  Windows build-extra, the MSYS2/MinGW packaging repositories and about 50
  MSYS2 source packages plus the OpenSSL upstream tarball.
- Git sources are fetched by commit; the archive's pax header is checked
  against that commit. Other files are pinned by sha256 and size. The build fails
  if `node_modules/dugite/script/embedded-git.json` no longer matches the
  policy, so a Dugite bump forces a policy update.
- Verification (`verifyNativeSource`) needs no network: it checks the sidecar,
  the archive digest and the policy digest, and the entry names and sizes.

## Disclosed deviations

- `bash`: the MSYS2 `5.2.037-2` source package is used because the `-1` source
  is no longer hosted. The upstream version is identical; the `-1` packaging is
  in the pinned Git for Windows commit `a3b27b0`.
- OpenSSL 3.5.5: the MSYS2 source package is not hosted, so the upstream release
  tarball plus the Git for Windows packaging commits are archived instead.
- MinGit's `etc/package-versions.txt` lists `mingw-w64-x86_64-git 2.52.0.1-1`,
  which is stale against the real `git.exe` (2.53.0.windows.4). The source of the
  real binary is archived.
- Per-component licences for MSYS2 packages are not declared in the policy; each
  source archive carries its own licence files.
- The Linux build ships `ssl/cacert.pem` (Mozilla CA bundle, MPL-2.0), and GCM is
  a prebuilt .NET release whose permissive notices are in `libexec/git-core/NOTICE`.

## Remaining review

Run the release matrix on the final commit, unpack each archive, confirm the
sources correspond to the shipped binaries, verify the public download, then
record the reviewer, date and per-target input hashes in `third_party/review.json`.

## Original acceptance criteria

FDO will accompany binary downloads with the complete corresponding source
materials required for the exact bundled components, available with equivalent
access alongside each release's binaries. We are not issuing a three-year written
source offer or relying only on a link to an upstream repository. Review the exact
applicable license/version for each component when assembling the delivery.

For Dugite native v2.53.0-4, retain these inputs:

- Build repository `desktop/dugite-native` at
  `4098283a7ecb8a227b9d43580336c78a06f90e5d`, including build/install scripts,
  patches, dependency manifests and configuration.
- Git submodule source at `67ad42147a7acc2af6074753ebd03d904476118f`.
- Windows Git source and packaging materials for the separately downloaded
  MinGit v2.53.0.windows.4; do not substitute the ordinary Git submodule for this.
- Version-specific Git LFS v3.7.1, Git Credential Manager v2.9.0 where included,
  and every additional library/tool/runtime actually shipped on each platform.
  Inventory each final archive; the upstream dependency manifest is a starting
  point and does not identify every statically linked library or runtime.

The retained upstream manifest is
`third_party/evidence/dugite-native-v2.53.0-4-dependencies.json`. Exact platform
binary archive names/checksums are in `node_modules/dugite/script/embedded-git.json`
and generated `inventory.json`. Preserve these together with the release record.

For each release/target, create a source-delivery manifest listing component name,
version, license, binary archive hash, source revision, source archive filename and
SHA-256, build scripts/patches, required notices, and a reviewer/date. Package the
actual sources, not HTML pages or empty git submodule directories. Include any
required dependency source/build materials; verify the archives can be unpacked
and that the documented build inputs correspond to the binary distribution.

Publish these archives and manifest beside the installers; include them in the
release checksum inventory and attestations. The release uploader expects these files exactly. Verify public download availability before listing reassessment.
Retain immutable copies with historical releases. If using a separate source host,
record its availability/retention responsibility and the license-specific basis.

Removing a bundled native component is an alternative. Record its package/path
exclusions in `third_party/distribution-policy.json`, remove actual build/runtime
references, and pass final ASAR/unpacked-resource inspection. A user-installed Git
fallback needs explicit trusted-path selection and regression tests before replacing
the bundled Git integration.
