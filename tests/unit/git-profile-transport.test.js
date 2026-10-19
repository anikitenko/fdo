/** @jest-environment node */
const {test, expect} = require('@jest/globals');
const {Server, Client} = require('ssh2');
const {spawn, execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {fingerprint} = require('../../src/utils/hostServices/ssh.cjs');
const {runGitTransport} = require('../../src/utils/hostServices/gitTransport.cjs');
const {target, parse, select} = require('../../src/utils/hostServices/gitPolicy.cjs');
const {profile: validateProfile} = require('../../src/utils/hostServices/contracts.cjs');
const helperPath = path.resolve(__dirname, '../../src/utils/hostServices/gitSshHelper.cjs');
const {host: hostKey, work: workKey, personal: personalKey, parsedKey} = require('./helpers/ssh2Keys.cjs');
const profile = (id = 'work') => ({id, label: id, host: 'localhost', port: 22, username: 'git', trustedHostKey: fingerprint(parsedKey(hostKey.private).getPublicSSH()),
    authentication: {type: 'privateKey', privateKeyRef: {kind: 'secret', key: id}},
    policy: {consumers: ['git'], commands: [], repositories: [{path: id + '/repo.git', operations: ['ls-remote', 'clone', 'fetch', 'push']}]}});

test('selects repository-specific profiles on the same SSH endpoint and rejects ambiguity, wrong owners/targets/operations', () => {
    const work = profile(), personal = profile('personal');
    expect(select([work, personal], 'git@localhost:work/repo.git', 'fetch').profile.id).toBe('work');
    expect(select([work, personal], 'git@localhost:personal/repo.git', 'clone').profile.id).toBe('personal');
    for (const url of ['git@elsewhere:work/repo.git', 'ssh://git@localhost:23/work/repo.git', 'git@localhost:unknown/repo.git']) expect(() => select([work], url, 'fetch')).toThrow();
    expect(() => select([work, {...work, id: 'duplicate'}], 'git@localhost:work/repo.git', 'fetch')).toThrow();
    expect(() => select([{...work, policy: {...work.policy, consumers: []}}], 'git@localhost:work/repo.git', 'fetch')).toThrow();
    expect(validateProfile(work)).toBe(work);
});
test('authenticated Git supports named remotes and safe options while rejecting execution overrides and unsafe paths', () => {
    for (const url of ['https://host/repo.git', 'ssh://git:password@host/repo.git', 'git@host:../repo', 'git@host:repo;id', 'ssh://git@host/repo%2frepo','git@host:repo\n']) expect(() => target(url)).toThrow();
    for (const args of [['-c', 'core.sshCommand=bad', 'fetch'], ['push', 'git@host:repo', '--force'], ['clone', 'git@host:repo', '../escape']]) expect(() => parse({args, env: {}})).toThrow();
    expect(parse({args:['fetch','origin','--prune'],env:{}})).toMatchObject({remote:'origin',options:['--prune']});
    expect(parse({args:['pull','origin','main'],env:{}})).toMatchObject({policyOperation:'fetch',options:['--ff-only']});
    expect(() => parse({args: ['fetch', 'git@host:repo'], env: {GIT_SSH_COMMAND: 'bad'}})).toThrow();
    expect(parse({args: ['push', 'git@host:repo', 'refs/heads/main:refs/heads/main'], env: {}}).operation).toBe('push');
});

test('Git CLI uses different encrypted keys per repository, streams real clone/fetch/push data and rejects changed trust', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-profile-git-test-'));
    const connections = new Set(), processes = new Set(), seen = [];
    const keys = {work: workKey, personal: personalKey};
    const git = (args, cwd = root) => execFileSync('git', args, {cwd, env: {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'none')}, stdio: 'pipe'});
    for (const id of ['work', 'personal']) {
        await fs.mkdir(path.join(root, id)); git(['init', '--bare', id + '/repo.git']);
    }
    git(['init', 'seed']); await fs.writeFile(path.join(root, 'seed', 'binary.dat'), Buffer.from(Array.from({length: 524288}, (_, index) => index % 256)));
    git(['add', '.'], path.join(root, 'seed')); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'binary fixture'], path.join(root, 'seed'));
    for (const id of ['work', 'personal']) {git(['push', path.join(root, id, 'repo.git'), 'HEAD:refs/heads/main'], path.join(root, 'seed')); git(['symbolic-ref', 'HEAD', 'refs/heads/main'], path.join(root, id, 'repo.git'));}
    const server = new Server({hostKeys: [hostKey.private]}, connection => {
        connections.add(connection); connection.on('error', () => {}); connection.on('close', () => connections.delete(connection)); let identity;
        connection.on('authentication', ctx => {
            if (ctx.username !== 'git' || ctx.method !== 'publickey') return ctx.reject();
            for (const [id, key] of Object.entries(keys)) {
                const allowed = parsedKey(key.public);
                if (ctx.key.data.equals(allowed.getPublicSSH()) && (!ctx.signature || allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) {identity = id; return ctx.accept();}
            }
            ctx.reject();
        });
        connection.on('ready', () => connection.on('session', accept => accept().on('exec', (acceptCommand, reject, info) => {
            const match = /^git-(upload|receive)-pack '\/?(work|personal)\/repo.git'$/.exec(info.command);
            if (!match || match[2] !== identity) return reject();
            seen.push({identity, command: info.command}); const stream = acceptCommand();
            const child = spawn('git', [match[1] + '-pack', path.join(root, identity, 'repo.git')], {stdio: ['pipe', 'pipe', 'pipe']}); processes.add(child);
            stream.pipe(child.stdin); child.stdout.pipe(stream, {end: false}); child.stderr.pipe(stream.stderr);
            child.on('close', code => {processes.delete(child); stream.exit(code); stream.end();}); stream.on('close', () => child.kill()); child.stdin.on('error', () => {});
        })));
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const run = async (id, operation, rest = [], overrides = {}, cwd = root) => {
        const selected = {...profile(id), host: '127.0.0.1', port: server.address().port, ...overrides};
        const url = `ssh://git@127.0.0.1:${selected.port}/${id}/repo.git`;
        const credentials = {privateKey: keys[id].private, passphrase: id + ' phrase'};
        try {return await runGitTransport({Client, plan: {command: process.platform === 'win32' ? 'git.exe' : '/usr/bin/git', cwd, args: [operation, url, ...rest], timeoutMs: 10000}, selection: {profile: selected, repository: '/' + id + '/repo.git'}, operation, credentials, signal: new AbortController().signal, helperPath});}
        finally {expect(credentials.privateKey).toBeUndefined();}
    };
    try {
        for (const id of ['work', 'personal']) {
            expect((await run(id, 'ls-remote')).stdout.toString()).toContain('refs/heads/main');
            expect((await run(id, 'clone', [id + '-copy'])).exitCode).toBe(0);
            expect(await fs.readFile(path.join(root, id + '-copy', 'binary.dat'))).toEqual(await fs.readFile(path.join(root, 'seed', 'binary.dat')));
        }
        expect(seen.map(item => item.identity)).toEqual(['work', 'work', 'personal', 'personal']);
        const copy = path.join(root, 'work-copy');
        git(['config', 'core.sshCommand', 'deliberately-missing-ssh'], copy);
        git(['config', 'core.hooksPath', path.join(root, 'untrusted-hooks')], copy);
        await fs.mkdir(path.join(root, 'untrusted-hooks'));
        await fs.writeFile(path.join(root, 'untrusted-hooks', 'reference-transaction'), '#!/bin/sh\necho untrusted > ' + path.join(root, 'hook-ran'), {mode: 0o700});
        expect((await run('work', 'fetch', [], {}, copy)).exitCode).toBe(0);
        await expect(fs.access(path.join(root, 'hook-ran'))).rejects.toThrow();
        expect((await run('work', 'push', ['refs/heads/main:refs/heads/main'], {}, path.join(root, 'work-copy'))).exitCode).toBe(0);
        const profiles=['work','personal'].map(id=>({...profile(id),host:'127.0.0.1',port:server.address().port,
            policy:{consumers:['git'],repositories:[{path:`/${id}/repo.git`,operations:['ls-remote','clone','fetch','push']}]}}));
        const authorizeTarget=(url,operation)=>{const selected=select(profiles,url,operation);return {...selected,
            credentials:{privateKey:keys[selected.profile.id].private,passphrase:selected.profile.id+' phrase'}};};
        const advanced=(args,cwd=copy)=>runGitTransport({Client,plan:{command:process.platform==='win32'?'git.exe':'/usr/bin/git',cwd,args,timeoutMs:15000},
            authorizeTarget,signal:new AbortController().signal,helperPath});
        expect((await advanced(['fetch','origin','--prune'])).exitCode).toBe(0);
        const seed=path.join(root,'seed'), head=git(['rev-parse','HEAD'],seed).toString().trim();
        await fs.writeFile(path.join(seed,'.gitmodules'),`[submodule "personal"]\npath = modules/personal\nurl = ssh://git@127.0.0.1:${server.address().port}/personal/repo.git\n`);
        git(['add','.gitmodules'],seed);git(['update-index','--add','--cacheinfo',`160000,${head},modules/personal`],seed);
        git(['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','add separately authorized module'],seed);
        git(['push',path.join(root,'work/repo.git'),'HEAD:refs/heads/main'],seed);
        expect((await advanced(['pull','origin','main','--ff-only'])).exitCode).toBe(0);
        const moduleResult=await advanced(['submodule','update','--init','--recursive']).catch(error=>{throw new Error(`${error.code}: ${error.gitFailure}`);});
        expect(moduleResult.exitCode).toBe(0);
        expect(await fs.readFile(path.join(copy,'modules/personal/binary.dat'))).toEqual(await fs.readFile(path.join(seed,'binary.dat')));
        expect(seen.at(-1).identity).toBe('personal');
        await expect(advanced(['fetch','missing-remote'])).rejects.toMatchObject({gitFailure:'REMOTE_NOT_FOUND'});
        git(['config','url.ssh://untrusted/rewrite.insteadOf','ssh://git@127.0.0.1'],path.join(copy,'modules/personal'));
        // Every initialized auxiliary repository is checked before reuse.
        await expect(advanced(['submodule','update','--init','--recursive'])).rejects.toMatchObject({gitFailure:'UNSAFE_REPOSITORY_CONFIG'});
        const beforeRewrite = seen.length;
        const original = `ssh://git@127.0.0.1:${server.address().port}/work/repo.git`;
        git(['config', 'url.ssh://wrong@127.0.0.1:' + server.address().port + '/other.git.insteadOf', original], copy);
        await expect(run('work', 'fetch', [], {}, copy)).rejects.toMatchObject({code: 'INVALID_REQUEST',gitFailure:'UNSAFE_REPOSITORY_CONFIG'});
        expect(seen.length).toBe(beforeRewrite);
        await expect(run('work', 'ls-remote', [], {trustedHostKey: fingerprint(Buffer.from('changed'))})).rejects.toMatchObject({code: 'HOST_KEY_REJECTED'});
    } finally {
        for (const child of processes) child.kill(); for (const connection of connections) connection.end();
        await new Promise(resolve => server.close(resolve)); await fs.rm(root, {recursive: true, force: true});
    }
}, 40000);
