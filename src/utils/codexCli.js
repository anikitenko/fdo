import fs from "fs";
import path from "path";
import { app } from "electron";
import { lookpath } from "lookpath";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";

const execFileAsync = promisify(execFile);
const MIN_SAFE_BUNDLED_CODEX_VERSION = "0.116.0";
const helpCache = new Map();

function parseSemver(version = "") {
    const match = String(version || "").trim().match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return match.slice(1, 4).map((value) => Number(value));
}

function compareSemver(left = "", right = "") {
    const a = parseSemver(left);
    const b = parseSemver(right);
    if (!a || !b) return 0;
    for (let i = 0; i < 3; i += 1) {
        if (a[i] > b[i]) return 1;
        if (a[i] < b[i]) return -1;
    }
    return 0;
}

function executableExists(candidate = "") {
    return !!candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

function ensureExecutablePermissions(candidate = "") {
    if (process.platform === "win32" || !candidate || !fs.existsSync(candidate)) return;
    try {
        const stat = fs.statSync(candidate);
        const mode = stat.mode & 0o777;
        if ((mode & 0o111) === 0) {
            fs.chmodSync(candidate, 0o755);
        }
    } catch {
        // Best-effort only.
    }
}

function buildInvocation(command = "", baseArgs = []) {
    const normalizedBaseArgs = Array.isArray(baseArgs) ? baseArgs : [];
    if (String(command).endsWith(".js")) {
        return {
            command: process.execPath,
            args: [command, ...normalizedBaseArgs],
            entrypoint: command,
            env: {
                ELECTRON_RUN_AS_NODE: "1",
            },
        };
    }
    return {
        command,
        args: normalizedBaseArgs,
        entrypoint: command,
        env: {},
    };
}

function getBundledCodexCandidates() {
    const candidates = [];
    const names = process.platform === "win32"
        ? ["codex.cmd", "codex.exe", "codex", "codex.js"]
        : ["codex", "codex.js"];
    const roots = [];

    if (app?.isPackaged && process.resourcesPath) {
        roots.push(path.join(process.resourcesPath, "app.asar.unpacked"));
        roots.push(process.resourcesPath);
    }

    for (const root of roots) {
        candidates.push(
            path.join(root, "dist", "main", "node_modules", ".bin"),
            path.join(root, "node_modules", ".bin"),
            path.join(root, "dist", "main", "node_modules", "@openai", "codex", "bin"),
            path.join(root, "node_modules", "@openai", "codex", "bin"),
        );
    }

    const resolved = [];
    for (const dir of candidates) {
        for (const name of names) {
            const full = path.join(dir, name);
            if (executableExists(full) && !resolved.includes(full)) {
                resolved.push(full);
            }
        }
    }
    return resolved;
}

function getBundledPlatformPackageName() {
    if (process.platform === "darwin" && process.arch === "arm64") return "codex-darwin-arm64";
    if (process.platform === "darwin" && process.arch === "x64") return "codex-darwin-x64";
    if (process.platform === "linux" && process.arch === "arm64") return "codex-linux-arm64";
    if (process.platform === "linux" && process.arch === "x64") return "codex-linux-x64";
    if (process.platform === "win32" && process.arch === "arm64") return "codex-win32-arm64";
    if (process.platform === "win32" && process.arch === "x64") return "codex-win32-x64";
    return "";
}

function repairBundledCodexPermissions(rootPackagePath = "") {
    if (!rootPackagePath || process.platform === "win32") return;
    const openaiDir = path.dirname(path.dirname(rootPackagePath));
    const platformPackageName = getBundledPlatformPackageName();
    if (!platformPackageName) return;
    const platformDir = path.join(openaiDir, platformPackageName);
    if (!fs.existsSync(platformDir)) return;

    const vendorRoot = path.join(platformDir, "vendor");
    try {
        const triples = fs.readdirSync(vendorRoot);
        for (const triple of triples) {
            ensureExecutablePermissions(path.join(vendorRoot, triple, "codex", "codex"));
            ensureExecutablePermissions(path.join(vendorRoot, triple, "path", "rg"));
        }
    } catch {
        // Best-effort only.
    }
}

function findNearestPackageJson(executablePath = "") {
    let current = path.dirname(executablePath);
    for (let i = 0; i < 6; i += 1) {
        const pkg = path.join(current, "package.json");
        if (fs.existsSync(pkg)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(pkg, "utf8"));
                if (parsed?.name === "@openai/codex") {
                    return { path: pkg, version: parsed.version || "" };
                }
            } catch {
                return null;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

async function readExecutableVersion(command = "", baseArgs = []) {
    const invocation = buildInvocation(command, baseArgs);
    const { stdout, stderr } = await execFileAsync(invocation.command, [...invocation.args, "--version"], {
        env: { ...process.env, ...(invocation.env || {}) },
    });
    const output = `${stdout || ""}\n${stderr || ""}`;
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] || "";
}

async function readExecHelp(command = "", baseArgs = []) {
    const cacheKey = `${command}::${(baseArgs || []).join("\u0000")}`;
    if (helpCache.has(cacheKey)) {
        return helpCache.get(cacheKey);
    }
    const invocation = buildInvocation(command, baseArgs);
    try {
        const { stdout, stderr } = await execFileAsync(invocation.command, [...invocation.args, "exec", "--help"], {
            env: { ...process.env, ...(invocation.env || {}) },
        });
        const output = `${stdout || ""}\n${stderr || ""}`;
        helpCache.set(cacheKey, output);
        return output;
    } catch {
        helpCache.set(cacheKey, "");
        return "";
    }
}

async function detectExecCapabilities(command = "", baseArgs = []) {
    const helpText = await readExecHelp(command, baseArgs);
    return {
        supportsAskForApproval: /--ask-for-approval\b/.test(helpText),
        supportsSandbox: /--sandbox\b/.test(helpText),
    };
}

function normalizeCodexAuthState(output = "", error = "", code = 0) {
    const text = `${output || ""}\n${error || ""}`.trim();
    if (/401 Unauthorized|not logged in|login required|sign in/i.test(text)) {
        return {
            status: "unauthorized",
            message: text || "Codex CLI is not authenticated.",
        };
    }
    if (code === 0 && /logged in|chatgpt|api key|authenticated|subscription/i.test(text)) {
        return {
            status: "authorized",
            message: text || "Codex CLI is authenticated.",
        };
    }
    return {
        status: "unknown",
        message: text || "Unable to determine Codex authentication state.",
    };
}

export async function readCodexAuthStatus(invocation) {
    try {
        const { stdout, stderr } = await execFileAsync(invocation.command, [...(invocation.args || []), "login", "status"], {
            env: { ...process.env, ...(invocation.env || {}) },
        });
        return normalizeCodexAuthState(stdout, stderr, 0);
    } catch (error) {
        const stdout = error?.stdout || "";
        const stderr = error?.stderr || error?.message || "";
        return normalizeCodexAuthState(stdout, stderr, error?.code ?? 1);
    }
}

export async function startCodexLogin(invocation) {
    const quoted = `"${invocation.command}" login`;
    if (process.platform === "darwin") {
        const script = `tell application "Terminal" to do script ${JSON.stringify(`${quoted}`)}\ntell application "Terminal" to activate`;
        spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
        return { started: true, mode: "terminal" };
    }
    if (process.platform === "win32") {
        spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", `${quoted}`], { detached: true, stdio: "ignore" }).unref();
        return { started: true, mode: "terminal" };
    }

    const linuxTerminals = [
        ["x-terminal-emulator", ["-e", "sh", "-lc", `${quoted}; printf '\\n'; read -r _`]],
        ["gnome-terminal", ["--", "sh", "-lc", `${quoted}; printf '\\n'; read -r _`]],
        ["konsole", ["-e", "sh", "-lc", `${quoted}; printf '\\n'; read -r _`]],
        ["xterm", ["-e", "sh", "-lc", `${quoted}; printf '\\n'; read -r _`]],
    ];
    for (const [command, args] of linuxTerminals) {
        try {
            spawn(command, args, { detached: true, stdio: "ignore" }).unref();
            return { started: true, mode: "terminal" };
        } catch {
            // try next terminal
        }
    }
    throw new Error("Unable to launch a terminal for Codex login on this system.");
}

export async function runCodexLogout(invocation) {
    try {
        const { stdout, stderr } = await execFileAsync(invocation.command, [...(invocation.args || []), "logout"], {
            env: { ...process.env, ...(invocation.env || {}) },
        });
        return {
            status: "unauthorized",
            message: `${stdout || ""}\n${stderr || ""}`.trim() || "Codex CLI logged out.",
        };
    } catch (error) {
        const message = `${error?.stdout || ""}\n${error?.stderr || ""}\n${error?.message || ""}`.trim();
        throw new Error(message || "Codex logout failed.");
    }
}

function assertSafeBundledVersion(version = "", details = {}) {
    const location = details.packagePath || details.command || "unknown location";
    if (!version || compareSemver(version, MIN_SAFE_BUNDLED_CODEX_VERSION) < 0) {
        throw new Error(
            `Bundled Codex runtime is blocked because version ${version || "unknown"} at ${location} is below the minimum safe version ${MIN_SAFE_BUNDLED_CODEX_VERSION}.`
        );
    }
}

export async function resolveCodexCliInvocation({ configuredPath = "", preferBundled = true } = {}) {
    const configured = String(configuredPath || "").trim();
    if (configured) {
        const invocation = buildInvocation(configured);
        ensureExecutablePermissions(configured);
        const version = await readExecutableVersion(configured);
        const execCapabilities = await detectExecCapabilities(configured);
        return {
            command: invocation.command,
            args: invocation.args,
            entrypoint: invocation.entrypoint,
            env: invocation.env,
            source: "configured",
            version,
            bundled: false,
            execCapabilities,
        };
    }

    if (preferBundled) {
        for (const candidate of getBundledCodexCandidates()) {
            const invocation = buildInvocation(candidate);
            const packageInfo = findNearestPackageJson(candidate);
            ensureExecutablePermissions(candidate);
            repairBundledCodexPermissions(packageInfo?.path || "");
            const version = packageInfo?.version || await readExecutableVersion(candidate);
            const execCapabilities = await detectExecCapabilities(candidate);
            assertSafeBundledVersion(version, {
                command: candidate,
                packagePath: packageInfo?.path || null,
            });
            return {
                command: invocation.command,
                args: invocation.args,
                entrypoint: invocation.entrypoint,
                env: invocation.env,
                source: "bundled",
                version,
                bundled: true,
                packagePath: packageInfo?.path || null,
                execCapabilities,
            };
        }
    }

    const detected = await lookpath("codex");
    if (!detected) {
        throw new Error("Codex CLI was not found. Install Codex or provide an executable path.");
    }

    const invocation = buildInvocation(detected);
    ensureExecutablePermissions(detected);
    const version = await readExecutableVersion(detected);
    const execCapabilities = await detectExecCapabilities(detected);
    return {
        command: invocation.command,
        args: invocation.args,
        entrypoint: invocation.entrypoint,
        env: invocation.env,
        source: "path",
        version,
        bundled: false,
        execCapabilities,
    };
}

export function getCodexCliSecurityInfo() {
    return {
        minSafeBundledVersion: MIN_SAFE_BUNDLED_CODEX_VERSION,
        packaged: !!app?.isPackaged,
        bundledCandidates: getBundledCodexCandidates(),
    };
}
