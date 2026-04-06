function stripAnsi(text = "") {
    return String(text || "").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectText(node, out = []) {
    if (!node) return out;
    if (typeof node === "string") {
        const value = node.trim();
        if (value) out.push(value);
        return out;
    }
    if (Array.isArray(node)) {
        node.forEach((item) => collectText(item, out));
        return out;
    }
    if (typeof node === "object") {
        if (typeof node.text === "string") collectText(node.text, out);
        if (typeof node.content === "string") collectText(node.content, out);
        if (typeof node.delta === "string") collectText(node.delta, out);
        if (node.message) collectText(node.message, out);
        if (node.content && typeof node.content !== "string") collectText(node.content, out);
        if (node.delta && typeof node.delta !== "string") collectText(node.delta, out);
    }
    return out;
}

function extractAssistantItemText(parsed) {
    if (!isObject(parsed)) return "";
    const type = String(parsed.type || "").toLowerCase();
    if (type === "item.completed" || type === "item.delta") {
        const item = parsed.item;
        if (!isObject(item)) return "";
        const itemType = String(item.type || "").toLowerCase();
        if (itemType === "agentmessage" || itemType === "assistantmessage") {
            return collectText(item.text || item.content || item.delta).join("\n").trim();
        }
        return "";
    }
    if (type === "content" || type === "message" || type === "assistant.message") {
        return collectText(parsed.content || parsed.message || parsed.delta || parsed.text).join("\n").trim();
    }
    return "";
}

function summarizeCommand(command = "") {
    const normalized = String(command || "").trim();
    if (!normalized) return "";

    if (/rg .*fdo-sdk|@anikitenko\/fdo-sdk|domtable|dominput|fdointerface/i.test(normalized)) {
        return "Inspecting bundled FDO SDK files and examples.";
    }
    if (/rg --files .*dev\/fdo|sed -n .*package\.json|package-lock\.json/i.test(normalized)) {
        return "Inspecting current workspace files and package metadata.";
    }
    if (/sed -n .*examples\//i.test(normalized)) {
        return "Reading bundled SDK example plugins.";
    }
    if (/rg .*todo|readme|changelog|plan\.md|spec\.md/i.test(normalized)) {
        return "Inspecting referenced workspace task files.";
    }
    return "Inspecting workspace context.";
}

export function extractCodexJsonProgress(line = "") {
    const raw = stripAnsi(line).trim();
    if (!raw || !raw.startsWith("{")) {
        return "";
    }

    try {
        const parsed = JSON.parse(raw);
        const type = String(parsed?.type || "").toLowerCase();
        if (type === "thread.started") {
            return "Codex session started.";
        }
        if (type === "turn.started") {
            return "Codex is analyzing the request and workspace.";
        }
        if (type === "item.started" || type === "item.completed") {
            const item = parsed?.item;
            const itemType = String(item?.type || "").toLowerCase();
            if (itemType === "commandexecution") {
                const summary = summarizeCommand(item?.command || "");
                return type === "item.started"
                    ? summary
                    : "";
            }
            if (itemType === "agentmessage" && typeof item?.text === "string" && item.text.trim()) {
                return "Codex is preparing the first answer.";
            }
        }
        return "";
    } catch {
        return "";
    }
}

export function extractCodexJsonEventText(line = "") {
    const raw = stripAnsi(line).trim();
    if (!raw || !raw.startsWith("{")) {
        return "";
    }

    try {
        const parsed = JSON.parse(raw);
        return extractAssistantItemText(parsed);
    } catch {
        return "";
    }
}

export function isLikelyCodexJsonEventStream(text = "") {
    const lines = stripAnsi(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return false;
    const jsonLikeCount = lines.filter((line) => line.startsWith("{") && line.endsWith("}")).length;
    return jsonLikeCount >= Math.max(2, Math.ceil(lines.length / 2));
}
