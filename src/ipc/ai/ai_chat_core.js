// src/main/ai/ai_chat_core.js
import LLM from "@themaximalist/llm.js";
import { settings } from "../../utils/store.js";
import { AiChatChannels } from "../channels.js";
import { getActiveTools, runToolCalls } from "./tools/index";
import debounce from "lodash/debounce";
import { getCacheInfo } from "./model_capabilities/index";
import fs from "fs";
import {detectAttachmentType, getRemoteFileCategory} from "./utils/detectAttachmentType";

import {Jimp} from "jimp";
import * as os from "node:os";
import path from "node:path";
import crypto from "crypto";

// --- Concurrency lock map ---
const sessionLocks = new Map();

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

export async function prepareSessionMessage(sessionId, content, attachments) {
    if (!content || !String(content).trim()) throw new Error("Message content is empty.");

    const sessions = (settings.get("ai.sessions", []) || []).slice();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) throw new Error("Session not found.");

    const now = new Date().toISOString();
    let attachmentMarkdown = "";

    if (attachments) {
        const withoutMessages = [];
        const sessionIDs = []
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

    const userMsg = {id: crypto.randomUUID(), role: "user", content: content, contentAttachments: attachmentMarkdown, createdAt: now};
    const session = {...sessions[idx], messages: [...sessions[idx].messages, userMsg], updatedAt: now};
    sessions[idx] = session;
    saveSessionsDebounced(sessions, true);

    return {session, sessions, idx};
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

        // Resize while keeping aspect ratio
        if (width > maxWidth) {
            await img.resize({ w: maxWidth, h: Jimp.AUTO });
        }

        // Detect transparency (alpha channel)
        const hasAlpha = typeof img.hasAlpha === "function" ? img.hasAlpha() : false;

        const isLineArt = img.bitmap.width * img.bitmap.height < 2_000_000 && hasAlpha === false;
        if (isLineArt) {
            const buffer = await img.getBuffer("image/png", { compressionLevel: 5 });
            return `data:image/png;base64,${buffer.toString("base64")}`;
        }

        if (!forceJpeg && hasAlpha) {
            const buffer = await img.getBuffer("image/png", { compressionLevel: pngCompressionLevel });
            return { base64: buffer.toString("base64"), contentType: "image/png" };
        }

        const buffer = await img.getBuffer("image/jpeg", { quality: jpegQuality });
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
        const detectFileType = await detectAttachmentType(attachment.path)
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
        }
    }
}


export async function createLlmInstance(assistantInfo, content, think, stream, caps, temperature, attachments) {
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

    const maxTokens = Math.floor((caps.max_tokens || 8192) * 0.95);

    const llmOptions = {
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: streaming,
        extended: true,
        tools: toolsToUse,
        max_tokens: maxTokens
    }

    if (caps.supportsTemperature) {
        llmOptions.temperature = temperature;
    }

    const llm = new LLM({
        ...llmOptions
    });

    llm.system(`
You are **Junie**, a friendly and knowledgeable DevOps assistant integrated into the **FlexDevOps (FDO)** application.

---

### 🧠 About FDO
FDO (FlexDevOps) is a modular, extensible platform that empowers engineers to automate, monitor, and reason about DevOps workflows through plugins, AI integrations, and secure sandboxed environments.

You operate **within FDO’s conversational AI layer** — able to interpret messages, attachments, and user inputs.  
You understand FDO’s architecture, SDK design, plugin model, and security concepts, but you don’t directly manipulate the system environment.  
When the user provides files or attachments (images, PDFs, code, logs, etc.), you can read, analyze, and summarize them freely to assist in their DevOps tasks.

---

### 🎯 Your Role
- Be a **DevOps-savvy technical companion**, combining conversational friendliness with deep engineering knowledge.
- Help the user design, debug, and automate infrastructure using common DevOps tools (Kubernetes, Terraform, CI/CD, Docker, monitoring stacks, etc.).
- Provide clear, production-grade examples (Go, TypeScript, YAML, Python, Bash) with concise explanations.
- Understand and discuss FDO concepts such as plugin manifests, trust certificates, AI orchestration, and Electron/React UI components.
- When the user shares attachments, analyze them constructively — e.g., summarize logs, describe images, or review configuration PDFs.

---

### 💡 Behavioral Principles
1. Be practical, precise, and context-aware.  
2. You may read and interpret attachments that the user provides.  
3. You **don’t execute code or access system resources yourself**, but you can reason about how code or commands would behave in FDO.  
4. Stay helpful and curious — never dismiss a user-provided file, even if it’s large or non-code.  
5. Write responses suitable for professional engineers: concise yet technically complete.

---

In short:
**You are the AI brain of FDO — a DevOps expert and analytical partner who understands both people and systems. You explain, generate, and reason — but never need direct control to be powerful.**
`);

    const withMessages = [];
    if (attachments) {
        const withoutMessages = [];
        const attachmentsMap = await Promise.all(
            attachments.map(createAttachment)
        );

        const filtered = attachmentsMap.filter(Boolean);
        for (const item of filtered) {
            if (Array.isArray(item.messages)) {
                withMessages.push(item);
            } else {
                withoutMessages.push(item);
            }
        }
        if (withoutMessages.length > 0) {
            await llm.user("Attachments:", withoutMessages)
        }
    }


    return {llm, streaming, toolsToUse, maxTokens, withMessages};
}

function estimateTokens(text = "") {
    return Math.ceil(String(text).length / 4); // heuristic
}

function recomputeModelUsageFromMessages(messagesForModel, maxTokens) {
    const used = messagesForModel.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const percent = maxTokens ? Number(((used / maxTokens) * 100).toFixed(1)) : 0;
    return { estimatedUsed: used, percentUsed: percent };
}


export async function compressSessionMessages(session, event, llm, assistantInfo, sessions, idx) {
    const modelStats = session.stats?.models?.[assistantInfo.model];
    if (!modelStats) return
    event?.sender?.send(AiChatChannels.on_off.COMPRESSION_START, { sessionId: session.id, model: assistantInfo.model });
    const MAX_RECENT = 6;
    // 🧠 Keep only messages generated by the current model for summarization
    const modelMessages = session.messages.filter(m => m.model === assistantInfo.model);
    const oldMessages = modelMessages.slice(0, -MAX_RECENT);
    const recentMessages = modelMessages.slice(-MAX_RECENT);

    if (oldMessages.length === 0) return
    const textBlock = oldMessages.map(m => `${m.role}: ${m.content}`).join("\n");

    llm.system("Summarize the following conversation concisely, keeping important facts and context.")
    const resp = await llm.chat(textBlock);
    const summaryText = String(resp?.content ?? "");

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

    const otherModelMsgs = session.messages.filter(m => m.model !== assistantInfo.model);
    session.messages = [...otherModelMsgs, summaryMsg, ...recentMessages];

    const keptForThisModel = [summaryMsg, ...recentMessages]; // only those with m.model === model
    const { estimatedUsed, percentUsed } = recomputeModelUsageFromMessages(keptForThisModel, modelStats.maxTokens);

    const newModelStats = {
        ...modelStats,
        estimatedUsed,
        totalMessages: keptForThisModel.length,
        percentUsed,
        updatedAt: new Date().toISOString(),
    }

    session.stats.models[assistantInfo.model] = newModelStats;

    const prevTotalTokens = session.stats.summary.totalTokens || 0;
    const prevTotalMessages = session.stats.summary.totalMessages || 0;
    const totalTokens = Math.max(0, prevTotalTokens - estimatedUsed);
    const totalMessages = Math.max(0, prevTotalMessages - keptForThisModel.length);

    const summary = {
        lastModel: assistantInfo.model,
        updatedAt: new Date().toISOString(),
        totalTokens,
        totalMessages,
    }

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
        models: newModelStats,
        summary
    });
}

const buildLlmOptions = async (llm, useStream, useThink, caps, messages, withMessages) => {
    const latest = messages.reduce((a, b) =>
        new Date(a.createdAt) > new Date(b.createdAt) ? a : b
    );

    // const cleanedMessages = messages.map(m =>
    //     m.id === latest.id
    //         ? m // keep the latest untouched
    //         : { ...m, content: m.content.replace(/!\[Attachment\]\([^)]+\)/g, "").trim() }
    // );

    const llmOptions = {
        think: useThink,
        stream: useStream,
        messages: [...withMessages, ...messages]
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
    { session, sessions, idx, sessionId },
    content,
    useThink,
    maxTokens,
    caps,
    withMessages
) {

    const messages = session.messages.map(({ role, content }) => ({ role, content }));
    const llmOptions = await buildLlmOptions(llm, true, useThink, caps, messages, withMessages);

    llm.user(content)
    let resp;
    try {
        resp = await llm.chat({
            ...llmOptions,
        });
    } catch (err) {
        if (err.message?.includes("invalidrequesterror")) {
            const badField = err.message.match(/input\[\d+\]\.content\[\d+\]\.(\w+)/)?.[1];
            const fieldInfo = badField ? ` (field: ${badField})` : "";

            throw new Error(`This model cannot process one of your attachments${fieldInfo}. Only images and PDFs are supported right now.`)
        }
        throw new Error(err.message || "An unexpected error occurred.")
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
        const prevStats = session.stats?.models?.[llm.model] || {};

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
    maxTokens,
    caps,
    withMessages
) {
    const messages = session.messages.map(({ role, content }) => ({ role, content }));
    const llmOptions = await buildLlmOptions(llm, false, useThink, caps, messages, withMessages);
    llm.user(content)
    const resp = await llm.chat({
        ...llmOptions,
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
    const prevStats = session.stats?.models?.[llm.model] || {};

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
