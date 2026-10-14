const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const esbuild = require('esbuild');
const assert = require('node:assert/strict');
const moduleShim = {exports: {}};
new Function('require', 'module', 'exports', esbuild.buildSync({entryPoints: ['src/utils/plugins/security/pluginAssistantIsolation.js'], bundle: true, write: false, platform: 'node', format: 'cjs'}).outputFiles[0].text)(require, moduleShim, moduleShim.exports);
(async () => {
    // System shell stands in for the agent so the OS boundary is tested independently of model behavior.
    const externalHostData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fdo-host-canary-'));
    fs.writeFileSync(path.join(externalHostData, 'settings.json'), 'HOST_PRIVATE_CANARY');
    const selectedSkill = '---\nname: isolation-probe\ndescription: Selected skill fixture\n---\nSELECTED_SKILL_CANARY';
    const isolated = await moduleShim.exports.createPluginAssistantIsolation({command: '/bin/sh', bundled: true, args: []}, 'codex-cli', [externalHostData],
        {codexSkills: [{name: 'isolation-probe', description: 'Selected skill fixture', content: selectedSkill}]});
    try {
        const execute = script => spawnSync(isolated.command, [...isolated.args.slice(0, 2), "/bin/sh", '-c', script], {...isolated.options, encoding: 'utf8'});
        const allowed = execute('echo plugin-only > allowed.txt; cat allowed.txt');
        assert.equal(allowed.status, 0, allowed.stderr);
        assert.equal(allowed.stdout.trim(), 'plugin-only');
        const catalogRead = execute('cat "$CODEX_HOME/skills/isolation-probe/SKILL.md"');
        assert.equal(catalogRead.status, 0, catalogRead.stderr);
        assert.equal(catalogRead.stdout.includes('SELECTED_SKILL_CANARY'), false);
        await isolated.setActiveSkills(['isolation-probe']);
        const skillRead = execute('cat "$CODEX_HOME/skills/isolation-probe/SKILL.md"');
        assert.equal(skillRead.status, 0, skillRead.stderr);
        assert.equal(skillRead.stdout, selectedSkill);
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
        console.log('PASS: scratch and selected skill access allowed; FDO contents and symlink reads denied; host environment excluded.');
    } finally {await isolated.cleanup(); fs.rmSync(externalHostData, {recursive: true, force: true});}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
