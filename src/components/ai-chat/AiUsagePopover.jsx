import React, {useEffect, useState} from 'react';
import {Button, Callout, FormGroup, InputGroup, Popover, Spinner} from '@blueprintjs/core';
import {rateKey} from '../../utils/aiBilling/pricing';
import './AiUsagePopover.css';

export const formatCost = value => typeof value === 'number' && Number.isFinite(value)
    ? (value > 0 && value < .00001 ? '< $0.00001' : `$${value.toFixed(5)}`) : 'Unknown';
export const formatTokens = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : 'Unknown';
export function MessageUsage({t, inputTokens, outputTokens, totalTokens, inputCost, outputCost, totalCost, local, usageScope, usageRequests, knownCost, costStatus}) {
    return <div className="ai-usage-details">
        <div>{t('inputTokens')}: {formatTokens(inputTokens)}</div>
        <div>{t('outputTokens')}: {formatTokens(outputTokens)}</div>
        <div>{t('totalTokens')}: {formatTokens(totalTokens)}</div>
        <div>{t('inputCost')}: {formatCost(inputCost)}</div>
        <div>{t('outputCost')}: {formatCost(outputCost)}</div>
        <div>{t('totalCost')}: {formatCost(totalCost)}{Number.isFinite(totalCost) && !local ? ' (estimate)' : ''}</div>
        {costStatus === 'partial' && <div>Known subtotal: {formatCost(knownCost)} + unknown</div>}
        <small>{usageScope === 'turn' ? `This turn: ${usageRequests} request(s), including routing and follow-ups.` : 'This response only.'}</small>
        <small>{local ? 'Local inference; hardware costs excluded.' : 'Open Usage & cost for the request breakdown and pricing sources.'}</small>
    </div>;
}
const fields = [['input', 'Input'], ['output', 'Output'], ['cached', 'Cached input'], ['cacheWrite', 'Cache writes / Claude 5-minute writes'], ['cacheWriteHour', 'Claude 1-hour writes'], ['maxInputTokens', 'Maximum input tokens covered (optional)']];

export default function AiUsagePopover({surface, sessionId}) {
    const [open, setOpen] = useState(false);
    const [snapshot, setSnapshot] = useState(null);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (!open || !window.electron?.aiUsage) return;
        let live = true, sequence = 0;
        const refresh = async () => {
            const current = ++sequence;
            try { const next = await window.electron.aiUsage.get({surface, sessionId}); if (live && current === sequence) { setSnapshot(next); setError(''); } }
            catch { if (live) setError('Usage could not be loaded.'); }
        };
        setSnapshot(null);
        refresh();
        const unsubscribe = window.electron.aiUsage.subscribe(refresh);
        return () => { live = false; unsubscribe?.(); };
    }, [open, surface, sessionId]);
    const edit = async group => {
        try {
            const rates = await window.electron.aiUsage.rates();
            const rate = rates.overrides[rateKey(group.provider, group.model)] || rates.catalog[group.provider]?.[group.model] || {};
            setForm(Object.fromEntries(fields.map(([key]) => [key, rate[key] ?? ''])));
            setEditing(group); setError('');
        } catch { setError('Pricing could not be loaded.'); }
    };
    const save = async reset => {
        setSaving(true);
        try {
            const rate = reset ? null : Object.fromEntries(fields.filter(([key]) => form[key] !== '').map(([key]) => [key, Number(form[key])]));
            await window.electron.aiUsage.saveRate({provider: editing.provider, model: editing.model, rate});
            setEditing(null); setError('');
        } catch (e) { setError(e.message || 'Pricing could not be saved.'); }
        finally { setSaving(false); }
    };
    const groups = snapshot?.groups || [];
    const known = groups.reduce((sum, group) => sum + group.knownCost, 0);
    const priced = groups.reduce((sum, group) => sum + group.priced, 0);
    const unknown = groups.reduce((sum, group) => sum + group.unknown + group.external + group.pending, 0);
    return <Popover isOpen={open} onInteraction={setOpen} popoverClassName="ai-usage-overlay" placement="bottom-end" content={
        <section className="ai-usage-popover" aria-label="AI usage and cost">
            <h4>Usage &amp; cost</h4>
            <p>{surface === 'chat' && sessionId ? 'This chat' : surface === 'coding' ? 'Coding activity on this device' : 'Chat activity on this device'}</p>
            {error && <Callout intent="warning">{error}</Callout>}
            {snapshot?.persistenceError && <Callout intent="warning">Usage is available in memory but could not be saved to disk.</Callout>}
            {!snapshot && !error && <Spinner size={20} />}
            {snapshot && <>
                <strong>{snapshot.requests ? `${unknown ? 'Known subtotal' : 'Estimated total'}: ${formatCost(priced ? known : undefined)}` : 'No requests recorded yet'}</strong>
                {unknown > 0 && <p>{unknown} request(s) pending or without a cost estimate. The subtotal is incomplete.</p>}
                <p className="ai-usage-note">USD token estimates before credits, free allowances, taxes and account discounts. Local hardware, CLI subscriptions and separately billed tools are excluded.</p>
                <table><thead><tr><th>Provider / model</th><th>Requests</th><th>Known estimate</th></tr></thead>
                    <tbody>{groups.map(group => <tr key={rateKey(group.provider, group.model)}>
                        <td>{group.provider}<br/><small>{group.model}</small>
                            {!['ollama', 'codex-cli', 'gemini-cli'].includes(group.provider) && <Button small minimal text="Edit rates" onClick={() => edit(group)} />}</td>
                        <td>{group.requests}</td><td>{formatCost(group.priced ? group.knownCost : undefined)}{group.priced > 0 && group.unknown + group.external + group.pending > 0 ? ' + unknown' : ''}</td>
                    </tr>)}</tbody>
                </table>
                {editing && <form onSubmit={event => { event.preventDefault(); save(false); }}>
                    <h5>{editing.provider} · {editing.model}</h5>
                    <p>Custom standard rates in USD per million tokens. Applied only to future requests. Blank cache rates remain unknown when used.</p>
                    <div className="ai-usage-rate-fields">{fields.map(([key, label]) => <FormGroup key={key} label={label} labelFor={`ai-rate-${key}`}>
                        <InputGroup id={`ai-rate-${key}`} type="number" min="0" step="any" required={['input', 'output'].includes(key)} value={String(form[key])}
                            onChange={event => setForm({...form, [key]: event.target.value})} />
                    </FormGroup>)}</div>
                    <Button type="submit" intent="primary" loading={saving}>Save rates</Button>{' '}
                    <Button disabled={saving} onClick={() => save(true)}>Use catalog</Button>{' '}
                    <Button disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                </form>}
                <details><summary>Recent requests</summary>
                    {snapshot.entries.map(entry => <article key={entry.id} className="ai-usage-request">
                        <strong>{entry.provider} · {entry.model}</strong><div>{new Date(entry.startedAt).toLocaleString()} · {entry.status}</div>
                        <div>Input {formatTokens(entry.usage.input_tokens)} · Output {formatTokens(entry.usage.output_tokens)}</div>
                        {entry.usage.cached_input_tokens != null && <div>Cached input: {formatTokens(entry.usage.cached_input_tokens)}</div>}
                        {entry.usage.cache_write_tokens != null && <div>Cache writes: {formatTokens(entry.usage.cache_write_tokens)}</div>}
                        {entry.usage.cache_write_1h_tokens != null && <div>Of which 1-hour writes: {formatTokens(entry.usage.cache_write_1h_tokens)}</div>}
                        {entry.usage.reasoning_tokens != null && <div>Reasoning: {formatTokens(entry.usage.reasoning_tokens)}</div>}
                        <div>{entry.cost.status === 'external' ? 'External billing' : entry.cost.status === 'local' ? 'Local inference: $0 API cost' : formatCost(entry.cost.totalCost)}</div>
                        {entry.cost.reason && <small>{entry.cost.reason}</small>}
                        {entry.cost.pricing && <small>Rates verified {entry.cost.pricing.verifiedAt} · {entry.cost.pricing.source.startsWith('https://')
                            ? <a href={entry.cost.pricing.source} target="_blank" rel="noreferrer">Pricing source</a> : entry.cost.pricing.source}</small>}
                    </article>)}
                </details>
                <small>Retains the latest {snapshot.retainedLimit.toLocaleString()} requests on this device; shows up to 100 details. This is not a provider invoice.</small>
            </>}
        </section>
    }><Button small minimal icon="chart" aria-label="Usage and cost">Usage &amp; cost</Button></Popover>;
}
