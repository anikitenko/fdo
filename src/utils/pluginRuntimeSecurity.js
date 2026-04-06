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

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (blockedModules.has(request)) {
        const parentFile = typeof parent?.filename === "string" ? parent.filename : "";
        const isSdkInternalImport = parentFile.includes("@anikitenko/fdo-sdk");
        if (!isSdkInternalImport) {
        deny(\`[host-policy] Import "\${request}" is denied by host capability policy.\`);
        }
    }
    return originalLoad.call(this, request, parent, isMain);
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
