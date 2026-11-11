/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {syncPluginDir} from '../../src/utils/plugins/runtime/syncPluginDir';
let home;
beforeEach(async () => {home = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-directories-'));});
afterEach(async () => {await fs.rm(home, {recursive: true, force: true});});
test('round-trips empty directories and removes obsolete empty paths after a move', async () => {
    await syncPluginDir(home, [{path: '/index.ts', content: 'source'}], ['/shared/empty']);
    expect((await fs.stat(path.join(home, 'shared/empty'))).isDirectory()).toBe(true);
    await syncPluginDir(home, [{path: '/index.ts', content: 'source'}], ['/new/empty']);
    await expect(fs.stat(path.join(home, 'shared'))).rejects.toMatchObject({code: 'ENOENT'});
    expect((await fs.stat(path.join(home, 'new/empty'))).isDirectory()).toBe(true);
});
test('rejects escaping directory paths before deleting existing files', async () => {
    await fs.writeFile(path.join(home, 'keep.ts'), 'keep');
    await expect(syncPluginDir(home, [], ['../escape'])).rejects.toThrow('inside the plugin');
    expect(await fs.readFile(path.join(home, 'keep.ts'), 'utf8')).toBe('keep');
});
