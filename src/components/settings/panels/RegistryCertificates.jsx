import registryConfiguration from '../../../config/officialRegistry.json';
import * as styles from '../../css/SettingsDialog.module.css';
import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, CardList, H2, NonIdealState, Spinner} from '@blueprintjs/core';
import CertificateDetails from './CertificateDetails';

export default function RegistryCertificates({revision = 0, connection}) {
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const api = window.electron.settings.certificates;
    const load = () => connection ? api.organizationStatus(connection.id) : api.registryStatus();
    const refresh = async () => setState(await load());
    useEffect(() => {
        let current = true;
        setError('');
        load().then(result => {if (current) setState(result);})
            .catch(failure => {if (current) setError(failure.message);});
        return () => {current = false;};
    }, [revision, connection?.id]);
    const run = async operation => {
        setBusy(true);
        setError('');
        try {
            const result = await operation();
            if (result?.success === false) {setError(result.error); return;}
            if (result?.canceled) return;
            await refresh();
        } catch (failure) {setError(failure.message);}
        finally {setBusy(false);}
    };
    const retry = () => run(() => undefined);
    const accountOrigin = connection?.url || registryConfiguration.certificateUrl;
    return <section aria-label={connection ? `${connection.name} signing certificates` : 'Registry signing certificates'} aria-busy={busy}>
        <div className={`${styles['card-setting-header']} ${styles.certificateHeader}`}>
            <H2 style={{margin: 0, fontSize: 16}}>{connection ? connection.name : 'Registry certificates'}</H2>
            <Button intent="primary" icon="import" disabled={busy} loading={busy}
                onClick={() => run(() => connection ? api.importOrganization(connection.id) : api.importRegistry({kind: 'developer'}))}>Import developer certificate</Button>
        </div>
        {connection ? <p className={styles.organizationRegistryAddress}>{connection.url}</p>
            : <p>FDO obtains the official registry certificate automatically. Import your developer certificate to sign plugins for publishing.</p>}
        <p className="bp6-text-muted">Select the certificate chain and matching private key together in one file selection. A combined PEM file is also supported.</p>
        {!state && !error && <Spinner size={20} aria-label="Loading registry certificate"/>}
        {state && !state.available && <NonIdealState iconSize={24} className={styles['certificate-empty-state']} icon="cloud" title="Registry unavailable"
            description={state.configured ? state.error || 'The registry certificate could not be obtained. Try again later.' : 'The official registry is not available yet.'}
            action={state.configured ? <Button disabled={busy} loading={busy} onClick={retry}>Retry</Button> : undefined} layout="horizontal"/>}
        {state && <>
            <CardList>
                {state.anchor && <Card className={styles.registryCertificateCard}>
                    <CertificateDetails cert={state.anchor} label={<strong>{connection ? `${connection.name} trust root` : 'FDO Plugin Registry'}</strong>}/>
                </Card>}
                {state.developers.map(entry => <Card key={entry.id} className={styles.registryCertificateCard}>
                    <div className={styles.registryCertificateRow}>
                        <CertificateDetails cert={entry}/>
                        <Button size="small" variant="outlined" intent="danger"
                            disabled={busy} onClick={() => run(() => connection ? api.removeOrganizationCertificate(connection.id, entry.id) : api.removeRegistry(entry.id))}>Delete</Button>
                    </div>
                    {entry.lifecycleError && <Callout className={styles.registryCertificateIssue}
                        intent={entry.lifecycleStatus === 'unavailable' ? 'warning' : 'danger'}
                        title={entry.lifecycleStatus === 'revoked' ? 'Certificate revoked' : 'Signing unavailable'}>
                        <p>{entry.lifecycleError}</p>
                        <div className={styles.registryCertificateActions}>
                            {entry.lifecycleStatus === 'unavailable' && <Button size="small" icon="refresh" disabled={busy} onClick={retry}>Retry status check</Button>}
                            <Button size="small" icon="share" disabled={!accountOrigin} onClick={() => window.electron.system.openExternal(new URL('/profile', accountOrigin).href)}>Open registry account</Button>
                        </div>
                    </Callout>}
                </Card>)}
            </CardList>
            {!state.developers.length && <NonIdealState iconSize={24} className={styles['certificate-empty-state']} icon="id-number"
                title="No developer certificate" description="Choose Import developer certificate to add your certificate chain and private key from the registry." layout="horizontal"/>}
        </>}
        {error && <Callout intent="danger" role="alert">{error} <Button size="small" disabled={busy} onClick={retry}>Retry</Button></Callout>}
    </section>;
}
