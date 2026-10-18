import {STARTER_STYLES} from './starterStyles';

export function gitConnectionTemplateFiles(name) {
    return {
        // language=TEXT
        '/repositories.ts': `// Configure credential-free SSH URLs. Git must be installed on the host. FDO supplies the SSH transport.
// Assign each repository path to exactly one Git-authorized SSH profile in host Settings.
export const repositories = [
    {id: 'work', label: 'Work repository', url: 'git@github.com:your-team/work.git'},
    {id: 'personal', label: 'Personal repository', url: 'git@github.com:your-user/personal.git'},
];
export const gitExecutable: string = ''; // Auto-detect installed Git for this platform. Optional absolute, allowlisted path override.
export const cwd: string = ''; // Optional working folder for ls-remote; the host uses its default when omitted.
`,
        // language=TEXT
        '/permissions.ts': `import {createOperatorToolCapabilityPreset, createCapabilityBundle} from '@anikitenko/fdo-sdk';
export const requiredGitCapabilities = createCapabilityBundle([...createOperatorToolCapabilityPreset('git'), 'ssh.use', 'ssh.exec', 'secrets.use', 'secrets.consume']);
export function gitPermissions(granted: readonly string[]): {required: string[]; missing: string[]} {
    return {required: [...requiredGitCapabilities], missing: requiredGitCapabilities.filter(capability => !granted.includes(capability))};
}
`,
        // language=TEXT
        '/index.ts': `import {FDO_SDK, PluginRegistry, defineRenderOnLoadActions, requestOperatorTool} from '@anikitenko/fdo-sdk';
import {Render} from './render';
import {repositories, gitExecutable, cwd} from './repositories';
import {loadRepositories, inspectRepository, showRepositoryMatch} from './repository-ui';
import {gitError, gitScopeError, describeGitProfileMatch, needsGitSetup, parseRemoteRefs, readGitResult} from './logic';
import {gitPermissions, requiredGitCapabilities} from './permissions';
import {resolveGitExecutable} from './git-executable';
class GitConnections extends FDO_SDK {
    get metadata() {return {name: ${JSON.stringify(name)}, version: '1.0.0', author: 'Your team', description: 'Git repositories with separate SSH profiles', icon: 'git-repo'};}
    declareCapabilities() {return [...requiredGitCapabilities];}
    init(): void {
        PluginRegistry.registerHandler('listRepositories', () => ({repositories: repositories.map(repository => ({...repository, profileMatch: describeGitProfileMatch(repository.url)})),
            permissions: gitPermissions(PluginRegistry.getDiagnostics().capabilities.permissions.granted)}));
        PluginRegistry.registerHandler('inspectConnections', async (input: unknown) => {
            const permissions = gitPermissions(PluginRegistry.getDiagnostics().capabilities.permissions.granted);
            if (permissions.missing.length) return {message: 'Missing required capabilities: ' + permissions.missing.join(', ') + '. In Manage Plugins → Capabilities, select each listed grant independently, save, then refresh repositories.', permissions};
            const id = input && typeof input === 'object' && 'repositoryId' in input ? input.repositoryId : null;
            const repository = repositories.find(item => item.id === id);
            if (!repository) return {message: 'Choose a configured repository before listing references.'};
            if (needsGitSetup(repository.url, cwd)) {
                return {message: 'Configure the repository URL in repositories.ts first. Then authorize its repository path in Settings → Credentials & SSH.'};
            }
            let gitDetection = '';
            try {
                const deadline = Date.now() + 10000;
                const detected = await resolveGitExecutable(gitExecutable, cwd, deadline);
                if ('error' in detected) return {message: repository.label + ': ' + detected.error, gitDetection: detected.attempts.join('\\n')};
                const command = detected.command;
                gitDetection = detected.attempts.join('\\n') + '\\nUsing Git: ' + command + '\\nDetection stops after the first valid executable.';
                const response = await requestOperatorTool<{stdout: string; stderr: string; exitCode: number | null; durationMs: number; truncated?: boolean}>('git', {
                    command, args: ['ls-remote', repository.url], ...(cwd ? {cwd} : {}), timeoutMs: Math.max(1, deadline - Date.now()),
                });
                // Some host failures include captured output beyond the SDK error type.
                // Narrow that optional payload rather than asserting a success response.
                const result = readGitResult('result' in response ? response.result : undefined);
                if (response.ok && !result) return {message: repository.label + ': Git returned no readable command result. Review the plugin backend status.'};
                // Deliberately display this read-only command's output. Do not log it,
                // and review/redact fields before displaying output from other commands.
                return {gitDetection, message: repository.label + ': ' + (response.ok ? result?.exitCode === null ? 'reference listing completed without an exit status.' : 'references listed successfully.' : response.code === 'SCOPE_VIOLATION' ? gitScopeError('details' in response ? response.details : undefined, {command, cwd}) : gitError(response.code, 'details' in response ? response.details : undefined)) + (result?.truncated ? ' Output was truncated at the capture limit.' : '') + (!response.ok ? ' Request: ' + response.correlationId : ''),
                    stdout: result?.stdout || '', stderr: result?.stderr || '', refs: parseRemoteRefs(result?.stdout || '')};
            } catch {return {gitDetection, message: repository.label + ': Git could not complete the request. Review grants, repository authorization, saved credentials and trusted host key in Settings.'};}
        });
    }
    render(): string {return Render(${JSON.stringify(name)});}
    renderOnLoad() {
        return defineRenderOnLoadActions({strict: true, language: 'typescript', setup: loadRepositories,
            handlers: {showRepositoryMatch, refreshRepositories: loadRepositories, inspect: inspectRepository}, bindings: [
                {selector: '[data-role="repository"]', event: 'change', handler: 'showRepositoryMatch', required: true},
                {selector: '[data-role="refresh-repositories"]', event: 'click', handler: 'refreshRepositories', preventDefault: true, required: true},
                {selector: '[data-role="inspect"]', event: 'click', handler: 'inspect', preventDefault: true, required: true},
            ]});
    }
}
new GitConnections();
`,
        '/render.tsx': `import {DOM} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
import {escapeText} from './text';
export function Render(name: string): string {
    const dom = new DOM();
    const shell = dom.createClassFromStyle(styles.shell), panel = dom.createClassFromStyle(styles.panel), output = dom.createClassFromStyle(styles.commandOutput);
    return dom.renderHTML(dom.createElement('main', {class: shell}, [
        dom.createElement('h1', {}, escapeText(name)),
        dom.createElement('p', {}, 'Git must be installed on this machine. The template detects its platform and checks common installed Git paths; repositories.ts supports an optional path override. SSH is built into FDO. Choose a repository to list its remote references. Each URL automatically uses its matching authorized SSH profile, so work and personal repositories can use different keys. This action never pushes.'),
        dom.createElement('p', {}, 'In Manage Plugins → Capabilities, enable SSH connections and its Run remote SSH commands child. Independently approve scoped tool execution, the Git process scope, secret store access and credential consumption. Save, then refresh repositories. No checkbox grants its prerequisites automatically. Missing grants are listed below.'),
        dom.createElement('p', {}, 'Configure repositories.ts, then in Settings → Credentials & SSH select this plugin, authorize Git access and add each exact repository path to the appropriate profile. This Git-only profile does not need uptime or a general shell command policy. Keep “Use SSH profiles for this plugin’s Git network operations” enabled.'),
        dom.createElement('section', {class: panel, 'aria-label': 'Git repositories'}, [
            dom.createElement('p', {'data-role': 'repository-status', role: 'status'}, 'Loading configured repositories…'),
            dom.createElement('label', {for: 'git-repository'}, 'Git repository'),
            dom.createElement('select', {id: 'git-repository', 'data-role': 'repository', class: output, size: '4', disabled: 'disabled'}, ''),
            dom.createElement('button', {type: 'button', 'data-role': 'refresh-repositories', class: 'pure-button'}, 'Refresh repositories'),
            dom.createElement('button', {type: 'button', 'data-role': 'inspect', class: 'pure-button pure-button-primary', disabled: 'disabled'}, 'List remote references'),
        ].join('')),
        dom.createElement('section', {class: panel, 'aria-label': 'SSH profile matching'}, [
            dom.createElement('h2', {}, 'How this repository selects an SSH profile'),
            dom.createElement('p', {}, 'In Settings → Credentials & SSH select this installed plugin, then New Git SSH profile. Authorize Git and add the read path shown below. Each repository can use a different profile and private key.'),
            dom.createElement('pre', {'data-role': 'profile-match', class: output, 'aria-live': 'polite'}, 'Select a repository to see its matching criteria.'),
            dom.createElement('p', {}, 'These are required matching criteria, not a confirmed connection. The host checks the profile, credential and trusted host key when Git runs. Exactly one authorized profile must match; profiles belonging to other plugins are unavailable. No profile ID is passed to the Git CLI.'),
        ].join('')),
        dom.createElement('h2', {}, 'Git executable detection'),
        dom.createElement('pre', {'data-role': 'git-detection', class: output, 'aria-live': 'polite'}, 'Installed Git paths will be checked when you list references.'),
        dom.createElement('p', {'data-role': 'result', 'aria-live': 'polite'}, 'No Git connection opens until you click List remote references.'),
        dom.createElement('section', {class: panel, 'aria-label': 'Git output'}, [
            dom.createElement('label', {for: 'git-stdout'}, 'Standard output (stdout)'),
            dom.createElement('textarea', {id: 'git-stdout', 'data-role': 'stdout', class: output, rows: '7', readonly: 'readonly', placeholder: 'Git output appears here'}, ''),
            dom.createElement('label', {for: 'git-stderr'}, 'Standard error (stderr)'),
            dom.createElement('textarea', {id: 'git-stderr', 'data-role': 'stderr', class: output, rows: '3', readonly: 'readonly', placeholder: 'No error output'}, ''),
            dom.createElement('h2', {}, 'Parsed references'),
            dom.createElement('pre', {'data-role': 'parsed-output', class: output}, 'List references to see parsed branches, tags and HEAD.'),
            dom.createElement('p', {}, 'See parseRemoteRefs in logic.ts for an example that parses tab-separated object IDs and reference names. Empty repositories can return no references.'),
        ].join('')),
    ].join('')));
}
`,
        // language=TEXT
        '/git-executable.ts': `import {requestOperatorTool} from '@anikitenko/fdo-sdk';
import {platform} from 'node:os';
import {gitExecutableCandidates, gitScopeError} from './logic';
export async function resolveGitExecutable(override: string, cwd: string, deadline: number): Promise<{command: string; attempts: string[]} | {error: string; attempts: string[]}> {
    const configured = override.trim();
    const candidates = configured ? [configured] : gitExecutableCandidates(platform(), process.env);
    const attempts: string[] = [];
    for (const [index, command] of candidates.entries()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            return {error: 'Git discovery ran out of time after checking ' + attempts.length + ' of ' + candidates.length + ' paths. Unchecked: ' + candidates.slice(index).join(', ') + '. Retry after approving Git execution. Checked: ' + attempts.join('; '), attempts};
        }
        // These are local read-only version probes. A candidate-specific failure
        // (including a rejected bridge promise) must not prevent fallback.
        let response;
        try {
            const preflight = await requestOperatorTool<{availability?: {executable: boolean; cwd: boolean}}>('git', {command, args: ['version'], dryRun: true, ...(cwd ? {cwd} : {}), timeoutMs: Math.min(1000, remaining)}, {correlationId: 'git-detect-check-' + Date.now() + '-' + index});
            if (preflight.ok && preflight.result?.availability) {
                if (!preflight.result.availability.cwd) return {error: 'The working folder is missing or inaccessible. Check optional cwd in repositories.ts.', attempts};
                if (!preflight.result.availability.executable) {attempts.push(command + ' (NOT_AVAILABLE)'); continue;}
            }
            if (!preflight.ok) response = preflight;
            else response = await requestOperatorTool<{stdout: string}>('git', {command, args: ['version'], ...(cwd ? {cwd} : {}), timeoutMs: Math.min(1000, remaining)}, {correlationId: 'git-detect-' + Date.now() + '-' + index});
        } catch (error) {
            const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            const code = typeof rawCode === 'string' && /^[A-Z_]{1,64}$/.test(rawCode) ? rawCode : 'REQUEST_FAILED';
            attempts.push(command + ' (' + code + ')');
            if (['CAPABILITY_DENIED', 'CANCELLED', 'ACCESS_DENIED'].includes(code)) return {error: 'Git detection stopped: ' + code + '. Review Git Scope permissions and execution approval. Checked: ' + attempts.join('; '), attempts};
            continue;
        }
        if (!response || typeof response !== 'object') {attempts.push(command + ' (INVALID_RESPONSE)'); continue;}
        if (response.ok && response.result && 'stdout' in response.result && typeof response.result.stdout === 'string' && /^git version /i.test(response.result.stdout.trim())) {
            attempts.push(command + ' (FOUND)');
            return {command, attempts};
        }
        const code = response.ok ? 'UNEXPECTED_VERSION_OUTPUT' : response.code || 'UNKNOWN_ERROR';
        attempts.push(command + ' (' + code + ')');
        if (!response.ok && response.code === 'SCOPE_VIOLATION' && 'details' in response) {
            const details = response.details as {scopeViolation?: {reason?: string}} | undefined;
            if (details?.scopeViolation?.reason?.startsWith('CWD_')) return {error: gitScopeError(details, {command, cwd}), attempts};
        }
        if (['CAPABILITY_DENIED', 'CANCELLED', 'ACCESS_DENIED'].includes(code)) return {error: 'Git detection stopped: ' + code + '. Review Git Scope permissions and execution approval. Checked: ' + attempts.join('; '), attempts};
    }
    return {error: 'No usable installed Git executable was detected. ' + (configured ? 'Only the configured path override was checked; clear gitExecutable in repositories.ts to enable automatic fallback. ' : 'All ' + candidates.length + ' candidate paths were checked. ') + 'Install Git or set an absolute path allowed by Git Scope in repositories.ts. Also check optional cwd. Checked: ' + attempts.join('; '), attempts};
}
`,
        // language=TEXT
        '/repository-ui.ts': `// Serialized iframe callbacks must be self-contained.
export function showRepositoryMatch(): void {
    const select = document.querySelector<HTMLSelectElement>('[data-role="repository"]');
    const target = document.querySelector<HTMLElement>('[data-role="profile-match"]');
    if (target) target.textContent = select?.selectedOptions[0]?.dataset.profileMatch || 'Select a repository to see its matching criteria.';
}
export async function loadRepositories(): Promise<void> {
    const select = document.querySelector<HTMLSelectElement>('[data-role="repository"]');
    const status = document.querySelector<HTMLElement>('[data-role="repository-status"]');
    const run = document.querySelector<HTMLButtonElement>('[data-role="inspect"]');
    const refresh = document.querySelector<HTMLButtonElement>('[data-role="refresh-repositories"]');
    if (!select || !status || !run || !refresh) return;
    const match = document.querySelector<HTMLElement>('[data-role="profile-match"]');
    if (match) match.textContent = 'Loading matching criteria…';
    const previous = select.value;
    select.disabled = true; run.disabled = true; refresh.disabled = true;
    status.textContent = 'Loading configured repositories…';
    try {
        const result = await window.createBackendReq('UI_MESSAGE', {handler: 'listRepositories', content: {}});
        if (!select.isConnected) return;
        if (!Array.isArray(result?.repositories)) {
            status.textContent = 'The repository list is temporarily unavailable. If you just saved capabilities, wait for the plugin to restart, then refresh repositories.';
            return;
        }
        select.replaceChildren();
        const repositories = result.repositories;
        for (const item of repositories) {
            if (typeof item?.id !== 'string' || typeof item.label !== 'string' || typeof item.url !== 'string') continue;
            const option = document.createElement('option'); option.value = item.id; option.dataset.profileMatch = typeof item.profileMatch === 'string' ? item.profileMatch : 'Matching criteria unavailable. Refresh repositories.'; option.textContent = item.label + ' · ' + item.url; select.append(option);
        }
        if (select.options.length) {
            select.value = Array.from(select.options).some(option => option.value === previous) ? previous : select.options[0].value;
            const missing = Array.isArray(result?.permissions?.missing) ? result.permissions.missing.filter((item: unknown) => typeof item === 'string') : null;
            select.disabled = false; run.disabled = !missing || missing.length > 0;
            status.textContent = !missing ? 'Could not verify capability grants. Refresh repositories before running Git.'
                : missing.length ? 'Missing required capabilities: ' + missing.join(', ') + '. In Manage Plugins → Capabilities, select each listed grant independently, save, then refresh repositories. ssh.use alone does not allow execution.'
                : select.options.length + (select.options.length === 1 ? ' repository configured.' : ' repositories configured.') + ' Required capabilities are granted. Profile authorization is checked when running Git.';
        } else {status.textContent = 'No repositories configured. Add credential-free SSH URLs in repositories.ts, then authorize their Git repository paths in Settings → Credentials & SSH.';}
    } catch {status.textContent = 'Could not load repositories. Refresh and review the plugin backend status.';}
    finally {if (select.isConnected) {refresh.disabled = false; if (match) match.textContent = select.selectedOptions[0]?.dataset.profileMatch || 'Select a configured repository to see its matching criteria.';}}
}
export async function inspectRepository(): Promise<void> {
    const select = document.querySelector<HTMLSelectElement>('[data-role="repository"]');
    const target = document.querySelector<HTMLElement>('[data-role="result"]');
    const run = document.querySelector<HTMLButtonElement>('[data-role="inspect"]');
    const refresh = document.querySelector<HTMLButtonElement>('[data-role="refresh-repositories"]');
    const stdout = document.querySelector<HTMLTextAreaElement>('[data-role="stdout"]');
    const stderr = document.querySelector<HTMLTextAreaElement>('[data-role="stderr"]');
    const parsed = document.querySelector<HTMLElement>('[data-role="parsed-output"]');
    if (!select?.value || !target || !run || !refresh || !stdout || !stderr || !parsed) return;
    const detection = document.querySelector<HTMLElement>('[data-role="git-detection"]');
    if (detection) detection.textContent = 'Checking installed Git candidates…';
    const repositoryId = select.value; select.disabled = true; run.disabled = true; refresh.disabled = true;
    stdout.value = ''; stderr.value = ''; parsed.textContent = 'Waiting for Git output…'; target.textContent = 'Listing references for the selected repository…';
    try {
        const result = await window.createBackendReq('UI_MESSAGE', {handler: 'inspectConnections', content: {repositoryId}});
        if (!target.isConnected) return;
        if (detection) detection.textContent = typeof result?.gitDetection === 'string' ? result.gitDetection : 'No detection details returned. Review the command status.';
        target.textContent = typeof result?.message === 'string' ? result.message : 'No Git result was returned. Review the plugin backend status.';
        stdout.value = typeof result?.stdout === 'string' ? result.stdout : '';
        stderr.value = typeof result?.stderr === 'string' ? result.stderr : '';
        parsed.textContent = Array.isArray(result?.refs) ? JSON.stringify(result.refs, null, 2) : 'No parsed references received. Review the command status.';
    } catch {if (detection) detection.textContent = 'Git detection or execution did not complete. Review the command status.'; target.textContent = 'Could not list references. Review this plugin’s Git grants and repository profile in Settings.'; parsed.textContent = 'No Git output received.';}
    finally {if (select.isConnected) {select.disabled = false; run.disabled = false; refresh.disabled = false;}}
}
`,
        // language=TEXT
        '/logic.ts': `export function gitExecutableCandidates(platform: string, env: Record<string, string | undefined>): string[] {
    if (platform === 'win32') {
        const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:/Program Files', 'C:/Program Files (x86)', env.LOCALAPPDATA ? env.LOCALAPPDATA + '/Programs' : undefined].filter((root): root is string => !!root);
        return [...new Set(roots.flatMap(root => [root.replace(/\\\\/g, '/') + '/Git/cmd/git.exe', root.replace(/\\\\/g, '/') + '/Git/bin/git.exe']))];
    }
    return platform === 'darwin' ? ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'] : ['/usr/bin/git', '/usr/local/bin/git'];
}
// Display criteria only; the host independently validates and authorizes every operation.
export function describeGitProfileMatch(remote: string): string {
    let host: string, username: string, path: string, port = 22;
    try {
        if (remote.startsWith('ssh://')) {
            const url = new URL(remote);
            if (!url.hostname || !url.username || url.password || url.search || url.hash) return 'Configure a credential-free SSH repository URL in repositories.ts to see its matching criteria.';
            host = url.hostname.replace(/^\\[|\\]$/g, ''); username = url.username; path = url.pathname; port = Number(url.port || 22);
        } else {
            const match = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9.-]+):(.+)$/.exec(remote);
            if (!match) return 'Configure a credential-free SSH repository URL in repositories.ts to see its matching criteria.';
            username = match[1]; host = match[2]; path = match[3];
        }
        return 'Hostname: ' + host + '\\nPort: ' + port + '\\nSSH username: ' + username + '\\nRead repository path: ' + path + '\\nOperation: read (ls-remote)';
    } catch {return 'Configure a credential-free SSH repository URL in repositories.ts to see its matching criteria.';}
}
export function gitScopeError(details: unknown, context: {command: string; cwd: string}): string {
    // Interpret only host-owned validation metadata. Never echo provider errors.
    const info = details && typeof details === 'object' ? details : null;
    const violation = info && 'scopeViolation' in info ? info.scopeViolation : null;
    const reason = violation && typeof violation === 'object' && 'reason' in violation ? violation.reason : '';
    if (reason === 'CWD_OUTSIDE_ALLOWED_ROOTS' || reason === 'CWD_PATH_NOT_ABSOLUTE') {
        const roots = info && 'allowedCwdRoots' in info && Array.isArray(info.allowedCwdRoots)
            ? info.allowedCwdRoots.filter((root: unknown): root is string => typeof root === 'string') : [];
        return 'Working folder "' + context.cwd + '" is not allowed by Git Scope. Set cwd in repositories.ts to an existing absolute folder inside an allowed root, then compile and redeploy.'
            + (roots.length ? ' Allowed roots: ' + roots.join(', ') + '.' : ' See Manage Plugins → Capabilities → Git Scope → View policy details for allowed working folders.');
    }
    if (reason === 'COMMAND_NOT_ALLOWLISTED' || reason === 'COMMAND_PATH_NOT_ABSOLUTE') {
        return 'Git executable "' + context.command + '" is not allowed by Git Scope. Set gitExecutable in repositories.ts to an allowed absolute Git path, then compile and redeploy. Review allowed executables in Manage Plugins → Capabilities → Git Scope → View policy details.';
    }
    return 'Git Scope rejected this request. Check the executable, working folder and command syntax in repositories.ts against Manage Plugins → Capabilities → Git Scope → View policy details. Capability grants are separate from these scope restrictions.';
}
export function needsGitSetup(url: string, workingFolder: string): boolean {
    return workingFolder === '/replace/with/authorized/folder' || url.includes('your-team/') || url.includes('your-user/');
}
export function readGitResult(value: unknown): {stdout: string; stderr: string; exitCode: number | null; truncated: boolean} | null {
    if (!value || typeof value !== 'object' || !('stdout' in value) || typeof value.stdout !== 'string'
        || !('stderr' in value) || typeof value.stderr !== 'string') return null;
    const exitCode = 'exitCode' in value && typeof value.exitCode === 'number' && Number.isInteger(value.exitCode) ? value.exitCode : null;
    return {stdout: value.stdout, stderr: value.stderr, exitCode, truncated: 'truncated' in value && value.truncated === true};
}
export function parseRemoteRefs(stdout: string): {objectId: string; ref: string; kind: string}[] {
    // ls-remote emits <object-id> TAB <ref>. Support SHA-1 and SHA-256 repositories.
    // Keep peeled tag entries (^{}) as their own references.
    return stdout.split(/\\r?\\n/).flatMap(line => {
        const match = /^([a-f0-9]{40}|[a-f0-9]{64})\\t(HEAD|refs\\/[^\\s]+)$/.exec(line);
        if (!match) return [];
        const ref = match[2];
        return [{objectId: match[1], ref, kind: ref === 'HEAD' ? 'head' : ref.startsWith('refs/heads/') ? 'branch' : ref.startsWith('refs/tags/') ? 'tag' : 'other'}];
    });
}
export function gitError(code?: string, details?: unknown): string {
    const reason = details && typeof details === 'object' && 'gitFailure' in details && typeof details.gitFailure === 'string' ? details.gitFailure : '';
    const fixes: Record<string, string> = {
        AUTHENTICATION_FAILED: 'The server rejected the selected profile’s credential. Check its SSH username, private key/password and optional passphrase. For GitHub use username git and a key authorized for this repository.',
        DNS_LOOKUP_FAILED: 'The SSH hostname could not be resolved. Check the profile hostname and network/VPN.',
        CONNECTION_REFUSED: 'The SSH endpoint refused the connection. Check the profile hostname, port and firewall/VPN.',
        HELPER_ARGUMENTS_REJECTED: 'The host rejected Git’s SSH transport arguments. Update FDO; this is a host transport compatibility error.',
        HELPER_NOT_CONNECTED: 'The built-in Git SSH helper did not connect. Restart/update FDO and report this request ID if it persists.',
        GIT_EXECUTABLE_OR_CWD_MISSING: 'The configured Git executable or working folder does not exist. Check gitExecutable and optional cwd in repositories.ts; Git must be installed on this machine.',
        GIT_EXECUTABLE_NOT_PERMITTED: 'The operating system refused to execute Git. Check permissions on the configured executable and working folder.',
        REMOTE_COMMAND_REJECTED: 'The SSH server rejected the Git service request. Check repository access and whether this server supports Git over SSH.',
        REMOTE_EXIT_STATUS_MISSING: 'The server closed the Git service without an exit status. Check server health and Git service compatibility.',
        CONNECTION_CLOSED: 'The SSH connection closed before Git completed. Check server availability and network/VPN.',
        PROFILE_NOT_FOUND: 'No Git-authorized profile matches this plugin, hostname, port, SSH username, exact repository path and read operation. Compare Settings with the matching criteria shown above.',
        PROFILE_AMBIGUOUS: 'More than one Git-authorized profile matches. Remove the duplicate repository authorization so exactly one profile matches.',
        REMOTE_NOT_FOUND: 'The selected named remote is missing or has multiple URLs. Review git remote -v in this working copy and configure one SSH URL for that remote.',
        UNSAFE_REPOSITORY_CONFIG: 'This working copy contains a URL rewrite, executable helper, redirected worktree or other unsafe configuration. Review its Git config and submodule configuration before retrying.',
        LFS_HTTPS_DESTINATION_DENIED: 'Git LFS requested an unapproved HTTPS server or CDN. Review the repository’s LFS endpoint and authorize its trusted HTTPS origin in this profile’s Additional Git LFS HTTPS destinations field.',
    };
    if (!['HOST_KEY_REJECTED', 'TIMEOUT', 'LOCKED'].includes(code || '') && Object.hasOwn(fixes, reason)) return '[' + code + ' / ' + reason + '] ' + fixes[reason];
    switch (code) {
        case 'ACCESS_DENIED': return 'Git profile access was denied. In Settings → Credentials & SSH, select this installed plugin, create or edit its SSH profile, authorize Git access and add the exact repository path. Enable Use SSH profiles for this plugin’s Git network operations. Profiles saved for another plugin cannot be used here. Exactly one profile must match the host, port, username and repository path.';
        case 'CAPABILITY_DENIED': return 'Git permissions are missing. Approve Git process execution, SSH access and secret consumption in Manage Plugins.';
        case 'HOST_KEY_REJECTED': return 'The server identity could not be verified. Review the trusted host key in Settings.';
        case 'LOCKED': return 'Unlock your system credential store and retry.';
        case 'TIMEOUT': return 'Git timed out. Check the server and network connection.';
        case 'PROCESS_EXIT_NON_ZERO': return 'Git exited unsuccessfully. Review stderr below.';
        case 'SCOPE_VIOLATION': return 'Review the allowlisted Git executable and authorized working folder.';
        case 'CONNECTION_FAILED': return '[CONNECTION_FAILED] SSH transport failed before reference listing completed. Check server availability, profile authentication and repository access. Report the request ID if it persists.';
        case 'UNAVAILABLE': return 'Saved credentials or SSH profile storage are unavailable. Review Settings.';
        default: return 'Git could not list references (' + (code || 'NO_ERROR_CODE') + '). Review stderr below and include the request ID when reporting the failure.';
    }
}
`,
        // language=TEXT
        '/text.ts': `export function escapeText(value: unknown): string {
    return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char));
}
`,
        '/styles.css': STARTER_STYLES + '\n.commandOutput {display: block; box-sizing: border-box; width: 100%; margin: 8px 0 16px; padding: 12px; color: #e6edf3; background: #101820; border: 1px solid #607789; border-radius: 8px; font-family: monospace; white-space: pre-wrap; overflow-wrap: anywhere; resize: vertical;}\n',
        // language=TEXT
        '/starter.test.ts': `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Render} from './render';
import {parseRemoteRefs, gitError} from './logic';
import {gitPermissions, requiredGitCapabilities} from './permissions';
test('declares the full Git grant bundle and reports all missing operations', () => {
    const expected = ['system.process.exec', 'system.process.scope.git', 'ssh.use', 'ssh.exec', 'secrets.use', 'secrets.consume'];
    assert.deepEqual([...requiredGitCapabilities].sort(), [...expected].sort());
    assert.deepEqual(gitPermissions(['ssh.use']).missing.sort(), expected.filter(capability => capability !== 'ssh.use').sort());
    assert.deepEqual(gitPermissions(expected).missing, []);
});
test('renders a repository picker and read-only output fields', () => {
    const html = Render('<Git>'); assert.ok(html.includes('&lt;Git&gt;')); assert.match(html, /data-role="repository"/); assert.match(html, /data-role="stdout"/); assert.match(html, /readonly/);
});
test('parses branches, tags and SHA-256 references without accepting malformed lines', () => {
    const refs = parseRemoteRefs('a'.repeat(40) + '\\tHEAD\\n' + 'b'.repeat(64) + '\\trefs/heads/main\\n' + 'c'.repeat(40) + '\\trefs/tags/v1^{}\\nmalformed');
    assert.deepEqual(refs.map(item => item.kind), ['head', 'branch', 'tag']); assert.deepEqual(parseRemoteRefs(''), []);
    assert.ok(gitError('ACCESS_DENIED').includes('profile')); assert.ok(gitError('PROCESS_EXIT_NON_ZERO').includes('stderr'));
});
`,
    };
}
