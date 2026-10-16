import React, {useEffect, useState} from 'react';
import {Button, FormGroup, HTMLSelect, InputGroup} from '@blueprintjs/core';
import {formatCssLength, lengthPropertyOptions, parseCssLength} from '../../utils/plugins/authoring/liveUi/cssLengths';
import {parseCssSpacing} from '../../utils/plugins/authoring/liveUi/cssSpacing';
import * as styles from './WorkspacePreview.module.css';

export function CssLengthEditor({property, value, disabled, onChange, onPreview}) {
    const options = lengthPropertyOptions(property);
    const parsed = parseCssLength(property, value);
    const [amount, setAmount] = useState(parsed ? String(parsed.amount) : '');
    useEffect(() => setAmount(parsed ? String(parsed.amount) : ''), [property, value]);
    if (!options) return null;
    // Multi-side spacing has its own editor; do not offer a destructive reset
    // above fields which can preserve all four sides directly.
    if (!parsed && parseCssSpacing(property, value)) return null;
    const invalid = parsed && formatCssLength(property, amount, parsed.unit) === null;
    const supportedUnits = options.units.filter(unit => typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports(property, '1' + unit));
    const change = (amount, unit) => {
        const next = formatCssLength(property, amount, unit);
        if (next !== null) onChange(next);
    };
    return <div className={styles.lengthEditor} aria-label="CSS length editor">
        {parsed ? <>
            <FormGroup label="Length" labelFor="visual-css-length">
                <InputGroup id="visual-css-length" type="number" step="any" min={options.negative ? undefined : 0}
                    value={amount} disabled={disabled} aria-describedby="visual-css-length-help" aria-invalid={!!invalid}
                    onKeyDown={event => {if (event.key === 'Enter' && !invalid && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {event.preventDefault(); onPreview?.();}}}
                    onChange={event => {setAmount(event.target.value); change(event.target.value, parsed.unit);}}/>
            </FormGroup>
            <FormGroup label="Unit" labelFor="visual-css-length-unit">
                <HTMLSelect id="visual-css-length-unit" value={parsed.unit} disabled={disabled || !!invalid}
                    aria-describedby="visual-css-length-help" options={[...new Set([...supportedUnits, parsed.unit])]}
                    onChange={event => change(amount, event.target.value)}/>
            </FormGroup>
        </> : <Button size="small" disabled={disabled} onClick={() => onChange('0px')}>Use a single length</Button>}
        {invalid && <small role="alert">{options.negative ? 'Enter a finite number.' : 'Enter a number of zero or more.'} The CSS text keeps the last valid value.</small>}
        <small id="visual-css-length-help">{parsed
            ? 'Change the number or unit, then Preview change. Switching units keeps the number; it does not convert the size.'
            : 'Your text value is preserved. Use a single length replaces the entire value with 0px. Expressions, keywords and multi-value spacing remain editable as text.'}</small>
    </div>;
}
