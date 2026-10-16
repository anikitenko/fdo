import React, {useMemo} from 'react';
import {Button, FormGroup} from '@blueprintjs/core';
import {formatPickerColor, isColorProperty, parseCssColor} from '../../utils/plugins/authoring/liveUi/cssColors';
import * as styles from './WorkspacePreview.module.css';

export function CssColorPicker({property, value, disabled, onChange}) {
    const parsed = useMemo(() => parseCssColor(value, document), [value]);
    if (!isColorProperty(property)) return null;
    const color = parsed || {hex: '#000000', alpha: 1};
    const percentage = Math.round(color.alpha * 100);
    return <div className={styles.colorPicker} aria-label="CSS color picker">
        <FormGroup label="Color" labelFor="visual-css-color">
            <input id="visual-css-color" type="color" value={color.hex} disabled={disabled} aria-describedby="visual-css-color-help"
                onChange={event => onChange(formatPickerColor(event.target.value, color.alpha))}/>
        </FormGroup>
        <FormGroup label={'Color opacity · ' + percentage + '%'} labelFor="visual-css-alpha">
            <input id="visual-css-alpha" type="range" min="0" max="100" step="1" value={percentage} disabled={disabled}
                aria-label="Color opacity" aria-valuetext={percentage + '%'} aria-describedby="visual-css-color-help"
                onChange={event => onChange(formatPickerColor(color.hex, Number(event.target.value) / 100))}/>
        </FormGroup>
        {!parsed && <Button size="small" disabled={disabled} onClick={() => onChange(formatPickerColor(color.hex, color.alpha))}>Use solid black</Button>}
        <small id="visual-css-color-help">{parsed ? 'Choose a color or opacity, then Preview change. Text entry keeps its original format until you use the picker.' : 'Your text value is preserved. Choosing a color or opacity replaces it with a solid color. Variables and advanced colors remain editable as text.'}</small>
    </div>;
}
