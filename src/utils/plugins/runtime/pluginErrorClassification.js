export function classifyPluginError(reason, details) {
    const detailsText = String(details || "");
    const detailsLower = detailsText.toLowerCase();
    const normalizedReason = String(reason || "").toLowerCase();

    const isSignature = normalizedReason === "verification_failed" || /signature is invalid/.test(detailsLower);
    if (isSignature) {
        return {
            category: "signature",
            summary: "Plugin signature check failed.",
            retryable: false,
        };
    }

    const isRenderOrIframe = /iframe|render|jsx|default component|module did not export/.test(detailsLower)
        || normalizedReason === "render_failed"
        || normalizedReason === "iframe_error";
    if (isRenderOrIframe) {
        return {
            category: "render",
            summary: "Plugin UI failed to render.",
            retryable: true,
        };
    }

    if (normalizedReason === "process_error" || normalizedReason === "process_exit") {
        return {
            category: "runtime",
            summary: "Plugin process stopped unexpectedly.",
            retryable: true,
        };
    }

    const isRuntimeStartup = normalizedReason === "load_failed"
        || /cannot find module|plugin initialization timed out|failed to start|spawn|epipe|econnrefused|enoent|exit code/.test(detailsLower);
    if (isRuntimeStartup) {
        return {
            category: "runtime",
            summary: "Plugin runtime failed to start.",
            retryable: true,
        };
    }

    return {
        category: "unknown",
        summary: "Plugin was unloaded unexpectedly.",
        retryable: true,
    };
}
