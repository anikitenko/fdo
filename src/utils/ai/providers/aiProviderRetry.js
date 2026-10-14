// Preserve only a numeric retry hint across the provider boundary. Never copy
// response headers or bodies into errors sent to the editor.
export function providerRetryAfterMs(error, now = Date.now()) {
    if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0) return error.retryAfterMs;
    const headers = error?.headers;
    const raw = typeof headers?.get === 'function' ? headers.get('retry-after')
        : headers && Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
    if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
    const value = String(raw).trim();
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        const milliseconds = Number(value) * 1000;
        return Number.isSafeInteger(Math.ceil(milliseconds)) ? Math.ceil(milliseconds) : undefined;
    }
    // HTTP-date, not Date.parse's permissive interpretations of plain numbers.
    if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s/i.test(value)) return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}
