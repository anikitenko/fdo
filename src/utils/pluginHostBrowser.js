export const FDO_BROWSER_OPEN_HANDLER_ID = "fdo.browser.open.v1";

function toTrimmedString(value = "") {
    return String(value || "").trim();
}

function failure(code, error, correlationId, details = {}) {
    return {
        ok: false,
        code: String(code || "BROWSER_OPEN_FAILED"),
        error: String(error || "Host browser open request failed."),
        correlationId: String(correlationId || `browser-open-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
        details: details && typeof details === "object" ? details : {},
    };
}

function success(payload = {}) {
    return {
        ok: true,
        ...payload,
    };
}

export async function handleHostBrowserOpenRequest(payload = {}, options = {}) {
    const correlationId = toTrimmedString(payload?.correlationId) || `browser-open-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const url = toTrimmedString(payload?.url);
    const policy = toTrimmedString(payload?.policy) || "trusted-content-link";

    if (!url) {
        return failure("BROWSER_OPEN_URL_REQUIRED", "url is required for host browser open request.", correlationId);
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return failure("BROWSER_OPEN_URL_INVALID", "url must be a valid absolute HTTP(S) URL.", correlationId, {url});
    }

    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
        return failure("BROWSER_OPEN_PROTOCOL_UNSUPPORTED", "Only HTTP(S) URLs are supported by host browser broker.", correlationId, {protocol});
    }

    if (typeof options?.openExternal !== "function") {
        return failure("BROWSER_OPEN_UNAVAILABLE", "Host browser open bridge is unavailable.", correlationId);
    }

    try {
        await options.openExternal(parsed.toString());
        return success({
            correlationId,
            policy,
            url: parsed.toString(),
        });
    } catch (error) {
        return failure(
            "BROWSER_OPEN_FAILED",
            error?.message || String(error || "Host browser open request failed."),
            correlationId,
            {url: parsed.toString(), policy}
        );
    }
}
