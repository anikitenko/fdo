import React,{useState,useEffect} from 'react';
import {Button,FormGroup,HTMLSelect,InputGroup,NonIdealState} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
export function ActionManager({actions=[],disabled,onPropose}) {
    const [name,setName]=useState(''),[filter,setFilter]=useState('');
    const visible=actions.filter(item=>(item.name+' '+item.kind).toLowerCase().includes(filter.toLowerCase()));
    useEffect(()=>{if(!actions.some(item=>item.name===name)) setName('');},[actions,name]);
    const action=actions.find(item=>item.name===name);
    return <EditorSection title="Actions" icon="code" description={`${actions.length} generated actions · including disconnected`}>
        {!actions.length ? <NonIdealState icon="code" title="No generated actions" description="Create a local or backend action on a new button."/> : <>
            <InputGroup aria-label="Filter generated actions" placeholder="Filter actions…" value={filter} disabled={disabled} onValueChange={value=>{setFilter(value);setName('');}}/>
            <FormGroup label="Generated action" labelFor="generated-action"><HTMLSelect id="generated-action" fill value={name} disabled={disabled} onChange={event=>setName(event.target.value)} options={[{value:'',label:'Choose an action…'},...visible.map(item=>({value:item.name,label:item.name+' · '+item.kind+' · '+item.uses+' controls'}))]}/></FormGroup>
            {action && <p>{action.reason || (action.uses ? 'Removes generated code and disconnects its button. The button and result/input elements remain.' : 'Removes this disconnected action and its unchanged generated backend code, if any.')}</p>}
            <Button intent="danger" icon="trash" disabled={disabled || !action?.removable} onClick={()=>onPropose({kind:'remove-action',actionName:action.name})}>Remove generated action</Button>
        </>}
        <p className="bp6-text-muted">Removal is a draft edit: Undo restores the whole action; Apply saves it. Shared or modified code is protected. Ordinary click actions remain reusable after disconnect; SDK async disconnect removes its owned controller setup.</p>
    </EditorSection>;
}
