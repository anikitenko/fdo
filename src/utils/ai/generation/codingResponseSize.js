// A transport bound, not a character-to-token estimate. Partial output is never
// applied. Aborting this attempt must not cancel the parent workspace request.
export function enforceCodingResponseSize(length, maximum, abort = () => {}) {
    if (!Number.isFinite(maximum) || maximum <= 0 || length <= maximum) return;
    abort();
    throw Object.assign(new Error(`Response exceeded its ${maximum}-character transport limit.`),
        {code: 'CODING_RESPONSE_TOO_LARGE', maximum, received: length});
}
