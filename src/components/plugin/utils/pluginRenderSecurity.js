import {parse} from "@babel/parser";

const MAX_PLUGIN_SOURCE_LENGTH = 512 * 1024;

const failFastRules = [
    { pattern: /\bglobalThis\s*\.\s*/, reason: "global object access" },
    { pattern: /\bprocess\s*\.\s*/, reason: "Node process access" },
    { pattern: /\beval\s*\(/, reason: "eval" },
    { pattern: /\bFunction\s*\(/, reason: "Function constructor" },
    { pattern: /\bnew\s+Function\s*\(/, reason: "Function constructor" },
    { pattern: /\bimportScripts\s*\(/, reason: "worker script imports" },
    { pattern: /\bwindow\s*\.\s*parent\b/, reason: "direct parent window access" },
    { pattern: /\bwindow\s*\.\s*top\b/, reason: "direct top window access" },
    { pattern: /\bwindow\s*\.\s*location\b/, reason: "programmatic navigation" },
    { pattern: /\blocation\s*\.\s*(?:assign|replace|reload)\s*\(/, reason: "programmatic navigation" },
    { pattern: /\blocation\s*\.\s*href\s*=/, reason: "programmatic navigation" },
    { pattern: /\bhistory\s*\.\s*(?:pushState|replaceState)\s*\(/, reason: "history navigation" },
    { pattern: /\bwindow\s*\.\s*open\s*\(/, reason: "window navigation" },
    { pattern: /\bdocument\s*\.\s*cookie\b/, reason: "cookie access" },
    { pattern: /\blocalStorage\b/, reason: "localStorage access" },
    { pattern: /\bsessionStorage\b/, reason: "sessionStorage access" },
    { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, reason: "beacon network access" },
    { pattern: /\b(?:SharedWorker|Worker)\s*\(/, reason: "worker creation" },
    { pattern: /\bRTCPeerConnection\s*\(/, reason: "WebRTC network access" },
];

function executableSource(code, label, requireValidSyntax) {
    try {
        const ast = parse(code, {
            sourceType: "unambiguous",
            plugins: ["jsx", "typescript"],
            allowReturnOutsideFunction: true,
            tokens: true,
        });
        // Preserve expressions inside template literals and JSX, but exclude
        // prose, comments, regex bodies, and quoted values from code checks.
        const ignored = new Set(["string", "regexp", "template", "jsxText", "CommentLine", "CommentBlock"]);
        let result = "";
        let offset = 0;
        for (const token of ast.tokens) {
            const kind = typeof token.type === "string" ? token.type : token.type.label;
            if (!ignored.has(kind)) continue;
            result += code.slice(offset, token.start) + " ".repeat(token.end - token.start);
            offset = token.end;
        }
        return result + code.slice(offset);
    } catch (error) {
        if (requireValidSyntax) {
            throw new Error(`${label} is not valid JavaScript/TypeScript: ${error.message}`);
        }
        // The renderer owns syntax diagnostics (and legacy HTML payloads).
        // Preserve the conservative guard if the input cannot be tokenized.
        return code;
    }
}

export function rejectKnownUnsafeRenderPatterns(code, label = "plugin UI source", {requireValidSyntax = false} = {}) {
    if (typeof code !== "string") {
        throw new Error(`${label} must be a string.`);
    }

    if (code.length > MAX_PLUGIN_SOURCE_LENGTH) {
        throw new Error(`${label} exceeds the host size limit.`);
    }

    const executable = executableSource(code, label, requireValidSyntax);
    for (const rule of failFastRules) {
        if (rule.pattern.test(executable)) {
            throw new Error(`${label} contains blocked ${rule.reason}. This is only a fail-fast guard; the iframe sandbox is the real security boundary.`);
        }
    }

    return code;
}

export function normalizePluginRenderPayload(content) {
    if (!content || typeof content !== "object") {
        throw new Error("Plugin render payload must be an object.");
    }

    return {
        onLoad: rejectKnownUnsafeRenderPatterns(parseSerializedRenderSegment(content.onLoad ?? JSON.stringify("null"), "onLoad"), "plugin onLoad source", {requireValidSyntax: true}),
        render: rejectKnownUnsafeRenderPatterns(parseSerializedRenderSegment(content.render, "render"), "plugin render source"),
    };
}

export function normalizePluginJsxSource(code) {
    if (typeof code !== "string" || code.length === 0) {
        return code;
    }

    let normalized = code.replace(/\bclass=(["'])(.*?)\1/g, 'className="$2"');

    normalized = normalized.replace(/\bstyle=(["'])(.*?)\1/g, (_match, _quote, styleValue) => {
        const styleObject = serializeInlineStyle(styleValue);
        return styleObject ? `style={{${styleObject}}}` : 'style={{}}';
    });

    return normalized;
}

function parseSerializedRenderSegment(serialized, label) {
    if (typeof serialized !== "string") {
        throw new Error(`Plugin ${label} payload must be a JSON string.`);
    }

    if (serialized.length > MAX_PLUGIN_SOURCE_LENGTH) {
        throw new Error(`Plugin ${label} payload exceeds the host size limit.`);
    }

    let parsed;
    try {
        parsed = JSON.parse(serialized);
    } catch (error) {
        throw new Error(`Plugin ${label} payload is not valid JSON.`);
    }

    if (typeof parsed !== "string") {
        throw new Error(`Plugin ${label} payload must decode to a string.`);
    }

    return parsed;
}

export function isTrustedPluginFrameEvent(event, pluginWindow) {
    const hasStructuredPayload = Boolean(
        event &&
        event.data &&
        typeof event.data === "object" &&
        typeof event.data.type === "string"
    );
    if (!hasStructuredPayload) {
        return false;
    }

    if (pluginWindow && event.source === pluginWindow) {
        return true;
    }

    // In sandboxed iframe mode, WindowProxy identity can be unstable across lifecycle
    // transitions. Keep trust constrained to known structured plugin bridge messages.
    const type = String(event.data.type || "");
    if (type === "OPEN_EXTERNAL_LINK") {
        // External URL navigation should only be accepted from the active plugin iframe
        // source identity; do not allow loose origin-based fallback for this path.
        return false;
    }
    const allowedType = (
        type === "PLUGIN_HELLO"
        || type === "PLUGIN_STAGE"
        || type === "PLUGIN_IFRAME_INTERACTION"
        || type === "PLUGIN_SHORTCUT"
        || type === "UI_MESSAGE_REQUEST"
        || type === "UI_MESSAGE"
        || type === "OPEN_EXTERNAL_LINK"
    );
    const sandboxLikeOrigin = event.origin === "null" || event.origin === "";
    return Boolean(allowedType && sandboxLikeOrigin);
}

export function isTrustedParentPluginEvent(event, parentWindow) {
    const hasStructuredPayload = Boolean(
        event &&
        event.data &&
        typeof event.data === "object" &&
        typeof event.data.type === "string"
    );
    if (!hasStructuredPayload) {
        return false;
    }

    if (parentWindow && event.source === parentWindow) {
        return true;
    }

    // Same rationale as above for sandboxed iframe: trust known host bridge message types.
    const type = String(event.data.type || "");
    const allowedType = type === "PLUGIN_RENDER" || type === "UI_MESSAGE_RESPONSE";
    const sandboxLikeOrigin = event.origin === "null" || event.origin === "";
    return Boolean(allowedType && sandboxLikeOrigin);
}

export function isValidPluginUiRequestMessage(message) {
    return Boolean(
        message &&
        typeof message === "object" &&
        typeof message.handler === "string" &&
        message.handler.trim().length > 0
    );
}

export function isValidPluginUiResponseEvent(data, requestId) {
    return Boolean(
        data &&
        data.type === "UI_MESSAGE_RESPONSE" &&
        typeof data.requestId === "string" &&
        data.requestId === requestId
    );
}

export function isValidPluginRenderMessage(data) {
    return Boolean(
        data &&
        data.type === "PLUGIN_RENDER" &&
        data.content &&
        typeof data.content === "object" &&
        typeof data.content.code === "string" &&
        (typeof data.content.onLoad === "string" || typeof data.content.onLoad === "undefined")
    );
}

export function isAllowedPluginExternalUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
        return false;
    }
}

function serializeInlineStyle(styleValue) {
    if (typeof styleValue !== "string") {
        return "";
    }

    const declarations = splitInlineStyleDeclarations(styleValue)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((declaration) => {
            const separatorIndex = declaration.indexOf(":");
            if (separatorIndex === -1) return null;

            const rawProperty = declaration.slice(0, separatorIndex).trim();
            const rawValue = declaration.slice(separatorIndex + 1).trim();
            if (!rawProperty || !rawValue) return null;

            const property = rawProperty.startsWith("--")
                ? JSON.stringify(rawProperty)
                : rawProperty.replace(/-([a-z])/g, (_full, char) => char.toUpperCase());
            const value = JSON.stringify(rawValue);

            return rawProperty.startsWith("--")
                ? `${property}: ${value}`
                : `${property}: ${value}`;
        })
        .filter(Boolean);

    return declarations.join(", ");
}

function splitInlineStyleDeclarations(styleValue) {
    const parts = [];
    let current = "";
    let quote = "";
    let parenDepth = 0;

    for (let index = 0; index < styleValue.length; index += 1) {
        const char = styleValue[index];
        const prev = index > 0 ? styleValue[index - 1] : "";

        if (quote) {
            current += char;
            if (char === quote && prev !== "\\") {
                quote = "";
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
            current += char;
            continue;
        }

        if (char === "(") {
            parenDepth += 1;
            current += char;
            continue;
        }

        if (char === ")" && parenDepth > 0) {
            parenDepth -= 1;
            current += char;
            continue;
        }

        if (char === ";" && parenDepth === 0) {
            parts.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    parts.push(current);
    return parts;
}
