import GitOpsUpdateReview from './GitOpsUpdateReview';
import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, Collapse, FormGroup, Icon, Switch, Tag} from '@blueprintjs/core';
import {TimePicker} from '@blueprintjs/datetime';
import '@blueprintjs/datetime/lib/css/blueprint-datetime.css';
import * as styles from '../../css/GitOpsPanel.module.css';

const dateForMinutes = minutes => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
const duration = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const checked = value => value ? new Date(value).toLocaleString() : 'Not checked yet';
const openExternal = (event, url) => {event.preventDefault(); window.electron.system.openExternal(url);};

export default function GitOpsRepositoryCard({repository, expanded, onToggle, busy, onAction, onEdit, feedback}) {
    const [pluginsOpen, setPluginsOpen] = useState(repository.pluginStatuses?.some(status=>status.state==='awaiting_approval')||false);
    const reviewIds=(repository.pluginStatuses||[]).map(status=>status.pendingUpdate?.reviewId||'').join(',');
    useEffect(()=>{if(reviewIds.replace(/,/g,''))setPluginsOpen(true);},[reviewIds]);
    const [interval, setIntervalValue] = useState(repository.checkIntervalMinutes || 5);
    useEffect(() => setIntervalValue(repository.checkIntervalMinutes || 5), [repository.checkIntervalMinutes]);
    const plugins = repository.manifest.spec.plugins;
    const failures = (repository.pluginStatuses || []).filter(status => status.state === 'error').length;
    const pendingCount=(repository.pluginStatuses||[]).filter(status=>status.state==='awaiting_approval').length;
    const declinedCount=(repository.pluginStatuses||[]).filter(status=>status.state==='declined').length;
    const checking = (repository.pluginStatuses || []).some(status => status.state === 'checking');
    const title = repository.manifest.metadata.displayName || repository.manifest.metadata.name;
    const anyError = failures > 0 || !!repository.syncError;
    const count = `${plugins.length} ${plugins.length === 1 ? 'plugin' : 'plugins'}`;
    return <Card id={`gitops-repository-${repository.id}`} className={styles.repository}>
        <button type="button" className={styles.header} aria-label={`${title} repository (${repository.targetRevision})`} aria-expanded={expanded} aria-controls={`gitops-repo-${repository.id}`} onClick={onToggle}>
            <Icon icon={expanded ? 'chevron-down' : 'chevron-right'}/>
            <Icon icon="git-repo" intent="primary"/>
            <span className={styles.heading}><strong>{title}</strong><span className="bp6-text-muted">{repository.url.replace(/^https:\/\//, '')} · {repository.targetRevision}</span></span>
            <span className={styles.badges}><Tag variant="minimal">{count}</Tag><Tag variant="minimal" intent={checking ? 'primary' : anyError || pendingCount || declinedCount ? 'warning' : 'success'}>
                {checking ? 'Checking…' : pendingCount ? `${pendingCount} awaiting approval` : declinedCount ? `${declinedCount} declined` : anyError ? 'Needs attention' : repository.lastSyncedAt ? 'Synced' : 'Connected'}
            </Tag>{repository.autoSync === false && <Tag variant="minimal">Paused</Tag>}</span>
        </button>
        <Collapse isOpen={expanded} keepChildrenMounted={false}>
            <div id={`gitops-repo-${repository.id}`} className={styles.body}>
                {repository.manifest.metadata.description && <p>{repository.manifest.metadata.description}</p>}
                <div className={styles.metadata}>
                    <span><Icon icon="git-branch"/> {repository.targetRevision} <span className="bp6-text-muted">({repository.revisionType})</span></span>
                    <span><Icon icon="document"/> {repository.manifestPath}</span>
                    <span>Collection v{repository.manifest.metadata.version}</span>
                </div>
                {!!repository.manifest.metadata.maintainers?.length && <p className={styles.maintainers}>Maintainers: {repository.manifest.metadata.maintainers.map((maintainer, index) => <React.Fragment key={maintainer.github}>
                    {index > 0 && ', '}<a href={`https://github.com/${encodeURIComponent(maintainer.github)}`} onClick={event => openExternal(event, `https://github.com/${encodeURIComponent(maintainer.github)}`)}>@{maintainer.github}</a>
                </React.Fragment>)}</p>}
                <div className={styles.schedule}>
                    <div><Switch label="Automatic synchronization" checked={repository.autoSync !== false} disabled={busy} onChange={event => onAction('setAutoSync', repository.id, event.target.checked)}/>
                        <span className="bp6-text-muted">Last check: {checked(repository.lastCheckedAt || repository.lastSyncedAt)}</span>
                    </div>
                    <FormGroup label="Check every (hours:minutes)" className={styles.interval}>
                        <div role="group" aria-label={`Check interval for ${title}`} className={styles.intervalControls}>
                            <TimePicker value={dateForMinutes(interval)} useAmPm={false} precision="minute" showArrowButtons selectAllOnFocus disabled={busy}
                                onChange={value => {if (value && Number.isFinite(value.getTime())) setIntervalValue(value.getHours() * 60 + value.getMinutes());}}/>
                            <Button size="small" disabled={busy || interval < 1} onClick={() => onAction('setInterval', repository.id, interval)}>Save interval</Button>
                        </div>
                        <span className="bp6-text-muted">{interval === 0 ? 'Choose at least one minute.' : `Saved interval: ${duration(repository.checkIntervalMinutes || 5)}`}</span>
                    </FormGroup>
                </div>
                {feedback && <Callout intent={feedback.intent} className={styles.feedback}>{feedback.message}</Callout>}
                {repository.syncError && !/^\d+ plugins? needs? attention\./.test(repository.syncError) && <Callout intent="warning" title="Collection needs attention" className={styles.feedback}>
                    {/targetRevision does not match/.test(repository.syncError) ? 'Some plugins could not be checked. Open the plugin list and retry to see the details for each plugin.' : repository.syncError}
                </Callout>}
                <Button variant="minimal" fill alignText="left" icon={pluginsOpen ? 'chevron-down' : 'chevron-right'}
                    aria-expanded={pluginsOpen} aria-controls={`gitops-plugins-${repository.id}`} onClick={() => setPluginsOpen(value => !value)}>
                    Plugins ({plugins.length}){pendingCount?` · ${pendingCount} awaiting approval`:failures > 0 ? ` · ${failures} need attention` : ''}
                </Button>
                <Collapse isOpen={pluginsOpen} keepChildrenMounted={false}>
                    <div id={`gitops-plugins-${repository.id}`} className={styles.plugins}>
                        <p className="bp6-text-muted">Checks stage updates that need additional permissions. Approved versions keep running until you explicitly approve the new permissions; other updates preserve enabled states and grants.</p>
                        {plugins.map(plugin => {
                            const status = repository.pluginStatuses?.find(item => item.name === plugin.name);
                            const installed = repository.installedPlugins?.find(item => item.name === plugin.name);
                            return <section className={styles.plugin} key={plugin.name} aria-label={`Plugin ${plugin.name}`}>
                                <div className={styles.pluginHeader}><strong>{plugin.name}</strong>
                                    <Tag variant="minimal" intent={status?.state === 'error' ? 'danger' : status?.state === 'awaiting_approval' ? 'warning' : status?.state === 'synced' ? 'success' : 'none'}>
                                        {status?.state === 'awaiting_approval'?'Awaiting approval':status?.state==='declined'?'Version declined':status?.state === 'error' ? 'Check failed' : status?.state === 'checking' ? 'Checking…' : installed ? 'Installed' : 'Not installed'}
                                    </Tag>
                                    <Button size="small" icon="refresh" disabled={busy || status?.state === 'checking'} loading={status?.state === 'checking'} onClick={() => onAction('syncPlugin', repository.id, plugin.name)}>
                                        Check for updates
                                    </Button>
                                </div>
                                <a href={plugin.repository} onClick={event => openExternal(event, plugin.repository)}>{plugin.repository}</a>
                                <div className={styles.metadata}><span>Declared revision: <code>{plugin.targetRevision}</code></span><span>Path: {plugin.path}</span>
                                    {installed && <span>Installed commit: <code>{installed.commit.slice(0, 12)}</code></span>}
                                </div>
                                <p className="bp6-text-muted">Last check: {checked(status?.checkedAt)}</p>
                                {status?.pendingUpdate&&<GitOpsUpdateReview pending={status.pendingUpdate} busy={busy||status.state==='checking'} onDecision={review=>onAction('reviewUpdate',repository.id,review)}/>}
                                {status?.state==='declined'&&<Callout icon="lock">This version was declined. The installed version and permissions are unchanged. <Button size="small" disabled={busy} onClick={()=>onAction('reviewUpdate',repository.id,{pluginName:plugin.name,reviewId:status.commit,decision:'reconsider'})}>Review again</Button></Callout>}
                                {status?.error && <Callout intent="danger" title={`Couldn’t update ${plugin.name}`}>{status.error}</Callout>}
                            </section>;
                        })}
                    </div>
                </Collapse>
                <div className={styles.actions}>
                    <Button size="small" icon="git-pull" disabled={busy} onClick={() => onAction('sync', repository.id)}>Sync now</Button>
                    <Button size="small" icon="refresh" disabled={busy} onClick={() => onAction('verify', repository.id)}>Verify repository</Button>
                    <Button size="small" variant="minimal" icon="edit" disabled={busy} onClick={() => onEdit(repository)}>Edit</Button>
                    <Button size="small" variant="minimal" icon="trash" intent="danger" disabled={busy} onClick={() => onAction('remove', repository.id)}>Remove</Button>
                    <span className="bp6-text-muted">{repository.hasCredentials ? 'Encrypted credentials' : 'Public access'}</span>
                </div>
            </div>
        </Collapse>
    </Card>;
}
