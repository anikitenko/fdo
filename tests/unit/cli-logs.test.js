/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {readCliPluginLogs, followCliPluginLogs} from '../../src/utils/system/cliLogs';
let root, directory, options;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-logs-'));
    options = {profile: root, registryFile: path.join(root, 'plugins.json')};
    fs.writeFileSync(options.registryFile, JSON.stringify({plugins: [{id: 'fixture'}]}));
    directory = path.join(root, 'plugin-data', 'fixture', 'logs');fs.mkdirSync(directory, {recursive: true});
});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
test('tails logs, bounds reads, handles missing logs and rejects unknown IDs and traversal', () => {
    expect(readCliPluginLogs(options, 'fixture').logs).toEqual([]);
    fs.writeFileSync(path.join(directory, 'runtime.log'), 'one\ntwo\nthree\n');
    expect(readCliPluginLogs(options, 'fixture', 2).logs[0].text).toBe('two\nthree\n');
    expect(readCliPluginLogs(options, 'fixture', 0).logs[0].text).toBe('');
    fs.writeFileSync(path.join(directory, 'runtime.log'), 'x\n'.repeat(100000));
    const result = readCliPluginLogs(options, 'fixture', 10000).logs[0];
    expect(result.truncated).toBe(true);expect(result.text.length).toBeLessThanOrEqual(65536);
    expect(() => readCliPluginLogs(options, '../fixture')).toThrow('not found');
    expect(() => readCliPluginLogs(options, 'missing')).toThrow('not found');
});
test('follow handles appends, split UTF-8, truncation and rotation without replaying renamed logs', async () => {
    const file = path.join(directory, 'runtime.log'), signals = new EventEmitter();let tick = 0, text = '';
    fs.writeFileSync(file, 'old\n');
    const emoji = Buffer.from('😀\n');
    await followCliPluginLogs(options, 'fixture', {lines: 0, signals, write: chunk => {text += chunk;}, wait: async () => {
        tick++;
        if (tick === 1) fs.appendFileSync(file, emoji.subarray(0, 2));
        if (tick === 2) fs.appendFileSync(file, emoji.subarray(2));
        if (tick === 3) fs.writeFileSync(file, 'reset\n');
        if (tick === 4) {fs.renameSync(file, file + '.1');fs.writeFileSync(file, 'new\n');}
        if (tick === 5) signals.emit('SIGINT');
    }});
    expect(text).toContain('😀\n');expect(text).toContain('reset\n');expect(text).toContain('new\n');expect(text).not.toContain('old');expect(text).not.toContain('�');
    expect((text.match(/reset/g) || []).length).toBe(1);
    expect(signals.listenerCount('SIGINT')).toBe(0);
});
(process.platform === 'win32' ? test.skip : test)('ignores symlinked files and rejects symlinked log directories', () => {
    const outside = path.join(root, 'secret');fs.writeFileSync(outside, 'not logs');fs.symlinkSync(outside, path.join(directory, 'link'));
    expect(readCliPluginLogs(options, 'fixture').logs).toEqual([]);
    fs.rmSync(directory, {recursive: true});fs.symlinkSync(root, directory);
    expect(() => readCliPluginLogs(options, 'fixture')).toThrow('regular directories');
});
