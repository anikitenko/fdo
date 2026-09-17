const { spawn } = require("node:child_process");

function send(message) {
    if (process.parentPort && typeof process.parentPort.postMessage === "function") {
        process.parentPort.postMessage(message);
    }
}

const command = process.argv[2];
const baseArgs = (() => {
    try {
        return JSON.parse(process.argv[3] || "[]");
    } catch {
        return [];
    }
})();
const extraEnv = (() => {
    try {
        return JSON.parse(process.argv[4] || "{}");
    } catch {
        return {};
    }
})();

if (!command) {
    send({ type: "error", error: "Gemini executable path is required." });
    process.exit(1);
}

const GEMINI_AUTH_PROBE_TOKEN = "FDO_AUTH_PROBE_OK_77b2";

function parseGeminiProbeOutput(text = "", token = GEMINI_AUTH_PROBE_TOKEN) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return false;

    const hasFailureHints = (value = "") =>
        /not authenticated|not logged in|login required|\bsign in\b|\bauthenticate\b|\boauth\b|unauthorized|access denied/i.test(String(value || ""));
    const hasSuccessHints = (value = "") =>
        /already logged in|already authenticated|authentication successful|authenticated successfully|logged in as|you are logged in|auth state:\s*authorized|signed in|you are signed in|you're signed in/i.test(String(value || ""));

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
                const content = String(parsed.content || parsed.text || "").trim();
                if (content === token) {
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
    if (trimmed === token && !/error|fail|required|denied/i.test(trimmed)) {
        return true;
    }
    if (!hasFailureHints(trimmed) && hasSuccessHints(trimmed)) {
        return true;
    }
    return false;
}

// Probe loop: try to run the probe command repeatedly until it succeeds or we are killed.
// This ensures the worker stays alive while the user is logging in in the terminal.
async function runProbeLoop() {
    const probeArgs = [...baseArgs, "-p", `Reply with exactly: ${GEMINI_AUTH_PROBE_TOKEN}`, "--output-format", "json"];
    
    while (true) {
        try {
            const success = await new Promise((resolve) => {
                const child = spawn(command, probeArgs, {
                    env: { ...process.env, ...extraEnv },
                    cwd: process.cwd(),
                    stdio: ["ignore", "pipe", "pipe"],
                });

                let stdout = "";
                let stderr = "";

                child.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
                child.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });

                child.on("close", (code) => {
                    const isAuthorized = parseGeminiProbeOutput(stdout + stderr, GEMINI_AUTH_PROBE_TOKEN);
                    resolve(code === 0 && isAuthorized);
                });

                child.on("error", () => {
                    resolve(false);
                });

                // Safety timeout for individual probe
                setTimeout(() => {
                    try { child.kill(); } catch {}
                    resolve(false);
                }, 10000);
            });

            if (success) {
                send({ type: "exit", code: 0, message: "Authentication successful" });
                process.exit(0);
            }
        } catch (e) {
            // ignore and retry
        }

        // Wait before next probe
        await new Promise(r => setTimeout(r, 3000));
    }
}

runProbeLoop().catch(err => {
    send({ type: "error", error: err.message });
    process.exit(1);
});
