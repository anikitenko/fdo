import {beforeEach, expect, jest, test} from '@jest/globals';
import {stripTypeScriptTypes} from 'node:module';
import {createOperatorToolActionRequest} from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
const files = createPluginTemplateFiles({name: 'git-test', template: 'gitSsh'});
const {loadRepositories, inspectRepository, showRepositoryMatch} = new Function(stripTypeScriptTypes(files['/repository-ui.ts']).replace(/^export /gm, '') + '\nreturn {loadRepositories, inspectRepository, showRepositoryMatch};')();
const {parseRemoteRefs, gitError, gitScopeError, describeGitProfileMatch, gitExecutableCandidates, gitRequestPaths} = new Function(stripTypeScriptTypes(files['/logic.ts']).replace(/^export /gm, '') + '\nreturn {parseRemoteRefs, gitError, gitScopeError, describeGitProfileMatch, gitExecutableCandidates, gitRequestPaths};')();
// Legacy hosts return a successful dry-run plan without availability metadata.
const withPreflight = request => (tool, payload, options) => payload.dryRun
    ? Promise.resolve({ok: true, result: {dryRun: true}}) : request(tool, payload, options);
beforeEach(() => {
    document.body.innerHTML = '<pre data-role="git-detection"></pre><pre data-role="profile-match"></pre><select data-role="repository"></select><p data-role="repository-status"></p><button data-role="inspect"></button><button data-role="refresh-repositories"></button><p data-role="result"></p><textarea data-role="stdout" readonly></textarea><textarea data-role="stderr" readonly></textarea><pre data-role="parsed-output"></pre>';
    window.createBackendReq = jest.fn();
});
test('empty configuration disables execution and gives Git-specific setup guidance', async () => {
    window.createBackendReq.mockResolvedValue({repositories: []}); await loadRepositories();
    expect(document.querySelector('[data-role="inspect"]')).toBeDisabled();
    expect(document.querySelector('[data-role="repository-status"]')).toHaveTextContent('repositories.ts');
    await inspectRepository(); expect(window.createBackendReq).toHaveBeenCalledTimes(1);
});

test('scope failures name the rejected folder or executable and explain the exact configuration fix', () => {
    const context = {cwd: '/tmp', command: '/usr/bin/git'};
    const message = gitScopeError({scopeViolation: {reason: 'CWD_OUTSIDE_ALLOWED_ROOTS'}, allowedCwdRoots: ['/home/team'], error: 'private provider detail'}, context);
    expect(message).toContain('Working folder "/tmp"');
    expect(message).toContain('Set cwd in repositories.ts');
    expect(message).toContain('Allowed roots: /home/team');
    expect(message).not.toContain('private provider detail');
    expect(gitScopeError({scopeViolation: {reason: 'COMMAND_NOT_ALLOWLISTED'}}, context)).toContain('Git executable "/usr/bin/git"');
    expect(gitScopeError(null, context)).toContain('Capability grants are separate');
});
test('retains the repository selection and displays literal output for only the selected repository', async () => {
    window.createBackendReq.mockResolvedValue({permissions: {missing: []}, repositories: [{id: 'work', label: /* language=TEXT */ '<img src=x>', url: 'git@example:work.git'}, {id: 'personal', label: 'Personal', url: 'git@example:personal.git'}]});
    await loadRepositories(); const select = document.querySelector('[data-role="repository"]'); select.value = 'personal';
    await loadRepositories(); expect(select.value).toBe('personal'); expect(document.querySelector('img')).toBeNull();
    const stdout = 'a'.repeat(40) + '\trefs/heads/main\n';
    window.createBackendReq.mockResolvedValue({message: 'Personal: references listed successfully.', stdout, stderr: /* language=TEXT */ '<img src=x>', refs: parseRemoteRefs(stdout)});
    await inspectRepository();
    expect(window.createBackendReq).toHaveBeenLastCalledWith('UI_MESSAGE', {handler: 'inspectConnections', content: {repositoryId: 'personal'}});
    expect(document.querySelector('[data-role="stdout"]')).toHaveValue(stdout);
    expect(document.querySelector('[data-role="stderr"]')).toHaveValue(/* language=TEXT */ '<img src=x>'); expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[data-role="parsed-output"]')).toHaveTextContent('"kind": "branch"');
    window.createBackendReq.mockRejectedValue(new Error('provider credential'));
    await inspectRepository();
    expect(document.querySelector('[data-role="stdout"]')).toHaveValue('');
    expect(document.querySelector('[data-role="stderr"]')).toHaveValue('');
    expect(document.querySelector('[data-role="result"]')).not.toHaveTextContent('provider credential');
});
test('parses SHA-1, SHA-256 and peeled tags, skips incomplete lines, and explains denied access', () => {
    expect(parseRemoteRefs('a'.repeat(40) + '\tHEAD\r\n' + 'b'.repeat(64) + '\trefs/tags/v1^{}\nmalformed\n' + 'c'.repeat(12) + '\trefs/heads/partial')).toEqual([
        {objectId: 'a'.repeat(40), ref: 'HEAD', kind: 'head'},
        {objectId: 'b'.repeat(64), ref: 'refs/tags/v1^{}', kind: 'tag'},
    ]);
    expect(gitError('ACCESS_DENIED')).toContain('Exactly one profile must match');
    expect(gitError('ACCESS_DENIED')).toContain('select this installed plugin');
    expect(gitError('PROCESS_EXIT_NON_ZERO')).toContain('stderr');
});

test('reports every missing prerequisite when only ssh.use is granted, without enabling Git', async () => {
    const missing = ['secrets.consume', 'secrets.use', 'ssh.exec', 'system.process.exec', 'system.process.scope.git'];
    const repositories = [{id: 'work', label: 'Work', url: 'git@example:work.git'}];
    window.createBackendReq.mockResolvedValue({repositories, permissions: {required: [...missing, 'ssh.use'], missing}});
    await loadRepositories();
    const status = document.querySelector('[data-role="repository-status"]');
    for (const capability of missing) expect(status).toHaveTextContent(capability);
    expect(document.querySelector('[data-role="inspect"]')).toBeDisabled();
    window.createBackendReq.mockResolvedValue({repositories, permissions: {missing: []}});
    await loadRepositories();
    expect(document.querySelector('[data-role="inspect"]')).toBeEnabled();
    expect(status).toHaveTextContent('Required capabilities are granted');
});

test('explains exact URL matching and updates criteria as the selected repository changes', async () => {
    const relative = describeGitProfileMatch('git@github.com:anikitenko/fdo.git');
    expect(relative).toBe('Hostname: github.com\nPort: 22\nSSH username: git\nRead repository path: anikitenko/fdo.git\nOperation: read (ls-remote)');
    expect(describeGitProfileMatch('ssh://git@github.com:2222/anikitenko/fdo.git')).toContain('Port: 2222\nSSH username: git\nRead repository path: /anikitenko/fdo.git');
    expect(describeGitProfileMatch('https://github.com/team/repo.git')).toContain('Configure a credential-free SSH');
    const personal = describeGitProfileMatch('git@github.com:personal/repo.git');
    window.createBackendReq.mockResolvedValue({permissions: {missing: []}, repositories: [
        {id: 'work', label: 'Work', url: 'git@github.com:anikitenko/fdo.git', profileMatch: relative},
        {id: 'personal', label: 'Personal', url: 'git@github.com:personal/repo.git', profileMatch: personal},
    ]});
    await loadRepositories();
    const target = document.querySelector('[data-role="profile-match"]');
    expect(target.textContent).toBe(relative);
    document.querySelector('[data-role="repository"]').value = 'personal';
    showRepositoryMatch();
    expect(target.textContent).toBe(personal);
    await loadRepositories();
    expect(target.textContent).toBe(personal);
});

test('shows safe transport diagnostics and concrete authentication remedies', () => {
    expect(gitError('CONNECTION_FAILED', {gitFailure: 'AUTHENTICATION_FAILED', providerMessage: 'SECRET'})).toContain('SSH username');
    expect(gitError('CONNECTION_FAILED', {gitFailure: 'AUTHENTICATION_FAILED', providerMessage: 'SECRET'})).not.toContain('SECRET');
    expect(gitError('CONNECTION_FAILED', {gitFailure: 'HELPER_ARGUMENTS_REJECTED'})).toContain('host transport compatibility');
    expect(gitError('ACCESS_DENIED', {gitFailure: 'PROFILE_AMBIGUOUS'})).toContain('duplicate');
    expect(gitError('CONNECTION_FAILED')).toContain('CONNECTION_FAILED');
    expect(gitError('HOST_KEY_REJECTED', {gitFailure: 'CONNECTION_CLOSED'})).toContain('trusted host key');
    expect(gitError('TIMEOUT', {gitFailure: 'CONNECTION_CLOSED'})).toContain('timed out');
    expect(files['/repositories.ts']).toContain("gitExecutable: string = ''");
    expect(gitError('UNAVAILABLE', {gitFailure: 'GIT_EXECUTABLE_OR_CWD_MISSING'})).toContain('Git must be installed');
});

test('selects platform-specific Git installation candidates, including Windows user installs', () => {
    expect(gitExecutableCandidates('darwin', {})).toEqual(['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git']);
    expect(gitExecutableCandidates('linux', {})).toEqual(['/usr/bin/git', '/usr/local/bin/git']);
    const windows = gitExecutableCandidates('win32', {ProgramFiles: String.raw`D:\Apps`, LOCALAPPDATA: 'C:/Users/alex/AppData/Local'});
    expect(windows).toContain('D:/Apps/Git/cmd/git.exe');
    expect(windows).toContain('C:/Users/alex/AppData/Local/Programs/Git/cmd/git.exe');
    expect(windows).not.toContain('/usr/bin/git');
});

test('Git detection uses local version probes and stops immediately on denied permission', async () => {
    const requestOperatorTool = jest.fn().mockResolvedValueOnce({ok: false, code: 'PROCESS_SPAWN_ENOENT'})
        .mockResolvedValueOnce({ok: true, result: {stdout: 'git version 2.50.0\n'}});
    const resolveGitExecutable = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
        stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
        withPreflight(requestOperatorTool), () => 'darwin', gitExecutableCandidates, gitScopeError, gitRequestPaths);
    expect(await resolveGitExecutable('', '', Date.now() + 10000)).toEqual(expect.objectContaining({command: '/usr/local/bin/git'}));
    expect(requestOperatorTool).toHaveBeenCalledTimes(2);
    for (const [tool, payload] of requestOperatorTool.mock.calls) {
        expect(tool).toBe('git'); expect(payload.args).toEqual(['version']); expect(payload).not.toHaveProperty('cwd');
    }
    requestOperatorTool.mockReset().mockResolvedValue({ok: false, code: 'CAPABILITY_DENIED'});
    expect(await resolveGitExecutable('', '', Date.now() + 10000)).toEqual(expect.objectContaining({error: expect.stringContaining('CAPABILITY_DENIED')}));
    expect(requestOperatorTool).toHaveBeenCalledTimes(1);
    requestOperatorTool.mockReset().mockResolvedValue({ok: false, code: 'SCOPE_VIOLATION', details: {scopeViolation: {reason: 'CWD_OUTSIDE_ALLOWED_ROOTS'}, allowedCwdRoots: ['/allowed']}});
    expect(await resolveGitExecutable('', '/rejected', Date.now() + 10000)).toEqual(expect.objectContaining({error: expect.stringContaining('Allowed roots: /allowed')}));
    expect(requestOperatorTool).toHaveBeenCalledTimes(1);
});

test('Git detection continues after rejected candidate probes and exposes every attempted path', async () => {
    const request = jest.fn().mockRejectedValueOnce(Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), {code: 'ENOENT'}))
        .mockResolvedValueOnce({ok: false, code: 'SCOPE_VIOLATION'})
        .mockResolvedValueOnce({ok: true, result: {stdout: 'git version 2.50.0'}});
    const resolve = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
        stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
        withPreflight(request), () => 'darwin', gitExecutableCandidates, gitScopeError, gitRequestPaths);
    const result = await resolve('', '', Date.now() + 10000);
    expect(result).toEqual({command: '/usr/bin/git', attempts: ['/opt/homebrew/bin/git (ENOENT)', '/usr/local/bin/git (SCOPE_VIOLATION)', '/usr/bin/git (FOUND)']});
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_DETAIL');
    expect(new Set(request.mock.calls.map(call => call[2].correlationId)).size).toBe(3);
    request.mockReset().mockResolvedValue({ok: false, code: 'PROCESS_SPAWN_ENOENT'});
    const overridden = await resolve('/custom/git', '', Date.now() + 10000);
    expect(overridden.error).toContain('Only the configured path override');
    expect(request).toHaveBeenCalledTimes(1);
});

test('a discovery deadline reports untested candidates instead of claiming Git is absent', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
        const request = jest.fn(async () => {now.mockReturnValue(20000); return {ok: false, code: 'PROCESS_SPAWN_ENOENT'};});
        const resolve = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
            stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
            withPreflight(request), () => 'darwin', gitExecutableCandidates, gitScopeError, gitRequestPaths);
        const result = await resolve('', '', 10000);
        expect(result.error).toContain('after checking 1 of 3 paths');
        expect(result.error).toContain('Unchecked: /usr/local/bin/git, /usr/bin/git');
        expect(result.error).not.toContain('No usable installed');
    } finally {now.mockRestore();}
});

test('missing probe responses do not abort automatic fallback', async () => {
    const request = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL'))
        .mockResolvedValueOnce({ok: true, result: {stdout: 'git version 2.50.0'}});
    const resolve = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
        stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
            withPreflight(request), () => 'darwin', gitExecutableCandidates, gitScopeError, gitRequestPaths);
    expect(await resolve('', '', Date.now() + 10000)).toEqual({command: '/usr/bin/git', attempts: ['/opt/homebrew/bin/git (INVALID_RESPONSE)', '/usr/local/bin/git (REQUEST_FAILED)', '/usr/bin/git (FOUND)']});
});

test('availability preflights skip missing installations without executing failing commands', async () => {
    const request = jest.fn(async (_tool, payload) => payload.dryRun
        ? {ok: true, result: {availability: {executable: payload.command === '/usr/bin/git', cwd: true}}}
        : {ok: true, result: {stdout: 'git version 2.50.0'}});
    const resolve = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
        stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
            request, () => 'darwin', gitExecutableCandidates, gitScopeError, gitRequestPaths);
    expect(await resolve('', '', Date.now() + 10000)).toEqual({command: '/usr/bin/git', attempts: ['/opt/homebrew/bin/git (NOT_AVAILABLE)', '/usr/local/bin/git (NOT_AVAILABLE)', '/usr/bin/git (FOUND)']});
    const executions = request.mock.calls.filter(([, payload]) => !payload.dryRun);
    expect(executions).toHaveLength(1);
    expect(executions[0][1].command).toBe('/usr/bin/git');
});


test('Windows Git discovery passes SDK validation and preserves working-folder scope errors', async () => {
    const details = {scopeViolation: {reason: 'CWD_OUTSIDE_ALLOWED_ROOTS'}, allowedCwdRoots: ['C:\\Users\\runneradmin']};
    const request = jest.fn((_tool, payload) => {
        // Exercise the real SDK validation that rejected forward-slash drive paths.
        createOperatorToolActionRequest('git', payload);
        return Promise.resolve({ok: false, code: 'SCOPE_VIOLATION', details});
    });
    const resolve = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
        stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
        request, () => 'win32', gitExecutableCandidates, gitScopeError, gitRequestPaths);
    const result = await resolve('', 'C:/fdo-disallowed-working-folder', Date.now() + 10000);
    expect(result.error).toContain('Working folder "C:/fdo-disallowed-working-folder"');
    expect(result.error).toContain('Allowed roots: C:\\Users\\runneradmin');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual(expect.objectContaining({
        command: 'C:\\Program Files\\Git\\cmd\\git.exe', cwd: 'C:\\fdo-disallowed-working-folder', dryRun: true,
    }));
});

test('Windows Git discovery normalizes overrides and execution paths for the SDK', async () => {
    const request = jest.fn((_tool, payload) => {
        createOperatorToolActionRequest('git', payload);
        return Promise.resolve({ok: true, result: payload.dryRun
            ? {availability: {executable: true, cwd: true}} : {stdout: 'git version 2.50.0'}});
    });
    const resolve = new Function('requestOperatorTool', 'platform', 'gitExecutableCandidates', 'gitScopeError', 'gitRequestPaths',
        stripTypeScriptTypes(files['/git-executable.ts']).replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn resolveGitExecutable;')(
        request, () => 'win32', gitExecutableCandidates, gitScopeError, gitRequestPaths);
    const result = await resolve('D:/Custom Git/git.exe', 'D:/work/repository', Date.now() + 10000);
    expect(result.command).toBe('D:/Custom Git/git.exe');
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, payload] of request.mock.calls) {
        expect(payload).toEqual(expect.objectContaining({command: 'D:\\Custom Git\\git.exe', cwd: 'D:\\work\\repository'}));
    }
    // The ls-remote request uses the same conversion as discovery.
    expect(createOperatorToolActionRequest('git', {...gitRequestPaths(result.command, 'D:/work/repository'), args: ['ls-remote', 'git@example:work.git']})).toBeTruthy();
    expect(gitRequestPaths('/usr/bin/git', '/home/team/repository')).toEqual({command: '/usr/bin/git', cwd: '/home/team/repository'});
    expect(gitRequestPaths('C:/Git/git.exe', '')).toEqual({command: 'C:\\Git\\git.exe'});
});
