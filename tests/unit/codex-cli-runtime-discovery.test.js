/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveCodexCliInvocation} from '../../src/utils/ai/codex/codexCli';

jest.mock('electron', () => ({app: {isPackaged: false}}));
jest.mock('lookpath', () => ({lookpath: jest.fn(async () => '/external/codex')}));
jest.mock('node:child_process', () => {
    const execFile = jest.fn();
    execFile[require('node:util').promisify.custom] = jest.fn(async () => ({stdout: 'codex 0.162.1\n--sandbox --model --skip-git-repo-check --json', stderr: ''}));
    return {execFile, spawn: jest.fn()};
});

test('discovery follows the local npm launcher to its native package', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-codex-discovery-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    const {lookpath} = require('lookpath');
    try {
        const packageRoot = path.join(root, 'node_modules', '@openai', 'codex');
        const platformRoot = path.join(root, 'node_modules', '@openai', `codex-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`);
        fs.mkdirSync(path.join(packageRoot, 'bin'), {recursive: true});
        fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({name: '@openai/codex', version: '0.162.1'}));
        fs.writeFileSync(path.join(packageRoot, 'bin', 'codex.js'), '// wrapper');
        fs.mkdirSync(path.join(root, 'node_modules', '.bin'), {recursive: true});
        const launcher = path.join(packageRoot, 'bin', 'codex.js');
        const binaryDir = path.join(platformRoot, 'vendor', 'test-platform', 'bin');
        fs.mkdirSync(binaryDir, {recursive: true});
        const binary = path.join(binaryDir, process.platform === 'win32' ? 'codex.exe' : 'codex');
        fs.writeFileSync(binary, Buffer.from(process.platform === 'darwin' ? 'cffaedfe' : process.platform === 'linux' ? '7f454c46' : '4d5a0000', 'hex'));
        lookpath.mockResolvedValue(launcher);
        const invocation = await resolveCodexCliInvocation();
        expect(invocation.source).toBe('path');
        expect(invocation.bundled).toBe(false);
        expect(invocation.command).toBe(fs.realpathSync(binary));
        expect(invocation.args).toEqual([]);
        expect(lookpath).toHaveBeenCalledWith("codex");
    } finally {
        cwd.mockRestore();
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test.each(['darwin', 'linux', 'win32'])('integrated package selection maps x64 and arm64 on %s', platform => {
    const {getCodexPlatformPackageName} = require('../../src/utils/ai/codex/codexCli');
    expect(getCodexPlatformPackageName(platform, 'x64')).toBe(`codex-${platform}-x64`);
    expect(getCodexPlatformPackageName(platform, 'arm64')).toBe(`codex-${platform}-arm64`);
});
