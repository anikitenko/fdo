import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';

let credentialsStore = {get: () => ({}), save: () => {}};
export function configureMcpCredentialsStore(store) {credentialsStore = store;}
export const hasMcpOAuthCredentials = id => Boolean(credentialsStore.get(id)?.tokens?.access_token);
export function mcpOAuthProvider(server, interactive = {}) {
    let record = credentialsStore.get(server.id) || {};
    let verifier;
    const save = patch => {record = {...record, ...patch}; credentialsStore.save(server.id, record, server.authRevision || '');};
    const redirectUrl = interactive.redirectUrl || record.redirectUrl;
    return {
        redirectUrl,
        clientMetadata: {client_name: 'FDO MCP', redirect_uris: redirectUrl ? [redirectUrl] : [],
            grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none'},
        state: () => interactive.state,
        clientInformation: () => record.client || (server.oauthClientId ? {client_id: server.oauthClientId} : undefined),
        saveClientInformation: client => save({client, redirectUrl}),
        tokens: () => record.tokens,
        saveTokens: tokens => save({tokens, redirectUrl}),
        saveCodeVerifier: value => {verifier = value;},
        codeVerifier: () => {if (!verifier) throw new Error('OAuth session expired. Start sign-in again.'); return verifier;},
        redirectToAuthorization: async url => {
            if (!interactive.redirect) throw new Error('MCP sign-in is required. Open AI Extensions and sign in to this server.');
            await interactive.redirect(url);
        },
        discoveryState: () => record.discovery,
        saveDiscoveryState: discovery => save({discovery}),
        invalidateCredentials: scope => {
            if (scope === 'all' || scope === 'tokens') delete record.tokens;
            if (scope === 'all' || scope === 'client') delete record.client;
            if (scope === 'all' || scope === 'discovery') delete record.discovery;
            if (scope === 'all' || scope === 'verifier') verifier = undefined;
            credentialsStore.save(server.id, record, server.authRevision || '');
        },
    };
}

// Only an explicit Settings action may start browser authentication.
export async function startMcpOAuth(server, {openExternal, onFinish, timeoutMs = 180000}) {
    const state = randomBytes(32).toString('hex');
    const abort = new AbortController();
    let provider, timer, stopped = false, exchanging = false;
    const callback = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (request.method !== 'GET' || url.pathname !== '/callback') {response.writeHead(404); response.end(); return;}
        if (url.searchParams.get('state') !== state) {response.writeHead(400); response.end('Invalid sign-in state.'); return;}
        if (stopped) {response.writeHead(410); response.end('Sign-in session expired.'); return;}
        if (exchanging) {response.writeHead(409); response.end('Sign-in is already completing.'); return;}
        exchanging = true;
        const code = url.searchParams.get('code');
        if (!code || url.searchParams.has('error')) {response.writeHead(400); response.end('Sign-in was not completed. Return to FDO.'); finish('error', 'Sign-in was denied or cancelled.'); return;}
        // Do not put codes, tokens or provider bodies into the page or status.
        try {
            const result = await auth(provider, {serverUrl: server.url, authorizationCode: code, fetchFn: guardedFetch});
            if (result !== 'AUTHORIZED') throw new Error('Authorization did not complete.');
            response.writeHead(200, {'content-type': 'text/plain; charset=utf-8'}); response.end('Signed in. Return to FDO.');
            finish('authorized', 'Signed in. Check the connection to discover tools.');
        } catch {response.writeHead(400); response.end('Sign-in failed. Return to FDO and try again.'); finish('error', 'OAuth exchange failed. Check the server’s client registration and retry.');}
    });
    const guardedFetch = (url, options = {}) => {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) throw new Error('OAuth requires HTTPS, except loopback development endpoints.');
        const endpoint = new URL(server.url);
        const headers = new Headers(options.headers);
        if (parsed.origin === endpoint.origin && parsed.pathname === endpoint.pathname) {
            for (const [name, value] of Object.entries(server.headers || {})) headers.set(name, value);
        }
        return fetch(url, {...options, headers, signal: AbortSignal.any([abort.signal, ...(options.signal ? [options.signal] : [])]), redirect: 'error'});
    };
    const finish = (status, message) => {
        if (stopped) return; stopped = true; clearTimeout(timer); abort.abort(); callback.close(); callback.closeIdleConnections?.();
        onFinish({status, message});
    };
    try {
        await new Promise((resolve, reject) => {callback.once('error', reject); let savedPort = 0;
            try {savedPort = Number(new URL(credentialsStore.get(server.id)?.redirectUrl).port) || 0;} catch {}
            callback.listen(server.oauthCallbackPort || savedPort, '127.0.0.1', resolve);});
        const redirectUrl = `http://127.0.0.1:${callback.address().port}/callback`;
        provider = mcpOAuthProvider(server, {redirectUrl, state, redirect: async url => {
            const parsed = new URL(url);
            if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid OAuth authorization URL.');
            if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('OAuth browser sign-in requires HTTPS.');
            await openExternal(parsed.toString());
        }});
        timer = setTimeout(() => finish('error', 'Sign-in timed out. Start sign-in again.'), timeoutMs);
        auth(provider, {serverUrl: server.url, scope: server.oauthScopes || undefined, fetchFn: guardedFetch})
            .then(result => {if (result === 'AUTHORIZED') finish('authorized', 'Signed in. Check the connection to discover tools.');})
            .catch(() => finish('error', 'Unable to start OAuth. Check the server metadata and client registration.'));
        return {cancel: () => finish('cancelled', 'Sign-in cancelled.'), redirectUrl};
    } catch (error) {finish('error', 'Unable to start OAuth. Check the server metadata and client registration.'); throw new Error('Unable to start OAuth. Check the server metadata and client registration.');}
}
