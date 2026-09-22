export function isWorkspaceQualityReviewPrompt(prompt = "") {
    return /\bworkspace quality review\b/i.test(String(prompt || ""));
}

export const WORKSPACE_REVIEW_PROMPT = [
    "Workspace quality review.",
    "Run the plugin tests and investigate any failing tests.",
    "Review the complete current plugin workspace, build output, and Problems panel.",
    "Report only confirmed plugin-local issues, ordered by severity with the affected file and a concrete repair plan.",
    "Do not modify files in this review-first request.",
].join(" ");

export const WORKSPACE_REPAIR_PROMPT = [
    "Workspace quality review.",
    "Run the plugin tests and investigate any failing tests.",
    "Review the complete current plugin workspace, build output, and Problems panel.",
    "Automatically repair confirmed plugin-local issues, preserving working behavior and the public plugin SDK contract.",
    "Re-run plugin tests after each repair and stop when the workspace is clean or when a remaining issue needs a developer decision.",
].join(" ");
