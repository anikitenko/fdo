# AI workspace release checks

The editor validates the full proposed import graph and compiles a detached candidate before applying generated workspace files. Retained consumers are included. Cancellation or source edits during compilation prevent application. Invalid paths, missing compiler access and unsuccessful builds fail closed. The existing validation repair is limited to one retry.

Source application is synchronous. If a write fails, previously touched sources are restored and newly created files are removed using exact paths. A rollback failure remains an explicit error with snapshot recovery guidance. Empty folders and editor selection may remain after rollback; this is source rollback, not a filesystem transaction. Compilation does not establish runtime correctness or execute generated tests.

Run the local checks before collecting live evidence:

```sh
npm run test:ai:hardening
npm run test:ai:safety
npm run build
npx playwright test tests/e2e/workspace-preapply-validation.spec.js --workers=1
```

Configure dedicated test credentials and model names in the environment using the names in `docs/ai-release-matrix.example.json`. The example uses Cloudflare and OpenRouter; other supported providers can be substituted. Credentials are never stored in the matrix. Inspect the plan before running it:

```sh
npm run test:ai:reliability -- --matrix docs/ai-release-matrix.example.json --repeat 1 --dry-run
npm run test:ai:reliability -- --matrix docs/ai-release-matrix.example.json --repeat 1
npm run test:ai:release -- artifacts/live-ai/reliability/<run-directory>/summary.json
```

The release evidence check requires six successful Workbench runs across at least two providers, with three distinct scenario seeds per provider, no skipped or missing tests, and a completed matrix. Evidence must be no more than seven days old and match the current source fingerprint. Changing source while the matrix runs invalidates the evidence. A repeated run with the same seed does not add seed coverage. These are engineering acceptance thresholds, not statistical reliability guarantees. This command must be used by the release process; it does not automatically block an unrelated packaging command.

The Workbench scenario must still compile, pass its generated tests, satisfy its rubric and runtime contract, and pass deployed interactions. Full logs and workspace snapshots remain in artifacts; console errors summarize the failures. Controlled IPC regressions do not substitute for live-provider evidence. Passing this AI-specific gate also does not certify unrelated application features, platform coverage or security.
