/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveCodexCliInvocation} from '../../src/utils/ai/codex/codexCli';

jest.mock('electron', () => ({app: {isPackaged: false}}));
jest.mock('lookpath', () => ({lookpath: jest.fn(async () => '/external/codex')}));
jest.mock('node:child_process', () => {
    const execFile = jest.fn();
    execFile[require('node:util').promisify.custom] = jest.fn(async () => ({stdout: 'codex 0.154.0\n--sandbox --skip-git-repo-check --json', stderr: ''}));
    return {execFile, spawn: jest.fn()};
});

test('development discovery selects the installed native package before PATH', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-codex-discovery-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    const {lookpath} = require('lookpath');
    try {
        const packageRoot = path.join(root, 'node_modules', '@openai', 'codex');
        const platformRoot = path.join(root, 'node_modules', '@openai', `codex-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`);
        fs.mkdirSync(path.join(packageRoot, 'bin'), {recursive: true});
        fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({name: '@openai/codex', version: '0.154.0'}));
        fs.writeFileSync(path.join(packageRoot, 'bin', 'codex.js'), '// wrapper');
        fs.mkdirSync(path.join(root, 'node_modules', '.bin'), {recursive: true});
        fs.symlinkSync(path.join(packageRoot, 'bin', 'codex.js'), path.join(root, 'node_modules', '.bin', 'codex'));
        const binaryDir = path.join(platformRoot, 'vendor', 'test-platform', 'bin');
        fs.mkdirSync(binaryDir, {recursive: true});
        const binary = path.join(binaryDir, process.platform === 'win32' ? 'codex.exe' : 'codex');
        fs.writeFileSync(binary, 'native fixture');
        const invocation = await resolveCodexCliInvocation();
        expect(invocation.source).toBe('bundled');
        expect(invocation.bundled).toBe(true);
        expect(invocation.command).toBe(fs.realpathSync(binary));
        expect(invocation.args).toEqual([]);
        expect(lookpath).not.toHaveBeenCalled();
    } finally {
        cwd.mockRestore();
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test.each(['darwin', 'linux', 'win32'])('integrated package selection maps x64 and arm64 on %s', platform => {
    const {getBundledPlatformPackageName} = require('../../src/utils/ai/codex/codexCli');
    expect(getBundledPlatformPackageName(platform, 'x64')).toBe(`codex-${platform}-x64`);
    expect(getBundledPlatformPackageName(platform, 'arm64')).toBe(`codex-${platform}-arm64`);
});

test('packaging blocks missing target binaries rather than silently requiring a separate Codex install', async () => {
    const check = require('../../scripts/check-bundled-codex-runtime.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-codex-package-'));
    try {
        await expect(check({appDir: root, electronPlatformName: 'win32', arch: 'x64'})).rejects.toThrow('Missing integrated Codex runtime');
        const binary = path.join(root, 'dist', 'main', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
        fs.mkdirSync(path.dirname(binary), {recursive: true}); fs.writeFileSync(binary, 'fixture');
        await expect(check({appDir: root, electronPlatformName: 'win32', arch: 'x64'})).rejects.toThrow('code-mode helper');
        fs.writeFileSync(path.join(path.dirname(binary), 'codex-code-mode-host.exe'), 'host-fixture');
        const compiler = path.join(root, 'dist/main/node_modules/@typescript/typescript-win32-x64/lib/tsc.exe');
        fs.mkdirSync(path.dirname(compiler), {recursive: true}); fs.writeFileSync(compiler, 'compiler-fixture');
        await expect(check({appDir: root, electronPlatformName: 'win32', arch: 'x64'})).resolves.toBeUndefined();
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
