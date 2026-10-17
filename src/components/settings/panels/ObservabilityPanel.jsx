import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, Dialog, DialogBody, FormGroup, H3, InputGroup, NumericInput, Spinner, Switch, Tag} from '@blueprintjs/core';
import * as styles from '../../css/SettingsDialog.module.css';

const retentionLabels = {runtimeDays: 'CPU and memory', diagnosticsDays: 'Metrics and startup events', traceDays: 'AI traces and export queue', usageDays: 'AI usage and costs'};
const exportLabels = {local: 'Local only', pending: 'Awaiting export', failed: 'Export failed', sent: 'Exported'};
const errorText = error => String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
const formFor = data => ({localTracing: data.localTracing, captureContent: data.captureContent, retention: {...data.retention},
    langfuse: {...data.langfuse, secretKey: '', clearSecret: false}});

export default function ObservabilityPanel() {
    const [data, setData] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(''), [notice, setNotice] = useState(null), [trace, setTrace] = useState(null);
    const api = window.electron.settings.observability;
    const perform = async (action, task, success) => {
        setBusy(action); setNotice(null);
        try {const result = await task(); if (success) setNotice({intent: 'success', message: success(result)}); return result;}
        catch (error) {setNotice({intent: 'danger', message: errorText(error)});}
        finally {setBusy('');}
    };
    const load = () => perform('load', async () => {const result = await api.get(); setData(result); setForm(formFor(result));});
    useEffect(() => {load();}, []);
    const langfuseField = (field, value) => setForm(current => ({...current, langfuse: {...current.langfuse, [field]: value}}));
    const overrides = data?.effectiveLangfuse?.overridden || [];
    const fieldValue = field => overrides.includes(field) ? data.effectiveLangfuse[field] : form.langfuse[field];
    const disabled = field => !!busy || overrides.includes(field);
    return <Card className={styles['card-panel']}>
        <H3 style={{marginTop: 16}}>Observability</H3>
        {notice && <Callout intent={notice.intent} style={{marginBottom: 12}} role="status">{notice.message}</Callout>}
        {!form ? busy ? <Spinner size={24}/> : <Button onClick={load} text="Load observability settings"/> : <>
            {(data.storage?.error || data.lastExportError) && <Callout intent="warning" style={{marginBottom: 12}}>{data.storage?.error || data.lastExportError}</Callout>}
            <Switch label="Record AI traces locally" checked={form.localTracing} disabled={!!busy} onChange={event => setForm({...form, localTracing: event.target.checked})}/>
            <Switch label="Include prompts, responses, and tool content" checked={form.captureContent} disabled={!!busy} onChange={event => setForm({...form, captureContent: event.target.checked})}/>
            <p className="bp6-text-muted">Trace content is encrypted using your OS credential store. When content capture is off, traces contain timings, outcomes, and basic metadata.</p>
            <H3 style={{marginTop: 24}}>Langfuse</H3>
            <p className="bp6-text-muted">Export AI traces to your Langfuse project. Enabling export also records encrypted traces locally so interrupted exports can resume.</p>
            {overrides.length > 0 && <Callout intent="primary" style={{marginBottom: 12}}>Environment variables override these fields: {overrides.join(', ')}. Change those variables and restart FDO to edit them here.</Callout>}
            <Switch label="Export traces to Langfuse" checked={!!fieldValue('enabled')} disabled={disabled('enabled')} onChange={event => langfuseField('enabled', event.target.checked)}/>
            <FormGroup label="Server URL" labelFor="observability-host" helperText="Use your regional cloud URL or a self-hosted HTTPS base URL.">
                <InputGroup id="observability-host" placeholder="https://cloud.langfuse.com" value={fieldValue('host') || ''} disabled={disabled('host')} onChange={event => langfuseField('host', event.target.value)}/>
            </FormGroup>
            <FormGroup label="Public key" labelFor="observability-public-key">
                <InputGroup id="observability-public-key" autoComplete="off" value={fieldValue('publicKey') || ''} disabled={disabled('publicKey')} onChange={event => langfuseField('publicKey', event.target.value)}/>
            </FormGroup>
            <FormGroup label="Secret key" labelFor="observability-secret-key" helperText="Saved secrets are encrypted and never returned to this panel.">
                <InputGroup id="observability-secret-key" type="password" autoComplete="new-password" value={form.langfuse.secretKey} disabled={disabled('secretKey')}
                    placeholder={overrides.includes('secretKey') ? 'Provided by environment' : form.langfuse.clearSecret ? 'Saved secret will be removed' : data.langfuse.hasSecretKey ? 'Saved secret; leave blank to keep' : 'sk-lf-…'}
                    onChange={event => setForm({...form, langfuse: {...form.langfuse, secretKey: event.target.value, clearSecret: false}})}/>
                {data.langfuse.hasSecretKey && <Button variant="minimal" size="small" icon="cross" disabled={disabled('secretKey')} text={form.langfuse.clearSecret ? 'Keep saved secret' : 'Remove saved secret'} onClick={() => langfuseField('clearSecret', !form.langfuse.clearSecret)}/>}
            </FormGroup>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
                {['environment', 'release'].map(field => <FormGroup key={field} label={field === 'environment' ? 'Environment' : 'Release (optional)'} labelFor={`observability-${field}`}>
                    <InputGroup id={`observability-${field}`} value={fieldValue(field) || ''} disabled={disabled(field)} onChange={event => langfuseField(field, event.target.value)}/>
                </FormGroup>)}
            </div>
            <Button icon="link" text="Test connection" loading={busy === 'test'} disabled={!!busy} onClick={() => perform('test', () => api.test(form), result => result.message)}/>
            <H3 style={{marginTop: 24}}>History retention</H3>
            <p className="bp6-text-muted">Days to keep each history. Older entries are removed after saving. Storage also has size limits; AI usage retains up to 5,000 requests.</p>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px'}}>
                {Object.entries(retentionLabels).map(([field, label]) => <FormGroup key={field} label={label} labelFor={`retention-${field}`}>
                    <NumericInput id={`retention-${field}`} min={1} max={365} fill value={form.retention[field]} disabled={!!busy} onValueChange={value => setForm({...form, retention: {...form.retention, [field]: value}})}/>
                </FormGroup>)}
            </div>
            <Button intent="primary" icon="floppy-disk" text="Save observability settings" loading={busy === 'save'} disabled={!!busy} onClick={() => perform('save', async () => {
                const result = await api.save(form); setData(result); setForm(formFor(result)); return result;
            }, () => 'Observability settings saved.')}/>
            <H3 style={{marginTop: 24}}>Stored history</H3>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12}}>
                {Object.entries({usage_entries: ['AI request', 'AI requests'], runtime_samples: ['runtime sample', 'runtime samples'], startup_events: ['startup event', 'startup events'], traces: ['trace', 'traces']}).map(([key, labels]) => <Tag key={key}>{data.counts?.[key] || 0} {labels[data.counts?.[key] === 1 ? 0 : 1]}</Tag>)}
            </div>
            <p className="bp6-text-muted">AI totals: {data.metrics?.tokens?.requests || 0} token-usage reports · {data.metrics?.retrieval?.totalQueries || 0} retrievals · {data.metrics?.answers?.totalReplies || 0} replies</p>
            <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12}}>
                <Button icon="refresh" text="Refresh history" disabled={!!busy} onClick={() => perform('refresh', async () => {const result = await api.get(); setData(result);})}/>
                <Button icon="repeat" text="Retry pending exports" disabled={!!busy || !data.effectiveLangfuse.enabled} loading={busy === 'retry'} onClick={() => perform('retry', async () => {const result = await api.retry(); setData(result);}, () => 'Export queue checked.')}/>
            </div>
            <p className="bp6-text-muted">Failed exports retry with backoff, up to eight attempts. Disabled export is paused. Pending traces stay tied to their original server and project key.</p>
            {data.traces?.map(item => <Card key={item.id} style={{padding: 10, marginBottom: 8}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between'}}>
                    <div><strong>{item.name}</strong><div className="bp6-text-muted" style={{fontSize: 12}}>{new Date(item.createdAt).toLocaleString()} · {item.status}</div></div>
                    <Tag intent={item.exportState === 'failed' ? 'danger' : item.exportState === 'sent' ? 'success' : 'none'}>{exportLabels[item.exportState]}</Tag>
                </div>
                {item.lastError && <p className="bp6-text-muted">{item.lastError}</p>}
                <Button variant="minimal" size="small" icon="document-open" text="View trace" disabled={!!busy} onClick={() => perform('trace', async () => {const result = await api.trace(item.id); if (!result) throw new Error('This trace is no longer available. Refresh history.'); setTrace(result);})}/>
            </Card>)}
            {!data.traces?.length && <p className="bp6-text-muted">No AI traces recorded yet.</p>}
            <details><summary style={{cursor: 'pointer', margin: '12px 0'}}>Recent startup timings</summary>
                {(data.startups || []).slice(0, 20).map((item, index) => <div key={index} style={{display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0'}}><span>{item.event}</span><span className="bp6-text-muted">{item.elapsed} ms{item.imported ? ' (imported)' : ''}</span></div>)}
            </details>
        </>}
        <Dialog title="AI trace details" isOpen={!!trace} onClose={() => setTrace(null)} style={{width: 700}}>
            <DialogBody><pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 450, overflowY: 'auto'}}>{trace ? JSON.stringify(trace, null, 2) : ''}</pre></DialogBody>
        </Dialog>
    </Card>;
}
