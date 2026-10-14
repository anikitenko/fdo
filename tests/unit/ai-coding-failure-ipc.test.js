import {EventEmitter} from 'node:events';
import {ipcMain} from 'electron';
import {registerAiCodingAgentHandlers} from '../../src/ipc/ai_coding_agent';
import {AiCodingAgentChannels} from '../../src/ipc/channels';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
import {createCodingGenerationFailure} from '../../src/utils/ai/assistant/aiCodingFailure';

jest.mock('electron', () => ({ipcMain: {handle: jest.fn()}, app: {isPackaged: false}}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(() => [{id: 'test', provider: 'openrouter', model: 'test-model'}])}}));
jest.mock('../../src/utils/sdk/installedSdkValidation', () => ({createInstalledSdkValidator: () => {
    const validate = () => []; validate.capabilities = {sdkVersion: 'test', fingerprint: 'test'}; validate.report = () => ({findings: []}); return validate;
}}));
jest.mock('../../src/utils/ai/generation/codingWorkspaceGeneration', () => ({generateStagedWorkspace: jest.fn(), useStagedWorkspaceGeneration: () => true}));

test('terminal generator failure crosses both stream and invoke boundaries without parsing wording', async () => {
    const error = createCodingGenerationFailure('A completely different error message', {path: '/plugin/lifecycle-styles.ts', completedFileCount: 4, pendingFileCount: 2});
    generateStagedWorkspace.mockRejectedValueOnce(error);
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.PLAN_CODE)[1];
    const sender = Object.assign(new EventEmitter(), {isDestroyed: () => false});
    const event = {sender, senderFrame: {isDestroyed: () => false, detached: false, send: jest.fn()}};
    const result = await handler(event, {requestId: 'structured-failure', assistantId: 'test', prompt: 'Build plugin', workspaceFiles: []});
    expect(result).toMatchObject({success: false, requestId: 'structured-failure', error: error.message, failure: error.failure});
    const payload = event.senderFrame.send.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.on_off.STREAM_ERROR)[1];
    expect(payload).toMatchObject({requestId: 'structured-failure', error: error.message, failure: error.failure});
});

// Exercise checkpoint admission and IPC with real atomic storage, without provider inference.
test('IPC persists progress and resumes it after a new store instance; newer edits block resume', async () => {
    const fs = require('node:fs/promises');
    const os = require('node:os');
    const path = require('node:path');
    const {app} = require('electron');
    const {createGenerationCheckpointStore} = require('../../src/utils/ai/generation/codingGenerationCheckpoint');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-checkpoint-ipc-'));
    app.getPath = () => directory;
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.PLAN_CODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {isDestroyed: () => false, detached: false, send: jest.fn()}};
    const workspaceId = 'checkpoint-plugin';
    const baseline = [{path: '/existing.ts', content: 'export const existing = 1;'}];
    try {
        generateStagedWorkspace.mockImplementationOnce(async options => {
            await options.onCheckpoint({completed: [{path: '/a.ts', contract: 'Export a', content: 'export const a = 1;'}], pending: [{path: '/b.ts', contract: 'Export b'}], plan: [{path: '/a.ts', contract: 'Export a'}, {path: '/b.ts', contract: 'Export b'}]});
            throw createCodingGenerationFailure('Output exhausted', {path: '/b.ts'});
        });
        const result = await handler(event, {requestId: 'first-checkpoint', assistantId: 'test', workspaceId, workspaceFiles: baseline, prompt: 'Build helpers', userRequirements: 'Build helpers'});
        expect(result.failure).toMatchObject({resumable: true, recoveryActions: ['resume', 'smaller-scope']});
        const saved = await createGenerationCheckpointStore(path.join(directory, 'ai-generation-checkpoints')).load(workspaceId);
        expect(saved.id).toBe(result.failure.checkpointId);
        expect(saved.completed[0].content).toBe('export const a = 1;');
        const count = generateStagedWorkspace.mock.calls.length;
        const changed = await handler(event, {requestId: 'changed-workspace', assistantId: 'test', workspaceId, checkpointId: saved.id, recoveryMode: 'resume', workspaceFiles: [], prompt: 'Build helpers', userRequirements: 'Build helpers'});
        expect(changed.error).toContain('workspace has changed');
        expect(generateStagedWorkspace).toHaveBeenCalledTimes(count);
        generateStagedWorkspace.mockImplementationOnce(async options => {
            expect(options.resumeCheckpoint.completed[0].path).toBe('/a.ts');
            return '### File: /a.ts\n```typescript\nexport const a = 1;\n```\n\n### File: /b.ts\n```typescript\nexport const b = 2;\n```';
        });
        const resumed = await handler(event, {requestId: 'resumed-checkpoint', assistantId: 'test', workspaceId, checkpointId: saved.id, recoveryMode: 'resume', workspaceFiles: baseline, prompt: 'Build helpers', userRequirements: 'Build helpers'});
        expect(resumed.success).toBe(true);
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});
