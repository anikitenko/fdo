import {WORKER_LIVE_SOURCE} from '../../hostServices/workerLiveSource';
import {app} from "electron";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {buildRuntimeSecurityPolicy, normalizeCapabilityList} from "./pluginCapabilities";
import {HOST_PLUGIN_API_VERSION} from "../../sdk/pluginHostContract";

export {HOST_PLUGIN_API_VERSION} from "../../sdk/pluginHostContract";

function parseCapabilityList(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        return [];
    }
    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function resolveHostGrantedCapabilities(options = {}) {
    const envRequested = parseCapabilityList(options.envCapabilities ?? process.env.FDO_PLUGIN_CAPABILITIES);
    const pluginRequested = normalizeCapabilityList(options.pluginCapabilities);
    return normalizeCapabilityList(envRequested.length > 0 ? envRequested : pluginRequested);
}

export function buildPluginInitPayload(grantedCapabilities = resolveHostGrantedCapabilities()) {
    return {
        apiVersion: HOST_PLUGIN_API_VERSION,
        // SDK 1.x validates a closed capability list. Host-only tray access is
        // enforced in the host and merged into SDK policy by our bootstrap.
        capabilities: grantedCapabilities.filter(capability => capability !== 'system.tray'),
    };
}

export function buildPluginRuntimeBootstrapSource() {
    return `"use strict";

const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
// Electron can expose a separate ASAR promises facade through fs.promises.
// Keep every public alias on the same guarded implementation.
Object.defineProperty(fs, 'promises', {get: () => fsPromises, configurable: false, enumerable: true});
const {fileURLToPath, URL: FileURL} = require("node:url");
let canonicalFs = fs;
if (process.versions.electron) canonicalFs = require('original-fs');
// Keep canonicalization independent of the public APIs patched below.
const policyFs = {
    existsSync: canonicalFs.existsSync.bind(canonicalFs),
    realpathSync: (canonicalFs.realpathSync.native || canonicalFs.realpathSync).bind(canonicalFs),
};
const hostBackendContext = new (require("node:async_hooks").AsyncLocalStorage)();

const runtimeEntry = process.env.FDO_PLUGIN_RUNTIME_ENTRY;
if (!runtimeEntry) {
    throw new Error("Missing FDO_PLUGIN_RUNTIME_ENTRY");
}

const pluginHome = process.env.PLUGIN_HOME ? path.resolve(process.env.PLUGIN_HOME) : "";
const ignoredStdin = process.env.FDO_PLUGIN_STDIN_IGNORED === '1';
const configuredReadRoots = process.env.FDO_PLUGIN_READ_ROOTS;
const readRoots = configuredReadRoots ? JSON.parse(configuredReadRoots) : [
    pluginHome, process.env.PLUGIN_CODE_HOME, path.dirname(runtimeEntry),
    ...(process.env.FDO_PLUGIN_NODE_PATH || process.env.NODE_PATH || '').split(path.delimiter),
].filter(Boolean);
if (!Array.isArray(readRoots) || !readRoots.length || readRoots.some(root =>
    typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root)) {
    throw new Error('Invalid plugin filesystem read policy.');
}
let runtimePolicy = { blockedModules: [] };
try {
    runtimePolicy = JSON.parse(process.env.FDO_PLUGIN_POLICY_JSON || "{}");
} catch (_) {
    runtimePolicy = { blockedModules: [] };
}
const blockedModules = new Set(Array.isArray(runtimePolicy.blockedModules) ? runtimePolicy.blockedModules : []);
const allowNetworkHttps = runtimePolicy?.networkAccess?.https === true;
const allowNetworkHttp = runtimePolicy?.networkAccess?.http === true;
const allowNetworkWebSocket = runtimePolicy?.networkAccess?.websocket === true;
const allowNetworkTcp = runtimePolicy?.networkAccess?.tcp === true;
const allowNetworkUdp = runtimePolicy?.networkAccess?.udp === true;
const allowNetworkDns = runtimePolicy?.networkAccess?.dns === true;
const allowedNetworkScopes = Array.isArray(runtimePolicy?.networkScopes) ? runtimePolicy.networkScopes : [];
const backendBridgePending = new Map();
const hostServicePending = new Map();
let hostServicesClosed = false;
const hostServiceCodes = new Set(['ACCESS_DENIED','UNAVAILABLE','LOCKED','TIMEOUT','CANCELLED','HOST_KEY_REJECTED','CONNECTION_FAILED','INVALID_REQUEST','BACKPRESSURE','SESSION_CLOSED','IDLE_TIMEOUT','SESSION_LIMIT','X11_UNSUPPORTED','X11_UNAVAILABLE','X11_AUTH_UNAVAILABLE','X11_FORWARDING_DENIED', 'NOT_FOUND', 'CONFLICT', 'SERVICE_ERROR']);
const hostServiceError = code => Object.assign(new Error('Host service request failed.'), {code: hostServiceCodes.has(code) ? code : 'UNAVAILABLE'});
const backendBridgeResponseType = "HOST_BACKEND_RESPONSE";
const backendBridgeRequestType = "HOST_BACKEND_REQUEST";
const backendPrivilegedActionHandler = "requestPrivilegedAction";

function normalizeBackendBridgeMessage(type, data) {
    if (type === "UI_MESSAGE" && data && typeof data === "object") {
        const nestedHandler = typeof data.handler === "string" && data.handler.trim()
            ? data.handler.trim()
            : backendPrivilegedActionHandler;
        return {
            handler: nestedHandler,
            content: Object.prototype.hasOwnProperty.call(data, "content") ? data.content : data,
        };
    }
    return {
        handler: typeof type === "string" && type.trim() ? type.trim() : backendPrivilegedActionHandler,
        content: data,
    };
}

let fallbackParentPort = null;
if (!process.parentPort && process.versions.electron) {
    try {
        const electron = require("electron");
        fallbackParentPort = electron?.parentPort || null;
    } catch (_) {
        fallbackParentPort = null;
    }
}
const allowMissingParentPort = process.env.FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT === "1";
let parentPort = process.parentPort || fallbackParentPort || null;
if (!parentPort || typeof parentPort.on !== "function" || typeof parentPort.postMessage !== "function") {
    if (!allowMissingParentPort) {
        throw new Error("Missing utility process parentPort bridge.");
    }
    parentPort = {
        on() {},
        postMessage() {},
    };
}
if (!process.parentPort && parentPort) {
    process.parentPort = parentPort;
}

parentPort.on('message', event => {
    const data = event && typeof event === 'object' && 'data' in event ? event.data : event;
    if (data?.message !== 'HOST_SERVICE_RESPONSE_V1') return;
    const pending = hostServicePending.get(data.content?.requestId);
    if (!pending) return;
    hostServicePending.delete(data.content.requestId); clearTimeout(pending.timer);
    if (data.content.error) pending.reject(hostServiceError(data.content.error));
    else pending.resolve(data.content.result);
});
function closeHostServiceTransport() {
    hostServicesClosed = true;
    for (const pending of hostServicePending.values()) {clearTimeout(pending.timer); pending.reject(hostServiceError('UNAVAILABLE'));}
    hostServicePending.clear();
}
parentPort.on('close', closeHostServiceTransport);
process.once('exit', closeHostServiceTransport);
// Service replies are private to the adapter, outside SDK lifecycle/UI dispatch
// and its diagnostics logger. Never send response bodies through that path.
const originalParentOn = parentPort.on.bind(parentPort);
originalParentOn('message', event => {
    const data = event && typeof event === 'object' && 'data' in event ? event.data : event;
    if (data?.message !== 'HOST_PLUGIN_HEARTBEAT_V1') return;
    const requestId = data.content?.requestId;
    if (typeof requestId !== 'string' || requestId.length > 80) return;
    try { parentPort.postMessage({type: 'HOST_PLUGIN_HEARTBEAT_REPLY_V1', requestId}); } catch {}
});
const wrappedParentListeners = new WeakMap();
const originalParentRemove = typeof (parentPort.off || parentPort.removeListener) === 'function'
    ? (parentPort.off || parentPort.removeListener).bind(parentPort) : () => parentPort;
parentPort.off = parentPort.removeListener = function(event, listener) {
    return originalParentRemove(event, wrappedParentListeners.get(listener) || listener);
};
parentPort.on = function(event, listener) {
    if (event !== 'message') return originalParentOn(event, listener);
    const wrapped = message => {
        const data = message && typeof message === 'object' && 'data' in message ? message.data : message;
        if (!['HOST_SERVICE_RESPONSE_V1', backendBridgeResponseType, 'HOST_STORAGE_SHUTDOWN_V1', 'HOST_PLUGIN_HEARTBEAT_V1', 'HOST_SHARED_INVOKE_V1', 'HOST_SHARED_CANCEL_V1'].includes(data?.message)) listener(message);
    };
    wrappedParentListeners.set(listener, wrapped);
    return originalParentOn(event, wrapped);
};

function requestHostService(request) {return sendHostServiceMessage({request});}
function sendHostServiceMessage(body) {
    if (hostServicesClosed || hostServicePending.size >= ((body.request?.action === 'plugins.shared' && ['cancel','unregister'].includes(body.request?.payload?.op)) ? 48 : ['terminal.close','terminal.cancel','terminal.eof'].includes(body.operation)?32:24)) return Promise.reject(hostServiceError('UNAVAILABLE'));
    return new Promise((resolve, reject) => {
        const requestId = require('node:crypto').randomUUID();
        const timer = setTimeout(() => {hostServicePending.delete(requestId); reject(hostServiceError('TIMEOUT'));}, body.operation==='terminal.open'?50000:body.operation==='terminal.result'?3700000:body.operation==='terminal.next'?310000:body.operation?.startsWith('terminal.')?25000:140000);
        hostServicePending.set(requestId, {resolve, reject, timer});
        try {parentPort.postMessage({type:'HOST_SERVICE_REQUEST_V1', requestId, ...body});}
        catch {clearTimeout(timer); hostServicePending.delete(requestId); reject(hostServiceError('UNAVAILABLE'));}
    });
}

${WORKER_LIVE_SOURCE}

originalParentOn("message", (message) => {
    const data = message && typeof message === "object" && "data" in message
        ? message.data
        : message;
    if (!data || typeof data !== "object" || data.message !== backendBridgeResponseType) {
        return;
    }
    const requestId = typeof data.content?.requestId === "string" ? data.content.requestId : "";
    if (!requestId || !backendBridgePending.has(requestId)) {
        return;
    }
    const pending = backendBridgePending.get(requestId);
    backendBridgePending.delete(requestId);
    if (pending?.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
    }
    if (data.content?.error) {
        pending?.reject(new Error(data.content.error));
        return;
    }
    pending?.resolve(data.content?.response);
});

const bridgeTarget = typeof globalThis.window === "object" && globalThis.window
    ? globalThis.window
    : globalThis;
if (!globalThis.window) {
    let legacyWindow=bridgeTarget;
    Object.defineProperty(globalThis,'window',{configurable:true,
        get:()=>hostBackendContext.getStore() ? undefined : legacyWindow,
        set:value=>{legacyWindow=value;}});
}
if (typeof bridgeTarget.createBackendReq !== "function") {
    bridgeTarget.createBackendReq = function createBackendReq(type, data) {
        return new Promise((resolve, reject) => {
            const requestId = "backend-ui-message-" + Date.now() + "-" + Math.random().toString(36).slice(2);
            const timeoutHandle = setTimeout(() => {
                backendBridgePending.delete(requestId);
                reject(new Error("Timed out waiting for backend host bridge response."));
            }, 30000);
            backendBridgePending.set(requestId, {resolve, reject, timeoutHandle});
            const normalizedMessage = normalizeBackendBridgeMessage(type, data);
            parentPort.postMessage({
                type: backendBridgeRequestType,
                requestId,
                message: normalizedMessage,
            });
        });
    };
}
const hostAiAssistantsListHandler = "fdo.ai.assistants.list.v1";
const hostAiRequestHandler = "fdo.ai.request.v1";
const hostAuthStartHandler = "fdo.auth.start.v1";
const hostAuthRefreshHandler = "fdo.auth.refresh.v1";
const hostAuthLogoutHandler = "fdo.auth.logout.v1";
const hostSessionRequestHandler = "fdo.session.request.v1";
const hostBrowserOpenHandler = "fdo.browser.open.v1";
function normalizeHostAiErrorPayload(response, fallbackCode) {
    if (!response || typeof response !== "object") {
        return {
            code: fallbackCode,
            error: "Host AI bridge returned an invalid response.",
            degraded: true,
        };
    }
    return {
        code: typeof response.code === "string" && response.code ? response.code : fallbackCode,
        error: typeof response.error === "string" && response.error ? response.error : "Host AI request failed.",
        degraded: response.degraded === true,
        details: response.details && typeof response.details === "object" ? response.details : {},
    };
}
function normalizeHostBrokerErrorPayload(response, fallbackCode, fallbackMessage) {
    if (!response || typeof response !== "object") {
        return {
            code: fallbackCode,
            error: fallbackMessage,
            details: {},
        };
    }
    return {
        code: typeof response.code === "string" && response.code ? response.code : fallbackCode,
        error: typeof response.error === "string" && response.error ? response.error : fallbackMessage,
        details: response.details && typeof response.details === "object" ? response.details : {},
        correlationId: typeof response.correlationId === "string" ? response.correlationId : "",
        status: typeof response.status === "number" ? response.status : undefined,
    };
}
async function callHostBroker(handler, content) {
    
    return await bridgeTarget.createBackendReq("UI_MESSAGE", {
        handler,
        content: content && typeof content === "object" ? content : {},
    });
}
function toHostBrokerErrorMessage(prefix, payload) {
    const normalized = normalizeHostBrokerErrorPayload(payload, "HOST_BROKER_FAILED", "Host broker request failed.");
    const correlationSuffix = normalized.correlationId ? " [correlationId=" + normalized.correlationId + "]" : "";
    const statusSuffix = typeof normalized.status === "number" ? " [status=" + normalized.status + "]" : "";
    return String(prefix || "Host broker failed") + " (" + normalized.code + "): " + normalized.error + statusSuffix + correlationSuffix;
}
if (typeof globalThis.__FDO_AI_LIST_ASSISTANTS !== "function") {
    globalThis.__FDO_AI_LIST_ASSISTANTS = async function __FDO_AI_LIST_ASSISTANTS(filters = {}) {
        try {
            const response = await bridgeTarget.createBackendReq("UI_MESSAGE", {
                handler: hostAiAssistantsListHandler,
                content: filters && typeof filters === "object" ? filters : {},
            });
            if (response && typeof response === "object" && response.ok === false) {
                return {
                    assistants: [],
                    ...normalizeHostAiErrorPayload(response, "AI_ASSISTANTS_LIST_FAILED"),
                };
            }
            const assistants = Array.isArray(response?.assistants) ? response.assistants : [];
            return {
                assistants,
            };
        } catch (error) {
            return {
                assistants: [],
                code: "AI_ASSISTANTS_LIST_FAILED",
                error: error?.message || String(error),
                degraded: true,
            };
        }
    };
}
if (typeof globalThis.__FDO_AI_REQUEST !== "function") {
    globalThis.__FDO_AI_REQUEST = async function __FDO_AI_REQUEST(payload = {}) {
        try {
            const response = await bridgeTarget.createBackendReq("UI_MESSAGE", {
                handler: hostAiRequestHandler,
                content: payload && typeof payload === "object" ? payload : {},
            });
            if (response && typeof response === "object" && response.ok === false) {
                return normalizeHostAiErrorPayload(response, "AI_REQUEST_FAILED");
            }
            return response && typeof response === "object"
                ? response
                : {
                    message: String(response || ""),
                };
        } catch (error) {
            return {
                code: "AI_REQUEST_FAILED",
                error: error?.message || String(error),
                degraded: true,
            };
        }
    };
}
if (!globalThis.__FDO_AUTH_BROKER || typeof globalThis.__FDO_AUTH_BROKER !== "object") {
    globalThis.__FDO_AUTH_BROKER = {
        start: async (payload = {}) => {
            const response = await callHostBroker(hostAuthStartHandler, payload);
            if (!response || response.ok === false) {
                throw new Error(toHostBrokerErrorMessage("Host auth start failed", response));
            }
            return response;
        },
        refresh: async (payload = {}) => {
            const response = await callHostBroker(hostAuthRefreshHandler, payload);
            if (!response || response.ok === false) {
                throw new Error(toHostBrokerErrorMessage("Host auth refresh failed", response));
            }
            return response;
        },
        logout: async (payload = {}) => {
            const response = await callHostBroker(hostAuthLogoutHandler, payload);
            if (!response || response.ok === false) {
                throw new Error(toHostBrokerErrorMessage("Host auth logout failed", response));
            }
            return response;
        },
    };
}
if (!globalThis.__FDO_SESSION_REQUEST || typeof globalThis.__FDO_SESSION_REQUEST !== "object") {
    globalThis.__FDO_SESSION_REQUEST = {
        request: async (payload = {}) => {
            const response = await callHostBroker(hostSessionRequestHandler, payload);
            if (!response || response.ok === false) {
                throw new Error(toHostBrokerErrorMessage("Host session request failed", response));
            }
            return response;
        },
    };
}
if (!globalThis.__FDO_BROWSER_BROKER || typeof globalThis.__FDO_BROWSER_BROKER !== "object") {
    globalThis.__FDO_BROWSER_BROKER = {
        open: async (payload = {}) => {
            const response = await callHostBroker(hostBrowserOpenHandler, payload);
            if (!response || response.ok === false) {
                throw new Error(toHostBrokerErrorMessage("Host browser open failed", response));
            }
            return response;
        },
    };
}
if (!globalThis.__FDO_OPEN_EXTERNAL || typeof globalThis.__FDO_OPEN_EXTERNAL !== "object") {
    globalThis.__FDO_OPEN_EXTERNAL = globalThis.__FDO_BROWSER_BROKER;
}

const hostNodePath = process.env.FDO_PLUGIN_NODE_PATH || process.env.NODE_PATH || "";
if (hostNodePath) {
    const entries = hostNodePath.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
    if (entries.length > 0) {
        process.env.NODE_PATH = entries.join(path.delimiter);
        Module._initPaths();
        for (const entry of entries) {
            if (!Module.globalPaths.includes(entry)) {
                Module.globalPaths.unshift(entry);
            }
        }
    }
}

function deny(message) {
    const error = new Error(message);
    error.code = "FDO_PLUGIN_PERMISSION_DENIED";
    throw error;
}

function denyInternalBinding(name) {
    deny(\`[host-policy] Internal Node binding access denied for "\${String(name || "")}".\`);
}

function denyNetworkAccess(apiName, requiredCapability = "") {
    const suffix = requiredCapability
        ? \` Grant "system.network" and "\${requiredCapability}" to allow this transport.\`
        : ' Grant "system.network" and the matching transport capability to allow this operation.';
    deny(\`[host-policy] Network access denied for "\${apiName}".\${suffix}\`);
}

function parseUrlProtocol(input, fallbackBase = "http://127.0.0.1/") {
    try {
        return new URL(String(input || ""), fallbackBase).protocol;
    } catch (_) {
        return "";
    }
}

function normalizeStringList(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean))];
}

function hostnameMatchesPattern(hostname, pattern) {
    const normalizedHostname = String(hostname || "").trim().toLowerCase();
    const normalizedPattern = String(pattern || "").trim().toLowerCase();
    if (!normalizedHostname || !normalizedPattern) {
        return false;
    }
    if (normalizedPattern === "*") {
        return true;
    }
    if (normalizedPattern.startsWith("*.")) {
        const suffix = normalizedPattern.slice(1);
        return normalizedHostname.endsWith(suffix) && normalizedHostname !== suffix.slice(1);
    }
    return normalizedHostname === normalizedPattern;
}

function portMatches(port, allowedPorts) {
    const normalizedAllowedPorts = normalizeStringList(allowedPorts);
    if (normalizedAllowedPorts.includes("*")) {
        return true;
    }
    const normalizedPort = port == null || port === ""
        ? ""
        : String(Number(port) || "").trim();
    return normalizedPort ? normalizedAllowedPorts.includes(normalizedPort) : false;
}

function isNetworkTargetAllowed(target, scopePolicies) {
    const transport = String(target?.transport || "").trim().toLowerCase();
    const scheme = String(target?.scheme || "").trim().toLowerCase();
    const hostname = String(target?.hostname || "").trim().toLowerCase();
    const port = target?.port;
    if (!transport || !hostname) {
        return false;
    }

    return (Array.isArray(scopePolicies) ? scopePolicies : []).some((policy) => {
        const allowedTransports = normalizeStringList(policy?.allowedTransports).map((value) => value.toLowerCase());
        const allowedSchemes = normalizeStringList(policy?.allowedSchemes).map((value) => value.toLowerCase());
        const allowedHostPatterns = normalizeStringList(policy?.allowedHostPatterns);
        const allowedPorts = normalizeStringList(policy?.allowedPorts);

        if (allowedTransports.length > 0 && !allowedTransports.includes(transport)) {
            return false;
        }
        if (scheme && allowedSchemes.length > 0 && !allowedSchemes.includes(scheme)) {
            return false;
        }
        if (allowedHostPatterns.length > 0 && !allowedHostPatterns.some((pattern) => hostnameMatchesPattern(hostname, pattern))) {
            return false;
        }
        return !((transport === "tcp" || transport === "udp" || scheme) && allowedPorts.length > 0 && !portMatches(port, allowedPorts));
        
    });
}

function assertNetworkScopeAllowed(transport, targetValue, capability) {
    let parsed = null;
    try {
        parsed = new URL(String(targetValue || ""), "http://127.0.0.1/");
    } catch (_) {
        parsed = null;
    }
    const hostname = parsed?.hostname || String(targetValue || "").trim();
    const port = parsed?.port || "";
    const scheme = String(parsed?.protocol || "").replace(/:$/, "");
    const allowed = isNetworkTargetAllowed({
        transport,
        scheme,
        hostname,
        port,
    }, allowedNetworkScopes);
    if (!allowed) {
        deny(\`[host-policy] Network target denied for "\${transport}" to "\${String(targetValue || "")}". Grant "system.network", "\${capability}", and a matching "system.network.scope.<scope-id>" capability.\`);
    }
}

function normalizeNetworkTargetUrl(targetValue, fallbackScheme = "http") {
    if (targetValue instanceof URL) {
        return targetValue;
    }
    try {
        return new URL(String(targetValue || ""), \`\${fallbackScheme}://127.0.0.1/\`);
    } catch (_) {
        return null;
    }
}

function extractRequestTarget(args, defaultProtocol = "http:") {
    const first = args[0];
    const second = args[1];
    let protocol = defaultProtocol;
    let hostname = "";
    let port = "";

    if (first instanceof URL) {
        protocol = first.protocol || defaultProtocol;
        hostname = first.hostname || "";
        port = first.port || "";
    } else if (typeof first === "string") {
        const parsed = normalizeNetworkTargetUrl(first, defaultProtocol.replace(/:$/, ""));
        protocol = parsed?.protocol || defaultProtocol;
        hostname = parsed?.hostname || "";
        port = parsed?.port || "";
    } else if (first && typeof first === "object") {
        protocol = String(first.protocol || defaultProtocol || "http:");
        hostname = String(first.hostname || first.host || "127.0.0.1");
        port = String(first.port || "").trim();
    }

    if (second && typeof second === "object") {
        protocol = String(second.protocol || protocol || defaultProtocol || "http:");
        hostname = String(second.hostname || second.host || hostname || "127.0.0.1");
        port = String(second.port || port || "").trim();
    }

    const scheme = String(protocol || defaultProtocol || "http:").replace(/:$/, "").toLowerCase();
    return {
        protocol: String(protocol || defaultProtocol || "http:").toLowerCase(),
        scheme,
        hostname: String(hostname || "").trim().replace(/:\d+$/, ""),
        port,
    };
}

function assertScopedRequestTarget(transport, args, capability, defaultProtocol = "http:") {
    const target = extractRequestTarget(args, defaultProtocol);
    if (!target.hostname) {
        deny(\`[host-policy] Network target denied for "\${transport}". The destination could not be resolved.\`);
    }
    if (!isNetworkTargetAllowed({
        transport,
        scheme: target.scheme,
        hostname: target.hostname,
        port: target.port,
    }, allowedNetworkScopes)) {
        deny(\`[host-policy] Network target denied for "\${transport}" to "\${target.hostname}:\${String(target.port || "")}". Grant "system.network", "\${capability}", and a matching "system.network.scope.<scope-id>" capability.\`);
    }
}

if (typeof process.binding === "function") {
    process.binding = function blockedProcessBinding(name) {
        return denyInternalBinding(name);
    };
}

if (typeof process._linkedBinding === "function") {
    process._linkedBinding = function blockedLinkedBinding(name) {
        return denyInternalBinding(name);
    };
}

function isWithin(basePath, targetPath) {
    if (!basePath || typeof targetPath !== "string") {
        return false;
    }
    const toCanonicalPath = (value) => {
        const absolute = path.resolve(value);
        try {
            return policyFs.realpathSync(absolute);
        } catch (_) {
            // When the exact target does not exist yet (e.g. mkdir target),
            // resolve via the nearest existing parent to normalize symlinks
            // like /var -> /private/var on macOS.
            const pending = [];
            let current = absolute;
            while (!policyFs.existsSync(current)) {
                const parent = path.dirname(current);
                if (parent === current) {
                    return absolute;
                }
                pending.unshift(path.basename(current));
                current = parent;
            }
            let canonicalParent;
            try {
                canonicalParent = policyFs.realpathSync(current);
            } catch (_) {
                canonicalParent = current;
            }
            return path.join(canonicalParent, ...pending);
        }
    };
    const canonicalBase = toCanonicalPath(basePath);
    const canonicalTarget = toCanonicalPath(targetPath);
    const relative = path.relative(canonicalBase, canonicalTarget);
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

const openDescriptors = new Map();
const ownedFileHandles = new WeakMap();
function writePath(target) {
    if (typeof target === 'string') return target;
    if (Buffer.isBuffer(target)) {
        const value = target.toString('utf8');
        if (!Buffer.from(value).equals(target)) deny('[host-policy] Non-UTF-8 filesystem paths are not supported.');
        return value;
    }
    if (target instanceof FileURL) return fileURLToPath(target);
    return null;
}
function assertWritableTarget(targetPath, operation) {
    const normalizedPath = writePath(targetPath);
    if (normalizedPath !== null) {
        targetPath = normalizedPath;
    } else {
        const fd = typeof targetPath === 'number'
            ? targetPath
            : ownedFileHandles.get(targetPath);
        if ((fd === 1 || fd === 2) && /^(?:write|writev|writeFile|appendFile)(?:Sync)?$/.test(operation)) return;
        targetPath = openDescriptors.get(fd);
    }
    if (typeof targetPath !== 'string') deny('[host-policy] Write target or file descriptor is not owned by this plugin.');
    if (!isWithin(pluginHome, targetPath)) {
        deny(\`[host-policy] \${operation} denied for "\${targetPath}". Writes are only allowed under PLUGIN_HOME.\`);
    }
}
function assertReadableTarget(target, operation) {
    const normalized = writePath(target);
    const fd = typeof target === 'number' ? target : ownedFileHandles.get(target);
    // Node lazily constructs a ReadStream for stdin. The host only enables this
    // exception for its ignored utility-process stdin, never an inherited file.
    if (normalized === null && fd === 0 && ignoredStdin) return;
    const filename = normalized ?? openDescriptors.get(fd);
    if (typeof filename !== 'string' || !readRoots.some(root => isWithin(root, filename))) {
        const description = typeof filename === 'string' ? filename : 'unowned file descriptor ' + String(fd);
        deny('[host-policy] ' + operation + ' denied for "' + description + '". Reads are limited to this plugin and its runtime dependencies.');
    }
}

function patchSyncWrite(methodName, resolveTargets = (args) => [args[0]]) {
    const original = fs[methodName];
    if (typeof original !== "function") return;
    fs[methodName] = function patchedSyncWrite(...args) {
        resolveTargets(args).forEach(target => assertWritableTarget(target, methodName));
        return original.apply(this, args);
    };
}

function patchAsyncWrite(methodName, resolveTargets = (args) => [args[0]]) {
    const original = fsPromises[methodName];
    if (typeof original !== "function") return;
    fsPromises[methodName] = async function patchedAsyncWrite(...args) {
        resolveTargets(args).forEach(target => assertWritableTarget(target, methodName));
        return original.apply(this, args);
    };
}
function patchCallbackWrite(methodName, resolveTargets = (args) => [args[0]]) {
    const original = fs[methodName];
    if (typeof original !== 'function') return;
    fs[methodName] = function(...args) {
        try {resolveTargets(args).forEach(target => assertWritableTarget(target, methodName));}
        catch (error) {
            const callback = args[args.length - 1];
            if (typeof callback !== 'function') throw error;
            queueMicrotask(() => callback(error));
            return;
        }
        return original.apply(this, args);
    };
}
function rememberDescriptor(fd, target) {
    const value = writePath(target);
    if (typeof value !== 'string') return;
    const absolute = path.resolve(value);
    let canonical = absolute;
    try {canonical = fs.realpathSync(absolute);} catch (_) {}
    openDescriptors.set(fd, canonical);
}

function usesWriteFlags(flags) {
    if (typeof flags === "number") {
        const constants = fs.constants || {};
        const writableMask =
            (constants.O_WRONLY || 0) |
            (constants.O_RDWR || 0) |
            (constants.O_CREAT || 0) |
            (constants.O_TRUNC || 0) |
            (constants.O_APPEND || 0);
        return Boolean(flags & writableMask);
    }
    if (typeof flags !== "string") {
        return false;
    }
    return /[wa+]/.test(flags);
}

patchSyncWrite("writeFileSync");
patchSyncWrite("appendFileSync");
patchSyncWrite("mkdirSync");
patchSyncWrite("rmSync");
patchSyncWrite("rmdirSync");
patchSyncWrite("unlinkSync");
patchSyncWrite("truncateSync");
patchSyncWrite("copyFileSync", (args) => [args[1]]);
patchSyncWrite("renameSync", (args) => [args[0], args[1]]);
for (const method of ['chmod', 'chown', 'lchmod', 'lchown', 'utimes', 'lutimes', 'mkdtemp', 'write', 'writev', 'ftruncate', 'fchmod', 'fchown', 'futimes']) patchSyncWrite(method + 'Sync');

if (typeof fs.openSync === "function") {
    const originalOpenSync = fs.openSync;
    fs.openSync = function patchedOpenSync(targetPath, flags, ...rest) {
        assertReadableTarget(targetPath, 'openSync');
        if (usesWriteFlags(flags)) {
            assertWritableTarget(targetPath, "openSync");
        }
        const fd = originalOpenSync.call(this, targetPath, flags, ...rest);
        rememberDescriptor(fd, targetPath);
        return fd;
    };
}

if (typeof fs.createWriteStream === "function") {
    const originalCreateWriteStream = fs.createWriteStream;
    fs.createWriteStream = function patchedCreateWriteStream(targetPath, ...rest) {
        assertWritableTarget(rest[0]?.fd ?? targetPath, "write");
        return originalCreateWriteStream.call(this, targetPath, ...rest);
    };
}
if (typeof fs.WriteStream?.prototype?._construct === 'function') {
    // Patch construction in place: preserve the callable constructor and aliases,
    // including constructors obtained from an existing stream's prototype.
    const originalConstruct = fs.WriteStream.prototype._construct;
    fs.WriteStream.prototype._construct = function(callback) {
        try {assertWritableTarget(this.fd ?? this.path, 'write');}
        catch (error) {callback(error);return;}
        return originalConstruct.call(this, callback);
    };
}

patchAsyncWrite("writeFile");
patchAsyncWrite("appendFile");
patchAsyncWrite("mkdir");
patchAsyncWrite("rm");
patchAsyncWrite("rmdir");
patchAsyncWrite("unlink");
patchAsyncWrite("copyFile", (args) => [args[1]]);
patchAsyncWrite("rename", (args) => [args[0], args[1]]);
for (const method of ['chmod', 'chown', 'lchmod', 'lchown', 'utimes', 'lutimes', 'mkdtemp', 'mkdtempDisposable']) patchAsyncWrite(method);
patchAsyncWrite('truncate');
// Recursive copy can traverse destination symlinks below the checked root.
// Require callers to use the individually checked mkdir/copyFile operations.
for (const [object, name] of [[fs, 'cpSync'], [fs, 'cp'], [fsPromises, 'cp']]) {
    if (typeof object[name] !== 'function') continue;
    object[name] = function(...args) {
        const error = new Error('[host-policy] Recursive copy is unavailable; use mkdir and copyFile under PLUGIN_HOME.');
        const callback = args[args.length - 1];
        if (name === 'cp' && object === fs && typeof callback === 'function') {queueMicrotask(() => callback(error));return;}
        if (object === fsPromises) return Promise.reject(error);
        throw error;
    };
}
for (const method of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'truncate', 'chmod', 'chown', 'lchmod', 'lchown', 'utimes', 'lutimes', 'write', 'writev', 'ftruncate', 'fchmod', 'fchown', 'futimes']) patchCallbackWrite(method);
patchCallbackWrite('copyFile', args => [args[1]]);
patchCallbackWrite('rename', args => [args[0], args[1]]);
const linkTargets = args => [args[0], args[1]];
const symlinkTargets = args => {
    const target = writePath(args[0]), destination = writePath(args[1]);
    return [target && destination ? path.resolve(path.dirname(path.resolve(destination)), target) : null, args[1]];
};
for (const [name, targets] of [['link', linkTargets], ['symlink', symlinkTargets]]) {
    patchSyncWrite(name + 'Sync', targets);patchAsyncWrite(name, targets);patchCallbackWrite(name, targets);
}
if (typeof fs.open === 'function') {
    const originalOpen = fs.open;
    fs.open = function(target, flags, ...args) {
        const callback = args[args.length - 1];
        try {
            assertReadableTarget(target, 'open');
            if (usesWriteFlags(flags)) assertWritableTarget(target, 'open');
        }
        catch (error) {
            if (typeof callback !== 'function') throw error;
            queueMicrotask(() => callback(error));return;
        }
        if (typeof callback === 'function') args[args.length - 1] = (error, fd) => {
            if (!error) rememberDescriptor(fd, target);
            callback(error, fd);
        };
        return originalOpen.call(this, target, flags, ...args);
    };
}
const fileHandlePrototypes = new WeakSet();
function protectFileHandle(handle, target) {
    const fd = handle.fd;
    ownedFileHandles.set(handle, fd);
    rememberDescriptor(fd, target);
    handle.once('close', () => {openDescriptors.delete(fd);ownedFileHandles.delete(handle);});
    const prototype = Object.getPrototypeOf(handle);
    if (!fileHandlePrototypes.has(prototype)) {
        fileHandlePrototypes.add(prototype);
        for (const name of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes', 'createWriteStream']) {
            const original = prototype[name];
            if (typeof original !== 'function') continue;
            prototype[name] = name === 'createWriteStream'
                ? function(...args) {
                    assertWritableTarget(this, name);
                    return original.apply(this, args);
                }
                : async function(...args) {
                    assertWritableTarget(this, name);
                    return original.apply(this, args);
                };
        }
        for (const name of ['read', 'readv', 'readFile', 'stat', 'createReadStream', 'readLines', 'readableWebStream']) {
            const original = prototype[name];
            if (typeof original !== 'function') continue;
            const validate = handle => assertReadableTarget(handle, name);
            prototype[name] = ['createReadStream', 'readLines', 'readableWebStream'].includes(name)
                ? function(...args) {validate(this);return original.apply(this, args);}
                : async function(...args) {validate(this);return original.apply(this, args);};
        }
    }
    return handle;
}
for (const name of ['close', 'closeSync']) {
    const original = fs[name];
    fs[name] = function(fd, ...args) {
        if (name === 'closeSync') {const result = original.call(this, fd, ...args);openDescriptors.delete(fd);return result;}
        const callback = args[args.length - 1];
        if (typeof callback === 'function') args[args.length - 1] = error => {if (!error) openDescriptors.delete(fd);callback(error);};
        return original.call(this, fd, ...args);
    };
}

if (typeof fsPromises.open === "function") {
    const originalOpen = fsPromises.open;
    fsPromises.open = async function patchedOpen(targetPath, flags, ...rest) {
        assertReadableTarget(targetPath, 'open');
        if (usesWriteFlags(flags)) {
            assertWritableTarget(targetPath, "open");
        }
        return protectFileHandle(await originalOpen.call(this, targetPath, flags, ...rest), targetPath);
    };
}

function patchRead(object, name, kind, targets = args => [args[0]]) {
    const original = object[name];
    if (typeof original !== 'function') return;
    const validate = args => {
        targets(args).forEach(target => assertReadableTarget(target, name));
        if ((name.startsWith('readdir') || name.startsWith('opendir')) && args[1]?.recursive) {
            deny('[host-policy] Recursive directory reads are unavailable; use checked non-recursive readdir calls.');
        }
    };
    if (kind === 'promise') {
        object[name] = async function(...args) {validate(args);return original.apply(this, args);};
    } else if (kind === 'callback') {
        object[name] = function(...args) {
            try {validate(args);} catch (error) {
                const callback = args[args.length - 1];
                if (typeof callback !== 'function') throw error;
                queueMicrotask(() => callback(error));return;
            }
            return original.apply(this, args);
        };
    } else {
        object[name] = function(...args) {validate(args);return original.apply(this, args);};
    }
    if (typeof original.native === 'function') {
        const holder = {native: original.native};
        patchRead(holder, 'native', kind, targets);
        object[name].native = holder.native;
    }
}
for (const name of ['readFile', 'readdir', 'opendir', 'stat', 'lstat', 'statfs', 'readlink', 'realpath', 'access']) {
    patchRead(fs, name + 'Sync', 'sync');
    patchRead(fs, name, 'callback');
    patchRead(fsPromises, name, 'promise');
}
for (const name of ['read', 'readv']) {
    patchRead(fs, name + 'Sync', 'sync');patchRead(fs, name, 'callback');
}
patchRead(fs, 'fstatSync', 'sync');patchRead(fs, 'fstat', 'callback');
patchRead(fs, 'openAsBlob', 'promise');
patchRead(fs, 'copyFileSync', 'sync');patchRead(fs, 'copyFile', 'callback');patchRead(fsPromises, 'copyFile', 'promise');
for (const name of ['watch', 'watchFile']) patchRead(fs, name, 'sync');
patchRead(fsPromises, 'watch', 'sync');
const originalExistsSync = fs.existsSync;
function isReadRootAncestor(target) {
    const filename = writePath(target);
    return filename !== null && readRoots.some(root => isWithin(filename, root));
}
fs.existsSync = function(target) {
    try {assertReadableTarget(target, 'existsSync');}
    catch (_) {
        // Directory-creation libraries walk known parent directories up to the
        // filesystem root. Existence alone is safe; listing/reading stays denied.
        return isReadRootAncestor(target) && policyFs.existsSync(target);
    }
    return originalExistsSync.call(this, target);
};
const originalExists = fs.exists;
fs.exists = function(target, callback) {
    try {assertReadableTarget(target, 'exists');}
    catch (_) {queueMicrotask(() => callback(isReadRootAncestor(target) && policyFs.existsSync(target)));return;}
    return originalExists.call(this, target, callback);
};
const originalCreateReadStream = fs.createReadStream;
fs.createReadStream = function(target, options) {
    assertReadableTarget(options?.fd ?? target, 'createReadStream');
    return originalCreateReadStream.call(this, target, options);
};
if (typeof fs.ReadStream?.prototype?._construct === 'function') {
    const originalConstruct = fs.ReadStream.prototype._construct;
    fs.ReadStream.prototype._construct = function(callback) {
        try {assertReadableTarget(this.fd ?? this.path, 'ReadStream');}
        catch (error) {callback(error);return;}
        return originalConstruct.call(this, callback);
    };
}
// Glob traverses directories internally, bypassing per-path public API checks.
for (const [object, name] of [[fs, 'glob'], [fs, 'globSync'], [fsPromises, 'glob']]) {
    if (typeof object[name] === 'function') object[name] = function() {
        deny('[host-policy] Glob is unavailable; use checked readdir calls.');
    };
}

// Resolving/loading JSON or JavaScript must not become an alternative file reader.
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(...args) {
    const resolved = originalResolveFilename.apply(this, args);
    if (!Module.isBuiltin(resolved)) assertReadableTarget(resolved, 'require');
    return resolved;
};
for (const name of Object.keys(Module._extensions)) {
    const original = Module._extensions[name];
    Module._extensions[name] = function(module, filename, ...args) {
        assertReadableTarget(filename, 'module load');
        return original.call(this, module, filename, ...args);
    };
}

const blockedNetworkModules = new Set(["undici", "node:undici"]);
const alwaysBlockedModules = new Set(["worker_threads", "node:worker_threads", "original-fs", "node:original-fs", "electron", "electron/main", "electron/common", "electron/renderer"]);

if (!allowNetworkDns) {
    ["dns", "dns/promises", "node:dns", "node:dns/promises"].forEach((entry) => blockedNetworkModules.add(entry));
}
if (!allowNetworkUdp) {
    ["dgram", "node:dgram"].forEach((entry) => blockedNetworkModules.add(entry));
}
if (!allowNetworkTcp) {
    ["net", "node:net"].forEach((entry) => blockedNetworkModules.add(entry));
}
if (!(allowNetworkTcp || allowNetworkHttps)) {
    ["tls", "node:tls"].forEach((entry) => blockedNetworkModules.add(entry));
}
if (!allowNetworkHttp) {
    ["http", "node:http"].forEach((entry) => blockedNetworkModules.add(entry));
}
if (!allowNetworkHttps) {
    ["https", "http2", "node:https", "node:http2"].forEach((entry) => blockedNetworkModules.add(entry));
}

if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = function guardedFetch(input, init) {
        const protocol = parseUrlProtocol(typeof input === "string" ? input : input?.url);
        if (protocol === "https:" && allowNetworkHttps) {
            assertNetworkScopeAllowed("fetch", typeof input === "string" ? input : input?.url, "system.network.https");
            return originalFetch(input, init);
        }
        if (protocol === "http:" && allowNetworkHttp) {
            assertNetworkScopeAllowed("fetch", typeof input === "string" ? input : input?.url, "system.network.http");
            return originalFetch(input, init);
        }
        if (protocol === "https:") {
            return denyNetworkAccess("fetch", "system.network.https");
        }
        if (protocol === "http:") {
            return denyNetworkAccess("fetch", "system.network.http");
        }
        return denyNetworkAccess("fetch");
    };
}

if (typeof globalThis.WebSocket === "function") {
    const OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = function guardedWebSocket(url, protocols) {
        if (!allowNetworkWebSocket) {
            return denyNetworkAccess("WebSocket", "system.network.websocket");
        }
        assertNetworkScopeAllowed("websocket", url, "system.network.websocket");
        return new OriginalWebSocket(url, protocols);
    };
}

if (typeof globalThis.EventSource === "function") {
    const OriginalEventSource = globalThis.EventSource;
    globalThis.EventSource = function guardedEventSource(url, configuration) {
        const protocol = parseUrlProtocol(url);
        if (protocol === "https:" && allowNetworkHttps) {
            assertNetworkScopeAllowed("eventsource", url, "system.network.https");
            return new OriginalEventSource(url, configuration);
        }
        if (protocol === "http:" && allowNetworkHttp) {
            assertNetworkScopeAllowed("eventsource", url, "system.network.http");
            return new OriginalEventSource(url, configuration);
        }
        if (protocol === "https:") {
            return denyNetworkAccess("EventSource", "system.network.https");
        }
        if (protocol === "http:") {
            return denyNetworkAccess("EventSource", "system.network.http");
        }
        return denyNetworkAccess("EventSource");
    };
}

const originalLoad = Module._load;
// Public plugin imports get guarded facades. Mutating Node's shared networking
// exports also intercepts fetch's own TLS/DNS calls and incorrectly requires
// raw socket grants for an otherwise permitted HTTPS request.
const networkBuiltinNames = new Set(['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises']);
const networkModuleViews = new Map();
// SDK internals may load this module, but that must not provide raw execution
// to a plugin without the explicit legacy sudo grant. Patch the shared exports
// as well as the loader so builtin access and ESM cannot recover raw methods.
if (blockedModules.has('child_process') || blockedModules.has('node:child_process')) {
    const childProcess = originalLoad('node:child_process');
    const denyExecution = () => deny('[host-policy] Raw process execution is denied. Use a granted host tool service.');
    if (typeof process.execve === 'function') process.execve = denyExecution;
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
        childProcess[name] = denyExecution;
    }
    if (childProcess.ChildProcess?.prototype) childProcess.ChildProcess.prototype.spawn = denyExecution;
}
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron' || request.startsWith('electron/') || request === 'original-fs' || request === 'node:original-fs') {
        // The SDK uses process.parentPort. Exposing Electron's net module would
        // create a second file/network reader outside the Node fs guards.
        deny('[host-policy] Electron host APIs are unavailable in plugin backends.');
    }
    if (blockedModules.has(request) || blockedNetworkModules.has(request) || alwaysBlockedModules.has(request)) {
        const parentFile = typeof parent?.filename === "string" ? parent.filename : "";
        const isSdkInternalImport = parentFile.replace(/\\\\/g, "/").includes("@anikitenko/fdo-sdk");
        if (!isSdkInternalImport) {
        deny(\`[host-policy] Import "\${request}" is denied by host capability policy.\`);
        }
    }
    let loaded = originalLoad.call(this, request, parent, isMain);
    const networkName = request.replace(/^node:/, '');
    if (networkBuiltinNames.has(networkName)) {
        if (networkModuleViews.has(networkName)) return networkModuleViews.get(networkName);
        loaded = {...loaded};
        networkModuleViews.set(networkName, loaded);
    }

    if (request === "net" || request === "node:net") {
        const originalConnect = typeof loaded?.connect === "function" ? loaded.connect.bind(loaded) : null;
        const originalCreateConnection = typeof loaded?.createConnection === "function" ? loaded.createConnection.bind(loaded) : null;
        if (originalConnect) {
            loaded.connect = function guardedNetConnect(...args) {
                const first = args[0];
                const options = typeof first === "object" && first !== null
                    ? first
                    : {port: first, host: args[1]};
                assertNetworkScopeAllowed("tcp", options?.host || "127.0.0.1", "system.network.tcp");
                const port = options?.port;
                if (!isNetworkTargetAllowed({
                    transport: "tcp",
                    scheme: "tcp",
                    hostname: options?.host || "127.0.0.1",
                    port,
                }, allowedNetworkScopes)) {
                    deny(\`[host-policy] Network target denied for "tcp" to "\${String(options?.host || "127.0.0.1")}:\${String(port || "")}". Grant a matching "system.network.scope.<scope-id>" capability.\`);
                }
                return originalConnect(...args);
            };
        }
        if (originalCreateConnection) {
            loaded.createConnection = loaded.connect;
        }
    }

    if (request === "http" || request === "node:http" || request === "https" || request === "node:https") {
        const isHttpsModule = request === "https" || request === "node:https";
        const requiredCapability = isHttpsModule ? "system.network.https" : "system.network.http";
        const defaultProtocol = isHttpsModule ? "https:" : "http:";
        const originalRequest = typeof loaded?.request === "function" ? loaded.request.bind(loaded) : null;
        const originalGet = typeof loaded?.get === "function" ? loaded.get.bind(loaded) : null;

        if (originalRequest) {
            loaded.request = function guardedHttpRequest(...args) {
                assertScopedRequestTarget(isHttpsModule ? "fetch" : "fetch", args, requiredCapability, defaultProtocol);
                return originalRequest(...args);
            };
        }

        if (originalGet) {
            loaded.get = function guardedHttpGet(...args) {
                assertScopedRequestTarget(isHttpsModule ? "fetch" : "fetch", args, requiredCapability, defaultProtocol);
                return originalGet(...args);
            };
        }
    }

    if (request === "http2" || request === "node:http2") {
        const originalConnect = typeof loaded?.connect === "function" ? loaded.connect.bind(loaded) : null;
        if (originalConnect) {
            loaded.connect = function guardedHttp2Connect(...args) {
                assertScopedRequestTarget("fetch", args, "system.network.https", "https:");
                return originalConnect(...args);
            };
        }
    }

    if (request === "tls" || request === "node:tls") {
        const originalConnect = typeof loaded?.connect === "function" ? loaded.connect.bind(loaded) : null;
        const originalCreateConnection = typeof loaded?.createConnection === "function" ? loaded.createConnection.bind(loaded) : null;
        if (originalConnect) {
            loaded.connect = function guardedTlsConnect(...args) {
                if (!allowNetworkTcp) {
                    denyNetworkAccess("tls.connect", "system.network.tcp");
                }
                const first = args[0];
                const options = typeof first === "object" && first !== null
                    ? first
                    : {port: first, host: args[1]};
                if (!isNetworkTargetAllowed({
                    transport: "tcp",
                    scheme: "tcp",
                    hostname: options?.host || options?.servername || "127.0.0.1",
                    port: options?.port,
                }, allowedNetworkScopes)) {
                    deny(\`[host-policy] Network target denied for "tcp" to "\${String(options?.host || options?.servername || "127.0.0.1")}:\${String(options?.port || "")}". Grant "system.network", "system.network.tcp", and a matching "system.network.scope.<scope-id>" capability.\`);
                }
                return originalConnect(...args);
            };
        }
        if (originalCreateConnection) {
            loaded.createConnection = loaded.connect || function guardedTlsCreateConnection(...args) {
                return originalCreateConnection(...args);
            };
        }
    }

    if (request === "dgram" || request === "node:dgram") {
        const originalCreateSocket = typeof loaded?.createSocket === "function" ? loaded.createSocket.bind(loaded) : null;
        if (originalCreateSocket) {
            loaded.createSocket = function guardedCreateSocket(...args) {
                const socket = originalCreateSocket(...args);
                const originalSend = typeof socket?.send === "function" ? socket.send.bind(socket) : null;
                if (originalSend) {
                    socket.send = function guardedSend(...sendArgs) {
                        const port = sendArgs.length >= 2 ? sendArgs[sendArgs.length - 2] : undefined;
                        const host = sendArgs[sendArgs.length - 1];
                        if (!isNetworkTargetAllowed({
                            transport: "udp",
                            scheme: "udp",
                            hostname: host,
                            port,
                        }, allowedNetworkScopes)) {
                            deny(\`[host-policy] Network target denied for "udp" to "\${String(host || "")}:\${String(port || "")}". Grant "system.network", "system.network.udp", and a matching "system.network.scope.<scope-id>" capability.\`);
                        }
                        return originalSend(...sendArgs);
                    };
                }
                return socket;
            };
        }
    }

    if (request === "dns" || request === "node:dns" || request === "dns/promises" || request === "node:dns/promises") {
        const methodNames = ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNs", "resolveSrv", "resolveTxt"];
        methodNames.forEach((methodName) => {
            const originalMethod = typeof loaded?.[methodName] === "function" ? loaded[methodName].bind(loaded) : null;
            if (!originalMethod) {
                return;
            }
            loaded[methodName] = function guardedDnsMethod(hostname, ...args) {
                if (!isNetworkTargetAllowed({
                    transport: "dns",
                    scheme: "dns",
                    hostname,
                    port: "",
                }, allowedNetworkScopes)) {
                    deny(\`[host-policy] Network target denied for "dns" lookup "\${String(hostname || "")}". Grant "system.network", "system.network.dns", and a matching "system.network.scope.<scope-id>" capability.\`);
                }
                return originalMethod(hostname, ...args);
            };
        });
    }

    if (request === "@anikitenko/fdo-sdk" && loaded?.PluginRegistry
        && !loaded.PluginRegistry.__fdoTrayPolicyConfigured) {
        const registry = loaded.PluginRegistry;
        const stores=new Set();
        const useStore=registry.useStore.bind(registry);
        registry.useStore=function(...args){const store=useStore(...args);if(typeof registry.shutdown!=='function')stores.add(store);return store;};
        let storageClosing;
        originalParentOn('message',event=>{
            const data=event && typeof event==='object' && 'data' in event?event.data:event;
            if(data?.message!=='HOST_STORAGE_SHUTDOWN_V1')return;
            storageClosing ||= Promise.allSettled([
                ...(typeof registry.shutdown === 'function' ? [Promise.resolve().then(() => registry.shutdown(4500))] : []),
                ...[...stores].map(async store=>{store.beginShutdown?.();try{await store.flush?.();}finally{await store.dispose?.();}})
            ]);
            void storageClosing.then(results=>{
                const success=results.every(result=>result.status==='fulfilled');
                if(!success)console.error('[FDO_STORAGE_FLUSH_FAILED] Plugin resource cleanup or persistent storage shutdown failed.');
                try{parentPort.postMessage({type:'HOST_STORAGE_SHUTDOWN_REPLY_V1',requestId:data.content?.requestId,success});}catch{}
            });
        });
        const configure = registry.configureCapabilities.bind(registry);
        const trayGranted = String(process.env.FDO_PLUGIN_CAPABILITIES || "").split(",").includes("system.tray");
        registry.configureCapabilities = function(configuration) {
            const granted = Array.isArray(configuration?.granted) ? configuration.granted : [];
            return configure({...configuration, granted: trayGranted ? [...new Set([...granted, "system.tray"])] : granted});
        };
        Object.defineProperty(registry, "__fdoTrayPolicyConfigured", {value: true});
        if (typeof registry.configureSharedLogic === 'function') {
            registry.configureSharedLogic({request: payload => sendHostServiceMessage({request: {action: 'plugins.shared', payload}})});
            originalParentOn('message', event => {
                const data = event && typeof event === 'object' && 'data' in event ? event.data : event;
                if (data?.message === 'HOST_SHARED_CANCEL_V1') {
                    if (typeof data.content?.callId === 'string') registry.cancelSharedLogicInvocation(data.content.callId);
                    return;
                }
                if (data?.message !== 'HOST_SHARED_INVOKE_V1') return;
                const invocation = data.content;
                if (!invocation || typeof invocation.callId !== 'string' || typeof invocation.registrationId !== 'string') return;
                // Start dispatch synchronously so a following cancel message can
                // abort it even when native IPC delivers both in one read batch.
                let sharedWork;
                try { sharedWork = registry.dispatchSharedLogic(invocation); }
                catch { sharedWork = Promise.reject(new Error('Shared dispatch failed.')); }
                Promise.resolve(sharedWork).then(reply => {
                    try { parentPort.postMessage({type: 'HOST_SHARED_REPLY_V1', callId: invocation.callId, registrationId: invocation.registrationId, ...reply}); } catch {}
                }).catch(() => {
                    try { parentPort.postMessage({type: 'HOST_SHARED_REPLY_V1', callId: invocation.callId, registrationId: invocation.registrationId, error: 'SERVICE_ERROR'}); } catch {}
                });
            });
        }
        if (typeof registry.configureHostServices === 'function') {
            registry.configureHostServices({request: requestHostService,watchSSHStatus:watchHostSSHStatus,startSSHExecution:startHostSSHExecution,openSSHTerminal:openHostSSHTerminal});
            const clearPlugin = registry.clearPlugin.bind(registry);
            registry.clearPlugin = function(...args) {
                closeHostServiceTransport();
                try {parentPort.postMessage({type:'HOST_SERVICE_DISCONNECT_V1'});} catch { /* Worker is disconnecting. */ }
                return clearPlugin(...args);
            };
            // SDK rechecks backend identity after await and on iterator/cancel
            // calls. Async-local scope keeps those checks in the actual worker
            // environment without hiding the legacy bridge from concurrent calls.
            const backendCall = invoke => typeof globalThis.document === 'undefined'
                ? hostBackendContext.run(true,invoke) : invoke();
            const backendSignal = signal => {
                if(!signal)return signal;
                const listeners=new Map();
                return {get aborted(){return signal.aborted;}, get reason(){return signal.reason;},
                    addEventListener(type,listener,options){const wrapped=(...args)=>backendCall(()=>listener(...args));listeners.set(listener,wrapped);signal.addEventListener(type,wrapped,options);},
                    removeEventListener(type,listener){const wrapped=listeners.get(listener);if(wrapped){signal.removeEventListener(type,wrapped);listeners.delete(listener);}},
                };
            };
            const wrapIterator = iterator => ({
                next:(...args)=>backendCall(()=>iterator.next(...args)),
                return:(...args)=>backendCall(()=>iterator.return(...args)),
                [Symbol.asyncIterator]() {return this;},
            });
            for (const [Type,names] of [[loaded.SharedLogic,['register','list','call','requestAccess']], [loaded.SecretStore,['set','get','delete','list']], [loaded.SSHClient,['exec','listProfiles','start','watchStatus','openTerminal']]]) {
                if(!Type)continue;
                for(const name of names) {
                    const original=Type.prototype[name];if(typeof original!=='function')continue;
                    Type.prototype[name]=function(...args) {
                        if(name==='openTerminal'&&args[1])args[1]=backendSignal(args[1]);
                        const result=backendCall(()=>original.apply(this,args));
                        if(name==='watchStatus')return wrapIterator(result);
                        if(name==='openTerminal')return result.then(session=>({
                            result:session.result, output:{[Symbol.asyncIterator]:()=>wrapIterator(session.output[Symbol.asyncIterator]())},
                            write:(...args)=>backendCall(()=>session.write(...args)),
                            resize:(...args)=>backendCall(()=>session.resize(...args)),
                            endInput:()=>backendCall(()=>session.endInput()),
                            close:()=>backendCall(()=>session.close()),
                            cancel:()=>backendCall(()=>session.cancel()),
                        }));
                        if(name==='start')return result.then(execution=>({
                            result:execution.result,
                            events:{[Symbol.asyncIterator]:()=>wrapIterator(execution.events[Symbol.asyncIterator]())},
                            cancel:()=>backendCall(()=>execution.cancel()),
                        }));
                        return result;
                    };
                }
            }
        }
    }
    return loaded;
};

const guardedLoad = Module._load;
const isBuiltin = Module.isBuiltin.bind(Module);
if (typeof process.getBuiltinModule === 'function') {
    const originalGetBuiltinModule = process.getBuiltinModule.bind(process);
    Object.defineProperty(process, 'getBuiltinModule', {
        configurable: false,
        writable: false,
        value(request) {
            if (alwaysBlockedModules.has(request)) deny('[host-policy] Builtin access is denied by host capability policy.');
            // Preserve Node's behavior for unknown names and invalid arguments.
            if (typeof request !== 'string' || !isBuiltin(request)) return originalGetBuiltinModule(request);
            return guardedLoad(request, {filename: runtimeEntry}, false);
        },
    });
}

// Keep shared filesystem/process ESM exports guarded. Networking uses separate
// facades below, so Node's internal HTTPS implementation retains its transport.
Module.syncBuiltinESMExports();
if (typeof Module.registerHooks !== 'function') {
    deny('[host-policy] This Node runtime does not support the required module policy hooks.');
}
Module.registerHooks({
    resolve(request, context, nextResolve) {
        const resolved = nextResolve(request, context);
        const builtin = resolved.url.startsWith('node:') ? resolved.url : request;
        if (resolved.url.startsWith('file:')) assertReadableTarget(fileURLToPath(resolved.url), 'ESM import');
        const bare = builtin.startsWith('node:') ? builtin.slice(5) : builtin;
        const forbidden = [builtin, bare, 'node:' + bare].some(name =>
            blockedModules.has(name) || blockedNetworkModules.has(name) || alwaysBlockedModules.has(name));
        const parentPath = decodeURIComponent(context.parentURL || '').replace(/\\\\/g, '/');
        const sdkParent = parentPath.includes('/@anikitenko/fdo-sdk/');
        if (forbidden && !sdkParent) deny('[host-policy] Import "' + request + '" is denied by host capability policy.');
        if (resolved.url.startsWith('node:') && networkBuiltinNames.has(bare) && !context.conditions.includes('require')) {
            const names = Object.keys(originalLoad('node:' + bare)).filter(name => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && name !== 'default');
            const source = 'import {createRequire} from "node:module"; const view=createRequire(' + JSON.stringify(runtimeEntry) + ')(' + JSON.stringify('node:' + bare) + '); export default view;'
                + names.map(name => 'export const ' + name + '=view[' + JSON.stringify(name) + '];').join('');
            return {url:'data:text/javascript,' + encodeURIComponent(source),shortCircuit:true};
        }
        return resolved;
    },
});

require(runtimeEntry);
`;
}

export function ensurePluginRuntimeBootstrap(pluginId) {
    const runtimeCacheDir = path.join(app.getPath("userData"), "plugin-runtime-cache", pluginId);
    mkdirSync(runtimeCacheDir, {recursive: true});
    const bootstrapPath = path.join(runtimeCacheDir, "host_runtime_bootstrap.cjs");
    const source = buildPluginRuntimeBootstrapSource();
    let shouldWrite;
    try {
        shouldWrite = readFileSync(bootstrapPath, "utf8") !== source;
    } catch (_) {
        shouldWrite = true;
    }
    if (shouldWrite) {
        writeFileSync(bootstrapPath, source, "utf8");
    }
    return bootstrapPath;
}

export function buildPluginRuntimePolicy(grantedCapabilities = []) {
    return buildRuntimeSecurityPolicy(grantedCapabilities);
}
