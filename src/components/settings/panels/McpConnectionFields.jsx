import React, {useState} from 'react';
import {Button, FormGroup, InputGroup} from '@blueprintjs/core';
import * as styles from './AIExtensionsPanel.module.css';

export function ArgumentFields({rows, onChange, disabled}) {
    const update = (index, value) => onChange(rows.map((row, i) => i === index ? {...row, value} : row));
    const move = (index, offset) => {
        const reordered = [...rows];
        [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
        onChange(reordered);
    };
    return <FormGroup label="Command arguments" helperText="One argument per row, in order. Paths with spaces stay together; do not add quotes or escape characters. An empty row passes an empty argument.">
        {!rows.length && <p className={styles.note}>No arguments. Add only the arguments your server needs.</p>}
        {rows.map((row, index) => <div className={styles.argumentRow} key={row.id}>
            <span className={styles.rowNumber} aria-hidden="true">{index + 1}</span>
            <InputGroup fill aria-label={`Argument ${index + 1}`} value={row.value} disabled={disabled} onChange={event => update(index, event.target.value)} placeholder={index === 0 ? '-y or /path/to/server.js' : 'Another argument'}/>
            <div className={styles.rowActions}>
                <Button minimal icon="arrow-up" aria-label={`Move argument ${index + 1} up`} title="Move up" disabled={disabled || index === 0} onClick={() => move(index, -1)}/>
                <Button minimal icon="arrow-down" aria-label={`Move argument ${index + 1} down`} title="Move down" disabled={disabled || index === rows.length - 1} onClick={() => move(index, 1)}/>
                <Button minimal icon="cross" aria-label={`Remove argument ${index + 1}`} title="Remove argument" disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}/>
            </div>
        </div>)}
        <Button minimal icon="plus" text="Add argument" disabled={disabled || rows.length >= 64} onClick={() => onChange([...rows, {id: Math.max(0, ...rows.map(row => row.id)) + 1, value: ''}])}/>
    </FormGroup>;
}

export function PairFields({kind, rows, onChange, disabled}) {
    const [visible, setVisible] = useState(false);
    const header = kind === 'header';
    const noun = header ? 'Header' : 'Environment variable';
    const update = (index, field, value) => onChange(rows.map((row, i) => i === index ? {...row, [field]: value} : row));
    return <FormGroup label={header ? 'Custom headers' : 'Environment variables'} helperText={header ? 'Enter each header name and value separately. Saved values stay hidden.' : 'Only configured values and basic OS variables are forwarded. Saved values stay hidden.'}>
        {!rows.length && <p className={styles.note}>{header ? 'No custom headers.' : 'No additional environment variables.'}</p>}
        {rows.map((row, index) => <div className={styles.pairRow} key={row.id}>
            <InputGroup fill aria-label={`${noun} name ${index + 1}`} value={row.name} disabled={disabled} onChange={event => update(index, 'name', event.target.value)} placeholder={header ? 'X-Team' : 'SERVICE_TOKEN'}/>
            <InputGroup fill aria-label={`${noun} value ${index + 1}`} type={visible ? 'text' : 'password'} autoComplete="off" value={row.value} disabled={disabled} onChange={event => update(index, 'value', event.target.value)} placeholder="Value"/>
            <Button minimal icon="cross" aria-label={`Remove ${noun.toLowerCase()} ${index + 1}`} title="Remove row" disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}/>
        </div>)}
        <div className={styles.rowActions}>
            <Button minimal icon="plus" text={header ? 'Add header' : 'Add environment variable'} disabled={disabled || rows.length >= 32} onClick={() => onChange([...rows, {id: Math.max(0, ...rows.map(row => row.id)) + 1, name: '', value: ''}])}/>
            {!!rows.length && <Button minimal icon={visible ? 'eye-off' : 'eye-open'} text={`${visible ? 'Hide' : 'Show'} values`} aria-label={`${visible ? 'Hide' : 'Show'} ${header ? 'header' : 'environment variable'} values`} disabled={disabled} onClick={() => setVisible(value => !value)}/>}
        </div>
    </FormGroup>;
}

export function connectionPairs(rows, label) {
    const entries = rows.filter(row => row.name.trim() || row.value);
    const names = new Set();
    for (const row of entries) {
        const name = row.name.trim();
        if (!name) throw new Error(`${label}: enter a name for each value or remove the empty row.`);
        if (names.has(name.toLowerCase())) throw new Error(`${label}: "${name}" is repeated. Use each name once.`);
        names.add(name.toLowerCase());
    }
    return Object.fromEntries(entries.map(row => [row.name.trim(), row.value]));
}
