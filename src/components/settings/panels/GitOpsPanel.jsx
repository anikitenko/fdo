import React, {useEffect, useState} from 'react';
import {Button, Callout, Dialog, FormGroup, HTMLSelect, InputGroup, NonIdealState} from '@blueprintjs/core';
import * as styles from '../../css/SettingsDialog.module.css';
import GitOpsRepositoryCard from './GitOpsRepositoryCard';

const EMPTY = {url: '', authType: 'none', username: '', password: '', manifestPath: 'fdo-plugins.yaml', revisionType: 'branch', targetRevision: 'main'};

function successfulResult(result) {
    if (!result.success) throw new Error(result.error);
    return result;
}

export default function GitOpsPanel({focusRepositoryId}) {
    const [repositories, setRepositories] = useState([]);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');
    const [expanded, setExpanded] = useState({});
    const [feedback, setFeedback] = useState({});
    useEffect(() => {
        if (!focusRepositoryId || !repositories.some(repository => repository.id === focusRepositoryId)) return;
        setExpanded(previous => previous[focusRepositoryId] ? previous : {...previous, [focusRepositoryId]: true});
        document.getElementById(`gitops-repository-${focusRepositoryId}`)?.scrollIntoView({block: 'nearest'});
    }, [focusRepositoryId, repositories.length]);
    useEffect(() => {
        let active = true;
        const load = () => window.electron.settings.gitops.list().then(result => {
            if (!active) return;
            if (!result.success) throw new Error(result.error);
            setRepositories(result.repositories);
        }).catch(reason => { if (active) setError(reason.message); })
            .finally(() => { if (active) setLoading(false); });
        void load();
        const unsubscribe = window.electron.settings.gitops.onUpdated?.(load);
        return () => { active = false; unsubscribe?.(); };
    }, []);
    const change = (key, value) => {setDraft(previous => ({...previous, [key]: value})); setFormError('');};
    const save = async event => {
        event.preventDefault();
        setBusy(true); setFormError(''); setNotice('');
        try {
            const result = successfulResult(await window.electron.settings.gitops.save(draft));
            setRepositories(result.repositories); setDraft(null);
            setExpanded(previous => ({...previous, [result.repository?.id || result.repositories.at(-1)?.id]: true}));
            setNotice(result.repository?.pluginStatuses?.some(status=>status.state==='awaiting_approval') ? 'Repository saved. Review pending permission updates below.' : result.repository?.syncError ? 'Repository saved. Plugin synchronization needs attention below.' : 'Repository saved and plugins synchronized.');
        } catch (reason) { setFormError(reason.message); }
        finally { setBusy(false); }
    };
    const action = async (method, id, value) => {
        setBusy(true); setError(''); setNotice('');
        setFeedback(previous => ({...previous, [id]: null}));
        try {
            const result = successfulResult(await window.electron.settings.gitops[method](id, value));
            setRepositories(result.repositories);
            const messages = {verify: 'Repository access and manifest verified.', sync: 'Plugin checks completed. See each plugin for its result.',
                syncPlugin: `Check completed for ${value}.`, setInterval: 'Automatic check interval saved.',
                reviewUpdate: 'Update review saved.', setAutoSync: value ? 'Automatic synchronization enabled.' : 'Automatic synchronization paused.'};
            if (method === 'remove') setNotice('Subscription and credentials removed. Installed plugins are now managed locally.');
            else setFeedback(previous => ({...previous, [id]: {intent: 'primary', message: messages[method]}}));
            return result;
        } catch (reason) {
            setFeedback(previous => ({...previous, [id]: {intent: 'danger', message: reason.message}}));
            const refreshed = await window.electron.settings.gitops.list().catch(() => null);
            if (refreshed?.success) setRepositories(refreshed.repositories);
            return {success:false,error:reason.message};
        }
        finally { setBusy(false); }
    };
    return <div className={styles['card-panel']}>
        <h3 className={styles['card-setting-header']}>GitOps</h3>
        <p>Connect Git repositories containing a PluginCollection manifest.</p>
        <p className="bp6-text-muted">Manage each repository’s schedule and check individual plugins for updates. New plugins are installed disabled; existing enabled states are preserved.</p>
        <Button icon="git-repo" intent="primary" disabled={busy || loading} onClick={() => {setDraft({...EMPTY}); setFormError('');}}>Add Git Repository</Button>
        {loading && <p>Loading repositories…</p>}
        {error && <Callout intent="danger" style={{marginTop: 12}}>{error}</Callout>}
        {notice && <Callout intent="success" style={{marginTop: 12}}>{notice}</Callout>}
        {!loading && !error && !repositories.length && <NonIdealState icon="git-repo" title="No Git repositories" description="Add a repository to connect a plugin collection."/>}
        {repositories.map(repository => <GitOpsRepositoryCard key={repository.id} repository={repository}
            expanded={expanded[repository.id] ?? repositories.length === 1}
            onToggle={() => setExpanded(previous => ({...previous, [repository.id]: !(previous[repository.id] ?? repositories.length === 1)}))}
            busy={busy} onAction={action} feedback={feedback[repository.id]}
            onEdit={repository => {setDraft({...repository, username: '', password: ''}); setFormError('');}}/>)}
        <Dialog isOpen={!!draft} title={draft?.id ? 'Edit Git Repository' : 'Add Git Repository'} style={{width: 580}}
            canOutsideClickClose={false} canEscapeKeyClose={!busy} isCloseButtonShown={!busy} onClose={() => !busy && setDraft(null)}>
            {draft && <form onSubmit={save} style={{padding: '0 20px 20px', maxHeight: '75vh', overflowY: 'auto'}}>
                <fieldset disabled={busy} style={{border: 0, padding: 0, margin: 0}}>
                    <FormGroup label="Repository URL" labelFor="gitops-url" helperText="HTTPS Git URL, without credentials in the URL.">
                        <InputGroup id="gitops-url" required type="url" placeholder="https://github.com/acme/fdo-plugins.git" value={draft.url} onChange={event => change('url', event.target.value)}/>
                    </FormGroup>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12}}>
                        <FormGroup label="Revision type" labelFor="gitops-revision-type">
                            <HTMLSelect id="gitops-revision-type" fill value={draft.revisionType} onChange={event => change('revisionType', event.target.value)} options={[{value: 'branch', label: 'Branch'}, {value: 'tag', label: 'Release tag'}]}/>
                        </FormGroup>
                        <FormGroup label={draft.revisionType === 'tag' ? 'Tag name' : 'Branch name'} labelFor="gitops-revision">
                            <InputGroup id="gitops-revision" required value={draft.targetRevision} onChange={event => change('targetRevision', event.target.value)}/>
                        </FormGroup>
                    </div>
                    <FormGroup label="Manifest path" labelFor="gitops-manifest" helperText="Path relative to the repository root, for example collections/azure.yaml.">
                        <InputGroup id="gitops-manifest" required value={draft.manifestPath} onChange={event => change('manifestPath', event.target.value)}/>
                    </FormGroup>
                    <FormGroup label="Authentication" labelFor="gitops-auth">
                        <HTMLSelect id="gitops-auth" fill value={draft.authType} onChange={event => {change('authType', event.target.value); change('username', ''); change('password', '');}}
                            options={[{value: 'none', label: 'None (public repository)'}, {value: 'basic', label: 'Username and access token / password'}]}/>
                    </FormGroup>
                    {draft.authType === 'basic' && <>
                        <p className="bp6-text-muted">Credentials are encrypted with your OS keychain and stored separately for this collection. They also provide read access to its plugin repositories on the same host. Other hosts are accessed without credentials.</p>
                        {draft.hasCredentials && <p>Leave both fields empty to keep the saved credentials for this URL.</p>}
                        <FormGroup label="Username" labelFor="gitops-username">
                            <InputGroup id="gitops-username" autoComplete="off" value={draft.username} onChange={event => change('username', event.target.value)}/>
                        </FormGroup>
                        <FormGroup label="Access token / password" labelFor="gitops-password">
                            <InputGroup id="gitops-password" type="password" autoComplete="new-password" value={draft.password} onChange={event => change('password', event.target.value)}/>
                        </FormGroup>
                    </>}
                    <p className="bp6-text-muted">Verification checks read access and validates the manifest. Public repositories may allow access even with invalid credentials.</p>
                    {formError && <Callout intent="danger" style={{marginBottom: 12}}>{formError}</Callout>}
                </fieldset>
                <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
                    <Button disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
                    <Button type="submit" intent="primary" loading={busy}>Verify and save</Button>
                </div>
            </form>}
        </Dialog>
    </div>;
}
