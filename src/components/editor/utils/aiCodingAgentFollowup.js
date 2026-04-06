function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function extractPluginFileReferences(text = "") {
    const matches = String(text || "").match(/(?:\/[A-Za-z0-9._/-]+\.(?:[cm]?[jt]sx?|json|md)|\b[A-Za-z0-9._/-]+\.(?:[cm]?[jt]sx?|json|md)\b)/g) || [];
    return Array.from(new Set(matches))
        .filter((item) => item.startsWith("/") || !item.startsWith("src/"))
        .slice(0, 4);
}

function isExistingPluginFileFollowUp(prompt = "", previousResponse = "") {
    const normalizedPrompt = normalizeText(prompt);
    const referencedFiles = extractPluginFileReferences(previousResponse);
    if (referencedFiles.length === 0) {
        return false;
    }

    const existingFileSignals = [
        "render",
        "render.ts",
        "render.tsx",
        "index.ts",
        "metadata",
        "plugin name",
        "display name",
        "heading",
        "title",
        "ui",
        "screen",
        "view",
        "also",
    ];
    const mutationSignals = [
        "change",
        "rename",
        "update",
        "edit",
        "modify",
        "align",
        "set",
        "fix",
        "patch",
        "apply",
        "use",
    ];

    return existingFileSignals.some((signal) => normalizedPrompt.includes(signal))
        && mutationSignals.some((signal) => normalizedPrompt.includes(signal));
}

export function extractSuggestedNextStep(previousResponse = "") {
    const text = String(previousResponse || "").trim();
    if (!text) return "";

    const strippedText = text
        .replace(/```[\s\S]*?```/g, "\n")
        .replace(/\/\/\s*SOLUTION READY TO APPLY[\s\S]*$/im, "\n")
        .replace(/(?:^|\n)File:\s+[^\n]+/g, "\n")
        .trim();

    const alsoMatch = strippedText.match(/if you want,\s*i can also\s+(.+?)(?:[.?!]\s|$)/i);
    if (alsoMatch?.[1]) {
        return alsoMatch[1].trim();
    }

    const updateMatch = strippedText.match(/(?:^|\n)(update|change|rename|align|set|fix|patch)\s+(.+?)(?:[.?!]\s|$)/i);
    if (updateMatch?.[0]) {
        return updateMatch[0].trim();
    }

    const firstSentence = strippedText
        .split(/\n+/)
        .map((line) => line.trim())
        .find((line) => line && !/^```/.test(line) && !/^(typescript|tsx|jsx|javascript|json)$/i.test(line)) || "";
    return firstSentence.trim();
}

export function isAffirmativeContinuationPrompt(prompt = "") {
    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt) return false;

    return /^(?:oh[,.\s]*)?(?:okay|ok|cool|great|nice|yes|yep|sure|please|thanks|thank you)\b/.test(normalizedPrompt)
        || /\bplease do\b/.test(normalizedPrompt)
        || /\bdo it\b/.test(normalizedPrompt)
        || /\bgo ahead\b/.test(normalizedPrompt);
}

export function buildAiCodingFollowUpDraft(previousResponse = "") {
    const nextStep = extractSuggestedNextStep(previousResponse);
    if (!nextStep) {
        return "";
    }
    return `Please continue with this plugin-local next step: ${nextStep}`;
}

export function shouldTreatAsAiCodingFollowUp({ prompt = "", previousResponse = "", forceFollowUp = false } = {}) {
    if (forceFollowUp) {
        return true;
    }

    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt || !normalizeText(previousResponse)) {
        return false;
    }

    const followUpSignals = [
        "okay",
        "ok",
        "great",
        "nice",
        "cool",
        "thanks",
        "thank you",
        "please",
        "now",
        "next",
        "continue",
        "go on",
        "let's do that",
        "do that",
        "create todo",
        "make a todo",
        "implement it",
        "do it",
        "based on that",
        "use that",
        "proceed",
    ];

    if (/^[.?!\s]+$/.test(normalizedPrompt)) {
        return true;
    }

    const hasFollowUpSignal = followUpSignals.some((signal) => {
        const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        return new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i").test(normalizedPrompt);
    });

    if (normalizedPrompt.length <= 160 && hasFollowUpSignal) {
        return true;
    }

    return false;
}

export function buildAiCodingFollowUpPrompt({ prompt = "", previousResponse = "", forceFollowUp = false } = {}) {
    if (!shouldTreatAsAiCodingFollowUp({ prompt, previousResponse, forceFollowUp })) {
        return prompt;
    }

    const files = extractPluginFileReferences(previousResponse);
    const nextStep = extractSuggestedNextStep(previousResponse);
    const constrainToExistingFiles = isExistingPluginFileFollowUp(prompt, previousResponse);
    const noScaffoldInstruction = constrainToExistingFiles
        ? "Stay within the existing plugin workspace. Update existing plugin files only. Do not scaffold a new plugin and do not create files like /package.json or /tsconfig.json unless the user explicitly asks for them."
        : "";

    if (isAffirmativeContinuationPrompt(prompt) && nextStep) {
        return [
            "Continue the previously suggested plugin-local next step.",
            noScaffoldInstruction,
            files.length > 0 ? `Relevant plugin files: ${files.join(", ")}.` : "",
            `Previously suggested next step: ${nextStep}`,
            `User confirmed: ${prompt}`,
        ].filter(Boolean).join("\n");
    }

    return [
        "Continue this existing plugin-local thread.",
        noScaffoldInstruction,
        nextStep ? `Previous AI response summary: ${nextStep}` : `Previous AI response summary:\n${previousResponse}`,
        files.length > 0 ? `Relevant plugin files: ${files.join(", ")}.` : "",
        `Follow-up request: ${prompt}`,
    ].filter(Boolean).join("\n");
}
