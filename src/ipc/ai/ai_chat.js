import {ipcMain} from "electron";
import {AiChatChannels} from "../channels";
import {settings} from "../../utils/store";
import {
    compressSessionMessages,
    createLlmInstance,
    handleNonStreamingResponse,
    handleStreamingResponse,
    prepareSessionMessage, saveSessionsDebounced,
    selectAssistant, withSessionLock
} from "./ai_chat_core";
import {getModelCapabilities} from "./model_capabilities";

export function registerAiChatHandlers() {
    ipcMain.handle(AiChatChannels.SESSIONS_GET, async () => {
        return settings.get('ai.sessions', []) || [];
    })

    ipcMain.handle(AiChatChannels.SESSION_CREATE, async (_, name) => {
        const sessions = (settings.get('ai.sessions', []) || []).slice();
        const now = new Date().toISOString();
        const session = {
            id: crypto.randomUUID(),
            name: name || 'New Chat',
            createdAt: now,
            updatedAt: now,
            messages: []
        };
        sessions.unshift(session);
        settings.set('ai.sessions', sessions);
        return session;
    })

    ipcMain.handle(AiChatChannels.SEND_MESSAGE, async (event, { sessionId, content, think, stream, provider, model, temperature }) => {
        return await withSessionLock(sessionId, async () => {
            const { session, sessions, idx } = prepareSessionMessage(sessionId, content);
            const assistantInfo = selectAssistant(provider, model);
            const { llm, streaming, maxTokens } = await createLlmInstance(assistantInfo, content, think, stream, temperature);

            const caps = await getModelCapabilities(assistantInfo.model, assistantInfo);
            const useThink = !!think && caps.reasoning;

            const activeStats = session.stats?.models?.[model];
            const threshold = 0.85; // 85%

            if (activeStats && activeStats.estimatedUsed / activeStats.maxTokens > threshold) {
                await compressSessionMessages(session, event, llm, maxTokens, assistantInfo, sessions, idx);
            }

            try {
                if (streaming) {
                    const result = await handleStreamingResponse(llm, event, { session, sessions, idx, sessionId }, content, useThink, maxTokens);
                    if (result) return result;
                }
                return await handleNonStreamingResponse(llm, event, { session, sessions, idx }, content, useThink, maxTokens);
            } catch (e) {
                const errorText = `Error: ${e?.message || "Failed to get response from AI"}`;
                event.sender.send(AiChatChannels.on_off.STREAM_ERROR, { sessionId, error: errorText });
                const assistantMsg = { id: crypto.randomUUID(), role: "assistant", content: errorText, createdAt: new Date().toISOString() };
                session.messages.push(assistantMsg);
                session.updatedAt = new Date().toISOString();
                sessions[idx] = session;
                saveSessionsDebounced(sessions, true);
                return session;
            }
        })
    })

    ipcMain.handle(AiChatChannels.GET_CAPABILITIES, async (_, model, provider) => {
        const assistantInfo = selectAssistant(provider, model);
        return await getModelCapabilities(assistantInfo.model, assistantInfo);
    })
}