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
