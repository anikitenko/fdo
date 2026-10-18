// Shared by the host-owned Settings form and its IPC handler. Never returns
// provider messages or credential values. Runtime authorization remains host-side.
const clean = value => typeof value === 'string' ? value.trim() : value;
const bytes = value => typeof value === 'string' ? new TextEncoder().encode(value).byteLength : Infinity;
const validKey = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const validRepository = value => typeof value === 'string' && bytes(value) <= 512 && /^\/?[a-zA-Z0-9_][a-zA-Z0-9._/-]*$/.test(value)
    && !value.replace(/^\//, '').split('/').some(part => !part || part === '.' || part === '..');
export const PROFILE_FIELD_LABELS = {
    id: 'Profile ID', label: 'Display name', host: 'Hostname or IP address', username: 'SSH username', port: 'Port',
    credential: 'Credential reference', passphrase: 'Passphrase reference', trustedHostKey: 'Trusted host-key fingerprint',
    terminalLimits:'Terminal deadlines', interactive: 'Interactive terminal consent', x11Modes: 'X11 forwarding modes', commands: 'Allowed commands', allowAllCommands: 'Unrestricted command access', gitRepositories: 'Read repositories', gitPushRepositories: 'Push repositories', lfsHttpsOrigins:'LFS HTTPS destinations', trust: 'Host-key verification',
};

export function normalizeFingerprint(value) {
    if (typeof value !== 'string') return value;
    const input = value.trim();
    // Accept the fingerprint alone or an unambiguous ssh-keygen -lf output line.
    const matches = [...input.matchAll(/\bSHA256:[A-Za-z0-9+/]{43}(?=$|\s)/g)];
    return matches.length === 1 ? matches[0][0] : input;
}

export function validateSSHEndpoint(value) {
    const endpoint = {host: clean(value?.host), port: value?.port};
    const profile = endpoint, fieldErrors = {};
    let validHost = typeof profile.host === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(profile.host);
    if (typeof profile.host === 'string' && profile.host.includes(':')) {
        try {validHost = new URL('http://[' + profile.host + ']/').hostname.startsWith('[');} catch {validHost = false;}
    }
    if (!validHost || bytes(profile.host) > 253) fieldErrors.host = 'Enter a hostname or IP address only, such as github.com. Put the port in the Port field; do not include ssh:// or a repository path.';
    if (!Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) fieldErrors.port = 'Enter a whole-number port between 1 and 65535.';
    return {endpoint, fieldErrors};
}

export function validateSettingsProfile(input) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const profile = {...value};
    for (const name of ['id', 'label', 'host', 'username']) profile[name] = clean(value[name]);
    profile.trustedHostKey = normalizeFingerprint(value.trustedHostKey);
    const fieldErrors = {};
    if (!validKey(profile.id)) fieldErrors.id = 'Enter a profile ID using 1–128 letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
    if (typeof profile.label !== 'string' || !profile.label || profile.label.includes('\0') || bytes(profile.label) > 160) fieldErrors.label = 'Enter a display name of up to 160 UTF-8 bytes.';
    Object.assign(fieldErrors, validateSSHEndpoint(profile).fieldErrors);
    if (!profile.username || bytes(profile.username) > 128 || !/^[a-zA-Z0-9_.@\\-]+$/.test(profile.username)) fieldErrors.username = 'Enter the SSH login name, such as git or ubuntu, without spaces.';
    if (!/^SHA256:[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/.test(profile.trustedHostKey || '')) fieldErrors.trustedHostKey = 'Enter the server’s SHA256 host-key fingerprint, not its public/private key. A verification checkbox alone does not supply the fingerprint.';
    const auth = profile.authentication;
    if (!auth || !['password', 'privateKey'].includes(auth.type)) fieldErrors.credential = 'Choose Password or Private key authentication and select a saved credential.';
    else {
        const ref = auth.type === 'password' ? auth.passwordRef : auth.privateKeyRef;
        if (ref?.kind !== 'secret' || !validKey(ref.key)) fieldErrors.credential = 'Select a saved credential belonging to this plugin. Add the credential first if the list is empty.';
        if (auth.passphraseRef !== undefined && (auth.passphraseRef?.kind !== 'secret' || !validKey(auth.passphraseRef.key))) fieldErrors.passphrase = 'Select a saved passphrase credential or leave it empty.';
    }
    if (!Array.isArray(profile.policy?.commands) || profile.policy.commands.length > 64
        || profile.policy.commands.some(command => typeof command !== 'string' || !command.trim() || command.includes('\0') || bytes(command) > 16384)) fieldErrors.commands = 'Use at most 64 nonempty commands, with no NUL characters and at most 16 KiB per command.';
    if (profile.policy?.allowAllCommands !== undefined && typeof profile.policy.allowAllCommands !== 'boolean'
        || profile.policy?.allowAllCommands === true && (!Array.isArray(profile.policy.consumers) || !profile.policy.consumers.includes('ssh.exec'))) fieldErrors.allowAllCommands = 'Allow all commands must be an explicit boolean choice with SSH command access authorized.';
    if(profile.policy?.terminalLimits!==undefined){const limits=profile.policy.terminalLimits;if(!Number.isSafeInteger(limits?.idleTimeoutMs)||limits.idleTimeoutMs<1000||limits.idleTimeoutMs>300000||!Number.isSafeInteger(limits?.sessionTimeoutMs)||limits.sessionTimeoutMs<1000||limits.sessionTimeoutMs>3600000)fieldErrors.terminalLimits='Terminal idle must be 1–300 seconds and absolute duration 1–3600 seconds.';}
    if(profile.policy?.x11Modes!==undefined&&(!Array.isArray(profile.policy.x11Modes)||profile.policy.x11Modes.some(mode=>!['trusted','untrusted'].includes(mode))||profile.policy.x11Modes.length&&!profile.policy.consumers?.includes('ssh.terminal.open')))fieldErrors.x11Modes='X11 forwarding requires explicit interactive terminal consent and an exact supported mode.';
    const repositories = profile.policy?.repositories;
    if (repositories !== undefined) {
        if (!Array.isArray(repositories) || repositories.length > 64) fieldErrors.gitRepositories = 'Authorize at most 64 repository paths per profile.';
        else for (const rule of repositories) {
            if (!validRepository(rule?.path) || !Array.isArray(rule.operations) || !rule.operations.length
                || rule.operations.some(operation => !['ls-remote', 'clone', 'fetch', 'push'].includes(operation))) {
                const field = rule?.operations?.includes('push') ? 'gitPushRepositories' : 'gitRepositories';
                fieldErrors[field] = 'Use one exact repository path per line, such as company/service.git. URLs, spaces, wildcards and .. segments are not allowed.';
            }
        }
    }
    if(profile.policy?.lfsHttpsOrigins!==undefined) {
        const origins=profile.policy.lfsHttpsOrigins;
        const valid=value=>{try{const url=new URL(value);return typeof value==='string'&&url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&url.hostname&&(!url.hostname.includes('*')||/^\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname));}catch{return false;}};
        if(!Array.isArray(origins)||origins.length>16||origins.some(value=>!valid(value)))fieldErrors.lfsHttpsOrigins='Enter at most 16 HTTPS origins, one per line, such as https://github.com or https://*.githubusercontent.com. Paths and credentials are not allowed.';
    }
    return {profile, fieldErrors};
}

export function profileFromSettingsForm(form) {
    const read = form.gitAuthorized ? form.gitRepositories.split('\n').map(path => path.trim()).filter(Boolean) : [];
    const push = form.gitAuthorized ? form.gitPushRepositories.split('\n').map(path => path.trim()).filter(Boolean) : [];
    return {
        id: form.id, label: form.label, host: form.host, port: form.port, username: form.username, trustedHostKey: form.trustedHostKey,
        authentication: form.type === 'password' ? {type: 'password', passwordRef: {kind: 'secret', key: form.credential}}
            : {type: 'privateKey', privateKeyRef: {kind: 'secret', key: form.credential}, ...(form.passphrase ? {passphraseRef: {kind: 'secret', key: form.passphrase}} : {})},
        policy: {...(form.gitAuthorized && form.lfsHttpsOrigins?.trim() ? {lfsHttpsOrigins:form.lfsHttpsOrigins.split('\n').map(value=>value.trim()).filter(Boolean)} : {}), consumers: [...(form.authorized ? ['ssh.exec'] : []), ...(form.gitAuthorized ? ['git'] : []), ...(form.interactive ? ['ssh.terminal.open'] : [])],
            ...(form.interactive?{terminalLimits:{idleTimeoutMs:(form.terminalIdleMinutes||5)*60000,sessionTimeoutMs:(form.terminalSessionMinutes||60)*60000}}:{}),
            ...(form.interactive&&(form.trustedX11||form.untrustedX11)?{x11Modes:[...(form.trustedX11?['trusted']:[]),...(form.untrustedX11?['untrusted']:[])]}:{}),
            ...(form.authorized && form.allowAllCommands === true ? {allowAllCommands:true} : {}),
            commands: form.authorized ? form.commands.split('\n').filter(command => command.trim().length > 0) : [],
            repositories: [...new Set([...read, ...push])].map(path => ({path,
                operations: [...(read.includes(path) ? ['ls-remote', 'clone', 'fetch'] : []), ...(push.includes(path) ? ['push'] : [])]}))},
    };
}
