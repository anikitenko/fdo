/** @jest-environment node */
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {listCodexModels} from '../../src/utils/ai/codex/codexModels';

jest.mock('node:child_process', () => ({spawn: jest.fn()}));

let child;
let messages;
beforeEach(() => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = jest.fn();
    messages = [];
    child.stdin.on('data', chunk => messages.push(JSON.parse(String(chunk))));
    spawn.mockReturnValue(child);
});
const reply = (id, result) => child.stdout.write(`${JSON.stringify({id, result})}\n`);

test('uses runtime model IDs, performs handshake, paginates and prioritizes its default', async () => {
    const pending = listCodexModels({command: '/codex', args: [], env: {FDO_TEST: 'yes'}});
    expect(messages[0].method).toBe('initialize');
    reply(1, {});
    expect(messages.slice(1).map(m => m.method)).toEqual(['initialized', 'model/list']);
    reply(2, {data: [{model: 'gpt-5.6-sol', isDefault: false}, {model: 'hidden', hidden: true}], nextCursor: 'page2'});
    expect(messages[3].params.cursor).toBe('page2');
    reply(3, {data: [{model: 'gpt-6.1-sol', isDefault: true}], nextCursor: null});
    await expect(pending).resolves.toEqual([
        {value: 'gpt-6.1-sol', label: 'gpt-6.1-sol (Recommended)', provider: 'codex-cli'},
        {value: 'gpt-5.6-sol', label: 'gpt-5.6-sol', provider: 'codex-cli'},
    ]);
    expect(child.kill).toHaveBeenCalled();
    expect(messages.some(m => /thread|turn/.test(m.method))).toBe(false);
});

test('reports catalog errors without falling back to scraped or invented models', async () => {
    const pending = listCodexModels({command: '/codex'});
    reply(1, {});
    child.stdout.write(JSON.stringify({id: 2, error: {message: 'private account data'}}) + '\n');
    await expect(pending).rejects.toThrow('Codex could not load its model catalog');
    expect(child.kill).toHaveBeenCalled();
});

test('bounds catalog loading and terminates the child on timeout', async () => {
    jest.useFakeTimers();
    try {
        const pending = listCodexModels({command: '/codex'}, {timeoutMs: 50});
        const assertion = expect(pending).rejects.toThrow('Timed out loading models');
        jest.advanceTimersByTime(50);
        await assertion;
        expect(child.kill).toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});

test('rejects invalid and empty responses', async () => {
    const pending = listCodexModels({command: '/codex'});
    reply(1, {});
    reply(2, {data: []});
    await expect(pending).rejects.toThrow('no selectable models');
});
