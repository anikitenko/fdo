export const CODEX_JSON_EARLY_RETRY_MS = 15000;

export function shouldRetryCodexWithoutJsonEarly({
    jsonMode = false,
    retrying = false,
    elapsedMs = 0,
    hasFirstContent = false,
    progressEventCount = 0,
    hasJsonEventStream = false,
} = {}) {
    if (!jsonMode || retrying) return false;
    if (hasFirstContent) return false;
    if (!hasJsonEventStream) return false;
    if (progressEventCount < 2) return false;
    return elapsedMs >= CODEX_JSON_EARLY_RETRY_MS;
}
