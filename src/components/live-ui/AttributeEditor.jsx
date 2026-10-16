import React, {useEffect, useState} from 'react';
import {Button, FormGroup, HTMLSelect, InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {attributeValueError} from '../../utils/plugins/authoring/liveUi/attributeEdits';

export function AttributeEditor({element, disabled, onPropose}) {
    const fields = element.editableAttributes || [];
    const [name, setName] = useState(fields[0]?.name || '');
    const field = fields.find(item => item.name === name) || fields[0];
    const [value, setValue] = useState(field?.value || '');
    useEffect(() => setValue(field?.value || ''), [field]);
    const error = field?.editable ? attributeValueError(value) : '';
    const changed = field?.editable && (!field.present || value !== field.value) && !error;
    const propose = action => onPropose({kind: 'attribute', attribute: field.name, action, value});
    return <EditorSection title="Element attributes" icon="properties" description="Accessible labels, descriptions and hints">
        {field ? <>
            <FormGroup label="Attribute" labelFor="visual-attribute-name"><HTMLSelect id="visual-attribute-name" fill value={field.name} disabled={disabled}
                options={fields.map(item => ({value: item.name, label: item.label + ' · ' + item.name + (!item.editable ? ' · Read-only' : '')}))}
                onChange={event => setName(event.target.value)}/></FormGroup>
            <FormGroup label="Attribute value" labelFor="visual-attribute-value" intent={error ? 'danger' : 'none'}
                helperText={<span id="visual-attribute-help">{field.reason || (field.present ? 'An empty value is kept. Remove attribute deletes the field.' : 'Not set. Enter a value and preview it to add this attribute.')}</span>}>
                <InputGroup id="visual-attribute-value" fill value={value} maxLength={500} disabled={disabled || !field.editable}
                    aria-invalid={!!error} aria-describedby={'visual-attribute-help' + (error ? ' visual-attribute-error' : '')} onValueChange={setValue}
                    onKeyDown={event => {if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && changed && !disabled) {event.preventDefault(); propose('set');}}}/>
                {error && <span id="visual-attribute-error" role="alert">{error}</span>}
            </FormGroup>
            <Button fill icon="eye-open" disabled={disabled || !changed} onClick={() => propose('set')}>Preview attribute</Button>
            <Button fill variant="minimal" icon="delete" disabled={disabled || !field.editable || !field.present} onClick={() => propose('remove')}>Remove attribute</Button>
            <p className="bp6-text-muted">IDs, action targets and event handlers stay in code. Attribute edits share this draft’s Undo/Redo and Apply.</p>
        </> : <p className="bp6-text-muted">Attribute editing needs a unique static SDK call or a source-mapped HTML start tag. Edit shared, transformed or computed attributes in the IDE.</p>}
    </EditorSection>;
}
