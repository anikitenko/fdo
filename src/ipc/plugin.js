import {app, BrowserWindow, dialog, ipcMain} from "electron";
import ValidatePlugin from "../components/plugin/ValidatePlugin";
import {rmSync, chmodSync, existsSync, statSync} from "node:fs";
import {readFile, readdir, stat} from 'node:fs/promises';
import Module from 'node:module';
import PluginORM from "../utils/PluginORM";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "../main.js";
import generatePluginName from "../components/editor/utils/generatePluginName";
import path from "node:path";
import UserORM from "../utils/UserORM";
import PluginManager from "../utils/PluginManager";
import {PluginChannels} from "./channels";
import ensureAndWrite from "../utils/ensureAndWrite";
import {EsbuildVirtualFsPlugin} from "../utils/esbuild/plugins/virtual-fs";
import {Certs} from "../utils/certs";
import {syncPluginDir} from "../utils/syncPluginDir";
import {NotificationCenter} from "../utils/NotificationCenter";
import {editorWindow} from "../utils/editorWindow";
import {getIgnoreInstance} from "../utils/getIgnoreInstance";
import {getAllFilesWithIgnorance} from "../utils/getAllFilesWithIgnorance";
import * as stream from "node:stream";

import {v4 as uuidv4} from 'uuid';

import archiver from "archiver"
import {extractMetadata} from "../utils/extractMetadata";
import {normalizeAndValidatePluginMetadata} from "../utils/pluginMetadataContract";
import {runPluginWorkspaceTests} from "../utils/pluginTestRunner";
import {buildPluginInitPayload, resolveHostGrantedCapabilities} from "../utils/pluginRuntimeSecurity";
import {
    executeHostPrivilegedAction,
    HOST_PRIVILEGED_HANDLER,
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ,
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE,
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
} from "../utils/hostPrivilegedActions";
import {
    getAllHostFilesystemScopePolicies,
    getHostPluginCustomFilesystemScopes,
    getHostSharedFilesystemScopes,
    normalizeCustomFilesystemScope,
    removeHostPluginCustomFilesystemScopes,
    sanitizeCustomFilesystemScopeId,
    setHostPluginCustomFilesystemScopes,
    setHostSharedFilesystemScopes,
} from "../utils/privilegedFsScopeRegistry";
import {
    getAllHostProcessScopePolicies,
    getHostPluginCustomProcessScopes,
    getHostSharedProcessScopes,
    normalizeCustomProcessScope,
    removeHostPluginCustomProcessScopes,
    sanitizeCustomProcessScopeId,
    setHostPluginCustomProcessScopes,
    setHostSharedProcessScopes,
} from "../utils/privilegedProcessScopeRegistry";
import {getPluginTrustTier, summarizePrivilegedRuntime} from "../utils/pluginTrustTier";
import {buildCapabilityDeclarationSummary, extractCapabilityDeclarationComparison} from "../utils/pluginCapabilityDeclaration";

function buildHostPluginMessage(message, content = undefined) {
    const envelope = { message };
    if (content !== undefined) {
        envelope.content = content;
    }
    return {
        ...envelope,
        data: envelope,
    };
}

const pluginUiBridgeQueues = new Map();
const PLUGIN_UI_BRIDGE_TIMEOUT_MS = 15000;
const SDK_DIAGNOSTICS_HANDLER = "__sdk.getDiagnostics";
const SDK_PRIVILEGED_ACTION_HANDLER = "requestPrivilegedAction";

function buildPluginUiBridgeQueueKey(pluginId, pluginSessionId = "") {
    const normalizedPluginId = String(pluginId || "").trim() || "__unknown_plugin__";
    const normalizedSessionId = String(pluginSessionId || "").trim();
    return normalizedSessionId ? `${normalizedPluginId}::${normalizedSessionId}` : normalizedPluginId;
}

function enqueuePluginUiBridge(pluginId, pluginSessionId, task) {
    const key = buildPluginUiBridgeQueueKey(pluginId, pluginSessionId);
    const previous = pluginUiBridgeQueues.get(key) || Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(() => task());
    pluginUiBridgeQueues.set(key, next.finally(() => {
        if (pluginUiBridgeQueues.get(key) === next) {
            pluginUiBridgeQueues.delete(key);
        }
    }));
    return next;
}

function getPluginRuntimeSessionId(pluginId, loadedPlugin = null) {
    if (loadedPlugin && typeof loadedPlugin?.sessionId === "string" && loadedPlugin.sessionId.trim()) {
        return loadedPlugin.sessionId.trim();
    }
    if (typeof PluginManager.getLoadedPluginSessionId === "function") {
        return String(PluginManager.getLoadedPluginSessionId(pluginId) || "").trim();
    }
    return "";
}

function normalizePluginUiBridgeResponse(response, { handlerName = "" } = {}) {
    if (response === undefined || response === null) {
        return {
            ok: false,
            error: `Plugin backend handler "${handlerName || "unknown"}" returned no response.`,
            code: "PLUGIN_BACKEND_EMPTY_RESPONSE",
        };
    }

    if (typeof response !== "object") {
        return response;
    }

    if (Object.prototype.hasOwnProperty.call(response, "ok")) {
        return response;
    }

    if (typeof response.error === "string" && response.error.trim()) {
        return {
            ok: false,
            code: response.code || "PLUGIN_BACKEND_ERROR",
            ...response,
        };
    }

    return response;
}

function sanitizeScopePolicy(policy = {}) {
    return {
        scope: typeof policy.scope === "string" ? policy.scope : "",
        kind: typeof policy.kind === "string" ? policy.kind : "",
        title: typeof policy.title === "string" ? policy.title : "",
        category: typeof policy.category === "string" ? policy.category : "",
        description: typeof policy.description === "string" ? policy.description : "",
        fallback: policy.fallback === true,
        userDefined: policy.userDefined === true,
        shared: policy.shared === true,
        ownerType: typeof policy.ownerType === "string" ? policy.ownerType : "",
        ownerPluginId: typeof policy.ownerPluginId === "string" ? policy.ownerPluginId : "",
        requireConfirmation: policy.requireConfirmation === true,
        allowedRoots: Array.isArray(policy.allowedRoots) ? [...policy.allowedRoots] : undefined,
        allowedOperationTypes: Array.isArray(policy.allowedOperationTypes) ? [...policy.allowedOperationTypes] : undefined,
        allowedExecutables: Array.isArray(policy.allowedExecutables) ? [...policy.allowedExecutables] : undefined,
        allowedCwdRoots: Array.isArray(policy.allowedCwdRoots) ? [...policy.allowedCwdRoots] : undefined,
        allowedEnvKeys: Array.isArray(policy.allowedEnvKeys) ? [...policy.allowedEnvKeys] : undefined,
        timeoutCeilingMs: Number.isFinite(policy.timeoutCeilingMs) ? Number(policy.timeoutCeilingMs) : undefined,
    };
}

function formatPrivilegedAuditEventText(event = {}) {
    const isoTs = typeof event?.timestamp === "string" && event.timestamp.trim() ? event.timestamp : "unknown-ts";
    const parts = [`- [${isoTs}] action=${event?.action || "unknown"}`];
    if (event?.success === true) parts.push("outcome=success");
    else if (event?.success === false) parts.push("outcome=failure");
    if (event?.scope) parts.push(`scope=${event.scope}`);
    if (event?.confirmationDecision) parts.push(`approval=${event.confirmationDecision}`);
    if (event?.workflowId) parts.push(`workflowId=${event.workflowId}`);
    if (event?.workflowStatus) parts.push(`workflowStatus=${event.workflowStatus}`);
    if (event?.stepId) parts.push(`stepId=${event.stepId}`);
    if (event?.stepStatus) parts.push(`stepStatus=${event.stepStatus}`);
    if (event?.correlationId) parts.push(`correlationId=${event.correlationId}`);
    if (event?.stepCorrelationId) parts.push(`stepCorrelationId=${event.stepCorrelationId}`);
    if (event?.error?.code) parts.push(`code=${event.error.code}`);
    const lines = [parts.join(" | ")];
    if (event?.workflowTitle) lines.push(`  workflowTitle=${event.workflowTitle}`);
    if (event?.stepTitle) lines.push(`  stepTitle=${event.stepTitle}`);
    if (event?.command) {
        const args = Array.isArray(event?.args) ? event.args.join(" ") : "";
        lines.push(`  command=${[event.command, args].filter(Boolean).join(" ").trim()}`);
    }
    if (event?.cwd) lines.push(`  cwd=${event.cwd}`);
    if (event?.error?.message) lines.push(`  error=${event.error.message}`);
    return lines.join("\n");
}

async function postPluginUiMessageAndAwaitResult(child, pluginId, content, options = {}) {
    const handlerName = String(content?.handler || "").trim() || "unknown";
    const timeoutMs = Math.max(500, Math.min(60000, Number(options?.timeoutMs || PLUGIN_UI_BRIDGE_TIMEOUT_MS)));

    return new Promise((resolve) => {
        let settled = false;
        let timeoutHandle = null;

        const finish = (payload) => {
            if (settled) return;
            settled = true;
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            child.off("message", onMessage);
            resolve(payload);
        };

        const onMessage = (message) => {
            if (!message || message.type !== "UI_MESSAGE") {
                return;
            }
            finish(message.response);
        };

        child.on("message", onMessage);
        timeoutHandle = setTimeout(() => {
            finish({
                ok: false,
                error: `Timed out waiting for plugin backend handler "${handlerName}" response.`,
                code: "PLUGIN_BACKEND_TIMEOUT",
            });
        }, timeoutMs);

        try {
            child.postMessage(buildHostPluginMessage("UI_MESSAGE", content));
        } catch (error) {
            finish({
                ok: false,
                error: error?.message || String(error),
                code: "PLUGIN_BACKEND_DISPATCH_FAILED",
            });
        }
    });
}

async function fetchPluginBackendDiagnostics(child, pluginId) {
    try {
        return await postPluginUiMessageAndAwaitResult(child, pluginId, {
            handler: SDK_DIAGNOSTICS_HANDLER,
            content: {
                notificationsLimit: 5,
            },
        }, {
            timeoutMs: 2500,
        });
    } catch (_) {
        return null;
    }
}

function enrichEmptyPluginUiBridgeResponse(handlerName, diagnostics) {
    const registeredHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
    const lastErrorMessage = typeof diagnostics?.health?.lastErrorMessage === "string"
        ? diagnostics.health.lastErrorMessage.trim()
        : "";
    const pluginId = typeof diagnostics?.pluginId === "string" ? diagnostics.pluginId.trim() : "";

    if (registeredHandlers.length > 0 && !registeredHandlers.includes(handlerName)) {
        return {
            ok: false,
            error: `Plugin backend handler "${handlerName}" is not registered.${pluginId ? ` Plugin scope: ${pluginId}.` : ""} Registered handlers: ${registeredHandlers.join(", ")}.`,
            code: "PLUGIN_BACKEND_HANDLER_NOT_REGISTERED",
            details: {
                registeredHandlers,
                pluginId,
            },
        };
    }

    if (lastErrorMessage) {
        return {
            ok: false,
            error: `Plugin backend handler "${handlerName}" failed before returning a response. ${lastErrorMessage}`,
            code: "PLUGIN_BACKEND_HANDLER_FAILED",
            details: {
                pluginId,
                lastErrorMessage,
            },
        };
    }

    return {
        ok: false,
        error: `Plugin backend handler "${handlerName}" returned no response. Check that the handler is registered and returns the result of the SDK request helper.`,
        code: "PLUGIN_BACKEND_EMPTY_RESPONSE",
        details: {
            pluginId,
            registeredHandlers,
        },
    };
}

async function dispatchPluginUiMessageAndAwaitResult(pluginId, plugin, content, options = {}) {
    const handlerName = String(content?.handler || "").trim() || "unknown";
    const timeoutMs = Math.max(500, Math.min(60000, Number(options?.timeoutMs || PLUGIN_UI_BRIDGE_TIMEOUT_MS)));
    const child = plugin?.instance;
    const requestedSessionId = getPluginRuntimeSessionId(pluginId, plugin);

    if (!child || typeof child.postMessage !== "function") {
        return {
            ok: false,
            error: `Plugin "${pluginId}" backend bridge is unavailable.`,
            code: "PLUGIN_BACKEND_UNAVAILABLE",
        };
    }

    if (typeof child.on !== "function" || typeof child.off !== "function") {
        return {
            ok: false,
            error: `Plugin "${pluginId}" backend bridge does not support response waiting.`,
            code: "PLUGIN_BACKEND_UNSUPPORTED_BRIDGE",
        };
    }

    return enqueuePluginUiBridge(pluginId, requestedSessionId, async () => {
        console.info("[PLUGIN_UI_BRIDGE_REQUEST]", JSON.stringify({
            pluginId,
            sessionId: requestedSessionId,
            handler: handlerName,
            timeoutMs,
        }));

        const rawResponse = await postPluginUiMessageAndAwaitResult(child, pluginId, content, {timeoutMs});
        const activePlugin = PluginManager.getLoadedPlugin(pluginId);
        const activeSessionId = getPluginRuntimeSessionId(pluginId, activePlugin);
        if (activePlugin?.instance !== child || (requestedSessionId && activeSessionId !== requestedSessionId)) {
            console.warn("[PLUGIN_UI_BRIDGE_STALE_SESSION]", JSON.stringify({
                pluginId,
                requestedSessionId,
                activeSessionId,
                handler: handlerName,
            }));
            return {
                ok: false,
                error: `Plugin "${pluginId}" backend response was ignored because runtime session changed during request.`,
                code: "PLUGIN_BACKEND_STALE_SESSION",
                details: {
                    requestedSessionId,
                    activeSessionId,
                },
            };
        }
        let normalized = normalizePluginUiBridgeResponse(rawResponse, { handlerName });

        if (normalized?.code === "PLUGIN_BACKEND_EMPTY_RESPONSE" && handlerName !== SDK_DIAGNOSTICS_HANDLER) {
            const diagnostics = await fetchPluginBackendDiagnostics(child, pluginId);
            normalized = enrichEmptyPluginUiBridgeResponse(handlerName, diagnostics);
        }

        console.info("[PLUGIN_UI_BRIDGE_RESPONSE]", JSON.stringify({
            pluginId,
            sessionId: activeSessionId || requestedSessionId,
            handler: handlerName,
            ok: normalized?.ok,
            code: normalized?.code || "",
            correlationId: normalized?.correlationId || "",
        }));
        return normalized;
    });
}

export async function buildUsingEsbuild(virtualData) {
    const isDev = !app.isPackaged;
    
    // Construct the path to unpacked node_modules
    const nodePath = isDev 
        ? path.join(app.getAppPath(), "dist", "main", "node_modules")
        : path.join(process.resourcesPath, "app.asar.unpacked", "dist", "main", "node_modules");
    
    const esbuildBinary = path.join(nodePath, "@esbuild", process.platform + "-" + process.arch, "bin", "esbuild");
    
    // Packaged installs under locations like /opt may be root-owned, so chmod must stay best-effort.
    try {
        if (existsSync(esbuildBinary)) {
            const mode = statSync(esbuildBinary).mode & 0o777;
            if ((mode & 0o111) !== 0o111) {
                chmodSync(esbuildBinary, 0o755);
            }
        }
    } catch {
        // Packaging should have already fixed executable permissions.
    }

    // Ensure esbuild uses the correct binary
    process.env.ESBUILD_BINARY_PATH = esbuildBinary;
    process.env.NODE_PATH = nodePath;
    
    const srcJson = JSON.parse(virtualData["/package.json"])
    const pluginEntrypoint = srcJson.source || "index.ts"
    
    // Use Module._load to load esbuild from the unpacked directory
    // This bypasses the normal require() resolution and works with absolute paths
    const esbuildMainPath = path.join(nodePath, "esbuild", "lib", "main.js");
    const esbuild = Module._load(esbuildMainPath, module, false)
    return await esbuild.build({
        entryPoints: [`/${pluginEntrypoint}`],
        bundle: true,
        format: "cjs",
        platform: "node",
        write: false,
        external: ["@anikitenko/fdo-sdk"],
        plugins: [
            EsbuildVirtualFsPlugin(virtualData)
        ],
        tsconfigRaw: {
            compilerOptions: {
                target: "ES2022",
                module: "CommonJS",
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                useDefineForClassFields: false,
                strict: true
            }
        }
    });
}

async function getPluginLogTail(pluginId, options = {}) {
    const maxFiles = Math.max(1, Math.min(8, Number(options?.maxFiles || 4)));
    const maxChars = Math.max(1000, Math.min(40000, Number(options?.maxChars || 12000)));
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    const plugin = pluginORM.getPlugin(pluginId);

    if (!plugin?.id) {
        return {success: false, error: `Plugin "${pluginId}" not found`, pluginId, logs: [], combined: ""};
    }

    const userDataRoot = process.env.FDO_E2E_USER_DATA_DIR || app.getPath("userData");
    const logDir = path.join(userDataRoot, "plugin-data", pluginId, "logs");
    if (!existsSync(logDir)) {
        return {success: false, error: "No plugin runtime logs found", pluginId, logDir, logs: [], combined: ""};
    }

    const entries = await readdir(logDir, {withFileTypes: true});
    const fileStats = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(logDir, entry.name);
        try {
            const details = await stat(filePath);
            fileStats.push({
                filePath,
                fileName: entry.name,
                mtimeMs: details.mtimeMs || 0,
            });
        } catch (_) {
            // Ignore unreadable files and continue.
        }
    }

    const selectedFiles = fileStats
        .sort((a, b) => b.mtimeMs - a.mtimeMs || a.fileName.localeCompare(b.fileName))
        .slice(0, maxFiles);

    if (selectedFiles.length === 0) {
        return {success: false, error: "No plugin runtime logs found", pluginId, logDir, logs: [], combined: ""};
    }

    const logs = [];
    const combinedParts = [];
    const perFileBudget = Math.max(500, Math.floor(maxChars / selectedFiles.length));

    for (const file of selectedFiles) {
        try {
            const content = await readFile(file.filePath, "utf8");
            const tail = String(content || "").slice(-perFileBudget);
            logs.push({
                file: file.fileName,
                size: tail.length,
                tail,
            });
            combinedParts.push(`Log file: ${file.fileName}\n\`\`\`\n${tail}\n\`\`\``);
        } catch (error) {
            logs.push({
                file: file.fileName,
                size: 0,
                tail: "",
                error: error?.message || String(error),
            });
        }
    }

    return {
        success: true,
        pluginId,
        logDir,
        logs,
        combined: combinedParts.join("\n\n"),
    };
}

async function getPluginLogTrace(pluginId, options = {}) {
    const maxNotifications = Math.max(1, Math.min(20, Number(options?.maxNotifications || 8)));
    const maxLifecycleEvents = Math.max(5, Math.min(200, Number(options?.maxLifecycleEvents || 80)));
    const diagnostics = typeof PluginManager.getPluginDiagnostics === "function"
        ? await PluginManager.getPluginDiagnostics(pluginId, {refreshIfMissing: true, timeoutMs: 1800})
        : null;
    const capabilityIntent = diagnostics?.capabilities?.declaration || null;
    const capabilityIntentSummary = buildCapabilityDeclarationSummary(capabilityIntent || {});
    const runtimeStatus = {
        loading: !!PluginManager.loadingPlugins?.[pluginId],
        loaded: !!PluginManager.getLoadedPlugin(pluginId),
        ready: !!PluginManager.getLoadedPluginReady(pluginId),
        inited: !!PluginManager.getLoadedPluginInited(pluginId),
        lastUnload: PluginManager.lastUnloadByPlugin?.[pluginId] || null,
        capabilityIntent,
        capabilityIntentSummary,
    };
    const lifecycleEvents = typeof PluginManager.getPluginEventTrace === "function"
        ? PluginManager.getPluginEventTrace(pluginId, {limit: maxLifecycleEvents})
        : [];
    const privilegedAuditEvents = typeof PluginManager.getPrivilegedAuditTrail === "function"
        ? PluginManager.getPrivilegedAuditTrail(pluginId, {limit: 40})
        : [];
    const liveOutputTail = Array.isArray(PluginManager.pluginRuntimeOutputTail?.[pluginId])
        ? PluginManager.pluginRuntimeOutputTail[pluginId]
        : [];

    const tail = await getPluginLogTail(pluginId, options).catch((error) => ({
        success: false,
        error: error?.message || String(error),
        pluginId,
        logs: [],
        combined: "",
    }));

    const pluginToken = String(pluginId || "").toLowerCase();
    const relatedNotifications = NotificationCenter.getAllNotifications()
        .filter((item) => {
            const title = String(item?.title || "").toLowerCase();
            const message = String(item?.message || "").toLowerCase();
            return pluginToken && (title.includes(pluginToken) || message.includes(pluginToken));
        })
        .slice(-maxNotifications);

    const notificationText = relatedNotifications.length > 0
        ? relatedNotifications.map((item) => {
            return [
                `- [${item?.createdAt || ""}] ${item?.title || ""}`,
                String(item?.message || ""),
            ].join("\n");
        }).join("\n\n")
        : "No recent host notifications mentioning this plugin.";

    const runtimeText = [
        `Runtime status for "${pluginId}":`,
        `loading=${runtimeStatus.loading}; loaded=${runtimeStatus.loaded}; ready=${runtimeStatus.ready}; inited=${runtimeStatus.inited}`,
        runtimeStatus.lastUnload
            ? `lastUnload=${JSON.stringify(runtimeStatus.lastUnload)}`
            : "lastUnload=none",
        capabilityIntentSummary?.title
            ? `capabilityIntent=${capabilityIntentSummary.title}; declared=${capabilityIntent?.declared?.length || 0}; missingDeclared=${capabilityIntent?.missingDeclared?.length || 0}; undeclaredGranted=${capabilityIntent?.undeclaredGranted?.length || 0}`
            : "capabilityIntent=unavailable",
    ].join("\n");
    const lifecycleText = lifecycleEvents.length > 0
        ? lifecycleEvents.map((entry) => {
            const isoTs = Number.isFinite(entry?.ts) ? new Date(entry.ts).toISOString() : "unknown-ts";
            return `- [${isoTs}] ${entry?.event || "unknown"} ${JSON.stringify(entry?.details || {})}`;
        }).join("\n")
        : "No in-memory lifecycle trace available.";
    const liveOutputText = liveOutputTail.length > 0
        ? liveOutputTail.join("\n")
        : "No active runtime stdout/stderr tail available.";
    const privilegedAuditText = privilegedAuditEvents.length > 0
        ? privilegedAuditEvents.map((entry) => formatPrivilegedAuditEventText(entry)).join("\n\n")
        : "No in-memory privileged audit trail available.";

    const combined = [
        runtimeText,
        "",
        "Host lifecycle trace:",
        lifecycleText,
        "",
        "Privileged audit trail:",
        privilegedAuditText,
        "",
        "Live runtime output tail:",
        liveOutputText,
        "",
        "Related host notifications:",
        notificationText,
        "",
        "Plugin runtime logs:",
        tail?.combined || "No runtime log files found.",
    ].join("\n");

    return {
        success: true,
        pluginId,
        runtimeStatus,
        lifecycleEvents,
        privilegedAuditEvents,
        liveOutputTail,
        notifications: relatedNotifications,
        logTail: tail,
        combined,
    };
}

export function registerPluginHandlers() {
    const userORM = new UserORM(USER_CONFIG_FILE);
    const syncScopeRegistries = () => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const sharedProcessScopes = typeof userORM.getSharedProcessScopes === "function"
            ? userORM.getSharedProcessScopes()
            : [];
        const sharedFilesystemScopes = typeof userORM.getSharedFilesystemScopes === "function"
            ? userORM.getSharedFilesystemScopes()
            : (typeof userORM.getCustomFilesystemScopes === "function" ? userORM.getCustomFilesystemScopes() : []);
        setHostSharedProcessScopes(sharedProcessScopes);
        setHostSharedFilesystemScopes(sharedFilesystemScopes);
        for (const plugin of pluginORM.getAllPlugins()) {
            setHostPluginCustomProcessScopes(plugin.id, plugin.customProcessScopes || []);
            setHostPluginCustomFilesystemScopes(plugin.id, plugin.customFilesystemScopes || []);
        }
    };
    syncScopeRegistries();

    const emitPrivilegedAudit = (event) => {
        if (event?.pluginId) {
            PluginManager.recordPrivilegedAudit(event.pluginId, event);
        }
        console.info("[PLUGIN_PRIVILEGED_AUDIT]", JSON.stringify(event));
    };

    const handlePrivilegedAction = async (pluginId, loadedPlugin, payload = {}) => {
        const correlationId = typeof payload?.correlationId === "string" && payload.correlationId.trim()
            ? payload.correlationId.trim()
            : `priv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const request = payload?.request ?? payload;

        return executeHostPrivilegedAction(request, {
            pluginId,
            correlationId,
            grantedCapabilities: loadedPlugin?.grantedCapabilities || [],
            onAudit: emitPrivilegedAudit,
            approvalSessionStore: typeof PluginManager.getPrivilegedApprovalSession === "function"
                ? PluginManager.getPrivilegedApprovalSession(pluginId)
                : null,
            confirmPrivilegedAction: async ({title, message, detail, confirmLabel, cancelLabel, action}) => {
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
                        ? "Plugin requests reading host clipboard text"
                        : action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE
                            ? "Plugin requests writing host clipboard text"
                            : "Plugin requests a privileged host action";
                const result = await Promise.race([
                    dialog.showMessageBox({
                        type: "warning",
                        title: title || defaultTitle,
                        message: message || defaultMessage,
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
        });
    };

    ipcMain.handle(PluginChannels.GET_DATA, async (event, pluginPath) => {
        try {
            if (process.env.FDO_E2E === "1" && typeof pluginPath === "string" && pluginPath.startsWith("/tmp/e2e-")) {
                const fixtureName = path.basename(pluginPath);
                const content = [
                    {
                        path: "/index.ts",
                        content: `export const hello = "${fixtureName}";\n`,
                    },
                    {
                        path: "/render.tsx",
                        content: "export const render = () => null;\n",
                    },
                    {
                        path: "/package.json",
                        content: JSON.stringify({
                            name: fixtureName,
                            version: "1.0.0",
                            source: "index.ts",
                            main: "dist/index.cjs",
                        }, null, 2),
                    },
                ];
                return {
                    success: true,
                    content,
                    metadata: null,
                    entryPoint: "dist/index.cjs",
                };
            }

            const ig = await getIgnoreInstance(pluginPath, []);

            const existingFiles = await getAllFilesWithIgnorance(pluginPath, (relativePath) => {
                return !ig.ignores(relativePath);
            });
            let metadata;
            let sourceFile = "index.ts";
            let entryPoint = "dist/index.cjs";
            const content = await Promise.all(
                existingFiles.map(async (filePath) => {
                    const relPath = `/${path.relative(pluginPath, filePath).replace(/\\/g, "/")}`;
                    const buffer = await readFile(filePath);
                    const text = buffer.toString("utf8");

                    if (relPath === "/package.json") {
                        try {
                            const json = JSON.parse(text);
                            sourceFile = json.source || "index.ts";
                            entryPoint = json.module || json.main || "dist/index.cjs"
                        } catch (err) {
                            return {success: false, error: `Invalid package.json: ${err}`};
                        }
                    }

                    return {
                        path: relPath,
                        content: text,
                    };
                })
            );

            const source = content.find(file => file.path === `/${sourceFile}`);
            if (source) {
                const match = await extractMetadata(source.content);
                if (match) {
                    metadata = {
                        name: match.name,
                        version: match.version,
                        author: match.author,
                        description: match.description,
                        icon: match.icon,
                    };
                }
            } else {
                return {success: false, error: "No source file found"};
            }

            return {success: true, content, metadata, entryPoint};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.SAVE, async (event, data) => {
        const {name, content, metadata, entrypoint} = data;
        const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : [];
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const pluginName = generatePluginName(name)
            const pluginPath = path.join(PLUGINS_DIR, uuidv4());
            if (!pluginORM.isInstalled(pluginName)) {
                await syncPluginDir(pluginPath, content)
                const result = await ValidatePlugin(pluginPath);
                if (!result) {
                    rmSync(pluginPath, {recursive: true, force: true})
                }
                pluginORM.addPlugin(pluginName, metadata, pluginPath, entrypoint, false, capabilities)

                PluginManager.sendToMainWindow(PluginChannels.on_off.DEPLOY_FROM_EDITOR, pluginName)

                return { success: true }
            } else {
                return {success: false, error: "Plugin already installed!"};
            }
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.REMOVE, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugin = pluginORM.getPlugin(id)
            rmSync(plugin.home, {recursive: true, force: true})
            pluginORM.removePlugin(plugin.id)
            removeHostPluginCustomProcessScopes(plugin.id)
            removeHostPluginCustomFilesystemScopes(plugin.id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET_ALL, async () => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugins = pluginORM.getAllPlugins();
            return {success: true, plugins: plugins};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugin = pluginORM.getPlugin(id);
            return {success: true, plugin: plugin};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET_SCOPE_POLICIES, async (_event, pluginId = "") => {
        try {
            return {
                success: true,
                scopes: [
                    ...Object.values(getAllHostFilesystemScopePolicies({pluginId}) || {}).map((policy) => sanitizeScopePolicy(policy)),
                    ...Object.values(getAllHostProcessScopePolicies({pluginId}) || {}).map((policy) => sanitizeScopePolicy(policy)),
                ].filter((policy) => policy.scope),
            };
        } catch (error) {
            return {success: false, error: error.message, scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_SHARED_PROCESS_SCOPES, async () => {
        try {
            const scopes = userORM.getSharedProcessScopes().map((scope) => sanitizeScopePolicy(normalizeCustomProcessScope(scope, {shared: true})));
            setHostSharedProcessScopes(scopes);
            return {success: true, scopes};
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.UPSERT_SHARED_PROCESS_SCOPE, async (_event, scope) => {
        try {
            const existing = userORM.getSharedProcessScopes();
            const normalized = normalizeCustomProcessScope(scope, {shared: true});
            const nextScopes = [
                ...existing.filter((item) => sanitizeCustomProcessScopeId(String(item?.scope || "").trim()) !== normalized.scope),
                normalized,
            ].sort((left, right) => String(left?.scope || "").localeCompare(String(right?.scope || "")));
            userORM.setSharedProcessScopes(nextScopes);
            setHostSharedProcessScopes(nextScopes);
            return {
                success: true,
                scope: sanitizeScopePolicy(normalized),
                scopes: getHostSharedProcessScopes().map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.DELETE_SHARED_PROCESS_SCOPE, async (_event, scopeId) => {
        try {
            const normalizedScopeId = sanitizeCustomProcessScopeId(scopeId);
            if (!normalizedScopeId) {
                return {success: false, error: "Custom process scope id is required.", scopes: []};
            }
            const nextScopes = userORM.getSharedProcessScopes()
                .filter((item) => sanitizeCustomProcessScopeId(String(item?.scope || "").trim()) !== normalizedScopeId);
            userORM.setSharedProcessScopes(nextScopes);
            setHostSharedProcessScopes(nextScopes);
            return {
                success: true,
                scopes: getHostSharedProcessScopes().map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_SHARED_FILESYSTEM_SCOPES, async () => {
        try {
            const scopes = userORM.getSharedFilesystemScopes().map((scope) => sanitizeScopePolicy(normalizeCustomFilesystemScope(scope, {shared: true})));
            setHostSharedFilesystemScopes(scopes);
            return {success: true, scopes};
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.UPSERT_SHARED_FILESYSTEM_SCOPE, async (_event, scope) => {
        try {
            const existing = userORM.getSharedFilesystemScopes();
            const normalized = normalizeCustomFilesystemScope(scope, {shared: true});
            const nextScopes = [
                ...existing.filter((item) => sanitizeCustomFilesystemScopeId(String(item?.scope || "").trim()) !== normalized.scope),
                normalized,
            ].sort((left, right) => String(left?.scope || "").localeCompare(String(right?.scope || "")));
            userORM.setSharedFilesystemScopes(nextScopes);
            setHostSharedFilesystemScopes(nextScopes);
            return {
                success: true,
                scope: sanitizeScopePolicy(normalized),
                scopes: getHostSharedFilesystemScopes().map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.DELETE_SHARED_FILESYSTEM_SCOPE, async (_event, scopeId) => {
        try {
            const normalizedScopeId = sanitizeCustomFilesystemScopeId(scopeId);
            if (!normalizedScopeId) {
                return {success: false, error: "Custom filesystem scope id is required.", scopes: []};
            }
            const nextScopes = userORM.getSharedFilesystemScopes()
                .filter((item) => sanitizeCustomFilesystemScopeId(String(item?.scope || "").trim()) !== normalizedScopeId);
            userORM.setSharedFilesystemScopes(nextScopes);
            setHostSharedFilesystemScopes(nextScopes);
            return {
                success: true,
                scopes: getHostSharedFilesystemScopes().map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_PLUGIN_CUSTOM_PROCESS_SCOPES, async (_event, pluginId = "") => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const scopes = pluginORM.getPluginCustomProcessScopes(pluginId)
                .map((scope) => sanitizeScopePolicy(normalizeCustomProcessScope(scope, {pluginId})));
            setHostPluginCustomProcessScopes(pluginId, scopes);
            return {success: true, scopes};
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.UPSERT_PLUGIN_CUSTOM_PROCESS_SCOPE, async (_event, pluginId = "", scope) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const existing = pluginORM.getPluginCustomProcessScopes(pluginId);
            const normalized = normalizeCustomProcessScope(scope, {pluginId});
            const nextScopes = [
                ...existing.filter((item) => sanitizeCustomProcessScopeId(String(item?.scope || "").trim()) !== normalized.scope),
                normalized,
            ].sort((left, right) => String(left?.scope || "").localeCompare(String(right?.scope || "")));
            const result = pluginORM.setPluginCustomProcessScopes(pluginId, nextScopes);
            if (!result.success) {
                return {success: false, error: result.error, scopes: []};
            }
            setHostPluginCustomProcessScopes(pluginId, nextScopes);
            return {
                success: true,
                scope: sanitizeScopePolicy(normalized),
                scopes: getHostPluginCustomProcessScopes(pluginId).map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.DELETE_PLUGIN_CUSTOM_PROCESS_SCOPE, async (_event, pluginId = "", scopeId) => {
        try {
            const normalizedScopeId = sanitizeCustomProcessScopeId(scopeId);
            if (!normalizedScopeId) {
                return {success: false, error: "Custom process scope id is required.", scopes: []};
            }
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const nextScopes = pluginORM.getPluginCustomProcessScopes(pluginId)
                .filter((item) => sanitizeCustomProcessScopeId(String(item?.scope || "").trim()) !== normalizedScopeId);
            const result = pluginORM.setPluginCustomProcessScopes(pluginId, nextScopes);
            if (!result.success) {
                return {success: false, error: result.error, scopes: []};
            }
            setHostPluginCustomProcessScopes(pluginId, nextScopes);
            return {
                success: true,
                scopes: getHostPluginCustomProcessScopes(pluginId).map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_PLUGIN_CUSTOM_FILESYSTEM_SCOPES, async (_event, pluginId = "") => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const scopes = pluginORM.getPluginCustomFilesystemScopes(pluginId)
                .map((scope) => sanitizeScopePolicy(normalizeCustomFilesystemScope(scope, {pluginId})));
            setHostPluginCustomFilesystemScopes(pluginId, scopes);
            return {success: true, scopes};
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.UPSERT_PLUGIN_CUSTOM_FILESYSTEM_SCOPE, async (_event, pluginId = "", scope) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const existing = pluginORM.getPluginCustomFilesystemScopes(pluginId);
            const normalized = normalizeCustomFilesystemScope(scope, {pluginId});
            const nextScopes = [
                ...existing.filter((item) => sanitizeCustomFilesystemScopeId(String(item?.scope || "").trim()) !== normalized.scope),
                normalized,
            ].sort((left, right) => String(left?.scope || "").localeCompare(String(right?.scope || "")));
            const result = pluginORM.setPluginCustomFilesystemScopes(pluginId, nextScopes);
            if (!result.success) {
                return {success: false, error: result.error, scopes: []};
            }
            setHostPluginCustomFilesystemScopes(pluginId, nextScopes);
            return {
                success: true,
                scope: sanitizeScopePolicy(normalized),
                scopes: getHostPluginCustomFilesystemScopes(pluginId).map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.DELETE_PLUGIN_CUSTOM_FILESYSTEM_SCOPE, async (_event, pluginId = "", scopeId) => {
        try {
            const normalizedScopeId = sanitizeCustomFilesystemScopeId(scopeId);
            if (!normalizedScopeId) {
                return {success: false, error: "Custom filesystem scope id is required.", scopes: []};
            }
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const nextScopes = pluginORM.getPluginCustomFilesystemScopes(pluginId)
                .filter((item) => sanitizeCustomFilesystemScopeId(String(item?.scope || "").trim()) !== normalizedScopeId);
            const result = pluginORM.setPluginCustomFilesystemScopes(pluginId, nextScopes);
            if (!result.success) {
                return {success: false, error: result.error, scopes: []};
            }
            setHostPluginCustomFilesystemScopes(pluginId, nextScopes);
            return {
                success: true,
                scopes: getHostPluginCustomFilesystemScopes(pluginId).map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_CUSTOM_PROCESS_SCOPES, async () => {
        try {
            const scopes = userORM.getSharedProcessScopes().map((scope) => sanitizeScopePolicy(normalizeCustomProcessScope(scope, {shared: true})));
            setHostSharedProcessScopes(scopes);
            return {success: true, scopes};
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });
    ipcMain.handle(PluginChannels.UPSERT_CUSTOM_PROCESS_SCOPE, async (_event, scope) => {
        try {
            const existing = userORM.getSharedProcessScopes();
            const normalized = normalizeCustomProcessScope(scope, {shared: true});
            const nextScopes = [
                ...existing.filter((item) => String(item?.scope || "").trim() !== normalized.scope),
                normalized,
            ].sort((left, right) => String(left?.scope || "").localeCompare(String(right?.scope || "")));
            userORM.setSharedProcessScopes(nextScopes);
            setHostSharedProcessScopes(nextScopes);
            return {
                success: true,
                scope: sanitizeScopePolicy(normalized),
                scopes: getHostSharedProcessScopes().map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });
    ipcMain.handle(PluginChannels.DELETE_CUSTOM_PROCESS_SCOPE, async (_event, scopeId) => {
        try {
            const normalizedScopeId = sanitizeCustomProcessScopeId(scopeId);
            if (!normalizedScopeId) {
                return {success: false, error: "Custom process scope id is required.", scopes: []};
            }
            const nextScopes = userORM.getSharedProcessScopes()
                .filter((item) => String(item?.scope || "").trim() !== normalizedScopeId);
            userORM.setSharedProcessScopes(nextScopes);
            setHostSharedProcessScopes(nextScopes);
            return {
                success: true,
                scopes: getHostSharedProcessScopes().map((item) => sanitizeScopePolicy(item)),
            };
        } catch (error) {
            return {success: false, error: error?.message || String(error), scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_RUNTIME_STATUS, async (event, ids = []) => {
        try {
            if (typeof PluginManager.pruneStaleLoadingPlugins === "function") {
                PluginManager.pruneStaleLoadingPlugins(15000);
            }
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const requestedIds = Array.isArray(ids) ? ids : [];
            const statuses = await Promise.all(requestedIds.map(async (id) => {
                const diagnostics = typeof PluginManager.getPluginDiagnostics === "function"
                    ? await PluginManager.getPluginDiagnostics(id, {refreshIfMissing: true, timeoutMs: 1800})
                    : null;
                const persistedPlugin = pluginORM.getPlugin(id);
                const persistedCapabilities = Array.isArray(persistedPlugin?.capabilities)
                    ? persistedPlugin.capabilities
                    : [];
                const loadedPluginCapabilities = Array.isArray(PluginManager.getLoadedPlugin(id)?.grantedCapabilities)
                    ? PluginManager.getLoadedPlugin(id).grantedCapabilities
                    : null;
                const currentGrantedCapabilities = loadedPluginCapabilities ?? persistedCapabilities;
                const capabilityIntent = extractCapabilityDeclarationComparison(diagnostics, currentGrantedCapabilities);
                return {
                    id,
                    loading: !!PluginManager.loadingPlugins?.[id] && !PluginManager.getLoadedPluginReady(id) && !PluginManager.getLoadedPluginInited(id),
                    loaded: !!PluginManager.getLoadedPlugin(id),
                    ready: !!PluginManager.getLoadedPluginReady(id),
                    inited: !!PluginManager.getLoadedPluginInited(id),
                    diagnosticsLastError: typeof diagnostics?.health?.lastErrorMessage === "string"
                        ? diagnostics.health.lastErrorMessage
                        : "",
                    lastUnload: PluginManager.lastUnloadByPlugin?.[id] || null,
                    trustTier: getPluginTrustTier(currentGrantedCapabilities),
                    privilegedAuditCount: typeof PluginManager.getPrivilegedAuditTrail === "function"
                        ? PluginManager.getPrivilegedAuditTrail(id, {limit: 200}).length
                        : 0,
                    lastPrivilegedAudit: typeof PluginManager.getPrivilegedAuditTrail === "function"
                        ? (PluginManager.getPrivilegedAuditTrail(id, {limit: 1})[0] || null)
                        : null,
                    diagnosticsSummary: typeof PluginManager.getPrivilegedAuditTrail === "function"
                        ? summarizePrivilegedRuntime(PluginManager.getPrivilegedAuditTrail(id, {limit: 80}))
                        : summarizePrivilegedRuntime([]),
                    capabilityIntent,
                    capabilityIntentSummary: buildCapabilityDeclarationSummary(capabilityIntent || {}),
                };
            }));
            return { success: true, statuses };
        } catch (error) {
            return { success: false, error: error.message, statuses: [] };
        }
    });

    ipcMain.handle(PluginChannels.GET_PRIVILEGED_AUDIT, async (_event, id, options = {}) => {
        try {
            const events = typeof PluginManager.getPrivilegedAuditTrail === "function"
                ? PluginManager.getPrivilegedAuditTrail(id, options)
                : [];
            return {
                success: true,
                pluginId: id,
                events,
            };
        } catch (error) {
            return {
                success: false,
                pluginId: id,
                error: error?.message || String(error),
                events: [],
            };
        }
    });

    ipcMain.handle(PluginChannels.ACTIVATE, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            const result = await PluginManager.loadPlugin(id)
            if (!result.success) {
                return {success: false, error: result.error};
            }
            userORM.activatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.error};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.unLoadPlugin(id, {force: true, reason: "manual_unload"})
            userORM.deactivatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE_USERS, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        userORM.deactivatePlugin(id)
        return {success: true};
    });

    ipcMain.handle(PluginChannels.GET_ACTIVATED, async () => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            const plugins = userORM.getActivatedPlugins()
            return {success: true, plugins: plugins};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE_ALL, async () => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.unLoadPlugins()
            userORM.deactivateAllPlugins()
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.INIT, async (event, id) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (!plugin) {
            return {success: false, error: `Plugin "${id}" is not loaded`};
        }
        if (!plugin.ready) {
            return {success: false, error: `Plugin "${id}" is not ready`};
        }
        // Idempotent init: avoid duplicate init/render cascades when multiple
        // renderer paths request init during startup reconciliation.
        if (plugin.inited) {
            return {success: true, alreadyInited: true};
        }
        if (plugin.initRequested) {
            return {success: true, initInFlight: true};
        }
        plugin.initRequested = true;
        try {
            plugin.instance.postMessage(buildHostPluginMessage("PLUGIN_INIT", {
                ...buildPluginInitPayload(plugin.grantedCapabilities || resolveHostGrantedCapabilities()),
            }))
            return {success: true};
        } catch (error) {
            plugin.initRequested = false;
            return {success: false, error: error?.message || String(error)};
        }
    })

    ipcMain.handle(PluginChannels.RENDER, async (event, id) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (!plugin) {
            console.warn("[PLUGIN_RENDER_REQUEST_REJECTED]", JSON.stringify({
                pluginId: id,
                reason: "not_loaded",
            }));
            return {success: false, error: `Plugin "${id}" is not loaded`};
        }
        if (!plugin.ready) {
            console.warn("[PLUGIN_RENDER_REQUEST_REJECTED]", JSON.stringify({
                pluginId: id,
                reason: "not_ready",
                sessionId: getPluginRuntimeSessionId(id, plugin),
            }));
            return {success: false, error: `Plugin "${id}" is not ready`};
        }
        console.info("[PLUGIN_RENDER_REQUEST]", JSON.stringify({
            pluginId: id,
            sessionId: getPluginRuntimeSessionId(id, plugin),
        }));
        plugin.instance.postMessage(buildHostPluginMessage("PLUGIN_RENDER"))
        return {success: true};
    })

    ipcMain.handle(PluginChannels.UI_MESSAGE, async (event, id, content) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (!plugin) {
            return {success: false, error: `Plugin "${id}" is not loaded`};
        }
        if (!plugin.ready) {
            return {success: false, error: `Plugin "${id}" is not ready`};
        }
        const sessionId = getPluginRuntimeSessionId(id, plugin);
        console.info("[PLUGIN_UI_MESSAGE_RESOLVE]", JSON.stringify({
            pluginId: id,
            sessionId,
            handler: String(content?.handler || "").trim(),
        }));
        if (content?.handler === HOST_PRIVILEGED_HANDLER || content?.handler === SDK_PRIVILEGED_ACTION_HANDLER) {
            try {
                const response = await handlePrivilegedAction(id, plugin, content?.content || {});
                console.info("[PLUGIN_UI_BRIDGE_PRIVILEGED_RESULT]", JSON.stringify({
                    pluginId: id,
                    sessionId,
                    handler: content?.handler || HOST_PRIVILEGED_HANDLER,
                    ok: response?.ok,
                    code: response?.code || "",
                    correlationId: response?.correlationId || "",
                }));
                return response;
            } catch (error) {
                const correlationId = typeof content?.content?.correlationId === "string"
                    ? content.content.correlationId
                    : `priv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                const failure = {
                    ok: false,
                    correlationId,
                    error: error?.message || String(error),
                    code: error?.code || "HOST_ACTION_FAILED",
                };
                console.warn("[PLUGIN_UI_BRIDGE_PRIVILEGED_ERROR]", JSON.stringify({
                    pluginId: id,
                    sessionId,
                    handler: content?.handler || HOST_PRIVILEGED_HANDLER,
                    code: failure.code,
                    correlationId: failure.correlationId,
                    error: failure.error,
                }));
                return failure;
            }
        }
        return await dispatchPluginUiMessageAndAwaitResult(id, plugin, content);
    })

    ipcMain.handle(PluginChannels.BUILD, async (event, data) => {
        try {
            const result = await buildUsingEsbuild(data.latestContent)
            return {success: true, files: result}
        } catch (error) {
            NotificationCenter.addNotification({title: `Build error`, message: error.toString(), type: "danger"});
            return {success: false, error: "Build error: "+error.toString()};
        }
    });

    ipcMain.handle(PluginChannels.RUN_TESTS, async (event, data) => {
        try {
            return await runPluginWorkspaceTests(data?.latestContent || {});
        } catch (error) {
            NotificationCenter.addNotification({title: `Test error`, message: error.toString(), type: "danger"});
            return {success: false, error: `Test error: ${error.toString()}`, output: ""};
        }
    });

    ipcMain.handle(PluginChannels.DEPLOY_FROM_EDITOR, async (event, data) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const userORM = new UserORM(USER_CONFIG_FILE);
            const plugin = pluginORM.getPlugin(data.name);
            let pathToDir = path.join(PLUGINS_DIR, `${data.name}_${data.sandbox}`)
            if (plugin) {
                pathToDir = plugin.home
            }
            const pathToPlugin = path.join(pathToDir, data.entrypoint)
            const metadata = normalizeAndValidatePluginMetadata(data.metadata)

            await ensureAndWrite(pathToPlugin, data.content)
            const signResult = Certs.signPlugin(pathToDir, data.rootCert)
            if (!signResult.success) {
                return signResult
            }
            const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : (plugin?.capabilities || []);
            pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true, capabilities)
            const shouldReload = !!PluginManager.getLoadedPlugin(data.name) || userORM.getActivatedPlugins().includes(data.name);
            if (shouldReload) {
                PluginManager.unLoadPlugin(data.name, {force: true});
                const reloadResult = await PluginManager.loadPlugin(data.name);
                if (!reloadResult?.success) {
                    return {success: false, error: reloadResult?.error || `Failed to reload plugin "${data.name}" after deploy.`};
                }
            }

            const mainWindow = PluginManager.mainWindow
            if (mainWindow) {
                mainWindow.focus()
            }
            mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
            return {success: true}
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.SAVE_FROM_EDITOR, async (event, data) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const plugin = pluginORM.getPlugin(data.name);
            let pathToDir;
            if (data.dir === "sandbox" || data.dir.includes(data.sandbox) || !plugin) {
                pathToDir = path.join(PLUGINS_DIR, data.name)
            } else {
                pathToDir = plugin.home
            }

            await syncPluginDir(pathToDir, data.content)

            const signResult = Certs.signPlugin(pathToDir, data.rootCert)
            if (!signResult.success) {
                return signResult
            }

            const metadata = normalizeAndValidatePluginMetadata(data.metadata)
            const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : (plugin?.capabilities || []);
            pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true, capabilities)

            if (data.dir.includes(data.sandbox)) {
                rmSync(data.dir, {recursive: true, force: true})
                const mainWindow = PluginManager.mainWindow
                mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
            }

            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (senderWindow && !senderWindow.isDestroyed()) {
                senderWindow.destroy();
            } else {
                const editorWindowInstance = editorWindow.getWindow();
                if (editorWindowInstance && !editorWindowInstance.isDestroyed()) {
                    editorWindowInstance.destroy();
                }
            }

            return {success: true}
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.VERIFY_SIGNATURE, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)
        return Certs.verifyPlugin(plugin.home)
    })

    ipcMain.handle(PluginChannels.SIGN, async (event, id, signerLabel) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)
        return Certs.signPlugin(plugin.home, signerLabel)
    })

    ipcMain.handle(PluginChannels.EXPORT, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)

        const archive = archiver('zip', { zlib: { level: 9 } });
        const passThrough = new stream.PassThrough();
        const chunks = [];

        archive.on('error', err => {
            NotificationCenter.addNotification({title: `Export plugin error`, message: err.toString(), type: "danger"});
        });

        passThrough.on('data', chunk => chunks.push(chunk));

        archive.pipe(passThrough);

        const ig = await getIgnoreInstance(plugin.home, []);
        const existingFiles = await getAllFilesWithIgnorance(plugin.home, relativePath => !ig.ignores(relativePath));

        for (const absFile of existingFiles) {
            const relativePath = path.relative(plugin.home, absFile);
            archive.file(absFile, { name: relativePath });
        }

        await archive.finalize();

        return new Promise((resolve, reject) => {
            passThrough.on('end', () => resolve(Buffer.concat(chunks)));
            passThrough.on('error', reject);
            archive.on('error', reject);
        });
    })

    ipcMain.handle(PluginChannels.SET_CAPABILITIES, async (_event, id, capabilities = []) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const result = pluginORM.setPluginCapabilities(id, capabilities);
            if (!result.success) {
                return result;
            }
            const plugin = pluginORM.getPlugin(id);
            if (PluginManager.getLoadedPlugin(id)) {
                PluginManager.getLoadedPlugin(id).grantedCapabilities = Array.isArray(result.capabilities)
                    ? [...result.capabilities]
                    : [];
                if (typeof PluginManager.clearPrivilegedApprovalSession === "function") {
                    PluginManager.clearPrivilegedApprovalSession(id);
                }
                if (typeof PluginManager.clearPrivilegedAuditTrail === "function") {
                    PluginManager.clearPrivilegedAuditTrail(id);
                }
                if (typeof PluginManager.refreshPluginDiagnostics === "function") {
                    void PluginManager.refreshPluginDiagnostics(id, {timeoutMs: 1800});
                }
            }
            return {success: true, capabilities: result.capabilities, plugin};
        } catch (error) {
            return {success: false, error: error?.message || String(error)};
        }
    });

    ipcMain.handle(PluginChannels.GET_LOG_TAIL, async (_event, id, options = {}) => {
        try {
            return await getPluginLogTail(id, options);
        } catch (error) {
            return {success: false, error: error?.message || String(error), pluginId: id, logs: [], combined: ""};
        }
    });

    ipcMain.handle(PluginChannels.GET_LOG_TRACE, async (_event, id, options = {}) => {
        try {
            return await getPluginLogTrace(id, options);
        } catch (error) {
            return {success: false, error: error?.message || String(error), pluginId: id, combined: ""};
        }
    });
}
