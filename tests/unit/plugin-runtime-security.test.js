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
