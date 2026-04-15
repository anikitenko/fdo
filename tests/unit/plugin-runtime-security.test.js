import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

jest.mock("electron", () => ({
    app: {
        getPath: jest.fn(() => "/tmp"),
    },
}));

import {
    buildPluginRuntimeBootstrapSource,
    buildPluginInitPayload,
    HOST_PLUGIN_API_VERSION,
    resolveHostGrantedCapabilities,
} from "../../src/utils/pluginRuntimeSecurity";
import {buildRuntimeSecurityPolicy} from "../../src/utils/pluginCapabilities";

describe("plugin runtime security", () => {
    test("resolves default and filtered capability grants", () => {
        expect(resolveHostGrantedCapabilities(undefined)).toEqual([]);
        expect(resolveHostGrantedCapabilities({pluginCapabilities: ["storage.json"]})).toEqual(["storage.json"]);
        expect(resolveHostGrantedCapabilities({envCapabilities: "storage.json,unknown"})).toEqual(["storage.json"]);
        expect(buildPluginInitPayload(["storage.json"])).toEqual({
            apiVersion: HOST_PLUGIN_API_VERSION,
            capabilities: ["storage.json"],
        });
    });

    test("blocks privileged module imports without sudo capability and always blocks writes to PLUGIN_CODE_HOME", () => {
        const result = runBootstrapPolicy("storage.json");
        expect(result.childProcess).toBe("blocked");
        expect(result.codeWrite).toBe("blocked");
        expect(result.homeWrite).toBe("allowed");
    });

    test("allows privileged module import with sudo capability while still blocking writes to PLUGIN_CODE_HOME", () => {
        const result = runBootstrapPolicy("storage.json,sudo.prompt");
        expect(result.childProcess).toBe("allowed");
        expect(result.codeWrite).toBe("blocked");
        expect(result.homeWrite).toBe("allowed");
    });

    test("blocks outbound network APIs without network capability grants", () => {
        const result = runBootstrapPolicy("storage.json");
        expect(result.fetch).toBe("blocked");
        expect(result.http).toBe("blocked");
        expect(result.https).toBe("blocked");
        expect(result.net).toBe("blocked");
        expect(result.dns).toBe("blocked");
    });

    test("blocks HTTPS fetch without a matching network scope even when transport is granted", () => {
        const result = runBootstrapPolicy("storage.json,system.network,system.network.https");
        expect(result.fetch).toBe("blocked");
        expect(result.https).toBe("allowed");
        expect(result.httpsRequest).toBe("blocked");
        expect(result.http2Connect).toBe("blocked");
    });

    test("allows HTTPS and HTTP network APIs with matching grants while still blocking raw sockets by default", () => {
        const result = runBootstrapPolicy("storage.json,system.network,system.network.https,system.network.http,system.network.scope.public-web-secure,system.network.scope.public-web-legacy");
        expect(result.fetch).toBe("allowed");
        expect(result.http).toBe("allowed");
        expect(result.https).toBe("allowed");
        expect(result.net).toBe("blocked");
        expect(result.dns).toBe("blocked");
    });

    test("allows low-level DNS and TCP modules only when explicitly granted", () => {
        const result = runBootstrapPolicy("storage.json,system.network,system.network.tcp,system.network.dns,system.network.scope.loopback-dev");
        expect(result.net).toBe("allowed");
        expect(result.dns).toBe("allowed");
        expect(result.http).toBe("blocked");
        expect(result.tlsConnect).toBe("allowed");
    });

    test("blocks internal bindings and worker threads as runtime escape hatches", () => {
        const result = runBootstrapPolicy("storage.json,system.network,system.network.https,system.network.scope.public-web-secure");
        expect(result.processBinding).toBe("blocked");
        expect(result.workerThreads).toBe("blocked");
    });

    test("exposes SDK-compatible createBackendReq bridge in backend runtime", () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-plugin-bridge-"));
        try {
            const bootstrapPath = path.join(tempRoot, "bootstrap.cjs");
            const runtimeEntry = path.join(tempRoot, "plugin-entry.cjs");
            fs.writeFileSync(bootstrapPath, buildPluginRuntimeBootstrapSource(), "utf8");
            fs.writeFileSync(runtimeEntry, `
process.stdout.write(JSON.stringify({
  hasWindow: typeof globalThis.window === "object",
  hasCreateBackendReq: typeof globalThis.window?.createBackendReq === "function"
}));
`, "utf8");

            const execution = spawnSync(process.execPath, [bootstrapPath], {
                encoding: "utf8",
                env: {
                    ...process.env,
                    FDO_PLUGIN_RUNTIME_ENTRY: runtimeEntry,
                    FDO_PLUGIN_CAPABILITIES: "storage.json",
                    FDO_PLUGIN_POLICY_JSON: JSON.stringify(buildRuntimeSecurityPolicy(["storage.json"])),
                    FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT: "1",
                    PLUGIN_HOME: path.join(tempRoot, "plugin-home"),
                    PLUGIN_CODE_HOME: path.join(tempRoot, "plugin-code"),
                },
            });

            expect(execution.status).toBe(0);
            expect(JSON.parse((execution.stdout || "").trim())).toEqual({
                hasWindow: true,
                hasCreateBackendReq: true,
            });
        } finally {
            fs.rmSync(tempRoot, {recursive: true, force: true});
        }
    });

    test("backend bridge preserves nested UI_MESSAGE handler payloads", () => {
        const source = buildPluginRuntimeBootstrapSource();
        expect(source).toContain('type === "UI_MESSAGE"');
        expect(source).toContain("data.handler");
        expect(source).toContain('Object.prototype.hasOwnProperty.call(data, "content")');
    });
});

function runBootstrapPolicy(capabilitiesCsv) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-plugin-security-"));
    const pluginHome = path.join(tempRoot, "plugin-home");
    const pluginCodeHome = path.join(tempRoot, "plugin-code");
    fs.mkdirSync(pluginHome, {recursive: true});
    fs.mkdirSync(pluginCodeHome, {recursive: true});

    const bootstrapPath = path.join(tempRoot, "bootstrap.cjs");
    const runtimeEntry = path.join(tempRoot, "plugin-entry.cjs");
    fs.writeFileSync(bootstrapPath, buildPluginRuntimeBootstrapSource(), "utf8");
    fs.writeFileSync(runtimeEntry, `
const fs = require("node:fs");
const path = require("node:path");
const result = {};

try {
    require("node:child_process");
    result.childProcess = "allowed";
} catch (_) {
    result.childProcess = "blocked";
}

try {
    fs.writeFileSync(path.join(process.env.PLUGIN_CODE_HOME, "tamper.txt"), "x");
    result.codeWrite = "allowed";
} catch (_) {
    result.codeWrite = "blocked";
}

try {
    fs.writeFileSync(path.join(process.env.PLUGIN_HOME, "state.txt"), "ok");
    result.homeWrite = "allowed";
} catch (_) {
    result.homeWrite = "blocked";
}

try {
    if (typeof fetch !== "function") {
        throw new Error("fetch-unavailable");
    }
    Promise.resolve(fetch("https://example.com")).catch(() => undefined);
    result.fetch = "allowed";
} catch (_) {
    result.fetch = "blocked";
}

try {
    require("node:http");
    result.http = "allowed";
} catch (_) {
    result.http = "blocked";
}

try {
    require("node:https");
    result.https = "allowed";
} catch (_) {
    result.https = "blocked";
}

try {
    const req = require("node:https").request("https://example.com");
    req.on("error", () => {});
    req.destroy();
    result.httpsRequest = "allowed";
} catch (_) {
    result.httpsRequest = "blocked";
}

try {
    const session = require("node:http2").connect("https://example.com");
    session.on("error", () => {});
    session.close();
    result.http2Connect = "allowed";
} catch (_) {
    result.http2Connect = "blocked";
}

try {
    require("node:net");
    result.net = "allowed";
} catch (_) {
    result.net = "blocked";
}

try {
    require("node:dns");
    result.dns = "allowed";
} catch (_) {
    result.dns = "blocked";
}

try {
    const socket = require("node:tls").connect({host: "127.0.0.1", port: 65535});
    socket.on("error", () => {});
    socket.destroy();
    result.tlsConnect = "allowed";
} catch (_) {
    result.tlsConnect = "blocked";
}

try {
    process.binding("fs");
    result.processBinding = "allowed";
} catch (_) {
    result.processBinding = "blocked";
}

try {
    require("node:worker_threads");
    result.workerThreads = "allowed";
} catch (_) {
    result.workerThreads = "blocked";
}

process.stdout.write(JSON.stringify(result));
`, "utf8");

    const execution = spawnSync(process.execPath, [bootstrapPath], {
        encoding: "utf8",
        env: {
            ...process.env,
            FDO_PLUGIN_RUNTIME_ENTRY: runtimeEntry,
            FDO_PLUGIN_CAPABILITIES: capabilitiesCsv,
            FDO_PLUGIN_POLICY_JSON: JSON.stringify(
                buildRuntimeSecurityPolicy(
                    capabilitiesCsv.split(",").map((entry) => entry.trim()).filter(Boolean)
                )
            ),
            FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT: "1",
            PLUGIN_HOME: pluginHome,
            PLUGIN_CODE_HOME: pluginCodeHome,
        },
    });

    try {
        expect(execution.status).toBe(0);
        const output = (execution.stdout || "").trim();
        expect(output.length).toBeGreaterThan(0);
        return JSON.parse(output);
    } finally {
        fs.rmSync(tempRoot, {recursive: true, force: true});
    }
}
