import React,{useState} from 'react';
import {Button,FormGroup,HTMLSelect} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {resultDisplays} from '../../utils/plugins/authoring/liveUi/responseMappings';
export function BackendResultEditor({element,disabled,onPropose}) {
    const mapping=element.backendResultMapping;
    const [targetId,setTargetId]=useState(mapping?.targetId || ''),[display,setDisplay]=useState(mapping?.display || 'json');
    const [outputs,setOutputs]=useState(mapping?.outputs || []);
    if(!mapping) return null;
    const changed=targetId!==mapping.targetId || display!==mapping.display || JSON.stringify(outputs)!==JSON.stringify(mapping.outputs || []);
    const valid=outputs.every(output=>mapping.targets.some(item=>item.id===output.targetId)) && new Set([targetId,...outputs.map(output=>output.targetId)]).size===outputs.length+1;
    return <EditorSection defaultOpen title="Backend result mapping" icon="exchange" description="Choose output and displayed field">
        <FormGroup label="Mapped result element" labelFor="mapped-result-element"><HTMLSelect id="mapped-result-element" fill value={targetId} disabled={disabled} options={mapping.targets.map(item=>({value:item.id,label:item.label+' · '+item.file+':'+item.line}))} onChange={event=>setTargetId(event.target.value)}/></FormGroup>
        <FormGroup label="Mapped result display" labelFor="mapped-result-display"><HTMLSelect id="mapped-result-display" fill value={display} disabled={disabled} options={resultDisplays(mapping.config?.preset || 'text')} onChange={event=>setDisplay(event.target.value)}/></FormGroup>
        {outputs.map((output,index)=><div key={index}>
            <FormGroup label={'Output '+(index+2)+' element'} labelFor={'extra-output-'+index}><HTMLSelect id={'extra-output-'+index} fill value={output.targetId} disabled={disabled} options={[{value:'',label:'Choose another result element…'},...mapping.targets.map(item=>({value:item.id,label:item.label+' · '+item.file+':'+item.line,disabled:item.id===targetId || outputs.some((other,i)=>i!==index && other.targetId===item.id)}))]} onChange={event=>setOutputs(rows=>rows.map((row,i)=>i===index ? {...row,targetId:event.target.value} : row))}/></FormGroup>
            <FormGroup label={'Output '+(index+2)+' display'} labelFor={'extra-display-'+index}><HTMLSelect id={'extra-display-'+index} fill value={output.display} disabled={disabled} options={resultDisplays(mapping.config?.preset || 'text')} onChange={event=>setOutputs(rows=>rows.map((row,i)=>i===index ? {...row,display:event.target.value} : row))}/></FormGroup>
            <Button variant="minimal" intent="danger" disabled={disabled} onClick={()=>setOutputs(rows=>rows.filter((row,i)=>i!==index))}>Remove output {index+2}</Button>
        </div>)}
        <Button icon="add" disabled={disabled || outputs.length>=3 || mapping.targets.length<=outputs.length+1} onClick={()=>setOutputs(rows=>[...rows,{targetId:'',display:'json'}])}>Add result output</Button>
        <Button icon="eye-open" disabled={disabled || !changed || !valid || !mapping.targets.some(item=>item.id===targetId)} onClick={()=>onPropose({kind:'backend-result',targetId,display,...(outputs.length || mapping.outputs?.length ? {outputs} : {})})}>Preview result mapping</Button>
        <p className="bp6-text-muted">Maps one response to up to four distinct result elements in one draft edit. The primary result shows loading/errors; extra outputs update together on success. Request input and backend implementation stay intact. Mock preview uses the same display. Text remains plain text; zero and empty values are preserved.</p>
    </EditorSection>;
}
