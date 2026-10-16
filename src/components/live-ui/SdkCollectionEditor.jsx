import {SdkSlotEditor} from './SdkSlotEditor';
import React,{useEffect,useRef,useState} from 'react';
import {Button,Callout,FormGroup,HTMLSelect,InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';

export function SdkCollectionEditor({element,disabled,onPropose,onInspect,onPreviewItem,rememberedItemKey,onItemSelect}) {
    const collection=element.sdkComponent.collection;
    const [key,setKey]=useState(collection?.items.some(row=>row.key===rememberedItemKey) ? rememberedItemKey : collection?.items[0]?.key || '');
    const item=collection?.items.find(row=>row.key===key);
    const [label,setLabel]=useState(item?.label || '');
    const selectItem=next=>{setKey(next);onItemSelect?.(next);};
    const previousKeys=useRef(collection?.items.map(row=>row.key) || []);
    useEffect(()=>{
        const added=collection?.items.find(row=>!previousKeys.current.includes(row.key));
        previousKeys.current=collection?.items.map(row=>row.key) || [];
        if(added) selectItem(added.key);
        else if(!collection?.items.some(row=>row.key===key)) selectItem(collection?.items[0]?.key || '');
    },[collection,key]);
    useEffect(()=>setLabel(item?.label || ''),[item]);
    if(!collection) return null;
    const blocked=disabled || !element.structure?.unique || !!element.sdkComponent.reason || !collection.editable;
    const tab=element.sdkComponent.identity==='fdo.tabs';
    const index=collection.items.indexOf(item),changed=label!==item?.label && !!label.trim() && label.length<=2000 && !/[\r\n\u0000-\u001f]/.test(label);
    const proposeContent=async operation=>{
        const success=await onPropose(operation);
        if(success && operation.action==='transfer') {const destination=collection.items.find(row=>row.slot?.name===operation.destinationSlot);if(destination) selectItem(destination.key);}
        return success;
    };
    const propose=(action,extra={})=>onPropose({kind:'component-collection',key,action,...extra});
    return <EditorSection defaultOpen title={tab ? 'Tab items' : 'Accordion sections'} icon="layers" description="Manage items without rewriting their content">
        {collection.reason && <Callout intent="warning">{collection.reason}</Callout>}
        <p className="bp6-text-muted">Keys and existing content are preserved. Add SDK blocks below; shared or custom fragments stay in code. Remove is available only for empty items.</p>
        {tab && collection.activeTarget && <FormGroup label="Default tab" labelFor="sdk-default-tab" helperText={collection.activeTarget.editable ? 'Saved initial selection. Preview item changes only the design canvas.' : 'Shared or computed activeKey stays in the IDE.'}><HTMLSelect id="sdk-default-tab" fill value={collection.activeKey ?? ''} disabled={blocked || !collection.activeTarget.editable} options={[{value:'',label:'First enabled tab (SDK default)'},...collection.items.map(row=>({value:row.key,label:row.label,disabled:row.flag}))]} onChange={event=>propose('default-tab',{value:event.target.value})}/></FormGroup>}
        <Button fill icon="add" disabled={blocked || collection.items.length>=50} onClick={()=>propose('add')}>{tab ? 'Add tab' : 'Add section'}</Button>
        {!!item && <>
            <FormGroup label="Collection item" labelFor="sdk-collection-item"><HTMLSelect id="sdk-collection-item" fill value={key} disabled={blocked} options={collection.items.map((row,i)=>({value:row.key,label:(i+1)+'. '+row.label}))} onChange={event=>selectItem(event.target.value)}/></FormGroup>
            {onPreviewItem && <Button fill icon="eye-open" disabled={blocked} onClick={()=>onPreviewItem(key)}>Preview item</Button>}
            <FormGroup label="Item label" labelFor="sdk-item-label"><InputGroup id="sdk-item-label" value={label} disabled={blocked || !item.labelTarget} maxLength={2000} onValueChange={setLabel} onKeyDown={event=>{if(event.key==='Enter' && !event.nativeEvent.isComposing && !blocked && changed) {event.preventDefault();propose('label',{value:label});}}}/></FormGroup>
            <Button fill icon="edit" disabled={blocked || !item.labelTarget || !changed} onClick={()=>propose('label',{value:label})}>Preview item label</Button>
            <FormGroup label={tab ? 'Tab disabled' : 'Section initially open'} labelFor="sdk-item-flag" helperText={!tab && !collection.multiple ? 'Opening this section closes other literal initially open sections in the same draft edit.' : undefined}><HTMLSelect id="sdk-item-flag" fill value={String(item.flag)} options={['false','true']} disabled={blocked || !item.flagTarget} onChange={event=>propose('flag',{value:event.target.value==='true'})}/></FormGroup>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <Button icon="arrow-up" disabled={blocked || index===0} onClick={()=>propose('up')}>Move item up</Button>
                <Button icon="arrow-down" disabled={blocked || index===collection.items.length-1} onClick={()=>propose('down')}>Move item down</Button>
            </div>
            <Button fill icon="trash" intent="danger" disabled={blocked || !item.removable || collection.items.length===1 || tab && (collection.activeKey===key || !collection.items.some(row=>row!==item && !row.flag))} onClick={()=>propose('remove')}>Remove item</Button>
            {item.reason && <small>{item.reason}</small>}
            {item.slot && <SdkSlotEditor key={item.key} itemContent transferSlots={collection.items.flatMap(row=>row.slot ? [row.slot] : [])} element={{...element,sdkComponent:{...element.sdkComponent,name:item.label,slots:[item.slot]}}} disabled={blocked} onPropose={proposeContent} onInspect={onInspect}/>}
        </>}
    </EditorSection>;
}
