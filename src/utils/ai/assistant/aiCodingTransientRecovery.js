import {providerRetryAfterMs} from '../providers/aiProviderRetry';
import {MAX_PROVIDER_RETRY_WAIT_MS} from '../generation/codingRequestPolicy.cjs';

const transientCodes = new Set(["overloaded_error", "server_error", "internal_server_error", "service_unavailable", "rate_limit_error", "rate_limit_exceeded",
    // FDO's own post-first-content watchdog: the stream hung mid-transfer or
    // trickled past the completion budget. The transport faulted, not the
    // model, so the one bounded retry may replay the atomic workspace step.
    "stream_stalled", "stream_incomplete"]);
// Native SDK HTTP status, not a timeout keyword in generated text. Keep SDK
// retries disabled: the application owns backoff, cancellation and accounting.
// 429 is a rate limit, not a spending or quota stop: those stay excluded by
// the quota guard below, while providers signal load with plain 429s.
// 520-527 are Cloudflare's edge-to-origin faults (521 origin unreachable, 522
// the edge timed out reaching the provider origin, 524 a read timeout): the
// proxy never completed a round trip to the provider, so the model was never
// reached and no response content exists to distrust.
const transientStatuses = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529]);

// When the CDN answers instead of the provider, the status survives only
// inside Cloudflare's fixed gateway sentence — "error code: 522" — with no
// error.status attached and no typed code. Extract exactly that one anchored
// sentence; a status appearing anywhere else in diagnostics or in generated
// workspace text is not evidence of a transport fault.
const flattenedGatewayStatus = message => {
    const match = /^error code:\s*(\d{3})\b/i.exec(String(message).trim());
    return match ? Number(match[1]) : 0;
};

// Some gateways flatten an upstream worker-capacity rejection into a plain
// error (including errors delivered over HTTP 200). ResourceExhausted alone
// is not enough: it can also describe an account quota or a permanent limit.
const isWorkerCapacityError = error => {
    const status = Number(error?.status) || 0;
    return (status === 0 || status === 200 || transientStatuses.has(status))
        && /^Upstream error from [a-z][a-z0-9 ._-]{0,63}:\s*ResourceExhausted:\s*Worker local total request limit reached \(\d+\/\d+\)\.?$/i
            .test(String(error?.message || '').trim());
};

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
    const status = Number(error?.status) || flattenedGatewayStatus(message);
    const details = Array.isArray(error?.errors) ? error.errors : error?.error?.errors;
    if (status === 408 && (code === '3008'
        || (Array.isArray(details) && details.some(item => String(item?.code) === '3008')))) return false;
    if (transientCodes.has(code) || transientStatuses.has(status) || isWorkerCapacityError(error)) return true;
    // Older adapters discard structured HTTP errors. Accept only their exact
    // status prefix or the known provider overload sentence, never arbitrary
    // occurrences of "overloaded" in model output or workspace diagnostics.
    return /^(?:429|500|502|503|504|529)\s+(?:Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Overloaded)\b/i.test(message)
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
    budget = {remaining: 1}, wait = waitForRetry, random = Math.random, shouldRetry = () => true,
    maxRetryDelayMs = MAX_PROVIDER_RETRY_WAIT_MS}) {
    try {
        return await run(budget.remaining > 0);
    } catch (error) {
        if (budget.remaining <= 0 || !isAiCodingTransientError(error) || isCancelled() || !shouldRetry(error)) throw error;
        const retryAfterMs = providerRetryAfterMs(error);
        // Never shorten a provider's wait hint to fit our automatic-retry
        // ceiling. A long reset requires a later user-initiated request.
        if (retryAfterMs > maxRetryDelayMs) throw error;
        // A rate limit clears more slowly than a server blip: keep the retry
        // count identical, but wait past the limit window instead of spending
        // the single retry against the same wall.
        const fallbackDelayMs = (Number(error?.status) || flattenedGatewayStatus(error?.message)) === 429 || isWorkerCapacityError(error)
            ? 8000 + Math.floor(random() * 5000)
            : 2000 + Math.floor(random() * 1000);
        const delayMs = Math.max(fallbackDelayMs, retryAfterMs || 0);
        if (delayMs > maxRetryDelayMs) throw error;
        budget.remaining--;
        await onRetry({delayMs});
        if (isCancelled()) throw error;
        await wait(delayMs, isCancelled);
        if (isCancelled()) throw error;
        await onRetryStarted();
        if (isCancelled()) throw error;
        return run(false);
    }
}
