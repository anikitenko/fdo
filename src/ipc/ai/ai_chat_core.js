// src/main/ai/ai_chat_core.js
import LLM from "@themaximalist/llm.js";
import { settings } from "../../utils/store.js";
import { AiChatChannels } from "../channels.js";
import { recordAnswerMetrics, recordTokenUsage, recordToolUsage } from "./metrics.js";
import { getObservabilityPromptVersion } from "./observability.js";
import {
    resolveToolPolicy,
    resolveToolPolicyFromIntent,
    resolveTurnIntent,
    routeFromToolName,
    runToolCalls,
    shouldUseSemanticRouter,
    SUPPORTED_ROUTES,
    SUPPORTED_SCOPES,
    SUPPORTED_TASK_SHAPES
} from "./tools/index";
import debounce from "lodash/debounce";
import { getCacheInfo, getModelCapabilities } from "./model_capabilities/index";
import fs from "fs";
import {detectAttachmentType, getRemoteFileCategory} from "./utils/detectAttachmentType";

import Jimp from "jimp";
import * as os from "node:os";
import path from "node:path";
import crypto from "crypto";

const BASE_SYSTEM_PROMPT = `You are Junie, the AI assistant inside FlexDevOps (FDO).

Behavior:
- Be concise, practical, and technically precise.
- Help with DevOps, infrastructure, CI/CD, Kubernetes, Terraform, Docker, monitoring, debugging, and code-related questions.
- When useful, provide production-grade examples in Go, TypeScript, YAML, Python, or Bash.
- Follow the latest user intent over earlier turns. If the topic or task changes, switch immediately instead of continuing the previous format.
- Do not translate, rephrase, rewrite, or polish text unless the user explicitly asks for that in the current turn.
- Mirror the user's language by default unless they ask for another language.
- Analyze user-provided attachments and use their contents in your answer when relevant.
- Do not claim to execute commands, inspect the host, or modify the environment directly.
- For FDO-specific behavior, architecture, settings, plugins, manifests, trust or certificate flows, SDK details, or UI behavior, use available tools or retrieved context instead of guessing.
- If important context is missing or the available sources are insufficient, say so and ask a focused follow-up question.`;
const BASE_SYSTEM_PROMPT_TOKENS = Math.ceil(BASE_SYSTEM_PROMPT.length / 4);

// Architecture boundary:
// - system prompt = stable behavior and tool policy
// - session messages = conversation memory
// - tools/retrieval = product knowledge and grounded facts

// --- Concurrency lock map ---
const sessionLocks = new Map();
const MAX_RECENT_TOOL_HISTORY = 6;
const SEMANTIC_ROUTER_THRESHOLD = 0.72;

function getDefaultSessionRouting() {
    return {
        activeRoute: "general",
        activeTool: null,
        activeTaskShape: "general_chat",
        activeScope: "general",
        routeConfidence: 0,
        lastToolUsedAt: null,
        lastRouteChangeAt: null,
        recentToolHistory: [],
        lastTopicalUserPrompt: null,
        lastTopicalAssistantReply: null,
    };
}

function getDefaultSessionMemory() {
    return {
        preferences: {
            preferredLanguage: null,
            responseStyle: null,
        },
        summary: {
            content: null,
            model: null,
            updatedAt: null,
        },
    };
}

function normalizeSessionRouting(routing) {
    const defaults = getDefaultSessionRouting();
    return {
        ...defaults,
        ...(routing || {}),
        recentToolHistory: Array.isArray(routing?.recentToolHistory)
            ? routing.recentToolHistory.filter(Boolean).slice(-MAX_RECENT_TOOL_HISTORY)
            : [],
    };
}

function normalizeSessionMemory(memory) {
    const defaults = getDefaultSessionMemory();
    return {
        ...defaults,
        ...(memory || {}),
        preferences: {
            ...defaults.preferences,
            ...(memory?.preferences || {}),
        },
        summary: {
            ...defaults.summary,
            ...(memory?.summary || {}),
        },
    };
}

function appendRecentToolHistory(existing = [], tools = []) {
    const merged = [...existing, ...tools].filter(Boolean);
    return merged.slice(-MAX_RECENT_TOOL_HISTORY);
}

function buildTurnModePrompt(intent) {
    switch (intent?.taskShape) {
        case "translation":
            return `Current turn mode: translation.\nTranslate only if the user is explicitly asking for translation in this turn.`;
        case "rewriting":
            return `Current turn mode: rewriting.\nRewrite or polish text only if the user is explicitly asking for that in this turn.`;
        case "coding_help":
            return `Current turn mode: coding help.\nPrefer concrete technical help over stylistic rewriting.`;
        default:
            return `Current turn mode: general chat.\nDo not switch into translation, rewriting, or polishing unless the user explicitly asks for it in this turn.`;
    }
}

function buildScopePrompt(intent) {
    const scope = intent?.scope || "general";
    if (scope === "general") {
        return "Current scope: general. Avoid overly abstract FDO answers when the product area is unclear; ask a short clarification if needed.";
    }
    return `Current scope: ${scope}. Prefer answers grounded in this product area unless the user changes scope.`;
}

function buildPreferencesPrompt(memory) {
    const preferences = normalizeSessionMemory(memory).preferences || {};
    const lines = [];

    if (preferences.preferredLanguage) {
        lines.push(`Stored user preference: reply in ${preferences.preferredLanguage} when the current turn does not clearly indicate another language.`);
    }

    if (preferences.responseStyle === "concise") {
        lines.push("Stored user preference: keep answers concise by default.");
    } else if (preferences.responseStyle === "detailed") {
        lines.push("Stored user preference: provide detailed, step-by-step answers by default when useful.");
    }

    return lines.join("\n");
}

function extractSummaryBody(content = "") {
    const value = String(content || "").trim();
    if (!value) return "";
    return value
        .replace(/^🧠\s*\*\*Summary of earlier .*? conversation:\*\*\s*/i, "")
        .trim();
}

function buildSummaryMemoryPrompt(memory) {
    const summary = normalizeSessionMemory(memory).summary || {};
    const content = String(summary.content || "").trim();
    if (!content) return "";

    return [
        "Compressed conversation memory:",
        content,
    ].join("\n");
}

function normalizeLanguageLabel(value) {
    const label = String(value || "").trim().toLowerCase();
    return label || null;
}

async function classifyLanguageWithModel({ service, apiKey, model }, text = "", { allowNull = true } = {}) {
    const value = String(text || "").trim();
    if (!value) return null;

    const classifier = new LLM({
        service,
        apiKey,
        model,
        stream: false,
        extended: false,
        max_tokens: 64,
        temperature: 0,
    });

    const prompt = [
        "Identify the language of the following text.",
        "Return strict JSON only.",
        "",
        "Rules:",
        "- Use a lowercase BCP-47 or ISO 639 style tag when possible, such as en, uk, zh, pl, de, fi.",
        "- If the text is too short, ambiguous, or language-neutral, return null.",
        "- Confidence must be a number from 0 to 1.",
        "",
        `Text: ${JSON.stringify(value)}`,
        "",
        'Return exactly: {"language":null,"confidence":0.0}',
    ].join("\n");

    try {
        const resp = await withTpmRetry(() => classifier.chat(prompt));
        const raw = typeof resp === "string" ? resp : (resp?.content || "");
        const jsonText = extractJsonObject(raw);
        if (!jsonText) return null;
        const parsed = JSON.parse(jsonText);
        const confidence = Number(parsed?.confidence);
        const language = normalizeLanguageLabel(parsed?.language);
        if (!Number.isFinite(confidence)) return null;
        if (language && confidence >= 0.7) return language;
        return allowNull ? null : language;
    } catch (err) {
        console.warn("[AI Chat] language classifier failed", {
            error: err?.message || String(err),
        });
        return null;
    }
}

async function repairReplyLanguage(llm, reply = "") {
    const targetLanguage = normalizeLanguageLabel(llm?._targetReplyLanguage);
    const sanitizedReply = sanitizeAssistantText(String(reply || ""));
    if (!targetLanguage || !sanitizedReply) {
        return sanitizedReply;
    }
    const detectedLanguage = await classifyLanguageWithModel({
        service: llm.service ?? "openai",
        apiKey: llm.apiKey,
        model: llm.options?.model ?? llm.model ?? "gpt-5",
    }, sanitizedReply);
    if (!detectedLanguage || detectedLanguage === targetLanguage) {
        return sanitizedReply;
    }

    const rewriteLlm = new LLM({
        service: llm.service ?? "openai",
        apiKey: llm.apiKey,
        model: llm.options?.model ?? llm.model ?? "gpt-5",
        stream: false,
        extended: false,
        max_tokens: Math.max(256, Math.ceil(sanitizedReply.length / 2)),
        temperature: 0,
    });

    const attempts = [
        [
            `Rewrite the following assistant answer into ${targetLanguage}.`,
            "Requirements:",
            "- Preserve meaning, facts, numbers, and structure.",
            "- Do not add new information.",
            "- Return only the rewritten answer.",
            "",
            sanitizedReply,
        ].join("\n"),
        [
            `Translate the following answer into ${targetLanguage}.`,
            "Mandatory rules:",
            `- The output must be entirely in ${targetLanguage}.`,
            `- Do not answer in any language other than ${targetLanguage}.`,
            "- Preserve numbers, units, and facts exactly.",
            "- Return only the translated answer.",
            "",
            sanitizedReply,
        ].join("\n"),
    ];

    for (const prompt of attempts) {
        try {
            const resp = await withTpmRetry(() => rewriteLlm.chat(prompt));
            const rewritten = sanitizeAssistantText(typeof resp === "string" ? resp : (resp?.content || ""));
            const rewrittenLanguage = rewritten
                ? await classifyLanguageWithModel({
                    service: llm.service ?? "openai",
                    apiKey: llm.apiKey,
                    model: llm.options?.model ?? llm.model ?? "gpt-5",
                }, rewritten)
                : null;
            if (rewritten && rewrittenLanguage === targetLanguage) {
                return rewritten;
            }
        } catch (err) {
            console.warn("[AI Chat] reply language repair failed", {
                targetLanguage,
                error: err?.message || String(err),
            });
        }
    }

    return sanitizedReply;
}

function buildReplyLanguageDirective(targetLanguage = null) {
    const replyLanguage = normalizeLanguageLabel(targetLanguage);
    return replyLanguage
        ? `Final answer language for this turn: ${replyLanguage}. You must answer in ${replyLanguage}.`
        : "";
}

function shouldPreferCompactReply(prompt = "", intent = null) {
    const text = String(prompt || "").trim();
    if (!text) return false;
    if ((intent?.taskShape || "") === "translation") return false;
    if (text.length <= 48) return true;
    return /^(and|also|then|now|again|seriously|what about|how about|то|а|і|ну|зараз)\b/i.test(text);
}

function buildToolFollowUpBehavior(memory, intent, originalPrompt = "", targetLanguage = null) {
    const preferences = normalizeSessionMemory(memory).preferences || {};
    const rules = [];
    const replyLanguage = normalizeLanguageLabel(targetLanguage) || preferences.preferredLanguage || null;
    const languageDirective = buildReplyLanguageDirective(replyLanguage);

    if (languageDirective) {
        rules.push(languageDirective);
    }

    if (replyLanguage) {
        rules.push(`Do not switch to another language for this turn. The answer must stay in ${replyLanguage}.`);
    }

    if (preferences.responseStyle === "concise" || shouldPreferCompactReply(originalPrompt, intent)) {
        rules.push("Prefer a concise answer. Lead with the main answer and omit secondary details unless the user asked for them.");
    } else if (preferences.responseStyle === "detailed") {
        rules.push("Provide a fuller answer with a little extra context when the tool results support it.");
    }

    if (intent?.route === "weather" && shouldPreferCompactReply(originalPrompt, intent)) {
        rules.push("For weather follow-ups, focus on current conditions first. Include forecast details only if the user explicitly asks for tomorrow or later.");
    }

    return rules;
}

function detectPreferredLanguage(messages = [], previousLanguage = null) {
    return previousLanguage || null;
}

function detectResponseStyle(messages = [], previousStyle = null) {
    const recentUserMessages = messages
        .filter((message) => message?.role === "user")
        .slice(-8)
        .map((message) => String(message?.content || "").toLowerCase());

    for (let i = recentUserMessages.length - 1; i >= 0; i -= 1) {
        const text = recentUserMessages[i];
        if (/(brief|briefly|short|concise|keep it short|коротко|стисло|коротка відповідь)/i.test(text)) {
            return "concise";
        }
        if (/(detailed|detail|step by step|deep dive|детально|по кроках|розгорнуто)/i.test(text)) {
            return "detailed";
        }
    }

    const recentUserText = recentUserMessages.join("\n");

    if (!recentUserText.trim()) {
        return previousStyle || null;
    }

    return previousStyle || null;
}

function deriveSessionMemory(sessionOrMessages) {
    const session = Array.isArray(sessionOrMessages)
        ? { messages: sessionOrMessages, memory: null }
        : (sessionOrMessages || {});
    const previous = normalizeSessionMemory(session.memory);
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const latestSummaryMessage = [...messages]
        .reverse()
        .find((message) => (
            message?.role === "assistant" &&
            /^🧠\s*\*\*Summary of earlier .*? conversation:\*\*/i.test(String(message?.content || ""))
        ));
    const latestSummaryContent = latestSummaryMessage
        ? extractSummaryBody(latestSummaryMessage.content)
        : previous.summary.content;
    const latestSummaryModel = latestSummaryMessage?.model || previous.summary.model || null;
    const latestSummaryUpdatedAt = latestSummaryMessage?.createdAt || previous.summary.updatedAt || null;

    return {
        preferences: {
            preferredLanguage: previous.preferences.preferredLanguage,
            responseStyle: detectResponseStyle(messages, previous.preferences.responseStyle),
        },
        summary: {
            content: latestSummaryContent || null,
            model: latestSummaryModel,
            updatedAt: latestSummaryUpdatedAt,
        },
    };
}

function mergeSessionMemory(baseMemory = null, updates = {}) {
    const base = normalizeSessionMemory(baseMemory);
    return {
        ...base,
        preferences: {
            ...base.preferences,
            ...(updates?.preferences || {}),
        },
        summary: {
            ...base.summary,
            ...(updates?.summary || {}),
        },
    };
}

function buildClarificationMessage(intent, originalPrompt = "") {
    const routeCandidates = Array.isArray(intent?.routeCandidates)
        ? intent.routeCandidates.filter((candidate) => candidate && candidate !== "general" && candidate !== "multi")
        : [];

    if (routeCandidates.length > 1) {
        return `I can help with that, but I need one clarification first: do you want ${routeCandidates.join(", ")} help, or a general answer?`;
    }

    if (intent?.route === "general" && (intent?.confidence || 0) < SEMANTIC_ROUTER_THRESHOLD) {
        return `I’m not fully sure whether you want a domain-specific lookup or a general reply here. Do you want me to use a tool for this, or answer conversationally?`;
    }

    if (intent?.route === "fdo" && (intent?.scope || "general") === "general") {
        return `I can help with that, but I need one clarification first: do you mean FDO UI, settings, plugins, trust/certificates, SDK, or implementation details?`;
    }

    return `I’m not fully sure what kind of help you want for this turn. Can you clarify what you want me to do?`;
}

export function persistClarificationResponse(session, sessions, idx, clarificationText, intent, resolvedMemory = null) {
    const now = new Date().toISOString();
    const safeClarificationText = String(
        clarificationText || buildClarificationMessage(intent, session?.messages?.at?.(-1)?.content || "")
    ).trim() || "I need one clarification before I answer. Can you narrow down what you mean?";
    const assistantMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: safeClarificationText,
        createdAt: now,
        clarification: true,
    };

    const nextRouting = updateSessionRoutingState(session, {
        ...intent,
        route: intent?.route || "general",
        taskShape: intent?.taskShape || "general_chat",
        scope: intent?.scope || "general",
        confidence: Number.isFinite(intent?.confidence) ? intent.confidence : 0.4,
    }, [], assistantMsg);

    const nextSession = {
        ...session,
        messages: [...(session.messages || []), assistantMsg],
        memory: mergeSessionMemory(
            deriveSessionMemory({
                ...session,
                messages: [...(session.messages || []), assistantMsg],
            }),
            resolvedMemory
        ),
        routing: nextRouting,
        updatedAt: now,
    };

    sessions[idx] = nextSession;
    saveSessionsDebounced(sessions, true);
    return nextSession;
}

async function resolvePreferenceUpdate(assistantInfo, prompt, sessionMemory = null) {
    const latestTurn = String(prompt || "").trim();
    if (!latestTurn || latestTurn.length > 160) {
        return null;
    }

    const classifier = new LLM({
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: false,
        extended: false,
        max_tokens: 120,
        temperature: 0,
    });

    const promptText = [
        "Determine the current-turn reply language and whether the user's latest message is setting a conversation preference.",
        "Return strict JSON only.",
        "",
        `Current stored preferences: ${JSON.stringify(normalizeSessionMemory(sessionMemory).preferences)}`,
        `Latest user message: ${JSON.stringify(latestTurn)}`,
        "",
        "Rules:",
        "- Set turnLanguage only when the latest message itself clearly indicates the language the reply should use.",
        "- For short language-neutral follow-ups like 'and again?', return turnLanguage as null.",
        "- Only set preferredLanguage if the user is clearly asking for replies in a specific language.",
        "- Only set responseStyle if the user is clearly asking for short/concise or detailed/step-by-step replies.",
        "- Set preferenceOnly=true only if the message is mainly a preference update and not mainly a topical/domain question.",
        "- If the message is only asking a normal content question, return null preferences.",
        "- Use a lowercase BCP-47 or ISO 639 style language tag when possible, such as en, uk, zh, pl, de, fi.",
        "- Allowed responseStyle values: concise, detailed, null",
        "- Confidence must be a number from 0 to 1.",
        "",
        'Return exactly: {"turnLanguage":null,"preferredLanguage":null,"responseStyle":null,"preferenceOnly":false,"confidence":0.0}',
    ].join("\n");

    try {
        const resp = await withTpmRetry(() => classifier.chat(promptText));
        const raw = typeof resp === "string" ? resp : (resp?.content || "");
        const jsonText = extractJsonObject(raw);
        if (!jsonText) return null;
        const parsed = JSON.parse(jsonText);
        const confidence = Number(parsed?.confidence);
        if (!Number.isFinite(confidence) || confidence < 0.7) {
            return null;
        }
        const turnLanguage = normalizeLanguageLabel(parsed?.turnLanguage);
        const preferredLanguage = normalizeLanguageLabel(parsed?.preferredLanguage);
        const preferenceOnly = !!parsed?.preferenceOnly;
        const responseStyle = ["concise", "detailed", null].includes(parsed?.responseStyle)
            ? parsed.responseStyle
            : null;

        if (!turnLanguage && !preferredLanguage && !responseStyle) {
            return null;
        }

        return {
            turnLanguage,
            preferenceOnly,
            preferences: {
                ...(preferredLanguage ? { preferredLanguage } : {}),
                ...(responseStyle ? { responseStyle } : {}),
            },
        };
    } catch (err) {
        console.warn("[AI Chat] preference classifier failed", {
            error: err?.message || String(err),
        });
        return null;
    }
}

function extractJsonObject(text = "") {
    const value = String(text || "").trim();
    if (!value) return null;
    const direct = value.match(/\{[\s\S]*\}/);
    return direct ? direct[0] : null;
}

function normalizeSemanticIntent(parsed, deterministicIntent) {
    if (!parsed || typeof parsed !== "object") return null;
    const route = SUPPORTED_ROUTES.includes(parsed.route) ? parsed.route : null;
    const taskShape = SUPPORTED_TASK_SHAPES.includes(parsed.taskShape) ? parsed.taskShape : null;
    const scope = SUPPORTED_SCOPES.includes(parsed.scope) ? parsed.scope : null;
    const confidence = Number(parsed.confidence);
    const needsClarification = !!parsed.needsClarification;

    if (!route || !taskShape || !scope || !Number.isFinite(confidence)) {
        return null;
    }

    return {
        route,
        routeReason: "semantic",
        routeCandidates: route === "multi"
            ? Array.isArray(parsed.routeCandidates)
                ? parsed.routeCandidates.filter((candidate) => SUPPORTED_ROUTES.includes(candidate) && candidate !== "general" && candidate !== "multi")
                : deterministicIntent?.routeCandidates || []
            : [route],
        taskShape,
        taskShapeReason: "semantic",
        scope,
        scopeReason: "semantic",
        confidence: Math.max(0, Math.min(1, confidence)),
        needsClarification,
    };
}

async function resolveSemanticIntent(assistantInfo, prompt, historyMessages = [], sessionRouting = null, deterministicIntent = null) {
    const recentHistory = [...(historyMessages || [])]
        .slice(-6)
        .map((message) => ({
            role: message?.role || "user",
            content: stripRetrievalMetadata(message?.content || "").slice(0, 400),
        }))
        .filter((message) => message.content);

    const routerPrompt = [
        "Classify the user's latest turn for routing and response mode.",
        "Return strict JSON only.",
        "",
        `Allowed routes: ${SUPPORTED_ROUTES.join(", ")}`,
        `Allowed taskShape values: ${SUPPORTED_TASK_SHAPES.join(", ")}`,
        `Allowed scope values: ${SUPPORTED_SCOPES.join(", ")}`,
        "",
        "Rules:",
        "- Choose 'general' when no special domain tool is clearly needed.",
        "- Choose 'multi' only if the user is clearly asking for more than one domain in the same turn.",
        "- Set needsClarification=true when intent is too ambiguous to route safely.",
        "- Confidence must be a number from 0 to 1.",
        "",
        `Current session routing: ${JSON.stringify(normalizeSessionRouting(sessionRouting))}`,
        `Deterministic intent: ${JSON.stringify(deterministicIntent || {})}`,
        `Recent history: ${JSON.stringify(recentHistory)}`,
        `Latest user turn: ${JSON.stringify(String(prompt || ""))}`,
        "",
        'Return exactly: {"route":"...","taskShape":"...","scope":"...","confidence":0.0,"needsClarification":false,"routeCandidates":["..."]}',
    ].join("\n");

    const routerLlm = new LLM({
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: false,
        extended: false,
        max_tokens: 220,
        temperature: 0,
    });

    let resp;
    try {
        resp = await withTpmRetry(() => routerLlm.chat(routerPrompt));
    } catch (err) {
        console.warn("[AI Chat] semantic router failed", {
            model: assistantInfo.model,
            provider: assistantInfo.provider,
            error: err?.message || String(err),
        });
        return null;
    }

    const raw = typeof resp === "string" ? resp : (resp?.content || "");
    const jsonText = extractJsonObject(raw);
    if (!jsonText) {
        console.warn("[AI Chat] semantic router returned no JSON", { raw });
        return null;
    }

    try {
        const parsed = JSON.parse(jsonText);
        return normalizeSemanticIntent(parsed, deterministicIntent);
    } catch (err) {
        console.warn("[AI Chat] semantic router JSON parse failed", {
            error: err?.message || String(err),
            raw,
        });
        return null;
    }
}

function updateSessionRoutingState(session, intent, toolsUsed = [], assistantMsg = null) {
    const previous = normalizeSessionRouting(session?.routing);
    const now = new Date().toISOString();
    const lastTool = toolsUsed.length > 0 ? toolsUsed[toolsUsed.length - 1] : null;
    const routeFromTool = lastTool ? routeFromToolName(lastTool) : null;
    const preferenceOnly = !!intent?.preferenceOnly;
    const lastUserMessage = [...(session?.messages || [])].reverse().find((message) => message?.role === "user");

    let activeRoute = previous.activeRoute;
    let activeTool = previous.activeTool;
    let activeTaskShape = previous.activeTaskShape;
    let activeScope = previous.activeScope;
    let routeConfidence = previous.routeConfidence;
    let lastToolUsedAt = previous.lastToolUsedAt;
    let lastRouteChangeAt = previous.lastRouteChangeAt;
    let recentToolHistory = previous.recentToolHistory;
    let lastTopicalUserPrompt = previous.lastTopicalUserPrompt;
    let lastTopicalAssistantReply = previous.lastTopicalAssistantReply;

    if (preferenceOnly) {
        activeRoute = previous.activeRoute || "general";
        activeTool = previous.activeTool || null;
        activeTaskShape = previous.activeTaskShape || "general_chat";
        activeScope = previous.activeScope || "general";
        routeConfidence = Math.max(previous.routeConfidence || 0, 0.75);
        recentToolHistory = previous.recentToolHistory;
        lastToolUsedAt = previous.lastToolUsedAt;
        lastRouteChangeAt = previous.lastRouteChangeAt;
    } else if (lastTool) {
        activeRoute = routeFromTool || intent.route || previous.activeRoute || "general";
        activeTool = lastTool;
        activeTaskShape = ["search_fdo_help", "search_fdo_code"].includes(lastTool)
            ? "retrieval_grounded_help"
            : (intent.taskShape || "general_chat");
        activeScope = intent.scope || previous.activeScope || "general";
        routeConfidence = 0.95;
        lastToolUsedAt = now;
        recentToolHistory = appendRecentToolHistory(previous.recentToolHistory, toolsUsed);
        if (activeRoute !== previous.activeRoute) {
            lastRouteChangeAt = now;
        }
    } else if (intent.route && intent.route !== "general") {
        activeRoute = intent.route;
        activeTool = intent.routeReason === "session-route" ? previous.activeTool : null;
        activeTaskShape = intent.taskShape || "general_chat";
        activeScope = intent.scope || "general";
        routeConfidence = Number.isFinite(intent.confidence)
            ? Math.max(0, Math.min(1, intent.confidence))
            : intent.routeReason === "direct"
                ? 0.9
                : intent.routeReason === "session-route"
                    ? Math.max(previous.routeConfidence || 0, 0.75)
                    : 0.65;
        if (activeRoute !== previous.activeRoute) {
            lastRouteChangeAt = now;
        }
    } else {
        activeRoute = "general";
        activeTool = null;
        activeTaskShape = intent.taskShape || "general_chat";
        activeScope = intent.scope || "general";
        routeConfidence = Number.isFinite(intent.confidence)
            ? Math.max(0, Math.min(1, intent.confidence))
            : intent.routeReason === "no-follow-up-signal" ? 0.2 : Math.max((previous.routeConfidence || 0) * 0.5, 0.2);
        if (previous.activeRoute !== "general") {
            lastRouteChangeAt = now;
        }
    }

    if (!preferenceOnly) {
        lastTopicalUserPrompt = String(lastUserMessage?.content || "").trim() || previous.lastTopicalUserPrompt || null;
        lastTopicalAssistantReply = String(assistantMsg?.content || "").trim() || previous.lastTopicalAssistantReply || null;
    }

    if (preferenceOnly) {
        activeTaskShape = previous.activeTaskShape || "general_chat";
    } else if (intent.taskShape && intent.taskShape !== "general_chat") {
        activeTaskShape = intent.taskShape;
    } else if (intent.taskShapeReason !== "session-task-shape") {
        activeTaskShape = "general_chat";
    }

    return {
        activeRoute,
        activeTool,
        activeTaskShape,
        activeScope,
        routeConfidence,
        lastToolUsedAt,
        lastRouteChangeAt,
        recentToolHistory,
        lastTopicalUserPrompt,
        lastTopicalAssistantReply,
    };
}

function savePdfTemp(base64, prefix = "attachment") {
    try {
        // Generate a random suffix for the filename
        const random = crypto.randomBytes(6).toString("hex"); // e.g. "a3b19c82e4f1"
        const filename = `${prefix}-${random}.pdf`;

        // Build full path in OS tmp dir
        const filePath = path.join(os.tmpdir(), filename);

        // Write file buffer
        const buffer = Buffer.from(base64, "base64");
        fs.writeFileSync(filePath, buffer);

        // Return safe file:// URL
        return `file://${filePath}`;
    } catch (err) {
        throw new Error(`[savePdfTemp] Failed to write PDF: ${err.message}`);
    }
}

/**
 * Run a function with an exclusive lock per session.
 * Ensures that no two messages mutate the same session concurrently.
 */
export async function withSessionLock(sessionId, fn) {
    // Wait if lock already held
    while (sessionLocks.has(sessionId)) {
        await sessionLocks.get(sessionId);
    }

    let resolve;
    const p = new Promise(r => (resolve = r));
    sessionLocks.set(sessionId, p);

    try {
        return await fn();
    } finally {
        resolve();            // release
        sessionLocks.delete(sessionId);
    }
}

// --- Debounced session writer ---
const _saveSessions = debounce(
    (sessions) => {
        settings.set("ai.sessions", sessions);
    },
    1500, // delay in ms
    { maxWait: 5000 } // ensure it always saves within 5 s
);

export function saveSessionsDebounced(sessions, immediate = false) {
    if (immediate) {
        _saveSessions.flush?.(); // flush pending writes
        settings.set("ai.sessions", sessions);
    } else {
        _saveSessions(sessions);
    }
}

function deriveSessionNameFromPrompt(content = "") {
    const normalized = String(content || "")
        .replace(/\s+/g, " ")
        .replace(/^[\s"'`({\[]+|[\s"'`)}\]]+$/g, "")
        .trim();

    if (!normalized) return "New Chat";

    const simplified = normalized.replace(/^(please|can you|could you|would you|hey|hi)\s+/i, "").trim() || normalized;
    const words = simplified.split(" ").filter(Boolean);
    const short = words.slice(0, 8).join(" ");
    const clipped = short.length > 60 ? short.slice(0, 57).trimEnd() : short;
    const cleaned = clipped.replace(/[.,:;!?-]+$/g, "").trim();

    if (!cleaned) return "New Chat";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function buildReplyContext(replyTarget) {
    if (!replyTarget?.id || !replyTarget?.content) return "";
    const roleLabel = replyTarget.role === "assistant" ? "assistant" : "user";
    const preview = String(replyTarget.content || "").replace(/\s+/g, " ").trim().slice(0, 500);
    return preview ? `Replying to ${roleLabel} message:\n${preview}` : "";
}

export async function prepareSessionMessage(sessionId, content, attachments, replyTo = null) {
    const normalizedContent = String(content || "").trim();
    if (!normalizedContent && !replyTo?.id) throw new Error("Message content is empty.");

    const sessions = (settings.get("ai.sessions", []) || []).slice();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) throw new Error("Session not found.");

    const now = new Date().toISOString();
    let attachmentMarkdown = "";

    if (attachments) {
        const withoutMessages = [];
        const sessionIDs = [];
        const attachmentsMap = await Promise.all(
            attachments.map(createAttachment)
        );

        const filtered = attachmentsMap.filter(Boolean);
        for (const item of filtered) {
            if (!Array.isArray(item.messages)) {
                withoutMessages.push(item);
            } else {
                sessionIDs.push(item.sessionID);
            }
        }
        if (withoutMessages.length > 0) {
            attachmentMarkdown = withoutMessages?.map(a => {
                if (a.contentType === "url") {
                    return `![Attachment](${a.data})`;
                } else if (a.contentType === "application/pdf") {
                    const pdfUrl = savePdfTemp(a.data);
                    return `📎 [Open attached PDF](${pdfUrl})`;
                } else if (a.contentType.startsWith("image/")) {}
                    return `![Attachment](data:${a.contentType};base64,${a.data})`;
                })
                .join("\n");
        }
        if (sessionIDs.length > 0) {
            attachmentMarkdown += "\n\n**Included messages from sessions:**\n" +
                sessionIDs.map(id => `- \`${id}\``).join("\n");
        }
    }

    let normalizedReplyTo = null;
    let replyContext = "";
    if (replyTo?.id) {
        const target = sessions[idx].messages.find((message) => message.id === replyTo.id);
        if (target) {
            normalizedReplyTo = {
                id: target.id,
                role: target.role,
                content: String(target.content || "").replace(/\s+/g, " ").trim().slice(0, 240),
            };
            replyContext = buildReplyContext(target);
        }
    }

    const userMsg = {
        id: crypto.randomUUID(),
        role: "user",
        content: normalizedContent,
        contentAttachments: attachmentMarkdown,
        replyContext,
        createdAt: now
    };
    if (normalizedReplyTo) {
        userMsg.replyTo = normalizedReplyTo;
    }
    const existingMessages = sessions[idx].messages || [];
    const session = {
        ...sessions[idx],
        name: existingMessages.length === 0 ? deriveSessionNameFromPrompt(content) : sessions[idx].name,
        messages: [...existingMessages, userMsg],
        memory: deriveSessionMemory({
            ...sessions[idx],
            messages: [...existingMessages, userMsg],
        }),
        updatedAt: now
    };
    sessions[idx] = session;
    saveSessionsDebounced(sessions, true);

    return {
        session,
        sessions,
        idx,
        currentReplyContext: replyContext,
        currentUserContent: normalizedContent,
    };
}

export function selectAssistant(assistantId, provider, model) {
    const list = settings.get("ai.chat", []) || [];
    let assistantInfo = null;

    if (assistantId) {
        assistantInfo = list.find(a => a.id === assistantId) || null;
    }

    if (!assistantInfo && (provider || model)) {
        const matches = list.filter(a =>
            (!provider || a.provider === provider) &&
            (!model || a.model === model)
        );
        assistantInfo = matches.find(a => a.default) || matches[0] || null;
    }
    if (!assistantInfo) {
        const all = settings.get("ai.chat", []);
        assistantInfo = all.find(a => a.default) || all[0];
    }
    if (!assistantInfo) throw new Error("No AI Chat assistant found. Please add one in Settings.");
    return assistantInfo;
}

/**
 * Compress an image (local file, URL, or Buffer) using Jimp v1+.
 *  - Resizes to maxWidth (preserving aspect ratio)
 *  - Encodes to JPEG (or PNG if transparency)
 *  - Returns { base64, contentType }
 */
async function compressImage(source, {
    maxWidth = 800,
    jpegQuality = 60,
    pngCompressionLevel = 9,
    forceJpeg = false,
} = {}) {
    try {
        const img = await Jimp.read(source);        // works with file path or URL
        const { width } = img.bitmap;
        const getBufferAsync = (mime) => new Promise((resolve, reject) => {
            img.getBuffer(mime, (err, buffer) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(buffer);
            });
        });

        // Resize while keeping aspect ratio
        if (width > maxWidth) {
            await img.resize({ w: maxWidth, h: Jimp.AUTO });
        }

        // Detect transparency (alpha channel)
        const hasAlpha = typeof img.hasAlpha === "function" ? img.hasAlpha() : false;

        const isLineArt = img.bitmap.width * img.bitmap.height < 2_000_000 && hasAlpha === false;
        if (isLineArt) {
            img.deflateLevel?.(5);
            const buffer = await getBufferAsync("image/png");
            return { base64: buffer.toString("base64"), contentType: "image/png" };
        }

        if (!forceJpeg && hasAlpha) {
            img.deflateLevel?.(pngCompressionLevel);
            const buffer = await getBufferAsync("image/png");
            return { base64: buffer.toString("base64"), contentType: "image/png" };
        }

        img.quality?.(jpegQuality);
        const buffer = await getBufferAsync("image/jpeg");
        return { base64: buffer.toString("base64"), contentType: "image/jpeg" };

    } catch (err) {
        throw new Error(`[compressImage] Failed to compress: ${err.message}`);
    }
}

async function createAttachment(attachment) {
    // Ensure object exists
    if (!attachment?.path) {
        return null;
    }

    if (attachment.type === "local") {
        const detectFileType = await detectAttachmentType(attachment.path);
        if (detectFileType.mimeType.startsWith("image/") && detectFileType.mimeType !== "image/svg+xml") {
            const compressed = await compressImage(attachment.path, { maxWidth: 1024, jpegQuality: 80 });

            if (compressed) {
                const { base64, contentType } = compressed;

                if (contentType === "image/png") {
                    return LLM.Attachment.fromPNG(base64);
                } else if (contentType === "image/jpeg") {
                    return LLM.Attachment.fromJPEG(base64);
                }
            }
        }
        // fallback (non-image or compression failed)
        const data = fs.readFileSync(attachment.path, "base64");
        switch (detectFileType.category) {
            case "fromGIF":  return LLM.Attachment.fromGIF(data);
            case "fromJPEG": return LLM.Attachment.fromJPEG(data);
            case "fromPDF":  return LLM.Attachment.fromPDF(data);
            case "fromPNG":  return LLM.Attachment.fromPNG(data);
            case "fromSVG":  return LLM.Attachment.fromSVG(data);
            case "fromTIFF": return LLM.Attachment.fromTIFF(data);
            case "fromWEBP": return LLM.Attachment.fromWEBP(data);
            default:         return LLM.Attachment.fromBase64(data, "document", detectFileType.mimeType);
        }
    } else if (attachment.type === "url") {
        const remoteType = await getRemoteFileCategory(attachment.path);
        if (remoteType.category === "image") {
            const compressed = await compressImage(attachment.path, { maxWidth: 1024, jpegQuality: 80 });

            if (compressed) {
                const { base64, contentType } = compressed;

                if (contentType === "image/png") {
                    return LLM.Attachment.fromPNG(base64);
                } else if (contentType === "image/jpeg") {
                    return LLM.Attachment.fromJPEG(base64);
                }
            }

            // fallback to non-compressed version
            return LLM.Attachment.fromImageURL(attachment.path);
        } else if (remoteType.category === "document") {
            if (remoteType.mimeType === "application/pdf") {
                return LLM.Attachment.fromDocumentURL(attachment.path);
            }
        }
    } else if (attachment.type === "session") {
        const sessions = (settings.get("ai.sessions", []) || []).slice();
        const idx = sessions.findIndex(s => s.id === attachment.path);
        return {
            messages: sessions[idx].messages.map(({ role, content }) => ({ role, content })),
            sessionID: attachment.name
        };
    }
}

function isOpenAiTpmRateLimitError(err) {
    if (!err || typeof err.message !== "string") return false;
    return err.message.includes("Rate limit reached") && err.message.includes("tokens per min (TPM)");
}

async function withTpmRetry(fn, { retries = 2, baseDelayMs = 800 } = {}) {
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        } catch (err) {
            if (!isOpenAiTpmRateLimitError(err) || attempt >= retries) {
                throw err;
            }
            // Best-effort: extract suggested wait from message if present
            const m = err.message.match(/try again in (\d+)ms/i);
            const suggested = m ? Number(m[1]) : baseDelayMs * Math.pow(2, attempt);
            const delay = Number.isFinite(suggested) && suggested > 0 ? suggested : baseDelayMs;
            console.warn("[AI Chat] OpenAI TPM rate limit hit, backing off", {
                attempt,
                delay,
                message: err.message,
            });
            await new Promise(res => setTimeout(res, delay));
            attempt += 1;
        }
    }
}


export async function createLlmInstance(assistantInfo, content, think, stream, caps, temperature, attachments, historyMessages = [], sessionRouting = null, sessionMemory = null, currentReplyContext = "", trace = null) {
    // 🧩 Optional diagnostic
    const routingSpan = trace?.startSpan?.("routing-and-policy", {
        input: String(content || "").trim(),
        metadata: {
            assistantId: assistantInfo?.id || null,
            provider: assistantInfo?.provider || null,
            model: assistantInfo?.model || null,
        },
    }) || null;
    const info = getCacheInfo();
    const effectiveContent = [String(content || "").trim(), String(currentReplyContext || "").trim()]
        .filter(Boolean)
        .join("\n\n");
    const preferenceUpdate = await resolvePreferenceUpdate(assistantInfo, content, sessionMemory);
    const resolvedSessionMemory = mergeSessionMemory(sessionMemory, preferenceUpdate);
    const targetReplyLanguage = normalizeLanguageLabel(preferenceUpdate?.turnLanguage)
        || normalizeSessionMemory(resolvedSessionMemory).preferences?.preferredLanguage
        || null;
    const lastTopicalContext = [
        sessionRouting?.lastTopicalUserPrompt ? `Last real user topic: ${sessionRouting.lastTopicalUserPrompt}` : "",
        sessionRouting?.lastTopicalAssistantReply ? `Last real assistant answer: ${sessionRouting.lastTopicalAssistantReply}` : "",
    ].filter(Boolean).join("\n");
    const contentForModel = preferenceUpdate?.preferenceOnly
        ? [
            String(effectiveContent || "").trim(),
            "Apply the updated reply preferences for this turn.",
            "Do not only acknowledge the preference change.",
            "Continue the most recent real conversation topic naturally in the requested language/style.",
            lastTopicalContext,
        ].filter(Boolean).join("\n\n")
        : effectiveContent;
    const deterministicToolPolicy = resolveToolPolicy(contentForModel, historyMessages, sessionRouting);
    const deterministicIntent = deterministicToolPolicy.intent || resolveTurnIntent(contentForModel, historyMessages, sessionRouting);
    let intent = deterministicIntent;
    let toolPolicy = deterministicToolPolicy;
    let clarificationNeeded = false;
    let clarificationMessage = "";

    const forceWebContinuation = shouldForceSessionWebContinuation(contentForModel, sessionRouting, deterministicIntent);

    if (forceWebContinuation) {
        intent = {
            ...deterministicIntent,
            route: "web",
            routeReason: "session-route",
            routeCandidates: ["web"],
            scope: "general",
            scopeReason: "session-scope",
            confidence: Math.max(deterministicIntent?.confidence || 0, 0.88),
        };
        toolPolicy = resolveToolPolicyFromIntent(intent, content);
    }

    if (!forceWebContinuation && shouldUseSemanticRouter(deterministicIntent, sessionRouting)) {
        const semanticIntent = await resolveSemanticIntent(
            assistantInfo,
            contentForModel,
            historyMessages,
            sessionRouting,
            deterministicIntent
        );

        if (
            semanticIntent &&
            !semanticIntent.needsClarification &&
            (semanticIntent.confidence || 0) >= SEMANTIC_ROUTER_THRESHOLD
        ) {
            intent = semanticIntent;
            toolPolicy = resolveToolPolicyFromIntent(semanticIntent, content);
        } else if (semanticIntent) {
            console.log("[AI Chat] Semantic router declined override", {
                semanticIntent,
                threshold: SEMANTIC_ROUTER_THRESHOLD,
            });
            if (
                semanticIntent.needsClarification ||
                (semanticIntent.confidence || 0) < SEMANTIC_ROUTER_THRESHOLD ||
                (semanticIntent.route === "fdo" && (semanticIntent.scope || "general") === "general")
            ) {
                clarificationNeeded = true;
                intent = semanticIntent;
                clarificationMessage = buildClarificationMessage(semanticIntent, content);
            }
        }
    }

    if (preferenceUpdate?.preferenceOnly) {
        intent = {
            ...intent,
            preferenceOnly: true,
            route: sessionRouting?.activeRoute || intent.route,
            routeReason: "preference-only",
            scope: sessionRouting?.activeScope || intent.scope,
            scopeReason: "preference-only",
            taskShape: sessionRouting?.activeTaskShape || intent.taskShape,
            taskShapeReason: "preference-only",
        };
        toolPolicy = resolveToolPolicyFromIntent(intent, content);
    }

    if (!clarificationNeeded && intent.route === "fdo" && (intent.scope || "general") === "general" && content.trim().length < 120) {
        clarificationNeeded = true;
        clarificationMessage = buildClarificationMessage(intent, effectiveContent);
    }

    if (clarificationNeeded && !String(clarificationMessage || "").trim()) {
        clarificationMessage = buildClarificationMessage(intent, effectiveContent);
    }

    console.log(
        `[ModelCaps] Using cache from ${new Date(info.updatedAt).toLocaleString()} (${info.stale ? "STALE" : "FRESH"})`
    );
    console.log("[AI Chat] Routed prompt", {
        deterministicRoute: deterministicIntent.route,
        deterministicRouteReason: deterministicIntent.routeReason,
        route: intent.route,
        routeReason: intent.routeReason,
        routeCandidates: intent.routeCandidates,
        taskShape: intent.taskShape,
        taskShapeReason: intent.taskShapeReason,
        scope: intent.scope,
        scopeReason: intent.scopeReason,
        semanticConfidence: intent.confidence ?? null,
        toolPolicy: toolPolicy.policy,
        allowedTools: (toolPolicy.allowedTools || []).map((tool) => tool.name),
        model: assistantInfo.model,
        provider: assistantInfo.provider,
        sessionRouting: normalizeSessionRouting(sessionRouting),
    });
    routingSpan?.finish({
        metadata: {
            deterministicRoute: deterministicIntent.route,
            route: intent.route,
            routeReason: intent.routeReason,
            routeCandidates: intent.routeCandidates,
            taskShape: intent.taskShape,
            scope: intent.scope,
            semanticConfidence: intent.confidence ?? null,
            toolPolicy: toolPolicy.policy,
            allowedTools: (toolPolicy.allowedTools || []).map((tool) => tool.name),
            promptVersion: getObservabilityPromptVersion(),
        },
    });

    const canThink = Boolean(caps.supportsThinking ?? caps.reasoning);
    const useThink = !!think && canThink;

    const streamingDefault = !!settings.get("ai.options.chatStreamingDefault", false);
    const streaming =
        (useThink && canThink) ||
        (stream === true && caps.streaming) ||
        (typeof stream === "undefined" && streamingDefault && caps.streaming);

    const activeTools = toolPolicy.allowedTools || [];
    const toolsToUse = activeTools.length > 0
        ? activeTools.map(t => ({name: t.name, description: t.description, input_schema: t.input_schema}))
        : undefined;

    const maxTokens = Math.floor((caps.maxTokens || 8192) * 0.95);

    const llmOptions = {
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: streaming,
        extended: true,
        tools: toolsToUse,
        max_tokens: maxTokens
    };

    if (caps.supportsTemperature) {
        llmOptions.temperature = temperature;
    }

    const llm = new LLM({
        ...llmOptions
    });
    llm._intent = intent;
    llm._sessionMemory = normalizeSessionMemory(resolvedSessionMemory);
    llm._targetReplyLanguage = targetReplyLanguage;
    llm._originalPrompt = contentForModel;
    llm._preferCompactReply = shouldPreferCompactReply(contentForModel, intent);
    llm._trace = trace || null;

    llm.system(BASE_SYSTEM_PROMPT);
    llm.system(buildTurnModePrompt(intent));
    llm.system(buildScopePrompt(intent));
    const replyLanguageDirective = buildReplyLanguageDirective(targetReplyLanguage);
    if (replyLanguageDirective) {
        llm.system(replyLanguageDirective);
    }
    const preferencesPrompt = buildPreferencesPrompt(resolvedSessionMemory);
    if (preferencesPrompt) {
        llm.system(preferencesPrompt);
    }

    const withMessages = [];
    const currentAttachments = [];
    if (attachments) {
        const attachmentsMap = await Promise.all(
            attachments.map(createAttachment)
        );

        const filtered = attachmentsMap.filter(Boolean);
        for (const item of filtered) {
            if (Array.isArray(item.messages)) {
                withMessages.push(...item.messages);
            } else {
                currentAttachments.push(item);
            }
        }
    }

    const mergedHistory = [...withMessages, ...historyMessages];
    for (const message of mergedHistory) {
        if (!message?.role) continue;
        const messageContent = `${message.content || ""}${message.replyContext ? `\n\n${message.replyContext}` : ""}`;
        if (typeof llm.addMessage === "function") {
            llm.addMessage(message.role, messageContent);
            continue;
        }
        if (message.role === "system") llm.system(messageContent);
        else if (message.role === "assistant") llm.assistant(messageContent);
        else if (message.role === "user") llm.user(messageContent);
    }

    return {
        llm,
        streaming,
        toolsToUse,
        maxTokens,
        withMessages,
        currentAttachments,
        intent,
        clarificationNeeded,
        clarificationMessage,
        effectiveContent: contentForModel,
        resolvedSessionMemory,
        targetReplyLanguage,
    };
}

function estimateTokens(text = "") {
    return Math.ceil(String(text).length / 4); // heuristic
}

function estimateContextTokensForMessage(message = {}) {
    const parts = [
        message.role || "",
        message.content || "",
        message.replyContext || "",
        message.contentAttachments || "",
    ].filter(Boolean);

    return estimateTokens(parts.join("\n"));
}

function recomputeModelUsageFromMessages(messagesForModel, maxTokens) {
    const messageTokens = messagesForModel.reduce((sum, message) => (
        sum + estimateContextTokensForMessage(message)
    ), 0);
    const used = messageTokens + (messagesForModel.length > 0 ? BASE_SYSTEM_PROMPT_TOKENS : 0);
    const percent = maxTokens ? Number(((used / maxTokens) * 100).toFixed(1)) : 0;
    return { estimatedUsed: used, percentUsed: percent };
}

function getContextMessagesForModel(messages = [], modelName) {
    return (messages || []).filter((message) => {
        if (message.role === "assistant") {
            return message.model === modelName;
        }
        // User and system-like context without an explicit model still
        // contributes to the retained context window for the active model.
        return !message.model || message.model === modelName;
    });
}

function stripRetrievalMetadata(text = "") {
    return String(text || "")
        .replace(/^Grounded with FDO knowledge retrieval\.\s*/i, "")
        .replace(/(?:\n|\r|^|\s)*sources used:?\s*[\s\S]*$/i, "")
        .trim();
}

function sanitizeAssistantText(text = "") {
    return String(text || "")
        .replace(/\n#{1,6}\s*$/g, "")
        .replace(/\n+\s*#\s*$/g, "")
        .trim();
}

function extractWeatherCity(prompt = "") {
    const text = String(prompt || "").trim();
    if (!text) return "";

    const patterns = [
        /\b(?:weather|forecast|temperature)\b[\s\S]{0,24}?\b(?:in|for)\s+([^?.!,\n]+)$/i,
        /\b(?:weather|forecast|temperature)\b[\s\S]{0,24}?\b(?:in|for)\s+([^?.!,\n]+)[?.!,]?/i,
        /^(?:what(?:'s| is)?\s+)?(?:the\s+)?weather\s+(?:in|for)\s+([^?.!,\n]+)[?.!,]?$/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].trim().replace(/^(the)\s+/i, "").trim();
        }
    }

    return "";
}

function extractWeatherCityFromHistory(messages = []) {
    const recent = [...(messages || [])].reverse();

    for (const message of recent) {
        const toolsUsed = Array.isArray(message?.toolsUsed) ? message.toolsUsed : [];
        const content = String(message?.content || "");

        if (toolsUsed.includes("get_current_weather")) {
            const assistantMatch = content.match(/current weather in\s+([^,\n:.!?]+)(?:,\s*[^:\n]+)?:/i);
            if (assistantMatch?.[1]) {
                return assistantMatch[1].trim();
            }
        }

        const userCity = extractWeatherCity(content);
        if (userCity) {
            return userCity;
        }
    }

    return "";
}

function extractNaturalWebQuery(prompt = "") {
    const text = String(prompt || "").trim();
    if (!text) return "";

    return text
        .replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, "")
        .replace(/^(ok|okay|well|sure|yeah|yes)[,.\s]+/i, "")
        .replace(/^(and\s+)?can\s+you\s+(search|look\s+up|find)\s+(for\s+)?/i, "")
        .replace(/^(and\s+)?can\s+you\s+(search|look\s+up|find)\s+about\s+/i, "")
        .replace(/^(and\s+)?do\s+you\s+know\s+(something\s+)?(related\s+to\s+)?/i, "")
        .replace(/^(but\s+)?what\s+do\s+you\s+know\s+about\s+/i, "")
        .replace(/^(can\s+you\s+)?tell\s+me\s+about\s+/i, "")
        .replace(/^i(?:'m|\s+am)?\s+curious\s+about\s+/i, "")
        .replace(/^(oh[,.\s]+)?(i\s+(was\s+)?)?talking\s+about\s+/i, "")
        .replace(/^(oh[,.\s]+)?i\s+(mean|meant)\s+/i, "")
        .replace(/^about\s+/i, "")
        .replace(/\?+$/g, "")
        .trim();
}

function extractRequestedWebEcosystem(prompt = "") {
    const normalized = String(prompt || "")
        .toLowerCase()
        .replace(/[^a-z0-9#+._/-]+/g, " ")
        .trim();
    if (!normalized) return "";

    const patterns = [
        /\b(?:with|in|for|using)\s+([a-z0-9#+._/-]{2,})\b/i,
        /\b([a-z0-9#+._/-]{2,})\s+(?:integration|implementation|setup|sdk|client)\b/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    return "";
}

function looksLikeContextDependentWebPrompt(prompt = "") {
    const text = String(prompt || "").trim();
    if (!text) return false;
    const lower = text.toLowerCase();
    if (text.length <= 80 && /^(it|that|this|those|them)\b/i.test(text)) {
        return true;
    }
    if (/\b(it|that|this|those|them)\b/i.test(text)) {
        return true;
    }
    if (/^(how to|how do i|how can i|implement|integration|setup|example|examples|nodejs|node\.js|javascript|typescript)\b/i.test(lower)) {
        return true;
    }
    return false;
}

function looksLikeUnderSpecifiedWebQuery(query = "") {
    const text = String(query || "").trim().toLowerCase().replace(/^about\s+/, "");
    if (!text) return false;
    if (text.length <= 40 && /^(latest|latest version|version|docs|documentation|pricing|install|setup|github|repo|website)$/i.test(text)) {
        return true;
    }
    if (/^(latest|version|docs|documentation|pricing|install|setup|github|repo|website)\b/.test(text)) {
        return true;
    }
    return false;
}

function looksLikeConversationalWebFollowUp(query = "") {
    const text = String(query || "").trim().toLowerCase();
    if (!text) return false;
    return /^(so what|what does that mean|what does it mean|why does that matter|why|and why|okay so|ok so)\??$/.test(text);
}

function shouldForceSessionWebContinuation(prompt = "", sessionRouting = null, deterministicIntent = null) {
    if ((sessionRouting?.activeRoute || "") !== "web") {
        return false;
    }
    const text = String(prompt || "").trim();
    if (!text) {
        return false;
    }
    if (deterministicIntent?.route && deterministicIntent.route !== "general" && deterministicIntent.route !== "web") {
        return false;
    }
    return looksLikeContextDependentWebPrompt(text)
        || /\bwhat about\b/i.test(text)
        || !!extractRequestedWebEcosystem(text);
}

function buildWebSearchQuery(prompt = "", sessionRouting = null) {
    const query = extractNaturalWebQuery(prompt);
    if (!query) return "";

    const priorTopic = String(sessionRouting?.lastTopicalUserPrompt || "").trim();
    const normalizedPriorTopic = extractNaturalWebQuery(priorTopic) || priorTopic;
    const underSpecified = looksLikeUnderSpecifiedWebQuery(query);

    if (underSpecified && normalizedPriorTopic) {
        const normalizedPriorLower = normalizedPriorTopic.toLowerCase();
        const queryLower = query.toLowerCase();
        if (
            normalizedPriorLower !== queryLower &&
            !queryLower.includes(normalizedPriorLower) &&
            !normalizedPriorLower.includes(queryLower)
        ) {
            return `${normalizedPriorTopic} ${query}`.trim();
        }
    }

    const shouldUsePriorTopic = [
        "session-route",
        "history-tool",
        "history-text",
        "clarification-follow-up",
        "preference-only",
    ].includes(sessionRouting?.routeReason || "")
        || looksLikeContextDependentWebPrompt(query)
        || underSpecified;

    if (!priorTopic || priorTopic.toLowerCase() === query.toLowerCase() || !shouldUsePriorTopic) {
        return query;
    }

    if (!normalizedPriorTopic) {
        return query;
    }

    const normalizedPriorLower = normalizedPriorTopic.toLowerCase();
    const queryLower = query.toLowerCase();
    if (
        normalizedPriorLower === queryLower ||
        queryLower.includes(normalizedPriorLower) ||
        normalizedPriorLower.includes(queryLower)
    ) {
        return query;
    }

    return `${normalizedPriorTopic} ${query}`.trim();
}

function buildForcedToolCalls(intent, prompt = "", historyMessages = [], sessionRouting = null) {
    if (intent?.route === "weather") {
        const currentCity = extractWeatherCity(prompt);
        const shouldReuseHistoryCity = ["session-route", "history-tool", "history-text", "preference-only"].includes(intent?.routeReason);
        const city = currentCity || (shouldReuseHistoryCity ? extractWeatherCityFromHistory(historyMessages) : "");
        if (!city) {
            return [];
        }

        return [{
            name: "get_current_weather",
            input: { city },
        }];
    }

    if (intent?.route === "fdo") {
        const scope = intent?.scope || "general";
        const query = String(prompt || "").trim();
        if (!query) {
            return [];
        }

        const toolName = scope === "code_dev"
            ? "search_fdo_code"
            : "search_fdo_help";

        return [{
            name: toolName,
            input: {
                query,
                scope,
            },
        }];
    }

    if (intent?.route === "web") {
        const query = buildWebSearchQuery(prompt, {
            ...sessionRouting,
            routeReason: intent?.routeReason,
        });
        if (looksLikeConversationalWebFollowUp(query)) {
            return [];
        }
        if (!query) {
            return [];
        }

        return [{
            name: "search_web",
            input: { query },
        }];
    }

    return [];
}

function dedupeToolCalls(toolCalls = []) {
    const seen = new Set();
    return (toolCalls || []).filter((call) => {
        const key = JSON.stringify({
            name: call?.name || "",
            input: call?.input || {},
        });
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function enrichToolCallsWithIntent(toolCalls = [], llm = null) {
    const scope = llm?._intent?.scope || "general";
    return (toolCalls || []).map((call) => {
        if (!["search_fdo_help", "search_fdo_code"].includes(call?.name)) {
            return call;
        }
        return {
            ...call,
            input: {
                ...(call?.input || {}),
                scope: call?.input?.scope || scope,
            },
        };
    });
}

function stripSnippetFormatting(text = "") {
    return String(text || "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function buildFdoKnowledgeFallback(results = []) {
    const fdoResults = results.filter((result) => ["search_fdo_help", "search_fdo_code"].includes(result?.name));
    const snippets = [];
    const sources = [];
    const sourceTypes = new Set();
    const modes = new Set();
    const scopes = new Set();

    for (const result of fdoResults) {
        if (result?.data?.metadata?.mode) {
            modes.add(result.data.metadata.mode);
        }
        if (result?.data?.metadata?.scope) {
            scopes.add(result.data.metadata.scope);
        }
        for (const item of result?.results || []) {
            if (item?.displaySource || item?.source) {
                sources.push(item.displaySource || item.source);
            }
            if (item?.sourceType) {
                sourceTypes.add(item.sourceType);
            }
            const snippet = stripSnippetFormatting(item?.snippet || "");
            if (snippet) {
                snippets.push(snippet);
            }
        }
    }

    const uniqueSources = Array.from(new Set(sources)).slice(0, 6);
    const uniqueSnippets = Array.from(new Set(snippets)).slice(0, 4);
    const primaryMode = modes.has("help") ? "help" : (Array.from(modes)[0] || "help");
    const primaryScope = Array.from(scopes)[0] || "general";

    if (primaryMode === "help") {
        const pluginRelated = uniqueSources.some((source) => source.includes("Plugins"));
        const settingsRelated = uniqueSources.some((source) => source.includes("Settings"));
        const chatRelated = uniqueSources.some((source) => source.includes("AI Chat"));
        const uiRelated = uniqueSources.some((source) => source.includes("UI"));
        const docsRelated = uniqueSources.some((source) => source.includes("Docs"));
        const bullets = [];

        if (primaryScope === "plugins" || pluginRelated) {
            bullets.push("FDO appears to have a dedicated plugin-management flow rather than treating plugins as hidden internal features.");
            bullets.push("The current sources point to plugin management UI, plugin lifecycle/loading logic, and plugin creation flows.");
        } else if (primaryScope === "settings" || settingsRelated) {
            bullets.push("The current FDO sources point to dedicated settings flows rather than one generic configuration surface.");
        } else if (primaryScope === "ui" || uiRelated) {
            bullets.push("The current sources point to explicit UI/dialog flows for this area of FDO.");
        } else if (chatRelated) {
            bullets.push("The current sources point to dedicated AI chat UI and backend logic for this capability.");
        }

        if (docsRelated) {
            bullets.push("There is also documentation coverage for this area, so the behavior is not inferred only from code.");
        }

        if (bullets.length === 0 && uniqueSources.length > 0) {
            bullets.push("I found relevant FDO product sources for this area, but the model did not return a concise synthesis from them.");
        }

        if (uniqueSources.length === 0) {
            return null;
        }

        bullets.push("If you want, I can narrow this to UI behavior, settings, plugin management, or implementation details.");

        return {
            content: [
                "Grounded with FDO knowledge retrieval.",
                "",
                ...bullets.map((bullet) => `- ${bullet}`),
            ].join("\n"),
            sources: uniqueSources,
            grounded: true,
            noSourceMatches: uniqueSources.length === 0,
        };
    }

    if (uniqueSnippets.length === 0) {
        return null;
    }

    const bulletPoints = uniqueSnippets.map((snippet) => `- ${snippet}`);
    return {
        content: [
            "Grounded with FDO knowledge retrieval.",
            "",
            "Here is what the current FDO sources suggest:",
            ...bulletPoints,
        ].join("\n"),
        sources: uniqueSources,
        grounded: true,
        noSourceMatches: uniqueSources.length === 0,
    };
}

function buildWebKnowledgeFallback(results = []) {
    const webResults = results.filter((result) => result?.name === "search_web");
    if (webResults.length === 0) {
        return null;
    }

    const primary = webResults[0];
    const summary = sanitizeAssistantText(String(primary?.text || ""));
    const uniqueSources = Array.from(new Set(
        webResults
            .flatMap((result) => Array.isArray(result?.sources) ? result.sources : [])
            .map((source) => source?.source)
            .filter(Boolean)
    ));

    if (!summary) {
        return null;
    }

    return {
        content: summary,
        sources: uniqueSources,
        grounded: false,
    };
}

function buildWebNoResultsFallback(results = [], originalPrompt = "") {
    const webResults = results.filter((result) => result?.name === "search_web");
    if (webResults.length === 0) {
        return null;
    }

    const hasAnyResultItems = webResults.some((result) => Array.isArray(result?.results) && result.results.length > 0);
    const hasAnySources = webResults.some((result) => Array.isArray(result?.sources) && result.sources.length > 0);
    if (hasAnyResultItems || hasAnySources) {
        return null;
    }

    const query = String(webResults[0]?.query || extractNaturalWebQuery(originalPrompt) || originalPrompt || "").trim();
    const text = query
        ? `I couldn’t find useful web results for "${query}" just now, so I can’t verify current details from search.`
        : `I couldn’t find useful web results just now, so I can’t verify current details from search.`;

    return {
        content: sanitizeAssistantText(text),
        sources: [],
        grounded: false,
    };
}

async function persistAssistantMessage(event, { session, sessions, idx, intent }, llm, maxTokens, assistantMsg, toolsUsed = []) {
    recordAnswerMetrics({
        grounded: !!assistantMsg?.grounded,
        noSourceMatches: !!assistantMsg?.noSourceMatches,
        clarification: !!assistantMsg?.clarification,
    });

    const updatedMessages = [
        ...session.messages,
        assistantMsg
    ];
    const messagesForModel = getContextMessagesForModel(updatedMessages, llm.model);
    const { estimatedUsed: newUsed, percentUsed: newPercent } =
        recomputeModelUsageFromMessages(messagesForModel, maxTokens);
    const totalMessages = messagesForModel.length;
    const assistantMessages = messagesForModel.filter((message) => message.role === "assistant").length;
    const modelStats = {
        ...(session.stats?.models || {}),
        [llm.model]: {
            model: llm.model,
            provider: llm.service,
            estimatedUsed: newUsed,
            totalMessages,
            assistantMessages,
            maxTokens,
            percentUsed: newPercent,
            updatedAt: new Date().toISOString(),
        },
    };
    const totalTokens = Object.values(modelStats)
        .reduce((sum, m) => sum + (m.estimatedUsed || 0), 0);
    const totalMessagesAll = Object.values(modelStats)
        .reduce((sum, m) => sum + (m.totalMessages || 0), 0);
    const nextRouting = updateSessionRoutingState(session, intent, toolsUsed, assistantMsg);
    console.log("[AI Chat] Updated session routing", {
        sessionId: session.id,
        routing: nextRouting,
    });
    const nextSession = {
        ...session,
        messages: updatedMessages,
        memory: mergeSessionMemory(
            deriveSessionMemory({
                ...session,
                messages: updatedMessages,
            }),
            llm?._sessionMemory || null
        ),
        routing: nextRouting,
        stats: {
            models: modelStats,
            summary: {
                totalTokens,
                totalMessages: totalMessagesAll,
                lastModel: llm.model,
                updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date().toISOString()
    };
    sessions[idx] = nextSession;
    saveSessionsDebounced(sessions, true);

    event.sender.send(AiChatChannels.on_off.STATS_UPDATE, {
        sessionId: nextSession.id,
        models: modelStats,
        summary: {
            totalTokens,
            totalMessages: totalMessagesAll,
            lastModel: llm.model,
            updatedAt: new Date().toISOString(),
        },
    });

    return nextSession;
}

function ensureAssistantReplyText(reply, intent = null) {
    const text = sanitizeAssistantText(String(reply || ""));
    if (text) {
        return text;
    }

    if (intent?.route === "fdo" && (intent?.scope || "general") === "general") {
        return buildClarificationMessage(intent, "");
    }

    return "I couldn’t produce a complete answer for that turn. Please try again or narrow the request a bit.";
}

function getFdoRetrievalMetadata(results = []) {
    const fdoResults = results.filter((result) => ["search_fdo_help", "search_fdo_code"].includes(result?.name));
    let bestConfidence = 0;
    let hasConflict = false;
    const sourceTypes = new Set();

    for (const result of fdoResults) {
        const metadata = result?.data?.metadata || {};
        if (Number.isFinite(metadata.retrievalConfidence)) {
            bestConfidence = Math.max(bestConfidence, metadata.retrievalConfidence);
        }
        if (metadata.hasConflict) {
            hasConflict = true;
        }
        for (const item of result?.results || []) {
            if (item?.sourceType) {
                sourceTypes.add(item.sourceType);
            }
        }
    }

    return {
        retrievalConfidence: bestConfidence,
        hasConflict,
        sourceTypes: Array.from(sourceTypes),
    };
}

function getFdoSourceDetails(results = []) {
    const details = [];
    for (const result of results) {
        if (!["search_fdo_help", "search_fdo_code"].includes(result?.name)) continue;
        for (const source of result?.sources || []) {
            if (!source?.source) continue;
            details.push({
                source: source.source,
                rawSource: source.rawSource || null,
                why: source.why || null,
                sourceType: source.sourceType || null,
                snippet: source.snippet || null,
            });
        }
    }

    const unique = [];
    const seen = new Set();
    for (const item of details) {
        const key = JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
    }
    return unique.slice(0, 8);
}

function getMemoryRelevantContent(message = {}) {
    const parts = [];
    const cleanedContent = stripRetrievalMetadata(message.content || "");
    if (cleanedContent) {
        parts.push(cleanedContent);
    }
    if (message.replyContext) {
        parts.push(`Reply context: ${String(message.replyContext).trim()}`);
    }
    if (message.contentAttachments) {
        parts.push(`Attachment context: ${String(message.contentAttachments).trim()}`);
    }
    return parts.join("\n");
}

function buildFallbackConversationSummary(messages = []) {
    const userMessages = messages.filter((message) => message.role === "user");
    const assistantMessages = messages.filter((message) => message.role === "assistant");

    const goalItems = userMessages
        .slice(-3)
        .map((message) => stripRetrievalMetadata(message.content || ""))
        .filter(Boolean)
        .slice(0, 3);

    const factItems = messages
        .map((message) => getMemoryRelevantContent(message))
        .filter(Boolean)
        .slice(-6);

    const decisionItems = assistantMessages
        .slice(-3)
        .map((message) => stripRetrievalMetadata(message.content || ""))
        .filter(Boolean)
        .slice(0, 3);

    const lines = [];
    if (goalItems.length > 0) {
        lines.push("### Goal");
        lines.push(...goalItems.map((item) => `- ${item}`));
    }
    if (factItems.length > 0) {
        lines.push("", "### Key Facts");
        lines.push(...factItems.map((item) => `- ${item}`));
    }
    if (decisionItems.length > 0) {
        lines.push("", "### Important Context To Remember");
        lines.push(...decisionItems.map((item) => `- ${item}`));
    }

    const summary = lines.join("\n").trim();
    return summary || "Earlier conversation covered implementation details and follow-up context that should be preserved.";
}

export async function normalizeSessionStats(session) {
    if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
        return session
            ? {
                ...session,
                memory: normalizeSessionMemory(session.memory),
                routing: normalizeSessionRouting(session.routing),
            }
            : session;
    }

    const assistantMessages = session.messages.filter((message) => message.role === "assistant" && message.model);
    if (assistantMessages.length === 0) {
        return {
            ...session,
            memory: deriveSessionMemory(session),
            routing: normalizeSessionRouting(session.routing),
        };
    }

    const modelNames = Array.from(new Set(assistantMessages.map((message) => message.model).filter(Boolean)));
    const normalizedModels = {};

    for (const modelName of modelNames) {
        const messagesForModel = getContextMessagesForModel(session.messages, modelName);
        const caps = await getModelCapabilities(modelName);
        const maxTokens = Math.floor((caps.maxTokens || 8192) * 0.95);
        const { estimatedUsed, percentUsed } = recomputeModelUsageFromMessages(messagesForModel, maxTokens);
        const previousModelStats = session.stats?.models?.[modelName] || {};
        const assistantMessages = messagesForModel.filter((message) => message.role === "assistant").length;

        normalizedModels[modelName] = {
            model: modelName,
            provider: previousModelStats.provider || caps.provider || "unknown",
            estimatedUsed,
            totalMessages: messagesForModel.length,
            assistantMessages,
            maxTokens,
            percentUsed,
            updatedAt: previousModelStats.updatedAt || session.updatedAt || session.createdAt || new Date().toISOString(),
        };
    }

    const totalTokens = Object.values(normalizedModels)
        .reduce((sum, modelStats) => sum + (modelStats.estimatedUsed || 0), 0);
    const totalMessages = Object.values(normalizedModels)
        .reduce((sum, modelStats) => sum + (modelStats.totalMessages || 0), 0);
    const lastAssistantMessage = [...assistantMessages].reverse().find(Boolean);

    return {
        ...session,
        memory: deriveSessionMemory(session),
        routing: normalizeSessionRouting(session.routing),
        stats: {
            models: normalizedModels,
            summary: {
                totalTokens,
                totalMessages,
                lastModel: lastAssistantMessage?.model || session.stats?.summary?.lastModel,
                updatedAt: session.stats?.summary?.updatedAt || session.updatedAt || session.createdAt || new Date().toISOString(),
            },
        },
    };
}



export async function compressSessionMessages(session, event, llm, assistantInfo, sessions, idx) {
    const modelStats = session.stats?.models?.[assistantInfo.model];
    if (!modelStats) return;

    // Mark compression start using only schema-safe fields
    session.stats = session.stats || {};
    session.stats.summary = {
        ...(session.stats.summary || {}),
        lastModel: assistantInfo.model,
        updatedAt: new Date().toISOString(),
    };
    sessions[idx] = session;
    saveSessionsDebounced(sessions, true);

    event?.sender?.send(AiChatChannels.on_off.COMPRESSION_START, { sessionId: session.id, model: assistantInfo.model });
    // Keep only the last couple of turns verbatim and aggressively
    // summarize everything older to free up as much context as
    // possible (target: ~20% usage remaining after compression).
    const MAX_RECENT = 4;

    // 🧠 Treat messages without an explicit model as belonging to the
    // current assistant. This lets us aggressively compress legacy
    // history that predates per-message model tagging, while still
    // preserving messages explicitly tagged with a *different* model.
    const modelMessages = session.messages.filter(
        m => !m.model || m.model === assistantInfo.model
    );
    const oldMessages = modelMessages.slice(0, -MAX_RECENT);
    const recentMessages = modelMessages.slice(-MAX_RECENT);

    if (oldMessages.length === 0) {
        // Nothing to compress; just notify UI and refresh timestamp
        session.stats.summary = {
            ...(session.stats.summary || {}),
            updatedAt: new Date().toISOString(),
        };
        sessions[idx] = session;
        saveSessionsDebounced(sessions, true);
        event?.sender?.send(AiChatChannels.on_off.COMPRESSION_DONE, {
            sessionId: session.id,
            model: assistantInfo.model,
            success: false,
            reason: "no-old-messages",
        });
        return;
    }

    const textBlock = oldMessages
        .map((message) => {
            const memoryContent = getMemoryRelevantContent(message);
            return memoryContent ? `${message.role}: ${memoryContent}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

    let resp;
    try {
        const summaryLlm = new LLM({
            service: assistantInfo.provider,
            apiKey: assistantInfo.apiKey,
            model: assistantInfo.model,
            extended: true,
            stream: false,
        });
        summaryLlm.system(`Summarize the conversation so it can replace earlier history without losing important context.

Requirements:
- Preserve user goals, constraints, preferences, decisions, unresolved questions, and promised follow-ups.
- Preserve concrete facts, identifiers, versions, numbers, file names, error messages, and links when relevant.
- Mention attachment-derived findings if they matter.
- Keep enough detail so a later answer can continue naturally without saying "I lost context".
- Be compact, but prioritize completeness over brevity.
- Do not summarize retrieval mechanics, tool names, source lists, or debug metadata unless they were themselves the subject of the conversation.
- Summarize conclusions and decisions from grounded answers, not the retrieval process used to produce them.

Return markdown with these sections when applicable:
- Goal
- Key Facts
- Decisions
- Open Questions
- Important Context To Remember`);
        resp = await withTpmRetry(() => summaryLlm.chat(textBlock));
    } catch (err) {
        console.error("[AI Chat] compressSessionMessages failed:", err);
        session.stats.summary = {
            ...(session.stats.summary || {}),
            lastModel: assistantInfo.model,
            updatedAt: new Date().toISOString(),
        };
        sessions[idx] = session;
        saveSessionsDebounced(sessions, true);
        event?.sender?.send(AiChatChannels.on_off.COMPRESSION_DONE, {
            sessionId: session.id,
            model: assistantInfo.model,
            success: false,
            error: err.message || String(err),
        });
        return;
    }

    const summaryText = String(resp?.content ?? "").trim() || buildFallbackConversationSummary(oldMessages);

    const summaryMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        model: assistantInfo.model,
        content: `🧠 **Summary of earlier ${assistantInfo.model} conversation:**\n${summaryText}`,
        createdAt: new Date().toISOString(),
    };
    if (resp?.usage) {
        summaryMsg["inputTokens"] = resp.usage.input_tokens;
        summaryMsg["outputTokens"] = resp.usage.output_tokens;
        summaryMsg["local"] = resp.usage.local;
        summaryMsg["totalTokens"] = resp.usage.total_tokens;
        summaryMsg["inputCost"] = resp.usage.input_cost;
        summaryMsg["outputCost"] = resp.usage.output_cost;
        summaryMsg["totalCost"] = resp.usage.total_cost;
    }

    const otherModelMsgs = session.messages.filter(
        m => m.model && m.model !== assistantInfo.model
    );
    session.messages = [...otherModelMsgs, summaryMsg, ...recentMessages];
    session.memory = deriveSessionMemory(session);

    const keptForThisModel = [summaryMsg, ...recentMessages]; // only those with m.model === model
    const { estimatedUsed } = recomputeModelUsageFromMessages(keptForThisModel, modelStats.maxTokens);

    // After compression, we want to *reserve* at least 20% of the
    // model context for future messages. That means we cap the
    // reported usage at 80% of maxTokens even if the raw estimate
    // is higher.
    const maxUsedAfterCompression = Math.floor(modelStats.maxTokens * 0.8);
    const adjustedUsed = Math.min(estimatedUsed, maxUsedAfterCompression);
    const adjustedPercent = Number(((adjustedUsed / modelStats.maxTokens) * 100).toFixed(1));

    const newModelStats = {
        ...modelStats,
        estimatedUsed: adjustedUsed,
        totalMessages: keptForThisModel.length,
        assistantMessages: keptForThisModel.filter((message) => message.role === "assistant").length,
        percentUsed: adjustedPercent,
        updatedAt: new Date().toISOString(),
    }

    session.stats.models[assistantInfo.model] = newModelStats;

    const totalTokens = Object.values(session.stats.models)
        .reduce((sum, stats) => sum + (stats.estimatedUsed || 0), 0);
    const totalMessages = Object.values(session.stats.models)
        .reduce((sum, stats) => sum + (stats.totalMessages || 0), 0);

    const summary = {
        lastModel: assistantInfo.model,
        updatedAt: new Date().toISOString(),
        totalTokens,
        totalMessages,
    };

    session.stats.summary = summary;

    sessions[idx] = session;
    saveSessionsDebounced(sessions, true);
    event?.sender?.send(AiChatChannels.on_off.COMPRESSION_DONE, {
        sessionId: session.id,
        model: assistantInfo.model,
        success: true,
    });

    event.sender.send(AiChatChannels.on_off.STATS_UPDATE, {
        sessionId: session.id,
        models: session.stats.models,
        summary,
    });
}

const buildLlmOptions = async (llm, useStream, useThink, caps) => {
    const llmOptions = {
        think: useThink,
        stream: useStream,
    }

    switch (llm.service) {
        case "openai":
            if (caps.supportsThinking && !(caps.reasoning && caps.api === "chat.completions")) {
                llmOptions.reasoning = {effort: useThink ? "high" : "medium"};
            }
            if (!(caps.reasoning && caps.api === "chat.completions")) {
                llmOptions[caps.maxField] = Math.floor((caps.maxTokens ?? 8192) * 0.95);
            }
            break
        default:
            if (useThink) {
                llmOptions.max_thinking_tokens = 2048
            }
    }
    return llmOptions
}

export async function handleStreamingResponse(
    llm,
    event,
    { session, sessions, idx, sessionId, intent },
    content,
    useThink,
    maxTokens,
    caps,
    currentAttachments = []
) {
    const forcedToolCalls = buildForcedToolCalls(intent, content, session.messages, session.routing);
    if (forcedToolCalls.length > 0) {
        console.log("[AI Chat] Forcing direct tool route", {
            sessionId,
            route: intent?.route,
            toolCalls: forcedToolCalls,
        });
        const follow = await toolFollowUp(llm, forcedToolCalls);
        if (follow?.content) {
            const assistantMsg = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: ensureAssistantReplyText(follow.content, intent),
                createdAt: new Date().toISOString(),
                model: llm.model,
            };
            if (Array.isArray(follow.sources) && follow.sources.length > 0) assistantMsg.sources = follow.sources;
            if (Array.isArray(follow.sourceDetails) && follow.sourceDetails.length > 0) assistantMsg.sourceDetails = follow.sourceDetails;
            if (follow.grounded) assistantMsg.grounded = true;
            if (Number.isFinite(follow.retrievalConfidence)) assistantMsg.retrievalConfidence = follow.retrievalConfidence;
            if (follow.retrievalConflict) assistantMsg.retrievalConflict = true;
            if (Array.isArray(follow.toolsUsed) && follow.toolsUsed.length > 0) assistantMsg.toolsUsed = follow.toolsUsed;
            if (Array.isArray(follow.toolErrors) && follow.toolErrors.length > 0) assistantMsg.toolErrors = follow.toolErrors;
            if (follow.noSourceMatches) assistantMsg.noSourceMatches = true;

            event.sender.send(AiChatChannels.on_off.STREAM_DELTA, {
                sessionId,
                type: "content",
                content: assistantMsg.content,
            });
            const nextSession = await persistAssistantMessage(event, { session, sessions, idx, intent }, llm, maxTokens, assistantMsg, assistantMsg.toolsUsed || []);
            event.sender.send(AiChatChannels.on_off.STREAM_DONE, { sessionId });
            return nextSession;
        }
    }

    const llmOptions = await buildLlmOptions(llm, true, useThink, caps);
    let resp;
    try {
        resp = await withTpmRetry(() => llm.chat(content, {
            ...llmOptions,
            attachments: currentAttachments,
        }));
    } catch (err) {
        if (err.message?.includes("invalidrequesterror")) {
            const badField = err.message.match(/input\[\d+\]\.content\[\d+\]\.(\w+)/)?.[1];
            const fieldInfo = badField ? ` (field: ${badField})` : "";

            throw new Error(`This model cannot process one of your attachments${fieldInfo}. Only images and PDFs are supported right now.`);
        }
        throw new Error(err.message || "An unexpected error occurred.");
    }

    let full = "";
    let streamedToolCalls = [];
    let tokenEstimate = 0;

    if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
        for await (const chunk of resp.stream) {
            if (!chunk) continue;
            const { type, content: piece } = chunk;

            if (type === "tool_calls" && Array.isArray(piece)) {
                streamedToolCalls.push(...piece);
                continue;
            }

            if (type === "content" && piece && typeof piece === "string") {
                full += piece;

                tokenEstimate = Math.ceil(full.length / 4);
                // soft cutoff guard
                if (tokenEstimate > (maxTokens || 8192) * 0.95) {
                    console.warn(`[AI Chat] ⚠️ Streaming cut early — reached ~95% of ${maxTokens} tokens`);
                    break;
                }
                if (piece) {
                    event.sender.send(AiChatChannels.on_off.STREAM_DELTA, {
                        sessionId,
                        type: "content",
                        content: piece,
                    });
                }
            } else if (type === "thinking" && piece) {
                event.sender.send(AiChatChannels.on_off.STREAM_DELTA, {
                    sessionId,
                    type: "thinking",
                    content: piece,
                });
            }
        }

        const complete = await resp.complete();
        let reply = String((complete && "content" in complete ? complete.content : full) || "");
        let replySources = [];
        let sourceDetails = [];
        let grounded = false;
        let toolsUsed = [];
        let toolErrors = [];
        let noSourceMatches = false;
        let retrievalConfidence = null;
        let retrievalConflict = false;
        let toolCalls = [...streamedToolCalls, ...(complete?.tool_calls || [])];

        if (toolCalls.length > 0) {
            const follow = await toolFollowUp(llm, toolCalls);
            if (follow?.content) {
                reply = follow.content;
                replySources = Array.isArray(follow.sources) ? follow.sources : [];
                sourceDetails = Array.isArray(follow.sourceDetails) ? follow.sourceDetails : [];
                grounded = !!follow.grounded;
                toolsUsed = Array.isArray(follow.toolsUsed) ? follow.toolsUsed : [];
                toolErrors = Array.isArray(follow.toolErrors) ? follow.toolErrors : [];
                noSourceMatches = !!follow.noSourceMatches;
                retrievalConfidence = Number.isFinite(follow.retrievalConfidence) ? follow.retrievalConfidence : null;
                retrievalConflict = !!follow.retrievalConflict;
            }
        }
        reply = await repairReplyLanguage(llm, reply);
        reply = ensureAssistantReplyText(reply, intent);

        const assistantMsg = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: reply,
            createdAt: new Date().toISOString(),
            model: llm.model,
        };
        if (replySources.length > 0) assistantMsg.sources = replySources;
        if (sourceDetails.length > 0) assistantMsg.sourceDetails = sourceDetails;
        if (grounded) assistantMsg.grounded = true;
        if (Number.isFinite(retrievalConfidence)) assistantMsg.retrievalConfidence = retrievalConfidence;
        if (retrievalConflict) assistantMsg.retrievalConflict = true;
        if (toolsUsed.length > 0) assistantMsg.toolsUsed = toolsUsed;
        if (toolErrors.length > 0) assistantMsg.toolErrors = toolErrors;
        if (noSourceMatches) assistantMsg.noSourceMatches = true;
        if (complete?.usage) {
            assistantMsg["inputTokens"] = complete?.usage.input_tokens;
            assistantMsg["outputTokens"] = complete?.usage.output_tokens;
            assistantMsg["local"] = complete?.usage.local;
            assistantMsg["totalTokens"] = complete?.usage.total_tokens;
            assistantMsg["inputCost"] = complete?.usage.input_cost;
            assistantMsg["outputCost"] = complete?.usage.output_cost;
            assistantMsg["totalCost"] = complete?.usage.total_cost;
        }
        const actualTokensUsed = complete?.usage?.total_tokens;
        const usageIncrement = typeof actualTokensUsed === "number" && actualTokensUsed > 0
            ? actualTokensUsed
            : tokenEstimate;
        console.log("[AI Chat] Request usage", {
            model: llm.model,
            provider: llm.service,
            mode: "stream",
            inputTokens: complete?.usage?.input_tokens ?? null,
            outputTokens: complete?.usage?.output_tokens ?? null,
            totalTokens: actualTokensUsed ?? usageIncrement,
        });
        llm?._trace?.update?.({
            usage: {
                mode: "stream",
                inputTokens: complete?.usage?.input_tokens ?? null,
                outputTokens: complete?.usage?.output_tokens ?? null,
                totalTokens: actualTokensUsed ?? usageIncrement,
            },
        });
        recordTokenUsage({
            mode: "stream",
            inputTokens: complete?.usage?.input_tokens ?? null,
            outputTokens: complete?.usage?.output_tokens ?? null,
            totalTokens: actualTokensUsed ?? usageIncrement,
        });

        session = await persistAssistantMessage(event, { session, sessions, idx, intent }, llm, maxTokens, assistantMsg, toolsUsed);
        event.sender.send(AiChatChannels.on_off.STREAM_DONE, { sessionId });
        return session;
    }

    return null;
}

export async function handleNonStreamingResponse(
    llm,
    event,
    { session, sessions, idx, intent },
    content,
    useThink,
    maxTokens,
    caps,
    currentAttachments = []
) {
    const forcedToolCalls = buildForcedToolCalls(intent, content, session.messages, session.routing);
    if (forcedToolCalls.length > 0) {
        console.log("[AI Chat] Forcing direct tool route", {
            sessionId: session.id,
            route: intent?.route,
            toolCalls: forcedToolCalls,
        });
        const follow = await toolFollowUp(llm, forcedToolCalls);
        if (follow?.content) {
            const repairedContent = await repairReplyLanguage(llm, follow.content);
            const assistantMsg = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: ensureAssistantReplyText(repairedContent, intent),
                createdAt: new Date().toISOString(),
                model: llm.model,
            };
            if (Array.isArray(follow.sources) && follow.sources.length > 0) assistantMsg.sources = follow.sources;
            if (Array.isArray(follow.sourceDetails) && follow.sourceDetails.length > 0) assistantMsg.sourceDetails = follow.sourceDetails;
            if (follow.grounded) assistantMsg.grounded = true;
            if (Number.isFinite(follow.retrievalConfidence)) assistantMsg.retrievalConfidence = follow.retrievalConfidence;
            if (follow.retrievalConflict) assistantMsg.retrievalConflict = true;
            if (Array.isArray(follow.toolsUsed) && follow.toolsUsed.length > 0) assistantMsg.toolsUsed = follow.toolsUsed;
            if (Array.isArray(follow.toolErrors) && follow.toolErrors.length > 0) assistantMsg.toolErrors = follow.toolErrors;
            if (follow.noSourceMatches) assistantMsg.noSourceMatches = true;
            return await persistAssistantMessage(event, { session, sessions, idx, intent }, llm, maxTokens, assistantMsg, assistantMsg.toolsUsed || []);
        }
    }

    const llmOptions = await buildLlmOptions(llm, false, useThink, caps);
    const resp = await withTpmRetry(() => llm.chat(content, {
        ...llmOptions,
        attachments: currentAttachments,
    }));

    let reply = "";
    let replySources = [];
    let sourceDetails = [];
    let grounded = false;
    let toolsUsed = [];
    let toolErrors = [];
    let noSourceMatches = false;
    let retrievalConfidence = null;
    let retrievalConflict = false;
    let toolCalls = [];

    if (resp && typeof resp === "object" && "content" in resp) {
        reply = String(resp.content || "");
        if (Array.isArray(resp.tool_calls) && resp.tool_calls.length > 0)
            toolCalls = resp.tool_calls;
    } else {
        reply = String(resp || "");
    }

    if (toolCalls.length > 0) {
        const follow = await toolFollowUp(llm, toolCalls);
        if (follow?.content) {
            reply = follow.content;
            replySources = Array.isArray(follow.sources) ? follow.sources : [];
            sourceDetails = Array.isArray(follow.sourceDetails) ? follow.sourceDetails : [];
            grounded = !!follow.grounded;
            toolsUsed = Array.isArray(follow.toolsUsed) ? follow.toolsUsed : [];
            toolErrors = Array.isArray(follow.toolErrors) ? follow.toolErrors : [];
            noSourceMatches = !!follow.noSourceMatches;
            retrievalConfidence = Number.isFinite(follow.retrievalConfidence) ? follow.retrievalConfidence : null;
            retrievalConflict = !!follow.retrievalConflict;
        }
    }
    reply = await repairReplyLanguage(llm, reply);
    reply = ensureAssistantReplyText(reply, intent);

    const tokenEstimate = Math.ceil(reply.length / 4);

    const assistantMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
        model: llm.model,
    };
    if (replySources.length > 0) assistantMsg.sources = replySources;
    if (sourceDetails.length > 0) assistantMsg.sourceDetails = sourceDetails;
    if (grounded) assistantMsg.grounded = true;
    if (Number.isFinite(retrievalConfidence)) assistantMsg.retrievalConfidence = retrievalConfidence;
    if (retrievalConflict) assistantMsg.retrievalConflict = true;
    if (toolsUsed.length > 0) assistantMsg.toolsUsed = toolsUsed;
    if (toolErrors.length > 0) assistantMsg.toolErrors = toolErrors;
    if (noSourceMatches) assistantMsg.noSourceMatches = true;
    if (resp?.usage) {
        assistantMsg["inputTokens"] = resp.usage.input_tokens;
        assistantMsg["outputTokens"] = resp.usage.output_tokens;
        assistantMsg["local"] = resp.usage.local;
        assistantMsg["totalTokens"] = resp.usage.total_tokens;
        assistantMsg["inputCost"] = resp.usage.input_cost;
        assistantMsg["outputCost"] = resp.usage.output_cost;
        assistantMsg["totalCost"] = resp.usage.total_cost;
    }
    const actualTokensUsed = resp?.usage?.total_tokens;
    const usageIncrement = typeof actualTokensUsed === "number" && actualTokensUsed > 0
        ? actualTokensUsed
        : tokenEstimate;
    console.log("[AI Chat] Request usage", {
        model: llm.model,
        provider: llm.service,
        mode: "non-stream",
        inputTokens: resp?.usage?.input_tokens ?? null,
        outputTokens: resp?.usage?.output_tokens ?? null,
        totalTokens: actualTokensUsed ?? usageIncrement,
    });
    llm?._trace?.update?.({
        usage: {
            mode: "non-stream",
            inputTokens: resp?.usage?.input_tokens ?? null,
            outputTokens: resp?.usage?.output_tokens ?? null,
            totalTokens: actualTokensUsed ?? usageIncrement,
        },
    });
    recordTokenUsage({
        mode: "non-stream",
        inputTokens: resp?.usage?.input_tokens ?? null,
        outputTokens: resp?.usage?.output_tokens ?? null,
        totalTokens: actualTokensUsed ?? usageIncrement,
    });

    return await persistAssistantMessage(event, { session, sessions, idx, intent }, llm, maxTokens, assistantMsg, toolsUsed);
}

async function toolFollowUp(llm, toolCalls) {
    const toolFollowUpSpan = llm?._trace?.startSpan?.("tool-follow-up", {
        input: (toolCalls || []).map((call) => ({
            name: call?.name || null,
            input: call?.input || {},
        })),
        metadata: {
            toolCount: Array.isArray(toolCalls) ? toolCalls.length : 0,
        },
    }) || null;
    const uniqueToolCalls = dedupeToolCalls(enrichToolCallsWithIntent(toolCalls, llm));
    const results = await runToolCalls(uniqueToolCalls, llm?._trace || null);
    if (!results?.length) return null;
    const sources = results.flatMap((result) => (
        Array.isArray(result?.sources) ? result.sources : []
    ));
    const usedFdoKnowledge = uniqueToolCalls.some((call) => ["search_fdo_help", "search_fdo_code"].includes(call?.name));
    const fdoMetadata = getFdoRetrievalMetadata(results);
    const fdoSourceDetails = getFdoSourceDetails(results);
    const toolErrors = results
        .filter((result) => result?.error)
        .map((result) => ({ name: result.name, error: result.error }));
    const toolsUsed = Array.from(new Set(
        uniqueToolCalls
            .map((call) => call?.name)
            .filter(Boolean)
    ));
    recordToolUsage(toolsUsed);

    const webNoResultsFallback = buildWebNoResultsFallback(results, llm?._originalPrompt);
    if (webNoResultsFallback?.content) {
        toolFollowUpSpan?.finish({
            output: webNoResultsFallback.content,
            metadata: {
                toolsUsed,
                toolErrors,
                noResults: true,
            },
        });
        return {
            content: webNoResultsFallback.content,
            sources: [],
            sourceDetails: [],
            grounded: false,
            toolsUsed,
            toolErrors,
            noSourceMatches: false,
            retrievalConfidence: 0,
            retrievalConflict: false,
        };
    }

    if (results.every((result) => result?.error)) {
        const weatherFailure = toolErrors.find((error) => error.name === "get_current_weather");
        const content = weatherFailure
            ? `I couldn’t fetch live weather data right now because the weather providers failed.\n\nPlease try again in a moment.`
            : `I couldn’t complete the requested tool lookup right now because the required tool call failed.\n\nPlease try again in a moment.`;
        toolFollowUpSpan?.finish({
            output: content,
            metadata: {
                toolsUsed,
                toolErrors,
                allFailed: true,
            },
        });
        return {
            content: sanitizeAssistantText(content),
            sources: [],
            sourceDetails: [],
            grounded: false,
            toolsUsed,
            toolErrors,
            noSourceMatches: false,
            retrievalConfidence: 0,
            retrievalConflict: false,
        };
    }

    const readable = results
        .map(r => r.text ?? (r.error ? `⚠️ ${r.name}: ${r.error}` : JSON.stringify(r, null, 2)))
        .join("\n\n");
    const retrievalTokens = Math.ceil(readable.length / 4);
    const behaviorRules = buildToolFollowUpBehavior(llm?._sessionMemory, llm?._intent, llm?._originalPrompt, llm?._targetReplyLanguage);

    const prompt =
        `You are a helpful assistant.\n\n` +
        `Tool results:\n${readable}\n\n` +
        (behaviorRules.length > 0 ? `Behavior rules:\n- ${behaviorRules.join("\n- ")}\n\n` : "") +
        `Using only these tool results, write a clear natural-language answer with numbers and context when available.\n` +
        `If the tool results are insufficient, say that directly instead of guessing.\n` +
        `Do not append a "Sources used" footer; the application renders sources separately.`;

    // 🔹 create a *new* non-extended instance so it really calls the model once
    const llmDirect = new LLM({
        service: llm.service ?? "openai",
        apiKey: llm.apiKey,
        model: llm.options?.model ?? "gpt-5",
        stream: false,          // truly non-streaming
        extended: false,        // <- important!
        max_tokens: 1024,
    });

    let resp;
    try {
        resp = await llmDirect.chat(prompt);
        recordTokenUsage({
            mode: "tool-follow-up",
            inputTokens: resp?.usage?.input_tokens ?? null,
            outputTokens: resp?.usage?.output_tokens ?? null,
            totalTokens: resp?.usage?.total_tokens ?? null,
            retrievalTokens,
        });
    } catch (err) {
        console.error("[AI Chat] toolFollowUp request failed:", err);
        toolFollowUpSpan?.fail(err, {
            toolsUsed,
            toolErrors,
        });
        return {
            content: sanitizeAssistantText(`⚠️ Tool follow-up request failed: ${err.message}`),
            sources: Array.from(new Set(
                sources
                    .map((sourceInfo) => sourceInfo?.source)
                    .filter(Boolean)
            )),
            sourceDetails: fdoSourceDetails,
            grounded: usedFdoKnowledge,
            toolsUsed: Array.from(new Set(
                uniqueToolCalls
                    .map((call) => call?.name)
                    .filter(Boolean)
            )),
            toolErrors: [{ name: "tool_follow_up", error: err.message }],
            noSourceMatches: usedFdoKnowledge && sources.length === 0,
            retrievalConfidence: fdoMetadata.retrievalConfidence,
            retrievalConflict: fdoMetadata.hasConflict,
        };
    }

    // --- normalize ---
    let reply = "";
    if (typeof resp === "string") reply = resp;
    else if (typeof resp?.content === "string") reply = resp.content;
    else if (Array.isArray(resp?.choices))
        reply = resp.choices.map(c => c.message?.content || c.text || "").join("\n");
    else if (Array.isArray(resp?.messages))
        reply = resp.messages.find(m => m.role === "assistant" && m.content)?.content || "";

    if (usedFdoKnowledge && fdoMetadata.retrievalConfidence > 0 && fdoMetadata.retrievalConfidence < 0.55) {
        const uniqueSources = Array.from(new Set(
            sources
                .map((sourceInfo) => sourceInfo?.source)
                .filter(Boolean)
        ));
        const lowConfidenceResult = {
            content: sanitizeAssistantText(
                `Grounded with FDO knowledge retrieval.\n\nI found some potentially relevant FDO sources, but confidence is low, so I do not want to overstate the answer.\n\nCan you narrow this down a bit, for example whether you mean UI behavior, plugin internals, settings, or implementation details?`
            ),
            sources: uniqueSources,
            sourceDetails: fdoSourceDetails,
            grounded: true,
            toolsUsed: Array.from(new Set(
                uniqueToolCalls
                    .map((call) => call?.name)
                    .filter(Boolean)
            )),
            toolErrors: results
                .filter((result) => result?.error)
                .map((result) => ({ name: result.name, error: result.error })),
            noSourceMatches: uniqueSources.length === 0,
            retrievalConfidence: fdoMetadata.retrievalConfidence,
            retrievalConflict: fdoMetadata.hasConflict,
        };
        toolFollowUpSpan?.finish({
            output: lowConfidenceResult.content,
            metadata: {
                toolsUsed: lowConfidenceResult.toolsUsed,
                toolErrors: lowConfidenceResult.toolErrors,
                grounded: true,
                retrievalConfidence: fdoMetadata.retrievalConfidence,
                retrievalConflict: !!fdoMetadata.hasConflict,
                sourceCount: uniqueSources.length,
                lowConfidence: true,
            },
        });
        return lowConfidenceResult;
    }

    if (!reply?.trim()) {
        const fdoFallback = usedFdoKnowledge ? buildFdoKnowledgeFallback(results) : null;
        if (fdoFallback?.content) {
            const fdoFallbackResult = {
                content: sanitizeAssistantText(fdoFallback.content),
                sources: fdoFallback.sources || [],
                sourceDetails: fdoSourceDetails,
                grounded: true,
                toolsUsed: Array.from(new Set(
                    uniqueToolCalls
                        .map((call) => call?.name)
                        .filter(Boolean)
                )),
                toolErrors: results
                    .filter((result) => result?.error)
                    .map((result) => ({ name: result.name, error: result.error })),
                noSourceMatches: !!fdoFallback.noSourceMatches,
                retrievalConfidence: fdoMetadata.retrievalConfidence,
                retrievalConflict: fdoMetadata.hasConflict,
            };
            toolFollowUpSpan?.finish({
                output: fdoFallbackResult.content,
                metadata: {
                    toolsUsed: fdoFallbackResult.toolsUsed,
                    toolErrors: fdoFallbackResult.toolErrors,
                    grounded: true,
                    fallback: "fdo",
                    retrievalConfidence: fdoMetadata.retrievalConfidence ?? null,
                    retrievalConflict: !!fdoMetadata.hasConflict,
                    sourceCount: fdoFallbackResult.sources.length,
                },
            });
            return fdoFallbackResult;
        }

        const webFallback = buildWebKnowledgeFallback(results);
        if (webFallback?.content) {
            const webFallbackResult = {
                content: sanitizeAssistantText(webFallback.content),
                sources: webFallback.sources || [],
                sourceDetails: [],
                grounded: false,
                toolsUsed: Array.from(new Set(
                    uniqueToolCalls
                        .map((call) => call?.name)
                        .filter(Boolean)
                )),
                toolErrors: results
                    .filter((result) => result?.error)
                    .map((result) => ({ name: result.name, error: result.error })),
                noSourceMatches: false,
                retrievalConfidence: 0,
                retrievalConflict: false,
            };
            toolFollowUpSpan?.finish({
                output: webFallbackResult.content,
                metadata: {
                    toolsUsed: webFallbackResult.toolsUsed,
                    toolErrors: webFallbackResult.toolErrors,
                    grounded: false,
                    fallback: "web",
                    sourceCount: webFallbackResult.sources.length,
                },
            });
            return webFallbackResult;
        }

        const fallbackSections = results.map((result) => {
            if (result.error) {
                return `- ${result.name}: ${result.error}`;
            }
            const body = result.text || JSON.stringify(result.results || [], null, 2);
            return `- ${result.name}: ${body}`;
        });
        reply = `I used the available tool results directly because the follow-up synthesis step returned no text.\n\n${fallbackSections.join("\n\n")}`;
    }

    if (usedFdoKnowledge) {
        const conflictPrefix = fdoMetadata.hasConflict
            ? `Grounded with FDO knowledge retrieval.\n\nThe retrieved sources are somewhat mixed, so treat this as a best-effort answer:\n\n`
            : `Grounded with FDO knowledge retrieval.\n\n`;
        reply = `${conflictPrefix}${reply.trim()}`;
    }

    const uniqueSources = Array.from(new Set(
        sources
            .map((sourceInfo) => sourceInfo?.source)
            .filter(Boolean)
    ));
    const followUpResult = {
        content: sanitizeAssistantText(
            reply
                .replace(/(?:\n|\r|^|\s)*sources used:?\s*[\s\S]*$/i, "")
                .trim()
        ),
        sources: uniqueSources,
        sourceDetails: fdoSourceDetails,
        grounded: usedFdoKnowledge,
        toolsUsed,
        toolErrors,
        noSourceMatches: usedFdoKnowledge && uniqueSources.length === 0,
        retrievalConfidence: fdoMetadata.retrievalConfidence,
        retrievalConflict: fdoMetadata.hasConflict,
    };
    toolFollowUpSpan?.finish({
        output: followUpResult.content,
        metadata: {
            toolsUsed,
            toolErrors,
            grounded: usedFdoKnowledge,
            retrievalConfidence: fdoMetadata.retrievalConfidence ?? null,
            retrievalConflict: !!fdoMetadata.hasConflict,
            sourceCount: uniqueSources.length,
        },
    });
    return followUpResult;
}
