import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bundledGit, environment as bundledGitEnvironment} from '../git/bundledGit.cjs';
import {MAX_MANIFEST_BYTES, repositoryUrl, revision, repositoryPath, validateCollection, validateRepository} from './manifest';

const execute = promisify(execFile);

class RevisionResolutionError extends Error {}

function repositoryFailure(error) {
    const detail = `${error?.stderr || ''}\n${error?.message || ''}`.toLowerCase();
    if (/cannot handle remote-https as a builtin|remote helper ['"]https['"] aborted/.test(detail)) {
        return 'FDO’s bundled Git HTTPS transport is incomplete. Reinstall or update FDO so it can repair its Git runtime.';
    }
    if (/could not resolve host|temporary failure in name resolution|name or service not known/.test(detail)) {
        return 'FDO could not resolve the repository host. Check your internet connection, DNS, VPN, or proxy settings.';
    }
    if (/ssl certificate problem|certificate verify failed|schannel:.*certificate/.test(detail)) {
        return 'FDO could not verify the repository’s TLS certificate. Check your system clock, network proxy, and certificate trust settings.';
    }
    if (/redirect|redirection|returned error: 30[1278]/.test(detail)) {
        return 'The repository URL redirected to another address. Use the canonical HTTPS Git URL shown by the repository host.';
    }
    if (/authentication failed|http basic: access denied|could not read username|invalid username or password/.test(detail)) {
        return 'The repository rejected the supplied credentials. For a public repository, set Authentication to None; for a private repository, re-enter a read-only access token.';
    }
    if (/couldn't find remote ref|could not find remote ref|not our ref|unadvertised object/.test(detail)) {
        return 'The selected branch, tag, or commit is not available from this repository. Check the revision and try again.';
    }
    if (/failed to connect|could not connect|connection timed out|operation timed out|network is unreachable/.test(detail)) {
        return 'FDO could not connect to the repository host. Check your internet connection, firewall, VPN, or proxy settings.';
    }
    return 'Repository verification failed. Check the URL, branch, tag or commit, credentials, and network access.';
}

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
        const git = bundledGit();
        const options = {cwd: directory, env: bundledGitEnvironment(gitEnvironment({...input, ...repository}, directory),git),
            timeout: 30000, maxBuffer: MAX_MANIFEST_BYTES + 1024, windowsHide: true, encoding: 'utf8'};
        let commit;
        try {
            await run(git.command, ['init', '--bare', '--template=', '.'], options);
            const ref = repository.revisionType === 'auto'
                ? (await resolveTargetRevision(repository.targetRevision, repository.url, args => run(git.command, args, options))).ref
                : `refs/${repository.revisionType === 'branch' ? 'heads' : 'tags'}/${repository.targetRevision}`;
            await run(git.command, ['fetch', '--depth=1', '--no-tags', '--', repository.url, ref], options);
            ({stdout: commit} = await run(git.command, ['rev-parse', 'FETCH_HEAD^{commit}'], options));
        } catch (error) {
            if (error.code === 'ENOENT') throw new Error('The bundled Git runtime could not start. Reinstall FDO or rebuild its bundled Git resources.');
            if (['EACCES', 'EPERM'].includes(error.code)) throw new Error('FDO’s bundled Git cannot run because executable permission was denied. Rebuild FDO’s main process or reinstall FDO. Repository credentials have not been checked.');
            if (error instanceof RevisionResolutionError) throw error;
            // Classify known transport failures without forwarding Git stderr,
            // which may contain private repository details or server responses.
            throw new Error(repositoryFailure(error));
        }
        return await action({commit: commit.trim(), command: (args, overrides = {}) => run(git.command, args, {...options, ...overrides})});
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
