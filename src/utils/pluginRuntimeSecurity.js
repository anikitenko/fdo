import {app} from "electron";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {buildRuntimeSecurityPolicy, KNOWN_PLUGIN_CAPABILITIES, normalizeCapabilityList} from "./pluginCapabilities";

export const HOST_PLUGIN_API_VERSION = "1.0.0";

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
        capabilities: [...grantedCapabilities],
    };
}

export function buildPluginRuntimeBootstrapSource() {
    return `"use strict";

const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");

const runtimeEntry = process.env.FDO_PLUGIN_RUNTIME_ENTRY;
if (!runtimeEntry) {
    throw new Error("Missing FDO_PLUGIN_RUNTIME_ENTRY");
}

const pluginHome = process.env.PLUGIN_HOME ? path.resolve(process.env.PLUGIN_HOME) : "";
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
if (!process.parentPort) {
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

parentPort.on("message", (message) => {
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
    globalThis.window = bridgeTarget;
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
        if ((transport === "tcp" || transport === "udp" || scheme) && allowedPorts.length > 0 && !portMatches(port, allowedPorts)) {
            return false;
        }
        return true;
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
            if (typeof fs.realpathSync?.native === "function") {
                return fs.realpathSync.native(absolute);
            }
            return fs.realpathSync(absolute);
        } catch (_) {
            // When the exact target does not exist yet (e.g. mkdir target),
            // resolve via the nearest existing parent to normalize symlinks
            // like /var -> /private/var on macOS.
            const pending = [];
            let current = absolute;
            while (!fs.existsSync(current)) {
                const parent = path.dirname(current);
                if (parent === current) {
                    return absolute;
                }
                pending.unshift(path.basename(current));
                current = parent;
            }
            let canonicalParent = current;
            try {
                canonicalParent = typeof fs.realpathSync?.native === "function"
                    ? fs.realpathSync.native(current)
                    : fs.realpathSync(current);
            } catch (_) {
                canonicalParent = current;
            }
            return path.join(canonicalParent, ...pending);
        }
    };
    const canonicalBase = toCanonicalPath(basePath);
    const canonicalTarget = toCanonicalPath(targetPath);
    return canonicalTarget === canonicalBase || canonicalTarget.startsWith(canonicalBase + path.sep);
}

function assertWritableTarget(targetPath, operation) {
    if (typeof targetPath !== "string") {
        return;
    }
    if (!isWithin(pluginHome, targetPath)) {
        deny(\`[host-policy] \${operation} denied for "\${targetPath}". Writes are only allowed under PLUGIN_HOME.\`);
    }
}

function patchSyncWrite(methodName, resolveTarget = (args) => args[0]) {
    const original = fs[methodName];
    if (typeof original !== "function") return;
    fs[methodName] = function patchedSyncWrite(...args) {
        assertWritableTarget(resolveTarget(args), methodName);
        return original.apply(this, args);
    };
}

function patchAsyncWrite(methodName, resolveTarget = (args) => args[0]) {
    const original = fsPromises[methodName];
    if (typeof original !== "function") return;
    fsPromises[methodName] = async function patchedAsyncWrite(...args) {
        assertWritableTarget(resolveTarget(args), methodName);
        return original.apply(this, args);
    };
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
patchSyncWrite("copyFileSync", (args) => args[1]);
patchSyncWrite("renameSync", (args) => args[1]);

if (typeof fs.openSync === "function") {
    const originalOpenSync = fs.openSync;
    fs.openSync = function patchedOpenSync(targetPath, flags, ...rest) {
        if (usesWriteFlags(flags)) {
            assertWritableTarget(targetPath, "openSync");
        }
        return originalOpenSync.call(this, targetPath, flags, ...rest);
    };
}

if (typeof fs.createWriteStream === "function") {
    const originalCreateWriteStream = fs.createWriteStream;
    fs.createWriteStream = function patchedCreateWriteStream(targetPath, ...rest) {
        assertWritableTarget(targetPath, "createWriteStream");
        return originalCreateWriteStream.call(this, targetPath, ...rest);
    };
}

patchAsyncWrite("writeFile");
patchAsyncWrite("appendFile");
patchAsyncWrite("mkdir");
patchAsyncWrite("rm");
patchAsyncWrite("rmdir");
patchAsyncWrite("unlink");
patchAsyncWrite("copyFile", (args) => args[1]);
patchAsyncWrite("rename", (args) => args[1]);

if (typeof fsPromises.open === "function") {
    const originalOpen = fsPromises.open;
    fsPromises.open = async function patchedOpen(targetPath, flags, ...rest) {
        if (usesWriteFlags(flags)) {
            assertWritableTarget(targetPath, "open");
        }
        return originalOpen.call(this, targetPath, flags, ...rest);
    };
}

const blockedNetworkModules = new Set(["undici", "node:undici"]);
const alwaysBlockedModules = new Set(["worker_threads", "node:worker_threads"]);

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
Module._load = function patchedLoad(request, parent, isMain) {
    if (blockedModules.has(request) || blockedNetworkModules.has(request) || alwaysBlockedModules.has(request)) {
        const parentFile = typeof parent?.filename === "string" ? parent.filename : "";
        const isSdkInternalImport = parentFile.includes("@anikitenko/fdo-sdk");
        if (!isSdkInternalImport) {
        deny(\`[host-policy] Import "\${request}" is denied by host capability policy.\`);
        }
    }
    const loaded = originalLoad.call(this, request, parent, isMain);

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

    return loaded;
};

require(runtimeEntry);
`;
}

export function ensurePluginRuntimeBootstrap(pluginId) {
    const runtimeCacheDir = path.join(app.getPath("userData"), "plugin-runtime-cache", pluginId);
    mkdirSync(runtimeCacheDir, {recursive: true});
    const bootstrapPath = path.join(runtimeCacheDir, "host_runtime_bootstrap.cjs");
    const source = buildPluginRuntimeBootstrapSource();
    let shouldWrite = true;
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
