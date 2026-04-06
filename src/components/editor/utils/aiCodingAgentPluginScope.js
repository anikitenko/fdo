import {hasHostAppFileReference} from "./aiCodingAgentScopeBoundary.js";

function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
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
    return workspacePaths.some((path) => normalizedCandidate === path || normalizedCandidate.endsWith(`/${path}`));
}

function extractPathCandidates(text = "") {
    const value = String(text || "");
    const matches = value.match(
        /(?:\/[A-Za-z0-9._/-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|sass|less|html|txt|ya?ml)|\b(?:src|tests|docs|scripts)\/[A-Za-z0-9._/-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|sass|less|html|txt|ya?ml)\b|\b[A-Za-z0-9._-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|sass|less|html|txt|ya?ml)\b)/g,
    ) || [];
    return Array.from(new Set(matches.map((item) => item.trim()).filter(Boolean)));
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
    const combined = [prompt, previousResponse].filter(Boolean).join("\n");
    if (!hasHostAppFileReference(combined, workspaceFiles)) {
        return { ok: true, references: [] };
    }

    const references = findOutOfScopePluginFileReferences(combined, workspaceFiles);
    return {
        ok: false,
        references,
    };
}

export function validateAiCodingPluginScopeResponse({ text = "", workspaceFiles = [] } = {}) {
    if (!hasHostAppFileReference(text, workspaceFiles)) {
        return { ok: true, references: [] };
    }

    const references = findOutOfScopePluginFileReferences(text, workspaceFiles);
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
