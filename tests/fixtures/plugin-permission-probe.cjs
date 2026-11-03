// Runs unchanged inside both a Node bootstrap and a normally deployed Electron
// plugin. All targets are disposable test-owned files; never use real user data.
async function runPermissionProbe(outside) {
    const fs = require('node:fs');
    const path = require('node:path');
    const {pathToFileURL} = require('node:url');
    const home = process.env.PLUGIN_HOME;
    const outsideFile = path.join(outside, 'sentinel.txt');
    const result = {};
    const check = async (name, action) => {
        globalThis.__FDO_PERMISSION_PROBE_LAST_CHECK = name;
        try {await action(); result[name] = 'allowed';}
        catch (error) {result[name] = error.message.includes('[host-policy]') ? 'blocked' : 'unexpected: ' + error.message;}
    };
    const callback = action => new Promise((resolve, reject) => action(error => error ? reject(error) : resolve()));

    for (const name of ['child_process', 'node:child_process', 'worker_threads', 'node:http']) {
        await check('builtin:' + name, () => process.getBuiltinModule(name));
        await check('esm:' + name, () => import(name));
    }
    await check('require:child_process', () => require('node:child_process'));
    if (typeof process.execve === 'function') {
        // Invalid input is intentional: an unguarded API fails harmlessly with
        // a native argument error, whereas the guarded API returns policy denial.
        await check('process:execve', () => process.execve(undefined));
        await check('esm:process-execve', async () => (await import('node:process')).execve(undefined));
    }
    // Loading SDK internals must not hand plugins executable raw process APIs.
    await check('sdk-parent:exec', () => require('node:module')._load('node:child_process', {
        filename: path.join(home, 'node_modules/@anikitenko/fdo-sdk/fixture.cjs'),
    }).execFileSync(process.execPath, ['-e', 'process.stdout.write("test")']));
    result.unknownBuiltin = process.getBuiltinModule('not-a-real-builtin') === undefined;

    for (const [variant, target] of Object.entries({string: outsideFile, buffer: Buffer.from(outsideFile), url: pathToFileURL(outsideFile)})) {
        await check('outside:sync:' + variant, () => fs.writeFileSync(target, 'changed'));
        await check('outside:callback:' + variant, () => callback(done => fs.writeFile(target, 'changed', done)));
        await check('outside:promise:' + variant, () => fs.promises.writeFile(target, 'changed'));
        await check('outside:open:' + variant, () => callback(done => fs.open(target, 'w', done)));
        const ownTarget = path.join(home, 'state-' + variant);
        const own = variant === 'buffer' ? Buffer.from(ownTarget) : variant === 'url' ? pathToFileURL(ownTarget) : ownTarget;
        await check('home:callback:' + variant, () => callback(done => fs.writeFile(own, 'one', done)));
        await check('home:promise:' + variant, () => fs.promises.appendFile(own, 'two'));
        result['home:content:' + variant] = fs.readFileSync(ownTarget, 'utf8');
    }
    await check('outside:builtin-fs', () => process.getBuiltinModule('fs').writeFileSync(outsideFile, 'changed'));
    const spoofedFd = fs.openSync(path.join(home, 'state-string'), 'r+');
    try {
        for (const [variant, target] of Object.entries({buffer: Buffer.from(outsideFile), url: pathToFileURL(outsideFile)})) {
            target.fd = spoofedFd;
            await check('outside:spoofed-fd:' + variant, () => fs.promises.writeFile(target, 'changed'));
        }
    } finally {fs.closeSync(spoofedFd);}
    await check('outside:esm-fs', async () => (await import('node:fs')).writeFileSync(outsideFile, 'changed'));
    await check('outside:esm-fs-promises', async () => (await import('node:fs/promises')).writeFile(outsideFile, 'changed'));
    await check('outside:stream', () => fs.createWriteStream(outsideFile));
    await check('outside:stream-constructor', () => new Promise((resolve, reject) => {
        const stream = new fs.WriteStream(outsideFile);
        stream.once('error', reject); stream.once('finish', resolve); stream.end('changed');
    }));
    await check('outside:append', () => callback(done => fs.appendFile(outsideFile, 'changed', done)));
    await check('outside:truncate', () => fs.promises.truncate(outsideFile, 0));
    await check('outside:rename-source', () => fs.promises.rename(outsideFile, path.join(home, 'stolen')));
    await check('outside:copy', () => callback(done => fs.copyFile(path.join(home, 'state-string'), outsideFile, done)));
    await check('outside:recursive-copy', () => fs.promises.cp(home, outside, {recursive: true}));
    await check('outside:symlink', () => fs.symlinkSync(outside, path.join(home, 'external-link'), 'junction'));
    await check('outside:hardlink', () => fs.linkSync(outsideFile, path.join(home, 'external-hardlink')));
    const linkedTarget = path.join(home, 'preexisting-outside-link', 'sentinel.txt');
    await check('outside:symlink-sync', () => fs.writeFileSync(linkedTarget, 'changed'));
    await check('outside:symlink-callback', () => callback(done => fs.writeFile(linkedTarget, 'changed', done)));
    await check('outside:symlink-promise', () => fs.promises.writeFile(linkedTarget, 'changed'));
    await check('outside:mkdir', () => callback(done => fs.mkdir(path.join(outside, 'created'), done)));
    await check('outside:unlink', () => callback(done => fs.unlink(outsideFile, done)));

    let outsideFd;
    try {outsideFd = fs.openSync(outsideFile, 'r');}
    catch (error) {result['outside:read-open'] = error.code === 'FDO_PLUGIN_PERMISSION_DENIED' ? 'blocked' : 'unexpected: ' + error.message;}
    if (outsideFd !== undefined) try {
        await check('outside:fd-sync', () => fs.ftruncateSync(outsideFd, 0));
        await check('outside:fd-callback', () => callback(done => fs.writeFile(outsideFd, 'changed', done)));
    } finally {fs.closeSync(outsideFd);}
    let outsideHandle;
    try {outsideHandle = await fs.promises.open(outsideFile, 'r');}
    catch (error) {result['outside:read-handle'] = error.code === 'FDO_PLUGIN_PERMISSION_DENIED' ? 'blocked' : 'unexpected: ' + error.message;}
    if (outsideHandle) try {
        await check('outside:filehandle', () => outsideHandle.truncate(0));
        const ownFd = fs.openSync(path.join(home, 'state-string'), 'r+');
        try {
            Object.defineProperty(outsideHandle, 'fd', {value: ownFd, configurable: true});
            await check('outside:spoofed-filehandle', () => outsideHandle.truncate(0));
            await check('outside:spoofed-filehandle-promise', () => fs.promises.writeFile(outsideHandle, 'changed'));
        } finally {delete outsideHandle.fd;fs.closeSync(ownFd);}
    }
    finally {await outsideHandle.close();}

    const ownFile = path.join(home, 'fd-state');
    const ownFd = await new Promise((resolve, reject) => fs.open(ownFile, 'w', (error, fd) => error ? reject(error) : resolve(fd)));
    try {await check('home:fd', () => callback(done => fs.writeFile(ownFd, 'fd', done)));}
    finally {fs.closeSync(ownFd);}
    const ownHandle = await fs.promises.open(ownFile, 'r+');
    try {await check('home:filehandle', () => ownHandle.writeFile('handle'));}
    finally {await ownHandle.close();}
    await check('home:stream', () => new Promise((resolve, reject) => {
        const stream = new fs.WriteStream(path.join(home, 'stream-state'));
        stream.once('error', reject); stream.once('finish', resolve); stream.end('stream');
    }));
    await check('home:rename', () => fs.promises.rename(ownFile, path.join(home, 'renamed')));
    await check('home:copy', () => fs.promises.copyFile(path.join(home, 'renamed'), ownFile));
    fs.mkdirSync(path.join(home, 'own-link-target'));
    await check('home:symlink', () => fs.symlinkSync(path.join(home, 'own-link-target'), path.join(home, 'own-link'), 'junction'));
    await check('home:hardlink', () => fs.linkSync(path.join(home, 'state-string'), path.join(home, 'own-hardlink')));
    return result;
}

function assertPermissionProbe(result, expect) {
    expect(result.unknownBuiltin).toBe(true);
    for (const [name, value] of Object.entries(result)) {
        if (name === 'unknownBuiltin') continue;
        const expected = name.startsWith('home:content:') ? 'onetwo' : name.startsWith('home:') ? 'allowed' : 'blocked';
        expect({name, value}).toEqual({name, value: expected});
    }
}
module.exports = {runPermissionProbe, assertPermissionProbe};
