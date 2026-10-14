import {EventEmitter} from 'node:events';
import {ipcMain} from 'electron';
import {reviewGeneratedGuide, registerAiCodingAgentHandlers} from '../../src/ipc/ai_coding_agent';
import {AiCodingAgentChannels} from '../../src/ipc/channels';

jest.mock('electron', () => ({ipcMain: {handle: jest.fn()}, app: {isPackaged: false}}));

jest.mock('../../src/utils/sdk/installedSdkValidation', () => ({createInstalledSdkValidator: () => {
    const validator = jest.fn(() => []);
    validator.report = () => ({fingerprint: 'a'.repeat(64), sdkVersion: '1.5.2', findings: []});
    validator.capabilities = {fingerprint: 'a'.repeat(64)};
    return validator;
}}));

const originalEnv = {FDO_E2E: process.env.FDO_E2E, FDO_E2E_LIVE_AI: process.env.FDO_E2E_LIVE_AI};
afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});
const makeEvent = () => ({sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}),
    senderFrame: {isDestroyed: () => false, detached: false, send: jest.fn()}});

test.each([{}, {FDO_E2E: '1'}, {FDO_E2E_LIVE_AI: '1'}])('manual generation waits for editable human approval with environment %j', async env => {
    delete process.env.FDO_E2E;
    delete process.env.FDO_E2E_LIVE_AI;
    Object.assign(process.env, env);
    registerAiCodingAgentHandlers();
    const approve = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.REVIEW_SKILL)[1];
    const event = makeEvent();
    let completed = false;
    const requestId = `guide-${JSON.stringify(env)}`;
    const pending = reviewGeneratedGuide(event, requestId, {path: '/SKILL.md', content: '# Draft guide\nPurpose.'})
        .then(content => {completed = true; return content;});
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(event.senderFrame.send.mock.calls.some(([, data]) => data.type === 'skill-review')).toBe(true);
    expect(await approve(event, {requestId, content: '# Human edited guide\nApproved conventions.'})).toMatchObject({success: true});
    expect(await pending).toContain('# Human edited guide');
});

test('only the isolated automated live-test environment skips the approval dialog', async () => {
    process.env.FDO_E2E = '1';
    process.env.FDO_E2E_LIVE_AI = '1';
    const event = makeEvent();
    expect(await reviewGeneratedGuide(event, 'automatic-guide', {path: '/SKILL.md', content: '# Tested guide\nPurpose.'}))
        .toContain('fdo-sdk-fingerprint');
    expect(event.senderFrame.send.mock.calls.some(([, data]) => data.type === 'skill-review')).toBe(false);
});
