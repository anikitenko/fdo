function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

export function isAiCodingFastLocalEditPrompt(prompt = "", action = "") {
    const normalizedPrompt = normalizeText(prompt);
    const normalizedAction = normalizeText(action);
    if (!normalizedPrompt) return false;

    const explicitLocalEdit =
        /\b(change|rename|set|update|edit|modify|replace|fix|patch|apply|make|use|choose|pick)\b/.test(normalizedPrompt)
        && /\b(metadata|plugin(?:'s)?\s+name|display\s+name|icon|author|description|version|heading|title|render|ui|screen|view)\b/.test(normalizedPrompt);

    const heavyGuidanceSignals = [
        "best practice",
        "best practices",
        "production grade",
        "production-grade",
        "sdk",
        "according to sdk",
        "security",
        "capabilities",
        "privileged",
        "architecture",
        "design pattern",
        "refactor broadly",
        "across the project",
        "throughout the plugin",
        "whole codebase",
    ];

    if (!["smart", "generate", "edit", "fix"].includes(normalizedAction)) {
        return false;
    }

    return explicitLocalEdit && !heavyGuidanceSignals.some((signal) => normalizedPrompt.includes(signal));
}
