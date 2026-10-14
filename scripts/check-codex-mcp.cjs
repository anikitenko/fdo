// Offline native-runtime probe. Uses a localhost mock endpoint and no login.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const shim = {exports: {}};
new Function('require', 'module', 'exports', esbuild.buildSync({entryPoints: ['src/utils/plugins/security/pluginAssistantIsolation.js'], bundle: true, write: false, platform: 'node', format: 'cjs'}).outputFiles[0].text)(require, shim, shim.exports);

(async () => {
    const platformPackage = path.join(process.cwd(), 'node_modules', '@openai', `codex-${process.platform}-${process.arch}`, 'vendor');
    const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const binary = fs.readdirSync(platformPackage).flatMap(triple => ['bin', 'codex'].map(folder => path.join(platformPackage, triple, folder, executable))).find(file => fs.existsSync(file));
    assert.ok(binary, 'Bundled native Codex is required for this probe.');
    const credentialRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fdo-no-login-'));
    // The inference loopback endpoint is used only for this probe. Production Codex reaches MCP through authenticated bridges.
    // Preserve macOS filesystem restrictions and staged companion binaries,
    // relaxing only loopback in this temporary test profile for the mock endpoints.
    const isolated = await shim.exports.createPluginAssistantIsolation({command: binary, args: [], bundled: true}, 'codex-cli', [],
        {credentialRoot, prepareMcpServers: async servers => ({servers, ports: [], close: async () => {}}), codexMcpServers: [{id: 'probe', url: 'https://docs.example.com/mcp', enabledTools: ['allowed_search']}]});
    if (isolated.osSandbox) {
        const profile = await fsp.readFile(isolated.args[1], 'utf8');
        await fsp.writeFile(isolated.args[1], profile.replace('(deny network* (remote ip "localhost:*"))', ''));
        assert.ok(isolated.codeModeHostPath.startsWith(path.dirname(isolated.options.cwd)));
    }
    let capture, executionProbe = false, codeModeProbe = false, inferenceCount = 0;
    const calls = [];
    let codeModeResult = '';
    const server = http.createServer((request, response) => {
        let body = '';
        request.on('data', chunk => {body += chunk;});
        request.on('end', () => {
            if (request.url === '/mcp') {
                const message = JSON.parse(body);
                let result;
                if (message.method === 'initialize') result = {protocolVersion: '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'probe', version: '1.0.0'}};
                else if (message.method === 'tools/call') {calls.push(message.params.name); result = {content: [{type: 'text', text: 'MCP_EXECUTION_RESULT_CANARY'}]};}
                else if (message.method === 'tools/list') result = {tools: ['allowed_search', 'forbidden_write'].map(name => ({name, description: name, inputSchema: {type: 'object', properties: {}}}))};
                if (!result) {response.writeHead(202); response.end(); return;}
                response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify({jsonrpc: '2.0', id: message.id, result})); return;
            }
            const requestBody = JSON.parse(body);
            if (executionProbe && inferenceCount > 0) {
                const returned = JSON.stringify(requestBody.input.filter(item => /(?:custom_tool_call_output|function_call_output)/.test(item.type)));
                assert.ok(returned.includes('MCP_EXECUTION_RESULT_CANARY'), 'The model must receive the real mock MCP result.');
                if (codeModeProbe) codeModeResult = returned;
            }
            capture?.(requestBody);
            if (!executionProbe) {response.writeHead(503); response.end('{"error":{"message":"Offline probe finished"}}'); return;}
            const first = inferenceCount++ === 0;
            const item = first
                ? (codeModeProbe ? {type: 'custom_tool_call', id: 'fc_probe', call_id: 'call_probe', name: 'exec', namespace: 'functions', input: `text('GLOBALS:' + [typeof process, typeof require, typeof fetch].join(',')); try { await tools.exec_command({cmd: 'echo UNEXPECTED_LOCAL_EXEC'}); text('LOCAL_EXEC_UNEXPECTED'); } catch { text('LOCAL_EXEC_REJECTED'); } try { await import('node:fs'); text('NODE_FS_UNEXPECTED'); } catch { text('NODE_FS_REJECTED'); } try { await tools.mcp__probe__forbidden_write({}); text('UNSELECTED_TOOL_UNEXPECTED'); } catch { text('UNSELECTED_TOOL_REJECTED'); } const result = await tools.mcp__probe__allowed_search({}); text(result);`} : {type: 'function_call', id: 'fc_probe', call_id: 'call_probe', name: 'allowed_search', namespace: 'mcp__probe', arguments: '{}'})
                : {type: 'message', id: 'msg_probe', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'MCP probe complete.'}]};
            const result = {id: `resp_${inferenceCount}`, object: 'response', status: 'completed', output: [item], usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20}};
            response.writeHead(200, {'Content-Type': 'text/event-stream'});
            for (const event of [{type: 'response.created', response: {...result, status: 'in_progress', output: []}},
                {type: 'response.output_item.added', output_index: 0, item}, {type: 'response.output_item.done', output_index: 0, item},
                {type: 'response.completed', response: result}]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            response.end();
        });
    });
    try {
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        await fsp.writeFile(path.join(isolated.options.env.CODEX_HOME, 'config.toml'), `mcp_optional_startup_grace_ms = 0
[mcp_servers.probe]
url = "http://127.0.0.1:${server.address().port}/mcp"
required = true
enabled_tools = ["allowed_search"]
default_tools_approval_mode = "approve"
`);
        const run = async (prompt, execute = false) => {
            executionProbe = !!execute; codeModeProbe = execute === 'code-mode'; inferenceCount = 0;
            const response = new Promise(resolve => {capture = resolve;});
            const config = {model_provider: 'probe', model: 'offline-probe', 'model_providers.probe.name': 'Offline probe',
                'model_providers.probe.base_url': `http://127.0.0.1:${server.address().port}`, 'model_providers.probe.wire_api': 'responses',
                'model_providers.probe.requires_openai_auth': false, 'model_providers.probe.request_max_retries': 0,
                'model_providers.probe.stream_max_retries': 0, 'features.skip_host_skill_discovery': true,
                'features.daemon_auto_start': false, 'features.unbounded_connection_retries': false, approval_policy: 'never', web_search: 'disabled'};
            for (const feature of shim.exports.CODEX_PROPOSAL_FEATURES) config[`features.${feature}`] = feature === 'code_mode_host';
            if (codeModeProbe) config['features.code_mode'] = true;
            const args = ['exec', ...(execute ? ['--json'] : []), '--skip-git-repo-check', '--sandbox', 'read-only', ...Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), '-'];
            const child = spawn(isolated.command, [...isolated.args, ...args], {...isolated.options, stdio: ['pipe', 'pipe', 'pipe']});
            let stdout = ''; child.stdout.on('data', chunk => {stdout += chunk;});
            const completed = new Promise(resolve => child.once('close', code => resolve({code, stdout})));
            let stderr = ''; child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-2000);}); child.stdin.on('error', () => {});
            const failed = new Promise((_, reject) => {child.once('error', reject); child.once('close', code => reject(new Error(`Native probe exited (${code}): ${stderr}`)));});
            child.stdin.end(prompt);
            let timer;
            try {return JSON.stringify(await Promise.race([execute ? completed : response, failed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Native skill probe timed out.')), 15000);})]));}
            finally {clearTimeout(timer); capture = null; child.kill(); await new Promise(resolve => {if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('close', resolve);});}
        };
        const captured = await run('Use the MCP tools for this task.');
        if (process.env.FDO_MCP_PROBE_DEBUG) {
            const data = JSON.parse(captured);
            console.log(JSON.stringify({tools: data.tools, restrictions: captured.match(/.{0,80}(?:tool execution|tools are disabled).{0,160}/gi)}));
        }
        assert.ok(captured.includes('allowed_search'), 'Native Codex must offer the selected MCP tool.');
        assert.equal(captured.includes('forbidden_write'), false, 'Unselected tools must not reach the model.');
        const executed = JSON.parse(await run('Call the allowed MCP tool.', true));
        assert.equal(executed.code, 0, executed.stdout);
        assert.deepEqual(calls, ['allowed_search']);
        assert.ok(executed.stdout.includes('MCP probe complete.'));
        const events = executed.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
        assert.ok(events.some(event => event.type === 'item.started' && event.item?.type === 'mcp_tool_call'));
        assert.ok(events.some(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' && event.item?.status === 'completed'));
        if (process.env.FDO_MCP_PROBE_DEBUG) console.log(JSON.stringify(events.filter(event => event.item?.type === 'mcp_tool_call').map(event => ({type: event.type, server: event.item.server, tool: event.item.tool, status: event.item.status}))));
        const nested = JSON.parse(await run('Call the allowed MCP tool through functions.exec.', 'code-mode'));
        assert.equal(nested.code, 0, nested.stdout);
        assert.deepEqual(calls, ['allowed_search', 'allowed_search'], nested.stdout);
        assert.ok(codeModeResult.includes('GLOBALS:undefined,undefined,undefined'));
        assert.ok(codeModeResult.includes('LOCAL_EXEC_REJECTED'));
        assert.ok(codeModeResult.includes('NODE_FS_REJECTED'));
        assert.ok(codeModeResult.includes('UNSELECTED_TOOL_REJECTED'));
        assert.equal(codeModeResult.includes('UNSELECTED_TOOL_UNEXPECTED'), false);
        assert.equal(codeModeResult.includes('LOCAL_EXEC_UNEXPECTED'), false);
        assert.equal(codeModeResult.includes('NODE_FS_UNEXPECTED'), false);
        if (process.env.FDO_MCP_PROBE_DEBUG) console.log(nested.stdout);
        console.log('PASS: direct and code-mode MCP calls execute through the bundled runtime; unselected tools, shell execution, Node filesystem imports, process/require/fetch globals remain unavailable. No login or real inference.');
    } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await isolated.cleanup(); await fsp.rm(credentialRoot, {recursive: true, force: true});}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
