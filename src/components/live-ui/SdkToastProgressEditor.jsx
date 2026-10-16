import React,{useEffect,useState} from 'react';
import {Button,Callout,FormGroup,InputGroup} from '@blueprintjs/core';
import {toastProgressError} from '../../utils/plugins/authoring/liveUi/sdkToastProgress';
import {EditorSection} from './EditorSection';

export function SdkToastProgressEditor({element,disabled,onPropose}) {
    const progress=element.sdkComponent.toastProgress;
    const [label,setLabel]=useState(progress?.value.label || ''),[value,setValue]=useState(String(progress?.value.value ?? '')),[max,setMax]=useState(String(progress?.value.max ?? 100));
    useEffect(()=>{setLabel(progress?.value.label || '');setValue(String(progress?.value.value ?? ''));setMax(String(progress?.value.max ?? 100));},[progress]);
    if(!progress) return null;
    const blocked=disabled || !element.structure?.unique || !!element.sdkComponent.reason || !progress.editable;
    const settings={label,value:value.trim() ? Number(value) : null,max:max.trim() ? Number(max) : NaN};
    const error=toastProgressError(settings,progress.hasExternalLabel);
    const changed=Object.keys(settings).some(name=>settings[name]!==progress.value[name]);
    const writable=name=>!blocked && progress.properties.find(field=>field.name===name)?.editable;
    const update=()=>{if(!blocked && changed && !error) onPropose({kind:'toast-progress',action:'update',value:settings});};
    return <EditorSection defaultOpen title="Toast progress" icon="dashboard" description="Compose a labelled progress indicator">
        <p className="bp6-text-muted">The toast owns its progress controller. These settings define initial markup; runtime progress updates stay in frontend code.</p>
        {!progress.present ? <>
            <Button fill icon="add" disabled={blocked || !progress.canAdd} onClick={()=>onPropose({kind:'toast-progress',action:'add'})}>Add toast progress</Button>
            {progress.addReason && <Callout intent="warning">{progress.addReason}</Callout>}
        </> : <>
            {progress.reason && <Callout intent="warning">{progress.reason}</Callout>}
            <FormGroup label="Progress label" labelFor="toast-progress-label" helperText={progress.properties.find(field=>field.name==='label')?.editable ? 'Plain text. Existing ARIA references and styles are retained.' : 'Computed labels stay in the IDE.'}><InputGroup id="toast-progress-label" value={label} maxLength={2000} disabled={!writable('label')} onValueChange={setLabel}/></FormGroup>
            <FormGroup label="Progress value" labelFor="toast-progress-value" helperText="Leave empty for indeterminate progress; zero is a determinate value."><InputGroup id="toast-progress-value" type="number" min={0} max={max} step="any" value={value} disabled={!writable('value')} onValueChange={setValue}/></FormGroup>
            <FormGroup label="Progress maximum" labelFor="toast-progress-max"><InputGroup id="toast-progress-max" type="number" step="any" value={max} disabled={!writable('max')} onValueChange={setMax} onKeyDown={event=>{if(event.key==='Enter' && !event.nativeEvent.isComposing) {event.preventDefault();update();}}}/></FormGroup>
            {error && <Callout intent="danger">{error}</Callout>}
            <Button fill icon="eye-open" disabled={blocked || !changed || !!error} onClick={update}>Preview progress settings</Button>
            <Button fill icon="trash" intent="danger" disabled={blocked || !progress.removable} onClick={()=>onPropose({kind:'toast-progress',action:'remove'})}>Remove toast progress</Button>
            {progress.removeReason && <small>{progress.removeReason}</small>}
        </>}
    </EditorSection>;
}
