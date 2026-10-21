# GitHub Release Matrix

FDO now includes a GitHub Actions release workflow at [`release_matrix.yml`](../.github/workflows/release_matrix.yml).

## What it does

- Builds platform packages in parallel on GitHub-hosted runners:
  - macOS arm64 and x64: `DMG`, `ZIP` (signed and notarized for tagged releases)
  - Linux: `AppImage`, `DEB`, `RPM`
  - Windows x64: NSIS installer and portable `.exe` (unsigned until Windows signing is configured)
- Uploads build artifacts for every workflow run
- Publishes assets to a GitHub Release automatically when the ref is a tag matching `v*`

## How to use it

### Manual build

1. Open GitHub Actions.
2. Run `Release Matrix`.
3. Wait for the matrix jobs to finish.
4. Download the uploaded macOS, Linux, or Windows artifacts.

### Tagged release

1. Create and push a version tag, for example:

```bash
git tag v1.0.0
git push origin v1.0.0
```

2. GitHub Actions will:
   - build macOS, Linux, and Windows artifacts
   - create/update the GitHub Release for that tag
   - attach the packaged files automatically

## Notes

- The workflow uses `npm ci` and the existing `package-lock.json`.
- Linux runners install `rpm`, `fakeroot`, and `dpkg` before packaging.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` is set so unsigned CI builds do not block on local macOS signing discovery.
- Stable macOS releases require the configured Developer ID signing and Apple notarization secrets. Linux packages are unsigned.
- Windows installers are published unsigned while Windows signing remains unconfigured.
