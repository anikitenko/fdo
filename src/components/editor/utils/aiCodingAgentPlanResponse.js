import {sanitizeVirtualWorkspacePath} from "./aiCodingAgentWorkspacePath.js";

export function parseAiWorkspacePlanResponse(response = "") {
    const files = [];
    const invalidPaths = [];
    const filePattern = /###\s+File:\s+(\/[^\s\n]+)\s*\n\s*```(\w+)?\s*\n([^]{0,50000}?)```/g;

    let match;
    while ((match = filePattern.exec(response)) !== null) {
        const [, path, language, content] = match;
        const safePath = sanitizeVirtualWorkspacePath(path.trim());
        if (!safePath) {
            invalidPaths.push(path.trim());
            continue;
        }
        files.push({
            path: safePath,
            language: language || "",
            content: content.trim(),
        });
    }

    return { files, invalidPaths };
}

export function shouldApplyAiResponseToWorkspace(response = "") {
    const { files, invalidPaths } = parseAiWorkspacePlanResponse(response);
    return files.length > 0 || invalidPaths.length > 0;
}

