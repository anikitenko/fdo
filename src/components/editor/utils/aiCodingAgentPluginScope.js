import {hasHostAppFileReference} from "./aiCodingAgentScopeBoundary.js";
import {parseAiWorkspacePlanResponse} from "./aiCodingAgentPlanResponse.js";

function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function stripTerminalControlCodes(value = "") {
    // Node's reporter and build output can contain ANSI colour sequences such
    // as `\x1b[39m`. They are presentation data, never part of a file path.
    return String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeWorkspacePaths(workspaceFiles = []) {
    return Array.isArray(workspaceFiles)
        ? workspaceFiles
            .map((file) => String(file?.path || "").trim())
            .filter(Boolean)
            .map((path) => path.replace(/^[/\\]+/, "").toLowerCase())
        : [];
}

function matchesWorkspacePath(candidatePath = "", workspacePaths = []) {
    const normalizedCandidate = normalizeText(String(candidatePath || "").replace(/\\/g, "/").replace(/^[/\\]+/, ""));
    if (!normalizedCandidate) return false;
    return workspacePaths.some((path) => {
        if (normalizedCandidate === path || normalizedCandidate.endsWith(`/${path}`)) return true;

        // A plugin TypeScript test is transpiled to .js before node:test runs.
        // Treat that temporary reporter path as the matching workspace test,
        // while leaving ordinary source-file paths strict.
        const candidateTestStem = normalizedCandidate.replace(/\.(?:[cm]?[jt]sx?)$/, "");
        const workspaceTestStem = path.replace(/\.(?:[cm]?[jt]sx?)$/, "");
        return /\.(?:test|spec)$/.test(candidateTestStem) && candidateTestStem === workspaceTestStem;
    });
}

const PATH_CANDIDATE_PATTERN = /(?:\/[A-Za-z0-9._/-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|sass|less|html|txt|ya?ml)|\b(?:src|tests|docs|scripts)\/[A-Za-z0-9._/-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|sass|less|html|txt|ya?ml)\b|\b[A-Za-z0-9._-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|sass|less|html|txt|ya?ml)\b)/g;

function extractPathCandidates(text = "") {
    return Array.from(new Set(
        Array.from(stripTerminalControlCodes(text).matchAll(PATH_CANDIDATE_PATTERN), ([item]) => item.trim()).filter(Boolean),
    ));
}

function isExplicitEditInstructionForPath(text = "", candidate = "") {
    const value = stripTerminalControlCodes(text);
    const index = value.indexOf(candidate);
    if (index < 0) return false;
    const lineStart = value.lastIndexOf("\n", index) + 1;
    const lineEnd = value.indexOf("\n", index);
    const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
    const beforePath = line.slice(0, Math.max(0, index - lineStart));
    const editVerb = /\b(?:fix|repair|edit|update|change|modify|rewrite|replace|implement|create|remove|add|work\s+on)\b/i;

    if (!editVerb.test(beforePath)) return false;
    return !/\b(?:do\s+not|don't|never|without)\b[^\n]{0,80}$/i.test(beforePath);
}

function findExplicitOutOfScopeRequestReferences(prompt = "", workspaceFiles = []) {
    const workspacePaths = normalizeWorkspacePaths(workspaceFiles);
    return extractPathCandidates(prompt)
        .filter((candidate) => !matchesWorkspacePath(candidate, workspacePaths))
        .filter((candidate) => hasHostAppFileReference(candidate, workspaceFiles))
        .filter((candidate) => isExplicitEditInstructionForPath(prompt, candidate))
        .slice(0, 6);
}

export function findOutOfScopePluginFileReferences(text = "", workspaceFiles = []) {
    const workspacePaths = normalizeWorkspacePaths(workspaceFiles);
    if (!String(text || "").trim()) {
        return [];
    }

    const references = extractPathCandidates(text)
        .filter((candidate) => !/^https?:\/\//i.test(candidate))
        .filter((candidate) => !candidate.startsWith("@"))
        .filter((candidate) => {
            const normalized = normalizeText(candidate.replace(/^[/\\]+/, ""));
            if (!normalized) return false;
            if (/^(png|jpg|jpeg|svg|gif|webp)$/i.test(normalized)) return false;
            if (!/[/.]/.test(normalized)) return false;
            return !matchesWorkspacePath(candidate, workspacePaths);
        });

    return Array.from(new Set(references)).slice(0, 6);
}

export function validateAiCodingPluginScopeRequest({ prompt = "", previousResponse = "", workspaceFiles = [] } = {}) {
    // Previous assistant output is validated independently before it becomes
    // conversation context. At request time, inspect only the new instruction:
    // build/test logs may legitimately mention temporary transpiled files.
    const references = findExplicitOutOfScopeRequestReferences(prompt, workspaceFiles);
    if (references.length === 0) {
        return { ok: true, references: [] };
    }
    return {
        ok: false,
        references,
    };
}

export function validateAiCodingPluginScopeResponse({ text = "", workspaceFiles = [] } = {}) {
    const normalizedText = stripTerminalControlCodes(text);
    // A scaffold's new virtual files are not present in the pre-request
    // snapshot yet. Use complete canonical sections as declarations, never a
    // prose mention, raw comment, or an unsafe machine path. Source and import
    // validation still run before these files can be applied.
    const declaredFiles = parseAiWorkspacePlanResponse(normalizedText).files.filter(file =>
        new RegExp(`^###\\s+File:\\s+${file.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm').test(normalizedText));
    if (!hasHostAppFileReference(normalizedText, workspaceFiles, declaredFiles)) {
        return { ok: true, references: [] };
    }

    const references = findOutOfScopePluginFileReferences(normalizedText, workspaceFiles);
    return {
        ok: false,
        references,
    };
}

export function buildAiCodingPluginScopeViolationMessage({ references = [], phase = "response" } = {}) {
    const referenceText = references.length > 0
        ? ` Out-of-scope references: ${references.join(", ")}.`
        : "";

    if (phase === "request") {
        return `AI Coding Assistant is restricted to the current plugin workspace and cannot work on FDO host application files.${referenceText} Use AI Chat for FDO internals, or ask again using plugin files only.`;
    }

    return `The assistant returned guidance outside the current plugin workspace, so the response was suppressed.${referenceText} Use AI Chat for FDO internals, or re-ask using plugin files only.`;
}
