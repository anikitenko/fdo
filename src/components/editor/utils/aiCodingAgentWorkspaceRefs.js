function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function normalizeImplicitFileName(token = "") {
    const normalized = normalizeText(token);
    const mapping = {
        todo: "TODO.md",
        readme: "README.md",
        changelog: "CHANGELOG.md",
        notes: "NOTES.md",
        plan: "PLAN.md",
        spec: "SPEC.md",
    };
    return mapping[normalized] || "";
}

function resolveImplicitWorkspaceAlias(projectFiles = [], token = "") {
    const fallback = normalizeImplicitFileName(token);
    const normalizedToken = normalizeText(token);
    if (!fallback) return "";

    const candidates = Array.isArray(projectFiles) ? projectFiles
        .map((file) => String(file?.path || "").replace(/^[/\\]+/, ""))
        .filter(Boolean) : [];

    const directAlias = candidates.find((path) => {
        const basename = path.split("/").pop() || path;
        const normalizedBase = normalizeText(basename);
        if (normalizedBase === normalizedToken) return true;
        if (normalizedBase === normalizeText(fallback)) return true;
        if (normalizedToken === "todo" && /(todo|checklist)/i.test(basename)) return true;
        return false;
    });

    return directAlias || fallback;
}

export function extractWorkspaceFileReferences(prompt = "", projectFiles = []) {
    const text = String(prompt || "");
    const matches = new Set();

    const atReferenceMatches = text.match(/@([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/g) || [];
    atReferenceMatches.forEach((value) => matches.add(value.slice(1).replace(/^[/\\]+/, "")));

    const explicitFileMatches = text.match(/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g) || [];
    explicitFileMatches.forEach((value) => matches.add(value.replace(/^[/\\]+/, "")));

    const implicitKeywords = ["todo", "readme", "changelog", "notes", "plan", "spec"];
    for (const keyword of implicitKeywords) {
        if (new RegExp(`(^|\\b)${keyword}(\\b|$)`, "i").test(text)) {
            const normalized = resolveImplicitWorkspaceAlias(projectFiles, keyword);
            if (normalized) {
                matches.add(normalized);
            }
        }
    }

    return Array.from(matches);
}

export function resolveWorkspaceFileReferences(projectFiles = [], references = []) {
    const normalizedReferences = references.map((ref) => normalizeText(ref.replace(/^[/\\]+/, "")));
    if (normalizedReferences.length === 0) return [];

    return projectFiles.filter((file) => {
        const normalizedPath = normalizeText(file.path.replace(/^[/\\]+/, ""));
        const normalizedBasename = normalizedPath.split("/").pop() || normalizedPath;
        return normalizedReferences.some((ref) => normalizedPath.endsWith(ref) || normalizedBasename === ref);
    });
}

export function formatWorkspaceReferenceContext(files = []) {
    if (!Array.isArray(files) || files.length === 0) {
        return "";
    }

    let output = "Referenced workspace files:\n";
    files.forEach((file) => {
        const content = String(file.content || "");
        const preview = content.length > 2000 ? `${content.slice(0, 2000)}\n...` : content;
        output += `\nFile: ${file.path}\n\`\`\`\n${preview}\n\`\`\`\n`;
    });
    return `${output}\n---\n\n`;
}
