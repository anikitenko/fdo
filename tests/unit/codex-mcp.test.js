/** @jest-environment node */
import {discoverMcpTools, validateMcpEndpoint, codexMcpConfiguration, publicMcpServer, selectedCodexMcpServers, validateMcpTransport} from '../../src/utils/ai/codex/codexMcp';
const server = {id: 'abc-123', url: 'https://docs.example.com/mcp', bearerToken: 'secret-token', enabled: true, assistantIds: ['one'], enabledTools: ['search'], tools: [{name: 'search', description: 'Search'}]};
const response = (body, {status = 200, sse = false, session} = {}) => {
    let read = false; return {ok: status >= 200 && status < 300, status, headers: {get: key => key === 'content-type' ? (sse ? 'text/event-stream' : 'application/json') : key === 'mcp-session-id' ? session : null},
        body: {cancel: jest.fn(async () => {}), getReader: () => ({read: async () => read ? {done: true} : (read = true, {done: false, value: Buffer.from(body || '')}), cancel: jest.fn(async () => {})})}};
};
const json = (id, result, options) => response(JSON.stringify({jsonrpc: '2.0', id, result}), options);
test.each(['http://docs.example.com/mcp', 'http://192.168.1.1/mcp', 'https://user:pass@docs.example.com/mcp', 'https://docs.example.com/mcp?token=secret'])('rejects unsafe or unsupported endpoint %s', url => {expect(() => validateMcpEndpoint(url)).toThrow();});
test('isolated configuration contains explicit tool allowlist and credentials only via dedicated environment', () => {
    const config = codexMcpConfiguration([server]);
    expect(config.content).toContain('enabled_tools = ["search"]');
    expect(config.content).toContain('required = true');
    expect(config.content).not.toContain('secret-token');
    expect(Object.values(config.env)).toEqual(['secret-token']);
    expect(publicMcpServer(server)).toEqual(expect.objectContaining({hasBearerToken: true}));
    expect(JSON.stringify(publicMcpServer(server))).not.toContain('secret-token');
    expect(selectedCodexMcpServers([server, {...server, enabled: false}, {...server, enabledTools: []}], 'one')).toEqual([server]);
    expect(selectedCodexMcpServers([server], 'two')).toEqual([]);
});
test('discovers paginated JSON and SSE tools, propagates session and negotiated protocol, closes without calling tools', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(1, {protocolVersion: '2025-06-18'}, {session: 'fixture-session'}))
        .mockResolvedValueOnce(response('', {status: 202}))
        .mockResolvedValueOnce(response('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","description":"Search"}],"nextCursor":"next"}}\n\n', {sse: true}))
        .mockResolvedValueOnce(json(3, {tools: [{name: 'fetch'}]})).mockResolvedValueOnce(response('', {status: 204}));
    expect(await discoverMcpTools(server, {fetchImpl})).toEqual([{name: 'search', description: 'Search'}, {name: 'fetch', description: ''}]);
    expect(fetchImpl.mock.calls[2][1].headers).toEqual(expect.objectContaining({'Mcp-Session-Id': 'fixture-session', 'MCP-Protocol-Version': '2025-06-18', Authorization: 'Bearer secret-token'}));
    expect(fetchImpl.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
    expect(fetchImpl.mock.calls.map(([, options]) => options.body ? JSON.parse(options.body).method : options.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'DELETE']);
});
test('authentication errors are actionable and never echo server bodies or tokens', async () => {
    const fetchImpl = jest.fn(async () => response('secret-token', {status: 401}));
    await expect(discoverMcpTools(server, {fetchImpl})).rejects.toThrow('MCP authentication failed');
});
test('rejects repeated discovery cursors and invalid protocol responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(1, {protocolVersion: '2025-06-18'})).mockResolvedValueOnce(response('', {status: 202}))
        .mockResolvedValueOnce(json(2, {tools: [], nextCursor: 'repeat'})).mockResolvedValueOnce(json(3, {tools: [], nextCursor: 'repeat'}));
    await expect(discoverMcpTools(server, {fetchImpl})).rejects.toThrow('pagination');
    await expect(discoverMcpTools(server, {fetchImpl: jest.fn(async () => json(1, {protocolVersion: '1999'}))})).rejects.toThrow('Unsupported MCP protocol');
});

test.each(['http://localhost:8080/mcp','http://127.0.0.1:8080/mcp','http://[::1]:8080/mcp','https://10.0.0.2/mcp'])('accepts local or TLS endpoint %s', url => expect(() => validateMcpEndpoint(url)).not.toThrow());


test('validates command arguments and header boundaries without shell interpretation', () => {
    expect(() => validateMcpTransport({transport:'stdio',command:'node',args:['C:\\tools with spaces\\server.js'],environment:{TOKEN:'secret'},cwd:'C:\\tools'})).not.toThrow();
    expect(() => validateMcpTransport({transport:'stdio',command:'node && echo secret',args:[]})).toThrow();
    expect(() => validateMcpTransport({url:'https://example.com/mcp',headers:{Authorization:'secret'},authMode:'oauth'})).toThrow();
    expect(() => validateMcpTransport({url:'https://example.com/mcp',headers:{'X-Team':'one\r\nInjected: value'}})).toThrow();
    expect(() => validateMcpTransport({url:'https://example.com/mcp',headers:{'Mcp-Session-Id':'owned'}})).toThrow();
    const visible=publicMcpServer({id:'private',headers:{'X-Token':'HEADER_SECRET'},environment:{TOKEN:'ENV_SECRET'},bearerToken:'BEARER_SECRET'});
    expect(JSON.stringify(visible)).not.toMatch(/HEADER_SECRET|ENV_SECRET|BEARER_SECRET/);
    expect(visible.headerNames).toEqual(['X-Token']); expect(visible.environmentKeys).toEqual(['TOKEN']);
});
