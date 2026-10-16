import React,{useEffect,useState} from 'react';
import {Button,FormGroup,HTMLSelect,InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
const keyOf=target=>target.regionId+'/'+target.toastId;
export function SdkToastActionEditor({element,disabled,onPropose}) {
    const action=element.toastAction;
    const [key,setKey]=useState(''),[visible,setVisible]=useState('3'),[queued,setQueued]=useState('50'),[duration,setDuration]=useState('0');
    useEffect(()=>{setKey(action?.toastId ? keyOf(action) : '');setVisible(String(action?.visible ?? 3));setQueued(String(action?.queued ?? 50));setDuration(String(action?.duration ?? 0));},[element.id,action?.toastId,action?.regionId,action?.visible,action?.queued,action?.duration]);
    if(!action) return null;
    const target=action.targets.find(item=>keyOf(item)===key);
    const values=[visible,queued,duration],numbers=values.map(value=>value.trim() ? Number(value) : NaN);
    const valid=values.every(value=>/^(0|[1-9]\d*)$/.test(value)) && Number.isInteger(numbers[0]) && numbers[0]>=1 && numbers[0]<=20 && numbers[1]>=0 && numbers[1]<=100 && numbers[2]>=0 && numbers[2]<=600000;
    const changed=key!==keyOf(action) || numbers[0]!==action.visible || numbers[1]!==action.queued || numbers[2]!==action.duration;
    return <EditorSection title="Enqueue SDK toast" icon="notifications" description="Connect an authored toast to this button">
        {action.editable && action.targets.length ? <>
            <FormGroup label="Toast to enqueue" labelFor="toast-action-target"><HTMLSelect id="toast-action-target" fill value={key} title={target ? target.label+' · '+target.toastId : undefined} disabled={disabled} options={[{value:'',label:'Choose a region and toast…'},...action.targets.map(item=>({value:keyOf(item),label:item.label+(action.targets.filter(entry=>entry.label===item.label).length>1 ? ' · '+item.toastId : '')}))]} onChange={event=>{setKey(event.target.value);const item=action.targets.find(entry=>keyOf(entry)===event.target.value);if(item){setVisible(String(item.visible));setQueued(String(item.queued));}}}/></FormGroup>
            <FormGroup label="Visible toast limit" labelFor="toast-visible-limit" helperText="1–20 visible notifications."><InputGroup id="toast-visible-limit" type="number" min="1" max="20" step="1" value={visible} disabled={disabled || target?.locked} onValueChange={setVisible}/></FormGroup>
            <FormGroup label="Queued toast limit" labelFor="toast-queued-limit" helperText="0–100 waiting notifications; zero disables waiting."><InputGroup id="toast-queued-limit" type="number" min="0" max="100" step="1" value={queued} disabled={disabled || target?.locked} onValueChange={setQueued}/></FormGroup>
            {target?.locked && <p>Queue limits are shared with other enqueue buttons in this region. Disconnect those buttons before changing the limits.</p>}
            <FormGroup label="Toast auto-dismiss (ms)" labelFor="toast-duration" helperText="0 keeps it visible until dismissed; maximum 600,000 ms."><InputGroup id="toast-duration" type="number" min="0" max="600000" step="100" value={duration} disabled={disabled} onValueChange={setDuration}/></FormGroup>
            <Button fill icon="link" disabled={disabled || !target || !valid || !changed} onClick={()=>onPropose({kind:'connect-toast-action',regionId:target.regionId,toastId:target.toastId,visible:numbers[0],queued:numbers[1],duration:numbers[2]})}>Preview toast connection</Button>
            {action.status==='connected' && <Button fill variant="minimal" icon="unlink" disabled={disabled} onClick={()=>onPropose({kind:'disconnect-toast-action'})}>Disconnect toast action</Button>}
            <p className="bp6-text-muted">Apply and deploy to test queueing. Runtime status appears beside the button. Duplicate entries are disabled until dismissed; full queues leave the toast unchanged. The SDK owns dismissal, timers and child controllers; FDO disposes the region with the view. Preview clicks only select elements.</p>
        </> : <p className="bp6-text-muted">{action.reason}</p>}
    </EditorSection>;
}
