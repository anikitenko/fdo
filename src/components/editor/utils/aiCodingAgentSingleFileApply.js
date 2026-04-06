export function extractAiCodeToApply(content = "") {
    const normalized = String(content || "");

    const solutionRegex = /```(?:\w+)?\s*\n(?:\s*\n)?\s*\/\/\s*SOLUTION(?:\s*READY\s*TO\s*APPLY)?\s*\n([\s\S]*?)```/g;
    const solutionMatches = [...normalized.matchAll(solutionRegex)];
    if (solutionMatches.length > 0) {
        return {
            code: solutionMatches[0][1].trim(),
            source: "solution-block",
            blocksFound: solutionMatches.length,
        };
    }

    const anyCodeRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
    const anyMatches = [...normalized.matchAll(anyCodeRegex)];
    if (anyMatches.length > 0) {
        return {
            code: anyMatches[anyMatches.length - 1][1].trim(),
            source: "last-code-block",
            blocksFound: anyMatches.length,
        };
    }

    return {
        code: normalized.trim(),
        source: "full-response",
        blocksFound: 0,
    };
}

function findBalancedBlock(text = "", openIndex = -1) {
    const source = String(text || "");
    if (openIndex < 0 || openIndex >= source.length || source[openIndex] !== "{") {
        return null;
    }

    let depth = 0;
    for (let i = openIndex; i < source.length; i += 1) {
        const char = source[i];
        if (char === "{") depth += 1;
        if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return { start: openIndex, end: i + 1 };
            }
        }
    }

    return null;
}

function findMetadataGetterRange(source = "") {
    const text = String(source || "");
    const match = /(?:public\s+)?get\s+metadata\s*\(\)\s*:\s*PluginMetadata\s*{/.exec(text);
    if (!match) return null;
    const braceIndex = match.index + match[0].lastIndexOf("{");
    const block = findBalancedBlock(text, braceIndex);
    if (!block) return null;
    return {
        start: match.index,
        end: block.end,
    };
}

function findMetadataAssignmentRange(source = "") {
    const text = String(source || "");
    const match = /(?:private|public|protected)?\s*readonly\s+_metadata\s*(?::\s*PluginMetadata)?\s*=\s*{/.exec(text);
    if (!match) return null;
    const braceIndex = match.index + match[0].lastIndexOf("{");
    const block = findBalancedBlock(text, braceIndex);
    if (!block) return null;
    let end = block.end;
    while (end < text.length && /\s/.test(text[end])) {
        end += 1;
    }
    if (text[end] === ";") {
        end += 1;
    }
    return {
        start: match.index,
        end,
    };
}

function extractMetadataResponseBlock(responseContent = "") {
    const extracted = extractAiCodeToApply(responseContent);
    const candidate = String(extracted.code || "");
    const getterRange = findMetadataGetterRange(candidate);
    if (getterRange) {
        return {
            kind: "getter",
            text: candidate.slice(getterRange.start, getterRange.end).trim(),
        };
    }
    const assignmentRange = findMetadataAssignmentRange(candidate);
    if (assignmentRange) {
        return {
            kind: "assignment",
            text: candidate.slice(assignmentRange.start, assignmentRange.end).trim(),
        };
    }
    return null;
}

export function applyAiMetadataBlockResponse({
    responseContent = "",
    targetSource = "",
} = {}) {
    const source = String(targetSource || "");
    if (!source.trim()) return null;

    const responseBlock = extractMetadataResponseBlock(responseContent);
    if (!responseBlock) {
        return null;
    }

    if (responseBlock.kind === "getter") {
        const targetRange = findMetadataGetterRange(source);
        if (!targetRange) return null;
        return `${source.slice(0, targetRange.start)}${responseBlock.text}${source.slice(targetRange.end)}`;
    }

    if (responseBlock.kind === "assignment") {
        const targetRange = findMetadataAssignmentRange(source);
        if (!targetRange) return null;
        return `${source.slice(0, targetRange.start)}${responseBlock.text}${source.slice(targetRange.end)}`;
    }

    return null;
}

function looksLikeCodePayload(code = "", source = "full-response") {
    const value = String(code || "").trim();
    if (!value) return false;

    if (source === "solution-block" || source === "last-code-block") {
        return true;
    }

    const codeSignals = [
        /^\s*(import|export|class|function|const|let|var|interface|type|enum|public|private|protected|async)\b/m,
        /=>/,
        /[{};]/,
        /^\s*</m,
        /^\s*[{[]/m,
        /^\s*["'][A-Za-z0-9_.-]+["']\s*:/m,
        /^\s*[A-Za-z_$][\w$]*\s*:\s*.+$/m,
    ];
    const proseSignals = [
        /\b(i couldn'?t|i could not|if you want me to|what i found|the provided workspace context|the repo context contains|i did not find|send the plugin entry file path)\b/i,
        /(?:^|\n)\s*(what i found|next steps?|if you want|i couldn'?t)\s*:/i,
        /\.\s+[A-Z]/,
    ];

    const codeSignalCount = codeSignals.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
    const hasProseSignal = proseSignals.some((pattern) => pattern.test(value));

    return codeSignalCount >= 2 && !hasProseSignal;
}

export function decideAiSingleFileApplyStrategy({
    action = "",
    content = "",
    currentFileText = "",
    selectedText = "",
    hasSelection = false,
}) {
    const extracted = extractAiCodeToApply(content);
    const codeToApply = extracted.code;
    const fileText = String(currentFileText || "");
    const selectionText = String(selectedText || "");
    const codeLikePayload = looksLikeCodePayload(codeToApply, extracted.source);

    const looksLikeWholeFile = (
        (
            codeLikePayload &&
            codeToApply.length >= Math.max(80, fileText.length * 0.6)
        ) ||
        /^\s*import\s/m.test(codeToApply) ||
        /^\s*export\s+(default|class|function|const)\b/m.test(codeToApply) ||
        /\bclass\s+[A-Za-z_]\w*/.test(codeToApply) ||
        (codeLikePayload && (/^\s*</m.test(codeToApply) || /^\s*[{[]/m.test(codeToApply)))
    );
    const isSurgicalEditMode = action === "fix" || action === "edit";

    if (hasSelection) {
        if (
            isSurgicalEditMode &&
            !looksLikeWholeFile &&
            selectionText.length > 120 &&
            codeToApply.length < selectionText.length * 0.7
        ) {
            return {
                ...extracted,
                mode: "unsafe-partial-selection",
                safe: false,
                reason: "The AI returned a small snippet for a large selected region. Fix/edit mode requires either SEARCH/REPLACE patches or a full rewrite of the selected code.",
            };
        }
        return {
            ...extracted,
            mode: looksLikeWholeFile && selectionText.length < codeToApply.length * 0.5
                ? "replace-whole-file"
                : "replace-selection",
            safe: true,
        };
    }

    if (looksLikeWholeFile) {
        return {
            ...extracted,
            mode: "replace-whole-file",
            safe: true,
        };
    }

    return {
        ...extracted,
        mode: "unsafe-no-selection",
        safe: false,
        reason: "No editor selection is active, and the AI response does not look like a full-file replacement.",
    };
}
