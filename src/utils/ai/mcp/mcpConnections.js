import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mcpOAuthProvider} from './mcpOAuth';

export async function openMcpConnection(server, {timeoutMs = 20000, fetchImpl = globalThis.fetch} = {}) {
    const client = new Client({name: 'FDO', version: '1.0.0'}, {capabilities: {}});
    const abort = new AbortController();
    const headers = {...server.headers};
    if (server.bearerToken) headers.Authorization = `Bearer ${server.bearerToken}`;
    const transport = server.transport === 'stdio'
        ? new StdioClientTransport({command: server.command, args: server.args || [], cwd: server.cwd || os.homedir(),
            env: {PATH: [...new Set([process.env.PATH || '', ...(process.platform === 'win32' ? [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')])])].join(path.delimiter), ...server.environment}, stderr: 'pipe', maxBufferSize: 1024 * 1024})
        : new StreamableHTTPClientTransport(new URL(server.url), {requestInit: {headers, redirect: 'error'},
            ...(server.authMode === 'oauth' ? {authProvider: mcpOAuthProvider(server)} : {}),
            fetch: (url, init = {}) => {
                const target = new URL(url), endpoint = new URL(server.url);
                const safeHeaders = new Headers(init.headers);
                // SDK OAuth discovery may share its fetch wrapper with other endpoints.
                // Custom server secrets belong only on the configured MCP endpoint.
                if (target.origin !== endpoint.origin || target.pathname !== endpoint.pathname) {
                    for (const name of Object.keys(headers)) safeHeaders.delete(name);
                }
                return fetchImpl(url, {...init, headers: safeHeaders, redirect: 'error', signal: AbortSignal.any([abort.signal, ...(init.signal ? [init.signal] : [])])});
            }});
    // Servers may log secrets. Drain stderr without echoing it into FDO diagnostics.
    transport.stderr?.on('data', () => {});
    let timer;
    try {
        await Promise.race([client.connect(transport, {timeout: timeoutMs}), new Promise((_, reject) => {
            timer = setTimeout(() => {abort.abort(); reject(new Error('MCP connection timed out. Check the server and try again.'));}, timeoutMs);
        })]);
        clearTimeout(timer);
        return {client, close: async () => {abort.abort(); await client.close().catch(() => {});}};
    } catch (error) {
        clearTimeout(timer); abort.abort(); await client.close().catch(() => {});
        if (server.authMode === 'oauth') throw new Error('MCP sign-in is required or expired. Sign in from AI Extensions and check the connection again.');
        throw new Error(server.transport === 'stdio' ? 'Unable to start the MCP command. Check that it is installed, its arguments, environment, and working directory.'
            : 'Unable to connect to the MCP endpoint. Check its URL, authentication, headers, and availability.');
    }
}
export async function discoverConnectedTools(connection) {
    const deadline = Date.now() + 20000;
    const tools = []; const cursors = new Set(); let cursor;
    do {
        const page = await connection.client.listTools(cursor ? {cursor} : {}, {timeout: Math.max(1, deadline - Date.now())});
        tools.push(...page.tools.map(tool => ({name: tool.name, description: String(tool.description || '').slice(0, 1024)})));
        if (tools.length > 100 || new Set(tools.map(t => t.name)).size !== tools.length) throw new Error('MCP inventory exceeds 100 tools or contains duplicate names.');
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 10)) throw new Error('MCP discovery pagination did not finish.');
        if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
}
