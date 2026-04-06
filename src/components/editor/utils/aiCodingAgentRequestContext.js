function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function rankProjectFiles(projectFiles = [], {
    prompt = "",
    currentFilePath = "",
} = {}) {
    const normalizedPrompt = normalizeText(prompt);
    const normalizedCurrentFilePath = normalizeText(currentFilePath);
    const files = Array.isArray(projectFiles) ? [...projectFiles] : [];

    const metadataFocused = /\b(metadata|plugin(?:'s)?\s+name|display\s+name|icon|author|description|version)\b/.test(normalizedPrompt);
    const renderFocused = /\b(render|ui|iframe|component|screen|view)\b/.test(normalizedPrompt);
    const testFocused = /\b(test|spec|failing tests?|node:test|assert)\b/.test(normalizedPrompt);

    const scoreFile = (file = {}) => {
        const path = String(file?.path || "");
        const normalizedPath = normalizeText(path);
        const basename = normalizedPath.split("/").pop() || normalizedPath;
        let score = 0;

        if (normalizedCurrentFilePath && normalizedPath === normalizedCurrentFilePath) {
            score += 50;
        }
        if (normalizedCurrentFilePath && basename && normalizedCurrentFilePath.endsWith(`/${basename}`)) {
            score += 20;
        }

        if (metadataFocused) {
            if (basename === "fdo.meta.json") score += 200;
            if (basename === "package.json") score += 130;
            if (/index\.[cm]?[jt]sx?$/.test(basename)) score += 120;
            if (/render\.[cm]?[jt]sx?$/.test(basename)) score += 40;
            if (/\bmetadata\b/.test(String(file?.content || "").toLowerCase())) score += 100;
            if (/\b(name|version|author|description|icon)\s*[:=]/.test(String(file?.content || "").toLowerCase())) score += 80;
        }

        if (renderFocused) {
            if (/render\.[cm]?[jt]sx?$/.test(basename)) score += 180;
            if (/index\.[cm]?[jt]sx?$/.test(basename)) score += 70;
        }

        if (testFocused) {
            if (/(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath)) score += 180;
            if (/tests?\//.test(normalizedPath)) score += 80;
        }

        if (/index\.[cm]?[jt]sx?$/.test(basename)) score += 30;
        if (/render\.[cm]?[jt]sx?$/.test(basename)) score += 20;

        return score;
    };

    return files.sort((a, b) => {
        const scoreDiff = scoreFile(b) - scoreFile(a);
        if (scoreDiff !== 0) return scoreDiff;
        return String(a?.path || "").localeCompare(String(b?.path || ""));
    });
}

function buildTargetedProjectContext(projectFiles = [], currentFileContext = "") {
    let context = "";

    if (currentFileContext) {
        context += `Current file content:\n${currentFileContext}\n\n`;
    }

    const nearbyFiles = projectFiles.slice(0, 2);
    if (nearbyFiles.length > 0) {
        context += `Targeted plugin files (${nearbyFiles.length} of ${projectFiles.length} files):\n`;
        nearbyFiles.forEach((file) => {
            const preview = file.content.length > 900
                ? `${file.content.substring(0, 900)}...`
                : file.content;
            context += `\nFile: ${file.path}\n\`\`\`\n${preview}\n\`\`\`\n`;
        });
    }

    return context;
}

function buildProjectContextFromFiles(projectFiles = [], currentFileContext = "") {
    let context = "";

    if (currentFileContext) {
        context += `Current file content:\n${currentFileContext}\n\n`;
    }

    const limitedProjectFiles = projectFiles.slice(0, 8);
    if (limitedProjectFiles.length > 0) {
        context += `Project files (${limitedProjectFiles.length} of ${projectFiles.length} files):\n`;
        limitedProjectFiles.forEach((file) => {
            const preview = file.content.length > 500
                ? `${file.content.substring(0, 500)}...`
                : file.content;
            context += `\nFile: ${file.path}\n\`\`\`\n${preview}\n\`\`\`\n`;
        });
    }

    return context;
}

function buildFocusedProjectContext(projectFiles = [], currentFileContext = "") {
    let context = "";

    if (currentFileContext) {
        context += `Current file content:\n${currentFileContext}\n\n`;
    }

    const nearbyFiles = projectFiles.slice(0, 4);
    if (nearbyFiles.length > 0) {
        context += `Nearby workspace files (${nearbyFiles.length} of ${projectFiles.length} files):\n`;
        nearbyFiles.forEach((file) => {
            const preview = file.content.length > 1200
                ? `${file.content.substring(0, 1200)}...`
                : file.content;
            context += `\nFile: ${file.path}\n\`\`\`\n${preview}\n\`\`\`\n`;
        });
    }

    return context;
}

export function buildAiCodingAgentRequestContexts({
    includeProjectContext = false,
    projectFiles = [],
    currentFileContext = "",
    currentFilePath = "",
    prompt = "",
    workspaceReferenceContext = "",
    problemsContext = "",
    buildOutputContext = "",
    pluginLogsContext = "",
    pluginRuntimeActionContext = "",
    externalReferenceContext = "",
    sdkKnowledgeContext = "",
    projectContextMode = "full",
} = {}) {
    const referenceContext = `${workspaceReferenceContext}${problemsContext}${buildOutputContext}${pluginRuntimeActionContext}${pluginLogsContext}${externalReferenceContext}${sdkKnowledgeContext}`;
    const prioritizedProjectFiles = rankProjectFiles(projectFiles, {
        prompt,
        currentFilePath,
    });
    const projectDetails = includeProjectContext
        ? (
            projectContextMode === "focused"
                ? buildFocusedProjectContext(prioritizedProjectFiles, currentFileContext)
                : (projectContextMode === "targeted"
                    ? buildTargetedProjectContext(prioritizedProjectFiles, currentFileContext)
                    : buildProjectContextFromFiles(prioritizedProjectFiles, currentFileContext))
        )
        : "";
    const projectContext = `${referenceContext}${projectDetails}`;

    return {
        referenceContext,
        projectContext,
    };
}
