import UserORM from "./UserORM";
import {app, dialog, shell, utilityProcess} from "electron";
import PluginORM from "./PluginORM";
import {PluginChannels} from "../ipc/channels";
import {Certs} from "./certs";
import {NotificationCenter} from "./NotificationCenter";
import {buildPluginRuntimeBundle, getHostPluginNodeModulesPath} from "./pluginRuntimeBundle";
import path from "node:path";
import {mkdirSync, readdirSync, statSync} from "node:fs";
import {buildPluginRuntimePolicy, ensurePluginRuntimeBootstrap, resolveHostGrantedCapabilities} from "./pluginRuntimeSecurity";
import {
    executeHostPrivilegedAction,
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ,
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE,
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
} from "./hostPrivilegedActions";
import {extractCapabilityDeclarationComparison} from "./pluginCapabilityDeclaration";

function createHostPluginMessage(message, content = undefined) {
    const envelope = { message };
    if (content !== undefined) {
        envelope.content = content;
    }
    return {
        ...envelope,
        data: envelope,
    };
}

const BACKEND_BRIDGE_REQUEST = "HOST_BACKEND_REQUEST";
const BACKEND_BRIDGE_RESPONSE = "HOST_BACKEND_RESPONSE";
const SDK_DIAGNOSTICS_HANDLER = "__sdk.getDiagnostics";

const PluginManager = {
    mainWindow: null,
    userConfigFile: "",
    pluginConfigFile: "",
    loadedPlugins: {},
    loadingPlugins: {},
    loadingPluginsStartedAt: {},
    pluginProcessEpoch: {},
    pluginSessionCounter: {},
    pendingUnloadTimers: {},
    pluginCodeSnapshots: {},
    pluginCodeMutationNotified: {},
    pluginRuntimeOutputTail: {},
    lastUnloadByPlugin: {},
    pluginEventTraceByPlugin: {},
    privilegedAuditByPlugin: {},
    privilegedApprovalSessionByPlugin: {},
    pluginDiagnosticsByPlugin: {},
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    },
    setUserConfigFile(userConfigFile) {
        this.userConfigFile = userConfigFile;
    },
    setPluginsRegistryFile(pluginConfigFile) {
        this.pluginConfigFile = pluginConfigFile;
    },
    setPluginLoading(id, loading) {
        const pluginId = String(id || "").trim();
        if (!pluginId) return;
        this.loadingPlugins = this.loadingPlugins || {};
        this.loadingPluginsStartedAt = this.loadingPluginsStartedAt || {};
        if (loading) {
            this.loadingPlugins[pluginId] = true;
            this.loadingPluginsStartedAt[pluginId] = Date.now();
            return;
        }
        delete this.loadingPlugins[pluginId];
        delete this.loadingPluginsStartedAt[pluginId];
    },
    pruneStaleLoadingPlugins(maxAgeMs = 20000) {
        const threshold = Math.max(1000, Number(maxAgeMs) || 20000);
        const now = Date.now();
        const staleIds = Object.keys(this.loadingPlugins || {}).filter((id) => {
            const startedAt = Number(this.loadingPluginsStartedAt?.[id] || 0);
            const ageMs = startedAt > 0 ? now - startedAt : Number.POSITIVE_INFINITY;
            const hasLoadedEntry = !!this.loadedPlugins?.[id];
            const hasAliveProcess = this.isPluginProcessAlive(id);
            return !hasLoadedEntry && !hasAliveProcess && ageMs >= threshold;
        });
        staleIds.forEach((id) => this.setPluginLoading(id, false));
        return staleIds;
    },
    isPluginProcessAlive(id) {
        const loaded = this.loadedPlugins?.[id];
        if (!loaded?.instance) {
            return false;
        }
        return !loaded.instance.killed;
    },
    sanitizePrivilegedAuditEvent(pluginId, event = {}) {
        const error = event?.error && typeof event.error === "object" ? event.error : null;
        const result = event?.result && typeof event.result === "object" ? event.result : null;
        const normalized = {
            pluginId: String(pluginId || "").trim(),
            timestamp: typeof event?.timestamp === "string" ? event.timestamp : new Date().toISOString(),
            correlationId: typeof event?.correlationId === "string" ? event.correlationId : "",
            action: typeof event?.action === "string" ? event.action : "",
            scope: typeof event?.scope === "string" ? event.scope : "",
            workflowId: typeof event?.workflowId === "string" ? event.workflowId : "",
            workflowTitle: typeof event?.workflowTitle === "string" ? event.workflowTitle : "",
            workflowKind: typeof event?.workflowKind === "string" ? event.workflowKind : "",
            workflowStatus: typeof event?.workflowStatus === "string" ? event.workflowStatus : "",
            confirmationDecision: typeof event?.confirmationDecision === "string" ? event.confirmationDecision : "",
            dryRun: event?.dryRun === true,
            success: event?.success === true,
            stepIndex: Number.isInteger(event?.stepIndex) ? event.stepIndex : null,
            stepId: typeof event?.stepId === "string" ? event.stepId : "",
            stepTitle: typeof event?.stepTitle === "string" ? event.stepTitle : "",
            stepStatus: typeof event?.stepStatus === "string" ? event.stepStatus : "",
            stepCorrelationId: typeof event?.stepCorrelationId === "string" ? event.stepCorrelationId : "",
            command: typeof event?.command === "string" ? event.command : "",
            args: Array.isArray(event?.args) ? event.args.filter((value) => typeof value === "string") : [],
            cwd: typeof event?.cwd === "string" ? event.cwd : "",
            durationMs: Number.isFinite(event?.durationMs) ? Number(event.durationMs) : null,
            timedOut: event?.timedOut === true,
            error: error ? {
                code: typeof error?.code === "string" ? error.code : "",
                message: typeof error?.error === "string" ? error.error : (typeof error?.message === "string" ? error.message : ""),
                correlationId: typeof error?.correlationId === "string" ? error.correlationId : "",
            } : null,
            result: result ? {
                ok: result?.ok === true,
                correlationId: typeof result?.correlationId === "string" ? result.correlationId : "",
                status: typeof result?.result?.status === "string" ? result.result.status : "",
                workflowId: typeof result?.result?.workflowId === "string" ? result.result.workflowId : "",
            } : null,
        };
        return normalized;
    },
    recordPrivilegedAudit(pluginId, event = {}) {
        const id = String(pluginId || "").trim();
        if (!id) return;
        const normalized = this.sanitizePrivilegedAuditEvent(id, event);
        const existing = Array.isArray(this.privilegedAuditByPlugin?.[id]) ? this.privilegedAuditByPlugin[id] : [];
        const next = [...existing, normalized].slice(-200);
        this.privilegedAuditByPlugin = {
            ...this.privilegedAuditByPlugin,
            [id]: next,
        };
    },
    getPrivilegedAuditTrail(pluginId, options = {}) {
        const id = String(pluginId || "").trim();
        const limit = Math.max(1, Math.min(200, Number(options?.limit || 40)));
        const events = Array.isArray(this.privilegedAuditByPlugin?.[id]) ? this.privilegedAuditByPlugin[id] : [];
        return events.slice(-limit);
    },
    clearPrivilegedAuditTrail(pluginId) {
        const id = String(pluginId || "").trim();
        if (!id || !this.privilegedAuditByPlugin?.[id]) {
            return;
        }
        const next = {...this.privilegedAuditByPlugin};
        delete next[id];
        this.privilegedAuditByPlugin = next;
    },
    getPrivilegedApprovalSession(pluginId) {
        const id = String(pluginId || "").trim();
        if (!id) {
            return new Map();
        }
        if (!(this.privilegedApprovalSessionByPlugin?.[id] instanceof Map)) {
            this.privilegedApprovalSessionByPlugin = {
                ...this.privilegedApprovalSessionByPlugin,
                [id]: new Map(),
            };
        }
        return this.privilegedApprovalSessionByPlugin[id];
    },
    clearPrivilegedApprovalSession(pluginId) {
        const id = String(pluginId || "").trim();
        if (!id || !this.privilegedApprovalSessionByPlugin?.[id]) {
            return;
        }
        delete this.privilegedApprovalSessionByPlugin[id];
    },
    sanitizePluginDiagnostics(pluginId, diagnostics = {}) {
        const registeredHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
            ? diagnostics.capabilities.registeredHandlers.filter((value) => typeof value === "string" && value.trim())
            : [];
        const grantedCapabilities = Array.isArray(this.loadedPlugins?.[pluginId]?.grantedCapabilities)
            ? this.loadedPlugins[pluginId].grantedCapabilities
            : [];
        const runtimeSessionId = typeof this.loadedPlugins?.[pluginId]?.sessionId === "string"
            ? this.loadedPlugins[pluginId].sessionId
            : "";
        const capabilityComparison = extractCapabilityDeclarationComparison(diagnostics, grantedCapabilities);
        return {
            pluginId: typeof diagnostics?.pluginId === "string" ? diagnostics.pluginId : String(pluginId || ""),
            runtimeSessionId,
            health: {
                status: typeof diagnostics?.health?.status === "string" ? diagnostics.health.status : "",
                lastErrorMessage: typeof diagnostics?.health?.lastErrorMessage === "string" ? diagnostics.health.lastErrorMessage : "",
                initCount: Number.isFinite(diagnostics?.health?.initCount) ? Number(diagnostics.health.initCount) : 0,
                renderCount: Number.isFinite(diagnostics?.health?.renderCount) ? Number(diagnostics.health.renderCount) : 0,
                handlerCount: Number.isFinite(diagnostics?.health?.handlerCount) ? Number(diagnostics.health.handlerCount) : 0,
                errorCount: Number.isFinite(diagnostics?.health?.errorCount) ? Number(diagnostics.health.errorCount) : 0,
            },
            capabilities: {
                registeredHandlers,
                declaration: capabilityComparison,
                permissions: {
                    granted: capabilityComparison.granted,
                },
            },
        };
    },
    async postPluginUiMessageAndAwaitResult(pluginId, content, options = {}) {
        const loadedPlugin = this.loadedPlugins?.[pluginId];
        const child = loadedPlugin?.instance;
        const expectedSessionId = typeof options?.expectedSessionId === "string" && options.expectedSessionId.trim()
            ? options.expectedSessionId.trim()
            : (typeof loadedPlugin?.sessionId === "string" ? loadedPlugin.sessionId : "");
        const timeoutMs = Math.max(500, Math.min(30000, Number(options?.timeoutMs || 2500)));
        if (!child || typeof child.postMessage !== "function" || typeof child.on !== "function" || typeof child.off !== "function") {
            return null;
        }
        return new Promise((resolve) => {
            let settled = false;
            let timeoutHandle = null;

            const finish = (payload) => {
                if (settled) return;
                settled = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                child.off("message", onMessage);
                resolve(payload);
            };

            const onMessage = (message) => {
                if (!message || message.type !== "UI_MESSAGE") {
                    return;
                }
                if (expectedSessionId && this.getLoadedPluginSessionId(pluginId) !== expectedSessionId) {
                    finish(null);
                    return;
                }
                finish(message.response);
            };

            child.on("message", onMessage);
            timeoutHandle = setTimeout(() => finish(null), timeoutMs);

            try {
                child.postMessage(createHostPluginMessage("UI_MESSAGE", content));
            } catch (_) {
                finish(null);
            }
        });
    },
    async refreshPluginDiagnostics(pluginId, options = {}) {
        const id = String(pluginId || "").trim();
        if (!id) return null;
        const loadedPlugin = this.loadedPlugins?.[id];
        if (!loadedPlugin?.ready) {
            return this.pluginDiagnosticsByPlugin?.[id] || null;
        }
        const response = await this.postPluginUiMessageAndAwaitResult(id, {
            handler: SDK_DIAGNOSTICS_HANDLER,
            content: {
                notificationsLimit: 5,
            },
        }, {
            ...options,
            expectedSessionId: loadedPlugin?.sessionId || "",
        });
        if (!response || typeof response !== "object") {
            return this.pluginDiagnosticsByPlugin?.[id] || null;
        }
        const sanitized = this.sanitizePluginDiagnostics(id, response);
        this.pluginDiagnosticsByPlugin = {
            ...this.pluginDiagnosticsByPlugin,
            [id]: sanitized,
        };
        const reason = typeof options?.reason === "string" && options.reason.trim()
            ? options.reason.trim()
            : "refresh";
        this.tracePluginEvent(id, "diagnostics.refreshed", {
            reason,
            runtimeSessionId: sanitized.runtimeSessionId || "",
            registeredHandlers: sanitized?.capabilities?.registeredHandlers || [],
        });
        console.info("[PLUGIN_HANDLER_REGISTRY]", JSON.stringify({
            pluginId: id,
            reason,
            runtimeSessionId: sanitized.runtimeSessionId || "",
            registeredHandlers: sanitized?.capabilities?.registeredHandlers || [],
        }));
        return sanitized;
    },
    async getPluginDiagnostics(pluginId, options = {}) {
        const id = String(pluginId || "").trim();
        if (!id) return null;
        const refresh = options?.refresh === true || (options?.refreshIfMissing === true && !this.pluginDiagnosticsByPlugin?.[id]);
        if (refresh) {
            return this.refreshPluginDiagnostics(id, options);
        }
        return this.pluginDiagnosticsByPlugin?.[id] || null;
    },
    capturePluginCodeSnapshot(pluginHome, options = {}) {
        const {
            maxFiles = 2000,
        } = options;
        const snapshot = new Map();
        let scannedFiles = 0;
        let truncated = false;

        const visit = (currentPath) => {
            if (truncated) return;
            const entries = readdirSync(currentPath, {withFileTypes: true});
            for (const entry of entries) {
                if (truncated) break;
                if (entry.name === ".git" || entry.name === "node_modules") {
                    continue;
                }
                const fullPath = path.join(currentPath, entry.name);
                const relPath = path.relative(pluginHome, fullPath);
                if (entry.isDirectory()) {
                    visit(fullPath);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                scannedFiles += 1;
                if (scannedFiles > maxFiles) {
                    truncated = true;
                    break;
                }
                const stats = statSync(fullPath);
                snapshot.set(relPath, {size: stats.size, mtimeMs: stats.mtimeMs});
            }
        };

        try {
            visit(pluginHome);
        } catch (error) {
            return {
                ok: false,
                error: error?.message || String(error),
                snapshot: new Map(),
                truncated: false,
            };
        }

        return {
            ok: true,
            snapshot,
            truncated,
        };
    },
    maybeWarnPluginCodeMutation(id, pluginHome) {
        if (app.isPackaged || !pluginHome) {
            return;
        }
        const beforeCapture = this.pluginCodeSnapshots[id];
        delete this.pluginCodeSnapshots[id];
        if (!beforeCapture?.ok || !beforeCapture.snapshot) {
            return;
        }

        const afterCapture = this.capturePluginCodeSnapshot(pluginHome);
        if (!afterCapture.ok) {
            return;
        }

        const before = beforeCapture.snapshot;
        const after = afterCapture.snapshot;
        const changed = [];

        for (const [filePath, stat] of after.entries()) {
            const prev = before.get(filePath);
            if (!prev || prev.size !== stat.size || Math.floor(prev.mtimeMs) !== Math.floor(stat.mtimeMs)) {
                changed.push(filePath);
                if (changed.length >= 8) break;
            }
        }
        if (changed.length < 8) {
            for (const filePath of before.keys()) {
                if (!after.has(filePath)) {
                    changed.push(filePath);
                    if (changed.length >= 8) break;
                }
            }
        }

        if (changed.length === 0) {
            return;
        }
        if (this.pluginCodeMutationNotified[id]) {
            return;
        }
        this.pluginCodeMutationNotified[id] = true;

        const suffix = changed.length > 3 ? "…" : "";
        const sample = changed.slice(0, 3).join(", ");
        NotificationCenter.addNotification({
            title: `Plugin ${id} modified code directory`,
            message: `Development warning: plugin wrote files under PLUGIN_CODE_HOME. Use PLUGIN_HOME for writable state. Changed: ${sample}${suffix}`,
            type: "warning",
        });
    },
    async loadPlugins() {
        const userORM = new UserORM(this.userConfigFile);
        const plugins = userORM.getActivatedPlugins();

        const loadPromises = plugins.map((id) => this.loadPlugin(id));

        const results = await Promise.allSettled(loadPromises);

        const loaded = results.filter(r => r.status === "fulfilled" && r.value.success).length;
        NotificationCenter.addNotification({title: `Plugins were loaded`, message: `🔄 Loaded ${loaded} of ${plugins.length} plugins.`});
    },

    async loadPlugin(id) {
        this.tracePluginEvent(id, "load.requested");
        if (this.pendingUnloadTimers[id]) {
            clearTimeout(this.pendingUnloadTimers[id]);
            delete this.pendingUnloadTimers[id];
        }
        if (this.isPluginProcessAlive(id)) {
            return { success: true };
        }

        if (this.loadingPlugins[id]) {
            return { success: true };
        }

        this.setPluginLoading(id, true);
        delete this.lastUnloadByPlugin[id];
        const epoch = (this.pluginProcessEpoch[id] || 0) + 1;
        const sessionSequence = (this.pluginSessionCounter[id] || 0) + 1;
        this.pluginSessionCounter[id] = sessionSequence;
        const sessionId = `${id}:${epoch}:${sessionSequence}:${Date.now()}`;
        this.pluginProcessEpoch[id] = epoch;
        this.tracePluginEvent(id, "load.epoch", {epoch, sessionId});
        console.info("[PLUGIN_SESSION_START]", JSON.stringify({pluginId: id, epoch, sessionId}));

        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);

        try {
            const result = await Certs.verifyPlugin(plugin.home);
            if (!result.success) {
                delete this.pluginCodeSnapshots[id];
                this.setPluginLoading(id, false);
                this.tracePluginEvent(id, "load.verification_failed", {error: result.error});
                this.sendToMainWindow(PluginChannels.on_off.UNLOADED, {
                    id,
                    reason: "verification_failed",
                    message: result.error,
                });
                NotificationCenter.addNotification({title: `Plugin ${id} verification failed`, message: result.error, type: "danger"});
                return { success: false, error: result.error };
            }

            let runtimeEntry = plugin.entry;
            let hostNodeModulesPath = process.env.NODE_PATH || "";
            try {
                const runtimeBundle = await buildPluginRuntimeBundle(id, plugin.home);
                if (runtimeBundle?.entry) {
                    runtimeEntry = runtimeBundle.entry;
                    hostNodeModulesPath = runtimeBundle.nodeModulesPath || hostNodeModulesPath;
                } else {
                    hostNodeModulesPath = getHostPluginNodeModulesPath();
                }
            } catch (error) {
                hostNodeModulesPath = getHostPluginNodeModulesPath();
                this.tracePluginEvent(id, "runtime.bundle_rebuild_failed", {
                    error: error?.message || String(error),
                });
                NotificationCenter.addNotification({
                    title: `Plugin ${id} runtime rebuild failed`,
                    message: `Falling back to the stored bundle. ${error.message || error}`,
                    type: "warning",
                });
            }
            if (typeof runtimeEntry === "string" && !path.isAbsolute(runtimeEntry)) {
                runtimeEntry = path.join(plugin.home, runtimeEntry);
            }

            const userDataRoot = process.env.FDO_E2E_USER_DATA_DIR || app.getPath("userData");
            const pluginDataHome = path.join(userDataRoot, "plugin-data", id);
            mkdirSync(pluginDataHome, {recursive: true});
            if (!app.isPackaged) {
                this.pluginCodeSnapshots[id] = this.capturePluginCodeSnapshot(plugin.home);
            }
            const grantedCapabilities = resolveHostGrantedCapabilities({
                pluginCapabilities: plugin?.capabilities || [],
            });
            const runtimePolicy = buildPluginRuntimePolicy(grantedCapabilities);
            const bootstrapEntry = ensurePluginRuntimeBootstrap(id);

            const child = utilityProcess.fork(bootstrapEntry, [], {
                serviceName: `plugin-${id}`,
                cwd: pluginDataHome,
                stdio: "pipe",
                env: {
                    // Keep signed plugin directory immutable by default.
                    // Runtime/plugin state should be written to the data directory.
                    // We keep PLUGIN_CODE_HOME for explicit access to shipped files.
                    ...process.env,
                    PLUGIN_HOME: pluginDataHome,
                    PLUGIN_CODE_HOME: plugin.home,
                    // SDK JSON store resolves from FDO_SDK_STORAGE_ROOT.
                    // Point it to writable plugin runtime home so json store works
                    // without per-plugin manual host configuration.
                    FDO_SDK_STORAGE_ROOT: pluginDataHome,
                    FDO_PLUGIN_RUNTIME_ENTRY: runtimeEntry,
                    FDO_PLUGIN_CAPABILITIES: grantedCapabilities.join(","),
                    FDO_PLUGIN_POLICY_JSON: JSON.stringify(runtimePolicy),
                    FDO_SDK_LOG_ROOT: path.join(pluginDataHome, "logs"),
                    LOG_LEVEL: "info",
                    FDO_PLUGIN_NODE_PATH: hostNodeModulesPath,
                    NODE_PATH: hostNodeModulesPath,
                },
            });

            const appendRuntimeOutput = (kind, chunk) => {
                const text = String(chunk || "").trim();
                if (!text) return;
                const buffer = this.pluginRuntimeOutputTail[id] || [];
                buffer.push(`[${kind}] ${text}`);
                if (buffer.length > 16) {
                    buffer.splice(0, buffer.length - 16);
                }
                this.pluginRuntimeOutputTail[id] = buffer;
                this.tracePluginEvent(id, "runtime.output", {
                    kind,
                    text: text.length > 500 ? `${text.slice(0, 500)}...` : text,
                });
            };

            const attachOutputStream = (stream, kind) => {
                if (!stream || typeof stream.on !== "function") {
                    return;
                }
                stream.on("data", (data) => {
                    appendRuntimeOutput(kind, data);
                });
            };

            attachOutputStream(child.stdout, "stdout");
            attachOutputStream(child.stderr, "stderr");

            const cleanup = (payload = {}) => {
                if (this.pluginProcessEpoch[id] !== epoch) {
                    return;
                }

                this.setPluginLoading(id, false);
                const activeProcess = this.loadedPlugins[id]?.instance;
                if (activeProcess && activeProcess !== child) {
                    return;
                }
                delete this.loadedPlugins[id];
                const outputTail = (this.pluginRuntimeOutputTail[id] || []).join("\n").trim();
                delete this.pluginRuntimeOutputTail[id];
                const messageWithOutput = payload.message || "";
                const message = outputTail
                    ? `${messageWithOutput}${messageWithOutput ? "\n" : ""}Runtime output:\n${outputTail}`
                    : messageWithOutput;
                const unloadPayload = {
                    id,
                    sessionId,
                    reason: payload.reason || "unloaded",
                    message,
                    code: payload.code,
                };
                this.maybeWarnPluginCodeMutation(id, plugin.home);
                this.lastUnloadByPlugin[id] = {
                    ...unloadPayload,
                    ts: Date.now(),
                };
                this.tracePluginEvent(id, "process.unloaded", unloadPayload);
                console.info("[PLUGIN_SESSION_END]", JSON.stringify({
                    pluginId: id,
                    sessionId,
                    reason: unloadPayload.reason || "",
                    code: unloadPayload.code ?? null,
                }));
                this.sendToMainWindow(PluginChannels.on_off.UNLOADED, unloadPayload);
                if (payload.notify !== false) {
                    NotificationCenter.addNotification({
                        title: payload.title || `Plugin ${id} was unloaded`,
                        message: payload.message || "",
                        type: payload.type || "",
                    });
                }
            };

            child.once("spawn", () => {
                if (this.pluginProcessEpoch[id] !== epoch) {
                    child.kill();
                    return;
                }

                // Guard against duplicate spawns for the same plugin id.
                // This can happen if activate is triggered repeatedly in quick succession.
                if (this.isPluginProcessAlive(id)) {
                    this.setPluginLoading(id, false);
                    child.kill();
                    return;
                }

                this.loadedPlugins[id] = {
                    instance: child,
                    home: plugin.home,
                    grantedCapabilities,
                    sessionId,
                    ready: false,
                    inited: false,
                    initRequested: false,
                    readyAt: 0,
                };
                this.tracePluginEvent(id, "process.spawned", {sessionId});
                this.setPluginLoading(id, false);
                let readyHandshakeTimer = null;
                let readyHandshakeDeadline = null;
                const clearReadyHandshake = () => {
                    if (readyHandshakeTimer) {
                        clearInterval(readyHandshakeTimer);
                        readyHandshakeTimer = null;
                    }
                    if (readyHandshakeDeadline) {
                        clearTimeout(readyHandshakeDeadline);
                        readyHandshakeDeadline = null;
                    }
                };
                const sendReadyProbe = () => {
                    if (this.pluginProcessEpoch[id] !== epoch) {
                        clearReadyHandshake();
                        return;
                    }
                    const loadedPlugin = this.loadedPlugins[id];
                    if (!loadedPlugin || loadedPlugin.ready || child.killed) {
                        clearReadyHandshake();
                        return;
                    }
                    try {
                        child.postMessage(createHostPluginMessage("PLUGIN_READY"));
                    } catch (_) {
                        // Let child error/exit paths handle cleanup.
                    }
                };

                child.on("message", (message) => {
                    const activeSessionId = this.getLoadedPluginSessionId(id);
                    if (this.pluginProcessEpoch[id] !== epoch || this.loadedPlugins?.[id]?.instance !== child) {
                        this.tracePluginEvent(id, "runtime.message.ignored_stale_instance", {
                            messageType: message?.type || "",
                            sessionId,
                            activeSessionId: activeSessionId || "",
                        });
                        return;
                    }
                    if (message.type === "PLUGIN_READY") {
                        clearReadyHandshake();
                        this.setPluginReady(id);
                        void this.refreshPluginDiagnostics(id, {timeoutMs: 2500, reason: "plugin_ready"});
                        this.tracePluginEvent(id, "runtime.ready", {sessionId});
                        this.sendToMainWindow(PluginChannels.on_off.READY, id)
                        NotificationCenter.addNotification({title: `${id} is ready`});
                    } else if (message.type === 'PLUGIN_INIT') {
                        if (this.loadedPlugins[id]) {
                            this.loadedPlugins[id].initRequested = false;
                        }
                        this.setPluginInited(id);
                        void this.refreshPluginDiagnostics(id, {timeoutMs: 2500, reason: "plugin_init"});
                        this.tracePluginEvent(id, "runtime.init", {sessionId});
                        this.sendToMainWindow(PluginChannels.on_off.INIT, {id, ...message.response})
                        // Host-side safety net: always request a render right after init.
                        // This avoids UI deadlocks when renderer-side render trigger is missed.
                        try {
                            child.postMessage(createHostPluginMessage("PLUGIN_RENDER"));
                            console.info("[PLUGIN_RENDER_REQUEST_AFTER_INIT]", JSON.stringify({
                                pluginId: id,
                                sessionId,
                            }));
                            this.tracePluginEvent(id, "runtime.render.requested_after_init", {sessionId});
                        } catch (error) {
                            this.tracePluginEvent(id, "runtime.render.request_after_init_failed", {
                                sessionId,
                                error: error?.message || String(error),
                            });
                        }
                    } else if (message.type === 'PLUGIN_RENDER') {
                        const renderPayload = message.response;
                        const renderPayloadType = renderPayload && typeof renderPayload === "object"
                            ? `object:${Object.keys(renderPayload).join(",")}`
                            : typeof renderPayload;
                        console.info("[PLUGIN_RENDER_RESPONSE]", JSON.stringify({
                            pluginId: id,
                            sessionId,
                            payloadType: renderPayloadType,
                            hasRender: typeof renderPayload?.render === "string",
                            hasOnLoad: typeof renderPayload?.onLoad === "string",
                        }));
                        this.tracePluginEvent(id, "runtime.render", {sessionId});
                        this.sendToMainWindow(PluginChannels.on_off.RENDER, {
                            id,
                            sessionId,
                            content: message.response,
                        })
                    } else if (message.type === 'UI_MESSAGE') {
                        this.tracePluginEvent(id, "runtime.ui_message", {sessionId});
                        this.sendToMainWindow(PluginChannels.on_off.UI_MESSAGE, {
                            id,
                            sessionId,
                            content: message.response,
                        })
                    } else if (message.type === BACKEND_BRIDGE_REQUEST) {
                        const requestId = typeof message.requestId === "string" ? message.requestId : "";
                        const payload = message.message || {};
                        const correlationId = typeof payload?.content?.correlationId === "string" && payload.content.correlationId.trim()
                            ? payload.content.correlationId.trim()
                            : `priv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                        this.tracePluginEvent(id, "runtime.backend_bridge_request", {
                            requestId,
                            handler: payload?.handler || "",
                            correlationId,
                            sessionId,
                        });
                        Promise.resolve(executeHostPrivilegedAction(payload?.content?.request ?? payload?.content ?? {}, {
                            pluginId: id,
                            correlationId,
                            grantedCapabilities: this.loadedPlugins?.[id]?.grantedCapabilities || [],
                            onAudit: (event) => {
                                this.recordPrivilegedAudit(id, event);
                                console.info("[PLUGIN_PRIVILEGED_AUDIT]", JSON.stringify(event));
                            },
                            approvalSessionStore: this.getPrivilegedApprovalSession(id),
                            confirmPrivilegedAction: async ({title, message: confirmMessage, detail, confirmLabel, cancelLabel, action}) => {
                                if (process.env.FDO_E2E === "1") {
                                    const confirmMode = String(process.env.FDO_E2E_PRIVILEGED_CONFIRM_MODE || "").toLowerCase().trim();
                                    if (confirmMode === "approve") {
                                        return true;
                                    }
                                    if (confirmMode === "deny") {
                                        return false;
                                    }
                                    if (process.env.FDO_E2E_AUTO_APPROVE_PRIVILEGED !== "0") {
                                        return true;
                                    }
                                }
                                const defaultTitle = action === HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC
                                    ? "Confirm Scoped Process Execution"
                                    : action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ
                                        ? "Confirm Clipboard Read"
                                        : action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE
                                            ? "Confirm Clipboard Write"
                                            : "Confirm Privileged Plugin Action";
                                const defaultMessage = action === HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC
                                    ? "Plugin requests running an approved external tool"
                                    : action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ
                                        ? "Plugin requests reading text from the host clipboard"
                                        : action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE
                                            ? "Plugin requests writing text to the host clipboard"
                                            : "Plugin requests a privileged host action";
                                const result = await Promise.race([
                                    dialog.showMessageBox({
                                        type: "warning",
                                        title: title || defaultTitle,
                                        message: confirmMessage || defaultMessage,
                                        detail: detail || "",
                                        buttons: [cancelLabel || "Cancel", confirmLabel || "Apply"],
                                        cancelId: 0,
                                        defaultId: 1,
                                        noLink: true,
                                    }),
                                    new Promise((resolve) => setTimeout(() => resolve({response: 0}), 45000)),
                                ]);
                                return result.response === 1;
                            },
                        })).then((response) => {
                            child.postMessage(createHostPluginMessage(BACKEND_BRIDGE_RESPONSE, {
                                requestId,
                                response,
                            }));
                            this.tracePluginEvent(id, "runtime.backend_bridge_response", {
                                requestId,
                                correlationId: response?.correlationId || correlationId,
                                code: response?.code || "",
                                ok: response?.ok,
                                sessionId,
                            });
                        }).catch((error) => {
                            const failure = {
                                ok: false,
                                correlationId,
                                error: error?.message || String(error),
                                code: error?.code || "HOST_ACTION_FAILED",
                            };
                            child.postMessage(createHostPluginMessage(BACKEND_BRIDGE_RESPONSE, {
                                requestId,
                                response: failure,
                            }));
                            this.tracePluginEvent(id, "runtime.backend_bridge_error", {
                                requestId,
                                correlationId,
                                code: failure.code,
                                error: failure.error,
                                sessionId,
                            });
                        });
                    }
                });

                sendReadyProbe();
                readyHandshakeTimer = setInterval(sendReadyProbe, 320);
                readyHandshakeDeadline = setTimeout(() => {
                    const loadedPlugin = this.loadedPlugins[id];
                    if (!loadedPlugin || loadedPlugin.ready) {
                        clearReadyHandshake();
                        return;
                    }
                    clearReadyHandshake();
                    try {
                        child.kill();
                    } catch (_) {
                        // Ignore kill errors; cleanup is handled via exit/error.
                    }
                }, 12000);

                child.once("exit", () => {
                    clearReadyHandshake();
                });
                child.once("error", () => {
                    clearReadyHandshake();
                });
            });

            child.once("error", (err) => {
                cleanup({
                    reason: "process_error",
                    message: err?.message || String(err),
                    title: `Error with ${id}`,
                    type: "danger",
                });
            });

            child.once("exit", (code) => {
                cleanup({
                    reason: "process_exit",
                    code,
                    message: `Exit code ${code}`,
                    title: `Plugin ${id} exited`,
                    type: code === 0 ? "" : "danger",
                });
            });

            return { success: true };
        } catch (err) {
            delete this.pluginCodeSnapshots[id];
            this.setPluginLoading(id, false);
            this.tracePluginEvent(id, "load.failed", {error: err?.message || String(err)});
            if (process.platform === 'darwin' && err.code === 'EPERM') {
                const result = await dialog.showMessageBox({
                    type: 'error',
                    title: 'Permission Denied',
                    message: `macOS has blocked access to:\n${id}\n\nPlease grant access in System Settings > Privacy & Security > Files and Folders.`,
                    buttons: ['Open Settings', 'Cancel'],
                    defaultId: 0
                });

                if (result.response === 0) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders');
                }
            } else {
                NotificationCenter.addNotification({title: `Failed to load ${id}`, message: err, type: "danger"});
                this.sendToMainWindow(PluginChannels.on_off.UNLOADED, {
                    id,
                    reason: "load_failed",
                    message: err?.message || String(err),
                });
                return {success: false, error: err.message};
            }
        }
    },

    setPluginReady(id) {
        if (!this.loadedPlugins[id]) return;
        this.loadedPlugins[id].ready = true;
        this.loadedPlugins[id].readyAt = Date.now();
        this.setPluginLoading(id, false);
    },
    setPluginInited(id) {
        if (this.loadedPlugins[id]) {
            this.loadedPlugins[id].inited = true;
            this.setPluginLoading(id, false);
        }
    },
    getLoadedPlugin(id) {
        return this.loadedPlugins[id];
    },
    getLoadedPluginSessionId(id) {
        return this.loadedPlugins[id]?.sessionId || "";
    },
    getLoadedPluginInstance(id) {
        return this.loadedPlugins[id]?.instance;
    },
    getLoadedPluginReady(id) {
        return this.loadedPlugins[id]?.ready;
    },
    getLoadedPluginInited(id) {
        return this.loadedPlugins[id]?.inited;
    },
    unLoadPlugins() {
        for(const id in this.loadedPlugins) {
            this.unLoadPlugin(id);
        }
        Object.keys(this.loadingPlugins || {}).forEach((id) => this.setPluginLoading(id, false));
    },
    unLoadPlugin(id, options = {}) {
        const { force = false, reason = "manual_unload" } = options || {};
        if (!this.loadedPlugins[id]) {
            this.setPluginLoading(id, false);
        }
        if (this.loadedPlugins[id]) {
            const pluginHome = this.loadedPlugins[id]?.home;
            const sessionId = this.loadedPlugins[id]?.sessionId || "";
            const readyAt = this.loadedPlugins[id]?.readyAt || 0;
            const elapsed = Date.now() - readyAt;
            if (!force && readyAt > 0 && elapsed < 1800) {
                const remaining = Math.max(0, 1800 - elapsed);
                this.tracePluginEvent(id, "unload.deferred", {remainingMs: remaining});
                if (this.pendingUnloadTimers[id]) {
                    clearTimeout(this.pendingUnloadTimers[id]);
                }
                this.pendingUnloadTimers[id] = setTimeout(() => {
                    delete this.pendingUnloadTimers[id];
                    this.unLoadPlugin(id, { force: true, reason });
                }, remaining + 20);
                return;
            }
            if (this.pendingUnloadTimers[id]) {
                clearTimeout(this.pendingUnloadTimers[id]);
                delete this.pendingUnloadTimers[id];
            }
            this.pluginProcessEpoch[id] = (this.pluginProcessEpoch[id] || 0) + 1;
            const removedHandlers = Array.isArray(this.pluginDiagnosticsByPlugin?.[id]?.capabilities?.registeredHandlers)
                ? [...this.pluginDiagnosticsByPlugin[id].capabilities.registeredHandlers]
                : [];
            this.loadedPlugins[id]?.instance.kill();
            this.setPluginLoading(id, false);
            delete this.loadedPlugins[id];
            delete this.pluginDiagnosticsByPlugin[id];
            delete this.pluginRuntimeOutputTail[id];
            this.clearPrivilegedApprovalSession(id);
            this.sendToMainWindow(PluginChannels.on_off.UNLOADED, {
                id,
                sessionId,
                reason,
                message: "",
            });
            this.tracePluginEvent(id, "unload.manual", {
                sessionId,
                reason,
                removedHandlers,
            });
            console.info("[PLUGIN_HANDLER_REGISTRY_CLEAR]", JSON.stringify({
                pluginId: id,
                sessionId,
                reason,
                removedHandlers,
            }));
            this.lastUnloadByPlugin[id] = {
                id,
                sessionId,
                reason,
                message: "",
                ts: Date.now(),
            };
            // Best-effort dev-only warning for plugins mutating code directories.
            setTimeout(() => {
                this.maybeWarnPluginCodeMutation(id, pluginHome);
            }, 220);
        }
    },
    tracePluginEvent(id, event, details = {}) {
        const pluginId = String(id || "").trim();
        if (!pluginId) {
            return;
        }
        const eventName = String(event || "").trim() || "unknown";
        const bucket = this.pluginEventTraceByPlugin[pluginId] || [];
        bucket.push({
            ts: Date.now(),
            event: eventName,
            details,
        });
        if (bucket.length > 200) {
            bucket.splice(0, bucket.length - 200);
        }
        this.pluginEventTraceByPlugin[pluginId] = bucket;
    },
    getPluginEventTrace(id, options = {}) {
        const pluginId = String(id || "").trim();
        if (!pluginId) {
            return [];
        }
        const limit = Math.max(1, Math.min(200, Number(options?.limit || 80)));
        const events = this.pluginEventTraceByPlugin[pluginId] || [];
        return events.slice(-limit);
    },
    sendToMainWindow(type, ...data) {
        if (
            this.mainWindow &&
            !this.mainWindow.isDestroyed() &&
            this.mainWindow.webContents &&
            !this.mainWindow.webContents.isDestroyed()
        ) {
            this.mainWindow.webContents.send(type, ...data);
        }
    },
}

export default PluginManager
