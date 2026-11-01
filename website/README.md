# FDO website

The public homepage for https://fdo.alexvwan.me lives alongside the desktop app so
feature descriptions and documentation links can be reviewed with product changes.
It is plain HTML, CSS, and JavaScript: no framework, package installation, tracking,
third-party fonts, or build step. The desktop packaging includes only `dist` and
its declared resources, so this folder does not ship inside the application.

## Preview and check

From the repository root, with Node.js 24:

```bash
npm run website:dev
# Open http://127.0.0.1:4173
npm run website:check
# Browser checks (requires Playwright and an installed browser)
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test --config scripts/website/playwright.config.cjs
```

Set `PORT` to change the preview port. Stop the server with Ctrl+C. The preview
serves only the listed public assets and returns the custom 404 for unknown URLs.
The check verifies required assets, local references, anchors, and script syntax;
it does not check remote links or replace a browser review. Check desktop/mobile
layouts, the full-size screenshot link, the CLI guide navigation, and the copy
button when changing the UI. The homepage and social preview use the user's
supplied Azure FinOps & Resource Manager screenshot, preserved unmodified as
assets/fdo-azure-finops.png (3438×1944). Its demo-mode notice remains visible.
The supporting product screenshots are unaltered captures from the 1.0.5 checkout
using the Dashboard starter in an isolated profile. No production metrics or AI
output were manufactured.

To recapture after building FDO:

```bash
npm run build
node scripts/website/capture-app.cjs
```

The capture uses real app IPC and UI (no mocked responses), creates a signing
certificate only in the disposable profile, runs the plugin test/build/deploy
pipeline, and saves the authored source before reviewing its web conversion.
All temporary app data is removed on exit. The supporting screenshots cover the editor, Live UI inspector, template picker,
plugin manager, web export and custom-tool guide.
The homepage leads with the supplied Azure FinOps screenshot; Monaco and Live UI are optional
authoring tools in supporting sections.
The editor image is 1440×960; the supporting captures are 1440×973. Keep HTML image
sizes and alt text aligned with the actual captures.

The tour uses native buttons with pressed states and an announced selection.
Without JavaScript, every screenshot and caption remains available. Each image
links to its original PNG. Run desktop/mobile checks, exercise every tour button,
and verify the CLI copy interaction before publishing. The source recap and
content decisions are in docs/portfolio/FDO_1_0_5_WEBSITE_BRIEF.md.

## GitHub Pages setup

1. In the FDO repository, choose **Settings → Pages → Build and deployment →
   Source: GitHub Actions**.
2. Set the custom domain to **fdo.alexvwan.me**. The `CNAME` file records the domain
   in source, but Actions deployment still requires the Pages setting.
3. Verify domain ownership in the owning GitHub account's Pages settings using
   the supplied TXT record. In Cloudflare, point `fdo` via CNAME to
   `anikitenko.github.io`. Start with DNS-only while GitHub validates DNS and
   issues its certificate, then enable **Enforce HTTPS** in Pages.
4. Merge/push the website and workflow to `main`, or manually run **Website** on
   `main`. If the `github-pages` environment has approvals, approve its deployment.

The workflow checks pull requests without deploying them. Changes to `website/`,
`scripts/website/`, or the website workflow on `main` deploy automatically. Manual
runs on other branches validate only. Only the deploy job receives Pages write
and OIDC permissions. Actions are pinned to verified commit SHAs. No personal
access token, Cloudflare API token, Electron build, or app-signing secrets are needed.

The staging command copies only the explicitly listed public files to a fresh
temporary directory; only that directory is uploaded. This README and the social
card source are excluded. Add new public assets to `publicFiles` in
`scripts/website/site.cjs`. Keep secrets, build output, and internal project
material out of this folder.

## Content maintenance

The current release badge and platform cards point to v1.0.5's release page,
without guessing asset filenames. Update these links and the visible version
together for the next release. GitHub Releases remains the source of checksums
and signing status. Platform formats follow the native release matrix. The MIT label links
to the package's declared license; the repository currently has no LICENSE file.
Add the project's actual license text before applying for open-source sponsorship.

The local `cli.html` guide must stay consistent with the Terminal commands section
of the root README. Other documentation links use `main` in the repository. To update the social
preview, edit `scripts/website/social-card.html` and capture it at 1200×630 into
`website/assets/social-card.png`. This source is outside the public upload folder.

The sitemap uses a vendored copy of the official sitemaps.org XSD, allowing IDE
validation offline. Its source and minimal equivalent adjustments are recorded
in `assets/sitemap.xsd`.

The Privacy Policy is served at `privacy.html` and linked from the homepage and
CLI guide. Keep it aligned with actual data handling, hosting/proxy settings,
tracking changes, and optional integrations. The last-updated date describes the
policy revision, not a deployment date.

## Product pages and search maintenance

`templates.html` lists all ten built-in templates and links to their source
factories. `workspace-history.html` documents snapshots rather than routing readers
to unrelated AI documentation. Keep these pages aligned with the picker and editor.
GitOps uses bundled Git; SSH is built in across supported platforms. A plugin's own
Git and other CLI requests require installed, approved executables on the desktop.
Container exports install their dependencies separately.

The homepage's structured application data, visible version, release link and
share image must be updated together. Keep metadata descriptive and grounded in
the product; do not add invented ratings or reviews. See
[the SEO implementation notes](../docs/portfolio/WEBSITE_SEO.md).

Regenerate the social preview after editing its HTML source:

```bash
node scripts/website/capture-social.cjs
```

Restart the preview server after changing the public-file allowlist. The checker
now rejects local references absent from that allowlist, so an asset cannot pass
local validation yet be silently omitted from the deployment artifact.

`ai-coding.html` documents SDK-aware AI assistance and Codex extensions. Keep the
Codex-only scope explicit: imported Skills are instruction-only; MCP servers and
Hook runtimes/scripts require their own setup. The Codex CLI itself is bundled
with packaged FDO. Provider authentication is still required. The page is linked
from the homepage navigation, editor feature and dedicated AI feature section,
and is included in the sitemap and deployment allowlist.

The AI coding guide uses `assets/fdo-ai-coding.png`, a real detached assistant
window with Codex selected and an unsent draft. Recapture it with
`node scripts/website/capture-ai.cjs` after building FDO. This uses a disposable
app profile and isolated CODEX_HOME, configures the bundled runtime without
signing in, and makes no inference request. It does not use your account or
manufacture an AI response. This capture does not replace the Monaco screenshots
in the editor/history sections or the user-supplied Azure FinOps hero.
