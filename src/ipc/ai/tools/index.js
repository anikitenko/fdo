import {getCurrentWeatherTool} from "./weather.js";
import {searchWebTool} from "./search_web";
import {searchFdoHelpTool} from "./search_fdo_help.js";
import {searchFdoCodeTool} from "./search_fdo_code.js";

const FOLLOW_UP_TERMS = [
    "try again",
    "please try again",
    "retry",
    "again",
    "once more",
    "one more time",
    "please continue",
    "continue",
    "what about",
    "how about",
    "what else",
    "tell me more",
    "explain more",
    "more on that",
    "and then",
    "and what",
    "and why",
    "why",
    "how so",
    "does it",
    "is it",
    "are they",
    "that",
    "this",
    "it",
    "those",
    "them",
    "also",
    "then",
    "talking about",
    "i mean",
    "i meant",
    "meant",
    "meaning",
    "about that",
    "that one",
    "this one",
];

const TOPIC_SHIFT_TERMS = [
    "another question",
    "different question",
    "different topic",
    "new topic",
    "switching topics",
    "switching gears",
    "by the way",
    "separately",
    "unrelated",
];

const TRANSLATION_TERMS = [
    "translate",
    "translation",
    "how to say",
    "how do i say",
    "say this in english",
    "say this in ukrainian",
    "in english",
    "in ukrainian",
    "англійською",
    "українською",
    "переклади",
    "переклад",
];
const REWRITING_TERMS = [
    "rewrite",
    "rephrase",
    "polish",
    "improve wording",
    "make this sound",
    "word this better",
    "перефразуй",
    "перепиши",
    "покращи",
];
const CODING_TERMS = [
    "code",
    "function",
    "component",
    "typescript",
    "javascript",
    "python",
    "yaml",
    "react",
    "bug",
    "debug",
    "stack trace",
    "error",
];
const SCOPE_DEFINITIONS = [
    { scope: "ui", terms: ["ui", "dialog", "window", "screen", "button", "panel", "layout", "renderer"] },
    { scope: "settings", terms: ["settings", "config", "option", "preferences", "assistant settings"] },
    { scope: "plugins", terms: ["plugin", "plugins", "manifest", "create plugin", "manage plugins"] },
    { scope: "trust", terms: ["trust", "certificate", "certificates", "sign", "signature"] },
    { scope: "sdk", terms: ["sdk", "api", "types", "integration"] },
    { scope: "docs_help", terms: ["docs", "documentation", "help", "how to", "guide"] },
    { scope: "code_dev", terms: ["code", "implementation", "implemented", "internals", "debug", "bug", "source"] },
];

const ROUTE_DEFINITIONS = [
    {
        route: "weather",
        terms: [
            "weather", "forecast", "temperature", "wind", "humidity", "snow",
            "rain", "sunny", "cloud", "storm", "cold", "hot",
            "погода", "дощ", "сонце", "вітер", "температура", "сніг", "гроза",
        ],
        tools: [getCurrentWeatherTool],
    },
    {
        route: "fdo",
        terms: [
            "fdo",
            "flexdevops",
            "plugin",
            "plugins",
            "manifest",
            "certificate",
            "certificates",
            "trust",
            "sdk",
            "sandbox",
            "ai assistant",
            "assistant settings",
            "settings dialog",
            "electron",
            "react ui",
            "chat dialog",
        ],
        tools: [searchFdoHelpTool, searchFdoCodeTool],
    },
    {
        route: "web",
        terms: [
            "search", "find", "look up", "current", "latest", "today",
            "recent", "news", "update", "google", "web", "internet",
        ],
        tools: [searchWebTool],
    },
];

export const SUPPORTED_ROUTES = ["general", "multi", ...ROUTE_DEFINITIONS.map((definition) => definition.route)];
export const SUPPORTED_TASK_SHAPES = [
    "general_chat",
    "translation",
    "rewriting",
    "coding_help",
    "retrieval_grounded_help",
];
export const SUPPORTED_SCOPES = [
    "general",
    ...SCOPE_DEFINITIONS.map((definition) => definition.scope),
];

function hasTerm(prompt, terms) {
    const q = String(prompt || "").toLowerCase();
    return terms.some((term) => q.includes(term));
}

function detectDirectPromptRoute(prompt) {
    const q = String(prompt || "").toLowerCase();
    if (!q.trim()) return "general";
    const directMatch = ROUTE_DEFINITIONS.find((definition) => hasTerm(q, definition.terms));
    if (directMatch) return directMatch.route;
    return "general";
}

function detectDirectRouteCandidates(prompt) {
    const q = String(prompt || "").toLowerCase();
    if (!q.trim()) return [];
    return ROUTE_DEFINITIONS
        .filter((definition) => hasTerm(q, definition.terms))
        .map((definition) => definition.route);
}

function detectTopicShift(prompt, sessionRouting = null, routeInfo = null) {
    const q = String(prompt || "").toLowerCase().trim();
    const previousRoute = sessionRouting?.activeRoute || "general";
    if (!q || previousRoute === "general") return false;
    if (hasTerm(q, TOPIC_SHIFT_TERMS)) return true;
    if (routeInfo?.route === "general" && routeInfo?.reason === "no-follow-up-signal" && q.length >= 24) return true;
    return false;
}

function computeIntentConfidence(prompt, routeInfo, taskShapeInfo, sessionRouting = null) {
    const q = String(prompt || "").trim();
    const previousRoute = sessionRouting?.activeRoute || "general";
    const topicShift = detectTopicShift(prompt, sessionRouting, routeInfo);

    if (!q) {
        return 0;
    }

    if (routeInfo?.route === "multi") {
        return 0.35;
    }

    if (routeInfo?.reason === "direct" && routeInfo?.route !== "general") {
        return 0.92;
    }

    if (routeInfo?.reason === "session-route" && routeInfo?.route !== "general") {
        return Math.max(Math.min(sessionRouting?.routeConfidence || 0.78, 0.9), 0.7);
    }

    if (routeInfo?.route === "general" && topicShift) {
        return 0.15;
    }

    if (routeInfo?.reason === "no-follow-up-signal" && previousRoute !== "general") {
        return 0.2;
    }

    if (routeInfo?.route === "general" && taskShapeInfo?.taskShape !== "general_chat") {
        return 0.55;
    }

    if (routeInfo?.route === "general") {
        return 0.4;
    }

    return 0.6;
}

function detectDirectTaskShape(prompt) {
    const q = String(prompt || "").toLowerCase();
    if (!q.trim()) return "general_chat";
    if (hasTerm(q, TRANSLATION_TERMS)) return "translation";
    if (hasTerm(q, REWRITING_TERMS)) return "rewriting";
    if (hasTerm(q, CODING_TERMS)) return "coding_help";
    return "general_chat";
}

function detectDirectScope(prompt) {
    const q = String(prompt || "").toLowerCase();
    if (!q.trim()) return "general";
    const scored = SCOPE_DEFINITIONS
        .map((definition) => ({
            scope: definition.scope,
            matches: definition.terms.filter((term) => q.includes(term)).length,
            strongestTermLength: Math.max(...definition.terms.filter((term) => q.includes(term)).map((term) => term.length), 0),
        }))
        .filter((entry) => entry.matches > 0)
        .sort((a, b) => {
            if (b.matches !== a.matches) return b.matches - a.matches;
            return b.strongestTermLength - a.strongestTermLength;
        });

    return scored[0]?.scope || "general";
}

function looksLikeFollowUp(prompt) {
    const q = String(prompt || "").toLowerCase().trim();
    if (!q) return false;
    if (hasTerm(q, FOLLOW_UP_TERMS)) return true;
    return q.length <= 80 && /^(and|also|then|why|how|what|where|when|does|is|are|can)\b/.test(q);
}

function looksLikeRouteClarification(prompt) {
    const q = String(prompt || "").toLowerCase().trim();
    if (!q) return false;
    return /(?:^|[\s.,"'`])(?:talking about|i mean|i meant|meaning|no,?\s+about|about that)\b/.test(q);
}

function isShortReferentialTurn(prompt) {
    const q = String(prompt || "").trim();
    if (!q) return false;
    if (q.length <= 16 && /[?!.…]$/.test(q)) return true;
    if (q.length > 60) return false;
    return /^(this|that|it|them|those|these|again|continue|more|why|how|and now|what about)\b/i.test(q);
}

function shouldInheritFromSession(prompt, sessionRouting) {
    if (!sessionRouting?.activeRoute && !sessionRouting?.activeTaskShape && !sessionRouting?.activeScope) {
        return false;
    }
    if ((sessionRouting?.routeConfidence || 0) < 0.55) {
        return false;
    }
    if (detectTopicShift(prompt, sessionRouting, { route: "general", reason: "no-follow-up-signal" })) {
        return false;
    }
    return looksLikeFollowUp(prompt) || isShortReferentialTurn(prompt);
}

export function routeFromToolName(toolName) {
    switch (toolName) {
        case "get_current_weather":
            return "weather";
        case "search_fdo_knowledge":
        case "search_fdo_help":
        case "search_fdo_code":
            return "fdo";
        case "search_web":
            return "web";
        default:
            return null;
    }
}

function inferRouteFromHistory(historyMessages = []) {
    const recent = [...(historyMessages || [])].reverse();

    for (const message of recent) {
        const toolsUsed = Array.isArray(message?.toolsUsed) ? message.toolsUsed : [];
        for (const toolName of toolsUsed) {
            const route = routeFromToolName(toolName);
            if (route) {
                return { route, reason: "history-tool" };
            }
        }
    }

    for (const message of recent) {
        const route = detectDirectPromptRoute(message?.content || "");
        if (route !== "general") {
            return { route, reason: "history-text" };
        }
    }

    return { route: "general", reason: "none" };
}

export function detectPromptRoute(prompt, historyMessages = [], sessionRouting = null) {
    const directCandidates = detectDirectRouteCandidates(prompt);
    if (directCandidates.length > 1) {
        return { route: "multi", reason: "direct-multi", candidates: directCandidates };
    }

    const directRoute = detectDirectPromptRoute(prompt);
    if (directRoute !== "general") {
        return { route: directRoute, reason: "direct", candidates: [directRoute] };
    }

    if (looksLikeRouteClarification(prompt) && sessionRouting?.activeRoute && sessionRouting.activeRoute !== "general") {
        return {
            route: sessionRouting.activeRoute,
            reason: "clarification-follow-up",
            candidates: [sessionRouting.activeRoute],
        };
    }

    if (shouldInheritFromSession(prompt, sessionRouting) && sessionRouting?.activeRoute) {
        return { route: sessionRouting.activeRoute, reason: "session-route", candidates: [sessionRouting.activeRoute] };
    }

    if (!looksLikeFollowUp(prompt)) {
        return { route: "general", reason: "no-follow-up-signal", candidates: [] };
    }

    return inferRouteFromHistory(historyMessages);
}

export function detectTaskShape(prompt, sessionRouting = null) {
    const directTaskShape = detectDirectTaskShape(prompt);
    if (directTaskShape !== "general_chat") {
        return { taskShape: directTaskShape, reason: "direct" };
    }

    if (shouldInheritFromSession(prompt, sessionRouting) && sessionRouting?.activeTaskShape) {
        return { taskShape: sessionRouting.activeTaskShape, reason: "session-task-shape" };
    }

    return { taskShape: "general_chat", reason: "default" };
}

export function detectScope(prompt, sessionRouting = null) {
    const directScope = detectDirectScope(prompt);
    if (directScope !== "general") {
        return { scope: directScope, reason: "direct" };
    }

    if (shouldInheritFromSession(prompt, sessionRouting) && sessionRouting?.activeScope) {
        return { scope: sessionRouting.activeScope, reason: "session-scope" };
    }

    return { scope: "general", reason: "default" };
}

export function resolveTurnIntent(prompt, historyMessages = [], sessionRouting = null) {
    const routeInfo = detectPromptRoute(prompt, historyMessages, sessionRouting);
    const taskShapeInfo = detectTaskShape(prompt, sessionRouting);
    const scopeInfo = detectScope(prompt, sessionRouting);
    const confidence = computeIntentConfidence(prompt, routeInfo, taskShapeInfo, sessionRouting);
    const topicShift = detectTopicShift(prompt, sessionRouting, routeInfo);
    return {
        route: routeInfo.route,
        routeReason: routeInfo.reason,
        routeCandidates: Array.isArray(routeInfo.candidates) ? routeInfo.candidates : [],
        taskShape: taskShapeInfo.taskShape,
        taskShapeReason: taskShapeInfo.reason,
        scope: scopeInfo.scope,
        scopeReason: scopeInfo.reason,
        confidence,
        topicShift,
    };
}

export const FULL_TOOL_REGISTRY = Array.from(new Set(
    ROUTE_DEFINITIONS.flatMap((definition) => definition.tools)
));

const ROUTE_TOOL_ALLOWLISTS = {
    ...Object.fromEntries(
        ROUTE_DEFINITIONS.map((definition) => [
            definition.route,
            definition.tools.map((tool) => tool.name),
        ])
    ),
    multi: FULL_TOOL_REGISTRY.map((tool) => tool.name),
    general: [],
};

function getToolsByNames(names = []) {
    const set = new Set(names);
    return FULL_TOOL_REGISTRY.filter((tool) => set.has(tool.name));
}

export function resolveToolPolicyFromIntent(intent, prompt = "") {
    let allowedTools = [];
    let policy = "none";

    switch (intent.route) {
        case "weather":
            allowedTools = [getCurrentWeatherTool];
            policy = "route-scoped";
            break;
        case "fdo":
            allowedTools = intent.scope === "code_dev"
                ? [searchFdoCodeTool]
                : [searchFdoHelpTool];
            policy = "route-scoped";
            break;
        case "web":
            allowedTools = [searchWebTool];
            policy = "route-scoped";
            break;
        case "multi":
            allowedTools = getToolsByNames(
                (intent.routeCandidates || []).flatMap((route) => ROUTE_TOOL_ALLOWLISTS[route] || [])
            );
            policy = "multi-tool";
            break;
        case "general":
            allowedTools = [];
            policy = "no-tools";
            break;
        default:
            allowedTools = FULL_TOOL_REGISTRY.filter((tool) => {
                try {
                    return tool.shouldActivate?.(prompt);
                } catch {
                    return false;
                }
            });
            policy = allowedTools.length > 0 ? "general-heuristic" : "no-tools";
    }

    console.log("[AI Chat] Tool policy resolved", {
        route: intent.route,
        routeReason: intent.routeReason,
        routeCandidates: intent.routeCandidates,
        taskShape: intent.taskShape,
        taskShapeReason: intent.taskShapeReason,
        scope: intent.scope,
        scopeReason: intent.scopeReason,
        policy,
        tools: allowedTools.map((tool) => tool.name),
    });
    return {
        intent,
        policy,
        allowedTools,
    };
}

export function resolveToolPolicy(prompt, historyMessages = [], sessionRouting = null) {
    const intent = resolveTurnIntent(prompt, historyMessages, sessionRouting);
    return resolveToolPolicyFromIntent(intent, prompt);
}

export function shouldUseSemanticRouter(intent, sessionRouting = null) {
    if (!intent) return false;
    if (intent.route === "multi") return true;
    if (intent.route === "general") return true;
    if (intent.topicShift) return true;
    if ((intent.confidence || 0) < 0.6) return true;
    if ((sessionRouting?.routeConfidence || 0) < 0.55) return true;
    return false;
}

export function getActiveTools(prompt, historyMessages = [], sessionRouting = null) {
    return resolveToolPolicy(prompt, historyMessages, sessionRouting).allowedTools;
}

export async function runToolCalls(toolCalls = [], trace = null) {
    const results = [];
    for (const call of toolCalls) {
        const tool = FULL_TOOL_REGISTRY.find(t => t.name === call.name);
        if (!tool) {
            results.push({ name: call.name, ok: false, results: [], sources: [], error: "Unknown tool" });
            continue;
        }
        const span = trace?.startSpan?.(`tool:${call.name}`, {
            input: call.input || {},
            metadata: {
                tool: call.name,
            },
        }) || null;
        try {
            console.log("[AI Chat] Running tool call", {
                tool: call.name,
                input: call.input || {},
            });
            const raw = await tool.handler(call.input);
            const res = {
                name: raw?.name || call.name,
                ok: raw?.ok ?? !raw?.error,
                text: raw?.text || "",
                results: Array.isArray(raw?.results) ? raw.results : [],
                sources: Array.isArray(raw?.sources) ? raw.sources : [],
                data: raw?.data,
                error: raw?.error || null,
            };
            console.log("[AI Chat] Tool call result", {
                tool: call.name,
                ok: res.ok,
                error: res.error,
                sources: res.sources,
            });
            span?.finish({
                metadata: {
                    ok: res.ok,
                    error: res.error,
                    sourceCount: Array.isArray(res.sources) ? res.sources.length : 0,
                    resultCount: Array.isArray(res.results) ? res.results.length : 0,
                    diagnostics: res.data?.metadata || null,
                },
            });
            results.push(res);
        } catch (e) {
            span?.fail(e);
            results.push({ name: call.name, ok: false, results: [], sources: [], error: String(e?.message || e) });
        }
    }
    return results;
}
