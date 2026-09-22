const transientCodes = new Set(["overloaded_error", "server_error", "internal_server_error", "service_unavailable", "rate_limit_error", "rate_limit_exceeded"]);
// Native SDK HTTP status, not a timeout keyword in generated text. Keep SDK
// retries disabled: the application owns backoff, cancellation and accounting.
const transientStatuses = new Set([408, 500, 502, 503, 504, 529]);

export function isAiCodingTransientError(error) {
    let code = String(error?.code || error?.type || "").toLowerCase();
    const message = String(error?.message || "");
    if (!code) {
        // The installed HTTP adapter flattens JSON errors to either a typed
        // prefix or a JSON string; recover only the code, not message keywords.
        code = /^([a-z_]+):\s/i.exec(message)?.[1]?.toLowerCase() || "";
        if (!code && message.startsWith("{")) {
            try {
                const details = JSON.parse(message);
                code = String(details.code || details.type || "").toLowerCase();
            } catch { /* An unstructured error is not automatically retryable. */ }
        }
    }
    if (/quota|credits|billing|payment|authentication|permission|invalid.api.key|content_filter/i.test(`${code} ${message}`)) return false;
    if (['AbortError', 'APIUserAbortError'].includes(error?.name)
        || error?.constructor?.name === 'APIUserAbortError') return false;
    if (error?.retryable === false || error?.headers?.get?.('x-should-retry') === 'false') return false;
    // Workers AI also uses HTTP 408 for an explicitly aborted request (3008).
    // Preserve that distinction from an upstream inference timeout.
    const details = Array.isArray(error?.errors) ? error.errors : error?.error?.errors;
    if (Number(error?.status) === 408 && (code === '3008'
        || (Array.isArray(details) && details.some(item => String(item?.code) === '3008')))) return false;
    if (transientCodes.has(code) || transientStatuses.has(Number(error?.status))) return true;
    // Older adapters discard structured HTTP errors. Accept only their exact
    // status prefix or the known provider overload sentence, never arbitrary
    // occurrences of "overloaded" in model output or workspace diagnostics.
    return /^(?:500|502|503|504|529)\s+(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Overloaded)\b/i.test(message)
        || /^(?:Assistant stream (?:error|response\.failed):\s*)?Our servers are currently overloaded\. Please try again later\.?$/i.test(message.trim());
}

async function waitForRetry(delayMs, isCancelled) {
    const deadline = Date.now() + delayMs;
    while (!isCancelled() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    }
}

// Only a typed upstream HTTP timeout can enter workspace transport recovery.
// A timeout alone does not establish that a module needs to be split.
export function isAiCodingProviderTimeoutError(error) {
    return Number(error?.status) === 408 && isAiCodingTransientError(error);
}

// The caller shares this budget across output-limit recovery, so combining
// recovery paths cannot multiply the number of provider requests.
export async function withCodingTransientRecovery({run, onRetry, onRetryStarted = () => {}, isCancelled = () => false,
    budget = {remaining: 1}, wait = waitForRetry, random = Math.random, shouldRetry = () => true}) {
    try {
        return await run(budget.remaining > 0);
    } catch (error) {
        if (budget.remaining <= 0 || !isAiCodingTransientError(error) || isCancelled() || !shouldRetry(error)) throw error;
        budget.remaining--;
        const delayMs = 2000 + Math.floor(random() * 1000);
        await onRetry({delayMs});
        if (isCancelled()) throw error;
        await wait(delayMs, isCancelled);
        if (isCancelled()) throw error;
        await onRetryStarted();
        if (isCancelled()) throw error;
        return run(false);
    }
}
