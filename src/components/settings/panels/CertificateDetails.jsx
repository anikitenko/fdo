import React from 'react';
import {certificateDisplayName, certificateInformation} from '../../../utils/system/certificateDisplay';
import {Icon} from '@blueprintjs/core';
import {differenceInDays, formatDistanceToNow, isValid} from 'date-fns';
import {CertificateValidComponent} from '../../editor/utils/CertificateValidComponent';
import * as styles from '../../css/SettingsDialog.module.css';

export default function CertificateDetails({cert, label}) {
    const info = certificateInformation(cert);
    const added = new Date(cert.createdAt);
    const lastUsed = new Date(cert.lastUsedAt);
    return <div className={styles.certificateDetails}>
        <Icon icon="id-number" size={32}/>
        <div className={styles.certificateBody}>
            <div className={styles.certificateName}>{label || <strong>{info.name}</strong>}</div>
            {info.organization && <div>Organization: {info.organization}</div>}
            {info.team && <div>Team: {info.team}</div>}
            {info.email && <div>Email: {info.email}</div>}
            {cert.imported !== true && cert.identity && <div><strong>{certificateDisplayName(cert.identity)}</strong></div>}

            <CertificateValidComponent cert={cert}/>
            {isValid(added) && <div className="bp6-text-muted">Added {formatDistanceToNow(added, {addSuffix: true})}</div>}
            {isValid(lastUsed) && <div className={`bp6-text-muted ${cert.lifecycleStatus && cert.lifecycleStatus !== 'active' ? '' : differenceInDays(new Date(), lastUsed) < 7 ? styles['text-green'] : styles['text-red']}`}>
                Last used {formatDistanceToNow(lastUsed, {addSuffix: true})}
            </div>}
            <details className={styles.certificateTechnicalDetails}>
                <summary>Certificate details</summary>
                {info.accountId && <div>Account ID: <code>{info.accountId}</code></div>}
                <div>Fingerprint: <code>{cert.id}</code></div>
            </details>
        </div>
    </div>;
}
