# PR and push testing

`.github/workflows/editor_ui_tests.yml` runs on every branch push, pull request,
merge queue entry, manual dispatch, and weekly schedule. Tag packaging remains in
`release_matrix.yml`. Branch pushes with an open PR intentionally produce both
branch and merge-result runs.

| Check | PR / branch push / merge queue | Manual / weekly |
| --- | --- | --- |
| All Jest unit and component suites | Linux | Linux |
| Production application build | All three platforms | All three platforms |
| Deterministic Electron regression suite | Linux, four shards | Linux, four shards; macOS and Windows unsharded |
| Desktop, snapshots, assistant and Live UI smoke | macOS and Windows | macOS and Windows |
| SDK fixture runtime matrix | Linux, separate job | Linux, separate job |

Use **App UI Required** as a required branch-protection check. It fails if any
prerequisite fails, is cancelled, or is skipped. Adding this workflow does not
configure repository branch protection; enable the check in GitHub repository
settings. Merge queues are supported through `merge_group`.

The CI Playwright config uses one worker per runner, forbids `.only`, and disables
retries so a flaky first attempt cannot silently pass. Shards distribute files
between independent Linux runners. New deterministic `tests/e2e/*.spec.js` files
are included automatically, including fault injection. Jest discovers all its
suites rather than the old five-suite `test:editor:unit` selection.

SDK tests resolve examples from the installed, lockfile-controlled SDK package.
An explicit `FDO_SDK_EXAMPLES_PATH` can override that for SDK development. Frontend
recipes and helper modules are not background plugins; runtime discovery includes
SDK plugin classes, while the component/Live UI suites exercise frontend authoring.
CSS example imports use the same style-map compiler as deployed plugins.

Recorded transport and repair scenarios explicitly seed an already reviewed
workspace with the current SDK fingerprint and an executable SDK baseline test.
This keeps their recorded request budgets focused on the repair under test.
The application guide validation and manual approval behavior remain enabled.

Every test job uploads reports even when successful (14-day retention). Each
shard and platform has a unique artifact name. A failed cross-platform smoke run
keeps its output; a subsequent full run uses separate output/report directories.
Open the uploaded Playwright HTML report and traces to investigate failures.
Native Electron context traces are recorded explicitly under
`test-results/electron-native/`; they include IDE/plugin window snapshots rather
than only the outer test steps. Large native diagnostics are uploaded on failure
or cancellation; successful runs retain the smaller test reports.

## Running the same checks locally

Install the lockfile dependencies with `npm ci`. Use Node 24 to match CI.

```sh
npm run test:ci
npm run build
npx playwright install chromium
npm run test:e2e:ci
npm run test:e2e:fixtures:matrix
```

On Linux use `npx playwright install --with-deps chromium`, then prefix Electron
test commands with `xvfb-run -a`. Do not rebuild the application while Electron
tests are running. Run a Linux shard with `npm run test:e2e:ci -- --shard=1/4`.

`test:ci` runs all Jest assertions without the expensive `--detectOpenHandles`
instrumentation. Use `npm run test:unit -- --runInBand` when investigating leaked
handles; CI retains its job deadline if a process fails to exit.

## Deliberate boundaries

- Real-provider AI scenarios (`ai-coding-agent.live.spec.js`) require credentials,
  can spend credits and produce nondeterministic responses. Automatic CI explicitly
  disables these. Run them separately as described in
  [the live AI scenario guide](../tests/e2e/live-ai-scenarios/README.md).
- The SDK runtime matrix runs separately, not once again inside every regression run.
- `plugin-packaged-layout-smoke.spec.js` needs `FDO_E2E_PACKAGED_EXECUTABLE` pointing
  at a built application. Source-build CI excludes it. The release workflow builds
  installers but does **not** currently exercise this packaged runtime test; that
  is a remaining release-validation gap.
- Passing this workflow does not establish real-provider reliability, signing,
  installer behavior, or complete visual/accessibility coverage. It checks the
  repository's automated assertions on the specified platforms.

## SDK 1.7.1 verification (October 15, 2026)

The failures recorded against SDK 1.7.0 have been resolved in the current
dependency/test combination. SDK 1.7.1 corrects the Hosts Manager icon to
`globe-network`. The operational coverage scenarios now exercise Git and service
content hub frontend/backend paths, including simulated external-service errors.
The smoke suite uses the shared behavior manifest's explicit UI markers instead
of requiring internal metadata names to appear in rendered markup.

After a production rebuild with SDK 1.7.1 installed and locked, all 12 affected
native checks passed without retries: smoke, handler contract, line coverage and
per-plugin coverage for Hosts Manager, Git and service content hub. The 18 focused
SDK integration unit checks also passed. Coverage thresholds remain unchanged.

| Example | Line coverage suite | Per-plugin line coverage |
| --- | --- | --- |
| Hosts Manager | 85.14% | 85.14% |
| Git operations | 76.51% | 77.18% |
| Service content hub | 76.85% | 76.96% |

This was a targeted rerun on macOS, not a full-suite or cross-platform
recertification. GitHub must establish the Linux and Windows results; the
real-provider and packaged-runtime boundaries above still apply.
