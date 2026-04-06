import {detectAiCodingPragmaticIntent} from "./aiCodingAgentPragmaticIntent.js";
import {hasHostAppFileReference} from "./aiCodingAgentScopeBoundary.js";

function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

export function normalizeFilenameTarget(raw = "", workspaceFiles = []) {
    const value = String(raw || "").trim().replace(/^[/\\]+/, "");
    const normalized = normalizeText(value);
    if (!normalized) return null;

    const workspacePaths = Array.isArray(workspaceFiles)
        ? workspaceFiles.map((file) => String(file?.path || "").replace(/^[/\\]+/, "")).filter(Boolean)
        : [];
    const resolveWorkspaceAlias = (...candidates) => {
        for (const candidate of candidates) {
            const normalizedCandidate = normalizeText(candidate);
            const matched = workspacePaths.find((path) => {
                const basename = path.split("/").pop() || path;
                const normalizedPath = normalizeText(path);
                const normalizedBase = normalizeText(basename);
                if (normalizedPath === normalizedCandidate || normalizedBase === normalizedCandidate) {
                    return true;
                }
                if (normalizedCandidate === "todo" || normalizedCandidate === "/todo.md") {
                    return /(todo|checklist)/i.test(basename);
                }
                return false;
            });
            if (matched) {
                return matched.startsWith("/") ? matched : `/${matched}`;
            }
        }
        return null;
    };

    const explicitNameMap = {
        "readme.md": "/README.md",
        "todo.md": "/TODO.md",
        "changelog.md": "/CHANGELOG.md",
        "notes.md": "/NOTES.md",
        "plan.md": "/PLAN.md",
        "spec.md": "/SPEC.md",
    };

    if (explicitNameMap[normalized]) {
        const workspaceMatch = resolveWorkspaceAlias(explicitNameMap[normalized], value);
        if (workspaceMatch) {
            return workspaceMatch;
        }
        return explicitNameMap[normalized];
    }

    const keywordMap = {
        todo: "/TODO.md",
        checklist: "/TODO.md",
        readme: "/README.md",
        changelog: "/CHANGELOG.md",
        notes: "/NOTES.md",
        note: "/NOTES.md",
        plan: "/PLAN.md",
        spec: "/SPEC.md",
    };

    if (keywordMap[normalized]) {
        const workspaceMatch = resolveWorkspaceAlias(keywordMap[normalized], normalized);
        if (workspaceMatch) {
            return workspaceMatch;
        }
        return keywordMap[normalized];
    }

    if (/^[a-z0-9._-]+\.[a-z0-9]+$/i.test(value)) {
        const workspaceMatch = resolveWorkspaceAlias(value);
        if (workspaceMatch) {
            return workspaceMatch;
        }
        return value.startsWith("/") ? value : `/${value}`;
    }

    return null;
}

export function extractProjectFileTargets({ prompt = "", previousResponse = "", workspaceFiles = [] } = {}) {
    const combined = [prompt, previousResponse].filter(Boolean).join("\n");
    if (!String(combined).trim()) return [];
    if (hasHostAppFileReference(combined, workspaceFiles)) return [];

    const normalizedPrompt = normalizeText(prompt);
    const pragmaticIntent = detectAiCodingPragmaticIntent({ prompt, previousResponse });
    const createSignals = ["create", "make", "write", "add"];
    const updateSignals = [
        "continue with",
        "continue",
        "update",
        "revise",
        "edit",
        "mark",
        "complete",
        "completed",
        "after my testing",
        "based on testing",
    ];
    if (updateSignals.some((signal) => normalizedPrompt.includes(signal)) || (pragmaticIntent.wantsFileUpdate && !pragmaticIntent.autoMarkDoneAllowed)) {
        return [];
    }

    const matches = new Set();
    const explicitPatterns = [
        /(?:create|make|write|add)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:markdown\s+)?(?:file\s+)?(?:named\s+)?([a-z0-9._/-]+\.[a-z0-9]+|todo|readme|changelog|checklist|notes?|plan|spec)\b/gi,
        /(?:todo|readme|changelog|checklist|notes?|plan|spec)\s+file\b/gi,
    ];

    for (const pattern of explicitPatterns) {
        let match;
        while ((match = pattern.exec(combined)) !== null) {
            const raw = match[1] || match[0].replace(/\s+file\b/i, "").trim();
            const normalizedTarget = normalizeFilenameTarget(raw, workspaceFiles);
            if (normalizedTarget) {
                matches.add(normalizedTarget);
            }
        }
    }

    if (createSignals.some((signal) => normalizedPrompt.includes(signal))) {
        const knownKeywords = ["todo", "checklist", "readme", "changelog", "notes", "note", "plan", "spec"];
        for (const keyword of knownKeywords) {
            if (new RegExp(`(^|\\b)${keyword}(\\b|$)`, "i").test(normalizedPrompt)) {
                const normalizedTarget = normalizeFilenameTarget(keyword, workspaceFiles);
                if (normalizedTarget) {
                    matches.add(normalizedTarget);
                }
            }
        }
    }

    return Array.from(matches);
}

export function shouldCreateProjectFiles({ prompt = "", previousResponse = "", workspaceFiles = [] } = {}) {
    return extractProjectFileTargets({ prompt, previousResponse, workspaceFiles }).length > 0;
}

export function buildProjectFilePlanPrompt({ prompt = "", previousResponse = "", workspaceFiles = [] } = {}) {
    const targets = extractProjectFileTargets({ prompt, previousResponse, workspaceFiles });
    const primaryTarget = targets[0] || "/TASKS.md";
    const targetList = targets.length > 0 ? targets.join(", ") : primaryTarget;
    return `Previous AI response:\n${previousResponse}\n\nUser request:\n${prompt}\n\nCreate the requested project file(s) as real workspace files.\nRequested file target(s): ${targetList}\nReturn the result ONLY in plan file format using one or more sections like:\n\n### File: ${primaryTarget}\n\`\`\`md\n...file content...\n\`\`\`\n\nDo not return prose-only guidance. Return concrete file sections that can be created in the virtual workspace.`;
}
