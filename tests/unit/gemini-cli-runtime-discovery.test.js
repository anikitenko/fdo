/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {lookpath} from 'lookpath';
import {resolveGeminiCliInvocation} from '../../src/utils/ai/generation/geminiCli';

jest.mock('lookpath', () => ({lookpath: jest.fn()}));
jest.mock('electron', () => ({app: {isPackaged: true}}));
jest.mock('node:child_process', () => {
    const execFile = jest.fn(); execFile[require('node:util').promisify.custom] = jest.fn(async () => ({stdout: '0.60.0\n'}));
    return {execFile, spawn: jest.fn()};
});
let root;
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-external-gemini-'));});
afterEach(() => {fs.rmSync(root, {recursive: true, force: true});});

test('does not fall back to an FDO bundle when the separate tool is missing', async () => {
    lookpath.mockResolvedValueOnce(undefined);
    await expect(resolveGeminiCliInvocation()).rejects.toThrow('separate tool and is not bundled');
});

test('npm Windows shim resolves to its declared JS entry point without cmd.exe', async () => {
    const shim = path.join(root, 'gemini.cmd'); fs.writeFileSync(shim, '@echo off');
    const packageRoot = path.join(root, 'node_modules', '@google', 'gemini-cli');
    fs.mkdirSync(path.join(packageRoot, 'bundle'), {recursive: true});
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({name: '@google/gemini-cli', bin: {gemini: 'bundle/gemini.js'}}));
    const script = path.join(packageRoot, 'bundle', 'gemini.js'); fs.writeFileSync(script, '// external');
    const invocation = await resolveGeminiCliInvocation({configuredPath: shim});
    expect(invocation).toMatchObject({command: process.execPath, args: [fs.realpathSync(script)], source: 'configured', bundled: false, version: '0.60.0', env: {ELECTRON_RUN_AS_NODE: '1'}});
});

test('POSIX symlink discovers the separately installed JavaScript entry point', async () => {
    const script = path.join(root, 'gemini.js'), link = path.join(root, 'gemini');
    fs.writeFileSync(script, '// external'); fs.symlinkSync(script, link);
    lookpath.mockResolvedValueOnce(link);
    expect(await resolveGeminiCliInvocation()).toMatchObject({command: process.execPath, args: [fs.realpathSync(script)], bundled: false, source: 'path'});
});

test.each(['darwin', 'linux', 'win32'])('external Gemini authentication launcher handles runtime environment and paths on %s', async platform => {
    const {EventEmitter} = require('node:events');
    const {spawn} = require('node:child_process');
    const {startGeminiLogin} = require('../../src/utils/ai/generation/geminiCli');
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {value: platform});
    spawn.mockImplementation(() => {const child = new EventEmitter(); Promise.resolve().then(() => child.emit('spawn')); return child;});
    try {
        const invocation = {command: "/FDO with spaces/app", args: ["/User's tools/gemini.js"], env: {ELECTRON_RUN_AS_NODE: '1'}};
        expect(await startGeminiLogin(invocation)).toMatchObject({started: true, mode: 'terminal'});
        const [command, args] = spawn.mock.lastCall;
        if (platform === 'win32') {
            expect(command).toBe('powershell.exe');
            const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
            expect(script).toContain("$env:ELECTRON_RUN_AS_NODE='1'");
            expect(script).toContain("'/User''s tools/gemini.js'");
        } else expect(args.join(' ')).toContain('ELECTRON_RUN_AS_NODE=1');
    } finally {Object.defineProperty(process, 'platform', original);}
});
