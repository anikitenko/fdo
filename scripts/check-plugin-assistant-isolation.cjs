const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const esbuild = require('esbuild');
const assert = require('node:assert/strict');
const moduleShim = {exports: {}};
new Function('require', 'module', 'exports', esbuild.transformSync(fs.readFileSync('src/utils/pluginAssistantIsolation.js', 'utf8'), {format: 'cjs'}).code)(require, moduleShim, moduleShim.exports);
(async () => {
    // System shell stands in for the agent so the OS boundary is tested independently of model behavior.
    const externalHostData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fdo-host-canary-'));
    fs.writeFileSync(path.join(externalHostData, 'settings.json'), 'HOST_PRIVATE_CANARY');
    const isolated = await moduleShim.exports.createPluginAssistantIsolation({command: '/bin/sh', bundled: true, args: []}, 'codex-cli', [externalHostData]);
    try {
        const execute = script => spawnSync(isolated.command, [...isolated.args.slice(0, 2), "/bin/sh", '-c', script], {...isolated.options, encoding: 'utf8'});
        const allowed = execute('echo plugin-only > allowed.txt; cat allowed.txt');
        assert.equal(allowed.status, 0, allowed.stderr);
        assert.equal(allowed.stdout.trim(), 'plugin-only');
        const hostFile = path.resolve('package.json');
        // Pass paths through environment rather than interpolating shell source.
        const denied = spawnSync(isolated.command, [...isolated.args.slice(0, 2), "/bin/sh", '-c', 'cat "$HOST_CANARY"'], {...isolated.options, env: {...isolated.options.env, HOST_CANARY: hostFile}, encoding: 'utf8'});
        assert.notEqual(denied.status, 0);
        assert.equal(denied.stdout, '');
        const privateData = spawnSync(isolated.command, [...isolated.args.slice(0, 2), '/bin/cat', path.join(externalHostData, 'settings.json')], {...isolated.options, encoding: 'utf8'});
        assert.notEqual(privateData.status, 0);
        assert.equal(privateData.stdout, '');
        fs.symlinkSync(hostFile, path.join(isolated.options.cwd, 'host-link'));
        const symlink = execute('cat host-link');
        assert.notEqual(symlink.status, 0);
        assert.equal(symlink.stdout, '');
        assert.equal(isolated.options.env.OPENAI_API_KEY, undefined);
        assert.notEqual(isolated.options.cwd, process.cwd());
        console.log('PASS: scratch access allowed; FDO contents and symlink reads denied; host environment excluded.');
    } finally {await isolated.cleanup(); fs.rmSync(externalHostData, {recursive: true, force: true});}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
