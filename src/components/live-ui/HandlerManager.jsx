import React,{useEffect,useState} from 'react';
import {Button,Callout,Checkbox,Dialog,DialogBody,DialogFooter,FormGroup,HTMLSelect,InputGroup,TextArea} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {DEFAULT_CLICK_HANDLER,handlerNameError} from '../../utils/plugins/authoring/liveUi/actionBindingOptions';
import * as styles from './WorkspacePreview.module.css';

const cleanMessage=value=>String(value || 'The handler change could not be previewed. Your code is retained.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');

export function HandlerManager({target,disabled,onPropose,onReveal,sourceDisabled,selection,onSelectionChange,open,onToggle}) {
    const [dialog,setDialog]=useState(null),[name,setName]=useState(''),[code,setCode]=useState(''),[shared,setShared]=useState(false),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
    const handlers=target.handlers || [],selected=handlers.find(handler=>handler.name===selection);
    useEffect(()=>{if(!handlers.some(handler=>handler.name===selection))onSelectionChange(handlers[0]?.name || '');},[handlers,selection,onSelectionChange]);
    if(!target.handlerContainer)return null;
    const begin=action=>{
        let copyName=(selected?.name || 'handler')+'Copy',suffix=2;
        while(target.handlerContainer.names.includes(copyName))copyName=selected.name+'Copy'+suffix++;
        setDialog({action,handler:action==='create'?undefined:selected?.name,uses:action==='create'?0:selected?.uses || 0,complete:selected?.referencesComplete!==false});
        setName(action==='duplicate'?copyName:action==='rename'?selected.name:'');
        setCode(action==='create'?DEFAULT_CLICK_HANDLER:selected?.functionSource || '');setShared(false);setNotice('');
    };
    const names=target.handlerContainer.names;
    const naming=['create','duplicate','rename'].includes(dialog?.action),coding=['create','update'].includes(dialog?.action);
    const nameError=naming ? handlerNameError(name) || (names.includes(name)?'A handler with this name already exists.':'') : '';
    const visibleNameError=name && !(dialog?.action==='rename' && name===dialog.handler) ? nameError : '';
    const needsShared=['update','rename'].includes(dialog?.action) && (dialog.uses>1 || !dialog.complete);
    const submit=async()=>{
        setNotice('');setPending(true);
        try {
            const request={kind:'sdk-handler',action:dialog.action,...(dialog.handler?{handler:dialog.handler}:{}),
                ...(naming?{name}:{}),...(coding?{code}:{}),confirmSharedHandler:shared};
            const result=await onPropose(request);
            if(result===true || result?.status==='ready') {
                if(naming)onSelectionChange(name);
                setDialog(null);
            } else setNotice(cleanMessage(result?.message));
        } catch(error){setNotice(cleanMessage(error.message));}
        finally{setPending(false);}
    };
    return <EditorSection compact title="Click handlers" icon="code" description={`${handlers.length} declared · shared with the action module`} open={open} onToggle={onToggle}>
        <FormGroup label="Handler to manage"><HTMLSelect fill aria-label="Handler to manage" value={selection} disabled={disabled || pending} onChange={event=>onSelectionChange(event.target.value)}
            options={handlers.length?handlers.map(handler=>({value:handler.name,label:handler.name+' · '+handler.uses+' bindings'})):[{value:'',label:'No declared handlers'}]}/></FormGroup>
        {selected && <>
            <p className={styles.bindingHelp}>{selected.uses} binding{selected.uses===1?'':'s'} use this handler{selected.referencesComplete===false?' · additional dynamic references need review':''}.</p>
            <div className={styles.bindingButtons}>
                <Button icon="edit" disabled={disabled || !!selected.editReason} onClick={()=>begin('update')}>Edit handler code</Button>
                <Button icon="duplicate" disabled={disabled || !!selected.editReason} onClick={()=>begin('duplicate')}>Duplicate handler</Button>
                <Button icon="tag" disabled={disabled || !selected.referencesComplete} onClick={()=>begin('rename')}>Rename handler</Button>
                <Button intent="danger" icon="trash" disabled={disabled || !!selected.uses || !selected.referencesComplete || names.length<=1} onClick={()=>begin('remove')}>Remove unused handler</Button>
            </div>
            {selected.editReason && <p className={styles.bindingHelp}>{selected.editReason}</p>}
            {!!selected.uses && <p className={styles.bindingHelp}>Disconnect or rewire its bindings before removal. Rename updates the declared binding references together.</p>}
            <EditorSection compact title="Handler implementation" icon="code" description={`${selected.location.path}:${selected.location.line}`}>
                <pre className={styles.handlerSource}>{selected.code}</pre>
                {onReveal && <Button icon="code" disabled={sourceDisabled} onClick={()=>onReveal({kind:'handler',name:selected.name})}>Show handler in code</Button>}
            </EditorSection>
        </>}
        <Button fill icon="add" disabled={disabled} onClick={()=>begin('create')}>New click handler</Button>
        <p className={styles.bindingHelp}>New and duplicated handlers start disconnected. Choose them in a binding above when ready. Preview stores code without running it.</p>
        <Dialog isOpen={!!dialog} title={dialog?.action==='create'?'New click handler':dialog?.action==='update'?'Edit handler code':dialog?.action==='duplicate'?'Duplicate handler':dialog?.action==='rename'?'Rename handler':'Remove unused handler'}
            className={styles.handlerDialog} style={{width:760,maxWidth:'calc(100vw - 32px)'}} canOutsideClickClose={false} canEscapeKeyClose={false} isCloseButtonShown={!pending}
            onClose={()=>{if(!pending)setDialog(null);}}>
            <DialogBody>
                {dialog?.handler && <p><strong>{dialog.handler}</strong> · {dialog.uses} bindings</p>}
                {naming && <FormGroup label="Handler name" labelFor="sdk-handler-name" intent={visibleNameError?'danger':'none'} helperText={visibleNameError || 'Names are case-sensitive. Existing bindings are updated when renamed.'}>
                    <InputGroup id="sdk-handler-name" value={name} disabled={pending} onValueChange={value=>{setName(value);setNotice('');}}/>
                </FormGroup>}
                {coding && <FormGroup label="Handler function" labelFor="sdk-handler-function" helperText="Callbacks are serialized independently. Use the SDK context and frontend globals; module imports and closures are unavailable. Full workspace checks run on Apply.">
                    <TextArea id="sdk-handler-function" value={code} fill rows={13} className={styles.handlerCode} disabled={pending} maxLength={20000}
                        spellCheck={false} onChange={event=>{setCode(event.target.value);setNotice('');}}/>
                    <small>{code.length.toLocaleString()} / 20,000 characters</small>
                </FormGroup>}
                {dialog?.action==='duplicate' && <p>The callback is copied without changing the original handler or its bindings.</p>}
                {dialog?.action==='remove' && <p>Remove this unused handler definition from the draft? Undo restores its code. Workspace files change only after Apply.</p>}
                {needsShared && <Callout intent="warning" title="Shared handler">
                    Editing this handler affects every binding using its name. Renaming updates all declared binding references.
                    <Checkbox checked={shared} disabled={pending} onChange={event=>setShared(event.target.checked)}>Apply this handler change to all its bindings</Checkbox>
                </Callout>}
                {notice && <Callout intent="danger" role="alert">{notice}</Callout>}
            </DialogBody>
            <DialogFooter actions={<><Button disabled={pending} onClick={()=>setDialog(null)}>Cancel</Button>
                <Button intent={dialog?.action==='remove'?'danger':'primary'} icon="eye-open" loading={pending} disabled={pending || !!nameError || coding && !code.trim() || needsShared && !shared}
                    onClick={submit}>Preview handler change</Button></>}/>
        </Dialog>
    </EditorSection>;
}
