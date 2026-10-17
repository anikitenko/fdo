import React, {useEffect, useState} from 'react';
import {Button, Callout, Dialog, DialogBody, DialogFooter, Spinner, Tag} from '@blueprintjs/core';
import * as styles from '../css/GitOpsBadge.module.css';

const timestamp = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not recorded';
};

function RepositoryLink({url}) {
    let target;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) target = parsed.href;
    } catch { /* Show unavailable or malformed historical URLs as plain text. */ }
    return target ? <a href={target} onClick={event => {
        event.preventDefault();
        window.electron.system.openExternal(target);
    }}>{url}</a> : <span>{url || 'Not recorded'}</span>;
}

function Details({rows}) {
    return <dl className={styles.details}>{rows.map(([label, value]) => <div key={label}>
        <dt>{label}</dt><dd>{value ?? 'Not recorded'}</dd>
    </div>)}</dl>;
}

export default function GitOpsBadge({plugin, verification}) {
    const [open, setOpen] = useState(false);
    const [collection, setCollection] = useState(null);
    const [loading, setLoading] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const gitops = plugin.gitops;
    useEffect(() => {setOpen(false);}, [plugin.id, gitops?.sourceId]);
    useEffect(() => {
        if (!open || !gitops) return;
        let active = true;
        setCollection(null); setUnavailable(false); setLoading(true);
        const load = async () => {
            try {
                const result = await window.electron.settings.gitops.list();
                if (!active) return;
                const source = result?.success && result.repositories.find(repository => repository.id === gitops.sourceId);
                setCollection(source || null);
                setUnavailable(!source);
            } catch { if (active) setUnavailable(true); }
            finally { if (active) setLoading(false); }
        };
        void load();
        const unsubscribe = window.electron.settings?.gitops?.onUpdated?.(load);
        return () => {active = false; unsubscribe?.();};
    }, [open, gitops?.sourceId, plugin.id]);
    if (!gitops) return null;
    const pluginName = plugin.name || plugin.metadata?.name || gitops.declaredId;
    const status = collection?.pluginStatuses?.find(item => item.name === gitops.declaredId);
    const declaration = collection?.manifest.spec.plugins.find(item => item.name === gitops.declaredId);
    const close = () => setOpen(false);
    return <>
        <Button size="small" intent="primary" icon="git-repo" endIcon="info-sign" className={styles.badge}
            aria-label={`View GitOps details for ${pluginName}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>GitOps</Button>
        <Dialog isOpen={open} onClose={close} title="GitOps details" icon="git-repo" className={styles.dialog}>
            <DialogBody className={styles.body}>
                <div className={styles.summary}><strong>{pluginName}</strong><Tag variant="minimal" intent="primary">Managed by GitOps</Tag></div>
                <p className="bp6-text-muted">Read-only information about this plugin’s installed source and repository subscription. Updates are managed in Settings → GitOps.</p>
                <h4>Installed source</h4>
                <Details rows={[
                    ['Declared plugin name', gitops.declaredId],
                    ['Internal plugin ID', <code>{plugin.id}</code>],
                    ['Repository', <RepositoryLink url={gitops.repository}/>],
                    ['Target revision', gitops.targetRevision],
                    ['Plugin path', gitops.path],
                    ['Installed commit', <code>{gitops.commit || 'Not recorded'}</code>],
                ]}/>
                <h4>Signing</h4>
                <Details rows={[
                    ['Signature', verification == null ? 'Checking signature…' : verification.success ? 'Verified' : 'Verification failed'],
                    ['Certificate', verification?.signer?.label || 'Not available'],
                ]}/>
                {verification?.success === false && verification.error && <Callout intent="warning">{verification.error}</Callout>}
                <h4>Collection and synchronization</h4>
                {loading && <div role="status" className={styles.loading}><Spinner size={16}/> Loading collection details…</div>}
                {unavailable && <Callout intent="warning">Collection details are currently unavailable. The installed source information above is still available.</Callout>}
                {collection && <>
                    <Details rows={[
                        ['Collection', collection.manifest.metadata.displayName || collection.manifest.metadata.name],
                        ['Collection version', collection.manifest.metadata.version],
                        ['Repository', <RepositoryLink url={collection.url}/>],
                        ['Collection revision', `${collection.targetRevision} (${collection.revisionType})`],
                        ['Manifest path', collection.manifestPath],
                        ['Manifest commit', <code>{collection.commit}</code>],
                        ['Automatic checks', collection.autoSync === false ? 'Paused' : 'Enabled'],
                        ['Check interval', `${Math.floor((collection.checkIntervalMinutes || 5) / 60)}h ${(collection.checkIntervalMinutes || 5) % 60}m`],
                        ['Last check', timestamp(status?.checkedAt || collection.lastCheckedAt)],
                        ['Last synchronization', timestamp(collection.lastSyncedAt)],
                        ...(declaration && declaration.targetRevision !== gitops.targetRevision ? [['Currently declared revision', declaration.targetRevision]] : []),
                    ]}/>
                    {(status?.error || collection.syncError) && <Callout intent="warning" title="Synchronization needs attention">{status?.error || collection.syncError}</Callout>}
                </>}
            </DialogBody>
            <DialogFooter actions={<Button onClick={close}>Close</Button>}/>
        </Dialog>
    </>;
}
