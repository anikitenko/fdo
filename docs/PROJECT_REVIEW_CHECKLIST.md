# Project review working checklist

This tracks the review request received for `e2c02e5`. The original checklist from the earlier email was not provided, so this is a working record, not a completed copy of that document. No ownership statement is signed or implied here.

| Item | Status / evidence |
| --- | --- |
| Project license | Present: [MIT](../LICENSE), original project material only. |
| Compiled/copied dependency inventory | Implemented: webpack/esbuild inputs, copied package scan, lock metadata and scoped CycloneDX output in `dist/legal`. |
| Third-party attributions | Added original recovered texts and package/asset notices; full coverage remains pending below. |
| Copied asset identity | Explicit path/hash registry; 477 Ace and four Font Awesome JS files verified against versioned npm archives; vscode-icons comparison records its unmatched npm icon. |
| Native runtime coverage | Pending: per-target embedded component notices and applicable source obligations. |
| Cursor redistribution grant | Pending maintainer/vendor evidence. |
| Complete SDK/lazy-val permission notices | Pending rights-holder notices. |
| Branded artwork and custom vendor builds | Pending source/permission review. |
| Original code/documentation publication rights | Pending maintainer statement, including employment/client restrictions where applicable. |
| Logos, screenshots, workshop media rights/consent | Pending maintainer statement and uncertain-source disclosure. |
| AI-assisted / third-party provenance | AI assistance disclosed for this work; maintainer must identify any other uncertain material. No blanket assurance is made. |
| Release evidence automation | Added per-platform legal/SBOM/provenance sidecars with checksum validation; existing GitHub attestation step includes them. |
| Signing configuration | macOS publishing requires signing/notarization and verifies both; Windows remains unsigned. New signing execution must be evidenced by the actual release run. |
| Reassessment commit | Pending commit of the reviewed changes; do not cite the old HEAD as containing uncommitted fixes. |
| Remote CI and dependency-security scan | Pending actual run for the reassessment commit. Local results are not GitHub CI evidence. |
| Corresponding release / verified attestation | Pending actual release for that commit and independent verification of downloaded artifacts. |
| Original emailed checklist | Pending receipt and completion by the maintainer. |

Suggested factual response to the licensing point:

> We added packaged third-party notices, a build-derived dependency/asset inventory and a scoped CycloneDX SBOM, together with per-platform release evidence and checksum checks. The project MIT license is now explicitly distinguished from third-party terms. We have not marked redistribution coverage complete: the tracked outstanding items are Cursor permission, native component notices and applicable source obligations, copied artwork/custom-build provenance, two missing original package notices, and the maintainer's publication-rights statement. We will supply the reassessment commit, its CI/security-scan links, and the corresponding release/signing/attestation evidence after those checks actually run.
