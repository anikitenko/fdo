import {IconNames} from "@blueprintjs/icons";
import {isCuratedOperatorProcessScopeId, isHostFallbackProcessScopeId} from "../../../utils/processScopeCatalog";
import {hasCapability as hasGrantedCapability, HOST_WRITE_CAPABILITY} from "../../../utils/pluginCapabilities";

function toLineColumn(text, index) {
    const safeText = typeof text === "string" ? text : "";
    const bounded = Math.max(0, Math.min(index, safeText.length));
    const before = safeText.slice(0, bounded);
    const lines = before.split("\n");
    const lineNumber = Math.max(1, lines.length);
    const column = Math.max(1, (lines[lines.length - 1] || "").length + 1);
    return {lineNumber, column};
}

function createMarker(source, startIndex, endIndex, message, severity = 4, code = "FDO_CAPABILITY") {
    const start = toLineColumn(source, startIndex);
    const end = toLineColumn(source, Math.max(startIndex + 1, endIndex));
    return {
        message,
        severity,
        code,
        source: "fdo-capability",
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: Math.max(start.column + 1, end.column),
    };
}

function hasCapability(granted, capabilityId) {
    return hasGrantedCapability([...granted], capabilityId);
}

const BLUEPRINT_ICON_NAMES = Array.from(new Set(
    Object.values(IconNames).filter((value) => typeof value === "string" && value.trim().length > 0)
)).sort();

const BLUEPRINT_ICON_SET = new Set(BLUEPRINT_ICON_NAMES);

const DEFAULT_ICON_SUGGESTIONS = ["cog", "application", "code", "wrench", "widget"];
function toNormalizedIcon(value = "") {
    return String(value || "").trim().toLowerCase();
}

function findMetadataObjectStart(source = "") {
    const text = String(source || "");
    const metadataInit = /PluginMetadata\s*=\s*{/g;
    const metadataGetter = /get\s+metadata\s*\(\)\s*:\s*PluginMetadata\s*{[\s\S]*?return\s*{/g;
    const initMatch = metadataInit.exec(text);
    if (initMatch) {
        return initMatch.index + initMatch[0].lastIndexOf("{");
    }
    const getterMatch = metadataGetter.exec(text);
    if (getterMatch) {
        return getterMatch.index + getterMatch[0].lastIndexOf("{");
    }
    return -1;
}

function scoreIconSuggestion(candidate = "", requested = "") {
    const icon = toNormalizedIcon(candidate);
    const asked = toNormalizedIcon(requested);
    if (!icon) return 0;
    if (!asked) return 1;
    if (icon === asked) return 1000;

    let best = 0;
    if (icon.startsWith(asked)) {
        best = Math.max(best, 900 - (icon.length - asked.length));
    }
    if (asked.startsWith(icon)) {
        best = Math.max(best, 850 - (asked.length - icon.length));
    }
    if (icon.includes(asked)) {
        best = Math.max(best, 700 - Math.abs(icon.length - asked.length));
    }
    if (asked.includes(icon)) {
        best = Math.max(best, 650 - Math.abs(icon.length - asked.length));
    }

    const askedTokens = new Set(asked.split("-").filter(Boolean));
    const iconTokens = icon.split("-").filter(Boolean);
    const sharedTokens = iconTokens.filter((token) => askedTokens.has(token)).length;
    if (sharedTokens > 0) {
        best = Math.max(best, 500 + sharedTokens * 25 - Math.abs(icon.length - asked.length));
    }

    const compactIcon = icon.replace(/-/g, "");
    const compactAsked = asked.replace(/-/g, "");
    if (compactIcon && compactAsked) {
        const dist = levenshteinDistance(compactIcon, compactAsked);
        if (dist <= 2) {
            best = Math.max(best, 560 - dist * 40 - Math.abs(compactIcon.length - compactAsked.length) * 5);
        }
    }

    let overlap = 0;
    for (const char of asked) {
        if (icon.includes(char)) overlap += 1;
    }
    if (overlap > 0) {
        best = Math.max(best, 200 + overlap);
    }
    return best;
}

function getIconPropertyMatches(source = "") {
    const matches = [];
    const iconRegex = /\bicon\s*:\s*(['"`])([^'"`]+)\1/g;
    let match;
    while ((match = iconRegex.exec(source)) !== null) {
        const full = match[0];
        const quote = match[1];
        const iconValue = match[2];
        const valueStart = match.index + full.indexOf(quote) + 1;
        const valueEnd = valueStart + iconValue.length;
        matches.push({
            iconValue,
            normalizedValue: toNormalizedIcon(iconValue),
            quote,
            matchStart: match.index,
            matchEnd: match.index + full.length,
            valueStart,
            valueEnd,
        });
    }
    return matches;
}

function toIndexFromLineColumn(source = "", lineNumber = 1, column = 1) {
    const text = String(source || "");
    const line = Math.max(1, Number(lineNumber || 1));
    const col = Math.max(1, Number(column || 1));
    const lines = text.split("\n");
    let index = 0;
    for (let i = 1; i < line; i += 1) {
        index += (lines[i - 1]?.length || 0) + 1;
    }
    return Math.max(0, Math.min(text.length, index + (col - 1)));
}

function findIconMatchForMarker(source = "", marker = null) {
    if (!marker?.startLineNumber || !marker?.startColumn) {
        return null;
    }
    const startIndex = toIndexFromLineColumn(source, marker.startLineNumber, marker.startColumn);
    const endIndex = toIndexFromLineColumn(source, marker.endLineNumber, marker.endColumn);
    const rangeStart = Math.min(startIndex, endIndex);
    const rangeEnd = Math.max(startIndex, endIndex);
    const matches = getIconPropertyMatches(source);
    return matches.find((match) => (
        (rangeStart >= match.valueStart && rangeStart <= match.valueEnd)
        || (rangeEnd >= match.valueStart && rangeEnd <= match.valueEnd)
        || (rangeStart <= match.valueStart && rangeEnd >= match.valueEnd)
    )) || null;
}

export function suggestBlueprintIcons(requested = "", limit = 5) {
    const normalized = toNormalizedIcon(requested);
    const maxSuggestions = Math.max(1, limit);
    const fallbackOnly = DEFAULT_ICON_SUGGESTIONS.filter((icon) => BLUEPRINT_ICON_SET.has(icon));

    if (!normalized) {
        return Array.from(new Set(fallbackOnly)).slice(0, maxSuggestions);
    }

    const strongRanked = BLUEPRINT_ICON_NAMES
        .map((icon) => ({icon, score: scoreIconSuggestion(icon, normalized)}))
        .filter((entry) => entry.score >= 320)
        .sort((a, b) => b.score - a.score || a.icon.localeCompare(b.icon))
        .slice(0, maxSuggestions)
        .map((entry) => entry.icon);

    if (strongRanked.length > 0) {
        return strongRanked;
    }

    // No strong fuzzy/semantic match.
    // Prefer deterministic first-letter matches over unrelated defaults.
    const firstChar = normalized.charAt(0);
    if (firstChar) {
        const firstLetterMatches = BLUEPRINT_ICON_NAMES
            .filter((icon) => icon.startsWith(firstChar))
            .sort((a, b) => a.localeCompare(b))
            .slice(0, maxSuggestions);
        if (firstLetterMatches.length > 0) {
            return firstLetterMatches;
        }
    }

    // If there is still no meaningful relation, avoid misleading replacements.
    return [];
}

function levenshteinDistance(a = "", b = "") {
    const left = String(a);
    const right = String(b);
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;

    const prev = Array.from({length: right.length + 1}, (_, i) => i);
    const curr = new Array(right.length + 1).fill(0);

    for (let i = 1; i <= left.length; i += 1) {
        curr[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost
            );
        }
        for (let j = 0; j <= right.length; j += 1) {
            prev[j] = curr[j];
        }
    }

    return prev[right.length];
}

function detectMetadataIconFindings(source = "") {
    const findings = [];
    const metadataObjectStart = findMetadataObjectStart(source);
    if (metadataObjectStart < 0) {
        return findings;
    }

    const iconMatches = getIconPropertyMatches(source);
    const metadataIcon = iconMatches.find((iconMatch) => iconMatch.matchStart > metadataObjectStart);

    if (!metadataIcon) {
        findings.push({
            kind: "missing",
            start: metadataObjectStart,
            end: metadataObjectStart + 1,
            code: "FDO_MISSING_METADATA_ICON",
            message: 'Missing `metadata.icon`. Use a BlueprintJS v6 icon name string (for example: "cog").',
            suggestions: suggestBlueprintIcons("", 5),
        });
        return findings;
    }

    if (!BLUEPRINT_ICON_SET.has(metadataIcon.normalizedValue)) {
        findings.push({
            kind: "invalid",
            start: metadataIcon.valueStart,
            end: metadataIcon.valueEnd,
            code: "FDO_INVALID_METADATA_ICON",
            message: `Invalid metadata.icon "${metadataIcon.iconValue}". Use a valid BlueprintJS v6 icon name.`,
            invalidIcon: metadataIcon.iconValue,
            quote: metadataIcon.quote,
            suggestions: suggestBlueprintIcons(metadataIcon.iconValue, 5),
        });
    }

    return findings;
}

function detectHostsWriteUsage(source) {
    const matches = [];
    const patterns = [
        /createHostsWriteActionRequest\s*\(/g,
        /["'`]system\.host\.write["'`]/g,
        /["'`]system\.hosts\.write["'`]/g,
    ];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    return matches;
}

function detectMutateUsage(source) {
    const matches = [];
    const patterns = [
        /createFilesystemMutateActionRequest\s*\(/g,
        /["'`]system\.fs\.mutate["'`]/g,
    ];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    return matches;
}

function detectProcessExecUsage(source) {
    const matches = [];
    const patterns = [
        /createProcessExecActionRequest\s*\(/g,
        /["'`]system\.process\.exec["'`]/g,
    ];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    return matches;
}

function detectClipboardReadUsage(source) {
    const matches = [];
    const patterns = [
        /requestClipboardRead\s*\(/g,
        /createClipboardReadRequest\s*\(/g,
        /createClipboardReadActionRequest\s*\(/g,
        /["'`]system\.clipboard\.read["'`]/g,
    ];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    return matches;
}

function detectClipboardWriteUsage(source) {
    const matches = [];
    const patterns = [
        /requestClipboardWrite\s*\(/g,
        /createClipboardWriteRequest\s*\(/g,
        /createClipboardWriteActionRequest\s*\(/g,
        /["'`]system\.clipboard\.write["'`]/g,
    ];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    return matches;
}

function detectRawClipboardApiUsage(source) {
    const matches = [];
    const patterns = [
        /\bnavigator\.clipboard\./g,
        /\belectron\.clipboard\./g,
        /\brequire\s*\(\s*["'`]electron["'`]\s*\)\.clipboard\./g,
    ];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    return matches;
}

function detectLowLevelProcessExecRequests(source) {
    const matches = [];
    const pattern = /createProcessExecActionRequest\s*\(/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        matches.push({start: match.index, end: match.index + match[0].length});
    }
    return matches;
}

function detectWorkflowCandidateRequests(source) {
    const patterns = [
        /requestScopedProcessExec\s*\(/g,
        /requestOperatorTool\s*\(/g,
        /createProcessExecActionRequest\s*\(/g,
    ];
    const workflowPatterns = [
        /requestScopedWorkflow\s*\(/g,
        /createScopedWorkflowRequest\s*\(/g,
    ];

    const requestMatches = [];
    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            requestMatches.push({start: match.index, end: match.index + match[0].length});
        }
    });
    const hasWorkflowHelper = workflowPatterns.some((pattern) => pattern.test(source));
    return hasWorkflowHelper ? [] : requestMatches;
}

function detectDeclareCapabilities(source) {
    const match = /declareCapabilities\s*\(\s*\)\s*[:{]/.exec(source);
    if (!match) return null;
    return {
        start: match.index,
        end: match.index + match[0].length,
    };
}

function detectScopes(source) {
    const scopes = [];
    const scopeRegex = /scope\s*:\s*["'`]([a-zA-Z0-9._-]+)["'`]/g;
    let match;
    while ((match = scopeRegex.exec(source)) !== null) {
        scopes.push({
            id: match[1],
            start: match.index,
            end: match.index + match[0].length,
        });
    }
    return scopes;
}

function detectDeprecatedPatterns(source) {
    const findings = [];
    const definitions = [
        {
            pattern: /["'`]__host\.privilegedAction["'`]/g,
            message: 'Deprecated privileged channel "__host.privilegedAction". Prefer `requestOperatorTool(...)` for known tool presets, `requestScopedProcessExec(...)` for custom scopes, or `requestPrivilegedAction(...)` as the low-level SDK transport helper.',
            code: "FDO_DEPRECATED_PRIVILEGED_HANDLER",
        },
        {
            pattern: /["'`]system\.fs\.write["'`]/g,
            message: 'Deprecated action "system.fs.write". Use "system.fs.mutate" with explicit scope capability.',
            code: "FDO_DEPRECATED_ACTION",
        },
    ];

    definitions.forEach((definition) => {
        let match;
        while ((match = definition.pattern.exec(source)) !== null) {
            findings.push({
                start: match.index,
                end: match.index + match[0].length,
                message: definition.message,
                code: definition.code,
            });
        }
    });
    return findings;
}

export function computeCapabilityAndDeprecationMarkers({
    source = "",
    grantedCapabilities = [],
    pluginPersisted = true,
} = {}) {
    const text = typeof source === "string" ? source : "";
    if (!text.trim()) {
        return [];
    }

    const granted = new Set(Array.isArray(grantedCapabilities) ? grantedCapabilities : []);
    const markers = [];

    const hostsWrites = detectHostsWriteUsage(text);
    if (hostsWrites.length > 0 && !hasCapability(granted, HOST_WRITE_CAPABILITY)) {
        hostsWrites.forEach((match) => {
            markers.push(createMarker(
                text,
                match.start,
                match.end,
                pluginPersisted
                    ? `Missing capability: "${HOST_WRITE_CAPABILITY}". Open Manage Plugins -> Capabilities to grant privileged host actions.`
                    : `Draft plugin requires capability "${HOST_WRITE_CAPABILITY}". Save plugin first, then grant in Manage Plugins -> Capabilities.`,
                pluginPersisted ? 4 : 2,
                "FDO_MISSING_SYSTEM_HOSTS_WRITE"
            ));
        });
    }

    const mutates = detectMutateUsage(text);
    if (mutates.length > 0) {
        if (!hasCapability(granted, HOST_WRITE_CAPABILITY)) {
            mutates.forEach((match) => {
                markers.push(createMarker(
                    text,
                    match.start,
                    match.end,
                    pluginPersisted
                        ? `Missing capability: "${HOST_WRITE_CAPABILITY}" is required for "system.fs.mutate". Prefer createFilesystemCapabilityBundle(...) for scoped filesystem grants and parseMissingCapabilityError(...) for runtime denial handling.`
                        : `Draft plugin requires capability "${HOST_WRITE_CAPABILITY}" for "system.fs.mutate". Save plugin first, then grant capability. Prefer createFilesystemCapabilityBundle(...) for scoped filesystem grants and parseMissingCapabilityError(...) for runtime denial handling.`,
                    pluginPersisted ? 4 : 2,
                    "FDO_MISSING_BASE_CAPABILITY"
                ));
            });
        }

        const scopes = detectScopes(text);
        scopes.forEach((scope) => {
            const scopeCapability = `system.fs.scope.${scope.id}`;
            if (!hasCapability(granted, scopeCapability)) {
                markers.push(createMarker(
                    text,
                    scope.start,
                    scope.end,
                    pluginPersisted
                        ? `Missing capability: "${scopeCapability}" is required for scope "${scope.id}". Prefer createFilesystemCapabilityBundle("${scope.id}") and parseMissingCapabilityError(...) for runtime denial handling.`
                        : `Draft plugin requires capability "${scopeCapability}" for scope "${scope.id}". Save plugin first, then grant capability. Prefer createFilesystemCapabilityBundle("${scope.id}") and parseMissingCapabilityError(...) for runtime denial handling.`,
                    pluginPersisted ? 4 : 2,
                    "FDO_MISSING_SCOPE_CAPABILITY"
                ));
            }
        });
    }

    const processExecs = detectProcessExecUsage(text);
    const clipboardReads = detectClipboardReadUsage(text);
    const clipboardWrites = detectClipboardWriteUsage(text);
    const rawClipboardApi = detectRawClipboardApiUsage(text);
    const clipboardUsage = [...clipboardReads, ...clipboardWrites];

    if (clipboardUsage.length > 0 && !hasCapability(granted, HOST_WRITE_CAPABILITY)) {
        clipboardUsage.forEach((match) => {
            markers.push(createMarker(
                text,
                match.start,
                match.end,
                pluginPersisted
                    ? `Missing base capability: "${HOST_WRITE_CAPABILITY}" is required for host-mediated clipboard access. Clipboard helpers require base host privileged access plus clipboard read/write child capability.`
                    : `Draft plugin requires base capability "${HOST_WRITE_CAPABILITY}" for host-mediated clipboard actions. Save plugin first, then grant capability in Manage Plugins -> Capabilities.`,
                pluginPersisted ? 4 : 2,
                "FDO_MISSING_SYSTEM_HOSTS_WRITE_FOR_CLIPBOARD"
            ));
        });
    }

    if (clipboardReads.length > 0 && !hasCapability(granted, "system.clipboard.read")) {
        clipboardReads.forEach((match) => {
            markers.push(createMarker(
                text,
                match.start,
                match.end,
                pluginPersisted
                    ? 'Missing capability: "system.clipboard.read". Clipboard read is sensitive; grant only to trusted plugins that must read host clipboard data. Prefer requestClipboardRead(...) or createClipboardReadRequest(...) over raw transport.'
                    : 'Draft plugin requires capability "system.clipboard.read" for host-mediated clipboard reads. Save plugin first, then grant capability in Manage Plugins -> Capabilities.',
                pluginPersisted ? 4 : 2,
                "FDO_MISSING_SYSTEM_CLIPBOARD_READ"
            ));
        });
    }

    if (clipboardWrites.length > 0 && !hasCapability(granted, "system.clipboard.write")) {
        clipboardWrites.forEach((match) => {
            markers.push(createMarker(
                text,
                match.start,
                match.end,
                pluginPersisted
                    ? 'Missing capability: "system.clipboard.write". Keep write separate from read and grant the minimal permission required. Prefer requestClipboardWrite(...) or createClipboardWriteRequest(...) over raw transport.'
                    : 'Draft plugin requires capability "system.clipboard.write" for host-mediated clipboard writes. Save plugin first, then grant capability in Manage Plugins -> Capabilities.',
                pluginPersisted ? 4 : 2,
                "FDO_MISSING_SYSTEM_CLIPBOARD_WRITE"
            ));
        });
    }

    rawClipboardApi.forEach((match) => {
        markers.push(createMarker(
            text,
            match.start,
            match.end,
            "Raw clipboard API usage detected. For production plugins, route clipboard actions through the host-mediated SDK contract: requestClipboardRead(...) and requestClipboardWrite(...), with explicit read/write capabilities.",
            2,
            "FDO_RAW_CLIPBOARD_API"
        ));
    });

    if (processExecs.length > 0) {
        const scopes = detectScopes(text);
        const knownScope = scopes.find((scope) => isCuratedOperatorProcessScopeId(scope.id)) || null;
        const lowLevelRequests = detectLowLevelProcessExecRequests(text);
        lowLevelRequests.forEach((match) => {
            const message = knownScope
                ? `Low-level helper createProcessExecActionRequest(...) should not be the default for known operator tool family "${knownScope.id}". Prefer the closest operator fixture under examples/fixtures/, then use createOperatorToolCapabilityPreset(...), createOperatorToolActionRequest(...), and requestOperatorTool(...). Reserve createProcessExecActionRequest(...) with requestPrivilegedAction(...) for explicit transport-level control or debugging.`
                : `Low-level helper createProcessExecActionRequest(...) should not be the default authoring path. Prefer the closest operator fixture under examples/fixtures/. For host-specific/internal tools, use createProcessCapabilityBundle(...), createProcessScopeCapability(...), and requestScopedProcessExec(...). Reserve createProcessExecActionRequest(...) with requestPrivilegedAction(...) for explicit transport-level control or debugging.`;
            markers.push(createMarker(
                text,
                match.start,
                match.end,
                message,
                2,
                "FDO_LOW_LEVEL_PROCESS_REQUEST"
            ));
        });

        if (!hasCapability(granted, "system.process.exec")) {
            processExecs.forEach((match) => {
                markers.push(createMarker(
                    text,
                    match.start,
                    match.end,
                    pluginPersisted
                        ? 'Missing broad capability: "system.process.exec". Open Manage Plugins -> Capabilities to allow scoped tool execution. This broad capability must be paired with a narrow scope. Prefer curated tool-family guidance first: the closest operator fixture under examples/fixtures/, then createOperatorToolCapabilityPreset(...). Use createProcessCapabilityBundle(...) and createProcessScopeCapability(...) only for host-specific scopes, and parseMissingCapabilityError(...) for runtime denial handling.'
                        : 'Draft plugin requires broad capability "system.process.exec" for scoped tool execution. Save plugin first, then grant capability. Pair it with a narrow scope. Prefer curated tool-family guidance first: the closest operator fixture under examples/fixtures/, then createOperatorToolCapabilityPreset(...). Use createProcessCapabilityBundle(...) and createProcessScopeCapability(...) only for host-specific scopes, and parseMissingCapabilityError(...) for runtime denial handling.',
                    pluginPersisted ? 4 : 2,
                    "FDO_MISSING_SYSTEM_PROCESS_EXEC"
                ));
            });
        }

        scopes.forEach((scope) => {
            const scopeCapability = `system.process.scope.${scope.id}`;
            if (!hasCapability(granted, scopeCapability)) {
                markers.push(createMarker(
                    text,
                    scope.start,
                    scope.end,
                    pluginPersisted
                        ? `${isCuratedOperatorProcessScopeId(scope.id)
                            ? `Missing narrow scope: "${scopeCapability}". Keep broad capability "system.process.exec" enabled and request the curated tool-family grant for "${scope.id}". Prefer the closest operator fixture under examples/fixtures/, then createOperatorToolCapabilityPreset("${scope.id}"), createOperatorToolActionRequest("${scope.id}", ...), and requestOperatorTool("${scope.id}", ...). Use parseMissingCapabilityError(...) for runtime denial handling.`
                            : isHostFallbackProcessScopeId(scope.id)
                                ? `Missing narrow scope: "${scopeCapability}". Keep broad capability "system.process.exec" enabled and use "${scope.id}" only as a host-specific fallback scope when no curated operator tool family fits. Prefer the closest operator fixture under examples/fixtures/ first. If no curated preset exists, use createProcessCapabilityBundle("${scope.id}"), createProcessScopeCapability("${scope.id}"), and requestScopedProcessExec("${scope.id}", ...). Use parseMissingCapabilityError(...) for runtime denial handling.`
                                : `Missing narrow scope: "${scopeCapability}". Keep broad capability "system.process.exec" enabled and request a host-specific scope for "${scope.id}". Prefer the closest operator fixture under examples/fixtures/, then createProcessCapabilityBundle("${scope.id}"), createProcessScopeCapability("${scope.id}"), and requestScopedProcessExec("${scope.id}", ...). Use parseMissingCapabilityError(...) for runtime denial handling.`}`
                        : `${isCuratedOperatorProcessScopeId(scope.id)
                            ? `Draft plugin requires narrow scope "${scopeCapability}" for process scope "${scope.id}". Save plugin first, then request the curated tool-family grant and prefer createOperatorToolCapabilityPreset("${scope.id}").`
                            : isHostFallbackProcessScopeId(scope.id)
                                ? `Draft plugin requires narrow scope "${scopeCapability}" for fallback host scope "${scope.id}". Save plugin first, prefer the closest operator fixture under examples/fixtures/, and use this fallback scope only when no curated operator family fits. Then request a host-specific scope with createProcessCapabilityBundle("${scope.id}") plus createProcessScopeCapability("${scope.id}").`
                                : `Draft plugin requires narrow scope "${scopeCapability}" for process scope "${scope.id}". Save plugin first, then request a host-specific scope and prefer createProcessCapabilityBundle("${scope.id}") plus createProcessScopeCapability("${scope.id}").`}`,
                    pluginPersisted ? 4 : 2,
                    "FDO_MISSING_PROCESS_SCOPE_CAPABILITY"
                ));
            }
        });
    }

    const workflowCandidates = detectWorkflowCandidateRequests(text);
    const declaresCapabilities = detectDeclareCapabilities(text);
    const usesPrivilegedOperatorPatterns = hostsWrites.length > 0
        || mutates.length > 0
        || processExecs.length > 0
        || workflowCandidates.length > 0
        || clipboardReads.length > 0
        || clipboardWrites.length > 0;
    if (usesPrivilegedOperatorPatterns && !declaresCapabilities) {
        const anchor = processExecs[0] || mutates[0] || hostsWrites[0] || workflowCandidates[0];
        if (anchor) {
            markers.push(createMarker(
                text,
                anchor.start,
                anchor.end,
                'Privileged/operator plugins should implement `declareCapabilities(): PluginCapability[]` as an early intent manifest for host preflight and diagnostics. Treat it as additive UX only: keep runtime checks and granted-capability enforcement unchanged. For known tool families, return `createOperatorToolCapabilityPreset(...)`; for host-specific scoped execution, return `createProcessCapabilityBundle(...)`.',
                2,
                "FDO_DECLARE_CAPABILITIES_RECOMMENDED"
            ));
        }
    }
    if (workflowCandidates.length > 1) {
        const second = workflowCandidates[1];
        markers.push(createMarker(
            text,
            second.start,
            second.end,
            'This code appears to orchestrate multiple host-mediated process steps. Prefer `createScopedWorkflowRequest(...)` and `requestScopedWorkflow(...)` for preview/apply or inspect/act flows instead of plugin-private chaining. Keep the host-mediated trust boundary explicit and keep single-action helpers for single-step work.',
            2,
            "FDO_WORKFLOW_CANDIDATE"
        ));
    }

    const deprecations = detectDeprecatedPatterns(text);
    deprecations.forEach((deprecation) => {
        markers.push(createMarker(
            text,
            deprecation.start,
            deprecation.end,
            deprecation.message,
            2,
            deprecation.code
        ));
    });

    const metadataFindings = detectMetadataIconFindings(text);
    metadataFindings.forEach((finding) => {
        const marker = createMarker(
            text,
            finding.start,
            finding.end,
            finding.message,
            4,
            finding.code
        );
        marker.fdoData = finding;
        markers.push(marker);
    });

    return markers;
}

export function mergeMonacoValidationMarkers(baseMarkers = [], capabilityMarkers = []) {
    const safeBase = Array.isArray(baseMarkers) ? baseMarkers : [];
    const safeCapability = Array.isArray(capabilityMarkers) ? capabilityMarkers : [];
    return [...safeBase, ...safeCapability];
}

function getLineIndentation(source = "", index = 0) {
    const text = String(source || "");
    const lineStart = text.lastIndexOf("\n", Math.max(0, index)) + 1;
    const line = text.slice(lineStart, text.indexOf("\n", lineStart) === -1 ? text.length : text.indexOf("\n", lineStart));
    const match = line.match(/^\s*/);
    return match?.[0] || "";
}

export function buildMetadataIconCodeActions({
    source = "",
    marker = null,
} = {}) {
    const text = String(source || "");
    if (!marker || !marker.code) {
        return [];
    }

    const fixes = [];
    if (marker.code === "FDO_INVALID_METADATA_ICON") {
        const finding = marker.fdoData || {};
        const iconMatch = findIconMatchForMarker(text, marker);
        const invalidIcon = finding.invalidIcon || iconMatch?.iconValue || "";
        const suggestions = Array.isArray(finding.suggestions)
            ? finding.suggestions
            : suggestBlueprintIcons(invalidIcon, 5);
        suggestions.forEach((icon) => {
            fixes.push({
                title: `Use Blueprint icon "${icon}"`,
                edit: {
                    range: {
                        startLineNumber: marker.startLineNumber,
                        startColumn: marker.startColumn,
                        endLineNumber: marker.endLineNumber,
                        endColumn: marker.endColumn,
                    },
                    text: `${icon}`,
                },
            });
        });
    }

    if (marker.code === "FDO_MISSING_METADATA_ICON") {
        const suggestions = Array.isArray(marker.fdoData?.suggestions) ? marker.fdoData.suggestions : suggestBlueprintIcons("", 3);
        const insertionIndex = Math.max(0, findMetadataObjectStart(text) + 1);
        const insertPos = toLineColumn(text, insertionIndex);
        const baseIndent = getLineIndentation(text, insertionIndex);
        suggestions.slice(0, 3).forEach((icon) => {
            fixes.push({
                title: `Add metadata icon "${icon}"`,
                edit: {
                    range: {
                        startLineNumber: insertPos.lineNumber,
                        startColumn: insertPos.column,
                        endLineNumber: insertPos.lineNumber,
                        endColumn: insertPos.column,
                    },
                    text: `\n${baseIndent}    icon: "${icon}",`,
                },
            });
        });
    }

    return fixes;
}

function extractRequiredCapabilityFromMessage(message = "") {
    const text = String(message || "");
    const quoted = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter(Boolean);
    if (quoted.length === 0) {
        return "";
    }
    const capability = quoted.find((value) => value.startsWith("system."));
    return capability || quoted[0];
}

function getLineStartColumn() {
    return 1;
}

function getIndentFromMarkerLine(source = "", marker = null) {
    if (!marker?.startLineNumber) return "";
    const lines = String(source || "").split("\n");
    const line = lines[Math.max(0, marker.startLineNumber - 1)] || "";
    return (line.match(/^\s*/) || [""])[0];
}

function buildCapabilityGuidanceCommentFix({ source = "", marker = null, capability = "" } = {}) {
    if (!marker?.startLineNumber || !capability) {
        return null;
    }
    const indent = getIndentFromMarkerLine(source, marker);
    return {
        title: `Insert capability guidance for "${capability}"`,
        edit: {
            range: {
                startLineNumber: marker.startLineNumber,
                startColumn: getLineStartColumn(),
                endLineNumber: marker.startLineNumber,
                endColumn: getLineStartColumn(),
            },
            text: `${indent}// Requires host capability: ${capability} (grant in Manage Plugins -> Capabilities)\n`,
        },
    };
}

export function buildCapabilityAndDeprecationCodeActions({
    source = "",
    marker = null,
} = {}) {
    if (!marker?.code) {
        return [];
    }

    const fixes = [];
    if (marker.code === "FDO_DEPRECATED_PRIVILEGED_HANDLER") {
        fixes.push({
            title: 'Replace with `requestPrivilegedAction(...)` helper',
            edit: {
                range: {
                    startLineNumber: marker.startLineNumber,
                    startColumn: marker.startColumn,
                    endLineNumber: marker.endLineNumber,
                    endColumn: marker.endColumn,
                },
                text: 'requestPrivilegedAction',
            },
        });
    }

    if (marker.code === "FDO_DEPRECATED_ACTION") {
        fixes.push({
            title: 'Replace with "system.fs.mutate"',
            edit: {
                range: {
                    startLineNumber: marker.startLineNumber,
                    startColumn: marker.startColumn,
                    endLineNumber: marker.endLineNumber,
                    endColumn: marker.endColumn,
                },
                text: '"system.fs.mutate"',
            },
        });
    }

    if (String(marker.code).startsWith("FDO_MISSING_")) {
        const requiredCapability = extractRequiredCapabilityFromMessage(marker.message || "");
        const guidanceFix = buildCapabilityGuidanceCommentFix({
            source,
            marker,
            capability: requiredCapability || HOST_WRITE_CAPABILITY,
        });
        if (guidanceFix) {
            fixes.push(guidanceFix);
        }
    }

    return fixes;
}
