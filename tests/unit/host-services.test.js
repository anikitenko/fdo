/** @jest-environment node */
const {afterEach, beforeEach, expect, jest: mock, test} = require('@jest/globals');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Buffer} = require('node:buffer');
const {randomBytes, createCipheriv, createDecipheriv} = require('node:crypto');
const {EventEmitter} = require('node:events');
const {openVault} = require('../../src/utils/hostServices/database.cjs');
const {createHostService} = require('../../src/utils/hostServices/service.cjs');
const {executeSSH, fingerprint} = require('../../src/utils/hostServices/ssh.cjs');
const {CAPABILITIES, failure, required, request, profile: validateProfile} = require('../../src/utils/hostServices/contracts.cjs');

let dir, vault, service, grants, installed, protection, audit;
const hostKey = Buffer.from('fixture host public key');
const profile = () => ({id: 'server', label: 'Server', host: '127.0.0.1', port: 22, username: 'fixture',
    trustedHostKey: fingerprint(hostKey), authentication: {type: 'password', passwordRef: {kind: 'secret', key: 'password'}},
    policy: {consumers: ['ssh.exec'], commands: ['uptime']}});
class Channel extends EventEmitter {
    constructor() {super(); this.stderr = new EventEmitter(); this.destroy = mock.fn(); this.end = mock.fn();}
}
class Client extends EventEmitter {
    static instances = [];
    constructor() {super(); Client.instances.push(this); this.channel = new Channel(); this.destroy = mock.fn();}
    connect(config) {this.config = config; queueMicrotask(() => {if (config.hostVerifier(hostKey)) this.emit('ready'); else this.emit('error', new Error('PRIVATE PROVIDER DETAIL'));});}
    exec(command, options, callback) {this.command = command; callback(null, this.channel);}
}
const tick = async () => {await Promise.resolve(); await Promise.resolve();};
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-vault-test-'));
    const encryptionKey = randomBytes(32);
    protection = {
        check: mock.fn(),
        encrypt(value) {const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]);},
        decrypt(data) {const decipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');},
    };
    vault = openVault(path.join(dir, 'vault.sqlite'), protection);
    grants = {a: [...CAPABILITIES], b: [...CAPABILITIES]}; installed = new Set(['a', 'b']); audit = mock.fn();
    service = createHostService({vault, Client, getGrants: id => grants[id] || [], isInstalled: id => installed.has(id), audit});
    Client.instances = [];
});
afterEach(async () => {await service.close(); fs.rmSync(dir, {recursive: true, force: true}); mock.useRealTimers();});
const call = (endpoint, action, payload = {}) => endpoint.request({action, payload});
const exec = endpoint => call(endpoint, 'ssh.exec', {profileId: 'server', command: 'uptime', timeoutMs: 1000, maxOutputBytes: 1024});
function save() {service.saveSecret('a', 'password', 'fixture-password'); service.saveProfile('a', profile());}

test('namespaces are isolated, missing differs from empty, overwrites and deletion persist atomically', async () => {
    const a = service.bind('a'), b = service.bind('b');
    expect(await call(a, 'secrets.get', {key: 'token'})).toEqual({value: null});
    await call(a, 'secrets.set', {key: 'token', value: ''});
    expect(await call(a, 'secrets.get', {key: 'token'})).toEqual({value: ''});
    expect(await call(b, 'secrets.get', {key: 'token'})).toEqual({value: null});
    const secret = 'sensitive-PEM-🔐\n\u0000{"password":"never-persist-me"}';
    await call(a, 'secrets.set', {key: 'token', value: secret});
    expect((await call(a, 'secrets.get', {key: 'token'})).value).toBe(secret);
    expect((await call(a, 'secrets.list')).entries).toEqual([{key: 'token', updatedAt: expect.any(String)}]);
    for (const file of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, file)).includes(Buffer.from('never-persist-me'))).toBe(false);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('never-persist-me');
    expect(await call(a, 'secrets.delete', {key: 'token'})).toEqual({deleted: true});
    expect(await call(a, 'secrets.delete', {key: 'token'})).toEqual({deleted: false});
    a.close(); b.close();
});

test.each([
    ['secrets.get', {key: 'x'}], ['secrets.set', {key: 'x', value: 'v'}], ['secrets.list', {}], ['secrets.delete', {key: 'x'}],
    ['ssh.profiles.list', {}], ['ssh.exec', {profileId: 'server', command: 'uptime', timeoutMs: 1000, maxOutputBytes: 1024}],
])('requires every base and operation grant independently: %s', async (action, payload) => {
    const a = service.bind('a');
    for (const missing of required(action)) {
        grants.a = CAPABILITIES.filter(cap => cap !== missing);
        await expect(call(a, action, payload)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    }
    a.close();
});

test.each(['LOCKED', 'UNAVAILABLE'])('locked/unavailable storage rejects even absent reads and metadata requests: %s', async code => {
    protection.check.mockImplementation(() => {throw failure(code);});
    const a = service.bind('a');
    await expect(call(a, 'secrets.get', {key: 'missing'})).rejects.toMatchObject({code});
    await expect(call(a, 'secrets.list')).rejects.toMatchObject({code});
    a.close();
});

test('validates fields, case-sensitive key grammar and quotas without leaking values', async () => {
    const a = service.bind('a');
    for (const value of [{action: 'secrets.get', payload: {key: '../x'}}, {action: 'secrets.get', payload: {key: 'x', pluginId: 'b'}},
        {action: 'secrets.get', payload: {key: 'x'}, pluginId: 'b'}, {action: 'secrets.consume', payload: {key: 'x'}},
        {action: 'secrets.get', payload: {key:'trailing-newline\n'}},
        {action: 'secrets.set', payload: {key: 'x', value: 'a'.repeat(1048577)}}]) {
        await expect(a.request(value)).rejects.toMatchObject({code: 'INVALID_REQUEST'});
    }
    await call(a, 'secrets.set', {key: 'X', value: 'upper'});
    expect((await call(a, 'secrets.get', {key: 'x'})).value).toBeNull();
    for (let i = 0; i < 255; i++) vault.set('a', 'k' + i, '');
    await expect(call(a, 'secrets.set', {key: 'overflow', value: ''})).rejects.toMatchObject({code: 'INVALID_REQUEST'});
    await call(a, 'secrets.set', {key: 'X', value: 'replacement'});
    a.close();
});

test('profile IDs grant no access across owners and references must exist in the profile owner namespace', async () => {
    service.saveSecret('b', 'password', 'other-secret');
    expect(() => service.saveProfile('a', profile())).toThrow();
    save();
    const b = service.bind('b');
    expect(await call(b, 'ssh.profiles.list')).toEqual({profiles: []});
    await expect(exec(b)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    const a = service.bind('a');
    expect(await call(a, 'ssh.profiles.list')).toEqual({profiles: [{id:'server',label:'Server',host:profile().host,port:profile().port,username:profile().username,authenticationType:profile().authentication.type,trustedHostKey:profile().trustedHostKey}]});
    service.saveProfile('a', {...profile(), policy: {consumers: [], commands: ['uptime']}});
    expect(await call(a, 'ssh.profiles.list')).toEqual({profiles: []});
    await expect(exec(a)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    a.close(); b.close();
});

test('SSH consumes references without secrets.get; nonzero and null exit statuses are results', async () => {
    save(); grants.a = grants.a.filter(cap => cap !== 'secrets.get');
    const a = service.bind('a');
    const promise = exec(a); await tick();
    const client = Client.instances.at(-1);
    expect(client.config.password).toBe('fixture-password');
    client.channel.emit('data', Buffer.from('ok')); client.channel.stderr.emit('data', Buffer.from('warning'));
    client.channel.emit('exit', 7); client.channel.emit('close');
    expect(await promise).toMatchObject({stdout: 'ok', stderr: 'warning', exitCode: 7, signal: null, truncated: false});
    expect(client.destroy).toHaveBeenCalledTimes(1);
    const second = exec(a); await tick(); Client.instances.at(-1).channel.emit('close');
    expect(await second).toMatchObject({exitCode: null, signal: null});
    a.close();
});

test('command policy uses exact shell strings and cannot be broadened by a payload', async () => {
    save(); const a = service.bind('a');
    for (const command of ['uptime; rm -rf /', ' uptime', 'uptime\n', 'UPTIME']) {
        await expect(call(a, 'ssh.exec', {profileId: 'server', command, timeoutMs: 10, maxOutputBytes: 10})).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    }
    expect(request({action: 'ssh.exec', payload: {profileId: 'server', command: 'uptime', timeoutMs: 120001, maxOutputBytes: 10}}).payload.timeoutMs).toBe(120001); // Effective host ceiling is applied during execution.
    a.close();
});

test('unrestricted shell access requires an explicit saved profile policy and retains grants and namespace checks', async () => {
    save(); const a = service.bind('a'), b = service.bind('b');
    const payload = {profileId:'server',command:'printf arbitrary-command',timeoutMs:1000,maxOutputBytes:1024};
    await expect(call(a, 'ssh.exec', payload)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    await expect(call(a, 'ssh.exec', {...payload,allowAllCommands:true})).rejects.toMatchObject({code:'INVALID_REQUEST'});
    const unrestricted = profile(); unrestricted.policy.allowAllCommands = true;
    service.saveProfile('a', unrestricted);
    expect(vault.profile('a', 'server').policy.allowAllCommands).toBe(true);
    const pending = call(a, 'ssh.exec', payload); await tick();
    const client = Client.instances.at(-1);
    expect(client.command).toBe(payload.command);
    client.channel.emit('exit',0); client.channel.emit('close');
    await expect(pending).resolves.toMatchObject({exitCode:0});
    await expect(call(b, 'ssh.exec', payload)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    grants.a = grants.a.filter(capability => capability !== 'ssh.exec');
    await expect(call(a, 'ssh.exec', payload)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    grants.a = [...CAPABILITIES];
    service.saveProfile('a', profile());
    await expect(call(a, 'ssh.exec', payload)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    for (const value of ['true',1,null,{}]) {
        const invalid = profile(); invalid.policy.allowAllCommands = value;
        expect(() => validateProfile(invalid)).toThrow();
    }
    unrestricted.policy.consumers = ['git'];
    expect(() => validateProfile(unrestricted)).toThrow();
    a.close(); b.close();
});

test('caps combined output, drains extra chunks and decodes UTF-8 split across chunks', async () => {
    save(); const a = service.bind('a');
    const promise = call(a, 'ssh.exec', {profileId: 'server', command: 'uptime', timeoutMs: 1000, maxOutputBytes: 7}); await tick();
    const c = Client.instances.at(-1).channel, unicode = Buffer.from('🔐');
    c.emit('data', unicode.subarray(0, 2)); c.emit('data', unicode.subarray(2));
    c.stderr.emit('data', Buffer.from('abcdef')); c.emit('data', Buffer.alloc(100000)); c.emit('exit', 0); c.emit('close');
    expect(await promise).toMatchObject({stdout: '🔐', stderr: 'abc', truncated: true, exitCode: 0});
    a.close();
});

test('always verifies raw host-key fingerprints and rejects missing or changed trust', async () => {
    for (const trustedHostKey of ['', fingerprint(Buffer.from('changed'))]) {
        const promise = executeSSH({Client, profile: {...profile(), trustedHostKey}, credentials: {password: 'secret'}, command: 'uptime', timeoutMs: 100, maxOutputBytes: 10});
        await expect(promise).rejects.toMatchObject({code: 'HOST_KEY_REJECTED'});
        expect(Client.instances.at(-1).destroy).toHaveBeenCalledTimes(1);
    }
    expect(() => validateProfile({...profile(), trustedHostKey: ''})).toThrow();
});

test('rotation, deletion, revocation, and worker disconnect cancel active connections', async () => {
    for (const mutation of [() => service.saveSecret('a', 'password', 'new'), () => service.deleteSecret('a', 'password'),
        () => service.saveProfile('a', {...profile(), host: 'localhost'}), () => service.deleteProfile('a', 'server'),
        () => {grants.a = []; service.cancel('a');}]) {
        grants.a = [...CAPABILITIES]; save(); const a = service.bind('a');
        const promise = exec(a); await tick(); mutation();
        await expect(promise).rejects.toMatchObject({code: 'ACCESS_DENIED'});
        expect(Client.instances.at(-1).destroy).toHaveBeenCalledTimes(1); a.close();
    }
    grants.a = [...CAPABILITIES]; save(); const a = service.bind('a');
    const promise = exec(a); await tick(); a.close();
    await expect(promise).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    await expect(call(a, 'secrets.list')).rejects.toMatchObject({code: 'UNAVAILABLE'});
});

test('deleting a reference fails future use; uninstall destroys the namespace without affecting other plugins', async () => {
    save(); vault.set('b', 'token', 'b'); service.deleteSecret('a', 'password'); const a = service.bind('a');
    await expect(exec(a)).rejects.toMatchObject({code: 'UNAVAILABLE'});
    service.uninstall('a'); expect(vault.profiles('a')).toEqual([]); expect(vault.get('b', 'token')).toBe('b');
    a.close();
});

test('rejects premature transport disconnects and sanitizes provider failures', async () => {
    save(); const a = service.bind('a'); const promise = exec(a); await tick();
    Client.instances.at(-1).emit('error', new Error('PASSWORD=secret-provider-detail'));
    await expect(promise).rejects.toMatchObject({code: 'CONNECTION_FAILED', message: 'Host service request failed.'});
    expect(JSON.stringify(audit.mock.calls)).not.toContain('PASSWORD');
    const second = exec(a); await tick(); Client.instances.at(-1).emit('close');
    await expect(second).rejects.toMatchObject({code: 'CONNECTION_FAILED'}); a.close();
});

test('handshake and command deadlines dispose the connection without retrying', async () => {
    mock.useFakeTimers();
    class Waiting extends Client {connect(config) {this.config = config;}}
    const handshake = executeSSH({Client: Waiting, profile: profile(), credentials: {}, command: 'uptime', timeoutMs: 20, maxOutputBytes: 10, handshakeMs: 10});
    const rejectedHandshake = expect(handshake).rejects.toMatchObject({code: 'TIMEOUT'});
    await mock.advanceTimersByTimeAsync(10); await rejectedHandshake;
    const command = executeSSH({Client, profile: profile(), credentials: {password: 'p'}, command: 'uptime', timeoutMs: 20, maxOutputBytes: 10});
    const rejectedCommand = expect(command).rejects.toMatchObject({code: 'TIMEOUT'});
    await mock.advanceTimersByTimeAsync(21); await rejectedCommand;
    expect(Client.instances).toHaveLength(2);
    expect(Client.instances.every(client => client.destroy.mock.calls.length === 1)).toBe(true);
});

test('Git CLI profile consumption enforces every prerequisite with explicit SSH execution and without secret-read grants', async () => {
    const executeGit = mock.fn(async ({credentials, selection}) => ({exitCode: 0, stdout: Buffer.from(selection.profile.id), stderr: Buffer.alloc(0), passwordSeen: credentials.password}));
    service = createHostService({vault, Client, getGrants: id => grants[id] || [], isInstalled: id => installed.has(id), audit, executeGit});
    service.saveSecret('a', 'password', 'private-git-password');
    const value = profile(); value.policy = {consumers: ['git'], commands: [], repositories: [{path: 'team/repo.git', operations: ['fetch']}]};
    service.saveProfile('a', value);
    const plan = {args: ['fetch', 'fixture@127.0.0.1:team/repo.git'], env: {}};
    const requiredGrants = ['system.process.exec', 'system.process.scope.git', 'ssh.use', 'ssh.exec', 'secrets.use', 'secrets.consume'];
    grants.a = requiredGrants;
    expect(await service.runGit('a', plan)).toMatchObject({exitCode: 0});
    for (const missing of requiredGrants) {
        grants.a = requiredGrants.filter(cap => cap !== missing);
        await expect(service.runGit('a', plan)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    }
    grants.a = requiredGrants;
    await expect(service.runGit('b', plan)).rejects.toMatchObject({code: 'ACCESS_DENIED'}); // No profile or machine-SSH fallback across namespaces.
    await expect(service.runGit('a', {...plan, args: ['push', plan.args[1], 'refs/heads/main:refs/heads/main']})).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    expect(executeGit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('private-git-password');
});

test('profile edits, credential deletion, revocation and shutdown cancel existing Git transport use', async () => {
    let observedSignal;
    const executeGit = mock.fn(({signal}) => new Promise((resolve, reject) => {
        observedSignal = signal; signal.addEventListener('abort', () => reject(failure('ACCESS_DENIED')), {once: true});
    }));
    service = createHostService({vault, Client, getGrants: id => grants[id] || [], isInstalled: id => installed.has(id), audit, executeGit});
    service.saveSecret('a', 'password', 'private-git-password');
    const value = profile(); value.policy = {consumers: ['git'], commands: [], repositories: [{path: 'team/repo.git', operations: ['fetch']}]};
    service.saveProfile('a', value);
    grants.a = ['system.process.exec', 'system.process.scope.git', 'ssh.use', 'ssh.exec', 'secrets.use', 'secrets.consume'];
    const plan = {args: ['fetch', 'fixture@127.0.0.1:team/repo.git'], env: {}};
    for (const cancel of [() => service.saveProfile('a', value), () => service.saveSecret('a', 'password', 'rotated'), () => service.cancel('a'), () => service.deleteSecret('a', 'password')]) {
        const pending = service.runGit('a', plan); await tick();
        expect(observedSignal.aborted).toBe(false); cancel();
        await expect(pending).rejects.toMatchObject({code: 'ACCESS_DENIED'}); expect(observedSignal.aborted).toBe(true);
    }
    await expect(service.runGit('a', plan)).rejects.toMatchObject({code: 'UNAVAILABLE'});
});


test('deleting the last Git profile keeps profile mode enabled until an explicit host opt-out', async () => {
    service.saveSecret('a', 'password', 'private-git-password');
    const value = profile(); value.policy = {consumers: ['git'], commands: [], repositories: [{path: 'team/repo.git', operations: ['fetch']}]};
    service.saveProfile('a', value); expect(vault.gitEnabled('a')).toBe(true);
    service.deleteProfile('a', value.id);
    const plan = {args: ['fetch', 'fixture@127.0.0.1:team/repo.git'], env: {}};
    await expect(service.runGit('a', plan)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    expect(vault.gitEnabled('a')).toBe(true);
    service.setGitEnabled('a', false); expect(await service.runGit('a', plan)).toBeNull();
    service.setGitEnabled('a', true); await expect(service.runGit('a', plan)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    service.uninstall('a'); expect(vault.gitEnabled('a')).toBe(false);
});

test('an SSH-capable plugin without a Git profile fails closed; legacy mode requires deliberate opt-out', async () => {
    const plan = {args: ['ls-remote', 'fixture@example.com:team/repo.git'], env: {}};
    expect(vault.gitMode('a')).toBeNull();
    await expect(service.runGit('a', plan)).rejects.toMatchObject({code: 'ACCESS_DENIED'});
    expect(Client.instances).toHaveLength(0);
    service.setGitEnabled('a', false);
    expect(vault.gitMode('a')).toBe(false);
    expect(await service.runGit('a', plan)).toBeNull();
    grants.b = ['system.process.exec', 'system.process.scope.git'];
    expect(await service.runGit('b', plan)).toBeNull();
});

test('live capture bounds an absent consumer, drains excess, and keeps final strings identical to delivered prefix',async()=>{
    save();const a=service.bind('a');
    const {handle}=await a.operation('start',{profileId:'server',command:'uptime',timeoutMs:1000,maxOutputBytes:100000});
    await tick();const channel=Client.instances.at(-1).channel;
    for(let index=0;index<5000;index++)channel.emit('data',Buffer.from('x'));
    channel.emit('exit',0);channel.emit('close');
    const result=await a.operation('result',{handle});
    expect(result.stdout.length).toBe(2048);expect(result.truncated).toBe(true);
    let captured='';while(true){const item=await a.operation('next',{handle});if(item.done)break;captured+=item.value.data;}
    expect(captured).toBe(result.stdout);a.close();
});

test('live requests reject replayed IDs and clamp SDK positive numeric requests to effective host ceilings',async()=>{
    save();const a=service.bind('a');
    const {handle}=await a.operation('start',{profileId:'server',command:'uptime',timeoutMs:Number.MAX_SAFE_INTEGER,maxOutputBytes:Number.MAX_SAFE_INTEGER},'single-start');
    await expect(a.operation('start',{profileId:'server',command:'uptime',timeoutMs:1000,maxOutputBytes:10},'single-start')).rejects.toMatchObject({code:'INVALID_REQUEST'});
    await tick();const channel=Client.instances.at(-1).channel;channel.emit('data',Buffer.alloc(4194305,97));channel.emit('close');
    const result=await a.operation('result',{handle});expect(Buffer.byteLength(result.stdout)).toBe(4194304);expect(result.truncated).toBe(true);a.close();
});

test('revocation between queued event consumption and delivery does not leak the queued output',async()=>{
    save();const a=service.bind('a');
    const {handle}=await a.operation('start',{profileId:'server',command:'uptime',timeoutMs:1000,maxOutputBytes:100});
    await tick();Client.instances.at(-1).channel.emit('data',Buffer.from('private output'));
    const delivery=a.operation('next',{handle});grants.a=[];service.cancel('a');
    await expect(delivery).rejects.toMatchObject({code:'ACCESS_DENIED'});a.close();
});

test('audit persistence failure settles both execution result and pending output without exposing provider details',async()=>{
    save();const a=service.bind('a');
    const {handle}=await a.operation('start',{profileId:'server',command:'uptime',timeoutMs:1000,maxOutputBytes:100});
    await tick();const result=expect(a.operation('result',{handle})).rejects.toMatchObject({code:'UNAVAILABLE'});
    const next=expect(a.operation('next',{handle})).rejects.toMatchObject({code:'UNAVAILABLE'});
    audit.mockImplementation(()=>{throw new Error('private audit provider details');});
    Client.instances.at(-1).channel.emit('close');await result;await next;a.close();
});
