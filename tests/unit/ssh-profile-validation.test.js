import {normalizeFingerprint, profileFromSettingsForm, validateSettingsProfile} from '../../src/utils/hostServices/profileValidation';
const fingerprint = 'SHA256:' + 'A'.repeat(43);
const form = () => ({id: 'work', label: 'Work', host: 'github.com', port: 22, username: 'git', type: 'privateKey', credential: 'work-key', passphrase: '', trustedHostKey: fingerprint,
    commands: '', authorized: false, gitAuthorized: true, gitRepositories: 'team/repo.git', gitPushRepositories: ''});
test('normalizes pasted metadata and fingerprint output without altering exact shell commands', () => {
    const input = form(); Object.assign(input, {id: ' work ', host: ' github.com ', authorized: true, trustedHostKey: '256 ' + fingerprint + ' git@github.com (ED25519)', commands: '  uptime  \n\n', gitRepositories: ' team/repo.git \n'});
    const {profile, fieldErrors} = validateSettingsProfile(profileFromSettingsForm(input));
    expect(fieldErrors).toEqual({}); expect(profile).toMatchObject({id: 'work', host: 'github.com', trustedHostKey: fingerprint, policy: {commands: ['  uptime  '], repositories: [{path: 'team/repo.git'}]}});
});
test.each([
    ['id', 'my profile', 'id'], ['label', '', 'label'], ['host', 'ssh://github.com:22/repo', 'host'], ['username', 'git user', 'username'],
    ['port', 22.5, 'port'], ['credential', '', 'credential'], ['trustedHostKey', '', 'trustedHostKey'], ['trustedHostKey', 'ssh-ed25519 public key', 'trustedHostKey'],
    ['gitRepositories', 'https://github.com/team/repo', 'gitRepositories'], ['gitPushRepositories', '../repo', 'gitPushRepositories'],
])('reports the field for invalid %s', (name, value, expected) => {
    const input = form(); input[name] = value;
    expect(validateSettingsProfile(profileFromSettingsForm(input)).fieldErrors).toHaveProperty(expected);
});
test('does not silently select between multiple fingerprints', () => {
    expect(normalizeFingerprint(fingerprint + '\n' + fingerprint)).not.toBe(fingerprint);
    expect(validateSettingsProfile({...profileFromSettingsForm(form()), trustedHostKey: fingerprint + '\n' + fingerprint}).fieldErrors).toHaveProperty('trustedHostKey');
});

test('does not let inactive optional access rules block saving a connection', () => {
    const input = {...form(), authorized: false, gitAuthorized: false, commands: '\0', gitRepositories: 'paste later', gitPushRepositories: 'paste later'};
    const {profile, fieldErrors} = validateSettingsProfile(profileFromSettingsForm(input));
    expect(fieldErrors).toEqual({}); expect(profile.policy).toEqual({consumers: [], commands: [], repositories: []});
});

test('malformed label values produce field errors rather than exceptions', () => {
    for (const label of [42, {}, [], null]) expect(validateSettingsProfile({...profileFromSettingsForm(form()), label}).fieldErrors).toHaveProperty('label');
});

test('unrestricted commands are off by default and only saved with explicit SSH authorization', () => {
    const input = {...form(),allowAllCommands:true};
    expect(profileFromSettingsForm(input).policy.allowAllCommands).toBeUndefined();
    input.authorized = true;
    expect(validateSettingsProfile(profileFromSettingsForm(input)).fieldErrors).toEqual({});
    expect(profileFromSettingsForm(input).policy.allowAllCommands).toBe(true);
    input.allowAllCommands = false;
    expect(profileFromSettingsForm(input).policy.allowAllCommands).toBeUndefined();
    for (const value of ['true',1,null]) {
        const profile = profileFromSettingsForm(input); profile.policy.allowAllCommands = value;
        expect(validateSettingsProfile(profile).fieldErrors.allowAllCommands).toBeTruthy();
    }
});

test('interactive/X11 consent is independent of command/Git access and preserves lower terminal ceilings',()=>{
 const previous=profileFromSettingsForm({...form(),authorized:true,allowAllCommands:true});
 expect(previous.policy.consumers).not.toContain('ssh.terminal.open');expect(previous.policy.x11Modes).toBeUndefined();
 const {profile,fieldErrors}=validateSettingsProfile(profileFromSettingsForm({...form(),gitAuthorized:false,interactive:true,trustedX11:true,terminalIdleMinutes:1,terminalSessionMinutes:10}));
 expect(fieldErrors).toEqual({});expect(profile.policy).toMatchObject({consumers:['ssh.terminal.open'],commands:[],x11Modes:['trusted'],terminalLimits:{idleTimeoutMs:60000,sessionTimeoutMs:600000}});
 expect(validateSettingsProfile({...profile,policy:{...profile.policy,consumers:[]}}).fieldErrors).toHaveProperty('x11Modes');
});


test('untrusted X11 consent is independent, survives normalization and never implies trusted mode',()=>{
 const {profile,fieldErrors}=validateSettingsProfile(profileFromSettingsForm({...form(),gitAuthorized:false,interactive:true,untrustedX11:true,trustedX11:false}));
 expect(fieldErrors).toEqual({});expect(profile.policy.x11Modes).toEqual(['untrusted']);
 expect(profileFromSettingsForm({...form(),interactive:false,untrustedX11:true}).policy.x11Modes).toBeUndefined();
});
