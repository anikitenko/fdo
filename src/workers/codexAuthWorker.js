const { spawn } = require("node:child_process");

function send(message) {
    if (process.parentPort && typeof process.parentPort.postMessage === "function") {
        process.parentPort.postMessage(message);
    }
}

const command = process.argv[2];
const mode = process.argv[3] || "login";
const baseArgs = (() => {
    try {
        return JSON.parse(process.argv[4] || "[]");
    } catch {
        return [];
    }
})();
const extraEnv = (() => {
    try {
        return JSON.parse(process.argv[5] || "{}");
    } catch {
        return {};
    }
})();

if (!command) {
    send({ type: "error", error: "Codex executable path is required." });
    process.exit(1);
}

const args = [...baseArgs, ...(mode === "login" ? ["login"] : [])];
const child = spawn(command, args, {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
    const text = String(chunk || "");
    stdout += text;
    send({ type: "stdout", content: text });
});

child.stderr.on("data", (chunk) => {
    const text = String(chunk || "");
    stderr += text;
    send({ type: "stderr", content: text });
});

child.on("error", (error) => {
    send({ type: "error", error: error.message });
    process.exit(1);
});

child.on("close", (code) => {
    send({
        type: "exit",
        code,
        stdout,
        stderr,
    });
    process.exit(code || 0);
});
