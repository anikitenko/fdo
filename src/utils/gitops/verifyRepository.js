import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MAX_MANIFEST_BYTES, repositoryUrl, revision, repositoryPath, validateCollection, validateRepository} from './manifest';

const execute = promisify(execFile);

class RevisionResolutionError extends Error {}

export async function resolveTargetRevision(targetRevision, url, command) {
    // Full object IDs are exact pins, even if a ref happens to use that name.
    if (/^[a-f0-9]{40}$/i.test(targetRevision)) return {ref: targetRevision, type: 'commit'};
    const explicit = /^(refs\/heads\/|refs\/tags\/)/.test(targetRevision);
    const candidates = explicit || targetRevision === 'HEAD' ? [targetRevision]
        : [`refs/tags/${targetRevision}`, `refs/heads/${targetRevision}`];
    const {stdout} = await command(['ls-remote', '--', url, ...candidates]);
    const advertised = new Set(stdout.split('\n').map(line => line.split('\t')[1]?.trim()).filter(Boolean));
    // Git ref names, not naming conventions such as a "v" prefix, determine the type.
    const ref = candidates.find(candidate => advertised.has(candidate));
    if (!ref) throw new RevisionResolutionError(`The version “${targetRevision}” listed in this collection is unavailable in the plugin repository. Retry later or contact the collection maintainer to update the manifest. Any installed version remains unchanged.`);
    return {ref, type: ref.startsWith('refs/tags/') ? 'tag' : 'branch'};
}

// Credentials live only in this child environment, never in arguments or Git config files.
export function gitEnvironment(input, directory) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_|^SSH_ASKPASS$/.test(key)));
    const config = {
        'credential.helper': '', 'core.askPass': '', 'core.hooksPath': directory,
        'http.followRedirects': 'false', 'http.sslVerify': 'true',
        'protocol.allow': 'never', 'protocol.https.allow': 'always',
    };
    if (input.authType === 'basic') {
        config[`http.${input.url}/.extraHeader`] = `Authorization: Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`;
    }
    Object.assign(env, {
        GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_COUNT: String(Object.keys(config).length), GIT_LFS_SKIP_SMUDGE: '1',
    });
    Object.entries(config).forEach(([key, value], index) => {
        env[`GIT_CONFIG_KEY_${index}`] = key;
        env[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    return env;
}

export async function withGitRepository(input, action, run = execute) {
    const repository = {...input, url: repositoryUrl(input.url), targetRevision: revision(input.targetRevision)};
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fdo-gitops-'));
    try {
        const options = {cwd: directory, env: gitEnvironment({...input, ...repository}, directory),
            timeout: 30000, maxBuffer: MAX_MANIFEST_BYTES + 1024, windowsHide: true, encoding: 'utf8'};
        let commit;
        try {
            await run('git', ['init', '--bare', '--template=', '.'], options);
            const ref = repository.revisionType === 'auto'
                ? (await resolveTargetRevision(repository.targetRevision, repository.url, args => run('git', args, options))).ref
                : `refs/${repository.revisionType === 'branch' ? 'heads' : 'tags'}/${repository.targetRevision}`;
            await run('git', ['fetch', '--depth=1', '--no-tags', '--', repository.url, ref], options);
            ({stdout: commit} = await run('git', ['rev-parse', 'FETCH_HEAD^{commit}'], options));
        } catch (error) {
            if (error.code === 'ENOENT') throw new Error('Git is required. Install Git and make it available on PATH.');
            if (error instanceof RevisionResolutionError) throw error;
            // Never forward Git stderr: servers and URLs may contain secrets.
            throw new Error('Repository verification failed. Check the URL, branch, tag or commit, credentials, and network access.');
        }
        return await action({commit: commit.trim(), command: (args, overrides = {}) => run('git', args, {...options, ...overrides})});
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
}

export async function verifyRepository(input, run = execute) {
    const repository = validateRepository(input);
    return withGitRepository({...input, ...repository}, async ({commit, command}) => {
        let source;
        try {
            ({stdout: source} = await command(['show', `${commit}:${repository.manifestPath}`]));
        } catch {
            throw new Error('Cannot read the manifest at this revision. Check its path and the 256 KiB size limit.');
        }
        return {manifest: validateCollection(source), commit, verifiedAt: new Date().toISOString()};
    }, run);
}

export async function readPluginRepository(input, run = execute) {
    const prefix = repositoryPath(input.path, {root: true, field: 'Plugin path'});
    return withGitRepository({...input, revisionType: 'auto'}, async ({commit, command}) => {
        const tree = prefix ? `${commit}:${prefix}` : commit;
        let listing;
        try { ({stdout: listing} = await command(['ls-tree', '-rlz', tree], {maxBuffer: 1024 * 1024})); }
        catch { throw new Error('Cannot read the plugin directory at this revision.'); }
        const entries = listing.split('\0').filter(Boolean);
        if (entries.length > 2000) throw new Error('Plugin repositories must contain at most 2000 files.');
        const files = [];
        let total = 0;
        for (const entry of entries) {
            const match = /^(\d+) (\w+) ([a-f0-9]+) +([\d-]+)\t([\s\S]+)$/.exec(entry);
            if (!match) throw new Error('Unsupported Git tree entry.');
            const [, mode, type, hash, bytes, relative] = match;
            repositoryPath(relative, {field: 'Plugin file path'});
            if (['node_modules', '.git', '.fdo-gitops'].some(part => relative.split('/').includes(part))) continue;
            if (['fdo.signature', 'fdo.meta.json', '.fdoignore'].includes(relative)) continue;
            if (!['100644', '100755'].includes(mode) || type !== 'blob') throw new Error('Plugin directories cannot contain symlinks or Git submodules.');
            total += Number(bytes);
            if (Number(bytes) > 10 * 1024 * 1024 || total > 50 * 1024 * 1024) throw new Error('Plugin exceeds the 10 MiB file or 50 MiB directory limit.');
            const {stdout} = await command(['cat-file', 'blob', hash], {encoding: 'buffer', maxBuffer: 10 * 1024 * 1024});
            files.push({path: relative, content: Buffer.from(stdout)});
        }
        if (!files.length) throw new Error('The plugin directory is empty.');
        return {commit, files};
    }, run);
}
