/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginUiLifecycleRecorder} from '../../src/utils/plugins/runtime/pluginUiLifecycleRecorder';

let directory;
beforeEach(() => {directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-ui-lifecycle-'));});
afterEach(() => {fs.rmSync(directory, {recursive: true, force: true});});

const entry = {event: 'render-deferred', reason: 'background_update', attempt: 0};
function recorder(options = {}) {
    return createPluginUiLifecycleRecorder({root: () => directory, getPlugin: id => id === 'example', trace: jest.fn(), ...options});
}

test('persists lifecycle metadata for log tails and excludes arbitrary payload fields', () => {
    const trace = jest.fn();
    expect(recorder({trace, now: () => 123})('example', {...entry, html: 'secret', token: 'secret'})).toEqual({success: true});
    const text = fs.readFileSync(path.join(directory, 'plugin-data/example/logs/host-ui.jsonl'), 'utf8');
    expect(JSON.parse(text)).toEqual({ts: 123, event: 'ui.render-deferred', reason: 'background_update', attempt: 0});
    expect(text).not.toContain('secret');
    expect(trace).toHaveBeenCalledWith('example', 'ui.render-deferred', {reason: 'background_update', attempt: 0});
});

test.each([
    ['../example', entry], ['unknown', entry], ['example', {...entry, event: 'anything'}],
    ['example', {...entry, reason: 'secret'}], ['example', {...entry, attempt: NaN}], ['.', entry],
])('rejects invalid lifecycle input without creating files: %s', (id, value) => {
    expect(recorder()(id, value).success).toBe(false);
    expect(fs.readdirSync(directory)).toEqual([]);
});

test('bounds logging rate and rotates files while retaining the previous log', () => {
    let now = 0;
    const record = recorder({now: () => now});
    for (let i = 0; i < 120; i++) expect(record('example', entry).success).toBe(true);
    expect(record('example', entry).success).toBe(false);
    const filename = path.join(directory, 'plugin-data/example/logs/host-ui.jsonl');
    fs.writeFileSync(filename, 'x'.repeat(256 * 1024));
    now = 60000;
    expect(record('example', entry).success).toBe(true);
    expect(fs.statSync(`${filename}.1`).size).toBe(256 * 1024);
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).reason).toBe('background_update');
});

test('a disk failure does not prevent the in-memory lifecycle trace', () => {
    fs.writeFileSync(path.join(directory, 'plugin-data'), 'not a directory');
    const trace = jest.fn();
    expect(recorder({trace})('example', entry)).toEqual({success: false});
    expect(trace).toHaveBeenCalledTimes(1);
});
