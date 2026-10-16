import {resultDisplays} from '../../utils/plugins/authoring/liveUi/responseMappings';
import React, {useState} from 'react';
import {Button, FormGroup, HTMLSelect, TextArea} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';

export function SdkAsyncActionEditor({element,disabled,onPropose}) {
    const action=element.asyncAction;
    const [targetId,setTargetId]=useState(''),[text,setText]=useState('Action completed');
    const [preset,setPreset]=useState('local'),[display,setDisplay]=useState('json'),[source,setSource]=useState('fixed'),[inputId,setInputId]=useState('');
    if(!action) return null;
    const valid=action.targets?.some(target=>target.id===targetId) && (preset!=='local' && source==='input' ? action.inputs?.some(input=>input.id===inputId) : text.length<=2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text));
    return <EditorSection defaultOpen title="Async button action" icon="link" description="Local text or typed backend request">
        {!action.editable ? <p>{action.reason}</p> : action.status==='connected' ? <>
            <p>Connected: {action.row?.backend ? action.row.preset==='inspect-json' ? 'Inspect JSON locally' : 'Send text to backend' : 'Set result text'}. The SDK manages pending, success, duplicate clicks and cancellation. Apply to test the live action.</p>
            <Button fill variant="minimal" icon="unlink" disabled={disabled} onClick={()=>onPropose({kind:'disconnect-sdk-async-action'})}>Disconnect async action</Button>
            <p className="bp6-text-muted">Disconnect removes this generated controller setup and disables the button. Unchanged private backend code is removed too. The result element and its current content are preserved.</p>
        </> : <>
            <p>Choose a local action or a typed plugin backend request. This enables the SDK button and adds controller setup with cleanup. The backend presets run inside the plugin and use no external service.</p>
            <FormGroup label="Async action preset" labelFor="async-action-preset"><HTMLSelect id="async-action-preset" fill value={preset} disabled={disabled} options={[{value:'local',label:'Set result text · frontend'},...(action.backend ? [{value:'text',label:'Send text to backend'},{value:'inspect-json',label:'Inspect JSON locally'}] : [])]} onChange={event=>{setPreset(event.target.value);setDisplay('json');if(event.target.value==='inspect-json') setText('{"hello":"world"}');}}/></FormGroup>
            {!action.backend && <p className="bp6-text-muted">Backend presets need a synchronous, zero-input init method and a direct TypeScript action contract.</p>}
            {action.targets.length ? <>
                <FormGroup label="Async result element" labelFor="async-result-target"><HTMLSelect id="async-result-target" fill value={targetId} disabled={disabled} onChange={event=>setTargetId(event.target.value)} options={[{value:'',label:'Choose a text/result element…'},...action.targets.map(target=>({value:target.id,label:target.label}))]}/></FormGroup>
                {preset!=='local' && <FormGroup label="Async request source" labelFor="async-request-source"><HTMLSelect id="async-request-source" fill value={source} disabled={disabled} options={[{value:'fixed',label:'Fixed text'},{value:'input',label:'UI text input'}]} onChange={event=>setSource(event.target.value)}/></FormGroup>}
                {preset!=='local' && source==='input' ? <FormGroup label="Async request input" labelFor="async-request-input"><HTMLSelect id="async-request-input" fill value={inputId} disabled={disabled} options={[{value:'',label:'Choose a text input…'},...(action.inputs || []).map(input=>({value:input.id,label:input.label}))]} onChange={event=>setInputId(event.target.value)}/></FormGroup> : <FormGroup label={preset==='local' ? 'Async result text' : 'Async request text'} labelFor="async-result-text" helperText="Up to 2,000 characters. HTML is displayed as plain text."><TextArea id="async-result-text" fill growVertically value={text} maxLength={2000} disabled={disabled} onChange={event=>setText(event.target.value)}/></FormGroup>}
                {preset!=='local' && <FormGroup label="Async result display" labelFor="async-result-display"><HTMLSelect id="async-result-display" fill value={display} disabled={disabled} options={resultDisplays(preset)} onChange={event=>setDisplay(event.target.value)}/></FormGroup>}
                <Button fill icon="add" disabled={disabled || !valid} onClick={()=>onPropose({kind:'create-sdk-async-action',targetId,...(preset!=='local' ? {preset,display} : {}),...(preset!=='local' && source==='input' ? {inputId} : {text})})}>Preview async action</Button>
            </> : <p>Add a supported Text or Result element first.</p>}
        </>}
        <p className="bp6-text-muted">Changes share draft Undo/Redo and Apply. Component state previews do not execute frontend callbacks. Cancellation stops UI updates from a pending reply; it does not recall a backend request already sent. Custom setup stays in the IDE.</p>
    </EditorSection>;
}
