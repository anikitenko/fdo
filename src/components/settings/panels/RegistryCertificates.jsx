import registryConfiguration from '../../../config/officialRegistry.json';
import * as styles from '../../css/SettingsDialog.module.css';
import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, CardList, H2, NonIdealState, Spinner} from '@blueprintjs/core';
import CertificateDetails from './CertificateDetails';

export default function RegistryCertificates({revision = 0}) {
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const api = window.electron.settings.certificates;
    const refresh = async () => setState(await api.registryStatus());
    useEffect(() => {
        let current = true;
        setError('');
        api.registryStatus().then(result => {if (current) setState(result);})
            .catch(failure => {if (current) setError(failure.message);});
        return () => {current = false;};
    }, [revision]);
    const run = async operation => {
        setBusy(true);
        setError('');
        try {
            const result = await operation();
            if (result?.success === false) {setError(result.error); return;}
            await refresh();
        } catch (failure) {setError(failure.message);}
        finally {setBusy(false);}
    };
    return <section aria-label="Registry signing certificates">
        <div className={`${styles['card-setting-header']} ${styles.certificateHeader}`}>
            <H2 style={{margin: 0, fontSize: 16}}>Registry certificates</H2>
            <Button intent="primary" icon="import" disabled={busy} loading={busy}
                onClick={() => run(() => api.importRegistry({kind: 'developer'}))}>Import developer certificate</Button>
        </div>
        <p>FDO obtains the official registry certificate automatically. Import your developer certificate to sign plugins for publishing.</p>
        <p className="bp6-text-muted">Select the certificate chain and matching private key together in one file selection. A combined PEM file is also supported.</p>
        {!state && !error && <Spinner size={20} aria-label="Loading registry certificate"/>}
        {state && !state.available && <NonIdealState iconSize={24} className={styles['certificate-empty-state']} icon="cloud" title="Registry unavailable"
            description={state.configured ? 'The registry certificate could not be obtained. Try again later.' : 'The official registry is not available yet.'}
            action={state.configured ? <Button disabled={busy} loading={busy} onClick={() => run(refresh)}>Retry</Button> : undefined} layout="horizontal"/>}
        {state && <>
            <CardList>
                {state.anchor && <Card className={styles.registryCertificateCard}>
                    <CertificateDetails cert={state.anchor} label={<strong style={{color: '#2d72d2'}}>FDO Plugin Registry</strong>}/>
                </Card>}
                {state.developers.map(entry => <Card key={entry.id} className={styles.registryCertificateCard}>
                    <div className={styles.registryCertificateRow}>
                        <CertificateDetails cert={entry}/>
                        <Button size="small" variant="outlined" intent="danger"
                            disabled={busy} onClick={() => run(() => api.removeRegistry(entry.id))}>Delete</Button>
                    </div>
                    {entry.lifecycleError && <Callout className={styles.registryCertificateIssue}
                        intent={entry.lifecycleStatus === 'unavailable' ? 'warning' : 'danger'}
                        title={entry.lifecycleStatus === 'revoked' ? 'Certificate revoked' : 'Signing unavailable'}>
                        <p>{entry.lifecycleError}</p>
                        {entry.lifecycleStatus === 'unavailable' && <Button size="small" icon="refresh" disabled={busy} onClick={() => run(refresh)}>Retry status check</Button>}
                        <Button size="small" icon="share" onClick={() => window.electron.system.openExternal(new URL('/profile', registryConfiguration.certificateUrl).href)}>Open registry account</Button>
                    </Callout>}
                </Card>)}
            </CardList>
            {!state.developers.length && <NonIdealState iconSize={24} className={styles['certificate-empty-state']} icon="id-number"
                title="No developer certificate" description="Choose Import developer certificate to add your certificate chain and private key from the registry." layout="horizontal"/>}
        </>}
        {error && <Callout intent="danger">{error}</Callout>}
    </section>;
}
