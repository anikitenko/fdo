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

export function hasHostAppFileReference(text = "", workspaceFiles = [], declaredFiles = []) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
        return false;
    }

    const workspacePaths = normalizeWorkspacePaths(workspaceFiles);
    // A generated URL regexp commonly includes `https?:\\/\\/…`. Do not
    // mistake its `s:\\` fragment for a Windows drive path; actual Windows
    // paths have a non-separator path character after the first backslash.
    const absolutePathMatches = normalizedText.match(/(?:\/(?:users|var|tmp|private|applications|library|system|volumes|opt|etc|usr|bin|sbin|dev|home|mnt|proc|root|run|srv|sys|windows|program files)\/[^\s"'`]+?\.[a-z0-9]+|[a-z]:[\\/](?![\\/])[^\s"'`]+?\.[a-z0-9]+)/g) || [];
    if (absolutePathMatches.some((match) => !matchesWorkspacePath(match, workspacePaths))) {
        return true;
    }

    const hostPathMatches = normalizedText.match(/\b(?:src|tests)\/[a-z0-9._/-]+\.[a-z0-9]+\b/g) || [];
    if (hostPathMatches.length === 0) {
        return false;
    }

    // Complete file sections may introduce new virtual src/tests modules.
    // They cannot authorize matching machine-absolute paths checked above.
    const responseWorkspacePaths = normalizeWorkspacePaths([...workspaceFiles, ...declaredFiles]);
    return hostPathMatches.some((match) => {
        const normalizedMatch = match.replace(/^[/\\]+/, "");
        return !matchesWorkspacePath(normalizedMatch, responseWorkspacePaths);
    });
}
