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
    const skills = ['needed', 'unrelated'].map(name => ({name, description: `${name} skill metadata`, content: `---\nname: ${name}\ndescription: ${name} skill metadata\n---\n${name.toUpperCase()}_INSTRUCTION_BODY_CANARY`}));
    // The OS-profile smoke test runs separately: that profile intentionally
    // blocks loopback. This probe checks native context loading via a mock.
    const isolated = await shim.exports.createPluginAssistantIsolation({command: binary, args: [], bundled: true}, 'codex-cli', [],
        {credentialRoot, platform: process.platform === 'darwin' ? 'linux' : process.platform, codexSkills: skills});
    let capture;
    const server = http.createServer((request, response) => {
        let body = '';
        request.on('data', chunk => {body += chunk;});
        request.on('end', () => {capture?.(JSON.parse(body)); response.writeHead(503); response.end('{"error":{"message":"Offline probe finished"}}');});
    });
    try {
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        const run = async (active, prompt) => {
            await isolated.setActiveSkills(active);
            const response = new Promise(resolve => {capture = resolve;});
            const config = {model_provider: 'probe', model: 'offline-probe', 'model_providers.probe.name': 'Offline probe',
                'model_providers.probe.base_url': `http://127.0.0.1:${server.address().port}`, 'model_providers.probe.wire_api': 'responses',
                'model_providers.probe.requires_openai_auth': false, 'model_providers.probe.request_max_retries': 0,
                'model_providers.probe.stream_max_retries': 0, 'features.skip_host_skill_discovery': true,
                'features.daemon_auto_start': false, 'features.unbounded_connection_retries': false, approval_policy: 'never', web_search: 'disabled'};
            for (const feature of shim.exports.CODEX_PROPOSAL_FEATURES) config[`features.${feature}`] = false;
            const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', ...Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), '-'];
            const child = spawn(isolated.command, [...isolated.args, ...args], {...isolated.options, stdio: ['pipe', 'ignore', 'pipe']});
            let stderr = ''; child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-2000);}); child.stdin.on('error', () => {});
            const failed = new Promise((_, reject) => {child.once('error', reject); child.once('close', code => reject(new Error(`Native probe exited (${code}): ${stderr}`)));});
            child.stdin.end(prompt);
            let timer;
            try {return JSON.stringify(await Promise.race([response, failed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Native skill probe timed out.')), 15000);})]));}
            finally {clearTimeout(timer); capture = null; child.kill(); await new Promise(resolve => {if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('close', resolve);});}
        };
        const metadata = await run([], 'Explain this task without selecting a skill.');
        assert.ok(metadata.includes('needed skill metadata'));
        assert.equal(metadata.includes('NEEDED_INSTRUCTION_BODY_CANARY'), false);
        assert.equal(metadata.includes('UNRELATED_INSTRUCTION_BODY_CANARY'), false);
        const requested = await run(['needed'], 'Use $needed. Explain this task.');
        assert.ok(requested.includes('NEEDED_INSTRUCTION_BODY_CANARY'));
        assert.equal(requested.includes('UNRELATED_INSTRUCTION_BODY_CANARY'), false);
        const next = await run([], 'Explain the next task without selecting a skill.');
        assert.equal(next.includes('NEEDED_INSTRUCTION_BODY_CANARY'), false);
        console.log('PASS: native context contains metadata first, only requested instructions after loading, and no instruction bodies on the next step. No credentials or real-provider requests.');
    } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await isolated.cleanup(); await fsp.rm(credentialRoot, {recursive: true, force: true});}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
