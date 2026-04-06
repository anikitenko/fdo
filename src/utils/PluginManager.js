import UserORM from "./UserORM";
import {app, shell, utilityProcess} from "electron";
import PluginORM from "./PluginORM";
import {PluginChannels} from "../ipc/channels";
import {Certs} from "./certs";
import {NotificationCenter} from "./NotificationCenter";
import {buildPluginRuntimeBundle, getHostPluginNodeModulesPath} from "./pluginRuntimeBundle";
import path from "node:path";
import {mkdirSync, readdirSync, statSync} from "node:fs";
import {buildPluginRuntimePolicy, ensurePluginRuntimeBootstrap, resolveHostGrantedCapabilities} from "./pluginRuntimeSecurity";

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

const PluginManager = {
    mainWindow: null,
    userConfigFile: "",
    pluginConfigFile: "",
    loadedPlugins: {},
    loadingPlugins: {},
    pluginProcessEpoch: {},
    pendingUnloadTimers: {},
    pluginCodeSnapshots: {},
    pluginCodeMutationNotified: {},
    pluginRuntimeOutputTail: {},
    lastUnloadByPlugin: {},
    pluginEventTraceByPlugin: {},
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    },
    setUserConfigFile(userConfigFile) {
        this.userConfigFile = userConfigFile;
    },
    setPluginsRegistryFile(pluginConfigFile) {
        this.pluginConfigFile = pluginConfigFile;
    },
    isPluginProcessAlive(id) {
        const loaded = this.loadedPlugins?.[id];
        if (!loaded?.instance) {
            return false;
        }
        return !loaded.instance.killed;
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

        this.loadingPlugins = this.loadingPlugins || {};
        this.loadingPlugins[id] = true;
        delete this.lastUnloadByPlugin[id];
        const epoch = (this.pluginProcessEpoch[id] || 0) + 1;
        this.pluginProcessEpoch[id] = epoch;
        this.tracePluginEvent(id, "load.epoch", {epoch});

        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);

        try {
            const result = await Certs.verifyPlugin(plugin.home);
            if (!result.success) {
                delete this.pluginCodeSnapshots[id];
                delete this.loadingPlugins[id];
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

                delete this.loadingPlugins[id];
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
                    delete this.loadingPlugins[id];
                    child.kill();
                    return;
                }

                this.loadedPlugins[id] = {
                    instance: child,
                    home: plugin.home,
                    grantedCapabilities,
                    ready: false,
                    inited: false,
                    readyAt: 0,
                };
                this.tracePluginEvent(id, "process.spawned");
                delete this.loadingPlugins[id];
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
                    if (message.type === "PLUGIN_READY") {
                        clearReadyHandshake();
                        this.setPluginReady(id);
                        this.tracePluginEvent(id, "runtime.ready");
                        this.sendToMainWindow(PluginChannels.on_off.READY, id)
                        NotificationCenter.addNotification({title: `${id} is ready`});
                    } else if (message.type === 'PLUGIN_INIT') {
                        this.setPluginInited(id);
                        this.tracePluginEvent(id, "runtime.init");
                        this.sendToMainWindow(PluginChannels.on_off.INIT, {id, ...message.response})
                    } else if (message.type === 'PLUGIN_RENDER') {
                        this.tracePluginEvent(id, "runtime.render");
                        this.sendToMainWindow(PluginChannels.on_off.RENDER, {
                            id,
                            content: message.response,
                        })
                    } else if (message.type === 'UI_MESSAGE') {
                        this.tracePluginEvent(id, "runtime.ui_message");
                        this.sendToMainWindow(PluginChannels.on_off.UI_MESSAGE, {
                            id,
                            content: message.response,
                        })
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
            delete this.loadingPlugins[id];
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
    },
    setPluginInited(id) {
        if (this.loadedPlugins[id]) {
            this.loadedPlugins[id].inited = true;
        }
    },
    getLoadedPlugin(id) {
        return this.loadedPlugins[id];
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
    },
    unLoadPlugin(id, options = {}) {
        const { force = false } = options || {};
        if (this.loadedPlugins[id]) {
            const pluginHome = this.loadedPlugins[id]?.home;
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
                    this.unLoadPlugin(id, { force: true });
                }, remaining + 20);
                return;
            }
            if (this.pendingUnloadTimers[id]) {
                clearTimeout(this.pendingUnloadTimers[id]);
                delete this.pendingUnloadTimers[id];
            }
            this.pluginProcessEpoch[id] = (this.pluginProcessEpoch[id] || 0) + 1;
            this.loadedPlugins[id]?.instance.kill();
            delete this.loadedPlugins[id];
            delete this.pluginRuntimeOutputTail[id];
            this.sendToMainWindow(PluginChannels.on_off.UNLOADED, {
                id,
                reason: "manual_unload",
                message: "",
            });
            this.tracePluginEvent(id, "unload.manual");
            this.lastUnloadByPlugin[id] = {
                id,
                reason: "manual_unload",
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
