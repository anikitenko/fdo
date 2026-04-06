import {sanitizeVirtualWorkspacePath} from "./aiCodingAgentWorkspacePath.js";

export function parseAiSearchReplaceResponse(response = "") {
    const text = String(response || "").replace(/\r\n/g, "\n");
    const blocks = [];
    const invalidPaths = [];
    const blockRegex = /(?:(?:^|\n)(?:#{1,6}\s*)?File:\s*([^\n]+)\n)?<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

    let match;
    while ((match = blockRegex.exec(text)) !== null) {
        const rawFilePath = String(match[1] || "").trim();
        const safeFilePath = rawFilePath ? sanitizeVirtualWorkspacePath(rawFilePath) : "";
        if (rawFilePath && !safeFilePath) {
            invalidPaths.push(rawFilePath);
            continue;
        }

        blocks.push({
            filePath: safeFilePath,
            search: match[2],
            replace: match[3],
        });
    }

    return { blocks, invalidPaths };
}

export function parseAiSearchReplaceBlocks(response = "") {
    return parseAiSearchReplaceResponse(response).blocks;
}

export function shouldApplyAiSearchReplace(response = "") {
    const { blocks, invalidPaths } = parseAiSearchReplaceResponse(response);
    return blocks.length > 0 || invalidPaths.length > 0;
}

export function applyAiSearchReplaceBlocks(sourceText = "", blocks = []) {
    let nextText = String(sourceText || "").replace(/\r\n/g, "\n");

    blocks.forEach((block, index) => {
        const search = String(block?.search ?? "");
        const replace = String(block?.replace ?? "");
        const firstIndex = nextText.indexOf(search);

        if (firstIndex === -1) {
            throw new Error(`SEARCH block ${index + 1} did not match the target code.`);
        }

        const secondIndex = nextText.indexOf(search, firstIndex + search.length);
        if (secondIndex !== -1) {
            throw new Error(`SEARCH block ${index + 1} matched multiple locations. Narrow the selection or make the patch more specific.`);
        }

        nextText =
            nextText.slice(0, firstIndex) +
            replace +
            nextText.slice(firstIndex + search.length);
    });

    return nextText;
}
