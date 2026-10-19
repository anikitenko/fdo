/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {listCliProfiles} from '../../src/utils/system/cliProfiles';
let root;
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-profiles-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
test('lists default and named profiles without initializing their stores, and isolates corrupt registries', () => {
    const named = path.join(root, 'profiles', 'development');fs.mkdirSync(named, {recursive: true});
    fs.writeFileSync(path.join(named, 'plugins.json'), JSON.stringify({plugins: [{id: 'one'}]}));
    const broken = path.join(root, 'profiles', 'broken');fs.mkdirSync(broken);fs.writeFileSync(path.join(broken, 'plugins.json'), 'broken');
    fs.mkdirSync(path.join(root, 'profiles', 'INVALID'));
    expect(listCliProfiles(root, 'development')).toEqual([
        {name: 'default', directory: root, current: false, pluginCount: 0},
        expect.objectContaining({name: 'broken', pluginCount: null, error: expect.any(String)}),
        {name: 'development', directory: named, current: true, pluginCount: 1},
    ]);
    expect(fs.existsSync(path.join(root, 'plugins.json'))).toBe(false);
    expect(fs.existsSync(path.join(named, 'settings.json'))).toBe(false);
});
