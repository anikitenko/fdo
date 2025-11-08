// src/main/ai/model_capabilities/index.js
import fs from "fs/promises";
import path from "path";
import { app } from "electron";
import { STATIC_MODEL_CAPABILITIES } from "./static_map.js";
import { fetchOpenAICapabilities } from "./fetchers/openai_fetcher.js";
import { fetchAnthropicCapabilities } from "./fetchers/anthropic_fetcher.js";

const CACHE_FILE = path.join(app.getPath("userData"), "ai_model_cache.json");
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24h

let cache = {};
let lastUpdated = 0;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
export async function getModelCapabilities(modelName, assistantInfo) {
    if (!modelName) return {};

    await readCache();
    const now = Date.now();
    const stale = now - lastUpdated > MAX_CACHE_AGE_MS;
    if (stale) {
        console.log("[capabilities] Cache stale — refreshing…");
        await refreshCapabilities(assistantInfo);
    }

    const merged = { ...STATIC_MODEL_CAPABILITIES, ...cache };
    const key = Object.keys(merged).find(k =>
        modelName.toLowerCase().includes(k.toLowerCase())
    );
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
        filePath: CACHE_FILE,
        updatedAt: lastUpdated,
        stale: Date.now() - lastUpdated > MAX_CACHE_AGE_MS,
    };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------
async function readCache() {
    try {
        const raw = await fs.readFile(CACHE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        cache = parsed.data || {};
        lastUpdated = parsed.updatedAt || 0;
    } catch {
        cache = {};
        lastUpdated = 0;
    }
}

async function refreshCapabilities(assistantInfo) {
    const all = { ...STATIC_MODEL_CAPABILITIES };

    try {
        if (assistantInfo?.provider === "openai" && assistantInfo.apiKey) {
            const models = await fetchOpenAICapabilities(assistantInfo.apiKey);
            for (const m of models) all[m.id] = m;
        }
        if (assistantInfo?.provider === "anthropic" && assistantInfo.apiKey) {
            const models = await fetchAnthropicCapabilities(assistantInfo.apiKey);
            for (const m of models) all[m.id] = m;
        }
    } catch (err) {
        console.warn("[capabilities] Live fetch failed:", err.message);
    }

    cache = all;
    lastUpdated = Date.now();

    try {
        await fs.writeFile(
            CACHE_FILE,
            JSON.stringify({ updatedAt: lastUpdated, data: cache }, null, 2)
        );
    } catch (err) {
        console.warn("[capabilities] Failed to write cache:", err.message);
    }

    console.log(`[capabilities] Cache updated (${Object.keys(cache).length} models)`);
}
