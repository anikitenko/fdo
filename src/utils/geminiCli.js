import fs from "node:fs";
import path from "node:path";
import {app} from "electron";
import {lookpath} from "lookpath";
import {homedir} from "node:os";
import {promisify} from "node:util";
import {execFile, spawn} from "node:child_process";

const execFileAsync = promisify(execFile);
const GEMINI_AUTH_PROBE_CACHE_TTL_MS = 30_000;
const geminiAuthProbeCache = new Map();
const GEMINI_KEYCHAIN_SERVICE = "gemini-cli-oauth";
const GEMINI_KEYCHAIN_ACCOUNT = "main-account";

function executableExists(candidate = "") {
    if (!candidate) return false;
    try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch (_) {
        return false;
    }
}

function buildInvocation(command = "") {
    const normalizedCommand = String(command || "").trim();
    if (!normalizedCommand) {
        throw new Error("Gemini CLI command path is empty.");
    }
    if (normalizedCommand.endsWith(".js")) {
        return {
            command: process.execPath,
            args: [normalizedCommand],
            entrypoint: normalizedCommand,
            env: {
                ELECTRON_RUN_AS_NODE: "1",
            },
        };
    }
    return {
        command: normalizedCommand,
        args: [],
        entrypoint: normalizedCommand,
        env: {},
    };
}

export async function resolveGeminiCliInvocation(options = {}) {
    const configuredPath = String(options?.configuredPath || "").trim();
    const preferBundled = options?.preferBundled !== false;
    if (configuredPath) {
        if (!executableExists(configuredPath)) {
            throw new Error(`Configured Gemini CLI executable was not found at "${configuredPath}".`);
        }
        return {
            ...buildInvocation(configuredPath),
            source: "configured",
            bundled: false,
            version: "",
        };
    }

    if (preferBundled) {
        const bundledCandidate = getBundledGeminiCandidate();
        if (bundledCandidate) {
            return {
                ...buildInvocation(bundledCandidate),
                source: "bundled",
                bundled: true,
                version: "",
            };
        }
    }

    const discoveredPath = await lookpath("gemini");
    if (!discoveredPath) {
        throw new Error("Gemini CLI was not found on PATH. Install Gemini CLI or configure an executable path.");
    }

    return {
        ...buildInvocation(discoveredPath),
        source: "path",
        bundled: false,
        version: "",
    };
}

function getBundledGeminiCandidate() {
    const names = process.platform === "win32"
        ? ["gemini.cmd", "gemini.exe", "gemini", "gemini.js"]
        : ["gemini", "gemini.js"];
    const candidateDirs = [];
    if (!app?.isPackaged) {
        const appRoot = app?.getAppPath?.() || process.cwd();
        candidateDirs.push(
            path.join(appRoot, "dist", "main", "node_modules", ".bin"),
            path.join(appRoot, "node_modules", ".bin"),
            path.join(appRoot, "dist", "main", "node_modules", "@google", "gemini-cli", "bin"),
            path.join(appRoot, "node_modules", "@google", "gemini-cli", "bin")
        );
    } else if (process.resourcesPath) {
        const root = path.join(process.resourcesPath, "app.asar.unpacked");
        candidateDirs.push(
            path.join(root, "dist", "main", "node_modules", ".bin"),
            path.join(root, "dist", "main", "node_modules", "@google", "gemini-cli", "bin")
        );
    }
    for (const dir of candidateDirs) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (executableExists(candidate)) {
                return candidate;
            }
        }
    }
    return "";
}

export function getGeminiCliModels() {
    const models = [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
    ];
    return models.map((modelId, index) => ({
        label: index === 0 ? `${modelId} (Recommended)` : modelId,
        value: modelId,
        provider: "gemini-cli",
    }));
}

export async function fetchGeminiCliModels() {
    const fallback = getGeminiCliModels();
    try {
        const response = await fetch("https://ai.google.dev/gemini-api/docs/models", {
            headers: {
                "User-Agent": "FDO/1.0 Gemini Model Loader",
                "Accept": "text/html,application/xhtml+xml",
            },
        });
        if (!response.ok) {
            throw new Error(`Gemini model catalog request failed with status ${response.status}.`);
        }

        const html = await response.text();
        const matches = html.match(/\bgemini-(?:\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?)\b/gi) || [];
        const unique = Array.from(new Set(matches.map((model) => model.trim().toLowerCase())))
            .filter((model) => model.startsWith("gemini-"));
        const models = unique
            .sort((left, right) => right.localeCompare(left, undefined, {numeric: true, sensitivity: "base"}));

        if (models.length === 0) {
            return fallback;
        }

        const recommendedModel =
            models.find((modelId) => modelId === "gemini-2.5-pro")
            || models.find((modelId) => modelId === "gemini-2.5-flash")
            || models[0];

        return models.map((modelId) => ({
            label: modelId === recommendedModel ? `${modelId} (Recommended)` : modelId,
            value: modelId,
            provider: "gemini-cli",
        }));
    } catch (_) {
        return fallback;
    }
}

export function normalizeGeminiAuthState({ hasEnvCredentials = false, hasCachedCredentials = false, message = "" } = {}) {
    if (hasEnvCredentials) {
        return {
            status: "authorized",
            message: message || "Gemini authentication is active.",
        };
    }
    
    // Even if we have cached files, we don't claim "authorized" yet.
    // readGeminiAuthStatus will proceed to run a probe to be certain.
    return {
        status: "unauthorized",
        message: message || "Sign in with Gemini in a terminal window to authenticate.",
    };
}

export function getGeminiCredentialFilePaths() {
    const home = homedir();
    const paths = [
        path.join(home, ".gemini", "gemini-credentials.json"),
        path.join(home, ".gemini", "oauth_creds.json"),
        path.join(home, ".gemini", "google_accounts.json"),
        path.join(home, ".gemini", "state.json"),
        path.join(home, ".gemini", "projects.json"),
        path.join(home, ".gemini", "credentials.json"),
        path.join(home, ".gemini", "access_tokens.json"),
        path.join(home, ".gemini", "installation_id"),
    ];

    // OS-specific configuration directories where gemini-cli might store state
    if (process.platform === "darwin") {
        const appSupport = path.join(home, "Library", "Application Support", "gemini-cli");
        paths.push(path.join(appSupport, "credentials.json"));
        paths.push(path.join(appSupport, "state.json"));
        paths.push(path.join(appSupport, "google_accounts.json"));
    } else if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        const geminiDir = path.join(appData, "gemini-cli");
        paths.push(path.join(geminiDir, "credentials.json"));
        paths.push(path.join(geminiDir, "state.json"));
        paths.push(path.join(geminiDir, "google_accounts.json"));
    } else {
        // Linux/Unix/BSD (XDG compliant)
        const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
        const geminiDir = path.join(configHome, "gemini-cli");
        paths.push(path.join(geminiDir, "credentials.json"));
        paths.push(path.join(geminiDir, "state.json"));
        paths.push(path.join(geminiDir, "google_accounts.json"));

        const dataHome = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
        paths.push(path.join(dataHome, "gemini-cli", "state.json"));
    }

    return Array.from(new Set(paths)); // Unique paths only
}

function detectGeminiEnvironmentCredentials() {
    return Boolean(
        String(process.env.GEMINI_API_KEY || "").trim()
        || String(process.env.GOOGLE_API_KEY || "").trim()
        || String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim()
    );
}

function clearGeminiEnvironmentCredentialsForSession() {
    const keys = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"];
    const cleared = [];
    for (const key of keys) {
        if (String(process.env[key] || "").trim()) {
            delete process.env[key];
            cleared.push(key);
        }
    }
    return cleared;
}

export function detectGeminiCachedCredentials() {
    return getGeminiCredentialFilePaths().some((filePath) => {
        try {
            // We consider it a credential file if it contains something that looks like an access token or API key
            // but for now, we'll stick to existence and size for the known locations.
            // Only check files that are likely to contain actual credentials.
            const name = path.basename(filePath);
            const isDefinitiveCredentialFile = [
                "gemini-credentials.json",
                "oauth_creds.json",
                "credentials.json",
            ].includes(name);

            if (!isDefinitiveCredentialFile) return false;

            return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
        } catch (_) {
            return false;
        }
    });
}

function readGeminiOAuthCredentialSnapshot() {
    const preferredNames = [
        "oauth_creds.json",
        "gemini-credentials.json",
        "credentials.json",
    ];
    const candidates = getGeminiCredentialFilePaths().filter((filePath) =>
        preferredNames.includes(path.basename(filePath))
    );
    for (const filePath of candidates) {
        try {
            if (!fs.existsSync(filePath)) continue;
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = JSON.parse(raw);
            const refreshToken = String(parsed?.refresh_token || "").trim();
            const accessToken = String(parsed?.access_token || "").trim();
            const expiryDate = Number(parsed?.expiry_date || 0);
            return {
                hasRefreshToken: Boolean(refreshToken),
                hasAccessToken: Boolean(accessToken),
                expiryDate: Number.isFinite(expiryDate) ? expiryDate : 0,
            };
        } catch (_) {
            // try next candidate
        }
    }
    return null;
}

function hasUsableGeminiOAuthCredentials(snapshot) {
    if (!snapshot) return false;
    if (snapshot.hasRefreshToken) return true;
    const minFutureMs = Date.now() + 60_000;
    return snapshot.hasAccessToken && snapshot.expiryDate > minFutureMs;
}

const GEMINI_AUTH_PROBE_TOKEN = "FDO_AUTH_PROBE_OK_77b2";

export function parseGeminiProbeOutput(text = "", token = GEMINI_AUTH_PROBE_TOKEN) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return false;

    const hasFailureHints = (value = "") =>
        /not authenticated|not logged in|login required|\bsign in\b|\bauthenticate\b|\boauth\b|unauthorized|access denied/i.test(String(value || ""));
    const hasSuccessHints = (value = "") =>
        /already logged in|already authenticated|authentication successful|authenticated successfully|logged in as|you are logged in|auth state:\s*authorized|signed in|you are signed in|you're signed in/i.test(String(value || ""));

    // If it contains a URL or explicit sign-in request, it's definitely not authorized
    if (/https?:\/\//.test(trimmed) || /\bsign in\b|\bauthenticate\b|\blogin\b|\boauth\b/i.test(trimmed)) {
        return false;
    }

    const lines = trimmed.split("\n");
    let foundJson = false;
    let foundOkInJson = false;

    for (const line of lines) {
        const l = line.trim();
        if (l.startsWith("{") && l.endsWith("}")) {
            try {
                const parsed = JSON.parse(l);
                foundJson = true;
                const content = String(parsed.content || parsed.text || "");
                // Allow the token to be present as a word (LLM might add filler/markdown)
                const regex = new RegExp(`\\b${token}\\b`);
                if (regex.test(content)) {
                    foundOkInJson = true;
                    break;
                }
                if (!hasFailureHints(content) && hasSuccessHints(content)) {
                    foundOkInJson = true;
                    break;
                }
            } catch { /* ignore */ }
        }
    }

    if (foundJson) {
        if (foundOkInJson) return true;
        if (!hasFailureHints(trimmed) && hasSuccessHints(trimmed)) return true;
        return false;
    }

    // Fallback for non-JSON output
    const regex = new RegExp(`\\b${token}\\b`);
    if (regex.test(trimmed) && !/error|fail|required|denied/i.test(trimmed)) {
        return true;
    }
    if (!hasFailureHints(trimmed) && hasSuccessHints(trimmed)) {
        return true;
    }
    return false;
}

export function clearGeminiAuthProbeCache() {
    geminiAuthProbeCache.clear();
}

export async function probeGeminiAuthViaCli(invocation) {
    const cacheKey = `${invocation?.command || ""}::${(invocation?.args || []).join("\u0000")}`;
    const now = Date.now();
    const cached = geminiAuthProbeCache.get(cacheKey);
    if (cached && (now - cached.ts) < GEMINI_AUTH_PROBE_CACHE_TTL_MS) {
        return cached.value;
    }

    let value = { status: "unknown", message: "Gemini authentication probe did not complete." };
    try {
        const cwd = getGeminiAuthWorkingDirectory();
        const { stdout, stderr } = await execFileAsync(
            invocation.command,
            [...(invocation.args || []), "-p", `Reply with exactly: ${GEMINI_AUTH_PROBE_TOKEN}`, "--output-format", "json"],
            {
                env: { ...process.env, ...(invocation.env || {}) },
                cwd,
                timeout: 7000,
                maxBuffer: 1024 * 1024,
            }
        );
        const text = `${stdout || ""}\n${stderr || ""}`.trim();
        const isAuthorized = parseGeminiProbeOutput(text, GEMINI_AUTH_PROBE_TOKEN);

        if (isAuthorized) {
            value = {
                status: "authorized",
                message: "Gemini authentication is active.",
            };
        } else {
            value = {
                status: "unauthorized",
                message: "Sign in with Gemini in a terminal window to authenticate.",
            };
        }
    } catch (error) {
        const text = `${error?.stdout || ""}\n${error?.stderr || ""}\n${error?.message || ""}`.toLowerCase();
        if (
            /opening authentication page|sign in|authenticate|login required|not authenticated|oauth/.test(text)
            || String(error?.killed || "") === "true"
        ) {
            value = {
                status: "unauthorized",
                message: "Sign in with Gemini in a terminal window to authenticate.",
            };
        } else {
            value = {
                status: "error",
                message: String(error?.message || "Unable to verify Gemini authentication."),
            };
        }
    }

    geminiAuthProbeCache.set(cacheKey, { ts: now, value });
    return value;
}

function buildInvocationCommand(invocation) {
    const parts = [invocation.command, ...(invocation.args || [])].map((part) => {
        const value = String(part || "");
        return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
    });
    return parts.join(" ").trim();
}

function getGeminiAuthWorkingDirectory() {
    const candidates = [process.cwd(), app?.getPath?.("home"), homedir()];
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (!value) continue;
        try {
            if (fs.existsSync(value) && fs.statSync(value).isDirectory()) {
                return value;
            }
        } catch (_) {
            // try next candidate
        }
    }
    return process.cwd();
}

export async function readGeminiAuthStatus(invocation) {
    const hasEnvCredentials = detectGeminiEnvironmentCredentials();
    const hasCachedCredentials = detectGeminiCachedCredentials();
    const oauthSnapshot = readGeminiOAuthCredentialSnapshot();
    const cachedState = normalizeGeminiAuthState({
        hasEnvCredentials,
        hasCachedCredentials,
        message: hasEnvCredentials
            ? "Gemini authentication is configured via environment variables."
            : hasCachedCredentials
                ? "Gemini cached credentials were detected."
                : "Gemini authentication is required.",
    });
    if (cachedState.status === "authorized") {
        return cachedState;
    }
    if (hasUsableGeminiOAuthCredentials(oauthSnapshot)) {
        return {
            status: "authorized",
            message: "Gemini OAuth credentials are available locally.",
        };
    }
    const probe = await probeGeminiAuthViaCli(invocation);
    if (probe.status === "authorized") {
        return probe;
    }
    if (probe.status === "unauthorized") {
        return probe;
    }

    try {
        const cwd = getGeminiAuthWorkingDirectory();
        const { stdout, stderr } = await execFileAsync(
            invocation.command,
            [...(invocation.args || []), "--version"],
            { env: { ...process.env, ...(invocation.env || {}) }, cwd, timeout: 10000 }
        );
        const text = `${stdout || ""}\n${stderr || ""}`.trim();
        return normalizeGeminiAuthState({
            hasEnvCredentials,
            hasCachedCredentials: false,
            message: "Gemini CLI is available, but authentication is required.",
        });
    } catch (error) {
        return {
            status: "error",
            message: String(error?.message || "Unable to check Gemini authentication status."),
        };
    }
}

export async function startGeminiLogin(invocation) {
    geminiAuthProbeCache.clear();
    const command = buildInvocationCommand(invocation);
    if (!command) {
        throw new Error("Gemini CLI command is not configured.");
    }
    const cwd = getGeminiAuthWorkingDirectory();
    const launchCommand = `cd ${JSON.stringify(cwd)} && ${command}`;

    if (process.platform === "darwin") {
        const script = `
tell application "Terminal"
    set authTab to do script ${JSON.stringify(launchCommand)}
    delay 0.8
    do script "/auth" in authTab
    activate
    repeat
        try
            if busy of authTab is false then exit repeat
        on error
            exit repeat
        end try
        delay 1
    end repeat
end tell
`;
        const monitorChild = spawn("osascript", ["-e", script], { stdio: "ignore" });
        return { started: true, mode: "terminal", monitorChild };
    }
    if (process.platform === "win32") {
        const monitorChild = spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", `cd /d "${cwd}" && ${command}`], { stdio: "ignore" });
        return { started: true, mode: "terminal", monitorChild };
    }

    const linuxTerminals = [
        ["x-terminal-emulator", ["-e", "sh", "-lc", `${launchCommand}; printf '\\n'; read -r _`]],
        ["gnome-terminal", ["--", "sh", "-lc", `${launchCommand}; printf '\\n'; read -r _`]],
        ["konsole", ["-e", "sh", "-lc", `${launchCommand}; printf '\\n'; read -r _`]],
        ["xterm", ["-e", "sh", "-lc", `${launchCommand}; printf '\\n'; read -r _`]],
    ];
    for (const [terminal, args] of linuxTerminals) {
        try {
            const monitorChild = spawn(terminal, args, { stdio: "ignore" });
            return { started: true, mode: "terminal", monitorChild };
        } catch (_) {
            // try next terminal candidate
        }
    }

    throw new Error("Unable to launch a terminal for Gemini sign-in on this system.");
}

export async function runGeminiLogout(_invocation) {
    const clearedEnvKeys = clearGeminiEnvironmentCredentialsForSession();
    const paths = getGeminiCredentialFilePaths();
    const removed = [];
    for (const filePath of paths) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                removed.push(filePath);
            }
        } catch (_) {
            // Best effort cleanup.
        }
    }
    let keychainCleared = false;
    try {
        const runtimeRequire = typeof __non_webpack_require__ === "function"
            ? __non_webpack_require__
            : eval("require");
        const keytar = runtimeRequire("keytar");
        if (keytar && typeof keytar.deletePassword === "function") {
            keychainCleared = await keytar.deletePassword(GEMINI_KEYCHAIN_SERVICE, GEMINI_KEYCHAIN_ACCOUNT);
        }
    } catch (_) {
        // Best effort cleanup.
    }
    if (!keychainCleared && process.platform === "darwin") {
        try {
            await execFileAsync("security", [
                "delete-generic-password",
                "-s",
                GEMINI_KEYCHAIN_SERVICE,
                "-a",
                GEMINI_KEYCHAIN_ACCOUNT,
            ], { timeout: 8000 });
            keychainCleared = true;
        } catch (_) {
            // Best effort cleanup.
        }
    }
    if (!keychainCleared && process.platform === "linux") {
        try {
            await execFileAsync("secret-tool", [
                "clear",
                "service",
                GEMINI_KEYCHAIN_SERVICE,
                "account",
                GEMINI_KEYCHAIN_ACCOUNT,
            ], { timeout: 8000 });
            keychainCleared = true;
        } catch (_) {
            // Best effort cleanup.
        }
    }
    geminiAuthProbeCache.clear();
    return {
        status: "unauthorized",
        message: [
            clearedEnvKeys.length > 0
                ? `Cleared session environment credentials: ${clearedEnvKeys.join(", ")}.`
                : "No session environment credentials were set.",
            removed.length > 0
                ? `Removed local Gemini cached credential files: ${removed.join(", ")}.`
                : "No local Gemini cached credential files were found.",
            keychainCleared
                ? "Gemini keychain credentials were cleared."
                : "Gemini keychain credentials could not be cleared automatically on this OS.",
        ].join(" "),
    };
}
