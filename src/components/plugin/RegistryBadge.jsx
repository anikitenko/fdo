import React, {useState} from 'react';
import {Button, Dialog, DialogBody, Tag} from '@blueprintjs/core';
import * as styles from '../css/GitOpsBadge.module.css';

export default function RegistryBadge({plugin}) {
    const [open, setOpen] = useState(false);
    const source = plugin.registry;
    if (!source) return null;
    const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
    return <>
        <Button size="small" icon="cloud-download" intent="primary" endIcon="info-sign" className={styles.badge}
            aria-label={`View registry details for ${plugin.metadata?.name || 'plugin'}`} onClick={() => setOpen(true)}>Registry</Button>
        <Dialog isOpen={open} onClose={() => setOpen(false)} title="Registry installation" icon="cloud-download" className={styles.dialog}>
            <DialogBody className={styles.body}>
                <p><strong>{plugin.metadata?.name}</strong> <Tag variant="minimal">v{source.version}</Tag></p>
                <p>Open another release’s Install in FDO link to update or downgrade. FDO verifies each release before replacement.</p>
                <dl className={styles.details}>{[
                    ['Registry', source.origin], ['Plugin ID', source.pluginId], ['Installed version', source.version],
                    ['Installed', date(source.installedAt)], ['Last updated', date(source.updatedAt)],
                    ['Archive SHA-256', source.packageSha256], ['Publisher key fingerprint', source.signerFingerprint],
                    ['Capability review', source.needsCapabilityReview ? 'Review required before activation' : 'No additional review recorded'],
                ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl>
            </DialogBody>
        </Dialog>
    </>;
}
