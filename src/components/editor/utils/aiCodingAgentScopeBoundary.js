function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function normalizeWorkspacePaths(workspaceFiles = []) {
    return Array.isArray(workspaceFiles)
        ? workspaceFiles
            .map((file) => normalizeText(String(file?.path || "").replace(/^[/\\]+/, "")))
            .filter(Boolean)
        : [];
}

function matchesWorkspacePath(candidatePath = "", workspacePaths = []) {
    const normalizedCandidate = normalizeText(String(candidatePath || "").replace(/\\/g, "/"));
    if (!normalizedCandidate) {
        return false;
    }

    return workspacePaths.some((path) => (
        normalizedCandidate === path
        || normalizedCandidate.endsWith(`/${path}`)
    ));
}

export function hasHostAppFileReference(text = "", workspaceFiles = []) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
        return false;
    }

    const workspacePaths = normalizeWorkspacePaths(workspaceFiles);
    const absolutePathMatches = normalizedText.match(/(?:\/users\/[^\s"'`]+?\.[a-z0-9]+|\/var\/[^\s"'`]+?\.[a-z0-9]+|\/tmp\/[^\s"'`]+?\.[a-z0-9]+|[a-z]:\\[^\s"'`]+?\.[a-z0-9]+)/g) || [];
    if (absolutePathMatches.some((match) => !matchesWorkspacePath(match, workspacePaths))) {
        return true;
    }

    const hostPathMatches = normalizedText.match(/\b(?:src|tests)\/[a-z0-9._/-]+\.[a-z0-9]+\b/g) || [];
    if (hostPathMatches.length === 0) {
        return false;
    }

    return hostPathMatches.some((match) => {
        const normalizedMatch = match.replace(/^[/\\]+/, "");
        return !matchesWorkspacePath(normalizedMatch, workspacePaths);
    });
}
