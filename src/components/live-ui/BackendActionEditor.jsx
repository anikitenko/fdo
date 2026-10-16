import {resultDisplays} from '../../utils/plugins/authoring/liveUi/responseMappings';
import React, {useState} from 'react';
import {Button, Callout, FormGroup, HTMLSelect, TextArea} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';

export function BackendActionEditor({element,disabled,onPropose}) {
    const [targetId,setTargetId] = useState(''), [text,setText] = useState('Hello from Live UI');
    const [source,setSource] = useState('fixed'), [inputId,setInputId] = useState('');
    const [display,setDisplay]=useState('json'),[preset,setPreset]=useState('text');
    const creation = element.localActionCreation;
    if (!creation) return null;
    const target = creation.targets.find(item=>item.id === targetId);
    const input = creation.inputs?.find(item=>item.id === inputId);
    const valid = !!target && (source === 'input' ? !!input : text.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text));
    return <EditorSection title="Create backend action" icon="exchange" description="Send text · typed SDK round trip">
        {creation.backend ? <>
            <FormGroup label="Backend preset" labelFor="backend-preset"><HTMLSelect id="backend-preset" fill value={preset} disabled={disabled} options={[{value:'text',label:'Send text to backend'},{value:'inspect-json',label:'Inspect JSON locally'}]} onChange={event=>{setPreset(event.target.value);setDisplay('json');if(text === 'Hello from Live UI' && event.target.value === 'inspect-json') setText('{"hello":"world"}');}}/></FormGroup>
            <Callout title={preset === 'inspect-json' ? "Inspect JSON locally" : "Send text to backend"}>{preset === 'inspect-json' ? "Parses JSON in the plugin backend and returns a typed summary, value type, item count and top-level keys. Malformed JSON returns a helpful error. " : "The handler returns the text and its length. "}Creates a validated {'{text: string}'} request, typed success/error result, SDK handler registration and frontend binding. No external service is used.</Callout>
            <FormGroup label="Backend result element" labelFor="backend-action-target"><HTMLSelect id="backend-action-target" fill value={targetId} disabled={disabled} onChange={event=>setTargetId(event.target.value)}
                options={[{value:'',label:'Choose a text/result element…'},...creation.targets.map(item=>({value:item.id,label:item.label+' · '+item.file+':'+item.line}))]}/></FormGroup>
            <FormGroup label="Request text source" labelFor="backend-text-source"><HTMLSelect id="backend-text-source" fill value={source} disabled={disabled} onChange={event=>setSource(event.target.value)}
                options={[{value:'fixed',label:'Fixed text'},{value:'input',label:'UI text input'}]}/></FormGroup>
            {source === 'fixed' ? <FormGroup label="Backend request text" labelFor="backend-action-text" helperText="Fixed request text, up to 2,000 characters."><TextArea id="backend-action-text" fill growVertically value={text} maxLength={2000} disabled={disabled} onChange={event=>setText(event.target.value)}/></FormGroup>
                : <FormGroup label="Backend request input" labelFor="backend-request-input" helperText="Reads the current value on each deployed click. Maximum 2,000 characters; empty text is allowed."><HTMLSelect id="backend-request-input" fill value={inputId} disabled={disabled} onChange={event=>setInputId(event.target.value)}
                    options={[{value:'',label:'Choose a text input…'},...(creation.inputs || []).map(item=>({value:item.id,label:item.label+' · '+item.file+':'+item.line}))]}/>
                    {!creation.inputs?.length && <p>Add a new Input component first. Custom-wired, disabled, read-only, shared and password inputs are excluded.</p>}
                </FormGroup>}

            <FormGroup label="Result display" labelFor="backend-result-display"><HTMLSelect id="backend-result-display" fill value={display} disabled={disabled} options={resultDisplays(preset)} onChange={event=>setDisplay(event.target.value)}/></FormGroup>
            {!creation.targets.length && <p>Add a unique Text or Result panel first.</p>}
            <Button fill icon="add" disabled={disabled || !valid} onClick={()=>onPropose({kind:'create-backend-action',targetId,...(preset !== 'text' ? {preset} : {}),...(display !== 'json' ? {display} : {}),...(source === 'input' ? {inputId} : {text})})}>Preview backend action</Button>
            <p className="bp6-text-muted">Preview uses mock responses only. Apply saves all related code together; build and deploy to exercise the real SDK transport. Undo removes the entire draft operation. Disconnect retains the backend handler for reuse.</p>
        </> : <p>Backend creation requires a direct TypeScript action contract and a synchronous, zero-input init method. Custom initialization stays in the IDE.</p>}
    </EditorSection>;
}
