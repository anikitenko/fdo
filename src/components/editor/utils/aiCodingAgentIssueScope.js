function normalizeText(value = "") {
    return String(value || "").toLowerCase();
}

export function shouldIncludeIssueDiagnosis({
    prompt = "",
    action = "",
} = {}) {
    const normalizedPrompt = normalizeText(prompt);
    const normalizedAction = normalizeText(action);
    const looksLikeScaffoldIntent = /\b(create|build|generate|scaffold|implement|make)\b/.test(normalizedPrompt)
        || /plugin\s+like\b/.test(normalizedPrompt)
        || /\blike\s+https?:\/\//.test(normalizedPrompt);
    const explicitTroubleshooting = /\b(diagnos(?:e|is|tic)?|debug|analy[sz]e|investigat(?:e|ion|ing)?|troubleshoot(?:ing)?|crash|broken|failing|failure)\b/.test(normalizedPrompt);
    if (looksLikeScaffoldIntent && !explicitTroubleshooting) {
        return false;
    }

    const asksForTroubleshooting = /\b(diagnos(?:e|is|tic)?|debug|analy[sz]e|investigat(?:e|ion|ing)?|troubleshoot(?:ing)?|fix(?:ing)?|error|failing|failure|problem|issue|crash|broken)\b/.test(normalizedPrompt);
    if (asksForTroubleshooting) {
        return true;
    }
    // Explanation requests are typically root-cause oriented and benefit from framing.
    return normalizedAction === "explain";
}

export function classifyAiCodingIssueScope({
    prompt = "",
    selectedCode = "",
    problemsContext = "",
} = {}) {
    const text = [
        prompt,
        selectedCode,
        problemsContext,
    ].filter(Boolean).join("\n");
    const normalized = normalizeText(text);

    const hasRuntimeError = /error:|typeerror|referenceerror|unhandledpromiserejectionwarning|stack|backend:|\bat\b/.test(normalized);
    const hasSdkSignals = /@anikitenko\/fdo-sdk|fdo_sdk|fdo_sdk|fdointerface|pluginmetadata|domtable|dominput|dombutton|goober|sdk/.test(normalized);
    const hasHostSignals = /plugin host environment|plugin host|window\.|iframe|host runtime|createbackendreq|executeinjectedscript/.test(normalized);
    const hasPluginSignals = /\bplugin\b|index\.ts|render\(|metadata\.icon|init\(\)/.test(normalized);

    if (!hasRuntimeError && !hasSdkSignals && !hasHostSignals) {
        return {
            kind: "none",
            summary: "",
        };
    }

    if (hasSdkSignals && hasHostSignals) {
        return {
            kind: "sdk-host",
            summary: "Diagnosis: likely SDK/host runtime contract issue.",
        };
    }

    if (hasHostSignals) {
        return {
            kind: "host-runtime",
            summary: "Diagnosis: likely plugin host/runtime issue.",
        };
    }

    if (hasSdkSignals) {
        return {
            kind: "sdk",
            summary: "Diagnosis: likely SDK integration issue.",
        };
    }

    if (hasPluginSignals || hasRuntimeError) {
        return {
            kind: "plugin",
            summary: "Diagnosis: likely current plugin implementation issue.",
        };
    }

    return {
        kind: "none",
        summary: "",
    };
}
