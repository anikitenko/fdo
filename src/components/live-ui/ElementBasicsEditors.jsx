import React,{useEffect,useState} from 'react';
import {Button,FormGroup,HTMLSelect,InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {classNamesError} from '../../utils/plugins/authoring/liveUi/styleAssignments';
import {INPUT_KINDS} from '../../utils/plugins/authoring/liveUi/inputKinds';
export function ClassNamesEditor({element,disabled,onPropose}) {
    const target=element.classNameAssignment;
    const [value,setValue]=useState(target?.value || '');
    useEffect(()=>setValue(target?.value || ''),[target]);
    if(!target) return null;
    const error=classNamesError(value),changed=value.trim() !== target.value;
    const submit=()=>onPropose({kind:'class-names',value});
    return <EditorSection title="Class names" icon="tag" description="PureCSS and other existing classes">
        <FormGroup label="Class names" labelFor="element-class-names" helperText="Space-separated names, without dots. Existing SDK style expressions are preserved.">
            <InputGroup id="element-class-names" value={value} maxLength={500} disabled={disabled} onValueChange={setValue} onKeyDown={event=>{if(event.key==='Enter' && !event.nativeEvent.isComposing && !disabled && changed && !error) submit();}}/>
            {error && <p role="alert">{error}</p>}
        </FormGroup>
        <Button icon="eye-open" disabled={disabled || !changed || !!error} onClick={submit}>Preview class names</Button>
        <p className="bp6-text-muted">Empty text removes these extra names. Classes take effect where their stylesheet is loaded; this does not create CSS declarations.</p>
    </EditorSection>;
}
export function InputKindEditor({element,disabled,onPropose}) {
    const target=element.inputKind;
    if(!target) return ['input','textarea'].includes(element.tag) ? <EditorSection title="Input control" icon="form" description="Type changes require the IDE"><p>This control has shared/computed source or custom wiring. Change its type in the IDE to preserve its content and bindings.</p></EditorSection> : null;
    const options=INPUT_KINDS.filter(kind=>target.bound ? target.current==='textarea' ? kind==='textarea' : ['text','search'].includes(kind) : target.canConvert || (kind==='textarea') === (target.current==='textarea'));
    return <EditorSection defaultOpen title="Input control" icon="form" description="Control kind and input type">
        <FormGroup label="Input type" labelFor="element-input-kind"><HTMLSelect id="element-input-kind" fill value={target.current} disabled={disabled} options={options.map(value=>({value,label:value==='textarea' ? 'Textarea (multiline)' : 'Input · '+value}))} onChange={event=>onPropose({kind:'input-kind',value:event.target.value})}/></FormGroup>
        <p className="bp6-text-muted">Empty, unbound controls can switch between textarea and input. Bound text inputs retain text/search types; preserve other bindings and non-empty content in the IDE.</p>
    </EditorSection>;
}
