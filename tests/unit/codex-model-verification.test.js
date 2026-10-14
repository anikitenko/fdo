/** @jest-environment node */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyCodexModelAccess} from '../../src/utils/ai/codex/codexCli';

jest.mock('electron', () => ({app: {isPackaged: false}}));
jest.mock('lookpath', () => ({lookpath: jest.fn()}));
jest.mock('node:child_process', () => {
    const execFile = jest.fn();
    execFile[require('node:util').promisify.custom] = jest.fn();
    return {execFile, spawn: jest.fn()};
});

test.each([
    [{stderr: 'model: gpt-5.6\nrequest timed out', killed: true}, 'Timed out while verifying'],
    [{stderr: 'model: gpt-5.6\nNetwork connection failed'}, 'Codex model verification failed'],
    [{stderr: "The model gpt-5.6 is not supported with this account"}, 'Codex could not use model'],
])('distinguishes model rejection from other CLI failures: %j', async (error, message) => {
    execFile[promisify.custom].mockRejectedValueOnce(error);
    const result = await verifyCodexModelAccess({command: '/codex', execCapabilities: {supportsModel: true}}, 'gpt-5.6');
    expect(result.ok).toBe(false);
    expect(result.message).toContain(message);
});
