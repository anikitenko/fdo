import React, {useEffect, useState} from 'react';
import {Alert, Button, Callout, Card, Dialog, DialogBody, DialogFooter, FormGroup, H2, InputGroup, NonIdealState, Spinner} from '@blueprintjs/core';
import RegistryCertificates from './RegistryCertificates';
import * as styles from '../../css/SettingsDialog.module.css';

const emptyForm = {name: '', url: '', rootFingerprint256: ''};

export default function OrganizationCertificates() {
    const api = window.electron.settings.certificates;
    const [connections, setConnections] = useState(null);
    const [error, setError] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [removing, setRemoving] = useState(null);
    const refresh = async () => setConnections(await api.listOrganizations());
    useEffect(() => {
        let active = true;
        api.listOrganizations().then(result => {if (active) setConnections(result);})
            .catch(failure => {if (active) setError(failure.message);});
        return () => {active = false;};
    }, []);
    const connect = async event => {
        event.preventDefault();
        setBusy(true); setFormError('');
        try {
            const result = await api.addOrganization(form);
            if (!result.success) {setFormError(result.error); return;}
            setConnections(current => [...(current || []).filter(item => item.id !== result.connection.id), result.connection]);
            setDialogOpen(false); setForm(emptyForm);
            setError('');
            try {await refresh();} catch (failure) {setError(`Registry connected. Could not refresh the list: ${failure.message}`);}
        } catch (failure) {setFormError(failure.message);}
        finally {setBusy(false);}
    };
    const disconnect = async () => {
        setBusy(true); setError('');
        try {
            await api.removeOrganization(removing.id);
            setConnections(current => current.filter(item => item.id !== removing.id));
            setRemoving(null); await refresh();
        }
        catch (failure) {setRemoving(null); setError(failure.message);}
        finally {setBusy(false);}
    };
    const fingerprintValid = /^[a-f0-9]{64}$/i.test(form.rootFingerprint256.trim().replace(/:/g, ''));
    return <section aria-label="Organization certificates">
        <div className={`${styles['card-setting-header']} ${styles.certificateHeader}`}>
            <H2 style={{margin: 0, fontSize: 16}}>Organization certificates</H2>
            <Button icon="add" intent="primary" disabled={busy || !connections || connections.length >= 20}
                onClick={() => {setFormError(''); setDialogOpen(true);}}>Connect private registry</Button>
        </div>
        <p>Connect up to 20 private FDO registries per profile alongside the official registry. Each private registry has its own trusted root and developer certificates.</p>
        <p>All registries use the same certificate import, signing, export, renewal and revocation workflow. Choose the intended registry’s certificate in the signing dialog. Disconnecting one private registry leaves the others connected.</p>
        {connections && <p role="status" aria-live="polite" className="bp6-text-muted">{connections.length} of 20 private registries connected in this profile.</p>}
        {connections?.length >= 20 && <Callout intent="primary">Profile limit reached. Disconnect a private registry before connecting another.</Callout>}
        <p className="bp6-text-muted">Private keys are protected by your OS credential store. A registry connection does not grant plugin permissions.</p>
        {!connections && !error && <Spinner size={20} aria-label="Loading private registries"/>}
        {connections?.length === 0 && <NonIdealState className={styles['certificate-empty-state']} iconSize={24} icon="office"
            title="No private registries connected" description="Ask your administrator for the HTTPS address and root certificate SHA-256 fingerprint." layout="horizontal"/>}
        {connections?.map(connection => <Card key={connection.id} className={styles.organizationRegistryCard}>
            <RegistryCertificates connection={connection}/>
            <div className={styles.organizationRegistryFooter}>
                <Button size="small" icon="share" onClick={() => window.electron.system.openExternal(new URL('/profile', connection.url).href)}>Open registry account</Button>
                <Button size="small" intent="danger" variant="minimal" disabled={busy} onClick={() => setRemoving(connection)}>Disconnect registry</Button>
            </div>
            <details className={styles.certificateTechnicalDetails}>
                <summary>Connection details</summary>
                <div>Registry ID: <code>{connection.id}</code></div>
                <div>Trusted root SHA-256: <code>{connection.rootFingerprint256}</code></div>
            </details>
        </Card>)}
        {error && <Callout intent="danger" role="alert">{error} <Button size="small" disabled={busy} onClick={async () => {
            try {await refresh(); setError('');} catch (failure) {setError(failure.message);}
        }}>Retry</Button></Callout>}
        <Dialog isOpen={dialogOpen} title="Connect private registry" icon="office" className={styles.organizationRegistryDialog}
            canOutsideClickClose={!busy} canEscapeKeyClose={!busy} isCloseButtonShown={!busy} onClose={() => {if (!busy) setDialogOpen(false);}}>
            <form onSubmit={connect}>
                <DialogBody>
                    <p>Add a private registry to this profile. You can connect up to 20 alongside the official registry. Use an FDO-compatible registry address and the root fingerprint supplied by your administrator.</p>
                    <FormGroup label="Organization name" labelFor="organization-registry-name">
                        <InputGroup id="organization-registry-name" autoFocus required maxLength={80} disabled={busy} value={form.name} placeholder="Acme Engineering"
                            onChange={event => setForm({...form, name: event.target.value})}/>
                    </FormGroup>
                    <FormGroup label="Registry HTTPS address" labelFor="organization-registry-url" helperText="Use the origin only, with no path. Connect to your organization’s VPN first if required.">
                        <InputGroup id="organization-registry-url" type="url" required maxLength={2048} disabled={busy} value={form.url} placeholder="https://plugins.example.com"
                            onChange={event => setForm({...form, url: event.target.value})}/>
                    </FormGroup>
                    <FormGroup label="Root certificate SHA-256 fingerprint" labelFor="organization-registry-fingerprint"
                        helperText="Obtain this through a trusted channel separate from the registry download. Colons are accepted.">
                        <InputGroup id="organization-registry-fingerprint" required maxLength={95} disabled={busy} value={form.rootFingerprint256} spellCheck={false}
                            placeholder="64 hexadecimal characters" onChange={event => setForm({...form, rootFingerprint256: event.target.value})}/>
                    </FormGroup>
                    <p className="bp6-text-muted">FDO verifies the root and signed trust document before saving this connection. Your certificate and private key are imported separately.</p>
                    {formError && <Callout intent="danger" role="alert">{formError}</Callout>}
                </DialogBody>
                <DialogFooter actions={<><Button disabled={busy} onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" intent="primary" loading={busy} disabled={busy || !form.name.trim() || !form.url.trim() || !fingerprintValid}>Verify and connect</Button></>}/>
            </form>
        </Dialog>
        <Alert isOpen={!!removing} intent="danger" icon="warning-sign" confirmButtonText="Disconnect registry" cancelButtonText="Cancel"
            loading={busy} canEscapeKeyCancel={!busy} canOutsideClickCancel={!busy} onCancel={() => {if (!busy) setRemoving(null);}} onConfirm={disconnect}>
            <p>Disconnect <strong>{removing?.name}</strong> ({removing?.url})?</p>
            <p>This removes its trusted certificates and locally stored signing keys from this profile. Installed plugins from this registry will fail verification and running plugins will stop at the next status check. Server certificates are not revoked.</p>
        </Alert>
    </section>;
}
