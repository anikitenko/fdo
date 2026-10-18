/** @jest-environment node */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, writeFile, symlink, rm, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {verifyRepository, readPluginRepository, resolveTargetRevision, gitEnvironment} from '../../src/utils/gitops/verifyRepository';

const execute = promisify(execFile);
const manifest = `apiVersion: fdo.dev/v1alpha1
kind: PluginCollection
metadata:
  name: tools
  version: 1.0.0
spec:
  plugins:
    - name: example
      repository: https://github.com/acme/example
      targetRevision: main
      path: /
`;
const input = {url: 'https://github.com/acme/tools.git', authType: 'basic', username: 'alice', password: 'secret-value', manifestPath: 'plugins.yaml', revisionType: 'branch', targetRevision: 'main'};

test('fetches and reads a real Git branch and tag without checking out code; removes temporary data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fdo-gitops-test-'));
    try {
        const git = args => execute('git', args, {cwd: root});
        await git(['init', '--initial-branch=main', '--template=']);
        await writeFile(path.join(root, 'plugins.yaml'), manifest);
        await mkdir(path.join(root, 'plugin'));
        await writeFile(path.join(root, 'plugin/package.json'), '{"main":"index.cjs"}');
        await writeFile(path.join(root, 'plugin/index.cjs'), 'module.exports = {};');
        await writeFile(path.join(root, 'plugin/icon.png'), Buffer.from([0, 255, 0, 127]));
        await git(['add', '.']);
        await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgSign=false', 'commit', '-m', 'collection']);
        await git(['tag', 'v1.0.0']);
        const seen = [];
        const run = (command, args, options) => {
            seen.push({command, args, options});
            // Exercise the production Git commands against a local fixture instead of the network.
            if (['fetch', 'ls-remote'].includes(args[0])) args = ['-c', 'protocol.file.allow=always', ...args.map(arg => arg === input.url ? `file://${root}` : arg)];
            return execute(command, args, options);
        };
        for (const config of [input, {...input, revisionType: 'tag', targetRevision: 'v1.0.0'}]) {
            const result = await verifyRepository(config, run);
            expect(result.manifest.metadata.name).toBe('tools');
            expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
        }
        const snapshot = await readPluginRepository({...input, targetRevision: 'v1.0.0', path: '/plugin'}, run);
        expect(snapshot.files.map(file => file.path)).toEqual(['icon.png', 'index.cjs', 'package.json']);
        expect(snapshot.files[0].content).toEqual(Buffer.from([0, 255, 0, 127]));
        expect(snapshot.files[1].content.toString()).toBe('module.exports = {};');
        const pinnedCommit = snapshot.commit;
        await symlink('../plugins.yaml', path.join(root, 'plugin/unsafe-link'));
        await git(['add', '.']);
        await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgSign=false', 'commit', '-m', 'symlink']);
        await expect(readPluginRepository({...input, path: '/plugin'}, run)).rejects.toThrow('symlinks');
        // A same-named branch must not move a tag-pinned plugin to different code.
        await git(['branch', 'v1.0.0']);
        const collision = await readPluginRepository({...input, targetRevision: 'v1.0.0', path: '/plugin'}, run);
        expect(collision.commit).toBe(pinnedCommit);
        const pinned = await readPluginRepository({...input, targetRevision: pinnedCommit, path: '/plugin'}, run);
        expect(pinned.commit).toBe(pinnedCommit);
        await expect(readPluginRepository({...input, targetRevision: 'refs/heads/v1.0.0', path: '/plugin'}, run)).rejects.toThrow('symlinks');
        expect(JSON.stringify(seen.map(item => item.args))).not.toContain(input.password);
        for (const call of seen) await expect(access(call.options.cwd)).rejects.toThrow();
    } finally { await rm(root, {recursive: true, force: true}); }
});

test.each([
    ['main', ['refs/heads/main'], {ref: 'refs/heads/main', type: 'branch'}],
    ['v1.0.0', ['refs/heads/v1.0.0'], {ref: 'refs/heads/v1.0.0', type: 'branch'}],
    ['production', ['refs/tags/production'], {ref: 'refs/tags/production', type: 'tag'}],
    ['release', ['refs/heads/release', 'refs/tags/release'], {ref: 'refs/tags/release', type: 'tag'}],
    ['refs/heads/release', ['refs/heads/release'], {ref: 'refs/heads/release', type: 'branch'}],
    ['refs/tags/release', ['refs/tags/release', 'refs/tags/release^{}'], {ref: 'refs/tags/release', type: 'tag'}],
    ['HEAD', ['HEAD'], {ref: 'HEAD', type: 'branch'}],
])('resolves %s by exact advertised Git references', async (value, refs, expected) => {
    const command = jest.fn(async () => ({stdout: refs.map(ref => `${'a'.repeat(40)}\t${ref}`).join('\n')}));
    expect(await resolveTargetRevision(value, input.url, command)).toEqual(expected);
    expect(command.mock.calls[0][0].slice(0, 3)).toEqual(['ls-remote', '--', input.url]);
});

test('full commit SHA bypasses ref discovery', async () => {
    const command = jest.fn();
    const sha = 'a'.repeat(40);
    expect(await resolveTargetRevision(sha, input.url, command)).toEqual({ref: sha, type: 'commit'});
    expect(command).not.toHaveBeenCalled();
});

test('rejects missing references, abbreviated SHAs, and suffix-only matches', async () => {
    for (const value of ['missing', 'abcdef1', 'release']) {
        const command = async () => ({stdout: `${'a'.repeat(40)}\trefs/heads/nested/${value}\n`});
        await expect(resolveTargetRevision(value, input.url, command)).rejects.toThrow('contact the collection maintainer');
    }
});

test('isolates credentials from global Git config and scopes the authorization header to this URL', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fdo-gitops-config-'));
    try {
        // Match production's fresh bare repository, never the CI checkout's local auth config.
        await execute('git', ['init', '--bare', '--template=', directory]);
        const env = gitEnvironment(input, directory);
        const options = {cwd: directory, env};
        expect(env.GIT_TERMINAL_PROMPT).toBe('0');
        expect(env.GIT_CONFIG_GLOBAL).toBe(os.devNull);
        const matched = await execute('git', ['config', '--get-urlmatch', 'http.extraHeader', `${input.url}/info/refs`], options);
        expect(matched.stdout.trim()).toBe(`Authorization: Basic ${Buffer.from('alice:secret-value').toString('base64')}`);
        await expect(execute('git', ['config', '--get-urlmatch', 'http.extraHeader', 'https://github.com/acme/another.git/info/refs'], options)).rejects.toThrow();
        const publicEnv = gitEnvironment({...input, authType: 'none'}, directory);
        expect(JSON.stringify(publicEnv)).not.toContain(Buffer.from('alice:secret-value').toString('base64'));
    } finally {await rm(directory, {recursive: true, force: true});}
});

test('redacts server failures and always cleans up after failed verification', async () => {
    let directory;
    const run = jest.fn(async (_command, _args, options) => {directory = options.cwd; throw new Error('secret-value in stderr');});
    await expect(verifyRepository(input, run)).rejects.toThrow('Repository verification failed.');
    await expect(access(directory)).rejects.toThrow();
});

test('distinguishes a missing Git executable', async () => {
    await expect(verifyRepository(input, async () => {throw Object.assign(new Error(), {code: 'ENOENT'});})).rejects.toThrow('bundled Git runtime could not start');
});

test.each(['EACCES','EPERM'])('reports bundled Git startup permission failure %s without blaming repository credentials', async code => {
    await expect(verifyRepository(input, async () => {throw Object.assign(new Error('secret-value'),{code});}))
        .rejects.toThrow('bundled Git cannot run because executable permission was denied');
});
