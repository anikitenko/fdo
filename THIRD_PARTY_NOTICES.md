# Third-party licensing

FDO's [MIT license](LICENSE) applies to original project material for which its contributors hold the necessary rights. It does not replace the licenses of dependencies, copied artwork, fonts, vendor code or bundled executables.

Packaged applications include `Resources/legal/THIRD_PARTY_NOTICES.txt` (macOS: `FDO.app/Contents/Resources/legal/`), the original notices, Electron/Chromium notices, a scoped CycloneDX SBOM, and inventories with source references and hashes. Open **Help → Third-party Licenses…** in FDO to read the notices. Windows/Linux use their application's `resources/legal` directory.

The inventories are generated from webpack/esbuild inputs, copied packages and assets, rather than assuming that `dependencies` alone describes the shipped application. A separate production dependency graph is retained as a conservative reference; it is not a claim that every graph entry ships.

Copied assets are registered in [third_party/assets.json](third_party/assets.json). In particular:

| Component | Terms / attribution |
| --- | --- |
| Ace 1.39.1 | BSD-3-Clause; Ajax.org and upstream contributors |
| Font Awesome Free 6.7.2 | Code MIT; embedded icons CC BY 4.0; original composite notice retained |
| Pure 3.0.0 / normalize.css 8.0.1 | BSD-3-Clause / MIT |
| Notyf 3.10.0; Split Grid 1.0.11 | MIT |
| highlight.js 11.10.0 | BSD-3-Clause; exact custom build provenance pending |
| vscode-icons artwork | Upstream identifies CC BY-SA 4.0, with separate terms for branded icons; its source-code MIT license does not clear all artwork |
| Dugite / bundled Git | MIT wrapper; Git is GPL-2.0, with additional components and obligations in the native distribution |
| Codex 0.162.1 | Apache-2.0; upstream LICENSE and NOTICE retained; embedded native coverage remains under review |
| Cursor SDK/runtime 1.0.40 | Reserved rights / Cursor terms; redistribution clearance pending |

This is an inventory and remediation record, not a declaration that all redistribution requirements have been fulfilled. See the [review ledger](third_party/review.json) and [licensing and provenance guide](docs/LICENSING_AND_PROVENANCE.md) for unresolved items and release checks. No new rights or trademark permissions are granted by this document.
