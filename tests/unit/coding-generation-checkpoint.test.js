import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGenerationCheckpointStore, generationCheckpointSummary} from '../../src/utils/ai/generation/codingGenerationCheckpoint';

let directory;
beforeEach(async () => {directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-checkpoints-'));});
afterEach(async () => {await fs.rm(directory, {recursive: true, force: true});});
const baseline = [{path: '/old.ts', content: 'export const old = 1;'}];

test('atomic private checkpoints survive a fresh store instance without modifying workspace', async () => {
    const store = createGenerationCheckpointStore(directory);
    const value = store.create({workspaceId: 'plugin/workspace', workspaceFiles: baseline, prompt: 'full prompt', requirements: 'Build plugin', sdkFingerprint: 'sdk'});
    Object.assign(value, {completed: [{path: '/a.ts', contract: 'Export a', content: 'export const a = 1;'}], pending: [{path: '/b.ts', contract: 'Export b'}], plan: [{path: '/a.ts', contract: 'Export a'}, {path: '/b.ts', contract: 'Export b'}]});
    await store.save(value);
    const loaded = await createGenerationCheckpointStore(directory).load('plugin/workspace');
    expect(loaded).toEqual(value);
    expect(generationCheckpointSummary(loaded, baseline, 'sdk')).toMatchObject({canResume: true, completedFileCount: 1, pendingFileCount: 1});
    expect(generationCheckpointSummary(loaded, [{path: '/old.ts', content: 'newer edits'}], 'sdk')).toMatchObject({canResume: false});
    expect(generationCheckpointSummary(loaded, baseline, 'new-sdk')).toMatchObject({canResume: false});
    expect(await store.load('different workspace')).toBeNull();
    const entries = await fs.readdir(directory);
    expect(entries).toHaveLength(1);
    expect((await fs.stat(path.join(directory, entries[0]))).mode & 0o777).toBe(0o600);
    expect(baseline[0].content).toBe('export const old = 1;');
    await expect(store.discard('plugin/workspace', 'wrong-id')).rejects.toThrow('changed');
    await store.discard('plugin/workspace', loaded.id);
    expect(await store.load('plugin/workspace')).toBeNull();
});

test('rejects corrupt checkpoints and unsafe paths instead of resuming them', async () => {
    const store = createGenerationCheckpointStore(directory);
    const value = store.create({workspaceId: 'plugin', workspaceFiles: [], prompt: 'Build', requirements: 'Build', sdkFingerprint: 'sdk'});
    value.pending = [{path: '../host.ts', contract: 'Unsafe'}];
    await expect(store.save(value)).rejects.toThrow('Invalid checkpoint');
});
