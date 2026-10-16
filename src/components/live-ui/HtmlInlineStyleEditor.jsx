import React, {useEffect, useRef, useState} from 'react';
import {Button, FormGroup, InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {CssPropertyPicker} from './CssPropertyPicker';
import {CssColorPicker} from './CssColorPicker';
import {CssLengthEditor} from './CssLengthEditor';
import {inlineStyleValueError} from '../../utils/plugins/authoring/liveUi/htmlLiteralStyles';

export function HtmlInlineStyleEditor({element,properties,disabled,onPropose}) {
    const style = element.inlineStyle;
    const [property,setProperty] = useState(''), [value,setValue] = useState('');
    const input = useRef(null), focusValue = useRef(false), picker = useRef(null);
    const [pickerVersion,setPickerVersion] = useState(0);
    useEffect(()=>{if(pickerVersion) picker.current?.querySelector('input')?.focus();},[pickerVersion]);
    const existing = style?.declarations?.find(item=>item.property === property);
    useEffect(()=>{setValue(existing?.value || ''); if(focusValue.current){focusValue.current = false; input.current?.focus();}},[style,property]);
    if (!style) return null;
    const blocked = disabled || !style.editable;
    const error = value ? inlineStyleValueError(property,value) || (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports(property,value) ? 'Enter a valid CSS value for ' + property + '.' : '') : '';
    const changed = !blocked && !!property && !!value.trim() && !error && value.trim() !== existing?.value;
    const submit = action => onPropose({kind:'html-inline-style',action,property,value});
    const preview = () => {if(changed) submit('set');};
    const choose = (name,next) => {focusValue.current = name !== property;setProperty(name);setValue(next);if(name === property) input.current?.focus();};
    const add = () => {focusValue.current = false;setProperty('');setValue('');setPickerVersion(version=>version + 1);};
    return <EditorSection defaultOpen title="Element style overrides" icon="style" description="Inline styling for this HTML element">
        <p className="bp6-text-muted">{style.reason || 'Edits stay in this element’s style attribute. Shared classes stay unchanged. Reset removes the selected override so stylesheet rules can apply again.'}</p>
        {style.editable && <>
            <strong>{style.declarations.length} local {style.declarations.length === 1 ? 'override' : 'overrides'}</strong>
            {style.declarations.length ? <ul aria-label="Current style overrides" style={{listStyle:'none',padding:0}}>
                {style.declarations.map(item=><li key={item.property} style={{display:'flex',alignItems:'flex-start',gap:4,marginBottom:4,minWidth:0}}>
                    <Button fill variant="minimal" alignText="left" active={property === item.property} disabled={blocked} aria-label={'Edit ' + item.property + ' override'} onClick={()=>choose(item.property,item.value)}>
                        <span style={{whiteSpace:'normal',overflowWrap:'anywhere'}}><code>{item.property}</code>: {item.value}{item.important ? ' !important' : ''}</span>
                    </Button>
                    <Button variant="minimal" icon="cross" disabled={blocked} aria-label={'Remove ' + item.property + ' override'} title="Remove this local override; stylesheet rules can apply again" onClick={()=>onPropose({kind:'html-inline-style',action:'remove',property:item.property})}/>
                </li>)}
            </ul> : <p className="bp6-text-muted">No local overrides yet. Search for a property below to add one.</p>}
            <Button fill icon="add" disabled={blocked} onClick={add}>Add another override</Button>
            <div ref={picker}><FormGroup label="Inline CSS property" labelFor="visual-property"><CssPropertyPicker key={pickerVersion} properties={properties} style={style} value={property} disabled={blocked} onSelect={choose}/></FormGroup></div>
            <FormGroup label="Inline CSS value" labelFor="html-inline-value" intent={error ? 'danger' : 'none'} helperText={existing?.important ? 'This declaration’s existing !important priority is preserved.' : 'Base declarations only; hover and responsive rules stay in the stylesheet.'}>
                <InputGroup id="html-inline-value" inputRef={input} value={value} maxLength={500} disabled={blocked || !property} aria-invalid={!!error} onValueChange={setValue}
                    onKeyDown={event=>{if(event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey){event.preventDefault();preview();}}}/>
                {error && <small role="alert">{error}</small>}
            </FormGroup>
            <CssColorPicker property={property} value={value} disabled={blocked} onChange={setValue}/>
            <CssLengthEditor property={property} value={value} disabled={blocked} onChange={setValue} onPreview={preview}/>
            <Button fill icon="eye-open" disabled={!changed} onClick={preview}>Preview style override</Button>
            <Button fill variant="minimal" icon="reset" disabled={blocked || !existing} onClick={()=>submit('remove')}>Reset style override</Button>
            <p className="bp6-text-muted">Changes share draft Undo/Redo and Apply. Existing stylesheet !important rules can take precedence over normal inline declarations.</p>
        </>}
    </EditorSection>;
}
