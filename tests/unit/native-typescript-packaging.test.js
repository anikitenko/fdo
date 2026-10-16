/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const beforePack = require('../../scripts/check-bundled-codex-runtime.cjs');
const afterPack = require('../../scripts/fix-bundled-binary-permissions.js');
let root;
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-native-packaging-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
function file(name) {fs.mkdirSync(path.dirname(name), {recursive: true}); fs.writeFileSync(name, '', {mode: 0o644});}

test('requires the native TypeScript compiler for the requested packaging architecture', async () => {
    const modules = path.join(root, 'dist/main/node_modules');
    const native = path.join(modules, '@typescript/typescript-linux-x64/lib/tsc');
    const vendor = path.join(modules, '@openai/codex-linux-x64/vendor/x86_64-linux/bin');
    file(path.join(vendor, 'codex')); file(path.join(vendor, 'codex-code-mode-host'));
    const context = {appDir: root, electronPlatformName: 'linux', arch: 'x64'};
    await expect(beforePack(context)).rejects.toThrow('Missing TypeScript native compiler for linux/x64');
    file(native);
    await expect(beforePack(context)).resolves.toBeUndefined();
});

test('restores executable permissions for the unpacked native compiler', async () => {
    const binary = path.join(root, 'resources/app.asar.unpacked/dist/main/node_modules/@typescript/typescript-darwin-arm64/lib/tsc');
    file(binary);
    await afterPack({appOutDir: root});
    if (process.platform !== 'win32') expect(fs.statSync(binary).mode & 0o777).toBe(0o755);
});

test('fails before starting an API process when the copied compiler is not executable', () => {
    if (process.platform === 'win32') return;
    const {loadTypeScriptRuntime} = require('../../src/utils/sdk/typeScriptRuntime');
    const manifest = path.join(root, 'app.asar/dist/main/node_modules/@typescript/native/package.json');
    const binary = manifest.replace('app.asar/', 'app.asar.unpacked/').replace('package.json', 'lib/tsc');
    file(binary);
    const requireRuntime = Object.assign(jest.fn(() => ({})), {resolve: () => manifest});
    expect(() => loadTypeScriptRuntime(requireRuntime)).toThrow('not executable');
    expect(requireRuntime).not.toHaveBeenCalled();
    fs.chmodSync(binary, 0o755);
    expect(loadTypeScriptRuntime(requireRuntime).nativeBinary).toBe(binary);
});

test('reports a missing compiler before starting an API process on every platform', () => {
    const {loadTypeScriptRuntime} = require('../../src/utils/sdk/typeScriptRuntime');
    const requireRuntime = Object.assign(jest.fn(() => ({})), {resolve: () => path.join(root, 'native/package.json')});
    expect(() => loadTypeScriptRuntime(requireRuntime)).toThrow('missing or not executable');
    expect(requireRuntime).not.toHaveBeenCalled();
});
