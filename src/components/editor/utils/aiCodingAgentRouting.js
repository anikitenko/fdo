import {detectAiCodingPragmaticIntent} from "./aiCodingAgentPragmaticIntent.js";
import {hasHostAppFileReference} from "./aiCodingAgentScopeBoundary.js";

function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function isPoliteMutationQuestion(prompt = "") {
    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt) return false;
    const startsLikeQuestion = /^(can|could|would|will)\b/.test(normalizedPrompt) || /\?$/.test(String(prompt || "").trim());
    if (!startsLikeQuestion) return false;
    return /\b(make|change|rename|set|update|fix|edit|add|create|build|generate|implement|replace|modify|use|choose|pick)\b/.test(normalizedPrompt);
}

export function normalizeAiCodingAction(value = "") {
    const normalized = normalizeText(value);
    return ["smart", "generate", "edit", "explain", "fix", "plan"].includes(normalized)
        ? normalized
        : "smart";
}

export function isMutatingAiCodingAction(action = "") {
    return ["generate", "edit", "fix", "plan"].includes(normalizeAiCodingAction(action));
}

export function isQuestionLikeAiCodingPrompt(prompt = "") {
    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt) return false;
    if (isPoliteMutationQuestion(prompt)) return false;
    return /\?$/.test(String(prompt || "").trim())
        || /^(can|could|would|what|why|how|is|are|does|do|did|should|will|where|when)\b/.test(normalizedPrompt);
}

export function isConfirmationLikeAiCodingPrompt(prompt = "") {
    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt) return false;
    return normalizedPrompt.length <= 180 && [
        "yes",
        "yeah",
        "yep",
        "sure",
        "ok",
        "okay",
        "please do it",
        "do it",
        "do that",
        "go ahead",
        "make those changes",
        "apply those changes",
        "continue",
        "proceed",
    ].some((signal) => normalizedPrompt.includes(signal));
}

export function isNewPluginCreationRequest(prompt = "") {
    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt) return false;

    const mentionsPlugin = /\bplugin\b|плагін/iu.test(normalizedPrompt);
    const creationIntent = /\b(?:create|build|generate|implement|write)\s+(?:(?:a|an|the|new)\s+)?(?:[\w-]+\s+){0,4}plugin\b|\bmake\s+(?:a|an|the|new)\s+(?:[\w-]+\s+){0,4}plugin\b|\b(?:i want|i need|want)\s+(?:a|an|new|this)\s+plugin\b|(?:хочу\s+(?:(?:такий|новий|цей)\s+)?плагін|створи(?:ти)?|зроби(?:ти)?|згенеруй|побудуй|напиши)/iu.test(normalizedPrompt);
    // A creation brief often says "this plugin" later when describing its UI.
    // Treat that phrase as existing-workspace context only when the prompt did
    // not already establish that it is creating a plugin.
    const existingPluginIntent = /\b(?:current|existing|my)\s+plugin\b|(?:мій|поточний)\s+плагін/iu.test(normalizedPrompt)
        || (!creationIntent && /\bthis\s+plugin\b|цей\s+плагін/iu.test(normalizedPrompt));
    const troubleshootingIntent = /\b(?:fix|debug|diagnos(?:e|is)|troubleshoot|repair)\b|(?:виправ|діагност)/iu.test(normalizedPrompt);
    const explicitScaffoldIntent = /\b(?:plugin scaffold|scaffold plugin|new plugin scaffold)\b/iu.test(normalizedPrompt);
    const metadataEditIntent = /\b(?:metadata|name|description|version|icon|author)\b/iu.test(normalizedPrompt);
    // A complete creation brief commonly defines metadata too. Treat metadata
    // as an edit-only signal only when the prompt did not ask to create a plugin.
    const metadataOnlyEditIntent = metadataEditIntent && !creationIntent;

    return mentionsPlugin && creationIntent && !existingPluginIntent && !troubleshootingIntent && !explicitScaffoldIntent && !metadataOnlyEditIntent;
}

export function shouldUseAiRoutingJudge({
    requestedAction = "smart",
    prompt = "",
    selectedCode = "",
    deterministicAction = "smart",
    createProjectFiles = false,
    executeWorkspacePlan = false,
} = {}) {
    const normalizedRequested = normalizeAiCodingAction(requestedAction);
    const normalizedDeterministic = normalizeAiCodingAction(deterministicAction);
    const pragmaticIntent = detectAiCodingPragmaticIntent({ prompt });
    const questionLike = isQuestionLikeAiCodingPrompt(prompt);
    const confirmationLike = isConfirmationLikeAiCodingPrompt(prompt);
    const explicitMutation = normalizedRequested !== "smart" && isMutatingAiCodingAction(normalizedRequested);
    const mutatingRisk = isMutatingAiCodingAction(normalizedDeterministic) || createProjectFiles || executeWorkspacePlan;
    const hasSelectedCode = !!String(selectedCode || "").trim();

    if (hasSelectedCode && !questionLike && !confirmationLike) {
        return false;
    }

    if (normalizedRequested !== "smart" && !explicitMutation) {
        return false;
    }

    if (pragmaticIntent.executionIntent && !questionLike && !confirmationLike) {
        return false;
    }

    if (mutatingRisk && !questionLike && !confirmationLike && !hasSelectedCode) {
        return false;
    }

    return confirmationLike || questionLike || explicitMutation || mutatingRisk;
}

function normalizeJudgeIntent(intent = {}) {
    return {
        isQuestion: !!intent?.isQuestion,
        asksForCodeChange: !!intent?.asksForCodeChange,
        asksForFileCreation: !!intent?.asksForFileCreation,
        asksForPlanExecution: !!intent?.asksForPlanExecution,
        isFollowupConfirmation: !!intent?.isFollowupConfirmation,
    };
}

function judgeLooksNonMutating(judge = {}) {
    const intent = normalizeJudgeIntent(judge.intent);
    return intent.isQuestion || (
        !intent.asksForCodeChange
        && !intent.asksForFileCreation
        && !intent.asksForPlanExecution
    );
}

function judgeExplicitlyRequestsMutation(judge = {}) {
    const intent = normalizeJudgeIntent(judge.intent);
    return intent.asksForCodeChange || intent.asksForFileCreation || intent.asksForPlanExecution;
}

export function mergeAiCodingRouteDecision({
    requestedAction = "smart",
    prompt = "",
    deterministicAction = "smart",
    judge = null,
    createProjectFiles = false,
    executeWorkspacePlan = false,
} = {}) {
    const explicitAction = normalizeAiCodingAction(requestedAction);
    const normalizedDeterministic = normalizeAiCodingAction(deterministicAction);
    if (explicitAction !== "smart") {
        return {
            action: explicitAction,
            createProjectFiles,
            executeWorkspacePlan,
            usedJudge: false,
            downgraded: false,
            reason: "explicit-action",
        };
    }

    const baseDecision = {
        action: normalizedDeterministic,
        createProjectFiles,
        executeWorkspacePlan,
        usedJudge: false,
        downgraded: false,
        reason: "deterministic",
    };

    if (!judge || judge.available === false) {
        if (isMutatingAiCodingAction(normalizedDeterministic) && isQuestionLikeAiCodingPrompt(prompt)) {
            return {
                ...baseDecision,
                action: "smart",
                createProjectFiles: false,
                executeWorkspacePlan: false,
                downgraded: true,
                reason: "question-safe-downgrade",
            };
        }
        return baseDecision;
    }

    const judgeRoute = normalizeAiCodingAction(judge.route);
    const judgeConfidence = Number(judge.confidence);
    if (!Number.isFinite(judgeConfidence) || judgeConfidence < 0.72) {
        return {
            ...baseDecision,
            action: isMutatingAiCodingAction(normalizedDeterministic) && isQuestionLikeAiCodingPrompt(prompt)
                ? "smart"
                : baseDecision.action,
            createProjectFiles: isMutatingAiCodingAction(normalizedDeterministic) && isQuestionLikeAiCodingPrompt(prompt)
                ? false
                : baseDecision.createProjectFiles,
            executeWorkspacePlan: isMutatingAiCodingAction(normalizedDeterministic) && isQuestionLikeAiCodingPrompt(prompt)
                ? false
                : baseDecision.executeWorkspacePlan,
            usedJudge: true,
            downgraded: isMutatingAiCodingAction(normalizedDeterministic) && isQuestionLikeAiCodingPrompt(prompt),
            reason: "judge-low-confidence",
        };
    }

    const nonMutatingJudge = judgeLooksNonMutating(judge);
    if (nonMutatingJudge && isMutatingAiCodingAction(normalizedDeterministic)) {
        return {
            action: "smart",
            createProjectFiles: false,
            executeWorkspacePlan: false,
            usedJudge: true,
            downgraded: true,
            reason: "judge-blocked-mutation",
        };
    }

    if (
        judgeRoute !== normalizedDeterministic
        && isMutatingAiCodingAction(judgeRoute)
        && isMutatingAiCodingAction(normalizedDeterministic)
    ) {
        return {
            action: "smart",
            createProjectFiles: false,
            executeWorkspacePlan: false,
            usedJudge: true,
            downgraded: true,
            reason: "mutating-route-conflict",
        };
    }

    if (
        normalizedDeterministic === "smart"
        && isMutatingAiCodingAction(judgeRoute)
        && judgeConfidence >= 0.88
        && judgeExplicitlyRequestsMutation(judge)
        && !isQuestionLikeAiCodingPrompt(prompt)
    ) {
        return {
            action: judgeRoute,
            createProjectFiles: judgeRoute === "plan" ? !!judge.intent?.asksForFileCreation : false,
            executeWorkspacePlan: judgeRoute === "plan" ? !!judge.intent?.asksForPlanExecution : false,
            usedJudge: true,
            downgraded: false,
            reason: "judge-upgraded-deterministic",
        };
    }

    return {
        ...baseDecision,
        usedJudge: true,
        downgraded: false,
        reason: judgeRoute === normalizedDeterministic ? "judge-confirmed" : "judge-nonblocking",
    };
}

export function resolveAiCodingAgentAction({
    requestedAction = "smart",
    prompt = "",
    selectedCode = "",
    previousResponse = "",
    workspaceFiles = [],
} = {}) {
    const normalizedAction = normalizeAiCodingAction(requestedAction);
    if (normalizedAction !== "smart") {
        return normalizedAction || "smart";
    }

    const normalizedPrompt = normalizeText(prompt);
    const hasSelectedCode = !!(selectedCode && selectedCode.trim());
    const pragmaticIntent = detectAiCodingPragmaticIntent({ prompt, previousResponse });
    const crossesHostAppBoundary = hasHostAppFileReference([prompt, previousResponse].filter(Boolean).join("\n"), workspaceFiles);
    const newPluginCreation = isNewPluginCreationRequest(prompt);
    const isAdvisoryTestQuestion =
        /\bhow\b.*\btests?\b.*\b(work|working|run|running)\b/.test(normalizedPrompt)
        || /\bhow do\b.*\btests?\b/.test(normalizedPrompt)
        || /\bwhat\b.*\btests?\b.*\b(do|does|are)\b/.test(normalizedPrompt)
        || /\bcan you explain\b.*\btests?\b/.test(normalizedPrompt);
    const ideationSignals = [
        "can you help",
        "help me",
        "similar to",
        "better than",
        "inspired by",
        "idea",
        "ideas",
        "brainstorm",
        "compare",
        "what should",
        "how should",
    ];
    const explicitScaffoldSignals = [
        "create plugin",
        "build plugin",
        "plugin scaffold",
        "implement a plugin",
        "scaffold plugin",
        "generate plugin",
        "create a new plugin scaffold",
    ];
    const executionSignals = [
        "proceed with implementation",
        "continue with implementation",
        "implement from todo",
        "continue from todo",
        "work through todo",
        "start implementing",
        "fix my current plugin",
        "fix this plugin",
        "fix current plugin implementation",
        "fix my plugin implementation",
        "make it best practice",
        "make it production grade",
        "according to sdk",
    ];
    const failureDrivenFixSignals = [
        "tests are failing",
        "test is failing",
        "failing tests",
        "failing test",
        "build failed",
        "build is failing",
        "compile failed",
        "compile is failing",
        "problems tab",
        "current problems",
        "please fix current problems",
    ];
    const explainSignals = [
        "explain",
        "what does this do",
        "what is this doing",
        "walk me through",
        "how does this work",
    ];
    const fixSignals = [
        "fix",
        "bug",
        "error",
        "broken",
        "not working",
        "repair",
    ];
    const editSignals = [
        "edit",
        "refactor",
        "rewrite",
        "improve",
        "update",
        "change",
        "rename",
        "use",
        "choose",
        "pick",
        "clean up",
        "optimize",
    ];
    const generateSignals = [
        "generate",
        "create",
        "build",
        "add",
        "make",
        "use",
        "choose",
        "pick",
        "write code",
        "write a function",
        "write plugin",
    ];

    const generationSignals = ["build", "create", "implement", "scaffold", "generate"];

    // A creation prompt can contain words such as "error" while describing UI
    // states. It must not become a selected-code Fix request just because the
    // editor happens to have a cursor selection.
    if (newPluginCreation && !crossesHostAppBoundary) {
        return "smart";
    }

    if (hasSelectedCode) {
        if (pragmaticIntent.verificationOnly) {
            return "smart";
        }
        if (explainSignals.some((signal) => normalizedPrompt.includes(signal))) {
            return "explain";
        }
        if (fixSignals.some((signal) => normalizedPrompt.includes(signal)) || pragmaticIntent.primaryIntent === "fix") {
            return "fix";
        }
        if (editSignals.some((signal) => normalizedPrompt.includes(signal))) {
            return "edit";
        }
        return "smart";
    }

    const hasExplicitScaffoldIntent = explicitScaffoldSignals.some((signal) => normalizedPrompt.includes(signal));
    const hasTemplateLikePluginIntent = (
        normalizedPrompt.includes("plugin")
        && (
            generationSignals.some((signal) => normalizedPrompt.includes(signal))
            || /plugin\s+like\b/.test(normalizedPrompt)
            || /\blike\s+https?:\/\//.test(normalizedPrompt)
        )
        && !/\b(current|existing|this|my)\s+plugin\b/.test(normalizedPrompt)
        && !ideationSignals.some((signal) => normalizedPrompt.includes(signal))
    );
    const hasExplicitTroubleshootingIntent = /\b(diagnos(?:e|is|tic)?|debug|investigat(?:e|ion|ing)?|troubleshoot(?:ing)?|current problems?|tests?\s+are\s+failing|failing tests?)\b/.test(normalizedPrompt);

    if (hasExplicitScaffoldIntent) {
        return "plan";
    }

    if (hasTemplateLikePluginIntent && !hasExplicitTroubleshootingIntent) {
        return "smart";
    }

    if (crossesHostAppBoundary) {
        return "smart";
    }

    if (!isAdvisoryTestQuestion && failureDrivenFixSignals.some((signal) => normalizedPrompt.includes(signal))) {
        return "fix";
    }

    if (executionSignals.some((signal) => normalizedPrompt.includes(signal)) || pragmaticIntent.primaryIntent === "execute") {
        return "plan";
    }

    if (pragmaticIntent.primaryIntent === "fix") {
        return "fix";
    }

    if (ideationSignals.some((signal) => normalizedPrompt.includes(signal)) || pragmaticIntent.advisoryIntent) {
        return "smart";
    }

    if (generateSignals.some((signal) => normalizedPrompt.includes(signal))) {
        return "generate";
    }

    return "smart";
}
