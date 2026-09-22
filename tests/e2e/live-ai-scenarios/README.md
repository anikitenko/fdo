# Live AI scenarios

Each scenario owns its full workspace-generation, validation, deployment, interaction, and screenshot flow. The shared Electron setup stays in `../ai-coding-agent.live.spec.js`, so every scenario uses the same isolated profile and dedicated test provider credentials.

To add a scenario:

1. Add its prompt and deterministic seed to `src/utils/pluginAuthoringScenarioCatalog.js`.
2. Add a focused static rubric in `../helpers/pluginScenarioRubric.cjs` and unit coverage in `tests/unit`.
3. Copy the closest runner in this directory, rename its exported `run…LiveScenario` function, and define its screenshots and interaction assertions.
4. Import the runner, add a small scenario-specific dependency factory, and add one `test.describe` registration in `../ai-coding-agent.live.spec.js`.
5. Run it alone with `npm run test:ai:live -- --grep "Your Scenario Name"`.

Keep real provider requests limited to the final live command. Unit tests should exercise the rubric and scenario selection without provider access.

The current visual scenarios are `JSON Inspector`, `Rose Calculator`, and `Web Tools Workbench`. Each writes stable screenshots under `artifacts/live-ai` so a successful run can be inspected without opening Playwright's transient attachment directory.
