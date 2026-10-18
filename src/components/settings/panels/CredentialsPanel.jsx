import {normalizeFingerprint, PROFILE_FIELD_LABELS, profileFromSettingsForm, validateSettingsProfile, validateSSHEndpoint} from '../../../utils/hostServices/profileValidation';
import React, {useEffect, useRef, useState} from 'react';
import {Button, Callout, Card, Checkbox, Dialog, DialogBody, DialogFooter, FormGroup, H3, H4, HTMLSelect, InputGroup, NonIdealState, NumericInput, Tag, TextArea} from '@blueprintjs/core';
import * as styles from '../../css/SettingsDialog.module.css';

const emptyProfile = () => ({id: '', label: '', host: '', port: 22, username: '', type: 'password', credential: '', passphrase: '', trustedHostKey: '', commands: '', interactive:false, trustedX11:false, untrustedX11:false, terminalIdleMinutes:5, terminalSessionMinutes:60, authorized: false, allowAllCommands:false, gitAuthorized: false, gitRepositories: '', gitPushRepositories: '', lfsHttpsOrigins:''});
const selectedPluginKey = 'credentialsSSH.selectedPlugin';
const trustValue = (name, value) => name === 'trustedHostKey' ? normalizeFingerprint(value) : name === 'host' ? value.trim() : value;
const errors = {
    ACCESS_DENIED: 'This plugin or operation is no longer authorized. Refresh and review its grants in Manage Plugins.',
    INVALID_REQUEST: 'Check the names, references, endpoint, fingerprint and limits. Credentials must be saved for this plugin before selecting them.',
    LOCKED: 'Unlock your system keychain or credential store, then refresh. No values were read or saved.',
    UNAVAILABLE: 'Secure storage is unavailable. On Linux, configure and unlock GNOME Keyring or KWallet; plaintext storage is not supported. Then refresh.',
};

function CopyableCommand({command, label}) {
    const [copying, setCopying] = useState(false), [status, setStatus] = useState('');
    const copy = async () => {
        setCopying(true); setStatus('');
        try {
            await navigator.clipboard.writeText(command);
            setStatus('Copied to clipboard.');
        } catch {
            setStatus('Could not copy. Select the command and copy it manually.');
        } finally {setCopying(false);}
    };
    return <div>
        <div className={styles['host-key-command']}>
            <pre className={styles['host-key-fingerprint']}><code>{command}</code></pre>
            <Button type="button" icon={status === 'Copied to clipboard.' ? 'tick' : 'clipboard'} loading={copying} aria-label={`Copy ${label}`} onClick={copy}>Copy</Button>
        </div>
        <span role="status" className="bp6-text-muted">{status}</span>
    </div>;
}

export default function CredentialsPanel({onOpenTools} = {}) {
    const api = window.electron.credentialSettings;
    const [plugins, setPlugins] = useState([]), [pluginId, setPluginId] = useState('');
    const [data, setData] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
    const [secretKey, setSecretKey] = useState(''), [value, setValue] = useState('');
    const [form, setForm] = useState(emptyProfile), [trust, setTrust] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({}), [invalidFocus, setInvalidFocus] = useState(null);
    const [hostKeyCandidate, setHostKeyCandidate] = useState(null), [fetchingHostKey, setFetchingHostKey] = useState(false), [hostKeyError, setHostKeyError] = useState('');
    const [credentialOpen, setCredentialOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false), [editingId, setEditingId] = useState(null);
    const [x11Availability,setX11Availability]=useState(null),[checkingX11,setCheckingX11]=useState(false);
    const [gitSetup, setGitSetup] = useState(false);
    const openNewProfile = (forGit = false) => {setGitSetup(forGit); setForm({...emptyProfile(), ...(forGit ? {type: 'privateKey', username: 'git'} : {})}); setTrust(false); setEditingId(null); setNotice(''); setFieldErrors({}); setHostKeyCandidate(null); setHostKeyError(''); setProfileOpen(true);};
    const closeProfile = () => {if (!busy) {setProfileOpen(false); setForm(emptyProfile()); setTrust(false); setNotice(''); setFieldErrors({}); setHostKeyCandidate(null); setHostKeyError('');}};
    const generation = useRef(0);
    const field = (name, next) => {
        if (['host', 'port', 'trustedHostKey'].includes(name) && trustValue(name, form[name]) !== trustValue(name, next)) {
            setHostKeyCandidate(null); setHostKeyError(''); setTrust(false);
        }
        setForm(current => ({...current, [name]: next})); setNotice('');
        setFieldErrors(current => {const result = {...current}; delete result[name]; delete result.trust; return result;});
    };
    useEffect(() => {
        let active = true;
        window.electron.plugin.getAll().then(result => {if (active) {
            const installed = Array.isArray(result) ? result : result.plugins || [];
            setPlugins(installed);
            try {
                const selected = localStorage.getItem(selectedPluginKey);
                if (installed.some(plugin => plugin.id === selected)) setPluginId(selected);
                else localStorage.removeItem(selectedPluginKey);
            } catch { /* Selection persistence is optional when browser storage is unavailable. */ }
        }})
            .catch(() => {if (active) setNotice('Could not load installed plugins. Reopen Settings and try again.');});
        return () => {active = false; generation.current++;};
    }, []);
    const refresh = async (id = pluginId, token = generation.current) => {
        const next = await api.state(id);
        if (token !== generation.current) return;
        if (!next.success) throw new Error(errors[next.code] || errors.UNAVAILABLE);
        setData(next);
    };
    useEffect(() => {
        const token = ++generation.current;
        setCredentialOpen(false); setProfileOpen(false); setEditingId(null); setValue(''); setSecretKey(''); setForm(emptyProfile()); setTrust(false); setData(null); setNotice('');
        if (pluginId) refresh(pluginId, token).catch(error => {if (token === generation.current) setNotice(error.message);});
    }, [pluginId]);
    const perform = async operation => {
        if (busy) return;
        const token = generation.current;
        setBusy(true); setNotice('');
        try {
            const result = await operation();
            if (token !== generation.current) return;
            if (!result.success) {setNotice(errors[result.code] || errors.UNAVAILABLE); return false;}
            await refresh(pluginId, token); return true;
        } catch (error) {if (token === generation.current) setNotice(error.message || errors.UNAVAILABLE);}
        finally {setBusy(false);}
    };
    const showProfileErrors = next => {
        setFieldErrors(next);
        const first = Object.keys(PROFILE_FIELD_LABELS).find(name => next[name]);
        if (first) setInvalidFocus({field: first});
    };
    useEffect(() => {
        if (!invalidFocus) return;
        const ids = {credential: 'ssh-credential', passphrase: 'ssh-passphrase', trustedHostKey: 'ssh-fingerprint', commands: 'ssh-commands', gitRepositories: 'git-read-repositories', gitPushRepositories: 'git-push-repositories', lfsHttpsOrigins:'git-lfs-origins', trust: 'ssh-trust'};
        const target = document.getElementById(ids[invalidFocus.field] || 'ssh-' + invalidFocus.field);
        target?.focus(); target?.scrollIntoView?.({block: 'center'});
    }, [invalidFocus]);
    const submitProfile = async event => {
        event.preventDefault();
        if (busy) return;
        setNotice('');
        const {profile, fieldErrors: invalid} = validateSettingsProfile(profileFromSettingsForm(form));
        if (!trust) invalid.trust = 'Confirm that you verified this endpoint and its SHA256 host-key fingerprint.';
        if (Object.keys(invalid).length) {showProfileErrors(invalid); return;}
        setFieldErrors({});
        const token = generation.current;
        setBusy(true);
        try {
            const result = await api.saveProfile(pluginId, profile, true);
            if (token !== generation.current) return;
            if (!result.success) {
                const details = Object.fromEntries(Object.keys(PROFILE_FIELD_LABELS).filter(name => typeof result.fieldErrors?.[name] === 'string').map(name => [name, result.fieldErrors[name]]));
                if (Object.keys(details).length) showProfileErrors(details);
                else setNotice(errors[result.code] || 'The profile could not be saved. Refresh secure storage and try again.');
                return;
            }
            // The write acknowledgment commits the UI. A subsequent read failure
            // must not make an already-saved profile look like a failed write.
            const saved = result.profile || profile;
            setData(current => ({...current, profiles: [...(current?.profiles || []).filter(item => item.id !== saved.id), saved].sort((a, b) => a.label.localeCompare(b.label)),
                gitProfileMode: current?.gitProfileMode || saved.policy.consumers.includes('git')}));
            setProfileOpen(false); setForm(emptyProfile()); setTrust(false); setEditingId(null);
        } catch {
            if (token === generation.current) setNotice('Could not confirm that the profile was saved. Refresh secure storage before retrying. Your entered settings have been kept.');
        } finally {setBusy(false);}
    };
    const fetchHostKey = async () => {
        if (busy) return;
        const {endpoint, fieldErrors: invalid} = validateSSHEndpoint({host: form.host, port: form.port});
        if (Object.keys(invalid).length) {showProfileErrors(invalid); return;}
        const token = generation.current;
        setBusy(true); setFetchingHostKey(true); setHostKeyCandidate(null); setHostKeyError(''); setNotice('');
        try {
            const result = await api.fetchHostKey(pluginId, endpoint.host, endpoint.port);
            if (token !== generation.current) return;
            if (!result.success) {
                if (result.fieldErrors) showProfileErrors(result.fieldErrors);
                setHostKeyError(result.code === 'TIMEOUT' ? 'Fetching the host key timed out. Check the address, port and network connection.'
                    : 'Could not fetch an SSH host key. Check the address, port and network connection, or enter a fingerprint obtained through a trusted channel.');
                return;
            }
            if (result.candidate?.host !== endpoint.host || result.candidate?.port !== endpoint.port || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(result.candidate?.fingerprint || '')) {
                setHostKeyError('Host-key retrieval is unavailable. Try again or use the manual instructions below.');
                return;
            }
            setHostKeyCandidate(result.candidate);
        } catch {if (token === generation.current) setHostKeyError('Host-key retrieval is unavailable. Try again or use the manual instructions below.');}
        finally {setBusy(false); setFetchingHostKey(false);}
    };
    const savedFingerprint = data?.profiles.find(profile => profile.id === editingId)?.trustedHostKey;
    const hostKeyChanged = !!savedFingerprint && !!hostKeyCandidate && savedFingerprint !== hostKeyCandidate.fingerprint;
    const profileErrorField = Object.keys(PROFILE_FIELD_LABELS).find(name => fieldErrors[name]);
    const options = [{value: '', label: 'Select a saved secret'}, ...(data?.entries || []).map(entry => ({value: entry.key, label: entry.key}))];
    const ready = data?.available && !busy;
    return <Card className={styles['card-panel']}>
        <H3>Credentials & SSH</H3>
        <p>Credentials belong to one installed plugin. Values are encrypted with your OS credential store and cannot be viewed here after saving.</p>
        <FormGroup label="Plugin" labelFor="credential-plugin"><HTMLSelect id="credential-plugin" fill value={pluginId} disabled={busy} onChange={event => {
            const selected = event.target.value; setPluginId(selected);
            try {if (selected) localStorage.setItem(selectedPluginKey, selected); else localStorage.removeItem(selectedPluginKey);} catch { /* Keep selection usable without persistence. */ }
        }} options={[
            {value: '', label: 'Select an installed plugin'}, ...plugins.map(plugin => ({value: plugin.id, label: plugin.metadata?.name || plugin.id})),
        ]}/></FormGroup>
        {notice && <Callout intent="danger" role="alert">{notice}</Callout>}
        {!pluginId ? <NonIdealState icon="key" title="Choose a plugin" description="Manage its saved credentials and authorized SSH connections."/> : <>
            <Button icon="refresh" disabled={busy} onClick={() => perform(async () => {await refresh(); return {success: true};})}>Refresh secure storage</Button>
            {data && !data.available && <Callout intent="warning" style={{marginTop: 12}}>{errors[data.code] || errors.UNAVAILABLE}</Callout>}
            {data?.terminalReadiness&&<Callout compact icon='console' style={{marginTop:12}} title='Interactive terminal host support'>Terminal adapter and iframe renderer available. X11 modes require separate consent and local-display verification. Desktop graphical forwarding remains platform-dependent.</Callout>}
            <X11Availability onOpenTools={onOpenTools} availability={x11Availability||data?.terminalReadiness?.x11Availability} checking={checkingX11} disabled={!ready} onCheck={async()=>{setCheckingX11(true);try{const result=await api.checkX11(pluginId);if(result.success)setX11Availability(result.availability);else setNotice('Could not check local X11 support. Refresh Settings and try again.');}catch{setNotice('Could not check local X11 support. Refresh Settings and try again.');}finally{setCheckingX11(false);}}}/>
            <div className={styles['connection-section-heading']}><H4>Saved credentials</H4><div className={styles['connection-profile-actions']}><Tag minimal icon="lock">{data?.entries.length || 0}</Tag><Button icon="plus" disabled={!ready} onClick={() => {setValue(''); setSecretKey(''); setNotice(''); setCredentialOpen(true);}}>Add credential</Button></div></div>
            {data?.entries.length === 0 && <NonIdealState icon="lock" title="No credentials yet" description="Add a password, token or private key, then select it when creating an SSH profile."/>}
            {data?.entries.map(entry => <Card compact key={entry.key} className={styles['credential-list-row']}>
                <strong style={{flex: 1}}>{entry.key}</strong><span className="bp6-text-muted">{new Date(entry.updatedAt).toLocaleString()}</span>
                <Button icon="trash" intent="danger" size="small" disabled={!ready} aria-label={`Delete credential ${entry.key}`} onClick={() => {
                    if (window.confirm(`Permanently delete credential “${entry.key}”? Connections using it will stop working.`)) void perform(() => api.deleteSecret(pluginId, entry.key));
                }}/>
            </Card>)}
            <Dialog isOpen={credentialOpen} title="Add or replace a credential" icon="lock" className={styles['connection-profile-dialog']}
                canEscapeKeyClose={!busy} canOutsideClickClose={!busy} isCloseButtonShown={!busy}
                onClose={() => {if (!busy) {setCredentialOpen(false); setValue(''); setNotice('');}}}>
            <DialogBody>
            {notice && <Callout intent="danger" role="alert">{notice}</Callout>}
            <FormGroup label="Credential name" labelFor="credential-name" helperText="1–128 letters, digits, dots, underscores or hyphens; start with a letter or digit. Names are visible metadata.">
                <InputGroup id="credential-name" value={secretKey} disabled={!ready} onValueChange={setSecretKey} maxLength={128} autoComplete="off"/>
            </FormGroup>
            <FormGroup label="Secret value" labelFor="credential-value" helperText="Passwords, tokens, PEM keys, passphrases or JSON. An empty value is valid. Saving an existing name replaces it and closes active SSH and Git operations.">
                <TextArea id="credential-value" fill rows={4} value={value} disabled={!ready} onChange={event => setValue(event.target.value)} autoComplete="off" spellCheck={false}/>
            </FormGroup>
            </DialogBody><DialogFooter actions={<>
                <Button disabled={busy} onClick={() => {setCredentialOpen(false); setValue(''); setNotice('');}}>Cancel</Button>
                <Button intent="primary" icon="lock" loading={busy} disabled={!ready || !secretKey} onClick={async () => {
                    const entered = value; setValue('');
                    if (await perform(() => api.saveSecret(pluginId, secretKey, entered))) {setCredentialOpen(false); setSecretKey('');}
                }}>Save credential</Button>
            </>}/></Dialog>
            <div className={styles['connection-section-heading']}>
                <div><H4>SSH profiles</H4><p className="bp6-text-muted">Reusable connections for approved commands and Git repositories.</p></div>
                <div className={styles['connection-profile-actions']}>
                    <Button icon="plus" disabled={!ready} onClick={() => openNewProfile()}>New SSH profile</Button>
                    <Button intent="primary" icon="git-repo" disabled={!ready} onClick={() => openNewProfile(true)}>New Git SSH profile</Button>
                </div>
            </div>
            {data?.profiles.length === 0 ? <NonIdealState icon="console" title="No SSH profiles yet"
                description="Create a connection, choose a saved credential and enroll its trusted host key. Then authorize commands or Git repositories."/>
                : <div className={styles['connection-profile-list']} role="list" aria-label="SSH profiles">
                    {data?.profiles.map(profile => <Card key={profile.id} role="listitem" className={styles['connection-profile-card']}>
                        <div className={styles['connection-profile-summary']}>
                            <H4>{profile.label}</H4><code>{profile.username}@{profile.host}:{profile.port}</code>
                            <div className={styles['connection-profile-tags']}>
                                <Tag minimal icon="key">{profile.authentication.type === 'privateKey' ? 'Private key' : 'Password'}</Tag>
                                {profile.policy.consumers.includes('ssh.exec') && <Tag minimal intent={profile.policy.allowAllCommands === true ? 'danger' : 'primary'} icon="console">{profile.policy.allowAllCommands === true ? 'All shell commands' : `${profile.policy.commands.length} ${profile.policy.commands.length === 1 ? 'command' : 'commands'}`}</Tag>}
                                {profile.policy.consumers.includes('git') && <Tag minimal intent="success" icon="git-repo">Git · {profile.policy.repositories?.length || 0} {(profile.policy.repositories?.length || 0) === 1 ? 'repository' : 'repositories'}</Tag>}
                                {profile.policy.consumers.includes('ssh.terminal.open') && <Tag minimal intent='danger' icon='console'>Interactive terminal{profile.policy.x11Modes?.includes('trusted')?' · Trusted X11':''}{profile.policy.x11Modes?.includes('untrusted')?' · Untrusted X11':''}</Tag>}
                                {!profile.policy.consumers.includes('ssh.exec') && !profile.policy.consumers.includes('ssh.terminal.open') && <Tag minimal icon="lock">{profile.policy.consumers.includes('git') ? 'Git only' : 'No access authorized'}</Tag>}
                            </div>
                            {profile.policy.consumers.includes('git') && <ul>{(profile.policy.repositories || []).map(rule => <li key={rule.path}><code>{rule.path}</code> · {rule.operations.some(operation => ['ls-remote', 'clone', 'fetch'].includes(operation)) ? 'Read' : ''}{rule.operations.some(operation => ['ls-remote', 'clone', 'fetch'].includes(operation)) && rule.operations.includes('push') ? ' · ' : ''}{rule.operations.includes('push') ? 'Push' : ''}</li>)}</ul>}
                            {!profile.policy.consumers.includes('ssh.exec') && !profile.policy.consumers.includes('git') && !profile.policy.consumers.includes('ssh.terminal.open') && <p className="bp6-text-muted">This profile is hidden from this plugin’s SSH profile list. Edit it and authorize command or interactive terminal access to make it available. Plugin capability grants alone do not enable profile access.</p>}
                        </div>
                        <div className={styles['connection-profile-actions']}>
                            <Button icon="edit" disabled={!ready} aria-label={`Edit SSH profile ${profile.label}`} onClick={() => {
                                setForm({...profile, type: profile.authentication.type, credential: profile.authentication.passwordRef?.key || profile.authentication.privateKeyRef?.key || '',
                                    interactive:profile.policy.consumers.includes('ssh.terminal.open'),trustedX11:profile.policy.x11Modes?.includes('trusted')||false,untrustedX11:profile.policy.x11Modes?.includes('untrusted')||false,terminalIdleMinutes:(profile.policy.terminalLimits?.idleTimeoutMs||300000)/60000,terminalSessionMinutes:(profile.policy.terminalLimits?.sessionTimeoutMs||3600000)/60000,passphrase: profile.authentication.passphraseRef?.key || '', commands: profile.policy.commands.join('\n'), authorized: profile.policy.consumers.includes('ssh.exec'), allowAllCommands:profile.policy.allowAllCommands === true, gitAuthorized: profile.policy.consumers.includes('git'),
                                    gitRepositories: (profile.policy.repositories || []).filter(rule => rule.operations.includes('fetch')).map(rule => rule.path).join('\n'),
                                    lfsHttpsOrigins:(profile.policy.lfsHttpsOrigins || []).join('\n'),
                                    gitPushRepositories: (profile.policy.repositories || []).filter(rule => rule.operations.includes('push')).map(rule => rule.path).join('\n')});
                                setGitSetup(profile.policy.consumers.includes('git')); setEditingId(profile.id); setTrust(true); setNotice(''); setFieldErrors({}); setHostKeyCandidate(null); setHostKeyError(''); setProfileOpen(true);
                            }}>Edit</Button>
                            <Button icon="trash" variant="minimal" intent="danger" disabled={!ready} aria-label={`Delete SSH profile ${profile.label}`} onClick={() => {
                                if (window.confirm(`Delete SSH profile “${profile.label}” and stop its active operations?`)) void perform(() => api.deleteProfile(pluginId, profile.id));
                            }}/>
                        </div>
                    </Card>)}
                </div>}
            <Card compact className={styles['credential-entry-card']}>
                <Checkbox checked={!!data?.gitProfileMode} disabled={!ready} onChange={event => {
                    const enabled = event.target.checked;
                    if (enabled || window.confirm('Disable SSH profile mode? Backend Git requests will resume the existing CLI authentication behavior, which may use machine SSH configuration.')) void perform(() => api.setGitEnabled(pluginId, enabled));
                }} label="Use SSH profiles for this plugin’s Git network operations"/>
                <p className="bp6-text-muted">Saving a Git-authorized profile enables this mode. It remains enabled after profile deletion, so missing or unauthorized repositories fail closed.</p>
            </Card>
            <Dialog isOpen={profileOpen} onClose={closeProfile} title={editingId ? 'Edit SSH profile' : gitSetup ? 'New Git SSH profile' : 'New SSH profile'} icon="key"
                className={styles['connection-profile-dialog']} canEscapeKeyClose={!busy} canOutsideClickClose={!busy} isCloseButtonShown={!busy}>
            <form className={styles['connection-profile-form']} onSubmit={submitProfile} noValidate>
            <DialogBody className={styles['connection-profile-body']}>
            {!data?.entries.length && <Callout intent="warning" title="Save a credential first">Cancel this dialog and add a password or private key under Saved credentials, then create your profile.</Callout>}
            {gitSetup && <Callout icon="git-repo" title="Connect a Git repository">
                Save your private key under Saved credentials for this plugin, select it below, and verify the server’s host key. Then enable Git repository access and enter the exact repository paths. Saving a Git-authorized profile enables profile mode for this plugin.
                <p>GitHub uses SSH username <code>git</code>; the private key identifies your account. Different repositories can use different profiles and keys. Plugin capability grants are configured separately in Manage Plugins.</p>
            </Callout>}
            <H4>Connection</H4>
            <div className={styles['connection-fields']}>
            {['id', 'label', 'host', 'username'].map(name => <FormGroup key={name} label={{id: 'Profile ID', label: 'Display name', host: 'Hostname or IP address', username: 'SSH username'}[name]} labelFor={`ssh-${name}`} labelInfo="(required)" intent={fieldErrors[name] ? 'danger' : 'none'} helperText={fieldErrors[name] || (name === 'id' ? 'Letters, digits, dots, underscores and hyphens; no spaces.' : undefined)}>
                <InputGroup id={`ssh-${name}`} aria-label={PROFILE_FIELD_LABELS[name]} aria-required="true" aria-invalid={!!fieldErrors[name]} value={form[name]} disabled={!ready || (name === 'id' && !!editingId)} onValueChange={next => field(name, next)} autoComplete="off"/>
            </FormGroup>)}
            <FormGroup label="Port" labelFor="ssh-port" labelInfo="(required)" intent={fieldErrors.port ? 'danger' : 'none'} helperText={fieldErrors.port}><NumericInput id="ssh-port" aria-label="Port" aria-required="true" aria-invalid={!!fieldErrors.port} min={1} max={65535} value={form.port} disabled={!ready} onValueChange={next => field('port', next)}/></FormGroup>
            </div>
            <H4>Authentication</H4>
            <FormGroup label="Authentication" labelFor="ssh-auth"><HTMLSelect id="ssh-auth" value={form.type} disabled={!ready} onChange={event => field('type', event.target.value)} options={[{value: 'password', label: 'Password'}, {value: 'privateKey', label: 'Private key'}]}/></FormGroup>
            <FormGroup label="Credential reference" labelFor="ssh-credential" labelInfo="(required)" intent={fieldErrors.credential ? 'danger' : 'none'} helperText={fieldErrors.credential}><HTMLSelect id="ssh-credential" aria-label="Credential reference" aria-required="true" aria-invalid={!!fieldErrors.credential} fill value={form.credential} disabled={!ready} options={options} onChange={event => field('credential', event.target.value)}/></FormGroup>
            {form.type === 'privateKey' && <FormGroup label="Passphrase reference (optional)" labelFor="ssh-passphrase" intent={fieldErrors.passphrase ? 'danger' : 'none'} helperText={fieldErrors.passphrase}><HTMLSelect id="ssh-passphrase" aria-invalid={!!fieldErrors.passphrase} fill value={form.passphrase} disabled={!ready} options={options} onChange={event => field('passphrase', event.target.value)}/></FormGroup>}
            <FormGroup label="Trusted host-key fingerprint" labelFor="ssh-fingerprint" labelInfo="(required)" intent={fieldErrors.trustedHostKey ? 'danger' : 'none'} helperText={fieldErrors.trustedHostKey || 'Paste the SHA256: fingerprint or ssh-keygen -lf output from a trusted channel. The checkbox confirms verification; it does not discover the server key.'}>
                <InputGroup id="ssh-fingerprint" aria-label="Trusted host-key fingerprint" aria-required="true" aria-invalid={!!fieldErrors.trustedHostKey} placeholder="SHA256:…" value={form.trustedHostKey} disabled={!ready} onValueChange={next => field('trustedHostKey', next)}/>
                <Button type="button" icon="cloud-download" loading={fetchingHostKey} disabled={!ready} onClick={fetchHostKey} style={{marginTop: 8}}>Fetch host key</Button>
                <p className="bp6-text-muted">No previous login is needed. Fetch retrieves a public host key without sending your saved credentials; it does not verify the server’s identity.</p>
                {hostKeyError && <Callout intent="danger" role="alert">{hostKeyError}</Callout>}
                {hostKeyCandidate && <Callout intent={hostKeyChanged ? 'danger' : 'warning'} title={hostKeyChanged ? 'Host key differs from the saved profile' : 'Fetched host key — not verified'}>
                    <p>{hostKeyCandidate.host}:{hostKeyCandidate.port} · {hostKeyCandidate.keyType}</p>
                    <code className={styles['host-key-fingerprint']}>{hostKeyCandidate.fingerprint}</code>
                    <p>Compare this fingerprint with your administrator, your provider’s published keys or a trusted server console before confirming trust.</p>
                    <Button type="button" icon="key" disabled={!ready || hostKeyCandidate.applied} onClick={() => {
                        field('trustedHostKey', hostKeyCandidate.fingerprint); setHostKeyCandidate({...hostKeyCandidate, applied: true});
                    }}>{hostKeyCandidate.applied ? 'Fingerprint applied' : hostKeyChanged ? 'Replace fingerprint with fetched key' : 'Use this fingerprint'}</Button>
                </Callout>}
                <details><summary>How to get the fingerprint without signing in</summary>
                    <p>From your computer, if OpenSSH tools are installed (replace the host and port):</p>
                    <CopyableCommand label="network fingerprint command" command="ssh-keyscan -T 5 -p 22 -t ed25519 example.com | ssh-keygen -lf - -E sha256"/>
                    <p>To verify it independently, use your server’s trusted cloud/physical console, or ask its administrator to run:</p>
                    <CopyableCommand label="server fingerprint command" command="ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256"/>
                    <p>Servers can offer several key types. These examples use Ed25519; Fetch host key reports the key negotiated by FDO. A network scan alone is not proof of identity. Neither command changes known_hosts or creates a login session.</p>
                </details>
            </FormGroup>
            <H4>Git repository access</H4>
            <p>Reuse this SSH connection for specific repositories. Add different repository paths to different profiles to use separate keys, even on the same server. A repository must match exactly one authorized profile.</p>
            <Callout compact icon="info-sign" title="How Git selects a profile">
                Git matches this plugin’s profiles by hostname, port, SSH username, exact repository path and authorized operation. Exactly one profile must match. A profile for another plugin cannot be used.
                <p><code>git@github.com:anikitenko/fdo.git</code> → read path <code>anikitenko/fdo.git</code></p>
                <p><code>ssh://git@github.com/anikitenko/fdo.git</code> → read path <code>/anikitenko/fdo.git</code></p>
                Both examples use hostname <code>github.com</code>, port <code>22</code> and SSH username <code>git</code>. Copy the path matching your URL’s format.
            </Callout>
            <Checkbox checked={form.gitAuthorized} disabled={!ready} onChange={event => field('gitAuthorized', event.target.checked)} label="Authorize Git to consume this profile’s credential references"/>
            <FormGroup label="Read repositories (one exact server-side path per line)" labelFor="git-read-repositories" intent={fieldErrors.gitRepositories ? 'danger' : 'none'} helperText={fieldErrors.gitRepositories || 'Use company/service.git for scp-style URLs, or /company/service.git for ssh:// URLs. Allows ls-remote, clone, fetch, pull and submodule downloads; no wildcards.'}>
                <TextArea id="git-read-repositories" aria-invalid={!!fieldErrors.gitRepositories} fill rows={3} value={form.gitRepositories} disabled={!ready} onChange={event => field('gitRepositories', event.target.value)} spellCheck={false}/>
            </FormGroup>
            <FormGroup label="Push repositories (optional, one exact path per line)" labelFor="git-push-repositories" intent={fieldErrors.gitPushRepositories ? 'danger' : 'none'} helperText={fieldErrors.gitPushRepositories || 'Explicit branch-to-branch pushes only; no force, deletion or mirror. A remote mutation may complete even if the connection is interrupted.'}>
                <TextArea id="git-push-repositories" aria-invalid={!!fieldErrors.gitPushRepositories} fill rows={2} value={form.gitPushRepositories} disabled={!ready} onChange={event => field('gitPushRepositories', event.target.value)} spellCheck={false}/>
            </FormGroup>
            <FormGroup label="Additional Git LFS HTTPS destinations (optional)" labelFor="git-lfs-origins" intent={fieldErrors.lfsHttpsOrigins ? 'danger' : 'none'} helperText={fieldErrors.lfsHttpsOrigins || 'LFS may download objects over HTTPS after SSH authentication. The profile hostname on port 443 is allowed; authorize any additional server or CDN origins here, one per line. Example: https://*.githubusercontent.com. Authorize only destinations you trust.'}>
                <TextArea id="git-lfs-origins" aria-invalid={!!fieldErrors.lfsHttpsOrigins} fill rows={2} value={form.lfsHttpsOrigins} disabled={!ready} onChange={event => field('lfsHttpsOrigins',event.target.value)} spellCheck={false}/>
            </FormGroup>
            <H4>Interactive terminal access</H4>
            <Callout intent="warning" compact>Interactive input permits arbitrary shell commands, including destructive commands. Command allowlists, Git access and unrestricted command consent do not authorize this mode. Grant ssh.terminal.open separately in Manage Plugins.</Callout>
            <Checkbox checked={form.interactive} disabled={!ready} onChange={event=>field('interactive',event.target.checked)} label="Authorize arbitrary interactive shell input for this plugin"/>
            {form.interactive&&<FormGroup label='Terminal deadlines' helperText={fieldErrors.terminalLimits||'Lower ceilings apply to every terminal opened with this profile.'} intent={fieldErrors.terminalLimits?'danger':'none'}>
                <label>Idle minutes <NumericInput aria-label='Terminal idle minutes' min={1} max={5} value={form.terminalIdleMinutes} onValueChange={value=>field('terminalIdleMinutes',value)}/></label>
                <label>Maximum session minutes <NumericInput aria-label='Terminal session minutes' min={1} max={60} value={form.terminalSessionMinutes} onValueChange={value=>field('terminalSessionMinutes',value)}/></label>
            </FormGroup>}
            <Checkbox checked={form.untrustedX11} disabled={!ready||!form.interactive} onChange={event=>field('untrustedX11',event.target.checked)} label='Authorize untrusted X11 forwarding (requires verified X SECURITY)'/>
            {form.untrustedX11&&<Callout compact intent='primary'>FDO creates a separate restricted authorization and verifies isolation from trusted clients before forwarding. It expires after at most 5 minutes and is revoked when the session closes. Unsupported or failed isolation is rejected; FDO never changes this request to trusted forwarding.</Callout>}
            <Checkbox checked={form.trustedX11} disabled={!ready||!form.interactive} onChange={event=>field('trustedX11',event.target.checked)} label="Authorize trusted X11 forwarding (dangerous)"/>
            {form.trustedX11&&<Callout intent="danger" compact>Remote graphical applications can access your local display and other clients’ input or data. Requires ssh.x11.forward, a running authenticated local X server and host preflight. No untrusted fallback is provided.</Callout>}
            <p className="bp6-text-muted">Terminal limits: 4 per worker, 16 per host; maximum 5 minutes idle and 1 hour absolute. A missing view lease closes the session after 30 seconds. Output uses lossless backpressure. Closing or cancellation does not prove remote descendants stopped.</p>
            <p className="bp6-text-muted">Trusted X11: authenticated Xorg/Xwayland or XQuartz with DISPLAY and xauth available to FDO. Windows display discovery is unsupported. Untrusted mode requires working X SECURITY on the local display; use Check local X11 support to verify. Desktop graphical forwarding remains platform-dependent.</p>
            <H4>Command access</H4>
            <p className="bp6-text-muted">Controls remote shell access for this plugin through this profile. SSH and credential-consumption capabilities must also be granted in Manage Plugins. Git repository access is configured separately above and does not use this command list.</p>
            <Callout compact icon="info-sign" title="SSH execution and monitoring limits">Commands have a separate 10-second handshake deadline and a maximum 120-second execution deadline. Output defaults to 1 MiB combined stdout/stderr; the host ceiling is 4 MiB. Live output uses the same capture limit. Cancellation and timeout close the SSH channel and request termination, but cannot prove the remote process stopped. Monitoring requires its own grant and observes authenticated SSH reachability every 5 seconds without running shell commands; it does not guarantee VM or service availability.</Callout>
            <Checkbox checked={form.authorized} disabled={!ready} onChange={event => field('authorized', event.target.checked)} label="Authorize this plugin to use this profile for SSH commands and profile discovery"/>
            <div className={styles['unrestricted-command-access']}>
                <Checkbox id="ssh-allowAllCommands" checked={form.allowAllCommands} disabled={!ready || !form.authorized} onChange={event => field('allowAllCommands', event.target.checked)} label="Allow all shell commands (dangerous)"/>
                <p>Allows any command as <strong>{form.username || 'the SSH user'}</strong> on <strong>{form.host || 'this host'}</strong>, including destructive commands. Leave off to restrict access to the exact commands below.</p>
                {fieldErrors.allowAllCommands && <p role="alert">{fieldErrors.allowAllCommands}</p>}
                {form.authorized && form.allowAllCommands && <Callout intent="danger" compact icon="warning-sign">The command allowlist is bypassed for this profile. Plugin grants, credential access, host-key verification and execution limits still apply.</Callout>}
            </div>
            <FormGroup label="Allowed commands (one exact shell command per line)" labelFor="ssh-commands" intent={fieldErrors.commands ? 'danger' : 'none'} helperText={fieldErrors.commands || 'No wildcard or prefix matching. Whitespace is significant; avoid embedding secrets in commands.'}>
                <TextArea id="ssh-commands" aria-invalid={!!fieldErrors.commands} fill rows={3} value={form.commands} disabled={!ready || form.authorized && form.allowAllCommands} onChange={event => field('commands', event.target.value)} spellCheck={false}/>
            </FormGroup>
            {!form.authorized && !form.interactive && !gitSetup && !form.gitAuthorized && <Callout intent="warning">SSH command access is off. This profile will not appear in the plugin’s SSH profile list, even when SSH capabilities are granted. Authorize SSH command access and configure the command policy this plugin needs.</Callout>}
            </DialogBody>
            <DialogFooter className={styles['connection-profile-footer']}
                actions={<><Button type="button" disabled={busy} onClick={closeProfile}>Cancel</Button>
                    <Button type="submit" intent="primary" icon="floppy-disk" loading={busy} disabled={!ready}>Save SSH profile</Button></>}>
                {(profileErrorField || notice) && <Callout compact intent="danger" role="alert" title="Profile could not be saved">
                    {profileErrorField ? PROFILE_FIELD_LABELS[profileErrorField] + ': ' + fieldErrors[profileErrorField] : notice}
                    {Object.keys(fieldErrors).length > 1 && <p>Check the {Object.keys(fieldErrors).length} highlighted fields above.</p>}
                </Callout>}
                <Checkbox id="ssh-trust" checked={trust} disabled={!ready} aria-invalid={!!fieldErrors.trust} onChange={event => {
                    setTrust(event.target.checked); setFieldErrors(current => {const next = {...current}; delete next.trust; return next;});
                }} label="I verified this endpoint and host-key fingerprint through a trusted channel"/>
                <p className="bp6-text-muted">Saved verification is preserved when editing. Changing the host, port or fingerprint requires verification again.</p>
            </DialogFooter>
            </form>
            </Dialog>
            <p className="bp6-text-muted">Editing profiles, rotating or deleting credentials, revoking grants, and stopping the plugin close active connections. Closing an SSH channel cannot guarantee that a remote process stops.</p>
            <Callout intent="primary" title="Git CLI profile reuse">Backend Git operator requests use the authorized SSH profile matching each repository, including named remotes. Grant Git process execution, SSH access and secret consumption in Manage Plugins. Git must be installed; an external SSH executable is not required. Named remotes, safe Git flags, pull, submodules and Git LFS use the same profile checks. Each submodule needs its own repository authorization; LFS HTTPS destinations can be approved above. GitOps synchronization is configured separately.</Callout>
        </>}
    </Card>;
}

function X11Availability({availability,checking,disabled,onCheck,onOpenTools}) {
 const detail={SECURITY_EXTENSION_UNAVAILABLE:'The local X server does not expose X SECURITY. Trusted X11 may still be available.',SECURITY_VERSION_UNSUPPORTED:'The local X server exposes an unsupported X SECURITY protocol version.',RESTRICTED_EXTENSION_VISIBLE:'The local X server did not enforce restricted authorization on this connection. Untrusted forwarding is blocked; trusted mode is checked separately.',ISOLATION_CHECK_FAILED:'The restricted connection could access a trusted test resource. Untrusted forwarding is blocked; trusted mode is checked separately.',DISPLAY_PROBE_UNSUPPORTED:'The local X server could not complete the isolation verification. Untrusted forwarding is blocked.'};
 const explanation=(state,mode)=>detail[state.reason]||(state.reason==='DISPLAY_FORMAT_UNSUPPORTED'?'FDO does not recognize the local DISPLAY address format. Check the XQuartz or desktop session configuration.':state.reason==='PLATFORM_UNSUPPORTED'?'Local X11 discovery is not supported on this operating system. SSH terminals remain available without X11.':state.code==='X11_UNSUPPORTED'&&mode==='trusted'?'The local display configuration is unsupported. Trusted X11 does not require the X SECURITY extension.':({X11_UNSUPPORTED:'X SECURITY is unavailable or isolation checks failed. No trusted fallback is used.',X11_UNAVAILABLE:'No reachable authenticated local X display was found. Start Xorg/Xwayland or XQuartz and ensure DISPLAY is available to FDO.',X11_AUTH_UNAVAILABLE:'Local authorization could not be generated, verified or revoked. Check xauth and the local display session.'}[state.code]||'Local X11 support could not be verified.'));
 return <Callout compact icon='desktop' style={{marginTop:12}} title='Local X11 support'>
  <Button size='small' loading={checking} disabled={disabled||checking} onClick={onCheck}>Check local X11 support</Button>
  {onOpenTools && <Button size='small' icon='download' style={{marginLeft:8}} onClick={onOpenTools}>Install / set up X11</Button>}
  {['trusted','untrusted'].map(mode=>{const state=availability?.[mode];return <p key={mode}><Tag minimal intent={state?.available===true?'success':state?.available===false?'warning':'none'}>{mode==='untrusted'?'Untrusted':'Trusted'}: {state?.available===true?'Verified':state?.available===false?'Unavailable':'Not checked'}</Tag>{state?.available===false&&' '+explanation(state,mode)}</p>;})}
  {availability?.checkedAt&&<p className='bp6-text-muted'>Checked {new Date(availability.checkedAt).toLocaleString()}. Each new connection is verified again. Checking creates and revokes a temporary restricted authorization.</p>}
 </Callout>;
}
