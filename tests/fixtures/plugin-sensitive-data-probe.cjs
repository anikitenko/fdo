// Synthetic credentials only. This function runs unchanged in Node and Electron.
async function runSensitiveDataProbe(outside, sibling) {
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
    const {pathToFileURL} = require('node:url');
    const home = process.env.PLUGIN_HOME, secret = path.join(outside, 'settings.json');
    const result = {};
    const check = async (name, action) => {
        try {await action();result[name] = 'allowed';}
        catch (error) {result[name] = error.code === 'FDO_PLUGIN_PERMISSION_DENIED' ? 'blocked' : 'unexpected: ' + error.message;}
    };
    const callback = action => new Promise((resolve, reject) => action(error => error ? reject(error) : resolve()));
    for (const key of ['AWS_SECRET_ACCESS_KEY', 'AZURE_CLIENT_SECRET', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'FDO_REVIEW_ENV_MARKER', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'FDO_E2E_USER_DATA_DIR', 'SSH_AUTH_SOCK']) {
        result['env:' + key] = process.env[key] === undefined;
    }
    result['private:home'] = process.env.HOME === home && os.homedir() === home;
    result['private:temp'] = os.tmpdir() === path.join(home, '.tmp');
    result['known:ancestor-exists'] = fs.existsSync(path.dirname(home));
    result['known:root-exists'] = fs.existsSync(path.parse(home).root);
    result['known:promises-alias'] = fs.promises === require('node:fs/promises');
    await check('deny:ancestor-list', () => fs.readdirSync(path.dirname(home)));
    const own = path.join(home, 'own.json');
    fs.writeFileSync(own, '{"synthetic":"own-data"}');
    for (const [variant, target] of Object.entries({string: secret, buffer: Buffer.from(secret), url: pathToFileURL(secret)})) {
        await check('deny:sync:' + variant, () => fs.readFileSync(target));
        await check('deny:callback:' + variant, () => callback(done => fs.readFile(target, done)));
        await check('deny:promise:' + variant, () => fs.promises.readFile(target));
        await check('deny:open:' + variant, () => fs.promises.open(target, 'r'));
        await check('deny:stat:' + variant, () => fs.statSync(target));
        const ownTarget = variant === 'buffer' ? Buffer.from(own) : variant === 'url' ? pathToFileURL(own) : own;
        result['own:content:' + variant] = await fs.promises.readFile(ownTarget, 'utf8') === '{"synthetic":"own-data"}';
    }
    result['hidden:exists-sync'] = fs.existsSync(secret) === false;
    result['hidden:exists-callback'] = await new Promise(resolve => fs.exists(secret, exists => resolve(exists === false)));
    for (const [name, filename] of Object.entries({
        settings: secret, aws: path.join(outside, '.aws', 'credentials'), ssh: path.join(outside, '.ssh', 'id_ed25519'),
        sibling: path.join(sibling, 'settings.json'), symlink: path.join(home, 'sensitive-link', 'settings.json'),
    })) await check('deny:credential:' + name, () => fs.readFileSync(filename, 'utf8'));
    await check('deny:builtin', () => process.getBuiltinModule('fs').readFileSync(secret));
    await check('deny:esm-fs', async () => (await import('node:fs')).readFileSync(secret));
    await check('deny:esm-promises', async () => (await import('node:fs/promises')).readFile(secret));
    await check('deny:require-json', () => require(secret));
    await check('deny:require-js', () => require(path.join(outside, 'secret.cjs')));
    await check('deny:module-extension', () => require('node:module')._extensions['.json']({exports: {}}, secret));
    await check('deny:esm-json', () => import(pathToFileURL(secret).href, {with: {type: 'json'}}));
    await check('deny:esm-js', () => import(pathToFileURL(path.join(outside, 'secret.cjs')).href));
    await check('deny:readdir', () => fs.promises.readdir(outside));
    await check('deny:opendir', () => fs.promises.opendir(outside));
    await check('deny:access', () => callback(done => fs.access(secret, done)));
    await check('deny:realpath', () => fs.realpathSync.native(secret));
    await check('deny:lstat', () => fs.lstatSync(secret));
    await check('deny:copy-source', () => fs.promises.copyFile(secret, path.join(home, 'copied-secret')));
    await check('deny:stream', () => fs.createReadStream(secret));
    if (typeof fs.openAsBlob === 'function') await check('deny:blob', () => fs.openAsBlob(secret));
    await check('deny:stream-constructor', () => new Promise((resolve, reject) => {
        const stream = new fs.ReadStream(secret);stream.once('error', reject);stream.once('end', resolve);stream.resume();
    }));
    await check('deny:unknown-fd', () => fs.readSync(99999, Buffer.alloc(1), 0, 1, 0));
    await check('deny:unknown-fd-callback', () => callback(done => fs.readFile(99999, done)));
    await check('deny:electron', () => require('electron'));
    await check('deny:original-fs', () => require('original-fs'));
    await check('deny:original-fs-builtin', () => process.getBuiltinModule('original-fs'));

    const fd = fs.openSync(own, 'r');
    try {await check('allow:fd', () => fs.readFileSync(fd));} finally {fs.closeSync(fd);}
    const handle = await fs.promises.open(own, 'r');
    try {
        await check('allow:filehandle', () => handle.readFile());
        await check('allow:filehandle-stat', () => handle.stat());
    } finally {await handle.close();}
    await check('allow:code-assets', () => fs.readFileSync(path.join(process.env.PLUGIN_CODE_HOME, 'dist', 'index.cjs'), 'utf8'));
    await check('allow:runtime', () => fs.readFileSync(process.env.FDO_PLUGIN_RUNTIME_ENTRY));
    await check('allow:require-json', () => require(own));
    await check('allow:esm-json', () => import(pathToFileURL(own).href, {with: {type: 'json'}}));
    await check('allow:readdir', () => fs.readdirSync(home));
    await check('allow:stream', () => new Promise((resolve, reject) => {
        const stream = fs.createReadStream(own);stream.once('error', reject);stream.once('end', resolve);stream.resume();
    }));
    return result;
}

function assertSensitiveDataProbe(result, expect) {
    for (const [name, value] of Object.entries(result)) {
        const expected = name.startsWith('deny:') ? 'blocked' : name.startsWith('allow:') ? 'allowed' : true;
        expect({name, value}).toEqual({name, value: expected});
    }
    expect(result['env:OPENAI_API_KEY']).toBe(true);
    expect(result['allow:runtime']).toBe('allowed');
}
module.exports = {runSensitiveDataProbe, assertSensitiveDataProbe};
