import React, {useEffect, useState} from 'react';
import {Button, Callout, FormGroup, HTMLSelect, Spinner, Switch} from '@blueprintjs/core';
import {DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_SOURCES} from '../utils/desktop/notificationModel';
import * as styles from './css/NotificationsPanel.module.css';

export const SOURCE_LABELS = {gitops: 'GitOps', builds: 'Builds', plugins: 'Plugins', security: 'Security', ai: 'AI', observability: 'Observability', system: 'System'};

export default function NotificationPreferences() {
    const [value, setValue] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        let active = true;
        Promise.resolve(window.electron.notifications.getPreferences()).then(result => {if (active) setValue(result);})
            .catch(reason => {if (active) setError(reason.message);}).finally(() => {if (active) setLoading(false);});
        const unsubscribe = window.electron.notifications.onPreferences?.(result => {if (active) setValue(result);});
        return () => {active = false; unsubscribe?.();};
    }, []);
    /** @param {Partial<typeof DEFAULT_NOTIFICATION_PREFERENCES>} patch */
    const change = patch => {setValue(previous => ({...previous, ...patch})); setSaved(false);};
    const save = async () => {
        setBusy(true); setError(''); setSaved(false);
        try {setValue(await window.electron.notifications.savePreferences(value)); setSaved(true);}
        catch (reason) {setError(reason.message);}
        finally {setBusy(false);}
    };
    if (loading) return <Spinner size={20}/>;
    return <section aria-label="Notification preferences" className={styles.preferences}>
        <p className="bp6-text-muted">Choose which saved notifications also show a toast. Muting a source keeps its history available.</p>
        {error && <Callout intent="danger" role="alert">{error}</Callout>}
        <Switch label="Show success toasts" checked={value.successToasts} disabled={busy} onChange={event => change({successToasts: event.target.checked})}/>
        <Switch label="Show warning and failure toasts" checked={value.failureToasts} disabled={busy} onChange={event => change({failureToasts: event.target.checked})}/>
        <Switch label="Show informational toasts" checked={value.infoToasts} disabled={busy} onChange={event => change({infoToasts: event.target.checked})}/>
        <FormGroup label="Sources allowed to show toasts">
            {NOTIFICATION_SOURCES.map(source => <Switch key={source} label={SOURCE_LABELS[source]} checked={!value.mutedSources.includes(source)} disabled={busy}
                onChange={event => change({mutedSources: event.target.checked ? value.mutedSources.filter(item => item !== source) : [...value.mutedSources, source]})}/>)}
        </FormGroup>
        <FormGroup label="Keep notification history" labelFor="notification-retention">
            <HTMLSelect id="notification-retention" value={value.retentionDays} disabled={busy} onChange={event => change({retentionDays: Number(event.target.value)})}
                options={[{value: 0, label: 'Until I dismiss it'}, {value: 30, label: '30 days'}, {value: 90, label: '90 days'}]}/>
            <p className="bp6-text-muted">Saving a shorter period removes older history immediately.</p>
        </FormGroup>
        <Button intent="primary" loading={busy} onClick={save}>Save notification preferences</Button>
        {saved && <p role="status">Notification preferences saved.</p>}
    </section>;
}
