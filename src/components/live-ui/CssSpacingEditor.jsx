import React, {useEffect, useState} from 'react';
import {FormGroup, InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {formatCssSpacing, isCssSpacingSide, isSpacingShorthand, parseCssSpacing, SPACING_SIDES} from '../../utils/plugins/authoring/liveUi/cssSpacing';
import * as styles from './WorkspacePreview.module.css';

export function CssSpacingEditor({property, value, disabled, onChange, onPreview}) {
    const parsed = parseCssSpacing(property, value);
    const [sides, setSides] = useState(parsed || []);
    useEffect(() => setSides(parsed || []), [property, value]);
    if (!isSpacingShorthand(property)) return null;
    const invalid = formatCssSpacing(property, sides) === null;
    const update = (index, next) => {
        const candidate = sides.map((side, at) => at === index ? next : side);
        setSides(candidate);
        const formatted = formatCssSpacing(property, candidate);
        if (formatted !== null) onChange(formatted);
    };
    return <EditorSection title="Spacing sides" icon="layout" description="Adjust one side while keeping the others">
        {parsed ? <>
            <div className={styles.spacingEditor}>
                {SPACING_SIDES.map((side, index) => <FormGroup key={side} label={side} labelFor={'visual-spacing-' + side.toLowerCase()}>
                    <InputGroup id={'visual-spacing-' + side.toLowerCase()} value={sides[index] || ''} disabled={disabled}
                        aria-invalid={!isCssSpacingSide(property, sides[index])}
                        aria-describedby="visual-spacing-help" onValueChange={next => update(index, next)}
                        onKeyDown={event => {if (event.key === 'Enter' && !invalid && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {event.preventDefault(); onPreview?.();}}}/>
                </FormGroup>)}
            </div>
            {invalid && <small role="alert">Use one length per side, such as 12px or 1rem{property === 'margin' ? ', or auto' : ', without negative values'}. The CSS text keeps the last valid value.</small>}
        </> : <p>This value uses an expression, keyword or unsupported spacing syntax. Continue in the CSS value field; no sides have been replaced.</p>}
        <small id="visual-spacing-help">Values apply to physical sides. Preview change or Enter previews all four sides as one edit. Other longhand, state and responsive rules may still override this shorthand.</small>
    </EditorSection>;
}
