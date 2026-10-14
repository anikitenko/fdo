# Scoped Workbench test repairs

The recorded 59/73 request failure came from a repair that attempted another workspace inventory. The workspace had already passed its rubric and runtime checks; seven test failures remained. A broad repair also regressed previously passing acceptance checks.

For this tests-only case, the convergence helper resolves the failing test files and follows their local implementation imports/re-exports. It sends those implementation paths as an explicit `WORKSPACE_REPAIR_PATHS: [...]` first-line constraint. Tests, stylesheets, registration and unrelated actions are retained. Unknown test owners, unresolved imports, syntax errors or concurrent build/rubric/SDK/editor failures do not get a guessed scope.

The editor forwards that constraint separately from conversation context and routes it as a plan request. Native callers may also provide the directive directly. The backend validates that every path exists, then uses the existing targeted generation path: no new inventory, one request per selected file, ordinary source checks and bounded repair retries. The editor rejects output outside the requested scope and retains the scope during validation retries. All tests and acceptance checks still run after application.

The recorded dependency graph selects seven implementation files. Regression coverage admits those seven requests from 59/73 used, ending at 66/73 without increasing the ceiling. The native IPC test separately verifies seven file requests within a fourteen-request budget. Those controlled responses verify scope and accounting, not live model correctness or a full passing Workbench run.

Relevant tests: `tests/unit/workspace-repair-scope.test.js`, the scoped case in `AiCodingAgentPanel.test.jsx`, and `tests/e2e/workbench-test-repair-scope.spec.js`.
