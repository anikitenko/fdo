import {SdkToastProgressEditor} from './SdkToastProgressEditor';
import {sdkPropertyValueValid} from '../../utils/plugins/authoring/liveUi/sdkComponentEdits';
import {SdkCollectionEditor} from './SdkCollectionEditor';
import {SdkSlotEditor} from './SdkSlotEditor';
import {SdkComponentMotion} from './SdkComponentMotion';
import React, {useEffect, useState} from 'react';
import {Button, FormGroup, HTMLSelect, InputGroup} from '@blueprintjs/core';
import {SdkComponentAppearance} from './SdkComponentAppearance';
import {EditorSection} from './EditorSection';

export function SdkComponentEditor({element, disabled, onPropose, onInspect, onPreviewState, onPreviewItem, rememberedItemKey, onItemSelect}) {
    const component = element.sdkComponent;
    const [name, setName] = useState(component.properties[0]?.name || '');
    const field = component.properties.find(item => item.name === name);
    const [value, setValue] = useState(String(field?.value ?? ''));
    useEffect(() => setValue(String(field?.value ?? '')), [field]);
    useEffect(() => {if (!component.properties.some(item => item.name === name)) setName(component.properties[0]?.name || '');},[component,name]);
    const typedValue = field?.kind === 'boolean' ? value === 'true' : ['number','number-or-null'].includes(field?.kind) ? value.trim() ? Number(value) : field.kind === 'number-or-null' ? null : NaN : value;
    const [previewState,setPreviewState] = useState('authored');
    useEffect(()=>setPreviewState('authored'),[component]);
    const blocked = disabled || !!component.reason || !element.structure?.unique;
    const changed = field?.editable && typedValue !== field.value && sdkPropertyValueValid(field, typedValue);
    return <>{!!component.previewStates?.length && onPreviewState && <EditorSection defaultOpen title="Component state preview" icon="eye-open" description="Visual simulation only">
        <FormGroup label="Preview state" labelFor="sdk-preview-state" helperText="Does not change source or execute plugin callbacks. Source edits reset the preview."><HTMLSelect id="sdk-preview-state" fill value={previewState} disabled={disabled} options={[{value:'authored',label:'As authored'},...component.previewStates]} onChange={event=>{setPreviewState(event.target.value);onPreviewState(event.target.value);}}/></FormGroup>
    </EditorSection>}<SdkSlotEditor element={element} disabled={disabled} onPropose={onPropose} onInspect={onInspect}/><EditorSection defaultOpen title={component.name + ' properties'} icon="properties" description="Edit the SDK composition call">
        <p className="bp6-text-muted">{component.reason || 'IDs, ARIA references and controller bindings stay in code. Properties update the SDK composition call.'}</p>

        {field && <>
            <FormGroup label="Component property" labelFor="sdk-property"><HTMLSelect id="sdk-property" fill value={name} disabled={blocked} options={component.properties.map(item => ({value: item.name, label: item.name + (item.editable ? '' : ' · Read-only')}))} onChange={event => setName(event.target.value)}/></FormGroup>
            <FormGroup label="Property value" labelFor="sdk-property-value" helperText={field.reason || (field.kind === 'number-or-null' ? 'Leave empty for indeterminate progress.' : 'Uses the SDK’s declared property type.')}>
                {field.kind === 'boolean' || field.kind === 'enum' ? <HTMLSelect id="sdk-property-value" fill value={value} disabled={blocked || !field.editable} options={field.kind === 'boolean' ? ['false','true'] : [{value:'',label:'SDK default'},...field.choices]} onChange={event=>setValue(event.target.value)}/> :
                    <InputGroup id="sdk-property-value" value={value} type={['number','number-or-null'].includes(field.kind) ? 'number' : 'text'} maxLength={2000} disabled={blocked || !field.editable} onValueChange={setValue} onKeyDown={event => {if (event.key === 'Enter' && !event.nativeEvent.isComposing && !blocked && changed) {event.preventDefault(); onPropose({kind:'component-property',property:name,value:typedValue});}}}/>}
            </FormGroup>
            <Button fill icon="eye-open" disabled={blocked || !changed} onClick={() => onPropose({kind: 'component-property', property: name, value:typedValue})}>Preview component property</Button>
        </>}
    </EditorSection>
        <SdkCollectionEditor rememberedItemKey={rememberedItemKey} onItemSelect={onItemSelect} onInspect={onInspect} onPreviewItem={onPreviewItem} element={element} disabled={disabled} onPropose={onPropose}/>
        <SdkToastProgressEditor element={element} disabled={disabled} onPropose={onPropose}/>
        <SdkComponentAppearance element={element} disabled={disabled} onPropose={onPropose}/>
        <SdkComponentMotion element={element} disabled={disabled} onPropose={onPropose}/>
    </>;
}
