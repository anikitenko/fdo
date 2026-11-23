const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const {layout, environment} = require('../../src/utils/git/bundledGit.cjs');
const {gcmPaths} = require('../../scripts/remove-bundled-gcm.cjs');

test('bundled Git uses scoped credentials without GCM and retains LFS', async ({}, testInfo) => {
    const exe = process.env.FDO_E2E_EXECUTABLE;
    test.skip(!exe && !process.env.FDO_TEST_STAGED_GIT, 'Requires staged or packaged Git');
    const git = layout(exe ? path.resolve(path.dirname(exe), process.platform === 'darwin' ? '../Resources/git' : 'resources/git') : process.env.FDO_TEST_STAGED_GIT);
    expect(gcmPaths(process.platform, process.arch).filter(file => fs.existsSync(path.join(git.root, file)))).toEqual([]);
    const token = 'Basic ' + Buffer.from('fixture:test').toString('base64');
    const oid = 'a'.repeat(40);
    const server = http.createServer((req, res) => {
        if (req.headers.authorization !== token) res.writeHead(401, {'WWW-Authenticate': 'Basic realm="fixture"'}).end();
        else if (req.url.startsWith('/repo/info/refs')) res.writeHead(200, {'Content-Type':'text/plain'}).end(oid + '\trefs/heads/main\n');
        else res.writeHead(404).end();
    });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    try {
        const url = 'http://127.0.0.1:' + server.address().port + '/repo';
        const env = environment({...process.env, GIT_CONFIG_GLOBAL:testInfo.outputPath('isolated.gitconfig'), GIT_CONFIG_NOSYSTEM:'1', GIT_TERMINAL_PROMPT:'0',
            GIT_CONFIG_COUNT:'1', GIT_CONFIG_KEY_0:'credential.helper', GIT_CONFIG_VALUE_0:''}, git);
        expect((await execute(git.command, ['lfs','version'], {env, cwd:git.root})).stdout).toContain('git-lfs/');
        await expect(execute(git.command, ['ls-remote',url], {env, cwd:git.root})).rejects.toThrow();
        Object.assign(env, {GIT_CONFIG_COUNT:'2', GIT_CONFIG_KEY_1:'http.' + url + '/.extraHeader', GIT_CONFIG_VALUE_1:'Authorization: ' + token});
        expect((await execute(git.command, ['ls-remote',url], {env, cwd:git.root})).stdout).toContain(oid + '\trefs/heads/main');
    } finally { await new Promise(resolve => server.close(resolve)); }
});
