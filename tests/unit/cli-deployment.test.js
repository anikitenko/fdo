/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {withCliLock} from '../../src/utils/system/cliLock';
import {deployCliPluginDirectory, readCliRegistry} from '../../src/utils/system/cliPluginOperations';
let root;
const metadata = {name: 'Fixture', version: '1.0.0', author: 'FDO', description: 'Fixture', icon: 'application'};
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-deploy-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
function workspace(id = 'fixture') {
    const directory = path.join(root, id);fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: id, main: 'dist/index.cjs', source: 'index.ts'}));
    fs.writeFileSync(path.join(directory, 'index.ts'), 'authored');
    return directory;
}
function dependencies(overrides = {}) {
    return {registryFile: path.join(root, 'plugins.json'), build: async () => ({outputFiles: [{path: 'bundle.js', text: 'new bundle'}]}), extractMetadata: async () => metadata,
        sign: async directory => {for (const file of ['fdo.signature', 'fdo.meta.json', '.fdoignore']) fs.writeFileSync(path.join(directory, file), 'new');}, ...overrides};
}
test.each(['sign', 'registry'])('failed %s restores all previous artifacts and leaves registry untouched', async failure => {
    const directory = workspace(), options = dependencies();
    fs.mkdirSync(path.join(directory, 'dist'));
    const files = ['dist/index.cjs', 'fdo.signature', 'fdo.meta.json', '.fdoignore'];
    for (const file of files) fs.writeFileSync(path.join(directory, file), 'old ' + file, {mode: 0o600});
    fs.writeFileSync(options.registryFile, JSON.stringify({plugins: [{id: 'other'}]}));
    if (failure === 'sign') options.sign = async target => {fs.writeFileSync(path.join(target, 'fdo.signature'), 'partial');throw new Error('sign failed');};
    else options.register = () => {throw new Error('registry failed');};
    await expect(deployCliPluginDirectory(directory, options)).rejects.toThrow('failed');
    for (const file of files) {
        expect(fs.readFileSync(path.join(directory, file), 'utf8')).toBe('old ' + file);
        if (process.platform !== 'win32') expect(fs.statSync(path.join(directory, file)).mode & 0o777).toBe(0o600);
    }
    expect(readCliRegistry(options.registryFile).plugins).toEqual([{id: 'other'}]);
    expect(fs.readFileSync(path.join(directory, 'index.ts'), 'utf8')).toBe('authored');
});
test('failed first deployment removes generated artifacts and empty output directories', async () => {
    const directory = workspace();
    await expect(deployCliPluginDirectory(directory, dependencies({register: () => {throw new Error('disk full');}}))).rejects.toThrow('disk full');
    expect(fs.readdirSync(directory).sort()).toEqual(['index.ts', 'package.json']);
});
test('concurrent deployments preserve separate registry entries and grants', async () => {
    const first = workspace('first'), second = workspace('second'), options = dependencies();
    fs.writeFileSync(options.registryFile, JSON.stringify({plugins: [{id: 'first', capabilities: ['storage']}]}));
    await Promise.all([deployCliPluginDirectory(first, options), deployCliPluginDirectory(second, options)]);
    const plugins = readCliRegistry(options.registryFile).plugins;
    expect(plugins.map(plugin => plugin.id).sort()).toEqual(['first', 'second']);
    expect(plugins.find(plugin => plugin.id === 'first').capabilities).toEqual(['storage']);
});
test('workspace locks serialize operations and recover after thrown errors', async () => {
    let active = 0, peak = 0;
    const operation = () => withCliLock(root, async () => {active++;peak = Math.max(peak, active);await new Promise(resolve => setTimeout(resolve, 20));active--;});
    await Promise.all([operation(), operation()]);expect(peak).toBe(1);
    await expect(withCliLock(root, () => {throw new Error('failure');})).rejects.toThrow('failure');
    expect(await withCliLock(root, () => 'released')).toBe('released');
});
test('OS locks reject another process and are released when its owner is killed', async () => {
    let filename;
    // Observe the exact database used by this resource from within a held lock.
    const {createHash} = require('node:crypto');
    const canonical = fs.realpathSync(root);
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    filename = path.join(os.tmpdir(), 'fdo-cli-locks-' + createHash('sha256').update(os.homedir()).digest('hex').slice(0, 16), createHash('sha256').update(key).digest('hex') + '.sqlite');
    await withCliLock(root, () => {});
    const child = spawn(process.execPath, ['-e', "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('ready');setInterval(()=>{},1000)", filename], {stdio: ['ignore','pipe','pipe']});
    const closed = new Promise(resolve => child.on('close', resolve));
    try {
        await new Promise((resolve, reject) => {child.once('error', reject);child.stdout.once('data', resolve);child.once('exit', () => reject(new Error('lock owner exited early')));});
        await expect(withCliLock(root, () => {}, {timeout: 50})).rejects.toThrow('Another CLI');
        child.kill('SIGKILL');await closed;
        expect(await withCliLock(root, () => 'recovered')).toBe('recovered');
    } finally {child.kill('SIGKILL');await closed;}
});
