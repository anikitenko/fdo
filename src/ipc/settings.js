import {ipcMain, utilityProcess} from "electron";
import {SettingsChannels} from "./channels";
import {settings} from "../utils/store";
import {Certs} from "../utils/certs";
import LLM from "@themaximalist/llm.js"
import { fetchOpenAICapabilities } from "./ai/model_capabilities/fetchers/openai_fetcher";
import { readCodexAuthStatus, resolveCodexCliInvocation, runCodexLogout, verifyCodexModelAccess } from "../utils/codexCli.js";
import path from "node:path";

const STATIC_ANTHROPIC_MODELS = [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
];

async function fetchCodexCliModels() {
    const response = await fetch("https://developers.openai.com/api/docs/models/all", {
        headers: {
            "User-Agent": "FDO/1.0 Codex Model Loader",
            "Accept": "text/html,application/xhtml+xml",
        },
    });
    if (!response.ok) {
        throw new Error(`OpenAI model catalog request failed with status ${response.status}.`);
    }

    const html = await response.text();
    const matches = html.match(/\b(?:gpt-[\w.-]*codex(?:-max|-mini)?|gpt-5(?:\.\d+)?(?:-pro|-mini|-nano)?|codex-mini-latest)\b/gi) || [];
    const unique = Array.from(new Set(matches.map((model) => model.trim().toLowerCase())));
    const models = unique
        .filter((model) => model.startsWith("gpt-5") || /codex/i.test(model))
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }));

    if (models.length === 0) {
        throw new Error("No coding-capable OpenAI models were found in the official catalog.");
    }

    const recommendedModel =
        models.find((modelId) => modelId === "gpt-5-codex") ||
        models.find((modelId) => modelId === "gpt-5.4") ||
        models[0];

    return models.map((modelId) => ({
        label: modelId === recommendedModel ? `${modelId} (Recommended)` : modelId,
        value: modelId,
        provider: "codex-cli",
    }));
}

const activeCodexAuthProcesses = new Map();
const CODEX_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function updateCodexAssistantState(assistantId, patch = {}) {
    const list = settings.get("ai.coding", []) || [];
    const index = list.findIndex((item) => item.id === assistantId);
    if (index === -1) return null;
    list[index] = {
        ...list[index],
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    settings.set("ai.coding", list);
    return list[index];
}

function getCodexAuthWorkerPath() {
    return path.join(__dirname, "workers", "codexAuthWorker.js");
}

function stopCodexAuthProcess(assistantId, { status = "cancelled", message = "Codex authentication was cancelled." } = {}) {
    const active = activeCodexAuthProcesses.get(assistantId);
    if (!active) {
        updateCodexAssistantState(assistantId, {
            codexAuth: {
                status,
                message,
                checkedAt: new Date().toISOString(),
            },
        });
        return false;
    }

    if (active.timeoutId) {
        clearTimeout(active.timeoutId);
    }
    activeCodexAuthProcesses.delete(assistantId);
    try {
        active.child?.kill?.();
    } catch {
        // ignore
    }
    updateCodexAssistantState(assistantId, {
        codexAuth: {
            status,
            message,
            checkedAt: new Date().toISOString(),
        },
    });
    return true;
}

export function interruptAllCodexAuthProcesses(reason = "Codex authentication was interrupted because FDO is shutting down.") {
    const assistantIds = Array.from(activeCodexAuthProcesses.keys());
    for (const assistantId of assistantIds) {
        stopCodexAuthProcess(assistantId, {
            status: "interrupted",
            message: reason,
        });
    }
}

function launchCodexLoginUtilityProcess(assistant, invocation) {
    if (activeCodexAuthProcesses.has(assistant.id)) {
        return { started: true, mode: "utilityProcess", alreadyRunning: true };
    }

    const child = utilityProcess.fork(getCodexAuthWorkerPath(), [
        invocation.command,
        "login",
        JSON.stringify(invocation.args || []),
        JSON.stringify(invocation.env || {}),
    ], {
        serviceName: `codex-auth-${assistant.id}`,
        env: {
            ...process.env,
            ...(invocation.env || {}),
        },
    });
    const timeoutId = setTimeout(() => {
        stopCodexAuthProcess(assistant.id, {
            status: "timeout",
            message: "Codex authentication timed out. You can retry Sign in when ready.",
        });
    }, CODEX_AUTH_TIMEOUT_MS);
    activeCodexAuthProcesses.set(assistant.id, { child, timeoutId });

    child.on("message", async (message) => {
        if (!message) return;
        if (message.type === "exit") {
            const active = activeCodexAuthProcesses.get(assistant.id);
            if (active?.timeoutId) clearTimeout(active.timeoutId);
            activeCodexAuthProcesses.delete(assistant.id);
            const authStatus = await readCodexAuthStatus(invocation);
            updateCodexAssistantState(assistant.id, {
                codexAuth: {
                    status: authStatus.status,
                    message: authStatus.message || null,
                    checkedAt: new Date().toISOString(),
                },
            });
        }
        if (message.type === "error") {
            updateCodexAssistantState(assistant.id, {
                codexAuth: {
                    status: "error",
                    message: message.error,
                    checkedAt: new Date().toISOString(),
                },
            });
        }
    });

    child.on("exit", async () => {
        const active = activeCodexAuthProcesses.get(assistant.id);
        if (active?.timeoutId) clearTimeout(active.timeoutId);
        activeCodexAuthProcesses.delete(assistant.id);
        const authStatus = await readCodexAuthStatus(invocation);
        updateCodexAssistantState(assistant.id, {
            codexAuth: {
                status: authStatus.status,
                message: authStatus.message || null,
                checkedAt: new Date().toISOString(),
            },
        });
    });

    child.on("error", (error) => {
        const active = activeCodexAuthProcesses.get(assistant.id);
        if (active?.timeoutId) clearTimeout(active.timeoutId);
        activeCodexAuthProcesses.delete(assistant.id);
        updateCodexAssistantState(assistant.id, {
            codexAuth: {
                status: "error",
                message: error.message,
                checkedAt: new Date().toISOString(),
            },
        });
    });

    return { started: true, mode: "utilityProcess", alreadyRunning: false };
}

export function registerSettingsHandlers() {
    ipcMain.handle(SettingsChannels.certificates.GET_ROOT, async () => {
        return settings.get('certificates.root') || [];
    });

    ipcMain.handle(SettingsChannels.certificates.CREATE, async () => {
        const randomName = (Math.random() + 1).toString(36).substring(2)
        Certs.generateRootCA(randomName);
    });

    ipcMain.handle(SettingsChannels.certificates.RENAME, async (event, oldName, newName) => {
        if (newName) {
            Certs.setLabel(oldName, newName);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.EXPORT, async (event, id) => {
        if (id) {
            const data = Certs.export(id);
            return data.cert
        }
    });

    ipcMain.handle(SettingsChannels.certificates.IMPORT, async (event, file) => {
        if (file) {
            return await Certs.import(file);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.DELETE, async (event, id) => {
        if (id) {
            const roots = settings.get('certificates.root') || [];
            const newRoots = roots.filter((root) => root.id !== id);
            settings.set('certificates.root', newRoots);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.RENEW, async (event, label) => {
        Certs.generateRootCA(label, true);
    });

    ipcMain.handle(SettingsChannels.ai_assistants.GET, async () => {
        const chat   = settings.get('ai.chat',   []) || [];
        const coding = settings.get('ai.coding', []) || [];

        // If you need types, *don't* write back to settings here
        return [
            ...chat.map(a => ({...a, purpose: 'chat'})),
            ...coding.map(a => ({...a, purpose: 'coding'})),
        ].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    });

    ipcMain.handle(SettingsChannels.ai_assistants.GET_AVAILABLE_MODELS, async (_, provider, apiKey) => {
        if (provider === "anthropic") {
            return STATIC_ANTHROPIC_MODELS
                .map((modelId) => ({
                    label: modelId,
                    value: modelId,
                    provider: "anthropic",
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
        }

        if (provider === "codex-cli") {
            return await fetchCodexCliModels();
        }

        if (!apiKey || !String(apiKey).trim()) {
            return [];
        }

        let models = [];
        const trimmedApiKey = String(apiKey).trim();

        if (provider === "openai") {
            models = await fetchOpenAICapabilities(trimmedApiKey);
        } else {
            return [];
        }

        return models
            .map((model) => ({
                label: model.id,
                value: model.id,
                provider,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    });

    ipcMain.handle(SettingsChannels.ai_assistants.ADD, async (_, data) => {
        const normalizedThinkingMode = ["auto", "on", "off"].includes(String(data?.defaultThinkingMode || "").toLowerCase())
            ? String(data.defaultThinkingMode).toLowerCase()
            : "auto";
        data.defaultThinkingMode = normalizedThinkingMode;
        let resolvedInvocation = null;
        if (data.provider === "codex-cli") {
            if (data.purpose !== "coding") {
                throw new Error("Codex CLI is supported only for Coding Assistant purpose.");
            }
            try {
                const invocation = await resolveCodexCliInvocation({
                    configuredPath: data.executablePath,
                    preferBundled: true,
                });
                resolvedInvocation = invocation;
                data.executablePath = invocation.entrypoint || invocation.command;
                data.codexRuntime = {
                    source: invocation.source,
                    version: invocation.version || "",
                    bundled: !!invocation.bundled,
                };
                const authStatus = await readCodexAuthStatus(invocation);
                data.codexAuth = {
                    status: authStatus.status,
                    message: authStatus.message || null,
                    checkedAt: new Date().toISOString(),
                };
                if (authStatus.status === "authorized") {
                    const modelVerification = await verifyCodexModelAccess(invocation, data.model);
                    if (!modelVerification.ok) {
                        throw new Error(modelVerification.message);
                    }
                }
            } catch (error) {
                throw new Error(`Codex CLI verification failed. ${error?.message || error}`);
            }
            data.apiKey = "";
            data.model = data.model || "gpt-5-codex";
        } else {
            const llm = new LLM({
                service: data.provider,
                apiKey: data.apiKey,
                model: data.model,
            });
            const isConnected = await llm.verifyConnection();
            if (!isConnected) {
                throw new Error(`API Key verification failed for ${data.provider} and model ${data.model}. Please check your API key and model.`);
            }
        }
        // Upsert assistant WITHOUT touching `default`
// (unless it's a brand-new item, and you want the very first one to be default)
        const key = `ai.${data.purpose}`;
        const now = new Date().toISOString();
        const list = (settings.get(key, []) || []).slice();

        const norm = v => String(v ?? "").trim().toLowerCase();
        const target = norm(data.name);

        const i = list.findIndex(a => norm(a.name) === target);

        const {purpose, ...cleanData} = data;

        if (i >= 0) {
            const previous = list[i];
            if (previous?.provider === "codex-cli" && data.provider === "codex-cli") {
                const executableChanged = String(previous.executablePath || "") !== String(cleanData.executablePath || "");
                const runtimeChanged = String(previous.codexRuntime?.version || "") !== String(cleanData.codexRuntime?.version || "");
                if (executableChanged || runtimeChanged) {
                    stopCodexAuthProcess(previous.id, {
                        status: "interrupted",
                        message: "Codex authentication was reset because the executable or runtime changed.",
                    });
                }
            }
            list[i] = { ...list[i], ...cleanData, updatedAt: now };
        } else {
            list.push({
                id: crypto.randomUUID(),
                ...cleanData,
                // optional: first ever becomes default
                default: list.length === 0,
                createdAt: now,
                updatedAt: now,
            });
        }

        settings.set(key, list);

        if (data.provider === "codex-cli") {
            const storedAssistant = list.find((item) => norm(item.name) === target);
            if (storedAssistant?.codexAuth?.status !== "authorized") {
                const invocation = resolvedInvocation || await resolveCodexCliInvocation({
                    configuredPath: storedAssistant?.executablePath,
                    preferBundled: true,
                });
                launchCodexLoginUtilityProcess(storedAssistant, invocation);
                updateCodexAssistantState(storedAssistant.id, {
                    codexAuth: {
                        status: "pending",
                        message: "Codex login started automatically. Finish the login flow, then auth state will sync back into FDO.",
                        checkedAt: new Date().toISOString(),
                    },
                });
            }
        }
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_STATUS, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || assistant.provider !== "codex-cli") {
            throw new Error("Codex assistant not found.");
        }
        const invocation = await resolveCodexCliInvocation({
            configuredPath: assistant.executablePath,
            preferBundled: true,
        });
        const authStatus = await readCodexAuthStatus(invocation);
        const updated = {
            status: authStatus.status,
            message: authStatus.message || null,
            checkedAt: new Date().toISOString(),
        };
        const nextList = list.map((item) => item.id === assistant.id ? { ...item, codexAuth: updated } : item);
        settings.set("ai.coding", nextList);
        return updated;
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_LOGIN, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || assistant.provider !== "codex-cli") {
            throw new Error("Codex assistant not found.");
        }
        const invocation = await resolveCodexCliInvocation({
            configuredPath: assistant.executablePath,
            preferBundled: true,
        });
        const result = launchCodexLoginUtilityProcess(assistant, invocation);
        const updated = {
            status: "pending",
            message: "Codex login was started in a background utility process. Finish the login flow, then auth state will sync back into FDO.",
            checkedAt: new Date().toISOString(),
        };
        const nextList = list.map((item) => item.id === assistant.id ? { ...item, codexAuth: updated } : item);
        settings.set("ai.coding", nextList);
        return { ...result, auth: updated };
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_LOGOUT, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || assistant.provider !== "codex-cli") {
            throw new Error("Codex assistant not found.");
        }
        stopCodexAuthProcess(assistant.id, {
            status: "cancelled",
            message: "Codex authentication was cancelled before sign out.",
        });
        const invocation = await resolveCodexCliInvocation({
            configuredPath: assistant.executablePath,
            preferBundled: true,
        });
        const authStatus = await runCodexLogout(invocation);
        const updated = {
            status: authStatus.status,
            message: authStatus.message || null,
            checkedAt: new Date().toISOString(),
        };
        const nextList = list.map((item) => item.id === assistant.id ? { ...item, codexAuth: updated } : item);
        settings.set("ai.coding", nextList);
        return updated;
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_CANCEL, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || assistant.provider !== "codex-cli") {
            throw new Error("Codex assistant not found.");
        }
        stopCodexAuthProcess(assistant.id, {
            status: "cancelled",
            message: "Codex authentication was cancelled.",
        });
        return {
            status: "cancelled",
            message: "Codex authentication was cancelled.",
            checkedAt: new Date().toISOString(),
        };
    });

    ipcMain.handle(SettingsChannels.ai_assistants.SET_DEFAULT, async (_, data) => {
        // Make exactly one assistant default by name (case-insensitive)
        const key = `ai.${data.purpose}`;
        const list = (settings.get(key, []) || []).map(a => ({
            ...a,
            default: false,
        }));

        const norm = v => String(v ?? "").trim().toLowerCase();
        const idx = list.findIndex(a => norm(a.name) === norm(data.name));
        if (idx >= 0) {
            list[idx] = { ...list[idx], default: true, updatedAt: new Date().toISOString() };
        }
        settings.set(key, list);
    });

    ipcMain.handle(SettingsChannels.ai_assistants.REMOVE, async (_, data) => {
        const key = `ai.${data.purpose}`;
        const raw = settings.get(key, []) || [];

        if (!['chat', 'coding'].includes(data.purpose)) {
            throw new Error(`[REMOVE] invalid purpose "${data.purpose}"`);
        }
        console.log('[REMOVE] key', key, 'payload', { purpose: data.purpose, id: data.id, name: data.name });

        // --- helpers ---
        const norm = v => String(v ?? '').trim().toLowerCase();
        const sameId = (a, id) => id && a.id === id;
        const sameName = (a, name) => name && norm(a.name) === norm(name);
        const toMillis = v => {
            const t = new Date(v || 0).getTime();
            return Number.isFinite(t) ? t : 0;
        };
        const coerceDefault = v => v === true || v === 'true'; // booleanize

        // Normalize booleans (in case something stored strings)
        const list = raw.map(a => ({ ...a, default: coerceDefault(a.default) }));

        // --- locate item to remove ---
        const idx = list.findIndex(a => sameId(a, data.id) || sameName(a, data.name));
        if (idx === -1) {
            return list;
        }

        const [removed] = list.splice(idx, 1);

        if (data.purpose === "coding" && removed?.provider === "codex-cli") {
            stopCodexAuthProcess(removed.id, {
                status: "cancelled",
                message: "Codex authentication was cancelled because the assistant was removed.",
            });
        }

        // If nothing left, just save empty
        if (list.length === 0) {
            settings.set(key, []);
            return [];
        }

        // Do we still have a default after removal?
        let hasDefaultLeft = list.some(a => a.default);

        // If we removed a default OR no default exists, choose the most-recent one
        if (coerceDefault(removed?.default) || !hasDefaultLeft) {
            // pick most-recent by updatedAt (fallback createdAt)
            let bestIdx = 0;
            let bestT = toMillis(list[0].updatedAt || list[0].createdAt);

            for (let i = 1; i < list.length; i++) {
                const t = toMillis(list[i].updatedAt || list[i].createdAt);
                if (t > bestT) {
                    bestT = t;
                    bestIdx = i;
                }
            }

            // Flip defaults so exactly one is true
            const now = new Date().toISOString();
            for (let i = 0; i < list.length; i++) {
                list[i] = {
                    ...list[i],
                    default: i === bestIdx,
                    // bump recency for the chosen default so ordering is consistent
                    updatedAt: i === bestIdx ? now : list[i].updatedAt,
                };
            }
        }

        // Final guard: ensure exactly one default (in case upstream data was weird)
        if (!list.some(a => a.default)) {
            // choose most-recent defensively
            let bestIdx = 0;
            let bestT = toMillis(list[0].updatedAt || list[0].createdAt);
            for (let i = 1; i < list.length; i++) {
                const t = toMillis(list[i].updatedAt || list[i].createdAt);
                if (t > bestT) { bestT = t; bestIdx = i; }
            }
            list[bestIdx] = { ...list[bestIdx], default: true, updatedAt: new Date().toISOString() };
        } else {
            // normalize: if multiple defaults slipped in somehow, keep the most-recent one
            const defaultIdxs = list
                .map((a, i) => ({ i, t: toMillis(a.updatedAt || a.createdAt), d: a.default }))
                .filter(x => x.d)
                .sort((x, y) => y.t - x.t) // most recent first
                .map(x => x.i);

            if (defaultIdxs.length > 1) {
                for (let k = 1; k < defaultIdxs.length; k++) {
                    const i = defaultIdxs[k];
                    list[i] = { ...list[i], default: false };
                }
            }
        }

        settings.set(key, list);
    });
}
