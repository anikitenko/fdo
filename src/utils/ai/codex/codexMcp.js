
export function validateMcpEndpoint(value) {
    if (typeof value !== 'string') throw new Error('Enter a complete HTTP or HTTPS MCP endpoint URL.');
    let url; try {url = new URL(value);} catch {throw new Error('Enter a complete HTTP or HTTPS MCP endpoint URL.');}
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (value.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search
        || url.protocol === 'http:' && !loopback) throw new Error('Use HTTPS, or HTTP for localhost/127.0.0.1/[::1], without URL credentials, query strings, or fragments.');
    return url.toString();
}

export function validateMcpMap(map = {}, kind = 'header') {
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 32) throw new Error(`Provide at most 32 ${kind} name/value pairs.`);
    const names = new Set();
    for (const [key, value] of Object.entries(map)) {
        const validName = kind === 'header' ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) : /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key);
        if (!validName || ['__proto__', 'constructor', 'prototype'].includes(key.toLowerCase()) || names.has(key.toLowerCase())
            || typeof value !== 'string' || value.length > 8192 || /\0/.test(value) || kind === 'header' && /[\r\n]/.test(value)) throw new Error(`Invalid ${kind} name or value.`);
        if (kind === 'header' && /^(?:host|content-length|content-type|accept|connection|mcp-session-id|mcp-protocol-version)$/i.test(key)) throw new Error(`Header ${key} is managed by the MCP transport.`);
        names.add(key.toLowerCase());
    }
    if (JSON.stringify(map).length > 32768) throw new Error(`${kind} configuration exceeds 32768 characters.`);
}

export function validateMcpTransport(server) {
    const transport = server.transport || 'http';
    if (!['http', 'stdio'].includes(transport)) throw new Error('Choose HTTP or command (stdio) transport.');
    if (transport === 'http') validateMcpEndpoint(server.url);
    else {
        if (typeof server.command !== 'string' || !server.command.trim() || server.command.length > 2048 || /[\r\n\0;|&]/.test(server.command)) throw new Error('Enter an installed executable or executable path, without shell syntax. Put arguments in the argument list.');
        if (!Array.isArray(server.args) || server.args.length > 64 || server.args.some(a => typeof a !== 'string' || a.length > 8192 || a.includes('\0')) || JSON.stringify(server.args).length > 32768) throw new Error('Provide an argument array of at most 64 strings (32768 characters total).');
        if (server.cwd && (typeof server.cwd !== 'string' || server.cwd.length > 2048 || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(server.cwd) || server.cwd.includes('\0'))) throw new Error('Use an absolute working-directory path or leave it empty.');
        validateMcpMap(server.environment, 'environment');
    }
    if (server.authMode && !['none', 'bearer', 'oauth'].includes(server.authMode)) throw new Error('Choose no authentication, bearer token, or OAuth.');
    if (transport === 'stdio' && server.authMode && server.authMode !== 'none') throw new Error('Use environment variables for command server authentication.');
    validateMcpMap(server.headers, 'header');
    if (server.authMode && server.authMode !== 'none' && Object.keys(server.headers || {}).some(k => k.toLowerCase() === 'authorization')) throw new Error('Choose an authentication mode or a custom Authorization header, not both.');
    if (server.oauthClientId && (typeof server.oauthClientId !== 'string' || server.oauthClientId.length > 1024)) throw new Error('Invalid OAuth client ID.');
    if (server.oauthScopes && (typeof server.oauthScopes !== 'string' || server.oauthScopes.length > 1024)) throw new Error('Invalid OAuth scopes.');
    if (server.oauthCallbackPort != null && (!Number.isInteger(server.oauthCallbackPort) || server.oauthCallbackPort < 0 || server.oauthCallbackPort > 65535)) throw new Error('OAuth callback port must be 0–65535 (0 chooses an available port).');
}

export function validateMcpServer(server, assistants) {
    if (!server || typeof server.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(server.name)) throw new Error('Use a server name of 1–64 letters, numbers, spaces, hyphens, or underscores.');
    validateMcpTransport(server);
    if (typeof server.bearerToken !== 'string' || server.bearerToken.length > 8192 || /[\r\n\0]/.test(server.bearerToken)) throw new Error('Provide a valid bearer token or leave it empty.');
    const ids = new Set(assistants.filter(a => a.provider === 'codex-cli').map(a => a.id));
    if (typeof server.enabled !== 'boolean' || !Array.isArray(server.assistantIds) || server.assistantIds.some(id => !ids.has(id))
        || new Set(server.assistantIds).size !== server.assistantIds.length) throw new Error('Assign MCP tools only to existing Codex coding assistants.');
    if (!Array.isArray(server.tools) || server.tools.length > 100 || server.tools.some(t => typeof t.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(t.name)
        || typeof t.description !== 'string' || t.description.length > 1024) || new Set(server.tools.map(t => t.name)).size !== server.tools.length) throw new Error('Invalid MCP tool inventory. Check the connection again.');
    if (!Array.isArray(server.enabledTools) || server.enabledTools.some(name => !server.tools.some(t => t.name === name))
        || new Set(server.enabledTools).size !== server.enabledTools.length) throw new Error('Select only tools discovered from this server.');
}

export const publicMcpServer = ({bearerToken, headers, environment, ...server}) => ({...server, hasBearerToken: Boolean(bearerToken), headerNames: Object.keys(headers || {}), environmentKeys: Object.keys(environment || {})});
export const selectedCodexMcpServers = (servers, assistantId) => (servers || []).filter(s => s.enabled && s.assistantIds.includes(assistantId) && s.enabledTools.length);

// Only the native child receives credentials. TOML is serialized as data, never shell text.
export function codexMcpConfiguration(servers) {
    const env = {};
    const lines = ['mcp_optional_startup_grace_ms = 0'];
    for (const server of servers) {
        validateMcpEndpoint(server.url);
        const key = `fdo_${server.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        lines.push(`[mcp_servers.${key}]`, `url = ${JSON.stringify(server.url)}`, 'enabled = true', 'required = true',
            'startup_timeout_sec = 20', 'tool_timeout_sec = 60', 'default_tools_approval_mode = "approve"',
            `enabled_tools = ${JSON.stringify(server.enabledTools)}`);
        if (Object.keys(server.headers || {}).length) {
            const mapping = Object.fromEntries(Object.entries(server.headers).map(([header, value], index) => {
                const variable = `FDO_MCP_HEADER_${key}_${index}`; env[variable] = value; return [header, variable];
            }));
            lines.push(`env_http_headers = { ${Object.entries(mapping).map(([header, variable]) => `${JSON.stringify(header)} = ${JSON.stringify(variable)}`).join(', ')} }`);
        }
        if (server.bearerToken) {
            const variable = `FDO_MCP_TOKEN_${key}`;
            env[variable] = server.bearerToken;
            lines.push(`bearer_token_env_var = ${JSON.stringify(variable)}`);
        }
    }
    return {content: lines.join('\n') + '\n', env};
}

// Connection testing performs discovery only; stdio starts the configured process.
export async function discoverMcpTools(server, {fetchImpl = globalThis.fetch, timeoutMs = 20000} = {}) {
    validateMcpTransport(server);
    if (server.transport === 'stdio' || server.authMode === 'oauth') {
        const {openMcpConnection, discoverConnectedTools} = await import('../mcp/mcpConnections');
        const connection = await openMcpConnection(server, {fetchImpl, timeoutMs});
        try {return await discoverConnectedTools(connection);} finally {await connection.close();}
    }
    let {url, bearerToken = ''} = server;
    url = validateMcpEndpoint(url);
    if (typeof bearerToken !== 'string' || /[\r\n\0]/.test(bearerToken) || bearerToken.length > 8192) throw new Error('Invalid bearer token.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let session, version, nextId = 0;
    const headers = () => ({...server.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(bearerToken ? {Authorization: `Bearer ${bearerToken}`} : {}), ...(session ? {'Mcp-Session-Id': session} : {}),
        ...(version ? {'MCP-Protocol-Version': version} : {})});
    const request = async (method, params, notification = false) => {
        const id = notification ? undefined : ++nextId;
        const response = await fetchImpl(url, {method: 'POST', redirect: 'error', signal: controller.signal, headers: headers(),
            body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, ...(params ? {params} : {})})});
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
            ? 'MCP authentication failed. Check the token or headers, or choose OAuth and sign in.' : `MCP endpoint returned HTTP ${response.status}. Check the URL and server availability.`);
        if (notification) {await response.body?.cancel(); return;}
        if (method === 'initialize') session = response.headers.get('mcp-session-id') || undefined;
        const reader = response.body.getReader();
        const decoder = new TextDecoder(); let buffer = '', size = 0;
        const sse = response.headers.get('content-type')?.includes('text/event-stream');
        const unpack = value => {
            if (value?.jsonrpc !== '2.0' || value.id !== id) return undefined;
            if (value.error) throw new Error('MCP server rejected discovery. Check its protocol support and access permissions.');
            if (!value.result || typeof value.result !== 'object') throw new Error('MCP server returned an invalid discovery response.');
            return value.result;
        };
        try {
            while (true) {
                const {done, value} = await reader.read();
                if (value) {size += value.byteLength; if (size > 1024 * 1024) throw new Error('MCP discovery response is too large.'); buffer = (buffer + decoder.decode(value, {stream: true})).replace(/\r\n/g, '\n');}
                if (sse) {
                    let boundary;
                    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                        const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                        const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
                        if (data) {const result = unpack(JSON.parse(data)); if (result) return result;}
                    }
                } else if (done) {const result = unpack(JSON.parse(buffer)); if (result) return result;}
                if (done) throw new Error('MCP connection closed before discovery completed.');
            }
        } finally {await reader.cancel().catch(() => {});}
    };
    try {
        const initialized = await request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'FDO', version: '1.0.0'}});
        if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(initialized.protocolVersion)) throw new Error('Unsupported MCP protocol version. Use a Streamable HTTP server.');
        version = initialized.protocolVersion;
        await request('notifications/initialized', undefined, true);
        const tools = []; const cursors = new Set(); let cursor;
        do {
            const page = await request('tools/list', cursor ? {cursor} : {});
            if (!Array.isArray(page.tools)) throw new Error('MCP server did not provide a tool list.');
            for (const tool of page.tools) {
                if (typeof tool.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name) || tools.some(t => t.name === tool.name)) throw new Error('MCP server returned invalid or duplicate tool names.');
                tools.push({name: tool.name, description: String(tool.description || '').slice(0, 1024)});
            }
            if (tools.length > 100) throw new Error('This connection supports at most 100 tools.');
            cursor = page.nextCursor;
            if (cursor && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 10)) throw new Error('MCP discovery pagination did not finish.');
            if (cursor) cursors.add(cursor);
        } while (cursor);
        return tools;
    } catch (error) {
        if (controller.signal.aborted) throw new Error('MCP connection test timed out. Check the endpoint and try again.');
        // Do not surface server bodies, URLs or credentials in diagnostics.
        if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('Unable to read the MCP endpoint. Check its URL, network access, and Streamable HTTP support.');
        throw error;
    } finally {
        if (session) {
            try {const response = await fetchImpl(url, {method: 'DELETE', redirect: 'error', headers: headers(), signal: controller.signal}); await response.body?.cancel();} catch { /* best effort termination */ }
        }
        clearTimeout(timer);
    }
}
