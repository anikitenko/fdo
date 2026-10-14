import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {openMcpConnection} from './mcpConnections';
import {CallToolResultSchema, ReadResourceResultSchema, ListResourcesResultSchema, ListResourceTemplatesResultSchema, SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/sdk/types.js';

export async function prepareMcpBridges(servers) {
    const bridges = await Promise.allSettled(servers.map(async server => {
        const connection = await openMcpConnection(server);
        const token = randomBytes(32).toString('hex');
        const allowed = new Set(server.enabledTools);
        const host = http.createServer(async (request, response) => {
            if (request.headers.authorization !== `Bearer ${token}` || request.url !== '/mcp') {response.writeHead(403); response.end(); return;}
            if (request.method === 'DELETE') {response.writeHead(204); response.end(); return;}
            if (request.method !== 'POST') {response.writeHead(405); response.end(); return;}
            const abort = new AbortController(); response.on('close', () => {if (!response.writableEnded) abort.abort();});
            let body = '', message;
            try {
                for await (const chunk of request) {body += chunk; if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Request too large.');}
                message = JSON.parse(body);
                if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new Error('Invalid request.');
                if (message.id !== undefined && message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number') throw new Error('Invalid request ID.');
                if (message.id === undefined) {response.writeHead(202); response.end(); return;}
                let result;
                const options = {timeout: 60000, signal: abort.signal};
                switch (message.method) {
                    case 'initialize': {
                        const caps = connection.client.getServerCapabilities() || {};
                        result = {protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : LATEST_PROTOCOL_VERSION, serverInfo: {name: 'FDO MCP bridge', version: '1.0.0'},
                            capabilities: {tools: {}, ...(caps.resources ? {resources: {}} : {})}}; break;
                    }
                    case 'ping': result = {}; break;
                    case 'tools/list': {
                        const page = await connection.client.listTools(message.params || {}, options);
                        result = {...page, tools: page.tools.filter(tool => allowed.has(tool.name))}; break;
                    }
                    case 'tools/call':
                        if (!allowed.has(message.params?.name)) throw new Error('Tool is not authorized.');
                        result = await connection.client.request({method: 'tools/call', params: message.params}, CallToolResultSchema, options); break;
                    case 'resources/list': result = await connection.client.request({method: message.method, params: message.params || {}}, ListResourcesResultSchema, options); break;
                    case 'resources/templates/list': result = await connection.client.request({method: message.method, params: message.params || {}}, ListResourceTemplatesResultSchema, options); break;
                    case 'resources/read': result = await connection.client.request({method: message.method, params: message.params}, ReadResourceResultSchema, options); break;
                    default: throw new Error('Unsupported MCP method.');
                }
                if (!response.destroyed) {
                    const encoded = JSON.stringify({jsonrpc: '2.0', id: message.id, result});
                    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw new Error('Tool response too large.');
                    response.writeHead(200, {'Content-Type': 'application/json'}); response.end(encoded);
                }
            } catch {
                if (!response.destroyed) {response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify({jsonrpc: '2.0', id: message?.id ?? null,
                    error: {code: -32603, message: 'MCP operation failed, was cancelled, or is not authorized. Check the server in AI Extensions.'}}));}
            }
        });
        try {await new Promise((resolve, reject) => {host.once('error', reject); host.listen(0, '127.0.0.1', resolve);});}
        catch (error) {await connection.close(); throw error;}
        return {port: host.address().port,
            server: {...server, transport: 'http', url: `http://127.0.0.1:${host.address().port}/mcp`, authMode: 'bearer', bearerToken: token, headers: {}},
            close: async () => {host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); await connection.close();}};
    }));
    const active = bridges.filter(item => item.status === 'fulfilled').map(item => item.value);
    const failed = bridges.find(item => item.status === 'rejected');
    if (failed) {await Promise.allSettled(active.map(b => b.close())); throw failed.reason;}
    return {servers: active.map(b => b.server), ports: active.map(b => b.port), close: async () => {await Promise.allSettled(active.map(b => b.close()));}};
}
