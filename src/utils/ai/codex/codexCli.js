import fs from "fs";
import path from "path";

import { lookpath } from "lookpath";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const MIN_CODEX_VERSION = "0.162.1";


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

export function getCodexPlatformPackageName(platform = process.platform, architecture = process.arch) {
    if (platform === "darwin" && architecture === "arm64") return "codex-darwin-arm64";
    if (platform === "darwin" && architecture === "x64") return "codex-darwin-x64";
    if (platform === "linux" && architecture === "arm64") return "codex-linux-arm64";
    if (platform === "linux" && architecture === "x64") return "codex-linux-x64";
    if (platform === "win32" && architecture === "arm64") return "codex-win32-arm64";
    if (platform === "win32" && architecture === "x64") return "codex-win32-x64";
    return "";
}

function getNpmNativeRuntime(rootPackagePath = "") {
    if (!rootPackagePath) return null;
    const openaiDir = path.dirname(path.dirname(rootPackagePath));
    const platformPackageName = getCodexPlatformPackageName();
    if (!platformPackageName) return null;
    const nested = path.join(path.dirname(rootPackagePath), "node_modules/@openai", platformPackageName);
    const platformDir = fs.existsSync(nested) ? nested : path.join(openaiDir, platformPackageName);
    const vendorRoot = path.join(platformDir, "vendor");
    if (!fs.existsSync(vendorRoot)) return null;

    try {
        const triples = fs.readdirSync(vendorRoot);
        for (const triple of triples) {
            const executable = process.platform === "win32" ? "codex.exe" : "codex";
            const binary = ["bin", "codex"].map(dir => path.join(vendorRoot, triple, dir, executable)).find(candidate => fs.existsSync(candidate));
            const pathDir = path.join(vendorRoot, triple, "path");
            if (binary) {
                return { binary, pathDir: fs.existsSync(pathDir) ? pathDir : "" };
            }
        }
    } catch {
        return null;
    }
    return null;
}

function findNearestPackageJson(executablePath = "") {
    // npm's .bin/codex is a symlink. Its package metadata lives beside the
    // resolved wrapper, not beside .bin or the application's package.json.
    let resolved = executablePath;
    try { resolved = fs.realpathSync(executablePath); } catch { /* Keep discovery diagnostics for missing paths. */ }
    let current = path.dirname(resolved);
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
        timeout: 5000, env: { ...process.env, ...(invocation.env || {}) },
    });
    const output = `${stdout || ""}\n${stderr || ""}`;
    const match = output.match(/^codex(?:-cli)?\s+(\d+\.\d+\.\d+)/);
    return match?.[1] || "";
}

async function readExecHelp(command = "", baseArgs = []) {
    const invocation = buildInvocation(command, baseArgs);
    try {
        const { stdout, stderr } = await execFileAsync(invocation.command, [...invocation.args, "exec", "--help"], {
            timeout: 5000,
            env: { ...process.env, ...(invocation.env || {}) },
        });
        const output = `${stdout || ""}\n${stderr || ""}`;
        return output;
    } catch {
        return "";
    }
}

async function detectExecCapabilities(command = "", baseArgs = []) {
    const helpText = await readExecHelp(command, baseArgs);
    return {
        supportsAskForApproval: /--ask-for-approval\b/.test(helpText),
        supportsSandbox: /--sandbox\b/.test(helpText),
        supportsSkipGitRepoCheck: /--skip-git-repo-check\b/.test(helpText),
        supportsModel: /--model\b/.test(helpText),
        supportsJson: /--json\b/.test(helpText),
    };
}

function normalizeCodexAuthState(output = "", error = "", code = 0) {
    const text = `${output || ""}\n${error || ""}`.trim();
    const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "";
    if (/EACCES/i.test(text)) {
        return {
            status: "error",
            message: "FDO cannot execute the selected Codex CLI. Check the installation and its file permissions.",
        };
    }
    if (/401 Unauthorized|not logged in|login required|sign in/i.test(text)) {
        return {
            status: "unauthorized",
            message: firstLine || "Codex CLI is not authenticated.",
        };
    }
    if (code === 0 && /logged in|chatgpt|api key|authenticated|subscription/i.test(text)) {
        return {
            status: "authorized",
            message: firstLine || "Codex CLI is authenticated.",
        };
    }
    return {
        status: "unknown",
        message: firstLine || "Unable to determine Codex authentication state.",
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

export async function verifyCodexModelAccess(invocation, model = "") {
    const trimmedModel = String(model || "").trim();
    if (!trimmedModel) {
        return { ok: false, message: "Codex model is required." };
    }

    const args = [...(invocation.args || []), "exec"];
    if (invocation.execCapabilities?.supportsAskForApproval) {
        args.push("--ask-for-approval", "never");
    }
    if (invocation.execCapabilities?.supportsSandbox) {
        args.push("--sandbox", "read-only");
    }
    if (invocation.execCapabilities?.supportsSkipGitRepoCheck) {
        args.push("--skip-git-repo-check");
    }
    if (invocation.execCapabilities?.supportsModel) {
        args.push("--model", trimmedModel);
    }
    args.push("Reply with exactly OK.");

    try {
        await execFileAsync(invocation.command, args, {
            env: { ...process.env, ...(invocation.env || {}) },
            timeout: 20_000,
            maxBuffer: 1024 * 1024,
        });
        return { ok: true, message: `Codex model ${trimmedModel} verified.` };
    } catch (error) {
        const stderr = `${error?.stdout || ""}\n${error?.stderr || ""}\n${error?.message || ""}`.trim();
        const normalized = normalizeCodexAuthState(error?.stdout || "", stderr, error?.code ?? 1);
        if (normalized.status === "unauthorized") {
            return {
                ok: false,
                authRelated: true,
                message: "Codex authentication is required before model verification can complete.",
            };
        }
        if (/timed out/i.test(stderr) || error?.killed) {
            return {
                ok: false,
                message: `Timed out while verifying Codex model ${trimmedModel}. Try again after authentication finishes.`,
            };
        }
        // CLI diagnostics print the selected model even on unrelated failures.
        // Only classify explicit model rejection messages as access failures.
        if (/(?:model[^\n]*(?:not supported|unsupported|not found|does not exist|not available|access denied)|(?:unknown|unsupported|invalid) model)/i.test(stderr)) {
            return {
                ok: false,
                message: `Codex could not use model ${trimmedModel}. Check the selected model and your account access.`,
            };
        }
        return {
            ok: false,
            message: `Codex model verification failed for ${trimmedModel}. ${stderr.split("\n").map((line) => line.trim()).find(Boolean) || ""}`.trim(),
        };
    }
}

// Resolve npm shims to the native binary so isolation never needs a shell or Node wrapper.
export async function resolveCodexCliInvocation({configuredPath = ""} = {}) {
    const selected = configuredPath || await lookpath("codex");
    if (!selected || !path.isAbsolute(selected) || !executableExists(selected)) {
        throw new Error("Install Codex CLI or choose its executable in AI Assistants.");
    }
    const entrypoint = fs.realpathSync(selected);
    let pkg = findNearestPackageJson(entrypoint);
    if (!pkg && process.platform === "win32" && /codex(?:\.cmd|\.ps1)?$/i.test(entrypoint)) {
        const wrapper = path.join(path.dirname(entrypoint), "node_modules/@openai/codex/bin/codex.js");
        if (executableExists(wrapper)) pkg = findNearestPackageJson(wrapper);
    }
    const native = pkg && getNpmNativeRuntime(pkg.path);
    const command = fs.realpathSync(native?.binary || entrypoint);
    if (!/^codex(?:-(?:aarch64|x86_64)-(?:apple-darwin|unknown-linux-(?:gnu|musl)|pc-windows-msvc))?(?:\.exe)?$/i.test(path.basename(command))) throw new Error("Choose the native Codex CLI executable or its npm installation.");
    const header = Buffer.alloc(4);
    const fd = fs.openSync(command, 'r');
    try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
    const magic = header.toString('hex');
    const valid = process.platform === 'win32' ? magic.startsWith('4d5a') : process.platform === 'linux' ? magic === '7f454c46' : ['cffaedfe','feedfacf','cafebabe','cafebabf'].includes(magic);
    if (!valid) throw new Error("Select a native Codex executable. Scripts cannot run in FDO's isolated coding session.");
    const version = await readExecutableVersion(command);
    if (!version || compareSemver(version, MIN_CODEX_VERSION) < 0) throw new Error(`Codex CLI ${MIN_CODEX_VERSION} or later is required. Check your local installation.`);
    const execCapabilities = await detectExecCapabilities(command);
    if (!execCapabilities.supportsSandbox || !execCapabilities.supportsJson || !execCapabilities.supportsModel) throw new Error("This Codex installation lacks the required exec sandbox, JSON or model options.");
    return {command, entrypoint: selected, args: [], env: {}, source: configuredPath ? 'configured' : 'path', native: true, bundled: false, version, execCapabilities};
}
