export function buildSingleFileApplyRetryPrompt({
    originalPrompt = "",
    invalidResponse = "",
    action = "fix",
    applyFailure = "",
    currentFilePath = "",
    preferFullFileRewrite = false,
    hasSelection = false,
} = {}) {
    const trimmedInvalidResponse = String(invalidResponse || "").trim();
    const invalidPreview = trimmedInvalidResponse.length > 3000
        ? `${trimmedInvalidResponse.slice(0, 3000)}\n...[truncated]`
        : trimmedInvalidResponse;
    const normalizedFailure = String(applyFailure || "").trim();
    const normalizedFilePath = String(currentFilePath || "").trim();

    return `${originalPrompt}

IMPORTANT RETRY INSTRUCTION:
Your previous response was too partial to apply safely to the ${hasSelection ? "selected code" : "target file"}.
It looked like a recommendation or small snippet instead of an executable ${action} for the ${hasSelection ? "selected region" : "target file"}.
${normalizedFailure ? `The previous apply attempt failed with: ${normalizedFailure}` : ""}
${normalizedFilePath ? `Target file: ${normalizedFilePath}` : ""}

Previous invalid response:
${invalidPreview}

You must now return ONE of these valid outputs:
1. Exact SEARCH/REPLACE patch blocks that match the target code precisely
2. A full rewrite of the entire ${(preferFullFileRewrite || !hasSelection) ? "target file" : "selected code region"}

Rules:
- Do NOT return general recommendations, review comments, or summaries
- Do NOT return a tiny example snippet for a larger ${hasSelection ? "selected region" : "target file"}
- Preserve unrelated logic and structure
- Fix only what is necessary unless the ${(preferFullFileRewrite || !hasSelection) ? "file" : "selected region"} clearly needs a full rewrite
- Every SEARCH/REPLACE block must include a File: /path/to/file line immediately before the block
- Every File: path must be a virtual workspace path like /index.ts or /tests/unit/example.test.js, never a host path like /Users/... or /tmp/...
- If using SEARCH/REPLACE, the SEARCH text must match the target code exactly
${(preferFullFileRewrite || !hasSelection) ? "- Prefer a full corrected file rewrite over vague repeated SEARCH blocks if the file contains repeated patterns or no selection was provided." : ""}
${/matched multiple locations/i.test(normalizedFailure) ? "- Your previous SEARCH block was too broad. Use more specific SEARCH context or return the full corrected target instead." : ""}`;
}
