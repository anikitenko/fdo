import {
    __resetHostAuthSessionStoreForTests,
    handleHostAuthBrokerLogoutRequest,
    handleHostAuthBrokerRefreshRequest,
    handleHostAuthBrokerStartRequest,
    handleHostSessionRequest,
} from "../../src/utils/pluginHostAuth";

function createMockResponse({ok = true, status = 200, statusText = "OK", jsonData = null, textData = "", headers = {}} = {}) {
    const headerMap = new Map(Object.entries(headers));
    return {
        ok,
        status,
        statusText,
        headers: {
            get(name) {
                const key = String(name || "").toLowerCase();
                for (const [entryKey, entryValue] of headerMap.entries()) {
                    if (String(entryKey).toLowerCase() === key) {
                        return entryValue;
                    }
                }
                return null;
            },
            forEach(callback) {
                headerMap.forEach((value, key) => callback(value, key));
            },
        },
        async json() {
            return jsonData;
        },
        async text() {
            return textData;
        },
    };
}

describe("plugin host auth broker", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        __resetHostAuthSessionStoreForTests();
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("creates, refreshes, and logs out a stable host session id", async () => {
        const options = {
            pluginId: "plugin-auth",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };

        const started = await handleHostAuthBrokerStartRequest({
            providerId: "sharepoint",
            accountHint: "acct-1",
            endpointUrl: "https://graph.microsoft.com",
        }, options);
        expect(started).toEqual(expect.objectContaining({
            ok: true,
            authTxnId: expect.any(String),
            providerId: "sharepoint",
            raw: null,
            sessionId: expect.any(String),
            accountId: "acct-1",
            correlationId: expect.any(String),
        }));

        const refreshed = await handleHostAuthBrokerRefreshRequest({
            providerId: "sharepoint",
            sessionId: started.sessionId,
        }, options);
        expect(refreshed).toEqual(expect.objectContaining({
            ok: true,
            authTxnId: expect.any(String),
            providerId: "sharepoint",
            raw: null,
            sessionId: started.sessionId,
            correlationId: expect.any(String),
        }));

        const loggedOut = await handleHostAuthBrokerLogoutRequest({
            providerId: "sharepoint",
            sessionId: started.sessionId,
        }, options);
        expect(loggedOut).toEqual(expect.objectContaining({
            ok: true,
            authTxnId: expect.any(String),
            providerId: "sharepoint",
            raw: null,
            sessionId: started.sessionId,
            correlationId: expect.any(String),
        }));
    });

    test("returns deterministic capability error when auth network grants are missing", async () => {
        const response = await handleHostAuthBrokerStartRequest({
            providerId: "dropbox",
            endpointUrl: "https://api.dropboxapi.com",
        }, {
            pluginId: "plugin-auth-missing",
            grantedCapabilities: [],
            declaredCapabilities: ["system.network", "system.network.https"],
        });

        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "AUTH_CAPABILITY_DENIED",
            correlationId: expect.any(String),
        }));
    });

    test("denies generic session requests outside granted destination scopes", async () => {
        const options = {
            pluginId: "plugin-scope-deny",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.loopback-dev",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.loopback-dev",
            ],
        };
        const started = await handleHostAuthBrokerStartRequest({
            providerId: "internal-api",
            endpointUrl: "https://localhost:8443",
        }, options);
        expect(started.ok).toBe(true);

        const response = await handleHostSessionRequest({
            sessionId: started.sessionId,
            method: "GET",
            url: "https://api.external.example.com/items",
        }, options);
        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "SESSION_REQUEST_SCOPE_DENIED",
            correlationId: expect.any(String),
        }));
    });

    test("retries transient upstream failures and returns normalized proxy response", async () => {
        const options = {
            pluginId: "plugin-session-request",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };
        const started = await handleHostAuthBrokerStartRequest({
            providerId: "gdrive",
            endpointUrl: "https://www.googleapis.com",
        }, options);
        expect(started.ok).toBe(true);

        await handleHostAuthBrokerRefreshRequest({
            providerId: "gdrive",
            sessionId: started.sessionId,
            auth: {
                scheme: "bearer",
                value: "gdrive-token",
            },
            credentials: {
                accessToken: "gdrive-token",
                tokenType: "Bearer",
                expiresIn: 3600,
            },
        }, options);

        global.fetch
            .mockResolvedValueOnce(createMockResponse({
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                textData: "retry",
                headers: {"content-type": "text/plain"},
            }))
            .mockResolvedValueOnce(createMockResponse({
                ok: true,
                status: 200,
                statusText: "OK",
                jsonData: {items: [{id: "doc-1"}]},
                headers: {"content-type": "application/json"},
            }));

        const response = await handleHostSessionRequest({
            sessionId: started.sessionId,
            method: "GET",
            url: "https://www.googleapis.com/drive/v3/files",
            query: {pageSize: 1},
        }, options);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            status: 200,
            correlationId: expect.any(String),
            sessionId: started.sessionId,
        }));
        expect(response.data).toEqual({items: [{id: "doc-1"}]});
    });

    test("persists explicit bearer credentials and injects Authorization header into session requests", async () => {
        const options = {
            pluginId: "plugin-auth-bearer",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };

        const started = await handleHostAuthBrokerStartRequest({
            providerId: "graph",
            endpointUrl: "https://graph.microsoft.com",
        }, options);

        await handleHostAuthBrokerRefreshRequest({
            providerId: "graph",
            sessionId: started.sessionId,
            auth: {
                scheme: "bearer",
                value: "token-123",
            },
            credentials: {
                accessToken: "token-123",
                refreshToken: "refresh-123",
                tokenType: "Bearer",
                expiresIn: 3600,
            },
        }, options);

        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: {value: []},
            headers: {"content-type": "application/json"},
        }));

        await handleHostSessionRequest({
            sessionId: started.sessionId,
            method: "GET",
            url: "https://graph.microsoft.com/v1.0/sites",
        }, options);

        const request = global.fetch.mock.calls[0];
        expect(request[1].headers.Authorization).toBe("Bearer token-123");
    });

    test("supports Basic/base64 auth injection from refresh payload metadata", async () => {
        const options = {
            pluginId: "plugin-auth-basic",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };

        const started = await handleHostAuthBrokerStartRequest({
            providerId: "custom-api",
            endpointUrl: "https://api.example.com",
        }, options);

        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: {ok: true},
            headers: {"content-type": "application/json"},
        }));

        await handleHostAuthBrokerRefreshRequest({
            providerId: "custom-api",
            sessionId: started.sessionId,
            auth: {
                scheme: "basic",
                username: "demo-user",
                password: "demo-pass",
            },
        }, options);

        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: {items: []},
            headers: {"content-type": "application/json"},
        }));

        await handleHostSessionRequest({
            sessionId: started.sessionId,
            method: "GET",
            url: "https://api.example.com/items",
        }, options);

        const request = global.fetch.mock.calls[global.fetch.mock.calls.length - 1];
        expect(request[1].headers.Authorization).toBe(`Basic ${Buffer.from("demo-user:demo-pass", "utf8").toString("base64")}`);
    });

    test("supports plain token injection with custom header names", async () => {
        const options = {
            pluginId: "plugin-auth-plain",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };

        const started = await handleHostAuthBrokerStartRequest({
            providerId: "custom-api",
            endpointUrl: "https://api.example.com",
        }, options);

        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: {ok: true},
            headers: {"content-type": "application/json"},
        }));

        await handleHostAuthBrokerRefreshRequest({
            providerId: "custom-api",
            sessionId: started.sessionId,
            auth: {
                scheme: "plain",
                headerName: "x-api-key",
                value: "plain-secret",
            },
        }, options);

        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: {items: []},
            headers: {"content-type": "application/json"},
        }));

        await handleHostSessionRequest({
            sessionId: started.sessionId,
            method: "GET",
            url: "https://api.example.com/items",
        }, options);

        const request = global.fetch.mock.calls[global.fetch.mock.calls.length - 1];
        expect(request[1].headers["x-api-key"]).toBe("plain-secret");
        expect(request[1].headers.Authorization).toBeUndefined();
    });

    test("surfaces upstream auth error payload details for failed auth starts", async () => {
        const options = {
            pluginId: "plugin-auth-errors",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };

        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            jsonData: {
                error: "unauthorized_client",
                error_description: "The client is not enabled for device code flow.",
            },
            headers: {"content-type": "application/json"},
        }));

        const response = await handleHostAuthBrokerStartRequest({
            providerId: "sharepoint",
            request: {
                url: "https://login.microsoftonline.com/example/oauth2/v2.0/devicecode",
                method: "POST",
                body: new URLSearchParams({client_id: "abc", scope: "User.Read"}),
            },
            endpointUrl: "https://login.microsoftonline.com/example/oauth2/v2.0/devicecode",
        }, options);

        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "AUTH_UPSTREAM_HTTP_400",
        }));
        expect(response.error).toContain("unauthorized_client");
        expect(response.error).toContain("device code flow");
    });

    test("returns raw provider response unchanged for auth start and refresh transport requests", async () => {
        const options = {
            pluginId: "plugin-auth-raw",
            grantedCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
            declaredCapabilities: [
                "system.network",
                "system.network.https",
                "system.network.scope.public-web-secure",
            ],
        };

        const upstreamStartRaw = {
            authorizeUrl: "https://example.com/oauth2/authorize?txn=abc",
            state: "pending",
            expiresIn: 120,
        };
        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: upstreamStartRaw,
            headers: {"content-type": "application/json"},
        }));

        const started = await handleHostAuthBrokerStartRequest({
            providerId: "sharepoint",
            request: {
                url: "https://graph.microsoft.com/oauth2/start",
                method: "POST",
                body: {scope: "files.read"},
            },
        }, options);
        expect(started).toEqual(expect.objectContaining({
            ok: true,
            authTxnId: expect.any(String),
            providerId: "sharepoint",
            raw: upstreamStartRaw,
            sessionId: expect.any(String),
        }));

        const upstreamRefreshRaw = {
            tokenState: "ready",
            refreshAccepted: true,
        };
        global.fetch.mockResolvedValueOnce(createMockResponse({
            ok: true,
            status: 200,
            statusText: "OK",
            jsonData: upstreamRefreshRaw,
            headers: {"content-type": "application/json"},
        }));
        const refreshed = await handleHostAuthBrokerRefreshRequest({
            providerId: "sharepoint",
            authTxnId: started.authTxnId,
            request: {
                url: "https://graph.microsoft.com/oauth2/refresh",
                method: "POST",
                body: {grant_type: "refresh_token"},
            },
        }, options);
        expect(refreshed).toEqual(expect.objectContaining({
            ok: true,
            authTxnId: started.authTxnId,
            providerId: "sharepoint",
            raw: upstreamRefreshRaw,
            sessionId: started.sessionId,
        }));
    });
});
