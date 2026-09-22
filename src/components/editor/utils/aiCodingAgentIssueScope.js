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
    problemsContext = "",
} = {}) {
    // Source code can contain error constructors, example messages and tests
    // without having failed. Only reported errors/diagnostics are evidence.
    const text = [
        prompt,
        problemsContext,
    ].filter(Boolean).join("\n");
    const normalized = normalizeText(text);

    // A workspace-creation request can inherit stale compiler markers from a
    // prior plugin. Do not present those as a diagnosis of a plugin that has
    // not been generated yet. Explicit debugging language still opts in to a
    // diagnosis when the user is actually investigating a failure.
    const scaffoldIntent = /\b(create|build|generate|scaffold|implement|make)\b[\s\S]{0,100}\bplugin\b/.test(normalized);
    const explicitTroubleshooting = /\b(diagnos(?:e|is|tic)?|debug|analy[sz]e|investigat(?:e|ion|ing)?|troubleshoot(?:ing)?|crash|broken|failing|failure)\b/.test(normalized);
    if (scaffoldIntent && !explicitTroubleshooting) {
        return {
            kind: "none",
            summary: "",
        };
    }

    const hasReportedError = /(?:\b(?:[a-z]+)?error:|typeerror|referenceerror|unhandledpromiserejectionwarning|\bexception\b|\bcrash(?:ed|ing)?\b|plugin process stopped unexpectedly|\bstack trace\b|backend:\s*(?:error|failed))/.test(normalized);
    const hasSdkContractFailure = /(?:@anikitenko\/fdo-sdk|fdo_sdk|fdointerface|pluginmetadata|domtable|dominput|dombutton|goober)\b[^\n]{0,180}\b(?:does not provide|not exported|undefined|unavailable|missing|is not a function|cannot read)|\b(?:baseplugin|fdoplugin)\b[^\n]{0,120}\b(?:undefined|not exported|unavailable|missing)|\bgoober\b[^\n]{0,120}\b(?:unavailable|missing|failed)/.test(normalized);
    const hasHostContractFailure = /(?:plugin host environment|plugin host|host runtime|createbackendreq|executeinjectedscript)[^\n]{0,180}\b(?:error|failed|unavailable|missing|undefined|is not a function|cannot read)|\b(?:error|failed|unavailable|missing|undefined|is not a function|cannot read)[^\n]{0,180}(?:plugin host environment|plugin host|host runtime|createbackendreq|executeinjectedscript)|\biframe\b[^\n]{0,180}\b(?:error|failed|unavailable|missing|undefined|is not a function|cannot read)/.test(normalized);

    if (!hasReportedError && !hasSdkContractFailure && !hasHostContractFailure) {
        return {
            kind: "none",
            summary: "",
        };
    }

    if (hasSdkContractFailure && hasHostContractFailure) {
        return {
            kind: "sdk-host",
            summary: "Possible SDK/host runtime contract issue reported. Verify the concrete diagnostic before assigning a cause.",
        };
    }

    if (hasHostContractFailure) {
        return {
            kind: "host-runtime",
            summary: "Possible plugin host issue reported. Verify the concrete diagnostic before assigning a cause.",
        };
    }

    if (hasSdkContractFailure) {
        return {
            kind: "sdk",
            summary: "Possible SDK integration issue reported. Verify the concrete diagnostic before assigning a cause.",
        };
    }

    if (/plugin process stopped unexpectedly/.test(normalized)) {
        return {
            kind: "runtime",
            summary: "Diagnosis: the plugin process stopped before rendering. Inspect the runtime log for the concrete exception before attributing it to the SDK or host.",
        };
    }

    if (hasReportedError) {
        return {
            kind: "plugin",
            summary: "Reported error included in the request context.",
        };
    }

    return {
        kind: "none",
        summary: "",
    };
}
