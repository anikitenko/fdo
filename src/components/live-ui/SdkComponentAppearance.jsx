import React, {useEffect, useState} from 'react';
import {Button, FormGroup, HTMLSelect, InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {CssColorPicker} from './CssColorPicker';
import {CssLengthEditor} from './CssLengthEditor';
import {CssSpacingEditor} from './CssSpacingEditor';
import {sdkAppearanceValueError} from '../../utils/plugins/authoring/liveUi/sdkComponentAppearance';

export function SdkComponentAppearance({element, disabled, onPropose}) {
    const fields = element.sdkComponent.appearance || [];
    const [name, setName] = useState(fields[0]?.name || '');
    const field = fields.find(item => item.name === name) || fields[0];
    const [value, setValue] = useState(field?.value || '');
    useEffect(() => setValue(field?.value || ''), [field]);
    if (!field) return null;
    const blocked = disabled || !element.structure?.unique || !!element.sdkComponent.reason || !field.editable;
    const error = value ? sdkAppearanceValueError(value) || (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports(field.cssProperty, field.name === '--fdo-ui-width' ? 'min(' + value + ', calc(100vw - 2rem))' : value) ? 'Enter a valid ' + field.label.toLowerCase() + ' value.' : '') : '';
    const changed = !blocked && value.trim() && !error && value.trim() !== field.value;
    const propose = action => onPropose({kind:'component-appearance',property:field.name,action,value});
    const onPreview = () => {if (changed) propose('set');};
    return <EditorSection defaultOpen title="Component appearance" icon="style" description="Style this SDK component">
        <FormGroup label="Appearance property" labelFor="sdk-appearance-property"><HTMLSelect id="sdk-appearance-property" fill value={field.name} disabled={disabled} options={fields.map(item=>({value:item.name,label:item.label + (item.editable ? '' : ' · Read-only')}))} onChange={event=>setName(event.target.value)}/></FormGroup>
        <FormGroup label="Appearance value" labelFor="sdk-appearance-value" intent={error ? 'danger' : 'none'} helperText={field.reason || (field.overridden ? 'Local override: ' : 'Using SDK defaults or inherited theme values: ') + field.name}>
            <InputGroup id="sdk-appearance-value" value={value} maxLength={300} disabled={blocked} aria-invalid={!!error} aria-describedby={error ? 'sdk-appearance-error' : undefined} onValueChange={setValue} onKeyDown={event=>{if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {event.preventDefault();onPreview();}}}/>
            {error && <span id="sdk-appearance-error" role="alert">{error}</span>}
        </FormGroup>
        {field.kind === 'color' && <CssColorPicker property={field.cssProperty} value={value} disabled={blocked} onChange={setValue}/>}
        {['length','spacing'].includes(field.kind) && <CssLengthEditor property={field.cssProperty} value={value} disabled={blocked} onChange={setValue} onPreview={onPreview}/>}
        {field.kind === 'spacing' && <CssSpacingEditor property={field.cssProperty} value={value} disabled={blocked} onChange={setValue} onPreview={onPreview}/>}
        <Button fill icon="eye-open" disabled={!changed} onClick={onPreview}>Preview appearance</Button>
        <Button fill variant="minimal" icon="reset" disabled={blocked || !field.overridden} onClick={()=>propose('reset')}>Reset appearance override</Button>
        <p className="bp6-text-muted">Changes stay local to this component call and share Undo/Redo and Apply. Reset lets SDK defaults or inherited theme values apply. Computed and shared style maps remain read-only.</p>
    </EditorSection>;
}
