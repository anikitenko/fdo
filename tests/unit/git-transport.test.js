/** @jest-environment node */
const {test, expect} = require('@jest/globals');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawn} = require('node:child_process');
const {Server, Client} = require('ssh2');
const {runGitTransport} = require('../../src/utils/hostServices/gitTransport.cjs');
const {helperTarget}=require('../../src/utils/hostServices/gitInvocation.cjs');
const {fingerprint} = require('../../src/utils/hostServices/ssh.cjs');
const {generateEd25519} = require('../../src/utils/hostServices/sshKeys.cjs');

test('missing working folders and malformed helper requests fail with safe diagnostics', async()=>{
    await expect(runGitTransport({Client,plan:{command:'git',cwd:path.join(os.tmpdir(),'fdo-missing-'+Date.now()),args:['fetch','origin']},
        signal:new AbortController().signal,helperPath:'unused'})).rejects.toMatchObject({code:'UNAVAILABLE',gitFailure:'GIT_EXECUTABLE_OR_CWD_MISSING',message:'Host service request failed.'});
    for(const args of [[{}],['-o','ProxyCommand=untrusted','git@host',"git-upload-pack 'repo.git'"]])expect(()=>helperTarget(args)).toThrow('Host service request failed.');
});

// Installed Git + bundled ssh2, no external SSH or public network.
test('installed Git supports scp-style and ssh:// paths and reports rejected authentication safely', async () => {
    const command = process.platform === 'win32' ? execFileSync('where', ['git'], {encoding: 'utf8'}).trim().split(/\r?\n/)[0] : execFileSync('/usr/bin/which', ['git'], {encoding: 'utf8'}).trim();
    const git = {command, env: {}}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-git-transport-test-'));
    const hostKey = generateEd25519();
    const trustedHostKey = fingerprint(hostKey.publicSSH);
    const sockets = new Set(), requests = [];
    const server = new Server({hostKeys: [hostKey.private]}, connection => {
        sockets.add(connection); connection.on('close', () => sockets.delete(connection)); connection.on('error', () => {});
        connection.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'fixture-password' ? ctx.accept() : ctx.reject());
        connection.on('ready', () => connection.on('session', accept => accept().on('exec', (acceptCommand, reject, info) => {
            if (!["git-upload-pack 'team/repo.git'", "git-upload-pack '/team/repo.git'"].includes(info.command)) return reject();
            requests.push(info.command);
            const channel = acceptCommand(), child = spawn(git.command, ['upload-pack', path.join(dir, 'remote.git')], {env: {...process.env, ...git.env}});
            channel.pipe(child.stdin); child.stdout.pipe(channel, {end: false}); child.stderr.pipe(channel.stderr);
            child.stdin.on('error', () => {}); channel.on('close', () => child.kill());
            child.on('close', code => {channel.exit(code); channel.end();});
        })));
    });
    try {
        execFileSync(git.command, ['init', '--bare', path.join(dir, 'remote.git')], {env: {...process.env, ...git.env}, stdio: 'pipe'});
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        const profile = {username: 'git', host: '127.0.0.1', port: server.address().port, trustedHostKey};
        const run = (repository, password = 'fixture-password') => runGitTransport({Client,
            plan: {command: git.command, cwd: dir, args: ['ls-remote', `ssh://git@127.0.0.1:${profile.port}${repository}`], timeoutMs: 5000},
            selection: {profile, repository}, operation: 'ls-remote', credentials: {password},
            signal: new AbortController().signal, helperPath: path.resolve(__dirname, '../../src/utils/hostServices/gitSshHelper.cjs')});
        expect(helperTarget(['git@127.0.0.1', "git-upload-pack 'team/repo.git'"])).toMatchObject({repository:'team/repo.git',port:22});
        expect((await run('/team/repo.git')).exitCode).toBe(0);
        expect(requests).toEqual(["git-upload-pack '/team/repo.git'"]);
        await expect(run('/team/repo.git', 'wrong-password')).rejects.toMatchObject({code: 'CONNECTION_FAILED', gitFailure: 'AUTHENTICATION_FAILED', message: 'Host service request failed.'});
    } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, {recursive: true, force: true});
    }
}, 20000);
