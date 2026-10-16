import {inspectJsonFixture} from '../../utils/plugins/authoring/liveUi/jsonInspection';
import {resultDisplays} from '../../utils/plugins/authoring/liveUi/responseMappings';
import React, {useState} from 'react';
import {Button, Callout, FormGroup, HTMLSelect, InputGroup, TextArea} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {normalizeMockBackendScenario} from './utils/mockBackendScenario';

export function ActionSimulationEditor({disabled,status,onSend,backend}) {
    const [mode,setMode] = useState(backend ? 'mock' : 'local');
    const [requestText,setRequestText] = useState(backend?.text || '');
    const [responseMode,setResponseMode] = useState('custom');
    const [outcome,setOutcome] = useState('success');
    const isJson=backend?.preset === 'inspect-json';
    const fixture=text=>isJson ? inspectJsonFixture(text) : {success:true,text,length:text.length};
    const [responseText,setResponseText] = useState(backend ? JSON.stringify(fixture(backend.text),null,2) : '{"message":"Mock response"}');
    const [errorText,setErrorText] = useState('The simulated request failed.');
    const [loadingText,setLoadingText] = useState('Loading…');
    const [latency,setLatency] = useState('1000');
    const derived=fixture(requestText);
    const fixtureError=isJson && responseMode === 'echo' && outcome === 'success' && !derived.success ? derived.error : '';
    const effectiveResponse = backend && responseMode === 'echo' ? JSON.stringify(derived,null,2) : responseText;
    const scenario = {outcome:fixtureError ? 'error' : outcome,responseText:effectiveResponse,errorText:fixtureError || errorText,loadingText,...(backend ? {requestText} : {}),latencyMs:latency.trim() ? Number(latency) : NaN};
    const valid = normalizeMockBackendScenario({...scenario,display:backend?.display || 'json',preset:backend?.preset || 'text'});
    const messages = {ran:'Local action simulated. Reset restores all authored result text.',reset:'Simulation reset to authored text.',
        loading:'Mock request loading…',success:'Mock request succeeded. Response shown in preview.',error:'Mock request failed. Error shown in preview.'};
    return <EditorSection defaultOpen title={backend ? "Backend action preview" : "Local action preview"} icon="play" description={backend ? "Mock backend simulation" : "Local and mocked backend simulation"}>
        <FormGroup label="Simulation mode" labelFor="simulation-mode"><HTMLSelect id="simulation-mode" fill disabled={disabled} value={mode} onChange={event=>setMode(event.target.value)}
            options={[...(!backend ? [{value:'local',label:'Local action · authored result text'}] : []),{value:'mock',label:'Mock backend response'}]}/></FormGroup>
        {backend && <p>Backend handler: <code>{backend.handler}</code>. Preview supplies mock data and never calls this handler.</p>}
        {backend && <p>Result display: <strong>{resultDisplays(backend.preset).find(item=>item.value === (backend.display || 'json'))?.label}</strong>. Missing mapped fields show a mock error.</p>}
        {backend?.inputId && <p>Request text is bound to <strong>{backend.inputLabel}</strong>. The deployed action reads its current value. Mock JSON below starts with the authored input value and is editable; canvas clicks still select.</p>}
        {backend && <>
            <FormGroup label="Mock request text" labelFor="mock-request-text" helperText="Temporary request fixture, up to 2,000 characters. Does not change the input or source."><TextArea id="mock-request-text" fill disabled={disabled} value={requestText} maxLength={2000} onChange={event=>setRequestText(event.target.value)}/></FormGroup>
            <FormGroup label="Mock response source" labelFor="mock-response-source"><HTMLSelect id="mock-response-source" fill disabled={disabled} value={responseMode} onChange={event=>setResponseMode(event.target.value)} options={[{value:'custom',label:'Custom JSON response'},{value:'echo',label:isJson ? 'Inspect mock JSON fixture' : 'Echo mock request fixture'}]}/></FormGroup>
        </>}
        {mode === 'local' ? <p>Run shows the preset’s result text in this preview. No plugin handlers or backend requests run, and no source edits are created.</p> : <>
            <Callout icon="lab-test" title="Preview data only">Uses this action’s managed result target. No actual backend handler is called during simulation. The deployed action keeps its authored behavior.</Callout>
            <FormGroup label="Mock outcome" labelFor="mock-outcome"><HTMLSelect id="mock-outcome" fill disabled={disabled} value={outcome} onChange={event=>setOutcome(event.target.value)} options={[{value:'success',label:'Success · JSON response'},{value:'error',label:'Error'}]}/></FormGroup>
            {outcome === 'success' ? <FormGroup label="Mock response JSON" labelFor="mock-response" helperText="Valid JSON, up to 16,000 characters after formatting. Displayed as plain text."><TextArea id="mock-response" fill growVertically disabled={disabled} value={effectiveResponse} readOnly={!!backend && responseMode === 'echo'} maxLength={16000} onChange={event=>setResponseText(event.target.value)}/></FormGroup>
                : <FormGroup label="Mock error message" labelFor="mock-error"><TextArea id="mock-error" fill disabled={disabled} value={errorText} maxLength={2000} onChange={event=>setErrorText(event.target.value)}/></FormGroup>}
            <FormGroup label="Loading message" labelFor="mock-loading"><InputGroup id="mock-loading" disabled={disabled} value={loadingText} maxLength={2000} onChange={event=>setLoadingText(event.target.value)}/></FormGroup>
            <FormGroup label="Mock latency (ms)" labelFor="mock-latency" helperText="0–10,000 ms. Run again replaces the pending response; Reset cancels it."><InputGroup id="mock-latency" type="number" min="0" max="10000" step="100" disabled={disabled} value={latency} onChange={event=>setLatency(event.target.value)}/></FormGroup>
            {!valid && <Callout intent="warning">Enter valid JSON for success, a request of at most 2,000 characters, non-empty error/loading messages, and a whole-number delay from 0 to 10,000 ms.</Callout>}
        </>}
        <Button icon="play" intent="primary" disabled={disabled || mode === 'mock' && !valid} onClick={()=>onSend(mode === 'mock' ? {type:'fdo-ui-run-mock',scenario} : {type:'fdo-ui-run-local'})}>{mode === 'mock' ? 'Run mock request' : 'Run local action'}</Button>{' '}
        <Button icon="reset" disabled={disabled} onClick={()=>onSend({type:'fdo-ui-reset-local'})}>Reset simulation</Button>
        {messages[status] && <p role="status">{messages[status]}</p>}
        <p className="bp6-text-muted">Ordinary preview clicks still select elements. Changing the draft or refreshing also resets simulation. These settings are temporary and are never applied to source.</p>
    </EditorSection>;
}
