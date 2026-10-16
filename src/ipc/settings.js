import {listGeminiModels} from "../utils/ai/providers/geminiProvider.cjs";
import {listAnthropicModels} from "../utils/ai/providers/catalog";
import {codingFirstResponseTimeoutMs} from "../utils/ai/generation/codingRequestPolicy.cjs";
import {listCloudflareModels, inspectCloudflareModel, cloudflareAccountId} from "../utils/ai/providers/cloudflareProvider.cjs";
import {listOllamaModels, inspectOllamaModel, ollamaLlmOptions} from "../utils/ai/providers/ollamaProvider.cjs";
import {listCursorModels, inspectCursorModel} from "../utils/ai/providers/cursorProvider";
import {listOpenCodeModels, inspectOpenCodeModel} from "../utils/ai/providers/opencodeProvider.cjs";
import {listOpenRouterModels, inspectOpenRouterModel} from "../utils/ai/providers/openRouterProvider.cjs";
import {reserveLiveAiTestRequest} from "../utils/ai/testing/liveAiTestBudget";
import {listCodexModels} from "../utils/ai/codex/codexModels";
import {discoverAssistantInputCapabilities} from './assistantInputCapabilities';
import {assistantInputCapabilities} from '../utils/ai/assistant/aiAssistantInputCapabilities';
import {refreshCodexRuntime} from "../utils/ai/codex/refreshCodexRuntime";
import {ipcMain, utilityProcess, BrowserWindow, dialog, shell} from "electron";
import {registerAiExtensionsHandlers} from './aiExtensions';
import {SettingsChannels} from "./channels";
import {settings} from "../utils/persistence/store";
import {Certs} from "../utils/system/certs";
import LLM from "../utils/ai/providers/aiProviderClient"
import { fetchOpenAICapabilities } from "./ai/model_capabilities/fetchers/openai_fetcher";
import { readCodexAuthStatus, resolveCodexCliInvocation, runCodexLogout } from "../utils/ai/codex/codexCli.js";
import {
    fetchGeminiCliModels,
    readGeminiAuthStatus,
    resolveGeminiCliInvocation,
    runGeminiLogout,
    startGeminiLogin,
    clearGeminiAuthProbeCache
} from "../utils/ai/generation/geminiCli.js";
import path from "node:path";
import {normalizeAiProviderInstructionMap} from "../utils/ai/assistant/aiProviderInstructions";

const activeCodexAuthProcesses = new Map();
const activeGeminiAuthProcesses = new Map();
const CODEX_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const GEMINI_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function broadcastAIAssistantsUpdate() {
    const chat = settings.get('ai.chat', []) || [];
    const coding = settings.get('ai.coding', []) || [];
    const fullList = [
        ...chat.map(a => ({ ...a, purpose: 'chat' })),
        ...coding.map(a => ({ ...a, purpose: 'coding' })),
    ].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    // Notify all windows that assistants have been updated
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
        if (!win.isDestroyed()) {
            win.webContents.send(SettingsChannels.ai_assistants.on_off.UPDATED, fullList);
        }
    }
}

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
    broadcastAIAssistantsUpdate();
    return list[index];
}

function getCodexAuthWorkerPath() {
    return path.join(__dirname, "workers", "codexAuthWorker.js");
}

function getGeminiAuthWorkerPath() {
    return path.join(__dirname, "workers", "geminiAuthWorker.js");
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

function stopGeminiAuthProcess(assistantId, { status = "cancelled", message = "Gemini authentication was cancelled." } = {}) {
    const active = activeGeminiAuthProcesses.get(assistantId);
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
    activeGeminiAuthProcesses.delete(assistantId);
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

export function interruptAllCodexAuthProcesses(reason = "Authentication was interrupted because FDO is shutting down.") {
    const codexAssistantIds = Array.from(activeCodexAuthProcesses.keys());
    for (const assistantId of codexAssistantIds) {
        stopCodexAuthProcess(assistantId, {
            status: "interrupted",
            message: reason,
        });
    }
    const geminiAssistantIds = Array.from(activeGeminiAuthProcesses.keys());
    for (const assistantId of geminiAssistantIds) {
        stopGeminiAuthProcess(assistantId, {
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

function launchGeminiLoginUtilityProcess(assistant, invocation) {
    if (activeGeminiAuthProcesses.has(assistant.id)) {
        return { started: true, mode: "utilityProcess", alreadyRunning: true };
    }

    const child = utilityProcess.fork(getGeminiAuthWorkerPath(), [
        invocation.command,
        JSON.stringify(invocation.args || []),
        JSON.stringify(invocation.env || {}),
    ], {
        serviceName: `gemini-auth-${assistant.id}`,
        env: {
            ...process.env,
            ...(invocation.env || {}),
        },
    });
    
    let isHandled = false;
    const timeoutId = setTimeout(() => {
        if (isHandled) return;
        isHandled = true;
        stopGeminiAuthProcess(assistant.id, {
            status: "timeout",
            message: "Gemini authentication timed out. Complete sign-in in Terminal, then click Check auth.",
        });
    }, GEMINI_AUTH_TIMEOUT_MS);
    
    activeGeminiAuthProcesses.set(assistant.id, { child, timeoutId });

    const finish = async () => {
        if (isHandled) return;
        isHandled = true;
        const active = activeGeminiAuthProcesses.get(assistant.id);
        if (active?.timeoutId) clearTimeout(active.timeoutId);
        activeGeminiAuthProcesses.delete(assistant.id);
        
        clearGeminiAuthProbeCache();
        const authStatus = await readGeminiAuthStatus(invocation);
        updateCodexAssistantState(assistant.id, {
            codexAuth: {
                status: authStatus.status,
                message: authStatus.message || null,
                checkedAt: new Date().toISOString(),
            },
        });
    };

    child.on("message", async (message) => {
        if (!message) return;
        if (message.type === "exit") {
            await finish();
        }
        if (message.type === "error") {
            if (isHandled) return;
            isHandled = true;
            const active = activeGeminiAuthProcesses.get(assistant.id);
            if (active?.timeoutId) clearTimeout(active.timeoutId);
            activeGeminiAuthProcesses.delete(assistant.id);
            
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
        await finish();
    });

    child.on("error", async (error) => {
        if (isHandled) return;
        isHandled = true;
        const active = activeGeminiAuthProcesses.get(assistant.id);
        if (active?.timeoutId) clearTimeout(active.timeoutId);
        activeGeminiAuthProcesses.delete(assistant.id);
        
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

function monitorGeminiTerminalSession(assistant, invocation, loginLaunchResult) {
    const monitorChild = loginLaunchResult?.monitorChild;
    if (!monitorChild || typeof monitorChild.once !== "function") return;

    const syncAfterTerminalClose = async () => {
        if (!activeGeminiAuthProcesses.has(assistant.id)) return;
        clearGeminiAuthProbeCache();
        let authStatus;
        try {
            authStatus = await readGeminiAuthStatus(invocation);
        } catch (error) {
            authStatus = {
                status: "error",
                message: String(error?.message || "Unable to verify Gemini authentication after terminal closed."),
            };
        }

        if (authStatus.status === "authorized") {
            stopGeminiAuthProcess(assistant.id, {
                status: "authorized",
                message: authStatus.message || "Gemini authentication is active.",
            });
            return;
        }

        if (authStatus.status === "error") {
            stopGeminiAuthProcess(assistant.id, {
                status: "error",
                message: authStatus.message || "Unable to verify Gemini authentication after terminal closed.",
            });
            return;
        }

        stopGeminiAuthProcess(assistant.id, {
            status: "unauthorized",
            message: "Gemini sign-in terminal was closed before authentication completed.",
        });
    };

    monitorChild.once("exit", () => {
        syncAfterTerminalClose().catch(() => {});
    });
    monitorChild.once("error", () => {
        syncAfterTerminalClose().catch(() => {});
    });
}

export function registerSettingsHandlers() {
    registerAiExtensionsHandlers({ipcMain, dialog, BrowserWindow, settings, openExternal: url => shell.openExternal(url)});
    ipcMain.handle(SettingsChannels.certificates.GET_ROOT, async () => {
        return settings.get('certificates.root') || [];
    });

    ipcMain.handle(SettingsChannels.certificates.CREATE, async () => {
        const randomName = (Math.random() + 1).toString(36).substring(2)
        await Certs.generateRootCA(randomName);
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
        await Certs.generateRootCA(label, true);
    });

    ipcMain.handle(SettingsChannels.ai_assistants.GET, async () => {
        const chat   = settings.get('ai.chat',   []) || [];
        const coding = settings.get('ai.coding', []) || [];

        const currentCoding = await Promise.all(coding.map(assistant =>
            refreshCodexRuntime(assistant, resolveCodexCliInvocation)
        ));
        return [
            ...chat.map(a => ({...a, purpose: 'chat'})),
            ...currentCoding.map(a => ({...a, purpose: 'coding'})),
        ].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    });

    ipcMain.handle(SettingsChannels.ai_assistants.GET_PROVIDER_INSTRUCTIONS, async () => {
        return normalizeAiProviderInstructionMap(settings.get("ai.providerInstructions", {}));
    });

    ipcMain.handle(SettingsChannels.ai_assistants.SET_PROVIDER_INSTRUCTIONS, async (_, instructions) => {
        const normalized = normalizeAiProviderInstructionMap(instructions);
        settings.set("ai.providerInstructions", normalized);
        return normalized;
    });

    ipcMain.handle(SettingsChannels.ai_assistants.GET_AVAILABLE_MODELS, async (_, provider, apiKey, baseUrl, accountId, executablePath) => {
        if (provider === "cursor") return listCursorModels(apiKey);
        if (provider === "opencode") return listOpenCodeModels(apiKey);
        if (provider === "openrouter") return listOpenRouterModels(apiKey);
        if (provider === "cloudflare") return listCloudflareModels({accountId, apiKey});
        if (provider === "ollama") return listOllamaModels(baseUrl);
        if (provider === "gemini") return listGeminiModels(apiKey);
        if (provider === "anthropic") return listAnthropicModels(apiKey);

        if (provider === "codex-cli") {
            const invocation = await resolveCodexCliInvocation({requireBundled: true,configuredPath: executablePath, preferBundled: true});
            return await listCodexModels(invocation);
        }
        if (provider === "gemini-cli") {
            return await fetchGeminiCliModels();
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

    ipcMain.handle(SettingsChannels.ai_assistants.GET_INPUT_CAPABILITIES, (_event, config) => discoverAssistantInputCapabilities(config));

    ipcMain.handle(SettingsChannels.ai_assistants.ADD, async (_, data) => {
        // Local inference options must not leak from the shared Settings form
        // into hosted/CLI assistant records (including Chat assistants).
        if (data.provider !== "ollama") {
            delete data.baseUrl;
            delete data.contextLength;
        }
        if (data.provider !== "cloudflare") delete data.accountId;
        if (data.purpose === "coding") {
            data.firstResponseTimeoutMs = codingFirstResponseTimeoutMs(data);
        } else {
            delete data.firstResponseTimeoutMs;
        }
        data.defaultThinkingMode = ["auto", "on", "off"].includes(String(data?.defaultThinkingMode || "").toLowerCase())
            ? String(data.defaultThinkingMode).toLowerCase()
            : "auto";
        let resolvedInvocation = null;
        if (data.provider === "cloudflare") {
            if (data.purpose !== "coding") throw new Error("Cloudflare Workers AI is currently supported for Coding Assistant purpose.");
            data.accountId = cloudflareAccountId(data.accountId);
            data.apiKey = String(data.apiKey || "").trim();
            await inspectCloudflareModel(data);
        } else if (data.provider === "ollama") {
            if (data.purpose !== "coding") throw new Error("Ollama is currently supported for Coding Assistant purpose.");
            const options = ollamaLlmOptions(data);
            await inspectOllamaModel(options.baseUrl, data.model);
            data.baseUrl = options.baseUrl;
            data.contextLength = options.options.num_ctx;
            data.apiKey = "";
        } else if (data.provider === "codex-cli") {
            if (data.purpose !== "coding") {
                throw new Error("Codex CLI is supported only for Coding Assistant purpose.");
            }
            // Validation failures intentionally share this boundary with operation failures.
            try {
                const invocation = await resolveCodexCliInvocation({requireBundled: true,
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
                    // Saving configuration must not depend on inference latency.
                    // Authentication and model discovery are separate from an AI request.
                    const models = await listCodexModels(invocation);
                    if (!models.some(model => model.value === data.model)) {
                        //noinspection ExceptionCaughtLocallyJS
                        throw new Error(`Model ${data.model || '(empty)'} is not in this Codex runtime's selectable catalog. Reload the model list and select an offered model.`);
                    }
                }
            } catch (error) {
                throw new Error(`Codex CLI verification failed. ${error?.message || error}`);
            }
            data.apiKey = "";
            data.model = data.model || "gpt-5-codex";
        } else if (data.provider === "gemini-cli") {
            if (data.purpose !== "coding") {
                throw new Error("Gemini CLI is supported only for Coding Assistant purpose.");
            }
            try {
                const invocation = await resolveGeminiCliInvocation({
                    configuredPath: data.executablePath,
                    preferBundled: true,
                });
                data.executablePath = invocation.entrypoint || invocation.command;
                data.geminiRuntime = {
                    source: invocation.source,
                    version: invocation.version || "",
                    bundled: !!invocation.bundled,
                };
                const authStatus = await readGeminiAuthStatus(invocation);
                data.codexAuth = {
                    status: authStatus.status,
                    message: authStatus.message || null,
                    checkedAt: new Date().toISOString(),
                };
            } catch (error) {
                throw new Error(`Gemini CLI verification failed. ${error?.message || error}`);
            }
            data.apiKey = "";
            data.model = data.model || "gemini-2.5-pro";
        } else if (data.provider === "cursor") {
            if (data.purpose !== "coding") throw new Error("Cursor is supported only for Coding Assistant purpose.");
            data.apiKey = String(data.apiKey || "").trim();
            await inspectCursorModel(data);
        } else if (data.provider === "opencode") {
            if (data.purpose !== "coding") {
                throw new Error("OpenCode Zen is currently supported for Coding Assistant purpose.");
            }
            data.apiKey = String(data.apiKey || "").trim();
            // Key and model are validated against the live Zen catalog; this
            // is a metadata request and does not generate tokens.
            await inspectOpenCodeModel({apiKey: data.apiKey, model: data.model});
        } else if (data.provider === "openrouter") {
            if (data.purpose !== "coding") {
                throw new Error("OpenRouter is currently supported for Coding Assistant purpose.");
            }
            data.apiKey = String(data.apiKey || "").trim();
            // Key and model are validated against live catalog metadata only;
            // no tokens are generated, keeping free-tier request budgets intact.
            await inspectOpenRouterModel({apiKey: data.apiKey, model: data.model});
        } else {
            const llm = new LLM({
                service: data.provider,
                apiKey: data.apiKey,
                model: data.model,
            });
            reserveLiveAiTestRequest();
            const isConnected = await llm.verifyConnection();
            if (!isConnected) {
                throw new Error(`API Key verification failed for ${data.provider} and model ${data.model}. Please check your API key and model.`);
            }
        }
        if (data.purpose === 'coding') {
            try { data.inputCapabilities = await discoverAssistantInputCapabilities(data); }
            catch { data.inputCapabilities = assistantInputCapabilities({...data, inputCapabilities: undefined}); }
        } else delete data.inputCapabilities;
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
            } else if (previous?.provider === "gemini-cli" && data.provider === "gemini-cli") {
                const executableChanged = String(previous.executablePath || "") !== String(cleanData.executablePath || "");
                const runtimeChanged = String(previous.geminiRuntime?.version || "") !== String(cleanData.geminiRuntime?.version || "");
                if (executableChanged || runtimeChanged) {
                    cleanData.codexAuth = {
                        status: "unauthorized",
                        message: "Gemini authentication was reset because the executable or runtime changed.",
                        checkedAt: new Date().toISOString(),
                    };
                }
            }
            list[i] = { ...list[i], ...cleanData, updatedAt: now };
            if (data.provider !== "cloudflare") delete list[i].accountId;
            if (data.provider !== "ollama") {
                delete list[i].baseUrl;
                delete list[i].contextLength;
            }
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
                const invocation = resolvedInvocation || await resolveCodexCliInvocation({requireBundled: true,
                    configuredPath: storedAssistant?.executablePath,
                    preferBundled: true,
                });
                updateCodexAssistantState(storedAssistant.id, {
                    codexAuth: {
                        status: "pending",
                        message: "Codex login started automatically. Complete the flow to authenticate.",
                        checkedAt: new Date().toISOString(),
                    },
                });
                launchCodexLoginUtilityProcess(storedAssistant, invocation);
            }
        } else if (data.provider === "gemini-cli") {
            const storedAssistant = list.find((item) => norm(item.name) === target);
            if (storedAssistant?.codexAuth?.status !== "authorized") {
                const invocation = await resolveGeminiCliInvocation({
                    configuredPath: storedAssistant?.executablePath,
                    preferBundled: true,
                });
                updateCodexAssistantState(storedAssistant.id, {
                    codexAuth: {
                        status: "pending",
                        message: "Gemini sign-in started automatically. Complete the flow in Terminal, then click Check auth.",
                        checkedAt: new Date().toISOString(),
                    },
                });
                launchGeminiLoginUtilityProcess(storedAssistant, invocation);
                try {
                    const loginLaunchResult = await startGeminiLogin(invocation);
                    monitorGeminiTerminalSession(storedAssistant, invocation, loginLaunchResult);
                } catch (error) {
                    stopGeminiAuthProcess(storedAssistant.id, {
                        status: "error",
                        message: String(error?.message || "Unable to start Gemini sign-in terminal."),
                    });
                }
            }
        }
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_STATUS, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || !["codex-cli", "gemini-cli"].includes(assistant.provider)) {
            throw new Error("CLI assistant not found.");
        }
        
        let authStatus;
        if (assistant.provider === "codex-cli") {
            const invocation = await resolveCodexCliInvocation({requireBundled: true,
                configuredPath: assistant.executablePath,
                preferBundled: true,
            });
            authStatus = await readCodexAuthStatus(invocation);
        } else {
            const invocation = await resolveGeminiCliInvocation({
                configuredPath: assistant.executablePath,
                preferBundled: true,
            });
            authStatus = await readGeminiAuthStatus(invocation);
        }

        // Keep pending only while a login process is actively running.
        const hasActiveProcess = assistant.provider === "codex-cli" 
            ? activeCodexAuthProcesses.has(assistant.id)
            : activeGeminiAuthProcesses.has(assistant.id);

        if (authStatus.status !== "authorized" && hasActiveProcess) {
            return assistant.codexAuth;
        }

        const updated = {
            status: authStatus.status,
            message: authStatus.message || null,
            checkedAt: new Date().toISOString(),
        };
        const nextList = list.map((item) => item.id === assistant.id ? { ...item, codexAuth: updated } : item);
        settings.set("ai.coding", nextList);
        broadcastAIAssistantsUpdate();
        return updated;
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_LOGIN, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || !["codex-cli", "gemini-cli"].includes(assistant.provider)) {
            throw new Error("CLI assistant not found.");
        }

        // Set status to pending immediately so UI knows we started
        const startStatus = {
            status: "pending",
            message: assistant.provider === "codex-cli"
                ? "Starting Codex login..."
                : "Starting Gemini sign-in in Terminal...",
            checkedAt: new Date().toISOString(),
        };
        updateCodexAssistantState(assistant.id, { codexAuth: startStatus });

        let result = { started: false };
        if (assistant.provider === "codex-cli") {
            const invocation = await resolveCodexCliInvocation({requireBundled: true,
                configuredPath: assistant.executablePath,
                preferBundled: true,
            });
            result = launchCodexLoginUtilityProcess(assistant, invocation);
        } else {
            if (activeGeminiAuthProcesses.has(assistant.id)) {
                const latest = (settings.get("ai.coding", []) || []).find((item) => item.id === assistant.id);
                return {
                    started: true,
                    mode: "utilityProcess",
                    alreadyRunning: true,
                    auth: latest?.codexAuth || startStatus,
                };
            }
            const invocation = await resolveGeminiCliInvocation({
                configuredPath: assistant.executablePath,
                preferBundled: true,
            });

            clearGeminiAuthProbeCache();
            const authStatus = await readGeminiAuthStatus(invocation);
            if (authStatus.status === "authorized") {
                const authorized = {
                    status: authStatus.status,
                    message: authStatus.message || null,
                    checkedAt: new Date().toISOString(),
                };
                updateCodexAssistantState(assistant.id, { codexAuth: authorized });
                return {
                    started: false,
                    mode: "alreadyAuthorized",
                    alreadyRunning: false,
                    auth: authorized,
                };
            }
            result = launchGeminiLoginUtilityProcess(assistant, invocation);
            try {
                const loginLaunchResult = await startGeminiLogin(invocation);
                monitorGeminiTerminalSession(assistant, invocation, loginLaunchResult);
            } catch (error) {
                stopGeminiAuthProcess(assistant.id, {
                    status: "error",
                    message: String(error?.message || "Unable to start Gemini sign-in terminal."),
                });
                throw error;
            }
        }

        const latest = (settings.get("ai.coding", []) || []).find((item) => item.id === assistant.id);
        return {
            ...result,
            auth: latest?.codexAuth || startStatus,
        };
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_LOGOUT, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || !["codex-cli", "gemini-cli"].includes(assistant.provider)) {
            throw new Error("CLI assistant not found.");
        }
        let authStatus;
        if (assistant.provider === "codex-cli") {
            stopCodexAuthProcess(assistant.id, {
                status: "cancelled",
                message: "Codex authentication was cancelled before sign out.",
            });
            const invocation = await resolveCodexCliInvocation({requireBundled: true,
                configuredPath: assistant.executablePath,
                preferBundled: true,
            });
            authStatus = await runCodexLogout(invocation);
        } else {
            stopGeminiAuthProcess(assistant.id, {
                status: "cancelled",
                message: "Gemini sign-in was cancelled before sign out.",
            });
            const invocation = await resolveGeminiCliInvocation({
                configuredPath: assistant.executablePath,
                preferBundled: true,
            });
            authStatus = await runGeminiLogout(invocation);
        }
        const updated = {
            status: authStatus.status,
            message: authStatus.message || null,
            checkedAt: new Date().toISOString(),
        };
        const nextList = list.map((item) => item.id === assistant.id ? { ...item, codexAuth: updated } : item);
        settings.set("ai.coding", nextList);
        broadcastAIAssistantsUpdate();
        return updated;
    });

    ipcMain.handle(SettingsChannels.ai_assistants.CODEX_AUTH_CANCEL, async (_, assistantId) => {
        const list = settings.get("ai.coding", []) || [];
        const assistant = list.find((item) => item.id === assistantId);
        if (!assistant || !["codex-cli", "gemini-cli"].includes(assistant.provider)) {
            throw new Error("CLI assistant not found.");
        }
        if (assistant.provider === "codex-cli") {
            stopCodexAuthProcess(assistant.id, {
                status: "cancelled",
                message: "Codex authentication was cancelled.",
            });
        } else {
            stopGeminiAuthProcess(assistant.id, {
                status: "cancelled",
                message: "Gemini sign-in was cancelled.",
            });
        }
        const message = assistant.provider === "codex-cli"
            ? "Codex authentication was cancelled."
            : "Gemini sign-in was cancelled. If a terminal is still open, you can close it manually.";
        return {
            status: "cancelled",
            message,
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
