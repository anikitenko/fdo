import React, {useState} from 'react';
import {Button, FormGroup, HTMLSelect, TextArea} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';

export function LocalActionEditor({element,disabled,onPropose}) {
    const creation = element.localActionCreation;
    const [targetId,setTargetId] = useState('');
    const [text,setText] = useState('Action completed');
    if (!creation) return null;
    const target = creation.targets.find(item=>item.id === targetId);
    const valid = !!target && text.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
    return <EditorSection defaultOpen title="Create local action" icon="code" description="New frontend handler · Set result text">
        <p>Creates a new frontend handler and connects this button. It writes plain text to the selected result element. Backend requests are not part of this preset.</p>
        {creation.targets.length ? <>
            <FormGroup label="Result element" labelFor="local-action-target"><HTMLSelect id="local-action-target" fill value={targetId} disabled={disabled} onChange={event=>setTargetId(event.target.value)}
                options={[{value:'',label:'Choose a text/result element…'},...creation.targets.map(item=>({value:item.id,label:item.label+' · '+item.file+':'+item.line}))]}/></FormGroup>
            <FormGroup label="Result text" labelFor="local-action-text" helperText="Up to 2,000 characters. Empty text clears the result; HTML is displayed as text."><TextArea id="local-action-text" fill growVertically value={text} maxLength={2000} disabled={disabled} onChange={event=>setText(event.target.value)}/></FormGroup>
            <Button fill icon="add" disabled={disabled || !valid} onClick={()=>onPropose({kind:'create-local-action',targetId,text})}>Preview new action</Button>
        </> : <p>Add a Text or Result panel first. Supported targets are unique SDK text leaves with no custom identities or bindings.</p>}
        <p className="bp6-text-muted">Adds the handler, binding and result marker to the draft together. Preview clicks still select elements; use Run local action to simulate this preset, or test the deployed action after Apply. Disconnect keeps the handler available for reconnecting.</p>
    </EditorSection>;
}
