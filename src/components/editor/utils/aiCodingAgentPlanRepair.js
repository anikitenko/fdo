import {sanitizeVirtualWorkspacePath} from "./aiCodingAgentWorkspacePath";
import {parseAiWorkspacePlanResponse} from "./aiCodingAgentPlanResponse";

export function getValidationRepairPaths(errors, files) {
    const available = new Set(files.map(file => file.path));
    const owners = errors.map(error => /^(\/[^:\n]+):/.exec(String(error))?.[1]);
    if (!owners.length || !owners.every(path => available.has(path))) return [];
    const paths = [...new Set(owners)];
    if (!errors.some(error => /^\/[^:\n]+: Generated tests failed\b/.test(String(error)))) return paths;
    // Tests must see the repaired implementations, rather than contracts that
    // will change later in this same sequential repair. Preserve scope and the
    // relative order within each group; ordinary source diagnostics keep theirs.
    const isTest = path => /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
    return [...paths.filter(path => !isTest(path)), ...paths.filter(isTest)];
}

export function mergeValidationRepairResponse(originalFiles, response, repairPaths) {
    const parsed = parseAiWorkspacePlanResponse(response);
    if (parsed.invalidPaths.length || parsed.files.some(file => !repairPaths.includes(file.path))
        || new Set(parsed.files.map(file => file.path)).size !== parsed.files.length
        || repairPaths.some(path => !parsed.files.some(file => file.path === path))) {
        throw new Error('Validation repair must return exactly the requested files. No generated files were applied.');
    }
    const merged = new Map(originalFiles.map(file => [file.path, file]));
    parsed.files.forEach(file => merged.set(file.path, file));
    return [...merged.values()].map(file => `### File: ${file.path}\n\`\`\`${file.language || ''}\n${file.content}\n\`\`\``).join('\n\n');
}

// Only diagnostic owners in the current virtual workspace are repair targets.
// Paths merely mentioned inside diagnostic prose are context, not edit grants.
export function getProblemsRepairPaths(problemsContext, workspaceFiles = []) {
    const available = new Set(workspaceFiles.map(file => file.path));
    return [...new Set(String(problemsContext || "").split("\n").flatMap(line => {
        const path = /^(\/[^:\n]+):\d+:\d+\s+\[\d+\]/.exec(line)?.[1];
        return path && sanitizeVirtualWorkspacePath(path) === path && available.has(path) ? [path] : [];
    }))];
}

export function buildExecutablePlanRetryPrompt({
    originalPrompt = "",
    invalidResponse = "",
} = {}) {
    const trimmedInvalidResponse = String(invalidResponse || "").trim();
    const invalidPreview = trimmedInvalidResponse.length > 4000
        ? `${trimmedInvalidResponse.slice(0, 4000)}\n...[truncated]`
        : trimmedInvalidResponse;

    return `${originalPrompt}

IMPORTANT RETRY INSTRUCTION:
Your previous response was not valid for FDO plan execution because it did not return executable workspace file sections.

Previous invalid response:
${invalidPreview}

You must now return ONLY executable workspace file sections in this format:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

Do not return prose, bullets, explanations, or plan overviews.
Do not return partial snippets.
Do not omit required files if the implementation depends on them.
Use only virtual workspace paths.`;
}

export function buildValidationRepairPlanPrompt({
    originalPrompt = "",
    invalidResponse = "",
    validationErrors = [],
    repairPaths = [],
} = {}) {
    const trimmedInvalidResponse = String(invalidResponse || "").trim();
    const invalidPreview = trimmedInvalidResponse.length > 4000
        ? `${trimmedInvalidResponse.slice(0, 4000)}\n...[truncated]`
        : trimmedInvalidResponse;
    const normalizedErrors = Array.isArray(validationErrors)
        ? validationErrors.filter(Boolean).map((entry) => `- ${String(entry)}`)
        : [];
    const errorsBlock = normalizedErrors.length > 0
        ? normalizedErrors.join("\n")
        : "- Unknown validation error";

    return `${originalPrompt}

IMPORTANT RETRY INSTRUCTION:
Your previous response failed FDO plugin validation and must be corrected.

Validation errors:
${errorsBlock}

${repairPaths.length ? `Candidate workspace source is supplied separately. Repair only these diagnostic owners: ${JSON.stringify(repairPaths)}. All other candidate files are retained unchanged. Do not replan the workspace or create files. Preserve every requested feature and existing public interface. Diagnostic owners may include retained workspace tests: if they still assert the starter UI that this task replaces, update them to verify the requested replacement behavior and its current interface. Keep meaningful assertions; do not delete or skip tests, add dummy reads, or change the new implementation merely to satisfy obsolete starter expectations.` : `Previous invalid response:\n${invalidPreview}`}

Return ONLY executable workspace file sections:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

Hard requirements:
- Do not import FDO host/editor implementation files (components/editor/*, components/plugin/*, ipc/*, VirtualFS.js, PluginContainer.jsx, PluginPage.jsx, pluginTestRunner.js, validateGeneratedPluginFiles.js).
- Rendered HTML must retain correct escaping. Compare visible text after parsing HTML, or encode expected text for an HTML-source assertion; never remove escaping to satisfy a raw string comparison. CSS class checks must inspect selectors, not scan comments, declaration values, URLs or embedded SVG for dot-prefixed words. Preserve meaningful assertions for real labels and selectors.
- Verify each failing assertion against its literal input, fixture bytes, test name, original requirements and the implementation before deciding which side is wrong. Generated tests are evidence, not an infallible specification. If a fixture contradicts its label, correct the fixture or expectation and retain the assertion's intended coverage. Do not change correct implementation behavior to satisfy a mistaken expected value.
- For assertions on multiline output, verify regex flags and the exact asserted line: ^ and $ match only the whole string boundaries unless the m flag is present. An indentation check on pretty JSON must inspect a property line (or compare against JSON.stringify of the parsed fixture with the required indentation), not require the document to start with spaces. Preserve valid JSON, the required indentation, and round-trip assertions.
- Compute independently checkable expectations from the fixture: document order comes from source positions, image dimensions from decoded header bytes, and JSON validity from its actual delimiters. For human-readable errors, assert the error category and useful detail instead of an incidental phrase unless exact wording is required. Keep genuinely invalid-input cases invalid; do not remove exception assertions.
- Runtime test failures include failing tests and their direct implementation dependencies. Fix missing imports and test setup, or incorrect implementation behavior; do not weaken assertions to match a bug. Define ambiguous behavior consistently with the original requirements and add boundary coverage.
- Browser fixtures must provide the exact globals the implementation accesses: mocking globalThis.localStorage alone does not provide window.localStorage in Node. Install and restore the required fixture explicitly; do not mistake swallowed missing-global errors for working persistence. Verify unknown-ID rejection and returned toggle state against the registry, and retain persistence round-trip assertions.
- TypeScript errors must be fixed against the installed SDK declarations. Preserve strict checking: no any casts, @ts-ignore, dummy reads, or disabling compiler checks. For unused symbols, wire intended functionality or remove genuinely obsolete declarations while retaining initializer side effects. For union properties, narrow to the response variant that actually supplies the property before reading it.
- Do not redeclare SDK-owned Window bridge properties with different types or optional modifiers; use the installed ambient declaration. SDK interface implementations need compatible method return types (for example, annotate declareCapabilities with the imported PluginCapability[] type and use only valid capabilities, rather than widening literals to string[]).
- PluginRegistry is an SDK export, not a global. Import runtime values explicitly; typeof import(...) supplies types only.
- Node tests have no Electron process.parentPort bridge. Prefer testing pure render/logic modules. If testing a plugin class, establish a faithful bridge fixture before dynamically importing its entry; static entry imports execute the plugin before test hooks.
- Plugin tests must use node:test imports and node:assert/strict assertions.
- Do not use Jest/Vitest globals or expect().
- Use virtual workspace paths only.
- Do not return prose, bullets, explanations, or partial snippets.`;
}

export function buildProblemsRepairPlanPrompt({
    originalPrompt = "",
    previousResponse = "",
    problemsContext = "",
    workspaceFiles,
} = {}) {
    const response = String(previousResponse || "").trim();
    const diagnostics = String(problemsContext || "").trim() || "Current editor problems were reported without diagnostic text.";

    const repairPaths = getProblemsRepairPaths(diagnostics, workspaceFiles);
    const currentSource = Array.isArray(workspaceFiles)
        ? `Workspace source is supplied separately by the host. Existing paths: ${JSON.stringify(workspaceFiles.map(file => file.path))}.`
        : response;
    return `EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION

IMPORTANT REPAIR INSTRUCTION:
The workspace files from your previous response were applied, and the Editor Problems panel now reports errors. Correct every listed error while preserving the requested plugin behavior.
This is a focused repair of the existing workspace, not a new scaffold. Use the installed @anikitenko/fdo-sdk for every plugin API. Return only files that must change to resolve the diagnostics, including directly affected dependencies. Keep unaffected files and their public interfaces unchanged. Do not regenerate the entire workspace or add a new feature-module architecture. Complete any missing implementations required by the diagnostics; do not replace them with stubs.

${repairPaths.length ? `Host-selected repair files: ${JSON.stringify(repairPaths)}. Return only these files. Other files remain immutable; do not re-plan, split or regenerate their code or styles.` : ''}

Problems panel diagnostics:
${diagnostics}

Complete previously applied workspace response (retain unchanged files; this is the latest source for these paths and supersedes older context):
${currentSource}

Original acceptance requirements (reference only, NOT a request to rebuild the workspace):
${originalPrompt}

Return ONLY complete executable workspace file sections for every file you change:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

Do not return prose, partial snippets, host/editor imports, Jest/Vitest globals, or external dependencies. Plugin tests must use node:test and node:assert/strict.`;
}
