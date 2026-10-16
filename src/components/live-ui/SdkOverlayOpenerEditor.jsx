import React,{useEffect,useState} from 'react';
import {Button,FormGroup,HTMLSelect,TextArea} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
export function SdkOverlayOpenerEditor({element,disabled,onPropose}) {
    const connection=element.overlayOpener;
    const [targetId,setTargetId]=useState(connection?.targetId || '');
    const [resultId,setResultId]=useState(connection?.confirmation?.targetId || '');
    const [text,setText]=useState(connection?.confirmation?.text ?? 'Confirmed');
    useEffect(()=>{setTargetId(connection?.targetId || '');setResultId(connection?.confirmation?.targetId || '');setText(connection?.confirmation?.text ?? 'Confirmed');},[element.id,connection?.targetId,connection?.confirmation?.targetId,connection?.confirmation?.text]);
    if(!connection) return null;
    const target=connection.targets.find(item=>item.id===targetId);
    const confirmation=target?.identity==='fdo.confirmation-dialog';
    const result=connection.resultTargets?.find(item=>item.id===resultId);
    const valid=result && text.length<=2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
    const changed=targetId!==connection.targetId || resultId!==connection.confirmation?.targetId || text!==connection.confirmation?.text;
    return <EditorSection defaultOpen title="Open SDK component" icon="link" description="Connect this button to a dialog or popover">
        {connection.editable && connection.targets.length ? <>
            <FormGroup label="Overlay to open" labelFor="sdk-opener-target"><HTMLSelect id="sdk-opener-target" fill disabled={disabled} value={targetId} title={target?.label} options={[{value:'',label:'Choose an SDK overlay…'},...connection.targets.map(item=>({value:item.id,label:item.label + (connection.targets.filter(entry=>entry.label===item.label).length>1 ? ' · ' + item.id : '')}))]} onChange={event=>{
                const id=event.target.value;setTargetId(id);
                if(id && connection.targets.find(item=>item.id===id)?.identity!=='fdo.confirmation-dialog') onPropose({kind:'connect-overlay-opener',targetId:id});
            }}/></FormGroup>
            {confirmation && <>
                <p>Confirm writes the text below to the selected result. Cancel or Escape closes the dialog without changing the result. No backend request runs.</p>
                <FormGroup label="Confirmation result element" labelFor="confirm-result"><HTMLSelect id="confirm-result" fill disabled={disabled} value={resultId} options={[{value:'',label:'Choose a text/result element…'},...(connection.resultTargets || []).map(item=>({value:item.id,label:item.label}))]} onChange={event=>setResultId(event.target.value)}/></FormGroup>
                {!connection.resultTargets?.length && <p>Add a supported Text or Result element first.</p>}
                <FormGroup label="Confirmed result text" labelFor="confirm-text" helperText="Up to 2,000 characters. HTML is displayed as plain text."><TextArea id="confirm-text" fill growVertically value={text} maxLength={2000} disabled={disabled} onChange={event=>setText(event.target.value)}/></FormGroup>
                <Button fill icon="link" disabled={disabled || !valid || !changed} onClick={()=>onPropose({kind:'connect-overlay-opener',targetId,confirmTargetId:resultId,confirmText:text})}>Preview confirmation flow</Button>
            </>}
            {connection.status==='connected' && <Button fill variant="minimal" icon="unlink" disabled={disabled} onClick={()=>onPropose({kind:'disconnect-overlay-opener'})}>Disconnect overlay opener</Button>}
            <p className="bp6-text-muted">The deployed button opens this component. FDO owns controller/listener cleanup; existing frontend setup stays unchanged. Preview clicks only select elements.</p>
        </> : <p className="bp6-text-muted">{connection.reason}</p>}
    </EditorSection>;
}
