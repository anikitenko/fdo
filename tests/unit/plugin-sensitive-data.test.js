import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildPluginWorkerEnvironment} from '../../src/utils/plugins/security/pluginWorkerEnvironment';
import {runSensitiveDataProbe, assertSensitiveDataProbe} from '../fixtures/plugin-sensitive-data-probe.cjs';
jest.mock('electron', () => ({app: {getPath: () => '/tmp'}}));
import {buildPluginRuntimeBootstrapSource, buildPluginRuntimePolicy} from '../../src/utils/plugins/security/pluginRuntimeSecurity';

test('plain Node policy probes never import the Electron npm package as a parent-port fallback',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-node-parent-port-'));
    try {
        fs.mkdirSync(path.join(root,'node_modules/electron'),{recursive:true});
        const marker=path.join(root,'electron-imported');
        fs.writeFileSync(path.join(root,'node_modules/electron/index.js'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');throw new Error('Electron installer must not run');`);
        const bootstrap=path.join(root,'bootstrap.cjs'),entry=path.join(root,'entry.cjs');
        fs.writeFileSync(bootstrap,buildPluginRuntimeBootstrapSource());fs.writeFileSync(entry,"process.stdout.write('plain-node-worker-ready');");
        const env=buildPluginWorkerEnvironment({pluginHome:root,pluginCodeHome:root,runtimeEntry:entry,bootstrapEntry:bootstrap,nodeModulesPath:path.join(root,'node_modules'),runtimePolicy:buildPluginRuntimePolicy([]),hostEnv:{}});
        fs.mkdirSync(env.TMPDIR,{recursive:true});
        const result=spawnSync(process.execPath,[bootstrap],{encoding:'utf8',timeout:10000,env:{...env,FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT:'1'}});
        expect({status:result.status,stderr:result.stderr,stdout:result.stdout}).toEqual({status:0,stderr:'',stdout:'plain-node-worker-ready'});
        expect(fs.existsSync(marker)).toBe(false);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('worker environment is allowlisted, redirects home/temp and excludes host secrets and loader injection', () => {
    const env = buildPluginWorkerEnvironment({pluginHome: '/data/plugin', pluginCodeHome: '/code/plugin', runtimeEntry: '/cache/plugin/index.cjs', bootstrapEntry: '/cache/plugin/bootstrap.cjs', nodeModulesPath: '/app/node_modules', runtimePolicy: {}, hostEnv: {
        HOME: '/users/real', PATH: '/users/real/bin', AWS_SECRET_ACCESS_KEY: 'synthetic', OPENAI_API_KEY: 'synthetic',
        NODE_OPTIONS: '--require=/host/injection.cjs', NODE_EXTRA_CA_CERTS: '/host/private.pem', SSH_AUTH_SOCK: '/host/agent',
        HTTPS_PROXY: 'https://user:synthetic@example.invalid', DYLD_INSERT_LIBRARIES: '/host/injection.dylib', LANG: 'en_US.UTF-8', TZ: 'UTC',
    }});
    expect(env.HOME).toBe('/data/plugin');expect(env.TMPDIR).toBe('/data/plugin/.tmp');
    expect(env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');expect(env.LANG).toBe('en_US.UTF-8');
    for (const key of ['AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSH_AUTH_SOCK', 'HTTPS_PROXY', 'DYLD_INSERT_LIBRARIES']) expect(env[key]).toBeUndefined();
    expect(JSON.parse(env.FDO_PLUGIN_READ_ROOTS)).toEqual(['/data/plugin', '/code/plugin', '/cache/plugin', '/app/node_modules']);
});

test('Windows workers retain system paths while redirecting profile and application-data folders', () => {
    const env = buildPluginWorkerEnvironment({platform: 'win32', pluginHome: 'C:\\data\\plugin', pluginCodeHome: 'C:\\code\\plugin', runtimeEntry: 'C:\\cache\\plugin\\index.cjs', bootstrapEntry: 'C:\\cache\\plugin\\bootstrap.cjs', nodeModulesPath: 'C:\\app\\node_modules', runtimePolicy: {}, hostEnv: {SYSTEMROOT: 'C:\\Windows', APPDATA: 'C:\\Users\\real\\AppData', USERPROFILE: 'C:\\Users\\real'}});
    expect(env.SystemRoot).toBe('C:\\Windows');expect(env.PATH).toBe('C:\\Windows\\System32;C:\\Windows');
    expect(env.USERPROFILE).toBe('C:\\data\\plugin');expect(env.APPDATA).toBe('C:\\data\\plugin\\AppData\\Roaming');
});

test('real bootstrap prevents sensitive reads and environment inheritance while allowing own assets and data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-sensitive-data-'));
    try {
        const home = path.join(root, 'home'), code = path.join(root, 'code'), cache = path.join(root, 'cache');
        const outside = path.join(root, 'host-private'), sibling = path.join(root, 'sibling');
        for (const directory of [home, code, cache, outside, sibling]) fs.mkdirSync(directory);
        fs.mkdirSync(path.join(home, '.tmp'));fs.mkdirSync(path.join(outside, '.aws'));fs.mkdirSync(path.join(outside, '.ssh'));
        fs.writeFileSync(path.join(outside, 'settings.json'), '{"synthetic":"private"}');
        fs.writeFileSync(path.join(sibling, 'settings.json'), '{"synthetic":"sibling"}');
        fs.writeFileSync(path.join(outside, '.aws/credentials'), 'synthetic-aws');
        fs.writeFileSync(path.join(outside, '.ssh/id_ed25519'), 'synthetic-ssh');
        fs.writeFileSync(path.join(outside, 'secret.cjs'), 'module.exports = "synthetic-secret";');
        fs.symlinkSync(outside, path.join(home, 'sensitive-link'), 'junction');
        fs.writeFileSync(path.join(code, 'package.json'), '{"name":"test-plugin"}');
        fs.mkdirSync(path.join(code, 'dist'));fs.writeFileSync(path.join(code, 'dist', 'index.cjs'), '// synthetic signed asset');
        const bootstrap = path.join(cache, 'bootstrap.cjs'), entry = path.join(cache, 'index.cjs');
        fs.writeFileSync(bootstrap, buildPluginRuntimeBootstrapSource());
        fs.writeFileSync(entry, `(${runSensitiveDataProbe.toString()})(${JSON.stringify(outside)},${JSON.stringify(sibling)}).then(result => process.stdout.write(JSON.stringify(result))).catch(error => {console.error(error);process.exitCode=1;});`);
        const env = buildPluginWorkerEnvironment({pluginHome: home, pluginCodeHome: code, runtimeEntry: entry, bootstrapEntry: bootstrap, nodeModulesPath: path.join(root, 'public-dependencies'), runtimePolicy: buildPluginRuntimePolicy([]), hostEnv: {OPENAI_API_KEY: 'synthetic-private'}});
        const execution = spawnSync(process.execPath, [bootstrap], {encoding: 'utf8', timeout: 15000, env: {...env, FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT: '1'}});
        expect({status: execution.status, stderr: execution.stderr}).toEqual({status: 0, stderr: ''});
        assertSensitiveDataProbe(JSON.parse(execution.stdout), expect);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
