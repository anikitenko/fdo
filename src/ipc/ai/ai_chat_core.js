// src/main/ai/ai_chat_core.js
import LLM from "@themaximalist/llm.js";
import { settings } from "../../utils/store.js";
import { AiChatChannels } from "../channels.js";
import { getActiveTools, runToolCalls } from "./tools/index";
import debounce from "lodash/debounce";
import { getModelCapabilities, getCacheInfo } from "./model_capabilities/index";

// --- Concurrency lock map ---
const sessionLocks = new Map();

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

export function prepareSessionMessage(sessionId, content) {
    if (!content || !String(content).trim()) throw new Error("Message content is empty.");

    const sessions = (settings.get("ai.sessions", []) || []).slice();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) throw new Error("Session not found.");

    const now = new Date().toISOString();
    const userMsg = { id: crypto.randomUUID(), role: "user", content, createdAt: now };
    const session = { ...sessions[idx], messages: [...sessions[idx].messages, userMsg], updatedAt: now };
    sessions[idx] = session;
    saveSessionsDebounced(sessions, true);

    return { session, sessions, idx };
}

export function selectAssistant(provider, model) {
    const list = settings.get("ai.chat", []) || [];
    let assistantInfo = null;

    if (provider || model) {
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

export async function createLlmInstance(assistantInfo, content, think, stream) {
    const caps = await getModelCapabilities(assistantInfo.model, assistantInfo);

    // 🧩 Optional diagnostic
    const info = getCacheInfo();
    console.log(
        `[ModelCaps] Using cache from ${new Date(info.updatedAt).toLocaleString()} (${info.stale ? "STALE" : "FRESH"})`
    );

    const useThink = !!think && caps.reasoning;

    const streamingDefault = !!settings.get("ai.options.chatStreamingDefault", false);
    const streaming =
        (useThink && caps.reasoning) ||
        (stream === true && caps.streaming) ||
        (typeof stream === "undefined" && streamingDefault && caps.streaming);

    const activeTools = getActiveTools(content);
    const toolsToUse = activeTools.length > 0
        ? activeTools.map(t => ({name: t.name, description: t.description, input_schema: t.input_schema}))
        : undefined;

    const maxTokens = caps.maxTokens || 8192;

    const llm = new LLM({
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: streaming,
        extended: true,
        tools: toolsToUse,
        max_tokens: maxTokens,
    });

    return {llm, streaming, toolsToUse, maxTokens};
}

export async function handleStreamingResponse(
    llm,
    event,
    { session, sessions, idx, sessionId },
    content,
    useThink,
    maxTokens
) {
    const resp = await llm.chat(content, {
        think: useThink,
        stream: true,
        max_tokens: Math.floor((maxTokens || 8192) * 0.95), // stay 5% under limit
        max_thinking_tokens: useThink ? 2048 : undefined,
    });

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
                tokenEstimate += Math.ceil(piece.length / 4);
                // soft cutoff guard
                if (tokenEstimate > (maxTokens || 8192) * 0.95) {
                    console.warn(`[AI Chat] ⚠️ Streaming cut early — reached ~95% of ${maxTokens} tokens`);
                    break;
                }
                event.sender.send(AiChatChannels.on_off.STREAM_DELTA, {
                    sessionId,
                    type: "content",
                    content: piece,
                });
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
        let toolCalls = [...(streamedToolCalls || []), ...(complete?.tool_calls || [])];

        if (toolCalls.length > 0) {
            const follow = await toolFollowUp(llm, toolCalls);
            if (follow) reply = follow;
        }

        const assistantMsg = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: reply,
            createdAt: new Date().toISOString(),
            model: llm.model,
        };
        if (complete?.usage) {
            assistantMsg["inputTokens"] = complete?.usage.input_tokens;
            assistantMsg["outputTokens"] = complete?.usage.output_tokens;
            assistantMsg["local"] = complete?.usage.local;
            assistantMsg["totalTokens"] = complete?.usage.total_tokens;
            assistantMsg["inputCost"] = complete?.usage.input_cost;
            assistantMsg["outputCost"] = complete?.usage.output_cost;
            assistantMsg["totalCost"] = complete?.usage.total_cost;
        }
        const prevStats = session.stats || {};

        const newUsed = (prevStats.estimatedUsed || 0) + tokenEstimate;
        const newPercent = Number(((newUsed / maxTokens) * 100).toFixed(1));
        const totalMessages = (prevStats.totalMessages || 0) + 1;
        const modelStats = {
            ...(session.stats?.models || {}),
            [llm.model]: {
                model: llm.model,
                provider: llm.service,
                estimatedUsed: newUsed,
                totalMessages,
                maxTokens,
                percentUsed: newPercent,
                updatedAt: new Date().toISOString(),
            },
        };
        const totalTokens = Object.values(modelStats)
            .reduce((sum, m) => sum + (m.estimatedUsed || 0), 0);
        const totalMessagesAll = Object.values(modelStats)
            .reduce((sum, m) => sum + (m.totalMessages || 0), 0);
        session = {
            ...session,
            messages: [
                ...session.messages,
                assistantMsg
            ],
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
        sessions[idx] = session;
        saveSessionsDebounced(sessions, true);

        event.sender.send(AiChatChannels.on_off.STATS_UPDATE, {
            sessionId,
            models: modelStats,
            summary: {
                totalTokens,
                totalMessages: totalMessagesAll,
                lastModel: llm.model,
                updatedAt: new Date().toISOString(),
            },
        });

        event.sender.send(AiChatChannels.on_off.STREAM_DONE, { sessionId });
        return session;
    }

    return null;
}

export async function handleNonStreamingResponse(
    llm,
    event,
    { session, sessions, idx },
    content,
    useThink,
    maxTokens
) {
    const resp = await llm.chat(content, {
        think: useThink,
        stream: false,
        max_tokens: Math.floor((maxTokens || 8192) * 0.9), // 10% margin
        max_thinking_tokens: useThink ? 2048 : undefined,
    });

    let reply = "";
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
        if (follow) reply = follow;
    }

    const tokenEstimate = Math.ceil(reply.length / 4);

    const assistantMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
        model: llm.model,
    };
    if (resp?.usage) {
        assistantMsg["inputTokens"] = resp.usage.input_tokens;
        assistantMsg["outputTokens"] = resp.usage.output_tokens;
        assistantMsg["local"] = resp.usage.local;
        assistantMsg["totalTokens"] = resp.usage.total_tokens;
        assistantMsg["inputCost"] = resp.usage.input_cost;
        assistantMsg["outputCost"] = resp.usage.output_cost;
        assistantMsg["totalCost"] = resp.usage.total_cost;
    }
    const prevStats = session.stats || {};

    const newUsed = (prevStats.estimatedUsed || 0) + tokenEstimate;
    const newPercent = Number(((newUsed / maxTokens) * 100).toFixed(1));
    const totalMessages = (prevStats.totalMessages || 0) + 1;
    const modelStats = {
        ...(session.stats?.models || {}),
        [llm.model]: {
            model: llm.model,
            provider: llm.service,
            estimatedUsed: newUsed,
            totalMessages,
            maxTokens,
            percentUsed: newPercent,
            updatedAt: new Date().toISOString(),
        },
    };
    const totalTokens = Object.values(modelStats)
        .reduce((sum, m) => sum + (m.estimatedUsed || 0), 0);
    const totalMessagesAll = Object.values(modelStats)
        .reduce((sum, m) => sum + (m.totalMessages || 0), 0);
    session = {
        ...session,
        messages: [
            ...session.messages,
            assistantMsg
        ],
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
    sessions[idx] = session;
    saveSessionsDebounced(sessions, true);

    event.sender.send(AiChatChannels.on_off.STATS_UPDATE, {
        sessionId: session.id,
        models: modelStats,
        summary: {
            totalTokens,
            totalMessages: totalMessagesAll,
            lastModel: llm.model,
            updatedAt: new Date().toISOString(),
        },
    });

    return session;
}

async function toolFollowUp(llm, toolCalls) {
    const results = await runToolCalls(toolCalls);
    if (!results?.length) return null;

    const readable = results
        .map(r => r.text ?? (r.error ? `⚠️ ${r.name}: ${r.error}` : JSON.stringify(r, null, 2)))
        .join("\n\n");

    const prompt =
        `You are a helpful assistant.\n\n` +
        `Tool results:\n${readable}\n\n` +
        `Using these results, write a clear natural-language summary with numbers and context.`;

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
    } catch (err) {
        console.error("[AI Chat] toolFollowUp request failed:", err);
        return `⚠️ Tool follow-up request failed: ${err.message}`;
    }

    // --- normalize ---
    let reply = "";
    if (typeof resp === "string") reply = resp;
    else if (typeof resp?.content === "string") reply = resp.content;
    else if (Array.isArray(resp?.choices))
        reply = resp.choices.map(c => c.message?.content || c.text || "").join("\n");
    else if (Array.isArray(resp?.messages))
        reply = resp.messages.find(m => m.role === "assistant" && m.content)?.content || "";
    if (!reply?.trim()) reply = "⚠️ Model produced no textual summary.";

    return reply.trim();
}
