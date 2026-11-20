# Licensing and provenance

FDO now generates distributable notices and evidence from its build inputs. Complete legal clearance is **pending**. The machine-readable source of outstanding work is [third_party/review.json](../third_party/review.json); the maintainer must supply rights and permission evidence before the corresponding entries can be cleared.

## Generate and inspect

```sh
npm ci
npm run build
# Packaging stages Git, extracts the target Electron runtime and generates dist/legal:
npx electron-builder --dir --publish never
npm run legal:review
# Full strict audit (also required for tagged packaging):
npm run legal:check
```

Build packages on the target OS/architecture. The `beforePack` hook stages host dependencies and Git. The `afterExtract` hook generates `dist/legal` using the three webpack inventories, the esbuild export-runtime inventory and the notices from the actual target Electron distribution. This happens before application files and legal resources are copied. It does not require a prior UI launch or an Electron binary in `node_modules/electron/dist`; fresh Electron npm installations may download their binary only on first use. Missing target notices remain a structural error. The standalone `legal:generate` and `legal:check` commands instead require an installed Electron distribution for their notice source.

Pending review items and missing package notices are allowed in local, unpublished review builds. Tagged packaging (`RELEASE_PUBLISH=true`), release staging/assembly, and direct publishing require current clearance. `legal:review` reports pending items; `npm run legal:review -- --strict` fails on them. `legal:check` performs the full strict audit, including target input bindings, missing notices and clean-source checks. The publisher also checks the archived ledger and packaged-test evidence before any remote action.

Do not run an output-cleaning production renderer build alongside the development watcher. For a local development check use `npx webpack --config webpack.renderer.config.js --mode=development --no-output-clean`.

`dist/legal/` contains:

| File | Meaning |
| --- | --- |
| `THIRD_PARTY_NOTICES.txt`, `licenses/*.txt` | Readable attributions and original recovered permission/notice texts. Markdown licenses are copied as text so packager Markdown exclusions cannot drop them. |
| `LICENSES.chromium.html` | Electron's supplied Chromium/native notices, retained separately. |
| `inventory.json` | Compiled/copied package versions, declared terms, notice hashes, lockfile integrity metadata, source commit/dirty status, and staged native file hashes. |
| `asset-inventory.json` | Every registered app/website asset, per-file hash, source reference, attribution and review notes. Website assets are inventoried for publication review; they are not all desktop payloads. |
| `sbom.cdx.json` | CycloneDX 1.6 inventory of identified packages, asset groups and the Git distribution. It does **not** enumerate every library embedded in native binaries. |
| `review-status.json`, `review.json` | Generation failures, missing notices, pending clearances, and release readiness. |
| `source-evidence.json`, `recovered-notices.json` | Pinned upstream references, archive checksums, comparison results and recovered notice sources. |
| `files.json` | Hash inventory of the legal evidence directory. |

The package has **Help → Third-party Licenses…**, opening the installed notices without a network request. Notices are placed outside ASAR in `resources/legal`; macOS uses `Contents/Resources/legal`. They are also attached to releases as a per-platform legal ZIP.

## Scope and remaining work

1. **Publication rights.** Only the maintainer can confirm ownership/authorization for original code, documentation, branding, screenshots and workshop media, including employment/client work. Identify third-party and AI-assisted material whose source or rights remain uncertain. This work itself was AI-assisted; an AI-assisted edit is not an independent clearance of the material it edits. No ownership confirmation has been inferred or signed on the maintainer's behalf.
2. **Cursor redistribution.** Resolved by removal in 1.0.7. `@cursor/sdk`'s license reserved rights and no redistribution grant was obtained, so the SDK, its runtime packages and the Cursor assistant provider are deleted from source, `package.json` and the lockfile. `third_party/distribution-policy.json` makes packaging fail if any `@cursor` component returns, and saved Cursor assistants are removed on startup. The item stays pending only until the per-target clearance is recorded after the final release commit.
3. **Git/native source and notices.** Dugite's MIT wrapper does not cover the entire Git binary distribution. The pinned native build is `desktop/dugite-native` commit `4098283a7ecb8a227b9d43580336c78a06f90e5d`, tag `v2.53.0-4`; its Git source submodule is `67ad42147a7acc2af6074753ebd03d904476118f`. Review each platform's Git LFS, Git Credential Manager, .NET/runtime libraries and tools. Each release target now carries a corresponding-source archive (`fdo-<version>-<platform>-native-source.zip` plus a `.json` manifest) built from `third_party/native-source.json` by `scripts/release/native-source.cjs`, checksummed, attested and required by the publication gate. Review the archives produced by the release matrix against the shipped binaries, including the disclosed deviations in `docs/NATIVE_SOURCE_DISTRIBUTION.md`, before clearing the item. An upstream URL alone is not recorded as a source offer or fulfillment.
4. **Native AI runtimes.** Codex's [versioned LICENSE](https://github.com/openai/codex/blob/rust-v0.162.1/LICENSE) and [NOTICE](https://github.com/openai/codex/blob/rust-v0.162.1/NOTICE) have been recovered. Per-platform findings for macOS, Linux and Windows x64 are in `third_party/evidence/native-ai-platform-packages.json` (from the published npm packages; not run on those platforms). The TypeScript 7.0.2 NOTICE ships in each platform package and is byte-identical. Codex's optional LGPL voice runtime is not used and is excluded from the app (`third_party/distribution-policy.json`, `webpack.main.config.js`). The Linux bubblewrap helper's source is in the Linux native-source archive. Parent npm metadata still does not inventory all Rust/Go dependencies, and no native SBOM exists; review the packaged builds per target. Electron's own Chromium notice bundle is retained.
5. **Copied artwork/builds.** Resolved by replacement in 1.0.7. All 1,374 vscode-icons files and the `vscode-icons-js` package are deleted. File-tree icons are an original set produced by `scripts/generate-file-icons.cjs` into `src/assets/icons/files` and registered as project assets. Both highlight.js stylesheets and Notyf CSS byte-match their pinned npm archives. The highlight.js script uses a deterministic recipe in `third_party/highlight-build.json`, retaining every previous language. Reproduce it with `node scripts/legal/build-highlight.cjs ARCHIVE --check`; the script verifies the archive hash before reading files. Hashes establish identity, not publication permission.
6. **Missing original package notices.** The installed SDK is `@anikitenko/fdo-sdk@1.9.2`. Its rights holder authorized an FDO-side ISC notice; see `third_party/permissions/fdo-sdk.md`. The retained notice omits an unconfirmed copyright year. `lazy-val@1.0.5` ships no license file or notice in its npm package or pinned source tree, so 1.0.7 replaces it with an original in-tree implementation (`packages/lazy-val`) of the small `Lazy` API that `electron-updater` uses, wired through `package.json` overrides. The upstream tree evidence is kept only as an audit record.

The [supplier audit](../third_party/evidence/supplier-audit.json) distinguishes retrieved evidence from remaining uncertainty. The [native source arrangement](NATIVE_SOURCE_DISTRIBUTION.md) records the implemented delivery pipeline, its disclosed deviations and the remaining review. The [signed publication statement](PUBLICATION_RIGHTS_STATEMENT.md) and [dated follow-up](LICENSING_REASSESSMENT.md) record the maintainer’s confirmation. Review their scope against the release inputs before recording target clearance.

## Updating dependencies and assets

Rebuild all targets after changing dependencies. The inventory verifies the emitted package metadata hashes against the installed packages and includes devDependencies if compilation actually bundles them. esbuild's standalone view, service core and semver code are included; copied external SDKs/runtimes are scanned separately. Preserve third-party LICENSE, COPYING, NOTICE and copyright texts; a package's SPDX expression alone is insufficient.

Add new copied assets to the appropriate explicit file list in `third_party/assets.json`. Before updating a group's `treeSha256`, review its source, permission, attribution and modification history. The digest input is the sorted concatenation of `path + ':' + sha256(file bytes) + '\n'` for its registered files. Preserve source URLs, pinned refs and original notices. Updating a digest does not clear a pending review. The `licenseSha256` map similarly pins recovered original texts; record their upstream source in the evidence files.

When an item is resolved, record `status: "cleared"`, `reviewedBy`, `reviewedAt`, `resolution`, nonempty `evidence`, and `inputs` mapping each approved release target to its exact `inventory.clearance.inputSha256` in `third_party/review.json`. Prefer a committed statement/source manifest with hashes; confidential permission documents may be referenced by a stable internal record identifier. Do not commit private agreements or personal data without authorization. Removing an item is rejected for the six required FDO review IDs. Duplicate IDs and incomplete clearances are rejected. Each target input digest covers source/documentation/asset working bytes, package and lock metadata, recovered notices, target identity and staged native bytes. The ledger itself is excluded to avoid a circular digest. Update source/evidence first, build the target, review the generated digest, then record its approval in the ledger; rebuild to verify. Any changed input invalidates the prior approval. Do not approve a digest merely to make a check pass.

For component removals, populate `third_party/distribution-policy.json` with an `excluded` entry containing `id`, `packages` (exact package names or platform-suffixed package prefixes), and `paths` (relative path fragments). Remove actual build/runtime references. The packaged check rejects matches in compiled-package inventories, ASAR entries and unpacked resources. Retained legal notices are excluded from payload path matching. An empty exclusion list claims no removals.

## Release signing and provenance

Tagged publishing fails on pending, missing or stale clearances. Unsigned branch rehearsals may still package unresolved inputs for review; they cannot publish. Stage and assembly enforce target/source identities, clean provenance, evidence hashes and clearance status. Direct publishing rechecks every supported platform's archived legal ledger, target-bound approvals, notices and successful packaged test evidence before contacting GitHub. Normal packaging commands do not publish.

`node scripts/run-packaged-host-services.cjs` writes `release/packaged-security-report.json`, plus JSON/HTML Playwright reports. Four critical regressions must each execute and pass once (no retry-based pass or skip): environment/filesystem isolation, zero-grant permissions, credential migration/redaction/restart, and packaged license access. Reports include source/version/target, executable and application-content hashes (all packaged Resources, including ASAR, native tools, and legal evidence), per-test outcomes and any final installer hashes available. Staging rejects installers whose bytes differ from those recorded after tests. The report is embedded in the legal ZIP as `packaged-tests.json` and in provenance; CI retains successful reports as artifacts. Testing a packaged app directory locally does not claim that an installer was tested or published.

Before creating another release tag, push the fixes to `main` and use **Actions → Release Matrix → Run workflow** on `main`. This branch run is an unsigned rehearsal: it exercises all four platform packaging jobs and artifact assembly without publishing a release. Create the release tag after that rehearsal passes. Rerunning an older tagged run continues to use the older source and workflow.

Each new platform release includes:

```text
fdo-<version>-<platform>-legal.zip
fdo-<version>-<platform>-sbom.cdx.json
fdo-<version>-<platform>-provenance.json
release-manifest.json
SHA256SUMS
```

Staging verifies the legal directory's source version, commit, target and file hashes before archiving it. Assembly requires all three sidecars for all four platforms, checks hashes and their provenance references, and includes them in `SHA256SUMS`. The existing GitHub OIDC build-attestation step covers all released files, including these sidecars. A JSON provenance record alone is not a signed attestation.

The staging target comes from validated release variables, for example `mac-arm64` or `linux-x64`. `signing.json` is retained as signing evidence; its runtime `platform`/`arch` fields must not replace that release identity. Mismatch errors report both expected and recorded identities to make failures actionable.

Native input hashes are taken **before** packaging and signing. Code signing can change binary bytes; use the final installer hashes for distributed artifacts. The macOS release build runs `codesign --verify --deep --strict`, `xcrun stapler validate` and `spctl --assess`, recording successful checks in the provenance sidecar. Those checks establish signing/notarization status, not ownership of every bundled component. Windows releases remain unsigned under the current release configuration.

Published Intel macOS jobs apply GitHub's temporary [runner networking workaround](https://github.com/actions/runner-images/issues/14924) before signing: block outbound UDP 443 on the ephemeral hosted runner so Apple's ticket delivery falls back from HTTP/3 to HTTPS over TCP. This addresses the reported stapler error 68; notarization, stapling and all final verification remain required. The rule is not applied to a developer's computer, other platforms or unsigned rehearsals.

To verify a downloaded release, first compare it with `SHA256SUMS` using `shasum -a 256` (macOS) or `sha256sum` (Linux). Check the manifest's source commit, platform, and provenance sidecar. Then verify the GitHub attestation for the exact installer using GitHub CLI:

```sh
gh attestation verify ./fdo-VERSION-mac-arm64.dmg \
  --repo anikitenko/fdo \
  --signer-workflow anikitenko/fdo/.github/workflows/release_matrix.yml
```

Use the [GitHub CLI verification manual](https://cli.github.com/manual/gh_attestation_verify) and inspect the verified workflow identity, subject digest and source revision. Use `--source-digest FULL_COMMIT_SHA` and `--source-ref refs/tags/vVERSION` to constrain verification to the expected release source. A matching checksum downloaded from the same release is not independent authentication. On macOS also verify the installed app with the three commands above, using its actual path.

Local test evidence and unsigned package results must be kept separate from signed release results. No remote run, published fix or verified build attestation is implied by local checks.
