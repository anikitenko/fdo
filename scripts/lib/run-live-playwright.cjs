const {spawn} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {StringDecoder} = require("node:string_decoder");
const {installStdioErrorHandlers} = require("../../src/utils/stdioErrors.cjs");

function summarizeProtocolLine(line) {
    const match = String(line).replace(/\x1b\[[0-9;]*m/g, "").match(/pw:protocol (SEND ►|◀ RECV) (\{.*)/);
    if (!match) return null;
    const payload = match[2].replace(/\s+\+[\d.]+(?:ms|s|m|h)\s*$/, "");
    const summary = {direction: match[1].startsWith("SEND") ? "send" : "receive", loggedChars: payload.length};
    try {
        const message = JSON.parse(payload);
        if (Number.isSafeInteger(message.id)) summary.id = message.id;
        if (typeof message.method === "string" && /^[A-Za-z]+\.[A-Za-z]+$/.test(message.method)) summary.method = message.method;
        if (Number.isSafeInteger(message.error?.code)) summary.errorCode = message.error.code;
    } catch { summary.truncated = true; }
    // Never copy params, results or error text: all can contain user content.
    return `pw:protocol ${JSON.stringify(summary)}`;
}

function sanitizeTransportLine(line, secrets = []) {
    let text = String(line).replace(/\x1b\[[0-9;]*m/g, "");
    const transport = text.includes("pw:browser") && /<(?:ws [^>]+|closing ws|process did exit)[^>]*>/.test(text);
    // Chromium writes server-side socket diagnostics to the child's stderr.
    // Do not admit arbitrary renderer/provider console messages here.
    const nativeSocket = text.includes("pw:browser") && /\[err\].*\[(?:[^\]\r\n]*:)?(?:ERROR|WARNING|FATAL):(?:[^\]\r\n]*[/\\])?(?:http_server|http_connection|web_socket|web_socket_encoder|devtools_http_handler)\.cc[:(]/.test(text);
    if (!transport && !nativeSocket) return null;
    // Playwright includes the full protocol payload when its message handler
    // throws. Keep the diagnostic exception, never the generated code/prompt.
    const payloadAt = text.indexOf("eventData=");
    if (payloadAt >= 0) {
        const errorAt = text.lastIndexOf(" e=");
        text = text.slice(0, payloadAt) + "eventData=[OMITTED]" + (errorAt > payloadAt ? text.slice(errorAt) : "");
    }
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
    return text.slice(0, 2000);
}

// Use Playwright's supported DEBUG logging; do not patch its CDP transport or
// reconnect behind the test's back. Drain stderr continuously to avoid pipe
// backpressure on a long live run.
function runLivePlaywright(args, {env = process.env, artifactDir = "artifacts/live-ai"} = {}) {
    installStdioErrorHandlers();
    const logPath = path.resolve(artifactDir, "playwright-transport.log");
    fs.mkdirSync(path.dirname(logPath), {recursive: true});
    fs.writeFileSync(logPath, "");
    const secrets = Object.entries(env).filter(([key]) => /(?:API_KEY|TOKEN|SECRET|PASSWORD|_KEY)$/.test(key)).map(([, value]) => value).filter(value => typeof value === "string" && value);
    const protocolDiagnostics = env.FDO_E2E_LIVE_AI_PROTOCOL_DIAGNOSTICS !== "0";
    return new Promise(resolve => {
        const child = spawn(process.execPath, args, {
            stdio: ["inherit", "inherit", "pipe"],
            env: {...env, DEBUG: protocolDiagnostics ? "pw:browser,pw:protocol" : "pw:browser", ELECTRON_ENABLE_LOGGING: "1", FDO_E2E_LIVE_AI_TRANSPORT_LOG: logPath},
        });
        const decoder = new StringDecoder("utf8");
        // Keep lifecycle entries even when token/DOM protocol traffic is busy.
        const lifecycleRecords = [];
        const protocolRecords = [];
        let sequence = 0;
        let pending = "";
        let error;
        let interruptedSignal;
        let flushTimer;
        const flush = () => {
            clearTimeout(flushTimer);
            flushTimer = undefined;
            const records = [...lifecycleRecords, ...protocolRecords].sort((a, b) => a.sequence - b.sequence);
            fs.writeFileSync(logPath, records.map(record => record.text).join("\n") + (records.length ? "\n" : ""));
        };
        const line = raw => {
            const safe = raw.includes("pw:protocol")
                ? (protocolDiagnostics ? summarizeProtocolLine(raw) : null)
                : sanitizeTransportLine(raw, secrets);
            if (safe) {
                const protocol = raw.includes("pw:protocol");
                const records = protocol ? protocolRecords : lifecycleRecords;
                records.push({sequence: sequence++, text: `${new Date().toISOString()} ${safe}`});
                if (records.length > (protocol ? 150 : 50)) records.shift();
                // Protocol events can arrive for every token. Batch their
                // writes so diagnostics do not stall draining the pipe.
                if (raw.includes("pw:protocol")) {
                    if (!flushTimer) flushTimer = setTimeout(flush, 100);
                } else flush();
            } else if (!/pw:(?:browser|protocol)/.test(raw)) {
                let output = raw;
                for (const secret of secrets) output = output.split(secret).join("[REDACTED]");
                process.stderr.write(output + "\n");
            }
        };
        child.stderr.on("data", chunk => {
            pending += decoder.write(chunk);
            let end;
            while ((end = pending.indexOf("\n")) >= 0) {
                line(pending.slice(0, end));
                pending = pending.slice(end + 1);
            }
            if (pending.length > 4 * 1024 * 1024) {
                // Bound a pathological unterminated protocol payload while
                // retaining its prefix and eventual diagnostic suffix.
                pending = pending.slice(0, 512) + " [OMITTED] " + pending.slice(-4096);
            }
        });
        const interrupt = signal => { interruptedSignal = signal; child.kill(signal); };
        const onSigint = () => interrupt("SIGINT");
        const onSigterm = () => interrupt("SIGTERM");
        process.on("SIGINT", onSigint);
        process.on("SIGTERM", onSigterm);
        child.on("error", failure => { error = failure; });
        child.on("close", (status, signal) => {
            pending += decoder.end();
            if (pending) line(pending);
            flush();
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigterm);
            console.log(`Playwright transport log: ${logPath}`);
            resolve({status, signal: interruptedSignal || signal, error});
        });
    });
}

module.exports = {runLivePlaywright, sanitizeTransportLine, summarizeProtocolLine};
