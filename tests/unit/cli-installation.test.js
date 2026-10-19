/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createWrapperScript, installCli, removeCli, cliExecutable, inspectCliInstallation} from '../../src/utils/system/installFDOCLI';
jest.mock('electron', () => ({app: {getPath: () => require('node:os').tmpdir()}}));
jest.mock('../../src/utils/system/runWithSudo', () => ({runWithSudo: jest.fn()}));
let root, options;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-installation-'));
    options = {osType: process.platform === 'win32' ? 'win32' : 'linux', paths: {primary: path.join(root, 'bin', process.platform === 'win32' ? 'fdo.cmd' : 'fdo'), fallbacks: [path.join(root, 'fallback', 'fdo')]}, executable: '/new/FDO', application: '/workspace/fdo', packaged: true, elevate: jest.fn(), updatePath: jest.fn()};
});
afterEach(() => {fs.rmSync(root, {recursive:true,force:true});});
test('installation creates missing directories, repairs a moved app, and is idempotent', async () => {
    expect(await installCli(options)).toMatchObject({success:true,skipped:false,developmentMode:false});
    expect(fs.readFileSync(options.paths.primary,'utf8')).toContain('/new/FDO');
    expect(await installCli(options)).toMatchObject({success:true,skipped:true});
    expect(await installCli({...options, executable:'/moved/FDO'})).toMatchObject({success:true,updated:true});
    expect(fs.readFileSync(options.paths.primary,'utf8')).toContain('/moved/FDO');
    expect(options.elevate).not.toHaveBeenCalled();
});
test('recognizes the old wrapper template and repairs it without relying on app folder names', async () => {
    const legacy = '#!/bin/bash\n# If no arguments provided, show help\nif [ $# -eq 0 ]; then\n  exec "/old/FDO" --help\nelse\n  exec "/old/FDO" "$@"\nfi\n';
    fs.mkdirSync(path.dirname(options.paths.primary));fs.writeFileSync(options.paths.primary,legacy);
    expect(await installCli(options)).toMatchObject({success:true,updated:true});
    expect(fs.readFileSync(options.paths.primary,'utf8')).not.toContain('/old/FDO');
});
test('uninstall removes all managed wrappers and preserves unrelated files', async () => {
    await installCli(options);
    fs.mkdirSync(path.dirname(options.paths.fallbacks[0]));fs.copyFileSync(options.paths.primary,options.paths.fallbacks[0]);
    const unrelated=path.join(root,'another-fdo');fs.writeFileSync(unrelated,'user executable');
    const paths={...options.paths,fallbacks:[...options.paths.fallbacks,unrelated]};
    const result=await removeCli({...options,paths});expect(result.success).toBe(true);expect(result.paths).toHaveLength(2);
    expect(fs.readFileSync(unrelated,'utf8')).toBe('user executable');
    expect((await removeCli(options)).notFound).toBe(true);
    expect(await removeCli({...options,paths:{primary:unrelated,fallbacks:[]}})).toMatchObject({success:false});
});
test('never overwrites an unrelated command', async () => {
    fs.mkdirSync(path.dirname(options.paths.primary));fs.writeFileSync(options.paths.primary,'unrelated command');
    expect(await installCli({...options,paths:{...options.paths,fallbacks:[]}})).toMatchObject({success:false});
    expect(fs.readFileSync(options.paths.primary,'utf8')).toBe('unrelated command');
});
(process.platform === 'win32' ? test.skip : test)('Unix wrapper preserves literal paths, operands and the executable exit code', () => {
    const executable = path.join(root, "tool ' $variable (test)");
    fs.writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n',{mode:0o755});
    const wrapper = path.join(root,'fdo');
    fs.writeFileSync(wrapper,createWrapperScript(executable,"workspace ' $value",'linux',true));
    const result=spawnSync('/bin/sh',[wrapper,'compile','a folder','--label','work'],{encoding:'utf8'});
    expect(result.status).toBe(7);expect(result.stdout.split('\n')).toEqual(["workspace ' $value",'compile','a folder','--label','work','']);
    expect(spawnSync('/bin/sh',[wrapper],{encoding:'utf8'}).stdout).toContain('--help');
});
test('Windows wrapper disables expansion, escapes percent paths, and preserves child status', () => {
    const script=createWrapperScript('C:\\Apps\\FDO %preview%!\\FDO.exe','C:\\project','win32',false);
    expect(script).toContain('DisableDelayedExpansion');expect(script).toContain('FDO %%preview%%!');
    expect(script).toContain('exit /b %errorlevel%');expect(script).not.toContain('"C:\\project"');
});
test('PATH update failures are reported and retried for an unchanged Windows wrapper', async () => {
    const updatePath=jest.fn().mockImplementationOnce(()=>{throw new Error('policy blocked');});
    const windows={...options,osType:'win32',updatePath};
    expect(await installCli(windows)).toMatchObject({success:true,warning:expect.stringContaining('policy blocked')});
    expect(await installCli(windows)).toMatchObject({success:true,skipped:true});expect(updatePath).toHaveBeenCalledTimes(2);
});


test('packaged AppImage wrappers target the persistent image instead of its temporary mount', () => {
    const image = path.join(root, 'FDO.AppImage');fs.writeFileSync(image, 'app image');
    expect(cliExecutable({osType:'linux',packaged:true,executable:'/tmp/.mount_fdo/fdo',appImage:image})).toBe(fs.realpathSync(image));
    expect(cliExecutable({osType:'linux',packaged:false,executable:'/dev/electron',appImage:image})).toBe('/dev/electron');
});

test('doctor installation checks distinguish current wrappers, PATH conflicts and stale targets', async () => {
    expect(await inspectCliInstallation(options, async () => undefined)).toMatchObject({current: false, inPath: false});
    await installCli(options);
    expect(await inspectCliInstallation(options, async () => options.paths.primary)).toMatchObject({current: true, inPath: true});
    expect(await inspectCliInstallation(options, async () => path.join(root, 'other-fdo'))).toMatchObject({current: true, inPath: false});
    expect(await inspectCliInstallation({...options, executable: '/moved/FDO'}, async () => options.paths.primary)).toMatchObject({current: false, inPath: false});
});
