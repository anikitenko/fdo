/** @jest-environment node */
import {registerGitOpsHandlers} from '../../src/ipc/gitops';
import {SettingsChannels} from '../../src/ipc/channels';

const input = {url: 'https://github.com/acme/tools', authType: 'basic', username: 'alice', password: 'alice-secret', manifestPath: 'plugins.yaml', revisionType: 'branch', targetRevision: 'main'};
const verified = {manifest: {metadata: {name: 'tools', version: '1.0.0'}, spec: {plugins: [{name: 'example', repository: 'https://github.com/acme/example', targetRevision: 'main', path: '/'}]}}, commit: 'a'.repeat(40), verifiedAt: '2026-10-17T12:00:00.000Z'};
let handlers, invoke, store, safeStorage, verify, event, sync, detach, controller, report;
beforeEach(() => {
    handlers = {};
    store = [];
    const frame = {};
    const webContents = {mainFrame: frame};
    event = {sender: webContents, senderFrame: frame};
    const secrets = new Map();
    safeStorage = {
        isEncryptionAvailable: jest.fn(() => true),
        getSelectedStorageBackend: jest.fn(() => 'gnome_libsecret'),
        encryptString: jest.fn(value => {const key = `encrypted-${secrets.size}`; secrets.set(key, value); return Buffer.from(key);}),
        decryptString: jest.fn(value => secrets.get(value.toString())),
    };
    verify = jest.fn(async () => verified);
    sync = jest.fn(async () => ({lastSyncedAt: '2026-10-17T12:00:01Z', installedPlugins: []}));
    detach = jest.fn(async () => {});
    report = jest.fn();
    controller = registerGitOpsHandlers({
        ipcMain: {handle: (channel, handler) => {handlers[channel] = handler;}},
        settings: {get: () => store, set: (_key, value) => {store = value;}}, safeStorage,
        getMainWindow: () => ({webContents, isDestroyed: () => false}), verify, sync, detach, report,
    });
    invoke = (name, data) => handlers[SettingsChannels.gitops[name]](event, data);
});
afterEach(() => {controller.stop(); jest.useRealTimers();});

test('encrypts each repository credential pair and never returns secrets or ciphertext to the renderer', async () => {
    const alice = await invoke('SAVE', input);
    const bob = await invoke('SAVE', {...input, url: 'https://github.com/work/tools', username: 'bob', password: 'bob-secret'});
    expect(alice.success && bob.success).toBe(true);
    expect(store[0].encryptedCredentials).not.toBe(store[1].encryptedCredentials);
    expect(JSON.stringify(store)).not.toContain('alice-secret');
    expect(JSON.stringify(store)).not.toContain('bob-secret');
    const listed = await invoke('LIST');
    expect(JSON.stringify(listed)).not.toMatch(/alice-secret|bob-secret|encryptedCredentials|encrypted-/);
    await invoke('VERIFY', store[0].id);
    expect(verify.mock.calls.at(-1)[0]).toMatchObject({username: 'alice', password: 'alice-secret'});
    await invoke('VERIFY', store[1].id);
    expect(verify.mock.calls.at(-1)[0]).toMatchObject({username: 'bob', password: 'bob-secret'});
});

test('does not save invalid credentials or an invalid manifest', async () => {
    verify.mockRejectedValue(new Error('Repository verification failed.'));
    expect((await invoke('SAVE', input)).success).toBe(false);
    expect(store).toEqual([]);
});

test('keeps the previously verified record unchanged when re-verification fails', async () => {
    await invoke('SAVE', input);
    const before = JSON.stringify(store);
    verify.mockRejectedValue(new Error('Manifest invalid.'));
    expect((await invoke('VERIFY', store[0].id)).success).toBe(false);
    expect(JSON.stringify(store)).toBe(before);
});

test.each(['unavailable', 'basic_text'])('refuses insecure credential storage: %s', async mode => {
    if (mode === 'unavailable') safeStorage.isEncryptionAvailable.mockReturnValue(false);
    else safeStorage.getSelectedStorageBackend.mockReturnValue('basic_text');
    expect((await invoke('SAVE', input)).error).toContain('Secure credential storage is unavailable');
    expect(verify).not.toHaveBeenCalled();
    expect(store).toEqual([]);
    expect((await invoke('SAVE', {...input, authType: 'none'})).success).toBe(true);
});

test('editing can retain credentials for the same URL, but cannot send them to another repository', async () => {
    await invoke('SAVE', input);
    const id = store[0].id;
    expect((await invoke('SAVE', {...input, id, username: '', password: '', targetRevision: 'develop'})).success).toBe(true);
    expect(verify.mock.calls.at(-1)[0].password).toBe('alice-secret');
    const result = await invoke('SAVE', {...input, id, url: 'https://another.example/repo', username: '', password: ''});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Enter credentials again');
});

test('removing authentication deletes the encrypted credential pair', async () => {
    await invoke('SAVE', input);
    await invoke('SAVE', {...input, id: store[0].id, authType: 'none'});
    expect(store[0].encryptedCredentials).toBeUndefined();
});

test('removing a repository deletes its credentials and rejects duplicates', async () => {
    await invoke('SAVE', input);
    expect((await invoke('SAVE', input)).error).toContain('already configured');
    await invoke('REMOVE', store[0].id);
    expect(store).toEqual([]);
});

test('rejects plugin frames and other windows', async () => {
    const channel = SettingsChannels.gitops.SAVE;
    expect((await handlers[channel]({...event, senderFrame: {}}, input)).success).toBe(false);
    expect((await handlers[channel]({...event, sender: {}}, input)).success).toBe(false);
    expect(verify).not.toHaveBeenCalled();
});

test('serializes verification and removal so an in-flight verify cannot resurrect a removed repository', async () => {
    let finish;
    verify.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const saving = invoke('SAVE', input);
    expect((await invoke('SAVE', input)).success).toBe(false);
    expect((await invoke('REMOVE', 'anything')).success).toBe(false);
    finish(verified);
    expect((await saving).success).toBe(true);
});

test('automatically syncs saved collections and retains the subscription with a visible error if synchronization fails', async () => {
    sync.mockRejectedValueOnce(new Error('Default certificate signing failed.'));
    const result = await invoke('SAVE', input);
    expect(result.success).toBe(true);
    expect(result.repository.syncError).toContain('1 plugin needs attention');
    expect(result.repository.pluginStatuses[0]).toMatchObject({name: 'example', state: 'error', error: 'Default certificate signing failed.'});
    expect(sync.mock.calls[0][0].secret).toEqual({username: 'alice', password: 'alice-secret'});
    expect((await invoke('SYNC', store[0].id)).success).toBe(true);
    expect(store[0].syncError).toBe('');
    expect(store[0].lastSyncedAt).toBeDefined();
});

test('removes a subscription only after successfully detaching its installed plugins', async () => {
    await invoke('SAVE', input);
    const id = store[0].id;
    detach.mockRejectedValueOnce(new Error('Registry not writable'));
    expect((await invoke('REMOVE', id)).success).toBe(false);
    expect(store).toHaveLength(1);
    expect((await invoke('REMOVE', id)).success).toBe(true);
    expect(detach).toHaveBeenCalledWith(id);
    expect(store).toEqual([]);
});

test('runs startup and five-minute checks, skips paused collections, and stops on shutdown', async () => {
    await invoke('SAVE', input);
    sync.mockClear(); verify.mockClear();
    jest.useFakeTimers();
    controller.start();
    await jest.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(sync).toHaveBeenCalledTimes(2);
    expect((await invoke('SET_AUTO_SYNC', {id: store[0].id, enabled: false})).success).toBe(true);
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(sync).toHaveBeenCalledTimes(2);
    expect((await invoke('SYNC', store[0].id)).success).toBe(true);
    expect(sync).toHaveBeenCalledTimes(3);
    controller.stop();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(sync).toHaveBeenCalledTimes(3);
});

test('records failures per plugin and continues checking healthy plugins', async () => {
    const plugins = [{name: 'unavailable', repository: 'https://github.com/acme/bad', targetRevision: 'v9', path: '/'},
        {name: 'healthy', repository: 'https://github.com/acme/good', targetRevision: 'main', path: '/'}];
    verify.mockResolvedValue({...verified, manifest: {...verified.manifest, spec: {plugins}}});
    sync.mockImplementation(async ({pluginName}) => {
        if (pluginName === 'unavailable') throw new Error('The declared version is unavailable. Contact the collection maintainer.');
        return {installedPlugins: [{id: 'healthy-id', name: 'healthy', commit: 'b'.repeat(40)}], lastSyncedAt: new Date().toISOString()};
    });
    await invoke('SAVE', input);
    expect(sync.mock.calls.map(([args]) => args.pluginName)).toEqual(['unavailable', 'healthy']);
    expect(store[0].pluginStatuses).toEqual(expect.arrayContaining([
        expect.objectContaining({name: 'unavailable', state: 'error', error: expect.stringContaining('maintainer')}),
        expect.objectContaining({name: 'healthy', state: 'synced', commit: 'b'.repeat(40)}),
    ]));
    sync.mockClear(); verify.mockClear();
    expect((await invoke('SYNC_PLUGIN', {id: store[0].id, pluginName: 'healthy'})).success).toBe(true);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][0].pluginName).toBe('healthy');
    expect(verify).not.toHaveBeenCalled();
    expect(store[0].pluginStatuses.find(status => status.name === 'unavailable').state).toBe('error');
});

test('persists repository-specific intervals, validates them, and schedules each repository independently', async () => {
    await invoke('SAVE', input);
    await invoke('SAVE', {...input, url: 'https://github.com/other/tools'});
    const [first, second] = store;
    for (const minutes of [0, 1440, 1.5, '5']) expect((await invoke('SET_INTERVAL', {id: first.id, minutes})).success).toBe(false);
    expect((await invoke('SET_INTERVAL', {id: first.id, minutes: 1})).success).toBe(true);
    expect((await invoke('SET_INTERVAL', {id: second.id, minutes: 2})).success).toBe(true);
    expect((await invoke('LIST')).repositories.map(repo => repo.checkIntervalMinutes)).toEqual([1, 2]);
    sync.mockClear();
    jest.useFakeTimers();
    controller.start();
    await jest.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60000);
    expect(sync.mock.calls.map(([args]) => args.source.id)).toEqual([first.id, second.id, first.id]);
    await jest.advanceTimersByTimeAsync(60000);
    expect(sync).toHaveBeenCalledTimes(5);
});

test('interrupted checks become retryable after restarting the GitOps service', async () => {
    await invoke('SAVE', input);
    store[0].pluginStatuses = [{name: 'example', state: 'checking'}];
    controller.stop();
    controller = registerGitOpsHandlers({
        ipcMain: {handle: (channel, handler) => {handlers[channel] = handler;}},
        settings: {get: () => store, set: (_key, value) => {store = value;}}, safeStorage,
        getMainWindow: () => ({webContents: event.sender, isDestroyed: () => false}), verify, sync, detach,
    });
    expect(store[0].pluginStatuses[0]).toMatchObject({state: 'error', error: expect.stringContaining('interrupted')});
    expect((await invoke('SYNC_PLUGIN', {id: store[0].id, pluginName: 'example'})).success).toBe(true);
    expect(store[0].pluginStatuses[0].state).toBe('synced');
});

test('reports a stable incident key for repeated plugin failures and resolves it after recovery', async () => {
    sync.mockRejectedValue(new Error('Repository unavailable'));
    await invoke('SAVE', input);
    const failure = report.mock.calls.map(([notice]) => notice).find(notice => notice.type === 'danger');
    expect(failure).toMatchObject({source: 'gitops', title: 'Couldn’t synchronize example in tools',
        actions: [{kind: 'view-gitops', repositoryId: store[0].id}, {kind: 'retry-gitops', repositoryId: store[0].id, pluginName: 'example'}]});
    report.mockClear();
    await invoke('SYNC_PLUGIN', {id: store[0].id, pluginName: 'example'});
    expect(report).toHaveBeenCalledWith(expect.objectContaining({groupKey: failure.groupKey, type: 'danger'}));
    sync.mockResolvedValue({installedPlugins: []});
    report.mockClear();
    await invoke('SYNC_PLUGIN', {id: store[0].id, pluginName: 'example'});
    expect(report).toHaveBeenCalledWith(expect.objectContaining({groupKey: failure.groupKey, status: 'resolved', type: 'success'}));
});
