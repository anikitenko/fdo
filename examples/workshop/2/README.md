# FDO Workshop 2: From Demo Data to a Real API

Build and run a **GitHub Release Monitor**: request the latest published release of a public repository, show when it was checked, handle a failed request, and investigate plugin faults with **Plugin Doctor**.

This folder contains the complete working project used in workshop 2. It handles expected API errors normally; the deliberate handler fault shown in the video is an optional exercise below.

## What you need

- **FDO 1.0.5 or a compatible newer release**, with SDK 1.8.3 or compatible newer SDK support. Get FDO from [fdo.alexvwan.me](https://fdo.alexvwan.me/).
- Internet access to GitHub's public API.
- A local signing certificate in FDO. Reuse the one from workshop 1, or create one using the steps below.

No GitHub token, cloud account, AI provider, Docker, external CLI, or separate npm installation is needed for this example. FDO builds the source with its bundled tooling.

## 1. Download the example

If you already have the FDO repository, use its `examples/workshop/2` folder.

Otherwise, open the [FDO repository](https://github.com/anikitenko/fdo), choose **Code → Download ZIP**, and extract it. Locate `examples/workshop/2` inside the extracted folder. Select this `2` folder when importing, rather than the repository root or the ZIP file.

It must contain `package.json`, `index.ts`, `logic.ts`, `render.tsx`, `styles.css`, `text.ts`, and `starter.test.ts`.

## 2. Prepare a signing certificate

If workshop 1 already created your certificate, reuse it.

Otherwise, open FDO's command search, choose **Settings**, open **Certificates**, and select **New root certificate**. Complete certificate creation before building and installing the plugin. FDO uses the default root certificate to sign the local build.

## 3. Build and install in FDO

1. Open command search and choose **Create Plugin**.
2. Under **Import an existing plugin folder**, choose **Select folder** and select `examples/workshop/2`.
3. Review the detected **GitHub Release Monitor** source project and plugin ID, `workshop-release-monitor`.
4. Set **Import as** to **Build from source and install**.
5. Select **Build and install plugin** and wait for completion.

Imported plugins start inactive and receive no capability grants. Import does not overwrite an existing plugin. If the ID already exists, choose an unused ID, or open the existing plugin to continue editing it.

FDO snapshots the selected files during inspection. If you change the folder before installing, select it again to refresh that snapshot. After importing, edit the installed plugin in FDO; changes in the downloaded folder do not automatically update the installed copy.

## 4. Review permissions and activate

Open **Manage Plugins**, select the imported plugin, and review its Network capabilities. Grant all three requirements:

| Permission shown in FDO | Capability ID | Purpose |
| --- | --- | --- |
| Network access | `system.network` | Enable network operations |
| HTTPS requests | `system.network.https` | Allow the HTTPS transport |
| Secure Public Web Scope | `system.network.scope.public-web-secure` | Allow public HTTPS destinations |

Activate the plugin after reviewing and granting these requirements. A declaration in the source is not a permission grant.

The built-in public web scope covers public HTTPS endpoints broadly. This particular adapter constructs only `https://api.github.com/repos/{owner}/{repository}/releases/latest`; it accepts an `owner/repository` value, not an arbitrary URL.

## 5. Run the example

1. Select **GitHub Release Monitor** in the sidebar.
2. Enter `anikitenko/fdo` and select **Check latest release**.
3. Observe the returned tag, publication date, check timestamp, and release link. The tag comes from the live response and may differ from the video.
4. Enter `anikitenko/fdo-workshop-no-such-repository-7ba9c1` and check again.
5. Observe **Check failed** and the **Previous successful check (not refreshed)** label. The previous result remains visible without being presented as fresh data.
6. Restore `anikitenko/fdo` and retry. A successful response replaces the previous error.

The plugin makes one request per click, disables the button while pending, and cancels a request after ten seconds. It does not poll continuously.

## 6. Read, test, and modify the source

Open this plugin in FDO's editor. Use **Run Tests** and check that all five tests pass, then **Compile** and **Deploy** your changes. Return to the running plugin and check the live request separately.

| File | What to explore |
| --- | --- |
| [logic.ts](logic.ts) | Input validation, fixed GitHub endpoint, timeout, response mapping, and HTTP errors |
| [index.ts](index.ts) | SDK lifecycle, capability declarations, backend handler, UI bindings, busy state, and previous-result handling |
| [render.tsx](render.tsx) | Accessible controls and initial interface |
| [styles.css](styles.css) | Appearance |
| [text.ts](text.ts) | Plain-text escaping in generated markup |
| [starter.test.ts](starter.test.ts) | Five deterministic adapter/render tests using stubbed responses |
| [package.json](package.json) | Entry point and host/SDK compatibility |
| [SKILL.md](SKILL.md) | Project conventions for assisted or manual editing |

Tests do not call GitHub. The fixture tag `v9.8.7` is test data; no release version is hard-coded into the live interface.

Compared with the first workshop's Service monitor template, this example replaces the demo adapter, changes the input to owner/repository, and adds HTTPS permissions and real response handling. Its separate plugin ID keeps the first example available.

## 7. Optional: reproduce the Plugin Doctor lesson

An expected API failure and a broken plugin handler are different cases. The working sample returns `{kind: 'failed', message: ...}` from the backend for expected check failures, so an ordinary 404 does not deliberately trigger a plugin-fault popup.

To follow the controlled troubleshooting example, use a practice copy and keep the original source available:

1. In the backend `checkRelease` handler's `catch` block in `index.ts`, temporarily replace its `return {kind: 'failed', ...}` statement with:

   ```ts
   throw new Error('Workshop diagnostic demo: an exception escaped checkRelease. ' +
       (error instanceof Error ? error.message : String(error)));
   ```

2. **Deploy** the modified plugin. Deactivate and reactivate it in **Manage Plugins** to load the new backend, then reopen its view.
3. Check the nonexistent repository again. This time the exception escapes the handler, producing a plugin failure notification.
4. Open the active plugin's sidebar menu and choose **Plugin Doctor**. Locate **Plugin health is degraded**, expand **Details**, and inspect the last error and suggested remediation. The diagnostic example identifies `checkRelease` and the underlying missing-release result.
5. Restore the original backend statement:

   ```ts
   return {kind: 'failed', message: error instanceof Error ? error.message : String(error)};
   ```

6. Deploy again, deactivate/reactivate, and reopen the plugin. Verify both paths: the nonexistent repository shows a normal failed check, and `anikitenko/fdo` returns a fresh success.

Only change the backend handler's `catch` block; keep the frontend's local error handling. Plugin Doctor helps identify faults and remediation; it does not automatically edit or fix your code. Diagnostic history can remain or reset after a runtime restart, so verify current behavior after repairing the handler.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Build/signing failure | Create a root signing certificate first; select the folder containing `package.json`; choose source-build import mode |
| Plugin ID is already used | Choose an unused ID for a practice copy, or edit the installed plugin |
| Network request is denied | Review all three grants above; HTTPS alone does not grant a destination scope |
| No public latest release found | Check the owner/repository and published releases; GitHub may return 404 for missing/private repositories or repositories without a published release |
| Rate-limit message | Wait and retry later; unauthenticated public requests are rate-limited |
| Request timed out | Check connectivity and try again; the timeout is ten seconds |
| Old data remains after failure | The explicit previous-result label is intentional; retry with a valid public repository |
| Plugin failure notification | Open Plugin Doctor, inspect the last error, repair the code, redeploy/reload, and verify both failure and success paths |

API semantics: [GitHub — Get the latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release). The endpoint returns GitHub's latest published release; this plugin does not sort version strings itself.

For FDO repository contributors, run `node scripts/workshops/verify-release-monitor.cjs` from the repository root. It uses a disposable profile and checks typechecking, all five tests, a real API success, a 404 with labelled previous data, and recovery. This command requires the repository's development dependencies and built application; viewers can use the FDO UI steps above.
