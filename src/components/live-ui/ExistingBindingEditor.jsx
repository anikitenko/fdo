import React,{useEffect,useRef,useState} from 'react';
import {Button,Callout,Checkbox,FormGroup,HTMLSelect} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {HandlerManager} from './HandlerManager';
import * as styles from './WorkspacePreview.module.css';
import {BINDING_EVENTS,BINDING_FLAGS} from '../../utils/plugins/authoring/liveUi/actionBindingOptions';

const labels={preventDefault:'Prevent default event',stopPropagation:'Stop propagation',once:'Run once',passive:'Passive listener',capture:'Capture phase',required:'Require the target to exist'};
function Source({value,title,onReveal,disabled}) {
    if(!value)return null;
    return <EditorSection compact title={title+' source'} icon="code" description={`${value.location.path}:${value.location.line}`}>
        <pre className={styles.handlerSource}>{value.code}</pre>
        {value.truncated && <p className="bp6-text-muted">Source excerpt truncated. Open the source for the complete implementation.</p>}
        {onReveal && <Button size="small" icon="code" disabled={disabled} onClick={onReveal}>Show {title.toLowerCase()} in code</Button>}
    </EditorSection>;
}

function Binding({item,handlers,disabled,onPropose,onReveal,sourceDisabled,onManage,first}) {
    const [handler,setHandler]=useState(item.handler),[event,setEvent]=useState(item.event),[options,setOptions]=useState(item.options),[shared,setShared]=useState(false);
    useEffect(()=>{setHandler(item.handler);setEvent(item.event);setOptions(item.options);setShared(false);},[item]);
    const selected=handlers.find(value=>value.name===handler);
    const changed=handler!==item.handler || event!==item.event || BINDING_FLAGS.some(name=>options[name]!==item.options[name]);
    const conflict=options.passive && options.preventDefault;
    const blocked=disabled || !item.editable || item.matches>1 && !shared;
    return <section aria-label={'Binding '+item.event+' '+item.selector}>
        <EditorSection compact defaultOpen={first} title={item.event+' → '+item.handler} icon="link" description={`${item.selector} · ${item.matches} matching controls`}>
        {item.matches>1 && <Callout intent="warning" title="Shared binding">
            This selector matches {item.matches} controls in this preview. Changes affect every runtime match, including controls added later.
            <Checkbox checked={shared} disabled={disabled || !item.editable} onChange={event=>setShared(event.target.checked)}>Change this binding for all matching controls</Checkbox>
        </Callout>}
        {!item.editable && <p className="bp6-text-muted">{item.reason}</p>}
        <div className={styles.bindingFields}>
        <FormGroup label="Handler"><HTMLSelect fill aria-label="Handler" value={handler} disabled={blocked} onChange={event=>setHandler(event.target.value)}
            options={[...new Set([item.handler,...handlers.map(value=>value.name)])].map(name=>({value:name,label:name}))}/></FormGroup>
        <FormGroup label="Event"><HTMLSelect fill aria-label="Event" value={event} disabled={blocked} onChange={event=>setEvent(event.target.value)}
            options={[...new Set([item.event,...BINDING_EVENTS])]}/></FormGroup>
        </div>
        {selected && <p className={styles.bindingHelp}>Handler used by {selected.uses} binding{selected.uses===1?'':'s'}. <Button variant="minimal" size="small" icon="edit" disabled={disabled} onClick={()=>onManage(selected.name)}>Manage handler</Button></p>}
        <EditorSection compact title="Listener options" icon="settings" description={`${BINDING_FLAGS.filter(name=>options[name]).length} enabled · event behavior`}>
            {BINDING_FLAGS.map(name=><Checkbox key={name} label={labels[name]} checked={options[name]} disabled={blocked}
                onChange={event=>setOptions({...options,[name]:event.target.checked})}/>)}
        </EditorSection>
        {conflict && <p role="alert">A passive listener cannot prevent the default event.</p>}
        <div className={styles.bindingButtons}><Button icon="tick" intent="primary" disabled={blocked || !changed || conflict} onClick={()=>onPropose({kind:'sdk-binding',action:'update',bindingId:item.id,handler,event,options,confirmShared:shared})}>Preview binding change</Button>
        <Button icon="unlink" disabled={blocked} onClick={()=>onPropose({kind:'sdk-binding',action:'remove',bindingId:item.id,confirmShared:shared})}>Disconnect binding</Button>
        </div>
        <Source title="Binding" value={item} disabled={sourceDisabled} onReveal={onReveal && (()=>onReveal({kind:'binding',bindingId:item.id}))}/>
        <Source title="Handler" value={selected} disabled={sourceDisabled} onReveal={onReveal && selected && (()=>onReveal({kind:'handler',name:selected.name}))}/>
        </EditorSection>
    </section>;
}

export function ExistingBindingEditor({element,disabled,onPropose,onReveal,sourceDisabled}) {
    const target=element.sdkBindings;
    const [handler,setHandler]=useState(''),[event,setEvent]=useState(element.tag==='button'?'click':'change');
    const [managed,setManaged]=useState(target?.items[0]?.handler || ''),[managerOpen,setManagerOpen]=useState(false);
    const manager=useRef(null);
    useEffect(()=>{setHandler('');setEvent(element.tag==='button'?'click':'change');},[element.id]);
    if(!target)return null;
    const manage=name=>{setManaged(name);setManagerOpen(true);requestAnimationFrame(()=>manager.current?.scrollIntoView?.({block:'nearest',behavior:'auto'}));};
    return <EditorSection defaultOpen title="Action bindings" icon="link" description={`${target.items.length} binding${target.items.length===1?'':'s'} · ${target.handlers.length} handlers available`}>
        <p className={styles.bindingHelp}>Preview clicks select elements. Handler changes are drafts until Apply.</p>
        {target.reason ? <Callout title="Binding source needs review">{target.reason} Rendered attributes remain available under Element attributes.</Callout> : <>
            {!target.items.length && <p>No statically matched SDK binding is connected to this element.</p>}
            {target.items.map((item,index)=><Binding key={item.file+':'+item.selector+':'+index} first={index===0} item={item} handlers={target.handlers} disabled={disabled} onPropose={onPropose} onReveal={onReveal} sourceDisabled={sourceDisabled} onManage={manage}/>)}
            {target.connect ? <EditorSection compact defaultOpen={!target.items.length} title="Connect an existing handler" icon="add" description={target.connect.selector}>
                <p>New binding target: <code>{target.connect.selector}</code></p>
                <FormGroup label="Existing handler"><HTMLSelect fill aria-label="Existing handler" value={handler} disabled={disabled} onChange={event=>setHandler(event.target.value)}
                    options={[{value:'',label:'Choose a handler…'},...target.handlers.map(item=>({value:item.name,label:item.name}))]}/></FormGroup>
                <FormGroup label="New binding event"><HTMLSelect fill aria-label="New binding event" value={event} disabled={disabled} onChange={event=>setEvent(event.target.value)} options={BINDING_EVENTS}/></FormGroup>
                <Button icon="link" disabled={disabled || !handler || target.items.some(item=>item.event===event)} onClick={()=>onPropose({kind:'sdk-binding',action:'add',handler,event})}>Preview new binding</Button>
                {target.items.some(item=>item.event===event) && <p className="bp6-text-muted">This event already has a binding. Review that binding above.</p>}
            </EditorSection> : <p className="bp6-text-muted">Adding a binding requires a unique static element ID and selectors that can be checked for overlapping listeners.</p>}
            <div ref={manager}><HandlerManager target={target} disabled={disabled} onPropose={onPropose} onReveal={onReveal} sourceDisabled={sourceDisabled}
                selection={managed} onSelectionChange={setManaged} open={managerOpen} onToggle={setManagerOpen}/></div>
            {!!target.unresolved.length && <EditorSection compact title="Other selectors to review" icon="search" description={`${target.unresolved.length} selectors`}>
                <p>These selectors cannot be matched statically to this element. Their code is shown without assuming a connection.</p>
                {target.unresolved.map(item=><Source key={item.id} title="Binding" value={item} disabled={sourceDisabled} onReveal={onReveal && (()=>onReveal({kind:'binding',bindingId:item.id}))}/>)}
            </EditorSection>}
            <Source title="Setup" value={target.setup} disabled={sourceDisabled} onReveal={onReveal && (()=>onReveal({kind:'setup'}))}/>
            <p className={styles.bindingHelp}>Binding edits preserve markup and setup. Draft Undo/Redo restores the whole change; Apply runs workspace validation.</p>
        </>}
    </EditorSection>;
}
