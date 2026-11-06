# Licensing and provenance

FDO now generates distributable notices and evidence from its build inputs. Complete legal clearance is **pending**. The machine-readable source of outstanding work is [third_party/review.json](../third_party/review.json); the maintainer must supply rights and permission evidence before the corresponding entries can be cleared.

## Generate and inspect

```sh
npm ci
npm run build
# Packaging stages Git, extracts the target Electron runtime and generates dist/legal:
npx electron-builder --dir --publish never
npm run legal:review
# Optional strict audit, separate from release creation:
npm run legal:check
```

Build packages on the target OS/architecture. The `beforePack` hook stages host dependencies and Git. The `afterExtract` hook generates `dist/legal` using the three webpack inventories, the esbuild export-runtime inventory and the notices from the actual target Electron distribution. This happens before application files and legal resources are copied. It does not require a prior UI launch or an Electron binary in `node_modules/electron/dist`; fresh Electron npm installations may download their binary only on first use. Missing target notices remain a structural error. The standalone `legal:generate` and `legal:check` commands instead require an installed Electron distribution for their notice source.

Pending review items and missing package notices are reported in the evidence and do not automatically block release creation. Structural errors such as changed/unregistered assets, missing build inventories, or stale package metadata still fail generation. `legal:review` emits warnings for pending items; `npm run legal:review -- --strict` opts into failure on pending items. The separate `legal:check` command performs the full strict audit, requiring no pending reviews, no missing notices and a clean checkout.

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
2. **Cursor redistribution.** `@cursor/sdk`'s installed license reserves rights and refers to [Cursor terms](https://cursor.com/terms-of-service). Obtain a grant covering the exact redistributed SDK/platform runtime, or stop distributing those components. The current inventory records uncertainty; it does not silently remove the integration.
3. **Git/native source and notices.** Dugite's MIT wrapper does not cover the entire Git binary distribution. The pinned native build is `desktop/dugite-native` commit `4098283a7ecb8a227b9d43580336c78a06f90e5d`, tag `v2.53.0-4`; its Git source submodule is `67ad42147a7acc2af6074753ebd03d904476118f`. Review each platform's Git LFS, Git Credential Manager, .NET/runtime libraries and tools. Fulfill applicable GPL corresponding-source obligations, including required build scripts/patches, for the exact binaries shipped. An upstream URL alone is not recorded as a source offer or fulfillment. Attach the actual source distribution or a reviewed compliant alternative to the release evidence.
4. **Native AI runtimes.** Codex's [versioned LICENSE](https://github.com/openai/codex/blob/rust-v0.162.1/LICENSE) and [NOTICE](https://github.com/openai/codex/blob/rust-v0.162.1/NOTICE) have been recovered. Parent npm metadata still does not inventory all Rust/Go/native dependencies in Codex, Cursor or TypeScript-Go. Obtain and review their embedded component notices per version/target. Electron's own Chromium notice bundle is retained.
5. **Copied artwork/builds.** Of 1,374 vscode-icons files, 1,373 byte-match the pinned upstream tree; `file_type_npm.svg` differs. Upstream [licensing guidance](https://github.com/vscode-icons/vscode-icons/tree/abb2b8d5b0a6f04ad111f33a0d9cfe84a9a6d2dd#license) distinguishes artwork and branded icons from MIT code. Review branded assets, attribution/ShareAlike obligations and the unmatched file, or replace them with cleared assets. Record the custom highlight.js build recipe and the copied stylesheet sources. Hashes establish file identity, not permission.
6. **Missing original package notices.** `@anikitenko/fdo-sdk@1.8.3` declares ISC and `lazy-val@1.0.5` declares MIT, but the installed packages and their npm `gitHead` source trees omit complete original copyright/permission notices. Obtain them from their rights holders; do not generate guessed copyright years. These remain explicitly reported as missing.

## Updating dependencies and assets

Rebuild all targets after changing dependencies. The inventory verifies the emitted package metadata hashes against the installed packages and includes devDependencies if compilation actually bundles them. esbuild's standalone view, service core and semver code are included; copied external SDKs/runtimes are scanned separately. Preserve third-party LICENSE, COPYING, NOTICE and copyright texts; a package's SPDX expression alone is insufficient.

Add new copied assets to the appropriate explicit file list in `third_party/assets.json`. Before updating a group's `treeSha256`, review its source, permission, attribution and modification history. The digest input is the sorted concatenation of `path + ':' + sha256(file bytes) + '\n'` for its registered files. Preserve source URLs, pinned refs and original notices. Updating a digest does not clear a pending review. The `licenseSha256` map similarly pins recovered original texts; record their upstream source in the evidence files.

When an item is resolved, record `status: "cleared"`, `reviewedBy`, `reviewedAt`, `resolution`, and nonempty `evidence` in `third_party/review.json`. Prefer a committed statement/source manifest with hashes; confidential permission documents may be referenced by a stable internal record identifier. Do not commit private agreements or personal data without authorization. Removing the status entry is not evidence of resolution.

## Release signing and provenance

Tagged publishing runs report pending reviews as workflow warnings. Packaging, staging and assembly continue to enforce structural integrity, matching source/target metadata and evidence checksums; publishing requires clean source provenance and the existing platform signing checks. Pending legal reviews remain pending in the packaged ledger and provenance (`legalReleaseReady: false`); releasing does not mark them cleared. Strict legal review remains available as an explicit audit command, rather than an automatic publication gate. Normal packaging commands do not publish.

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

Native input hashes are taken **before** packaging and signing. Code signing can change binary bytes; use the final installer hashes for distributed artifacts. The macOS release build runs `codesign --verify --deep --strict`, `xcrun stapler validate` and `spctl --assess`, recording successful checks in the provenance sidecar. Those checks establish signing/notarization status, not ownership of every bundled component. Windows releases remain unsigned under the current release configuration.

To verify a downloaded release, first compare it with `SHA256SUMS` using `shasum -a 256` (macOS) or `sha256sum` (Linux). Check the manifest's source commit, platform, and provenance sidecar. Then verify the GitHub attestation for the exact installer using GitHub CLI:

```sh
gh attestation verify ./fdo-VERSION-mac-arm64.dmg \
  --repo anikitenko/fdo \
  --signer-workflow anikitenko/fdo/.github/workflows/release_matrix.yml
```

Use the [GitHub CLI verification manual](https://cli.github.com/manual/gh_attestation_verify) and inspect the verified workflow identity, subject digest and source revision. Use `--source-digest FULL_COMMIT_SHA` and `--source-ref refs/tags/vVERSION` to constrain verification to the expected release source. A matching checksum downloaded from the same release is not independent authentication. On macOS also verify the installed app with the three commands above, using its actual path.

No new remote CI run, signed release, or cryptographically verified attestation is claimed for this uncommitted change. Local unsigned package tests and local test results must be kept separate from published release evidence.
