import React, {useEffect, useState} from 'react';
import {Button, FormGroup, HTMLSelect, NonIdealState} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';

export function SdkSlotEditor({element, disabled, onPropose, onInspect, itemContent = false, transferSlots}) {
    const component = element.sdkComponent;
    const [slot, setSlot] = useState(component.slots[0]?.name || 'body');
    const [preset, setPreset] = useState('text');
    const destinations=(transferSlots || component.slots).filter(item=>item.name!==slot && item.editable);
    const [destinationName,setDestinationName]=useState(destinations[0]?.name || '');
    useEffect(()=>{if(!destinations.some(item=>item.name===destinationName)) setDestinationName(destinations[0]?.name || '');},[destinations,destinationName]);
    if (!component.slots.length) return null;
    const current = component.slots.find(item => item.name === slot);
    const destination = destinations.find(item=>item.name===destinationName);
    const blocked = disabled || !!component.reason || !element.structure?.unique;
    const children = current?.children || [];
    return <section aria-label="Component content"><EditorSection defaultOpen title={component.name + ' content'} icon="layout-hierarchy" description={itemContent ? "Build this item with SDK helpers" : "Add and arrange body/footer content"}>
        <p className="bp6-text-muted">{itemContent ? 'Content belongs to this item. ' : 'Body is the main content; footer is the area below it. '}Choose a position to move directly, or Inspect to edit a block. Changes share draft Undo/Redo and Apply.</p>
        {component.reason && <p className="bp6-text-muted">{component.reason}</p>}
        <FormGroup label="Component slot" labelFor="sdk-slot"><HTMLSelect id="sdk-slot" fill value={slot} disabled={blocked} options={component.slots.map(item => ({value: item.name, label: item.label || (item.name === 'body' ? 'Body · Main content' : item.name === 'footer' ? 'Footer · Bottom content' : item.name)}))} onChange={event => setSlot(event.target.value)}/></FormGroup>
        {transferSlots && <FormGroup label="Move content to" labelFor="sdk-slot-destination" helperText="Move appends the existing block to another item. Its source and identities are preserved."><HTMLSelect id="sdk-slot-destination" fill value={destinationName} disabled={blocked || !destinations.length} options={destinations.length ? destinations.map(item=>({value:item.name,label:item.label || item.name})) : [{value:'',label:'Add another editable item first'}]} onChange={event=>setDestinationName(event.target.value)}/></FormGroup>}
        {children.length ? <ol aria-label={slot + ' content'} style={{paddingLeft: 20}}>
            {children.map((child, index) => <li key={child.start} style={{marginBottom: 12}}>
                <div style={{overflowWrap: 'anywhere'}}>{child.label}</div>
                <HTMLSelect fill aria-label={'Position of ' + child.label} value={String(index)} disabled={blocked || !child.movable || children.length < 2}
                    options={children.map((_, destinationIndex) => ({value: String(destinationIndex), label: String(destinationIndex + 1) + (destinationIndex === 0 ? ' · First' : destinationIndex === children.length - 1 ? ' · Last' : ''),
                        disabled: children.slice(Math.min(index, destinationIndex), Math.max(index, destinationIndex) + 1).some(item => !item.movable)}))}
                    onChange={event => onPropose({kind: 'component-slot-arrange', slot, childId: child.id, action: 'position', index: Number(event.target.value)})}/>
                <div style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4}}>
                    {onInspect && <Button size="small" icon="select" disabled={blocked || !child.id} aria-label={'Inspect ' + child.label} onClick={() => onInspect(child.id)}>Inspect</Button>}
                    <Button size="small" icon="duplicate" disabled={blocked || !child.duplicable} aria-label={'Duplicate ' + child.label} title={child.duplicable ? 'Add an independent inline copy immediately after this block' : child.reason || 'IDs, action bindings and shared fragments cannot be duplicated visually'}
                        onClick={() => onPropose({kind: 'component-slot-arrange', slot, childId: child.id, action: 'duplicate'})}/>

                    {['up', 'down', 'remove'].map(action => <Button key={action} size="small" icon={action === 'remove' ? 'trash' : 'arrow-' + action}
                        aria-label={action + ' ' + child.label} title={action === 'remove' ? child.reason || 'Remove from slot' : 'Move ' + action}
                        disabled={blocked || (action === 'remove' ? !child.removable : !child.movable || !children[index + (action === 'up' ? -1 : 1)]?.movable)}
                        onClick={() => onPropose({kind: 'component-slot-arrange', slot, childId: child.id, action})}/>)}
                    {destination && <Button size="small" icon="exchange" disabled={blocked || !child.transferable} aria-label={'Move ' + child.label + ' to ' + (destination.label || destination.name)}
                        title={child.transferReason || 'Append to ' + (destination.label || destination.name)}
                        onClick={() => onPropose({kind: 'component-slot-arrange', slot, childId: child.id, action: 'transfer', destinationSlot: destination.name})}>{transferSlots ? 'Move' : 'To '+destination.name}</Button>}
                </div>
                {child.reason && <small className="bp6-text-muted">{child.reason}</small>}
            </li>)}
        </ol> : <NonIdealState icon="layers" title={'Empty ' + slot} description="Add content below. SDK-generated controls stay separate."/>}
        <FormGroup label="Add to slot" labelFor="sdk-slot-component"><HTMLSelect id="sdk-slot-component" fill value={preset} disabled={blocked} options={['text', 'container', 'input', 'singleLineInput', 'button', 'result']} onChange={event => setPreset(event.target.value)}/></FormGroup>
        <Button fill icon="add" disabled={blocked || !current?.editable} onClick={() => onPropose({kind: 'component-slot', slot, component: preset})}>Preview slot addition</Button>
        {current?.sdkInsertions?.length > 0 && <div style={{marginTop:12}}>
            {current.sdkInsertions.map(item=><Button key={item.identity} fill icon="notifications" disabled={blocked || !current.editable}
                onClick={()=>onPropose({kind:'insert-sdk-slot-component',slot,component:item.identity})}>Add {item.name.toLowerCase()} to region</Button>)}
            <p className="bp6-text-muted">Adds initial toast markup with a unique ID. Select the toast to edit its message, appearance and progress. Preview its Open state to reveal it. Use an unconnected button’s Enqueue SDK toast section for runtime queueing. Custom notification routing stays in the IDE.</p>
        </div>}
    </EditorSection></section>;
}
