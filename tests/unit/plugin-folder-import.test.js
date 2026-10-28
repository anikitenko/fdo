/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectPluginFolder, installPluginFolder} from '../../src/utils/plugins/importing/pluginFolderImport';
import {getIgnoreInstance} from '../../src/utils/filesystem/getIgnoreInstance';
let root;
const metadata = {name: 'Folder Tools', version: '1.0.0', author: 'Team', description: 'Folder import', icon: 'application'};
const source = `export class Plugin {get metadata() {return ${JSON.stringify(metadata)};}}`;

test('previews supported FDO versions and blocks an incompatible import before building or registering', async () => {
    const dir = await fixture({'package.json': JSON.stringify({...metadata, source: 'index.ts', main: 'dist/index.cjs',
        fdo: {compatibility: {fdo: '>=99.0.0'}}}), 'dist/index.cjs': 'module.exports = {};'});
    const snapshot = await inspectPluginFolder(dir);
    expect(snapshot.compatibility).toMatchObject({status: 'incompatible', supportedFdo: '>=99.0.0'});
    for (const mode of ['build', 'bundle']) {
        const config = {...options(), mode};
        await expect(installPluginFolder(snapshot, config)).rejects.toThrow('Requires FDO');
        expect(config.build).not.toHaveBeenCalled();
        expect(config.registry.addPlugin).not.toHaveBeenCalled();
    }
});
async function fixture(files = {}) {
    const dir = path.join(root, 'input'); await fs.mkdir(dir, {recursive: true});
    const defaults = {'package.json': JSON.stringify({...metadata, name: 'folder-tools', source: 'index.ts', main: 'dist/index.cjs'}), 'index.ts': source};
    for (const [name, content] of Object.entries({...defaults, ...files})) {
        await fs.mkdir(path.dirname(path.join(dir, name)), {recursive: true}); await fs.writeFile(path.join(dir, name), content);
    }
    return dir;
}
const options = () => ({id: 'folder-tools', mode: 'build', pluginsDir: path.join(root, 'plugins'),
    registry: {isInstalled: jest.fn(() => false), addPlugin: jest.fn()},
    build: jest.fn(async () => ({outputFiles: [{path: '/index.cjs', text: 'compiled bundle'}]})),
    normalizeMetadata: value => value, sign: jest.fn(async () => ({success: true})), verify: jest.fn(async () => ({success: true}))});
beforeEach(async () => {root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-folder-import-'));});
afterEach(async () => {await fs.rm(root, {recursive: true, force: true});});
test('detects source-only folders without running scripts and excludes dependencies, VCS and env files', async () => {
    const dir = await fixture({'node_modules/malware.js': 'throw 1', '.git/config': 'private', '.env': 'SECRET', 'package.json': JSON.stringify({...metadata, source: 'index.ts', main: 'dist/index.cjs', scripts: {install: 'throw 1'}})});
    const snapshot = await inspectPluginFolder(dir);
    expect(snapshot.hasCompiled).toBe(false); expect(snapshot.sourceEntry).toBe('index.ts');
    expect(snapshot.files.map(file => file.path)).toEqual(expect.arrayContaining(['index.ts', 'package.json']));
    expect(snapshot.files.some(file => /node_modules|\.git|\.env/.test(file.path))).toBe(false);
    const config = options(); await installPluginFolder(snapshot, config);
    expect(config.build).toHaveBeenCalledTimes(1); expect(config.sign).toHaveBeenCalledWith(expect.any(String), 'root');
    const [, , home, entry, overwrite, grants] = config.registry.addPlugin.mock.calls[0];
    expect(overwrite).toBe(false); expect(grants).toEqual([]);
    expect(await fs.readFile(path.join(home, entry), 'utf8')).toBe('compiled bundle');
    expect(JSON.parse(await fs.readFile(path.join(home, 'package.json'), 'utf8')).main).toBe(entry);
    expect(await fs.readFile(path.join(home, 'index.ts'), 'utf8')).toBe(source);
});
test('preserves compiled exports, binary assets and signatures byte-for-byte without rebuilding or re-signing', async () => {
    const signature = Buffer.from([0, 255, 1, 128]), asset = Buffer.from([137, 80, 78, 71, 0, 255]);
    const dir = await fixture({'dist/index.cjs': 'module.exports = {};', 'fdo.signature': signature, 'assets/icon.png': asset});
    const snapshot = await inspectPluginFolder(dir);
    expect(snapshot.hasCompiled).toBe(true); expect(snapshot.sourceEntry).toBe('index.ts');
    const config = {...options(), mode: 'bundle'}; await installPluginFolder(snapshot, config);
    const home = config.registry.addPlugin.mock.calls[0][2];
    expect(await fs.readFile(path.join(home, 'fdo.signature'))).toEqual(signature);
    expect(await fs.readFile(path.join(home, 'assets/icon.png'))).toEqual(asset);
    expect(config.build).not.toHaveBeenCalled(); expect(config.sign).not.toHaveBeenCalled(); expect(config.verify).toHaveBeenCalled();
});
test('failed builds, signing and verification do not register a plugin or leave partial folders', async () => {
    const snapshot = await inspectPluginFolder(await fixture());
    for (const failure of ['build', 'sign', 'verify']) {
        const config = options();
        if (failure === 'build') config.build.mockRejectedValue(new Error('Compilation failed'));
        else config[failure].mockResolvedValue({success: false, error: failure + ' failed'});
        await expect(installPluginFolder(snapshot, config)).rejects.toThrow();
        expect(config.registry.addPlugin).not.toHaveBeenCalled();
        expect(await fs.readdir(config.pluginsDir)).toEqual([]);
    }
});
test('rejects collisions, traversal, missing declared sources and symlinks', async () => {
    const dir = await fixture(); const snapshot = await inspectPluginFolder(dir);
    const config = options(); config.registry.isInstalled.mockReturnValue(true);
    await expect(installPluginFolder(snapshot, config)).rejects.toThrow('already installed');
    expect(config.build).not.toHaveBeenCalled();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({...metadata, source: '../outside.ts'}));
    await expect(inspectPluginFolder(dir)).rejects.toThrow('inside');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({...metadata, source: 'missing.ts'}));
    await expect(inspectPluginFolder(dir)).rejects.toThrow('missing');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({...metadata, source: 'index.ts'}));
    if (process.platform !== 'win32') {
        await fs.symlink(path.join(root, 'outside'), path.join(dir, 'link'));
        await expect(inspectPluginFolder(dir)).rejects.toThrow('Symbolic links');
    }
});
test('compiled-only projects are supported and export includes runtime dist unless explicitly ignored', async () => {
    const dir = await fixture({'dist/index.cjs':'module.exports = {};'});
    await fs.rm(path.join(dir, 'index.ts'));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({...metadata, main:'dist/index.cjs'}));
    const snapshot = await inspectPluginFolder(dir);
    expect(snapshot.sourceEntry).toBeNull(); expect(snapshot.hasCompiled).toBe(true);
    expect((await getIgnoreInstance(dir, [], {includeDist:true})).ignores('dist/index.cjs')).toBe(false);
    await fs.writeFile(path.join(dir, '.fdoignore'), 'dist/\n');
    expect((await getIgnoreInstance(dir, [], {includeDist:true})).ignores('dist/index.cjs')).toBe(true);
});
test('rechecks installed IDs after compilation and cleans up instead of replacing them', async () => {
    const snapshot = await inspectPluginFolder(await fixture()); const config = options();
    config.build.mockImplementation(async () => {
        config.registry.isInstalled.mockReturnValue(true);
        return {outputFiles:[{path:'/index.cjs',text:'compiled bundle'}]};
    });
    await expect(installPluginFolder(snapshot, config)).rejects.toThrow('Another import');
    expect(config.registry.addPlugin).not.toHaveBeenCalled();
    expect(await fs.readdir(config.pluginsDir)).toEqual([]);
});
test('parses bundles without executing them and allows rebuilding invalid bundles from included source', async () => {
    const dir = await fixture({'dist/index.cjs':'throw new Error("must never execute while importing");'});
    expect((await inspectPluginFolder(dir)).bundleError).toBe('');
    await fs.writeFile(path.join(dir, 'dist/index.cjs'), 'export const invalidCommonJS = true;');
    const snapshot = await inspectPluginFolder(dir);
    expect(snapshot.bundleError).toContain('not valid CommonJS');
    const config = {...options(), mode:'bundle'};
    await expect(installPluginFolder(snapshot, config)).rejects.toThrow('not valid CommonJS');
    config.mode = 'build';
    await expect(installPluginFolder(snapshot, config)).resolves.toMatchObject({success:true});
});
