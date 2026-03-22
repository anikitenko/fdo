import {ipcMain} from "electron";
import {AiChatChannels} from "../channels";
import {settings} from "../../utils/store";
import {
    compressSessionMessages,
    createLlmInstance,
    handleNonStreamingResponse,
    handleStreamingResponse,
    normalizeSessionStats,
    persistClarificationResponse,
    prepareSessionMessage, saveSessionsDebounced,
    selectAssistant, withSessionLock
} from "./ai_chat_core";
import {getModelCapabilities} from "./model_capabilities";
import {detectAttachmentType} from "./utils/detectAttachmentType";
import { createAiObservabilityTrace, getObservabilityPromptVersion } from "./observability.js";

function isEmptyDraftSession(session) {
    return Array.isArray(session?.messages) && session.messages.length === 0;
}

function compareSessionRecency(a, b) {
    const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
    const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
    return bTime - aTime;
}

function normalizeEmptyDraftSessions(sessions) {
    const ordered = (sessions || []).slice().sort(compareSessionRecency);
    let keptEmptyDraft = false;
    return ordered.filter((session) => {
        if (!isEmptyDraftSession(session)) return true;
        if (keptEmptyDraft) return false;
        keptEmptyDraft = true;
        return true;
    });
}

function buildNewSession(name) {
    const now = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        name: name || 'New Chat',
        createdAt: now,
        updatedAt: now,
        messages: [],
        memory: {
            preferences: {
                preferredLanguage: null,
                responseStyle: null,
            },
            summary: {
                content: null,
                model: null,
                updatedAt: null,
            },
        },
        routing: {
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
        },
    };
}

export function registerAiChatHandlers() {
    ipcMain.handle(AiChatChannels.SESSIONS_GET, async () => {
        const sessions = normalizeEmptyDraftSessions((settings.get('ai.sessions', []) || []).slice());
        const normalizedSessions = await Promise.all(
            sessions.map((session) => normalizeSessionStats(session))
        );
        settings.set('ai.sessions', normalizedSessions);
        return normalizedSessions;
    })

    ipcMain.handle(AiChatChannels.SESSION_CREATE, async (_, name) => {
        const requestedName = (name || 'New Chat').trim() || 'New Chat';
        const sessions = normalizeEmptyDraftSessions((settings.get('ai.sessions', []) || []).slice());
        const existingEmpty = sessions.find((session) => isEmptyDraftSession(session));

        if (existingEmpty) {
            const now = new Date().toISOString();
            const reused = {
                ...existingEmpty,
                name: requestedName,
                updatedAt: now,
            };
            const nextSessions = [reused, ...sessions.filter((session) => session.id !== reused.id)];
            settings.set('ai.sessions', nextSessions);
            return reused;
        }

        const session = buildNewSession(requestedName);
        sessions.unshift(session);
        settings.set('ai.sessions', sessions);
        return session;
    })

    ipcMain.handle(AiChatChannels.SESSION_RENAME, async (_, sessionId, name) => {
        const requestedName = (name || '').trim();
        if (!sessionId || !requestedName) return null;
        const sessions = (settings.get('ai.sessions', []) || []).slice();
        const idx = sessions.findIndex((session) => session.id === sessionId);
        if (idx === -1) return null;
        const updated = {
            ...sessions[idx],
            name: requestedName,
            updatedAt: new Date().toISOString(),
        };
        sessions[idx] = updated;
        settings.set('ai.sessions', sessions);
        return updated;
    })

    ipcMain.handle(AiChatChannels.GET_PREFERENCES, async () => {
        return settings.get("ai.options.chatDialog", {}) || {};
    })

    ipcMain.handle(AiChatChannels.SAVE_PREFERENCES, async (_, data) => {
        const previous = settings.get("ai.options.chatDialog", {}) || {};
        const next = {
            ...previous,
            ...data,
        };
        settings.set("ai.options.chatDialog", next);
        return next;
    })

    ipcMain.handle(AiChatChannels.SEND_MESSAGE, async (event, { sessionId, content, think, stream, provider, model, assistantId, temperature, attachments, replyTo }) => {
        return await withSessionLock(sessionId, async () => {
            const { session, sessions, idx, currentReplyContext } = await prepareSessionMessage(sessionId, content, attachments, replyTo);
            const trace = createAiObservabilityTrace({
                name: "ai-chat-turn",
                sessionId,
                input: String(content || "").trim(),
                metadata: {
                    promptVersion: getObservabilityPromptVersion(),
                    provider: provider || null,
                    model: model || null,
                    assistantId: assistantId || null,
                    hasAttachments: Array.isArray(attachments) && attachments.length > 0,
                    hasReplyContext: !!replyTo,
                },
            });
            const assistantInfo = selectAssistant(assistantId, provider, model);
            console.log("[AI Chat] Selected assistant for sendMessage", {
                sessionId,
                requestedAssistantId: assistantId || null,
                requestedProvider: provider || null,
                requestedModel: model || null,
                selectedAssistantId: assistantInfo.id,
                selectedAssistantName: assistantInfo.name,
                selectedProvider: assistantInfo.provider,
                selectedModel: assistantInfo.model,
            });

            const caps = await getModelCapabilities(assistantInfo.model, assistantInfo);
            const useThink = !!think && caps.reasoning;

            const historyMessages = session.messages.slice(0, -1);
            const {
                llm,
                streaming,
                maxTokens,
                currentAttachments,
                intent,
                clarificationNeeded,
                clarificationMessage,
                effectiveContent,
                resolvedSessionMemory,
            } = await createLlmInstance(
                assistantInfo,
                content,
                useThink,
                stream,
                caps,
                temperature,
                attachments,
                historyMessages,
                session.routing,
                session.memory,
                currentReplyContext,
                trace
            );

            if (clarificationNeeded) {
                console.log("[AI Chat] Returning clarification response", {
                    sessionId,
                    route: intent?.route || "general",
                    scope: intent?.scope || "general",
                    confidence: intent?.confidence ?? null,
                    message: clarificationMessage || null,
                });
                const clarified = await persistClarificationResponse(
                    session,
                    sessions,
                    idx,
                    clarificationMessage,
                    intent,
                    resolvedSessionMemory
                );
                await trace.finish({
                    output: clarificationMessage,
                    metadata: {
                        route: intent?.route || "general",
                        scope: intent?.scope || "general",
                        taskShape: intent?.taskShape || "general_chat",
                        clarification: true,
                    },
                });
                return clarified;
            }

            const activeStats = session.stats?.models?.[model];
            const threshold = 0.85; // 85%

            if (activeStats && activeStats.estimatedUsed / activeStats.maxTokens > threshold) {
                await compressSessionMessages(session, event, llm, assistantInfo, sessions, idx);
            }

            try {
                if (streaming) {
                    const result = await handleStreamingResponse(llm, event, { session, sessions, idx, sessionId, intent }, effectiveContent, useThink, maxTokens, caps, currentAttachments);
                    if (result) {
                        await trace.finish({
                            output: result?.messages?.[result.messages.length - 1]?.content || null,
                            metadata: {
                                route: intent?.route || "general",
                                scope: intent?.scope || "general",
                                taskShape: intent?.taskShape || "general_chat",
                                toolsUsed: result?.messages?.[result.messages.length - 1]?.toolsUsed || [],
                            },
                        });
                        return result;
                    }
                }
                const result = await handleNonStreamingResponse(llm, event, { session, sessions, idx, intent }, effectiveContent, useThink, maxTokens, caps, currentAttachments);
                await trace.finish({
                    output: result?.messages?.[result.messages.length - 1]?.content || null,
                    metadata: {
                        route: intent?.route || "general",
                        scope: intent?.scope || "general",
                        taskShape: intent?.taskShape || "general_chat",
                        toolsUsed: result?.messages?.[result.messages.length - 1]?.toolsUsed || [],
                    },
                });
                return result;
            } catch (e) {
                console.warn("[AI Chat] sendMessage failed", {
                    sessionId,
                    selectedAssistantId: assistantInfo.id,
                    selectedAssistantName: assistantInfo.name,
                    selectedProvider: assistantInfo.provider,
                    selectedModel: assistantInfo.model,
                    error: e?.message || "Unknown error",
                });
                const errorText = [
                    `Error: ${e?.message || "Failed to get response from AI"}`,
                    "",
                    `Assistant: ${assistantInfo.name || assistantInfo.id || "Unknown"}`,
                    `Provider: ${assistantInfo.provider || "Unknown"}`,
                    `Model: ${assistantInfo.model || "Unknown"}`,
                ].join("\n");
                event.sender.send(AiChatChannels.on_off.STREAM_ERROR, { sessionId, error: errorText });
                const assistantMsg = { id: crypto.randomUUID(), role: "assistant", content: errorText, createdAt: new Date().toISOString() };
                session.messages.push(assistantMsg);
                session.updatedAt = new Date().toISOString();
                sessions[idx] = session;
                saveSessionsDebounced(sessions, true);
                await trace.fail(e, {
                    route: session.routing?.activeRoute || "general",
                    scope: session.routing?.activeScope || "general",
                });
                return session;
            }
        })
    })

    ipcMain.handle(AiChatChannels.GET_CAPABILITIES, async (_, model, provider, assistantId) => {
        const assistantInfo = selectAssistant(assistantId, provider, model);
        return await getModelCapabilities(assistantInfo.model, assistantInfo);
    })

    ipcMain.handle(AiChatChannels.DETECT_ATTACHMENT_TYPE, async (_, files) => {
        const types = []
        for (const file of files) {
            const type = await detectAttachmentType(file);
            types.push(type);
        }
        return types;
    })
}
