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

    // Some assistants return multiple files inside one code fence (or as raw
    // code), using line comments instead of Markdown headings.
    if (files.length === 0 && invalidPaths.length === 0) {
        const fenced = [...response.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(item => item[1]);
        const blocks = fenced.length ? fenced : [response];
        for (const originalBlock of blocks) {
            const block = originalBlock.replace(/^\s*\/\/\s*SOLUTION(?:\s+READY\s+TO\s+APPLY)?[^\S\r\n]*\r?\n/i, "");
            if (!/^\s*\/\/\s*FILE:\s*\S+/i.test(block)) continue;
            const markers = [...block.matchAll(/^\s*\/\/\s*FILE:\s*([^\r\n]+)\r?$/gim)];
            for (let index = 0; index < markers.length; index++) {
                const marker = markers[index];
                const path = marker[1].trim();
                const safePath = sanitizeVirtualWorkspacePath(path);
                if (!safePath) {
                    invalidPaths.push(path);
                    continue;
                }
                files.push({
                    path: safePath,
                    language: "",
                    content: block.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? block.length).trim(),
                });
            }
        }
    }

    return { files, invalidPaths };
}

export function shouldApplyAiResponseToWorkspace(response = "") {
    const { files, invalidPaths } = parseAiWorkspacePlanResponse(response);
    return files.length > 0 || invalidPaths.length > 0;
}
