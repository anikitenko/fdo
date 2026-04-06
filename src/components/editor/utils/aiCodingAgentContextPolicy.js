import { isAiCodingFastLocalEditPrompt } from "./aiCodingAgentFastPath.js";

function normalizeText(value = "") {
    return String(value || "").toLowerCase();
}

export function shouldIncludeProjectContext({
    action = "",
    prompt = "",
    selectedCode = "",
    currentFileContext = "",
    sdkKnowledgeEnabled = false,
    externalReferenceEnabled = false,
} = {}) {
    const normalizedAction = normalizeText(action);
    const promptHaystack = normalizeText(prompt);
    const fastLocalEdit = isAiCodingFastLocalEditPrompt(prompt, action);

    if (selectedCode && selectedCode.trim()) {
        return true;
    }

    const taskExecutionSignals = [
        "proceed with implementation",
        "continue with implementation",
        "implement from todo",
        "continue from todo",
        "work through todo",
        "todo.md",
        "plan.md",
        "checklist",
        "current plugin",
        "this plugin",
        "my plugin",
        "current implementation",
        "existing plugin",
        "plugin implementation",
        "according to sdk",
        "best practice",
        "production grade",
    ];

    if (normalizedAction === "plan" && taskExecutionSignals.some((signal) => promptHaystack.includes(signal))) {
        return true;
    }

    if (normalizedAction !== "smart" && normalizedAction !== "generate") {
        return false;
    }

    const codebaseSignals = [
        "this project",
        "this codebase",
        "current project",
        "current file",
        "this plugin",
        "in this plugin",
        "in this app",
        "refactor",
        "edit",
        "modify",
        "update",
        "integrate",
        "wire up",
        "add to existing",
        "use existing",
        "implement here",
        "continue the previously suggested plugin-local next step",
        "relevant plugin files:",
        "previously suggested next step:",
    ];

    const explicitMutationIntent = /\b(create|build|generate|implement|scaffold|add|edit|refactor|rewrite|update|fix|patch|replace|modify|apply|make|change|rename|set|use|choose|pick)\b/.test(promptHaystack);
    const pluginFileTargetSignals = [
        "metadata",
        "plugin name",
        "plugin's name",
        "display name",
        "fdo.meta.json",
        "package.json",
        "index.ts",
        "render.ts",
        "render.tsx",
        "ui heading",
        "screen",
        "view",
    ];

    if (
        currentFileContext &&
        explicitMutationIntent &&
        pluginFileTargetSignals.some((signal) => promptHaystack.includes(signal))
    ) {
        return true;
    }

    if (fastLocalEdit && currentFileContext) {
        return true;
    }

    if (codebaseSignals.some((signal) => promptHaystack.includes(signal))) {
        return true;
    }

    if (externalReferenceEnabled) {
        return false;
    }

    // SDK awareness should not automatically turn a product/ideation prompt
    // into a codebase audit. Only explicit "this project/current file" signals
    // or selected code should pull current workspace files into the request.
    if (sdkKnowledgeEnabled) {
        return false;
    }

    return false;
}
