import {inspectToolPrerequisites} from '../../src/utils/system/toolPrerequisites';
import {EventEmitter} from 'node:events';
import {beforeEach, expect, jest, test} from '@jest/globals';
import {registerHostServiceSettings} from '../../src/ipc/hostServices';
import {HostServiceSettingsChannels as channels} from '../../src/ipc/channels';
jest.mock('../../src/utils/system/toolPrerequisites', () => ({inspectToolPrerequisites: require('@jest/globals').jest.fn(async () => ({platform:'darwin',tools:[]}))}));
jest.mock('../../src/utils/hostServices/runtime', () => ({getHostServices: jest.fn()}));
let handlers, event, state, service, scan;
beforeEach(() => {
    handlers = {}; scan = jest.fn(async (id, endpoint) => ({...endpoint, keyType: 'ssh-ed25519', fingerprint: 'SHA256:' + 'A'.repeat(43)}));
    const mainFrame = {}, webContents = Object.assign(new EventEmitter(), {mainFrame});
    event = {sender: webContents, senderFrame: mainFrame};
    state = {gitProfileMode: false, entries: [{key: 'password', updatedAt: '2026-10-17T00:00:00Z'}], profiles: []};
    service = {saveSecret: jest.fn(() => ({stored: true})), saveProfile: jest.fn(), deleteSecret: jest.fn(() => ({deleted: true})), deleteProfile: jest.fn()};
    registerHostServiceSettings({ipcMain: {handle: (channel, fn) => {handlers[channel] = fn;}},
        getMainWindow: () => ({webContents, isDestroyed: () => false}), getPlugins: () => [{id: 'installed'}],
        scanHostKey: scan, services: () => ({service, check() {}, vault: {gitEnabled: () => state.gitProfileMode, list: () => state.entries, profiles: () => state.profiles}})});
});
test('only the host main frame may manage credentials, with no UI plaintext read endpoint', async () => {
    for (const untrusted of [{sender: {}, senderFrame: event.senderFrame}, {...event, senderFrame: {}}]) {
        expect(await handlers[channels.SAVE_SECRET](untrusted, {pluginId: 'installed', key: 'password', value: 'secret'})).toMatchObject({success: false, code: 'ACCESS_DENIED'});
    }
    expect(service.saveSecret).not.toHaveBeenCalled();
    expect(await handlers[channels.STATE](event, {pluginId: 'installed'})).toEqual({success: true, available: true, code: '', ...state});
    expect(Object.keys(channels)).not.toContain('GET_SECRET');
});
test('requires explicit trust confirmation and an installed owner', async () => {
    expect(await handlers[channels.SAVE_PROFILE](event, {pluginId: 'installed', profile: {}, trustConfirmed: false})).toMatchObject({success: false, code: 'INVALID_REQUEST'});
    expect(service.saveProfile).not.toHaveBeenCalled();
    expect(await handlers[channels.SAVE_SECRET](event, {pluginId: 'forged', key: 'password', value: 'secret'})).toMatchObject({success: false, code: 'ACCESS_DENIED'});
    expect(await handlers[channels.SAVE_SECRET](event, {pluginId: 'installed', key: 'password', value: ''})).toEqual({success: true, stored: true});
});

const validProfile = () => ({id: 'server', label: 'Server', host: 'github.com', port: 22, username: 'git', trustedHostKey: 'SHA256:' + 'A'.repeat(43),
    authentication: {type: 'password', passwordRef: {kind: 'secret', key: 'password'}}, policy: {consumers: ['ssh.exec'], commands: ['uptime']}});
test('normalizes host-entered metadata and returns the committed profile without a second state read', async () => {
    const profile = {...validProfile(), id: ' server ', host: ' github.com ', trustedHostKey: '256 SHA256:' + 'A'.repeat(43) + ' git@server (ED25519)'};
    const result = await handlers[channels.SAVE_PROFILE](event, {pluginId: 'installed', profile, trustConfirmed: true});
    expect(result).toMatchObject({success: true, profile: {id: 'server', host: 'github.com', trustedHostKey: validProfile().trustedHostKey}});
    expect(service.saveProfile).toHaveBeenCalledWith('installed', result.profile);
});
test('returns safe field-specific failures for invalid pins and stale credential references', async () => {
    const profile = validProfile(); profile.trustedHostKey = 'wrong';
    expect(await handlers[channels.SAVE_PROFILE](event, {pluginId: 'installed', profile, trustConfirmed: true})).toMatchObject({success: false, code: 'INVALID_REQUEST', fieldErrors: {trustedHostKey: expect.any(String)}});
    profile.trustedHostKey = validProfile().trustedHostKey; profile.authentication.passwordRef.key = 'removed';
    expect(await handlers[channels.SAVE_PROFILE](event, {pluginId: 'installed', profile, trustConfirmed: true})).toMatchObject({success: false, code: 'INVALID_REQUEST', fieldErrors: {credential: expect.stringContaining('no longer exists')}});
    expect(service.saveProfile).not.toHaveBeenCalled();
});


test('host-key discovery is host-UI-only and validates one endpoint before opening a connection', async () => {
    const input = {pluginId: 'installed', host: ' github.com ', port: 22};
    expect(await handlers[channels.FETCH_HOST_KEY]({sender: {}, senderFrame: {}}, input)).toMatchObject({success: false, code: 'ACCESS_DENIED'});
    expect(await handlers[channels.FETCH_HOST_KEY](event, {...input, host: 'https://host/path'})).toMatchObject({success: false, code: 'INVALID_REQUEST', fieldErrors: {host: expect.any(String)}});
    expect(scan).not.toHaveBeenCalled();
    expect(await handlers[channels.FETCH_HOST_KEY](event, input)).toMatchObject({success: true, candidate: {host: 'github.com', port: 22, keyType: 'ssh-ed25519'}});
    expect(scan).toHaveBeenCalledWith('installed', {host: 'github.com', port: 22}, expect.any(AbortSignal));
});


test.each(['destroyed', 'render-process-gone', 'did-start-navigation'])('cancels host-key discovery when the caller emits %s', async name => {
    let signal;
    scan.mockImplementation((id, endpoint, next) => {signal = next; return new Promise((resolve, reject) => next.addEventListener('abort', () => reject({code: 'ACCESS_DENIED'}), {once: true}));});
    const pending = handlers[channels.FETCH_HOST_KEY](event, {pluginId: 'installed', host: 'github.com', port: 22});
    expect(signal.aborted).toBe(false);
    event.sender.emit(name, {isMainFrame: true, isSameDocument: false});
    expect(await pending).toMatchObject({success: false, code: 'ACCESS_DENIED'});
    for (const type of ['destroyed', 'render-process-gone', 'did-start-navigation']) expect(event.sender.listenerCount(type)).toBe(0);
});

test('view leases are main-frame authenticated, owner-bound and released on renderer loss',async()=>{
 service.viewLease=jest.fn();service.releaseViews=jest.fn();event.sender.id=42;
 const payload={pluginId:'installed',leaseId:'view-1',active:true};
 expect(await handlers[channels.TERMINAL_VIEW]({...event,senderFrame:{}},payload)).toMatchObject({success:false,code:'ACCESS_DENIED'});
 expect(service.viewLease).not.toHaveBeenCalled();
 expect(await handlers[channels.TERMINAL_VIEW](event,payload)).toEqual({success:true});
 expect(service.viewLease).toHaveBeenCalledWith(42,'installed','view-1',true);
 event.sender.emit('render-process-gone');expect(service.releaseViews).toHaveBeenCalledWith(42);
});


test('local X11 support reporting is main-frame-only and exposes only sanitized availability',async()=>{
 service.checkX11=jest.fn(async()=>({checkedAt:'2026-10-18T00:00:00Z',trusted:{available:true},untrusted:{available:false,code:'X11_UNSUPPORTED'}}));
 expect(await handlers[channels.CHECK_X11]({...event,senderFrame:{}},{pluginId:'installed'})).toMatchObject({success:false,code:'ACCESS_DENIED'});
 expect(service.checkX11).not.toHaveBeenCalled();
 expect(await handlers[channels.CHECK_X11](event,{pluginId:'installed'})).toMatchObject({success:true,availability:{untrusted:{available:false,code:'X11_UNSUPPORTED'}}});
});

test('tool discovery is main-frame only, independent of a selected plugin and rejects renderer commands', async () => {
    expect(await handlers[channels.TOOLS_STATE]({...event,senderFrame:{}}, {})).toEqual({success:false,code:'ACCESS_DENIED'});
    expect(await handlers[channels.TOOLS_STATE](event, {command:'install anything'})).toEqual({success:false,code:'INVALID_REQUEST'});
    expect(await handlers[channels.TOOLS_STATE](event, {})).toEqual({success:true,inventory:{platform:'darwin',tools:[]}});
    expect(inspectToolPrerequisites).toHaveBeenCalled();
});
