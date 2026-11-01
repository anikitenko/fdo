# FDO 1.0.5 website brief

## Conversation summary

- Fixed packaged web/Docker exports: ship the converter's view library and runtime sources beside unpacked host dependencies.
- Added macOS update download/progress/preparation/restart states, background status restoration, and protection against concurrent installs. Closing Settings leaves the update running; FDO restarts when ready. Added component, updater and Playwright coverage; an actual signed update/replacement was not exercised in this conversation.
- Refactored macOS update cleanup to finally, retaining validation errors and successful handoff ownership.
- Explained exported credentials: setup generates the vault encryption key, Compose mounts persistent data, and engineers supply provider credentials separately. Added environment-based provisioning instructions.
- Made tool-requirement editing open package.json with context. Then replaced the large banner with a compact setup bar and an installation guide shared by the editor, export dialog and deployment form.
- Documented catalog tools, Debian packages, verified executable downloads, and custom base images for vendor installers/full SDKs. Added examples, copy feedback, verification and troubleshooting.
- Replaced the standalone server's fast SHA-256 password verifier with salted scrypt, asynchronous bounded verification and constant-time comparison. Login, rejected credentials, concurrency and standalone browser/restart behavior were tested. CodeQL itself was not rerun locally.
- Fixed serialized-source edits so existing JSON escapes keep their values. Preserved executable callback source for visual handler updates/duplication. Regression coverage includes collection labels/default keys, appearance, text and handler representations.
- Fixed a renderer build regression by moving string serialization into a dependency-free module, avoiding imports of host editing code. Added a browser-bundling boundary test; development and production builds passed.
- Added the Google site-verification file to the public deployment allowlist. The user confirmed domain verification succeeded.
- The user released 1.0.5 and requested a broader website showcase with real product screenshots.

## Public content priorities

Lead with useful workflows, rather than a list of fixes: SDK-aware AI and Monaco editing; visual/source-connected design with reviewed drafts; signed plugins and capability policies; GitOps distribution; web/Docker conversion and installation guides; CLI automation; snapshots; host-managed secrets/SSH.

Do not imply every plugin converts automatically, every visual render path is supported, cloud resources are provisioned automatically, desktop credentials are exported, or an AI run occurred in a screenshot when none did. Export templates are starting points requiring deployment-specific configuration. Separate runtime credentials, tool installation and capability permissions.

## Screenshot policy

Capture genuine app UI from an isolated profile with built-in demo content. Never replace IPC responses or manufacture AI output, provider accounts, update progress or production metrics for marketing. Label template/demo data. Screenshots document the current 1.0.5 checkout, not a claim that an exact signed release binary was tested. No user credentials, host paths or private repositories should be visible.

## Scope

Update the existing static HTML/CSS/JS site and its explicit public-file allowlist. Keep GitHub Pages hosting, verification, privacy policy, CLI guide and the site's dependency-free approach. Publishing occurs through the existing workflow after the changes reach main; this task does not push or deploy.
