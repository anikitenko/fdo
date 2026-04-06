function normalizePath(value = "") {
    return String(value || "").replace(/^[/\\]+/, "");
}

function scoreSpecialMention(keyword = "", query = "") {
    const normalizedKeyword = String(keyword || "").toLowerCase();
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) return Number.POSITIVE_INFINITY;
    if (normalizedKeyword === normalizedQuery) return 0;
    if (normalizedKeyword.startsWith(normalizedQuery)) return 1;
    if (normalizedKeyword.includes(normalizedQuery)) return 2;
    return Number.POSITIVE_INFINITY;
}

function scoreWorkspaceFile(path = "", query = "") {
    const normalizedPath = normalizePath(path).toLowerCase();
    const basename = normalizedPath.split("/").pop() || normalizedPath;
    const normalizedQuery = String(query || "").trim().toLowerCase();

    if (!normalizedQuery) {
        return basename.length;
    }
    if (basename === normalizedQuery) {
        return 0;
    }
    if (basename.startsWith(normalizedQuery)) {
        return 1;
    }
    if (normalizedPath.startsWith(normalizedQuery)) {
        return 2;
    }
    if (basename.includes(normalizedQuery)) {
        return 3;
    }
    if (normalizedPath.includes(normalizedQuery)) {
        return 4;
    }
    return Number.POSITIVE_INFINITY;
}

export function detectWorkspaceMention(text = "", cursorIndex = 0) {
    const safeText = String(text || "");
    const safeCursor = Math.max(0, Math.min(typeof cursorIndex === "number" ? cursorIndex : safeText.length, safeText.length));
    const beforeCursor = safeText.slice(0, safeCursor);
    const match = beforeCursor.match(/(^|[\s([{])@([A-Za-z0-9._/-]*)$/);
    if (!match) {
        return null;
    }

    const token = match[2] || "";
    return {
        query: token,
        start: safeCursor - token.length - 1,
        end: safeCursor,
    };
}

export function getWorkspaceMentionSuggestions(projectFiles = [], query = "", limit = 8) {
    const seen = new Set();
    const normalized = Array.isArray(projectFiles) ? projectFiles
        .map((file) => normalizePath(file?.path || ""))
        .filter(Boolean)
        .filter((path) => {
            if (seen.has(path)) return false;
            seen.add(path);
            return true;
        }) : [];

    return normalized
        .map((path) => ({
            path,
            score: scoreWorkspaceFile(path, query),
        }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => {
            if (left.score !== right.score) {
                return left.score - right.score;
            }
            const leftBase = left.path.split("/").pop() || left.path;
            const rightBase = right.path.split("/").pop() || right.path;
            const baseCompare = leftBase.localeCompare(rightBase);
            if (baseCompare !== 0) {
                return baseCompare;
            }
            return left.path.localeCompare(right.path);
        })
        .slice(0, limit)
        .map((item) => item.path);
}

export function getWorkspaceMentionItems(projectFiles = [], query = "", currentFilePath = "", limit = 8) {
    const items = [];
    const normalizedCurrentFilePath = normalizePath(currentFilePath);
    const thisFileScore = normalizedCurrentFilePath ? scoreSpecialMention("thisfile", query) : Number.POSITIVE_INFINITY;
    const filePrefixScore = scoreSpecialMention("file:", query);

    if (Number.isFinite(thisFileScore)) {
        items.push({
            type: "special",
            token: "@thisFile",
            insertText: "@thisFile",
            title: "@thisFile",
            subtitle: "Refer to currently opened file",
            score: thisFileScore,
        });
    }

    if (Number.isFinite(filePrefixScore)) {
        items.push({
            type: "special",
            token: "@file:",
            insertText: "@file:",
            title: "@file:",
            subtitle: "Add a file into prompt",
            score: filePrefixScore,
        });
    }

    const fileItems = getWorkspaceMentionSuggestions(projectFiles, query, limit).map((path) => {
        const normalized = normalizePath(path);
        const segments = normalized.split("/");
        const basename = segments.pop() || normalized;
        const directory = segments.join("/");
        return {
            type: "file",
            token: `@${normalized}`,
            insertText: `@${normalized}`,
            path: normalized,
            title: basename,
            subtitle: directory,
        };
    });

    const specialItems = items
        .sort((left, right) => left.score - right.score || left.title.localeCompare(right.title))
        .slice(0, 2);

    return [...specialItems, ...fileItems].slice(0, limit);
}

export function applyWorkspaceMention(text = "", mention = null, insertText = "") {
    if (!mention || !insertText) {
        return {
            value: String(text || ""),
            cursorIndex: typeof mention?.end === "number" ? mention.end : String(text || "").length,
        };
    }

    const safeText = String(text || "");
    const normalizedInsertText = String(insertText || "").trim();
    const replacement = normalizedInsertText.startsWith("@")
        ? normalizedInsertText
        : `@${normalizePath(normalizedInsertText)}`;
    const suffix = safeText.slice(mention.end);
    const needsSpace = suffix.length === 0 || !/^\s/.test(suffix);
    const nextValue = `${safeText.slice(0, mention.start)}${replacement}${needsSpace ? " " : ""}${suffix}`;
    const cursorIndex = mention.start + replacement.length + (needsSpace ? 1 : 0);

    return {
        value: nextValue,
        cursorIndex,
    };
}
