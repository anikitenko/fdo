// src/main/ai/model_capabilities/index.js
import fs from "fs/promises";
import path from "path";
import { app } from "electron";
import { STATIC_MODEL_CAPABILITIES } from "./static_map.js";
import { fetchOpenAICapabilities } from "./fetchers/openai_fetcher.js";
import { fetchAnthropicCapabilities } from "./fetchers/anthropic_fetcher.js";
import {inspectGeminiModel} from "../../../utils/ai/providers/geminiProvider.cjs";

// Electron may apply a custom userData directory after imports have loaded.
// Resolve the profile path on first use, once startup configuration is in place.
let cacheFile;
const getCacheFile = () => cacheFile || (cacheFile = path.join(app.getPath("userData"), "ai_model_cache.json"));
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24h
let cache = {};
let lastUpdated = 0;
let cacheRead;
let cacheWrite = Promise.resolve();
// selectAssistant creates a fresh object for each IPC request, so object
// identity cannot coalesce concurrent lookups. Keep the API key only as an
// in-memory key for the lifetime of an in-flight refresh; never derive or
// persist a credential fingerprint.
const refreshes = new Map();

function summarizeAssistantForLogs(assistantInfo) {
    if (!assistantInfo) return null;

    return {
        id: assistantInfo.id,
        name: assistantInfo.name,
        provider: assistantInfo.provider,
        model: assistantInfo.model,
        purpose: assistantInfo.purpose,
        hasApiKey: Boolean(assistantInfo.apiKey),
    };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
export async function getModelCapabilities(modelName, assistantInfo) {
    if (!modelName) return {};

    await readCache();
    const now = Date.now();
    const stale = now - lastUpdated > MAX_CACHE_AGE_MS;
    const canRefresh = assistantInfo?.apiKey && ["openai", "gemini", "anthropic"].includes(assistantInfo.provider);
    if (canRefresh && (stale || (["gemini", "anthropic"].includes(assistantInfo.provider) && !cache[modelName]))) {
        let byModel = refreshes.get(assistantInfo.apiKey);
        if (!byModel) {
            byModel = new Map();
            refreshes.set(assistantInfo.apiKey, byModel);
        }
        const refreshKey = `${assistantInfo.provider}\0${assistantInfo.model || modelName}`;
        let refresh = byModel.get(refreshKey);
        if (!refresh) {
            console.log("[capabilities] Cache stale — refreshing…");
            refresh = refreshCapabilities(assistantInfo).finally(() => {
                byModel.delete(refreshKey);
                if (!byModel.size) refreshes.delete(assistantInfo.apiKey);
            });
            byModel.set(refreshKey, refresh);
        }
        await refresh;
    }

    const merged = { ...STATIC_MODEL_CAPABILITIES, ...cache };
    const key = Object.keys(merged).filter(k => (!assistantInfo?.provider || merged[k].provider === assistantInfo.provider)
        && (modelName.toLowerCase() === k.toLowerCase() || modelName.toLowerCase().startsWith(`${k.toLowerCase()}-`)))
        .sort((a, b) => b.length - a.length)[0];
    return (
        merged[key] || {
            provider: "unknown",
            reasoning: false,
            streaming: false,
            tools: false,
            maxTokens: 8192,
        }
    );
}

export function getCacheInfo() {
    return {
        filePath: getCacheFile(),
        updatedAt: lastUpdated,
        stale: Date.now() - lastUpdated > MAX_CACHE_AGE_MS,
    };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------
function readCache() {
    // This main-process module owns the file. Hydrate once, sharing the initial
    // read with concurrent callers; subsequent freshness checks use memory.
    if (!cacheRead) cacheRead = (async () => {
        try {
            const parsed = JSON.parse(await fs.readFile(getCacheFile(), "utf8"));
            cache = parsed.data || {};
            lastUpdated = parsed.updatedAt || 0;
        } catch {
            cache = {};
            lastUpdated = 0;
        }
    })();
    return cacheRead;
}

async function refreshCapabilities(assistantInfo) {
    const updates = {};

    try {
        if (assistantInfo?.provider === "openai" && assistantInfo.apiKey) {
            console.log("[capabilities] Refreshing OpenAI capabilities for assistant", summarizeAssistantForLogs(assistantInfo));
            const models = await fetchOpenAICapabilities(assistantInfo.apiKey);
            for (const m of models) updates[m.id] = m;
        }
        if (assistantInfo?.provider === "gemini" && assistantInfo.apiKey) {
            const model = await inspectGeminiModel(assistantInfo);
            updates[assistantInfo.model] = {id: assistantInfo.model, provider: "gemini", api: "interactions", streaming: true, tools: true,
                supportsThinking: true, supportsTemperature: false, maxTokens: model.inputTokenLimit || 32768,
                maxOutputTokens: model.outputTokenLimit || 8192};
        }
        if (assistantInfo?.provider === "anthropic" && assistantInfo.apiKey) {
            console.log("[capabilities] Refreshing Anthropic capabilities for assistant", summarizeAssistantForLogs(assistantInfo));
            const models = await fetchAnthropicCapabilities(assistantInfo.apiKey);
            for (const m of models) updates[m.id] = m;
        }
    } catch (err) {
        console.warn("[capabilities] Live fetch failed:", {
            error: err.message,
            assistant: summarizeAssistantForLogs(assistantInfo),
        });
    }

    // Merge after the network wait so another provider's completed refresh
    // cannot be overwritten by a snapshot taken before this one started.
    cache = { ...STATIC_MODEL_CAPABILITIES, ...cache, ...updates };
    lastUpdated = Date.now();

    try {
        // Serialize writes and capture the latest state when each write starts.
        // A failed disk write must not prevent later refreshes from persisting.
        cacheWrite = cacheWrite.catch(() => {}).then(() => fs.writeFile(
            getCacheFile(),
            JSON.stringify({ updatedAt: lastUpdated, data: cache }, null, 2)
        ));
        await cacheWrite;
    } catch (err) {
        console.warn("[capabilities] Failed to write cache:", err.message);
    }

    console.log(`[capabilities] Cache updated (${Object.keys(cache).length} models)`);
}
