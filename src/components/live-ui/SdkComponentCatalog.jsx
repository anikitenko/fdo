import React from 'react';
import {Button, Card, Tag} from '@blueprintjs/core';
import * as styles from './WorkspacePreview.module.css';

const hints = {
    'fdo.progress-bar':'Native progress. Edit value and max, or leave value empty for indeterminate progress.',
    'fdo.toast':'Starts hidden. Call show() on its frontend controller, or enqueue it in a toast region.',
    'fdo.inline-alert':'Persistent feedback. Edit message, severity and visibility.',
    'fdo.toast-region':'Starts empty. Compose toast children, then connect a button in Enqueue SDK toast. Set shared queue limits and an optional auto-dismiss delay.',
    'fdo.async-action-button':'Starts disabled. Use Async button action for local text, a text backend request or JSON inspection. Custom onAction callbacks require frontend code.',
    'fdo.tabs':'Starts with two panels. Edit label and orientation here; choose the Default tab and manage panels in Tab items. Mount for keyboard navigation.',
    'fdo.disclosure':'Native details and summary. Edit title, body and initial open state.',
    'fdo.accordion':'Starts with two sections. Edit label and multiple here; manage sections in Accordion sections. Mount for exclusive expansion.',
};
export function SdkComponentCatalog({components, elements, selected, disabled, query, onAdd, onSelect}) {
    const matches=components.filter(item=>(item.name + ' ' + item.identity + ' ' + item.create + ' ' + item.mount).toLowerCase().includes(query.toLowerCase()));
    if(!matches.length) return null;
    return <section aria-label="SDK components">
        <h3>SDK components</h3>
        <p className="bp6-text-muted">Select an existing component to edit its properties and appearance, or select main or a supported nested SDK layout container to add one.</p>
        {matches.map(item=>{
            const available=selected?.sdkInsertions?.some(entry=>entry.identity === item.identity);
            return <Card key={item.identity} compact className={styles.method}>
                <strong>{item.name}</strong>{' '}<Tag minimal>{item.supported ? 'Visual editing' : 'Code only'}</Tag>
                <p><code>{item.create}</code> · Slots: {item.slots.join(', ') || 'None'}</p>
                <Button fill icon="add" disabled={disabled || !available || !item.supported} onClick={()=>onAdd(item.identity)}>Add {item.name}</Button>
                {available && <small>Adds inside {selected.label || selected.tag || 'the selected container'}. Review the draft before applying.</small>}
                {!available && item.supported && <small>Select main or a supported nested SDK layout container in Elements. Forms, overlays and shared/dynamic regions cannot receive a component.</small>}
                {!item.supported && <small>This component needs a host adapter before visual insertion is available.</small>}
                {elements.filter(element=>element.sdkComponent?.identity === item.identity).map(element=><Button key={element.id} fill variant="minimal" icon="properties" disabled={disabled} onClick={()=>onSelect(element.id)}>Inspect {element.label}</Button>)}
                {item.supported && <p className="bp6-text-muted">{hints[item.identity] || (item.identity==='fdo.confirmation-dialog' ? 'Starts closed. Add a button and use Open SDK component to choose an explicit result action for Confirm; Cancel leaves it unchanged.' : 'Starts closed. Add an unconnected button and choose Open SDK component to connect its deployed opener.')}</p>}
            </Card>;
        })}
    </section>;
}
