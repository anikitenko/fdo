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
```

Set `PORT` to change the preview port. Stop the server with Ctrl+C. The preview
serves only the listed public assets and returns the custom 404 for unknown URLs.
The check verifies required assets, local references, anchors, and script syntax;
it does not check remote links or replace a browser review. Check desktop/mobile
layouts, the full-size screenshot link, the CLI guide navigation, and the copy
button when changing the UI. The hero image is an unaltered screenshot of the
running packaged Electron app, showing a plugin created through the normal UI
with the Blank template in a fresh isolated profile (no mocked product UI).
Recapture `website/assets/fdo-editor.png` after material editor changes; update
the image width/height attributes if its dimensions change.

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

Downloads point to the Releases listing so prereleases are discoverable and the
page doesn't depend on a version-specific filename or the existence of a stable
Latest release. Replace the first-release notice after the first release is
published. Platform formats follow the native release matrix. The MIT label links
to the package's declared license; the repository currently has no LICENSE file.
Add the project's actual license text before applying for open-source sponsorship.

The local `cli.html` guide must stay consistent with the Terminal commands section
of the root README. Other documentation links use `main` in the repository. To update the social
preview, edit `scripts/website/social-card.html` and capture it at 1200×630 into
`website/assets/social-card.png`. This source is outside the public upload folder.

The sitemap uses a vendored copy of the official sitemaps.org XSD, allowing IDE
validation offline. Its source and minimal equivalent adjustments are recorded
in `assets/sitemap.xsd`.
