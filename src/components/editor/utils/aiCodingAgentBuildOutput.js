import {sanitizeVirtualWorkspacePath} from "./aiCodingAgentWorkspacePath.js";

function formatTimestamp(ts) {
    if (!ts) {
        return "";
    }

    try {
        return new Date(ts).toISOString();
    } catch {
        return "";
    }
}

function normalizeWorkspaceFilePath(rawPath = "", workspaceFiles = []) {
    const normalizedRawPath = String(rawPath || "").trim().replace(/\\/g, "/");
    if (!normalizedRawPath) {
        return "";
    }

    const safeWorkspacePath = sanitizeVirtualWorkspacePath(normalizedRawPath);
    if (safeWorkspacePath) {
        return safeWorkspacePath;
    }

    const candidates = Array.isArray(workspaceFiles) ? workspaceFiles : [];
    const loweredRawPath = normalizedRawPath.toLowerCase();
    const suffixMatch = candidates.find((file) => loweredRawPath.endsWith(String(file?.path || "").toLowerCase()));
    if (suffixMatch?.path) {
        return suffixMatch.path;
    }

    const basename = loweredRawPath.split("/").pop() || "";
    if (!basename) {
        return "";
    }

    const basenameMatches = candidates.filter((file) => {
        const filePath = String(file?.path || "").toLowerCase();
        return filePath.split("/").pop() === basename;
    });

    return basenameMatches.length === 1 ? basenameMatches[0].path : "";
}

function normalizeOutputMessage(message = "", workspaceFiles = []) {
    let normalizedMessage = String(message || "");
    if (!normalizedMessage.trim()) {
        return "";
    }

    const pathRegexes = [
        /\/[^\s:'"`)]+(?:\/[^\s:'"`)]+)*\.[A-Za-z0-9]+/g,
        /[A-Za-z]:\\[^\s:'"`)]+(?:\\[^\s:'"`)]+)*\.[A-Za-z0-9]+/g,
    ];

    pathRegexes.forEach((regex) => {
        normalizedMessage = normalizedMessage.replace(regex, (match) => {
            const workspacePath = normalizeWorkspaceFilePath(match, workspaceFiles);
            return workspacePath || match;
        });
    });

    return normalizedMessage;
}

function buildOutputSection(title, entries = [], workspaceFiles = []) {
    const relevantEntries = Array.isArray(entries)
        ? entries
            .map((entry) => {
                if (!entry || typeof entry.message !== "string") {
                    return null;
                }
                const normalizedMessage = normalizeOutputMessage(entry.message, workspaceFiles);
                if (!normalizedMessage.trim()) {
                    return null;
                }
                return {
                    ...entry,
                    message: normalizedMessage,
                };
            })
            .filter(Boolean)
        : [];

    if (relevantEntries.length === 0) {
        return "";
    }

    const failureEntries = relevantEntries.filter((entry) => entry.error);
    const selectedEntries = (failureEntries.length > 0 ? failureEntries : relevantEntries).slice(-8);

    if (selectedEntries.length === 0) {
        return "";
    }

    const lines = selectedEntries.map((entry) => {
        const prefix = entry.error ? "ERROR" : "INFO";
        const timestamp = formatTimestamp(entry.ts);
        return `${timestamp ? `[${timestamp}] ` : ""}[${prefix}] ${entry.message}`.trim();
    });

    return `${title}:\n${lines.join("\n")}\n\n`;
}

export function buildAiCodingBuildOutputContext({buildHistory = [], testHistory = [], workspaceFiles = []} = {}) {
    return `${buildOutputSection("Recent build output", buildHistory, workspaceFiles)}${buildOutputSection("Recent test output", testHistory, workspaceFiles)}`;
}
