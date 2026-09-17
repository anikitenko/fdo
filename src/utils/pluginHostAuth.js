import {isNetworkTargetAllowed} from "./networkScopeRegistry";
import {
    buildRuntimeSecurityPolicy,
    hasCapability,
    NETWORK_CAPABILITY,
    NETWORK_HTTP_CAPABILITY,
    NETWORK_HTTPS_CAPABILITY,
} from "./pluginCapabilities";

export const FDO_AUTH_START_HANDLER_ID = "fdo.auth.start.v1";
export const FDO_AUTH_REFRESH_HANDLER_ID = "fdo.auth.refresh.v1";
export const FDO_AUTH_LOGOUT_HANDLER_ID = "fdo.auth.logout.v1";
export const FDO_SESSION_REQUEST_HANDLER_ID = "fdo.session.request.v1";

const AUTH_REQUIRED_BASE_CAPABILITIES = Object.freeze([NETWORK_CAPABILITY]);
const AUTH_REQUIRED_TRANSPORT_CAPABILITIES = Object.freeze([NETWORK_HTTPS_CAPABILITY, NETWORK_HTTP_CAPABILITY]);
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ECONNREFUSED",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
]);
const RETRY_BACKOFF_MS = Object.freeze([180, 420, 900]);

const sessionStoreByPlugin = new Map();
const authTxnStoreByPlugin = new Map();

function getPluginSessionStore(pluginId = "") {
    const normalizedPluginId = String(pluginId || "").trim() || "__unknown_plugin__";
    if (!sessionStoreByPlugin.has(normalizedPluginId)) {
        sessionStoreByPlugin.set(normalizedPluginId, new Map());
    }
    return sessionStoreByPlugin.get(normalizedPluginId);
}

function getPluginAuthTxnStore(pluginId = "") {
    const normalizedPluginId = String(pluginId || "").trim() || "__unknown_plugin__";
    if (!authTxnStoreByPlugin.has(normalizedPluginId)) {
        authTxnStoreByPlugin.set(normalizedPluginId, new Map());
    }
    return authTxnStoreByPlugin.get(normalizedPluginId);
}

function createCorrelationId(prefix = "auth") {
    return `${String(prefix || "auth").trim()}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createAuthTxnId() {
    return createCorrelationId("auth-txn");
}

function toTrimmedString(value = "") {
    return String(value || "").trim();
}

function failure(code, error, correlationId, details = {}, options = {}) {
    return {
        ok: false,
        code: String(code || "AUTH_BROKER_FAILED"),
        error: String(error || "Host auth broker request failed."),
        correlationId: String(correlationId || createCorrelationId("auth-failed")),
        degraded: options?.degraded === true,
        details: details && typeof details === "object" ? details : {},
    };
}

function success(payload = {}) {
    return {
        ok: true,
        ...payload,
    };
}

function getDeclaredCapabilitiesSnapshot(options = {}) {
    return Array.isArray(options?.declaredCapabilities)
        ? options.declaredCapabilities.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
}

function getGrantedCapabilitiesSnapshot(options = {}) {
    return Array.isArray(options?.grantedCapabilities)
        ? options.grantedCapabilities.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
}

function checkRequiredCapabilities(requiredCapabilities = [], grantedCapabilities = [], declaredCapabilities = []) {
    const missing = (Array.isArray(requiredCapabilities) ? requiredCapabilities : [])
        .filter((capability) => !hasCapability(grantedCapabilities, capability));
    const undeclared = (Array.isArray(requiredCapabilities) ? requiredCapabilities : [])
        .filter((capability) => declaredCapabilities.length > 0 && !hasCapability(declaredCapabilities, capability));
    return {
        missing,
        undeclared,
    };
}

function validateEndpointUrl(endpointUrl = "") {
    const normalizedEndpointUrl = toTrimmedString(endpointUrl);
    if (!normalizedEndpointUrl) {
        return {ok: true, parsedUrl: null};
    }
    try {
        const parsed = new URL(normalizedEndpointUrl);
        const protocol = String(parsed.protocol || "").toLowerCase();
        if (protocol !== "https:" && protocol !== "http:") {
            return {
                ok: false,
                code: "AUTH_ENDPOINT_PROTOCOL_UNSUPPORTED",
                error: "Auth endpoint must use HTTPS or HTTP.",
            };
        }
        return {ok: true, parsedUrl: parsed};
    } catch (_) {
        return {
            ok: false,
            code: "AUTH_ENDPOINT_INVALID",
            error: "Auth endpoint URL must be a valid absolute HTTP(S) URL.",
        };
    }
}

function isScopeAllowedForUrl(parsedUrl, runtimePolicy = {}, transport = "fetch") {
    if (!(parsedUrl instanceof URL)) {
        return false;
    }
    const scopePolicies = Array.isArray(runtimePolicy?.networkScopes) ? runtimePolicy.networkScopes : [];
    if (scopePolicies.length === 0) {
        return false;
    }
    return isNetworkTargetAllowed({
        transport,
        scheme: String(parsedUrl.protocol || "").replace(/:$/, "").toLowerCase(),
        hostname: String(parsedUrl.hostname || "").toLowerCase(),
        port: String(parsedUrl.port || ""),
    }, scopePolicies);
}

function enforceNetworkAuthPolicy(correlationId, options = {}, endpointUrl = "") {
    const grantedCapabilities = getGrantedCapabilitiesSnapshot(options);
    const declaredCapabilities = getDeclaredCapabilitiesSnapshot(options);
    const runtimePolicy = buildRuntimeSecurityPolicy(grantedCapabilities);

    const baseCheck = checkRequiredCapabilities(AUTH_REQUIRED_BASE_CAPABILITIES, grantedCapabilities, declaredCapabilities);
    if (baseCheck.missing.length > 0) {
        return failure(
            "AUTH_CAPABILITY_DENIED",
            `Missing required capabilities: ${baseCheck.missing.join(", ")}.`,
            correlationId,
            {
                requiredCapabilities: AUTH_REQUIRED_BASE_CAPABILITIES,
                missingCapabilities: baseCheck.missing,
                undeclaredRequiredCapabilities: baseCheck.undeclared,
                remediation: `Grant ${AUTH_REQUIRED_BASE_CAPABILITIES.join(", ")} and one of ${AUTH_REQUIRED_TRANSPORT_CAPABILITIES.join(" / ")} in Manage Plugins -> Capabilities.`,
            }
        );
    }

    const hasHttps = hasCapability(grantedCapabilities, NETWORK_HTTPS_CAPABILITY);
    const hasHttp = hasCapability(grantedCapabilities, NETWORK_HTTP_CAPABILITY);
    if (!hasHttps && !hasHttp) {
        return failure(
            "AUTH_TRANSPORT_DENIED",
            `Missing required transport capability. Grant one of: ${AUTH_REQUIRED_TRANSPORT_CAPABILITIES.join(", ")}.`,
            correlationId,
            {
                requiredTransportCapabilities: AUTH_REQUIRED_TRANSPORT_CAPABILITIES,
                remediation: "Enable HTTPS (recommended) or HTTP transport capability for this plugin.",
            }
        );
    }

    const endpointValidation = validateEndpointUrl(endpointUrl);
    if (!endpointValidation.ok) {
        return failure(endpointValidation.code, endpointValidation.error, correlationId, {
            endpointUrl: toTrimmedString(endpointUrl),
        });
    }

    if (!endpointValidation.parsedUrl) {
        return {ok: true, runtimePolicy};
    }

    const scheme = String(endpointValidation.parsedUrl.protocol || "").toLowerCase();
    if (scheme === "https:" && !hasHttps) {
        return failure(
            "AUTH_TRANSPORT_DENIED",
            `HTTPS transport is not granted. Grant "${NETWORK_HTTPS_CAPABILITY}".`,
            correlationId,
            {
                endpointUrl: endpointValidation.parsedUrl.toString(),
                requiredCapability: NETWORK_HTTPS_CAPABILITY,
            }
        );
    }
    if (scheme === "http:" && !hasHttp) {
        return failure(
            "AUTH_TRANSPORT_DENIED",
            `HTTP transport is not granted. Grant "${NETWORK_HTTP_CAPABILITY}".`,
            correlationId,
            {
                endpointUrl: endpointValidation.parsedUrl.toString(),
                requiredCapability: NETWORK_HTTP_CAPABILITY,
            }
        );
    }

    if (!isScopeAllowedForUrl(endpointValidation.parsedUrl, runtimePolicy, "fetch")) {
        return failure(
            "AUTH_SCOPE_DENIED",
            "Auth endpoint is outside granted network destination scopes.",
            correlationId,
            {
                endpointUrl: endpointValidation.parsedUrl.toString(),
                remediation: "Grant a matching system.network.scope.<scope-id> capability for this endpoint.",
            }
        );
    }

    return {
        ok: true,
        runtimePolicy,
        endpointUrl: endpointValidation.parsedUrl.toString(),
    };
}

function sanitizeHeaderRecord(headers = {}) {
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
        return {};
    }
    const normalized = {};
    Object.entries(headers).forEach(([key, value]) => {
        const normalizedKey = toTrimmedString(key);
        if (!normalizedKey) return;
        if (value == null) return;
        normalized[normalizedKey] = String(value);
    });
    return normalized;
}

function normalizeMethod(method = "") {
    const normalized = toTrimmedString(method).toUpperCase();
    return normalized || "GET";
}

function normalizeRequestQuery(query = {}) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(query)
            .map(([key, value]) => [toTrimmedString(key), value])
            .filter(([key, value]) => key && value != null)
            .map(([key, value]) => [key, String(value)])
    );
}

function appendQuery(url, query = {}) {
    const entries = Object.entries(normalizeRequestQuery(query));
    entries.forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
}

function serializeRequestBody(body, headers) {
    if (body == null) {
        return undefined;
    }
    if (typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) {
        return body;
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
        return body;
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
        return body;
    }
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
    if (!hasContentType) {
        headers["content-type"] = "application/json";
    }
    return JSON.stringify(body);
}

function isTransientFetchError(error) {
    const code = toTrimmedString(error?.code || error?.cause?.code).toUpperCase();
    if (code && TRANSIENT_ERROR_CODES.has(code)) {
        return true;
    }
    if (error?.name === "AbortError") {
        return true;
    }
    const message = toTrimmedString(error?.message || String(error || "")).toLowerCase();
    return Boolean(message && (
        message.includes("timeout")
        || message.includes("timed out")
        || message.includes("temporarily unavailable")
        || message.includes("fetch failed")
    ));
}

async function delay(ms = 0) {
    if (!ms || ms <= 0) {
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function performFetchWithRetry(url, requestInit = {}, options = {}) {
    const maxAttempts = Math.max(1, Math.min(4, Number(options?.maxAttempts || 3)));
    const timeoutMs = Math.max(1000, Math.min(30000, Number(options?.timeoutMs || 12000)));
    let lastError = null;
    let lastResponse = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const abortController = typeof AbortController === "function" ? new AbortController() : null;
        const timeoutHandle = abortController
            ? setTimeout(() => abortController.abort(new Error("Request timeout exceeded.")), timeoutMs)
            : null;
        try {
            const response = await fetch(url, {
                ...requestInit,
                signal: abortController ? abortController.signal : undefined,
            });
            lastResponse = response;
            if (!TRANSIENT_STATUS_CODES.has(Number(response.status || 0)) || attempt >= maxAttempts - 1) {
                return response;
            }
            await delay(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
        } catch (error) {
            lastError = error;
            if (!isTransientFetchError(error) || attempt >= maxAttempts - 1) {
                throw error;
            }
            await delay(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    if (lastResponse) {
        return lastResponse;
    }
    if (lastError) {
        throw lastError;
    }
    throw new Error("Session request failed without response.");
}

async function parseResponsePayload(response) {
    const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
        try {
            return await response.json();
        } catch (_) {
            return null;
        }
    }
    try {
        return await response.text();
    } catch (_) {
        return "";
    }
}

function responseHeadersToObject(response) {
    const headers = {};
    try {
        response?.headers?.forEach?.((value, key) => {
            headers[key] = value;
        });
    } catch (_) {
        // no-op
    }
    return headers;
}

function summarizeUpstreamAuthError(raw = null, statusText = "") {
    const normalizedStatusText = toTrimmedString(statusText);
    if (typeof raw === "string") {
        const normalized = raw.replace(/\s+/g, " ").trim();
        if (normalized) {
            return normalized.slice(0, 400);
        }
        return normalizedStatusText;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return normalizedStatusText;
    }
    const record = raw;
    const parts = [
        toTrimmedString(record.error),
        toTrimmedString(record.error_description),
        toTrimmedString(record.errorDescription),
        toTrimmedString(record.message),
        toTrimmedString(record.error_summary),
    ].filter(Boolean);
    if (parts.length > 0) {
        return parts.join(": ").slice(0, 400);
    }
    try {
        const serialized = JSON.stringify(record);
        return serialized.length > 400 ? serialized.slice(0, 400) : serialized;
    } catch (_) {
        return normalizedStatusText;
    }
}

function mergeDefined(...objects) {
    return objects.reduce((acc, candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            return acc;
        }
        Object.entries(candidate).forEach(([key, value]) => {
            if (value !== undefined) {
                acc[key] = value;
            }
        });
        return acc;
    }, {});
}

function computeExpiresAt(expiresIn = 0) {
    const seconds = Number(expiresIn || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return undefined;
    }
    return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeAuthStorageMetadata(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }
    const candidate = input;
    const scheme = toTrimmedString(candidate.scheme || candidate.type || candidate.authType).toLowerCase();
    const headerName = toTrimmedString(candidate.headerName || candidate.header || candidate.tokenHeader);
    const headerPrefix = toTrimmedString(candidate.headerPrefix || candidate.prefix);
    const tokenField = toTrimmedString(candidate.tokenField || candidate.valueField);
    const encoded = toTrimmedString(candidate.encoded || candidate.base64 || candidate.encodedValue);
    const username = toTrimmedString(candidate.username || candidate.user);
    const password = toTrimmedString(candidate.password || candidate.pass);
    const value = toTrimmedString(candidate.value || candidate.token || candidate.accessToken || candidate.access_token);
    return {
        scheme: scheme || undefined,
        headerName: headerName || undefined,
        headerPrefix: headerPrefix || undefined,
        tokenField: tokenField || undefined,
        encoded: encoded || undefined,
        username: username || undefined,
        password: password || undefined,
        value: value || undefined,
    };
}

function extractSessionCredentials(raw = null, payload = {}, existingSession = null) {
    const existing = existingSession?.credentials && typeof existingSession.credentials === "object"
        ? existingSession.credentials
        : {};
    const explicitCredentials = payload?.credentials && typeof payload.credentials === "object" && !Array.isArray(payload.credentials)
        ? payload.credentials
        : {};
    const explicitAuth = normalizeAuthStorageMetadata(explicitCredentials.auth);
    const payloadAuth = normalizeAuthStorageMetadata(payload?.auth);
    const mergedAuth = mergeDefined(existing.auth, explicitAuth, payloadAuth);
    const explicitAccessToken = toTrimmedString(
        explicitCredentials.accessToken
            || explicitCredentials.access_token
            || explicitCredentials.token
            || explicitCredentials.value
    );
    const next = mergeDefined(existing, {
        accessToken: explicitAccessToken || existing.accessToken,
        refreshToken: toTrimmedString(explicitCredentials.refreshToken || explicitCredentials.refresh_token) || existing.refreshToken,
        idToken: toTrimmedString(explicitCredentials.idToken || explicitCredentials.id_token) || existing.idToken,
        tokenType: toTrimmedString(explicitCredentials.tokenType || explicitCredentials.token_type || existing.tokenType || "Bearer") || existing.tokenType,
        scope: toTrimmedString(explicitCredentials.scope) || existing.scope,
        expiresAt: toTrimmedString(explicitCredentials.expiresAt)
            || computeExpiresAt(explicitCredentials.expiresIn || explicitCredentials.expires_in)
            || existing.expiresAt,
        auth: Object.keys(mergedAuth).length > 0 ? mergedAuth : existing.auth,
    });
    const authValue = next?.auth?.value || next?.auth?.encoded || next.accessToken || "";
    if (!next.accessToken && authValue) {
        next.accessToken = authValue;
    }
    return next;
}

function isSessionCredentialExpired(credentials = {}) {
    const expiresAt = toTrimmedString(credentials?.expiresAt);
    if (!expiresAt) {
        return false;
    }
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) {
        return false;
    }
    return expiresMs <= Date.now();
}

function toBase64(value = "") {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(String(value || ""), "utf8").toString("base64");
    }
    return "";
}

function applySessionAuthorization(headers = {}, session = null) {
    const credentials = session?.credentials && typeof session.credentials === "object"
        ? session.credentials
        : {};
    const auth = credentials?.auth && typeof credentials.auth === "object"
        ? credentials.auth
        : {};
    const scheme = toTrimmedString(auth.scheme || credentials.tokenType || "bearer").toLowerCase();
    if (isSessionCredentialExpired(credentials)) {
        const error = new Error("Host session access token is expired.");
        error.code = "AUTH_TOKEN_EXPIRED";
        throw error;
    }
    const tokenValue = toTrimmedString(auth.value || auth.encoded || credentials.accessToken || credentials.token || credentials.value);
    if (scheme === "basic" || scheme === "base64") {
        const encoded = toTrimmedString(auth.encoded) || (auth.username || auth.password
            ? toBase64(`${toTrimmedString(auth.username)}:${toTrimmedString(auth.password)}`)
            : tokenValue);
        if (!encoded) {
            const error = new Error("Host session does not contain Basic/base64 credentials.");
            error.code = "AUTH_SESSION_UNAUTHENTICATED";
            throw error;
        }
        headers.Authorization = `Basic ${encoded}`;
        return headers;
    }
    if (scheme === "plain") {
        const headerName = toTrimmedString(auth.headerName || "Authorization") || "Authorization";
        const prefix = Object.prototype.hasOwnProperty.call(auth, 'headerPrefix') ? String(auth.headerPrefix || "") : "";
        if (!tokenValue) {
            const error = new Error("Host session does not contain a plain authentication token.");
            error.code = "AUTH_SESSION_UNAUTHENTICATED";
            throw error;
        }
        headers[headerName] = prefix ? `${prefix} ${tokenValue}` : tokenValue;
        return headers;
    }
    if (!tokenValue) {
        const error = new Error("Host session does not contain an access token.");
        error.code = "AUTH_SESSION_UNAUTHENTICATED";
        throw error;
    }
    headers.Authorization = `Bearer ${tokenValue}`;
    return headers;
}

function normalizeAuthTransportRequest(request = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
        return null;
    }
    const url = toTrimmedString(request?.url);
    if (!url) {
        return null;
    }
    return {
        url,
        method: normalizeMethod(request?.method),
        headers: sanitizeHeaderRecord(request?.headers || {}),
        query: normalizeRequestQuery(request?.query || {}),
        body: request?.body,
        timeoutMs: Math.max(1000, Math.min(30000, Number(request?.timeoutMs || 12000))),
        maxAttempts: Math.max(1, Math.min(4, Number(request?.maxAttempts || 3))),
    };
}

function resolveAuthEndpointForPolicy(payload = {}, transportRequest = null) {
    const payloadEndpoint = toTrimmedString(payload?.endpointUrl);
    if (payloadEndpoint) {
        return payloadEndpoint;
    }
    return toTrimmedString(transportRequest?.url);
}

async function executeAuthTransportRequest(transportRequest = null, runtimePolicy = {}) {
    if (!transportRequest) {
        return {
            ok: true,
            raw: null,
            status: undefined,
            statusText: "",
            headers: {},
            requestUrl: "",
        };
    }

    let requestUrl;
    try {
        requestUrl = new URL(transportRequest.url);
    } catch (_) {
        return {
            ok: false,
            code: "AUTH_REQUEST_URL_INVALID",
            error: "Auth transport request URL must be a valid absolute HTTP(S) URL.",
            details: {
                url: transportRequest.url,
            },
        };
    }

    const protocol = String(requestUrl.protocol || "").toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") {
        return {
            ok: false,
            code: "AUTH_REQUEST_PROTOCOL_UNSUPPORTED",
            error: "Auth transport request URL must use HTTP(S).",
            details: {
                protocol,
            },
        };
    }

    if (!isScopeAllowedForUrl(requestUrl, runtimePolicy, "fetch")) {
        return {
            ok: false,
            code: "AUTH_SCOPE_DENIED",
            error: "Auth transport destination is outside granted network scopes.",
            details: {
                url: requestUrl.toString(),
            },
        };
    }

    appendQuery(requestUrl, transportRequest.query || {});
    const headers = sanitizeHeaderRecord(transportRequest.headers || {});
    const requestInit = {
        method: transportRequest.method,
        headers,
    };
    if (transportRequest.method !== "GET" && transportRequest.method !== "HEAD") {
        const serializedBody = serializeRequestBody(transportRequest.body, headers);
        if (serializedBody !== undefined) {
            requestInit.body = serializedBody;
        }
    }

    try {
        const response = await performFetchWithRetry(requestUrl.toString(), requestInit, {
            maxAttempts: transportRequest.maxAttempts,
            timeoutMs: transportRequest.timeoutMs,
        });
        const raw = await parseResponsePayload(response);
        const status = Number(response.status || 0);
        const statusText = String(response.statusText || "");
        const upstreamErrorSummary = summarizeUpstreamAuthError(raw, statusText);
        return {
            ok: response.ok,
            raw,
            status,
            statusText,
            headers: responseHeadersToObject(response),
            requestUrl: requestUrl.toString(),
            code: response.ok ? "" : `AUTH_UPSTREAM_HTTP_${status}`,
            error: response.ok ? "" : (`Auth upstream request failed with status ${status}`
                + (upstreamErrorSummary ? `: ${upstreamErrorSummary}` : ".")),
            details: response.ok ? undefined : {
                status,
                statusText,
                requestUrl: requestUrl.toString(),
                raw,
            },
        };
    } catch (error) {
        return {
            ok: false,
            code: "AUTH_REQUEST_FAILED",
            error: error?.message || String(error || "Auth transport request failed."),
            details: {
                url: requestUrl.toString(),
                method: transportRequest.method,
            },
        };
    }
}

export async function handleHostAuthBrokerStartRequest(payload = {}, options = {}) {
    const correlationId = createCorrelationId("auth-start");
    const providerId = toTrimmedString(payload?.providerId);
    if (!providerId) {
        return failure("AUTH_PROVIDER_REQUIRED", "providerId is required to start a host auth session.", correlationId);
    }

    const transportRequest = normalizeAuthTransportRequest(payload?.request || {});
    const endpointUrl = resolveAuthEndpointForPolicy(payload, transportRequest);
    const policy = enforceNetworkAuthPolicy(correlationId, options, endpointUrl);
    if (!policy.ok) {
        return policy;
    }

    const transportResult = await executeAuthTransportRequest(transportRequest, policy.runtimePolicy || {});
    if (!transportResult.ok) {
        return failure(
            transportResult.code || "AUTH_START_FAILED",
            transportResult.error || "Auth start transport request failed.",
            correlationId,
            transportResult.details || {}
        );
    }

    const pluginId = toTrimmedString(options?.pluginId) || "__unknown_plugin__";
    const authTxnId = createAuthTxnId();
    const accountHint = toTrimmedString(payload?.accountHint);
    const accountId = accountHint || "";
    const payloadSessionId = toTrimmedString(payload?.sessionId);
    const sessionId = payloadSessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const raw = transportResult.raw;
    const credentials = extractSessionCredentials(raw, payload);
    const authTxnStore = getPluginAuthTxnStore(pluginId);
    authTxnStore.set(authTxnId, {
        authTxnId,
        providerId,
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        raw,
    });
    const nextSession = {
        sessionId,
        authTxnId,
        providerId,
        accountId,
        endpointUrl: policy.endpointUrl || endpointUrl || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        credentials,
        raw,
    };
    getPluginSessionStore(pluginId).set(sessionId, nextSession);

    return success({
        authTxnId,
        providerId,
        raw,
        sessionId,
        accountId: accountId || undefined,
        correlationId,
    });
}

export async function handleHostAuthBrokerRefreshRequest(payload = {}, options = {}) {
    const correlationId = createCorrelationId("auth-refresh");
    const providerId = toTrimmedString(payload?.providerId);
    const sessionId = toTrimmedString(payload?.sessionId);
    const authTxnIdInput = toTrimmedString(payload?.authTxnId);
    if (!providerId) {
        return failure("AUTH_PROVIDER_REQUIRED", "providerId is required to refresh a host auth session.", correlationId);
    }

    const pluginId = toTrimmedString(options?.pluginId) || "__unknown_plugin__";
    const store = getPluginSessionStore(pluginId);
    const authTxnStore = getPluginAuthTxnStore(pluginId);
    const mappedSessionId = (!sessionId && authTxnIdInput && authTxnStore.get(authTxnIdInput)?.sessionId)
        ? toTrimmedString(authTxnStore.get(authTxnIdInput).sessionId)
        : sessionId;
    if (!mappedSessionId) {
        return failure("AUTH_SESSION_REQUIRED", "sessionId or authTxnId is required to refresh a host auth session.", correlationId);
    }
    const existing = store.get(mappedSessionId);
    if (!existing || existing.providerId !== providerId) {
        return failure(
            "AUTH_SESSION_NOT_FOUND",
            `No active host auth session was found for provider "${providerId}".`,
            correlationId,
            {
                providerId,
                sessionId: mappedSessionId,
            }
        );
    }

    const transportRequest = normalizeAuthTransportRequest(payload?.request || {});
    const policy = enforceNetworkAuthPolicy(correlationId, options, existing.endpointUrl);
    if (!policy.ok) {
        return policy;
    }
    const transportResult = await executeAuthTransportRequest(transportRequest, policy.runtimePolicy || {});
    if (!transportResult.ok) {
        return failure(
            transportResult.code || "AUTH_REFRESH_FAILED",
            transportResult.error || "Auth refresh transport request failed.",
            correlationId,
            transportResult.details || {}
        );
    }
    const authTxnId = authTxnIdInput || toTrimmedString(existing?.authTxnId) || createAuthTxnId();
    const raw = transportResult.raw;
    const credentials = extractSessionCredentials(raw, payload, existing);

    store.set(mappedSessionId, {
        ...existing,
        authTxnId,
        credentials,
        raw,
        updatedAt: new Date().toISOString(),
    });
    authTxnStore.set(authTxnId, {
        authTxnId,
        providerId,
        sessionId: mappedSessionId,
        updatedAt: new Date().toISOString(),
        raw,
    });

    return success({
        authTxnId,
        providerId,
        raw,
        sessionId: mappedSessionId,
        correlationId,
    });
}

export async function handleHostAuthBrokerLogoutRequest(payload = {}, options = {}) {
    const correlationId = createCorrelationId("auth-logout");
    const providerId = toTrimmedString(payload?.providerId);
    const sessionId = toTrimmedString(payload?.sessionId);
    const authTxnIdInput = toTrimmedString(payload?.authTxnId);
    if (!providerId) {
        return failure("AUTH_PROVIDER_REQUIRED", "providerId is required to close a host auth session.", correlationId);
    }
    const pluginId = toTrimmedString(options?.pluginId) || "__unknown_plugin__";
    const store = getPluginSessionStore(pluginId);
    const authTxnStore = getPluginAuthTxnStore(pluginId);
    const mappedSessionId = (!sessionId && authTxnIdInput && authTxnStore.get(authTxnIdInput)?.sessionId)
        ? toTrimmedString(authTxnStore.get(authTxnIdInput).sessionId)
        : sessionId;
    if (!mappedSessionId) {
        return failure("AUTH_SESSION_REQUIRED", "sessionId or authTxnId is required to close a host auth session.", correlationId);
    }
    const existing = store.get(mappedSessionId);
    if (!existing || existing.providerId !== providerId) {
        return failure(
            "AUTH_SESSION_NOT_FOUND",
            `No active host auth session was found for provider "${providerId}".`,
            correlationId,
            {
                providerId,
                sessionId: mappedSessionId,
            }
        );
    }
    const resolvedAuthTxnId = authTxnIdInput || toTrimmedString(existing?.authTxnId);
    store.delete(mappedSessionId);
    if (resolvedAuthTxnId) {
        authTxnStore.delete(resolvedAuthTxnId);
    }
    return success({
        authTxnId: resolvedAuthTxnId || undefined,
        providerId,
        raw: null,
        sessionId: mappedSessionId,
        correlationId,
    });
}

export async function handleHostSessionRequest(payload = {}, options = {}) {
    const correlationId = createCorrelationId("session-request");
    const pluginId = toTrimmedString(options?.pluginId) || "__unknown_plugin__";
    const sessionId = toTrimmedString(payload?.sessionId);
    if (!sessionId) {
        return failure("SESSION_ID_REQUIRED", "sessionId is required for host session request proxy.", correlationId);
    }

    const store = getPluginSessionStore(pluginId);
    const session = store.get(sessionId);
    if (!session) {
        return failure(
            "AUTH_SESSION_NOT_FOUND",
            "Host session is missing or expired. Start auth again before requesting provider APIs.",
            correlationId,
            {sessionId}
        );
    }

    const method = normalizeMethod(payload?.method);
    const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
    if (!allowedMethods.has(method)) {
        return failure(
            "SESSION_REQUEST_METHOD_INVALID",
            `Unsupported HTTP method "${method}".`,
            correlationId,
            {allowedMethods: [...allowedMethods]}
        );
    }

    const rawUrl = toTrimmedString(payload?.url);
    if (!rawUrl) {
        return failure("SESSION_REQUEST_URL_REQUIRED", "url is required for host session request proxy.", correlationId);
    }

    let requestUrl;
    try {
        requestUrl = new URL(rawUrl);
    } catch (_) {
        return failure(
            "SESSION_REQUEST_URL_INVALID",
            "url must be a valid absolute HTTP(S) URL.",
            correlationId,
            {url: rawUrl}
        );
    }

    const protocol = String(requestUrl.protocol || "").toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") {
        return failure(
            "SESSION_REQUEST_PROTOCOL_UNSUPPORTED",
            "Only HTTP(S) URLs are supported by host session request proxy.",
            correlationId,
            {protocol}
        );
    }

    const grantedCapabilities = getGrantedCapabilitiesSnapshot(options);
    const declaredCapabilities = getDeclaredCapabilitiesSnapshot(options);
    const runtimePolicy = buildRuntimeSecurityPolicy(grantedCapabilities);
    const baseCheck = checkRequiredCapabilities([NETWORK_CAPABILITY], grantedCapabilities, declaredCapabilities);
    if (baseCheck.missing.length > 0) {
        return failure(
            "SESSION_REQUEST_CAPABILITY_DENIED",
            `Missing required capabilities: ${baseCheck.missing.join(", ")}.`,
            correlationId,
            {
                requiredCapabilities: [NETWORK_CAPABILITY],
                missingCapabilities: baseCheck.missing,
                undeclaredRequiredCapabilities: baseCheck.undeclared,
            }
        );
    }
    const requiredTransportCapability = protocol === "https:" ? NETWORK_HTTPS_CAPABILITY : NETWORK_HTTP_CAPABILITY;
    if (!hasCapability(grantedCapabilities, requiredTransportCapability)) {
        return failure(
            "SESSION_REQUEST_TRANSPORT_DENIED",
            `Missing required transport capability "${requiredTransportCapability}" for ${protocol.toUpperCase()} request.`,
            correlationId,
            {
                requiredCapability: requiredTransportCapability,
            }
        );
    }

    if (!isScopeAllowedForUrl(requestUrl, runtimePolicy, "fetch")) {
        return failure(
            "SESSION_REQUEST_SCOPE_DENIED",
            "Destination is outside granted network scopes.",
            correlationId,
            {
                url: requestUrl.toString(),
                remediation: "Grant a matching system.network.scope.<scope-id> capability for this destination.",
            }
        );
    }

    appendQuery(requestUrl, payload?.query || {});
    const headers = sanitizeHeaderRecord(payload?.headers || {});
    try {
        applySessionAuthorization(headers, session);
    } catch (error) {
        return failure(
            error?.code || "AUTH_SESSION_UNAUTHENTICATED",
            error?.message || String(error || "Host session authentication is not available."),
            correlationId,
            {sessionId: session.sessionId}
        );
    }
    headers["x-fdo-session-id"] = session.sessionId;
    headers["x-fdo-provider-id"] = session.providerId;

    const requestInit = {
        method,
        headers,
    };
    if (method !== "GET" && method !== "HEAD") {
        const serializedBody = serializeRequestBody(payload?.body, headers);
        if (serializedBody !== undefined) {
            requestInit.body = serializedBody;
        }
    }

    try {
        const response = await performFetchWithRetry(requestUrl.toString(), requestInit, {
            maxAttempts: 3,
            timeoutMs: 12000,
        });
        const data = await parseResponsePayload(response);
        const headersRecord = responseHeadersToObject(response);

        return {
            ok: response.ok,
            code: response.ok ? undefined : `UPSTREAM_HTTP_${Number(response.status || 0)}`,
            error: response.ok ? undefined : `Upstream request failed with status ${response.status}.`,
            status: Number(response.status || 0),
            statusText: String(response.statusText || ""),
            headers: headersRecord,
            data,
            correlationId,
            sessionId: session.sessionId,
        };
    } catch (error) {
        return failure(
            "SESSION_REQUEST_FAILED",
            error?.message || String(error || "Host session request failed."),
            correlationId,
            {
                url: requestUrl.toString(),
                method,
            }
        );
    }
}

export function __resetHostAuthSessionStoreForTests() {
    sessionStoreByPlugin.clear();
    authTxnStoreByPlugin.clear();
}
