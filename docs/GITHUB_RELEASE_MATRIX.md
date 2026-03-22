# GitHub Release Matrix

FDO now includes a GitHub Actions release workflow at [`release_matrix.yml`](/Users/alexvwan/dev/fdo/.github/workflows/release_matrix.yml).

## What it does

- Builds platform packages in parallel on GitHub-hosted runners:
  - macOS: `DMG`, `ZIP`
  - Linux: `AppImage`, `DEB`, `RPM`
  - Windows: `NSIS .exe`, `portable .exe`
- Uploads build artifacts for every workflow run
- Publishes assets to a GitHub Release automatically when the ref is a tag matching `v*`

## How to use it

### Manual build

1. Open GitHub Actions.
2. Run `Release Matrix`.
3. Wait for the matrix jobs to finish.
4. Download the uploaded artifacts for each OS.

### Tagged release

1. Create and push a version tag, for example:

```bash
git tag v1.0.0
git push origin v1.0.0
```

2. GitHub Actions will:
   - build all platform artifacts
   - create/update the GitHub Release for that tag
   - attach the packaged files automatically

## Notes

- The workflow uses `npm ci` and the existing `package-lock.json`.
- Linux runners install `rpm`, `fakeroot`, and `dpkg` before packaging.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` is set so unsigned CI builds do not block on local macOS signing discovery.
- If you later add signing or notarization, extend the workflow with the required secrets and platform-specific signing steps.
