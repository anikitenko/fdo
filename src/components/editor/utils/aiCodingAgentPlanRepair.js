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

Previous invalid response:
${invalidPreview}

Return ONLY executable workspace file sections:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

Hard requirements:
- Do not import FDO host/editor implementation files (components/editor/*, components/plugin/*, ipc/*, VirtualFS.js, PluginContainer.jsx, PluginPage.jsx, pluginTestRunner.js, validateGeneratedPluginFiles.js).
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

    const currentSource = Array.isArray(workspaceFiles) ? JSON.stringify(workspaceFiles) : response;
    return `EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION

IMPORTANT REPAIR INSTRUCTION:
The workspace files from your previous response were applied, and the Editor Problems panel now reports errors. Correct every listed error while preserving the requested plugin behavior.
This is a focused repair of the existing workspace, not a new scaffold. Return only files that must change to resolve the diagnostics, including directly affected dependencies. Keep unaffected files and their public interfaces unchanged. Do not regenerate the entire workspace or add a new feature-module architecture. Complete any missing implementations required by the diagnostics; do not replace them with stubs.

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
