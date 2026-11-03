import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runPermissionProbe, assertPermissionProbe} from '../fixtures/plugin-permission-probe.cjs';

jest.mock('electron', () => ({app: {getPath: () => '/tmp'}}));
import {buildPluginRuntimeBootstrapSource, buildPluginRuntimePolicy} from '../../src/utils/plugins/security/pluginRuntimeSecurity';

test('generated runtime enforces builtin and filesystem policies without breaking plugin data writes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-permissions-'));
    try {
        const home = path.join(root, 'home'), outside = path.join(root, 'outside');
        fs.mkdirSync(home); fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(home, 'preexisting-outside-link'), 'junction');
        fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'unchanged');
        const bootstrap = path.join(root, 'bootstrap.cjs'), entry = path.join(root, 'entry.cjs');
        fs.writeFileSync(bootstrap, buildPluginRuntimeBootstrapSource());
        fs.writeFileSync(entry, `(${runPermissionProbe.toString()})(${JSON.stringify(outside)}).then(result => process.stdout.write(JSON.stringify(result))).catch(error => {console.error(error);process.exitCode = 1;});`);
        const execution = spawnSync(process.execPath, [bootstrap], {
            encoding: 'utf8', timeout: 15000,
            env: {...process.env, PLUGIN_HOME: home, PLUGIN_CODE_HOME: root,
                FDO_PLUGIN_RUNTIME_ENTRY: entry, FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT: '1',
                FDO_PLUGIN_POLICY_JSON: JSON.stringify(buildPluginRuntimePolicy([])), FDO_PLUGIN_CAPABILITIES: ''},
        });
        expect({status: execution.status, stderr: execution.stderr}).toEqual({status: 0, stderr: ''});
        assertPermissionProbe(JSON.parse(execution.stdout), expect);
        expect(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged');
        expect(fs.readdirSync(outside)).toEqual(['sentinel.txt']);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
