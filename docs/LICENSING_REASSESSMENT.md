# Licensing reassessment checklist

Review updated 2026-11-20. This records engineering work and remaining
clearance work separately. It is not a publication-rights attestation.

## Engineering work

- [x] Require licensing clearance in tagged packaging, staging, assembly and the
  direct publisher; retain unpublished review builds.
- [x] Bind approvals to exact target/source/package/asset/native input digests;
  reject incomplete/duplicate ledger entries and deletion of required FDO items.
- [x] Update the stale SDK ledger version to installed 1.9.2, retain the
  maintainer-authorized ISC notice, and include the original FDO MIT notice in
  the first-party registry-typescript adapter package.
- [x] Add an explicit removal policy and inspect compiled package inventories,
  ASAR contents and unpacked resources for excluded components. The policy covers
  Cursor and the unused Codex voice runtime.
- [x] Run a packaged notices/menu regression and retain per-test outcomes,
  application-content hashes, and available installer hashes. Release staging
  rejects changed application/installer bytes; archived evidence is rechecked by
  assembly and publishing. Successful CI reports have 90-day retention and the
  release legal archive/provenance preserves the summary.

## Licensing evidence and outstanding work

- [x] SDK: supplied the rights-holder-authorized FDO-side ISC notice for 1.9.2.
- [x] Copied stylesheets: pinned archive byte matches recorded for Notyf and both
  highlight.js stylesheets.
- [x] highlight.js: deterministic pinned upstream recipe replaces the unknown
  custom bundle and retains all previous language registrations (83 total now).
- [x] Replaced the unmatched npm-branded SVG with an original generic package
  symbol; retained assets and hashes updated.
- [x] Retained pinned Dugite dependency/build references, a Codex source-lock
  component inventory, and the exact TypeScript darwin-arm64 supplier notice.
- [x] Cursor: removed in 1.0.7 (SDK, runtime packages, provider and UI), with a
  packaging-time exclusion policy and legacy-settings cleanup. Per-target
  clearance is recorded after the final release commit.
- [x] Git/native delivery pipeline: per-target corresponding-source archives
  (`scripts/release/native-source.cjs`, `third_party/native-source.json`) are built,
  checksummed, attested and required by the publication gate. Tested with real
  builds for macOS arm64 and Windows x64. Remaining: review the CI output and verify
  public download access after release (see `NATIVE_SOURCE_DISTRIBUTION.md`).
- [x] Native AI components: macOS/Linux/Windows x64 packages inspected
  (`native-ai-platform-packages.json`); TypeScript notices byte-identical; unused
  Codex voice runtime (LGPL) excluded from the app; Linux bubblewrap source added to
  the Linux archive. Remaining: helper binaries and a native SBOM under review.
- [x] Artwork: vscode-icons and `vscode-icons-js` removed in 1.0.7; replaced by
  an original generated icon set (`scripts/generate-file-icons.cjs`).
- [x] Missing notices: lazy-val 1.0.5 had no notice; replaced by an original
  in-tree package (`packages/lazy-val`).
- [x] The maintainer signed the [publication declaration](PUBLICATION_RIGHTS_STATEMENT.md)
  for source revision `3ee271e46269fe354f1b9a74a2087d68ebc96123`. Its detached
  signature verifies with the public key supplied in the repository.
- [x] On 2026-11-20 the maintainer explicitly confirmed that the signed
  publication-rights and employer/client statements also cover changes through
  `91776082a8e0a878956ad9458367883d041ff271` and the 1.0.7 release-evidence
  documentation. This follow-up was given in writing in the release preparation
  conversation. The detached signature covers the original declaration.
- [x] In a further written confirmation on 2026-11-20, the maintainer extended
  the same 1.0.7 publication-rights and employer/client statements to the
  rehearsal changes, including the Live UI line-ending fix, editor test hook,
  regression tests and CI changes. The original signature remains scoped to
  the revision named in the signed declaration.
- [ ] Review final native sources and outstanding helper notices.
- [ ] Record the reviewer, date, resolution, supporting evidence and verified
  input hashes for each target in all six ledger entries.
- [ ] Confirm the strict review passes and supply the published installer,
  source, notices and packaged-test evidence links for each target.

## Validation and release scope

Production build passed. Focused verification passed 56 tests across seven suites;
subsequent source/target consistency changes passed the 36 affected legal/release
tests. The unsigned macOS arm64 application reported at revision `1261c009` passed all 19 packaged regressions (no retries). The runner is
`node scripts/run-packaged-host-services.cjs`. Its current results are in
`release/packaged-security-report.json` and
`test-results-packaged-services/results.json`; consult those records for the
exact final test count, identity and content hash. Local directory packaging does
not produce or test a downloadable installer. Other platforms require their
native CI runs.

The public latest release checked on 2026-11-20 was v1.0.6, source
`50e86081a880a6cf5f91af5e016185061def735c`; its retrieved mac-arm64 provenance says
`legalReleaseReady: false`. These local changes have not been published. No
signature or build attestation verification of that downloaded release is claimed.
