function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function scoreSignals(haystack, signals = []) {
    return signals.reduce((score, signal) => (
        haystack.includes(signal) ? score + 1 : score
    ), 0);
}

export function detectAiCodingPragmaticIntent({ prompt = "", previousResponse = "" } = {}) {
    const normalizedPrompt = normalizeText(prompt);
    const normalizedPrevious = normalizeText(previousResponse);
    const combined = [normalizedPrompt, normalizedPrevious].filter(Boolean).join("\n");
    const isAdvisoryTestQuestion =
        /\bhow\b.*\btests?\b.*\b(work|working|run|running)\b/.test(normalizedPrompt)
        || /\bhow do\b.*\btests?\b/.test(normalizedPrompt)
        || /\bwhat\b.*\btests?\b.*\b(do|does|are)\b/.test(normalizedPrompt)
        || /\bcan you explain\b.*\btests?\b/.test(normalizedPrompt);

    const fixSignals = [
        "fix",
        "broken",
        "error",
        "not working",
        "repair",
        "problem",
        "problems",
        "failing test",
        "failing tests",
        "tests are failing",
        "test is failing",
        "build failed",
        "build is failing",
    ];
    const executeSignals = [
        "please do it",
        "do it",
        "proceed",
        "continue",
        "implement",
        "apply it",
        "make the changes",
        "update the code",
    ];
    const advisorySignals = [
        "can you help",
        "brainstorm",
        "think through",
        "recommend",
        "suggest",
        "what should",
        "how should",
    ];
    const verificationSignals = [
        "test steps",
        "steps to test",
        "how to test",
        "what to test",
        "before marking",
        "before mark",
        "before marking as completed",
        "manual test",
        "verification steps",
        "after my testing",
        "after testing",
        "don't mark done",
        "do not mark done",
        "not mark done",
    ];
    const lowRewriteSignals = [
        "don't rewrite",
        "do not rewrite",
        "don't change too much",
        "do not change too much",
        "small fix",
        "minimal change",
        "surgical",
        "keep existing code",
        "preserve",
    ];
    const fileUpdateSignals = [
        "mark completed",
        "mark as done",
        "update todo",
        "todo",
        "todo.md",
        "checklist",
    ];

    const fixScore = scoreSignals(combined, fixSignals);
    const executeScore = scoreSignals(combined, executeSignals);
    const advisoryScore = scoreSignals(combined, advisorySignals);
    const verificationScore = scoreSignals(combined, verificationSignals);
    const lowRewriteScore = scoreSignals(combined, lowRewriteSignals);
    const fileUpdateScore = scoreSignals(combined, fileUpdateSignals);

    let primaryIntent = "advisory";
    if (!isAdvisoryTestQuestion && fixScore > 0 && fixScore >= advisoryScore) {
        primaryIntent = "fix";
    } else if (executeScore > 0 && executeScore >= advisoryScore) {
        primaryIntent = "execute";
    }

    const verificationOnly = verificationScore > 0 && fixScore === 0 && executeScore === 0;
    const rewriteTolerance = lowRewriteScore > 0 ? "low" : "normal";
    const autoMarkDoneAllowed = verificationScore === 0;
    const wantsFileUpdate = fileUpdateScore > 0;

    return {
        primaryIntent,
        verificationOnly,
        advisoryIntent: advisoryScore > 0,
        executionIntent: executeScore > 0 || fixScore > 0,
        verificationIntent: verificationScore > 0,
        rewriteTolerance,
        autoMarkDoneAllowed,
        wantsFileUpdate,
    };
}
