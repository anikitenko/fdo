import React, {useEffect, useState} from 'react';
import {Button, Callout, Dialog, DialogBody, DialogFooter, ProgressBar, Spinner} from '@blueprintjs/core';
import * as styles from './RegistryInstallDialog.module.css';

const labels = {
    queued: 'Preparing FDO…',
    preparing: 'Opening installation…',
    checking: 'Checking release and publisher…',
    downloading: 'Downloading plugin…',
    verifying: 'Verifying signed source…',
    approval: 'Waiting for installation approval…',
    building: 'Building plugin…',
    rechecking: 'Rechecking release status…',
    installing: 'Installing plugin…',
    restarting: 'Restarting plugin…',
    complete: 'Plugin installed',
    cancelled: 'Installation cancelled',
    error: 'Installation failed',
    blocked: 'Release unavailable',
    'already-installed': 'Already installed',
};
const terminal = new Set(['complete', 'cancelled', 'error', 'blocked', 'already-installed']);

export default function RegistryInstallDialog() {
    const [status, setStatus] = useState({phase: 'idle', revision: 0});
    const [dismissedRevision, setDismissedRevision] = useState(-1);
    useEffect(() => {
        const api = window.electron?.registryInstall;
        if (!api) return;
        let active = true;
        const receive = next => {
            if (active && next) setStatus(current => next.revision > current.revision ? next : current);
        };
        // Subscribe first, then load the snapshot. Revision ordering prevents a
        // delayed snapshot from overwriting newer progress events on cold start.
        const unsubscribe = api.onProgress(receive);
        api.getStatus().then(receive).catch(() => {});
        return () => {active = false; unsubscribe?.();};
    }, []);
    const busy = !terminal.has(status.phase);
    const dismiss = () => {if (!busy) setDismissedRevision(status.revision);};
    return <Dialog title="Install plugin" icon="download" isOpen={status.phase !== 'idle' && status.revision > dismissedRevision}
        onClose={dismiss} isCloseButtonShown={!busy} canEscapeKeyClose={!busy} canOutsideClickClose={false}>
        <DialogBody>
            <p className={styles.identity}><strong>{status.name || 'Loading plugin details…'}</strong> <span className="bp6-text-muted">v{status.version}</span></p>
            <div role="status" aria-live="polite" aria-atomic="true" className={styles.status}>
                {busy && <Spinner size={20} aria-label="Installation in progress"/>}
                <strong>{status.phase === 'complete' ? ({update: 'Plugin updated', downgrade: 'Plugin downgraded', repair: 'Plugin repaired'}[status.action] || 'Plugin installed') : labels[status.phase] || 'Preparing installation…'}</strong>
            </div>
            {busy && <ProgressBar aria-label="Plugin installation" className={styles.progress}/>}
            {status.phase === 'approval' && <p>Confirm Install or Cancel in the installation approval prompt.</p>}
            {status.installedVersion && status.action !== 'already-installed' && <p>Installed v{status.installedVersion} → requested v{status.version}</p>}
            {['error', 'blocked'].includes(status.phase) && <Callout intent="danger">{status.error || 'The plugin could not be installed. Try the registry link again.'}</Callout>}
            {status.phase === 'blocked' && <p>This release was not installed. Choose an active release signed by an active publisher certificate.</p>}
            {status.phase === 'already-installed' && <Callout intent="success">This version is already installed and its signed source is intact. No changes were made.</Callout>}
            {status.phase === 'complete' && <Callout intent="success">{status.needsCapabilityReview ? 'New capabilities require review. The plugin is inactive until you approve them in Manage Plugins.' : status.active ? 'Release installed and running. Plugin data and approved capabilities were preserved.' : 'Installed inactive. Open Manage Plugins to review capabilities and activate it.'}</Callout>}
            {status.phase === 'cancelled' && <p>No plugin was installed.</p>}
        </DialogBody>
        {!busy && <DialogFooter actions={<Button onClick={dismiss} intent={status.phase === 'complete' ? 'primary' : 'none'}>Close</Button>}/>}
    </Dialog>;
}
