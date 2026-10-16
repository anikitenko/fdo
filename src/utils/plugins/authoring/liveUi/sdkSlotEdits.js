import {sdkContentSlots} from './sdkCollectionEdits';
import {inlineMoveDependencies} from './moveDependencies';
// Slots contain authored fragments, never the SDK's generated controls. Ranges
// are derived from the current restricted interpreter, not supplied by the UI.
const flatten = node => node?.type === 'BinaryExpression' && node.operator === '+' ? [...flatten(node.left), ...flatten(node.right)] : node ? [node] : [];
export function describeSdkSlots(elements, calls, evaluated) {
    for (const element of elements) {
        if (!element.sdkComponent) continue;
        const owner = calls.get(element.id);
        for (const slot of sdkContentSlots(element.sdkComponent)) {
            const options = owner.node.arguments[1];
            const collection=slot.itemKey && options?.properties?.find(item=>!item.computed && (item.key?.name ?? item.key?.value)==='items')?.value;
            const item=collection?.type==='ArrayExpression' && collection.elements.find(row=>row?.type==='ObjectExpression' && row.properties.some(field=>!field.computed && (field.key?.name ?? field.key?.value)==='key' && field.value?.type==='StringLiteral' && field.value.value===slot.itemKey));
            const container=slot.itemKey ? item : options;
            const expression = container?.type === 'ObjectExpression' ? container.properties.find(item => !item.computed && (item.key?.name ?? item.key?.value) === slot.property)?.value : null;
            slot.children = flatten(expression).filter(node => evaluated.get(node) !== '').map(node => {
                const value = evaluated.get(node);
                const child = typeof value === 'string' && elements.find(item => value === evaluated.get(calls.get(item.id)?.node) && item.structure.unique);
                const call = child && calls.get(child.id);
                const inline = node === call?.node && node.callee?.type === 'MemberExpression' && node.callee.property.name === 'createElement' && call.dom === owner.dom && !!inlineMoveDependencies(node, call, evaluated);
                const movable = !!child && (inline || node.type === 'Identifier');
                return {start: node.start, end: node.end, id: child?.id, label: child?.label || 'Custom content · edit in IDE', movable,
                    removable: !!inline && !!child.structure.removable,
                    duplicable: !!inline && !!child.structure.removable,
                    transferable: movable && (node.type === 'Identifier' || call.scope === owner.scope),
                    transferReason: movable && node.type !== 'Identifier' && call.scope !== owner.scope ? 'This composition has a different evaluation scope. Move it in the IDE.' : '',
                    reason: !movable ? 'Shared or custom content stays in code.' : !inline ? 'Remove this named fragment in the IDE to update its declaration.' : child.structure.removable ? '' : child.structure.reason};
            });
        }
    }
}
export function planSdkSlotEdit(files, element, request) {
    const component = element.sdkComponent;
    const slot = sdkContentSlots(component).find(item => item.name === request.slot);
    const children = slot?.children || [];
    const index = children.findIndex(item => item.id && item.id === request.childId);
    if (!element.structure?.unique || component?.reason || !slot?.editable || index < 0) throw new Error('Choose a current, unique content block in an editable SDK slot.');
    const child = children[index];
    const source = files[slot.file];
    let start = child.start, end = child.end, replacement, description;
    if (request.action === 'remove') {
        if (!child.removable) throw new Error(child.reason || 'This child cannot be removed visually.');
        replacement = '""'; // Keep surrounding parentheses, comments and concatenation.
        description = 'Remove content from ' + component.name + ' ' + slot.name;
    } else if (request.action === 'duplicate') {
        if (!child.duplicable) throw new Error(child.reason || 'Only safe inline content without identities or action bindings can be duplicated.');
        const original = source.slice(child.start, child.end);
        replacement = '(' + original + ') + (' + original + ')';
        description = 'Duplicate content in ' + component.name + ' ' + slot.name;
    } else if (request.action === 'transfer') {
        const destination = sdkContentSlots(component).find(item => item.name === request.destinationSlot && item.name !== slot.name && item.editable);
        if (!child.transferable || !destination || destination.file !== slot.file) throw new Error('Choose a different editable destination slot or item in the same SDK component.');
        const moving = source.slice(child.start, child.end);
        const insertion = destination.insert ? JSON.stringify(destination.property) + ': ' + moving + ', ' : '(' + source.slice(destination.start, destination.end) + ') + ' + moving;
        const edits = [{start: child.start, end: child.end, value: '""'}, {start: destination.start, end: destination.end, value: insertion}];
        start = Math.min(...edits.map(item => item.start)); end = Math.max(...edits.map(item => item.end));
        replacement = source.slice(start, end);
        for (const edit of edits.sort((a, b) => b.start - a.start)) replacement = replacement.slice(0, edit.start - start) + edit.value + replacement.slice(edit.end - start);
        description = 'Move content to ' + component.name + ' ' + destination.name;
    } else {
        const offset = request.action === 'up' ? -1 : request.action === 'down' ? 1 : 0;
        const destinationIndex = request.action === 'position' ? request.index : index + offset;
        if ((!offset && request.action !== 'position') || !Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= children.length || destinationIndex === index) throw new Error('Choose a different position within this slot.');
        const first = Math.min(index, destinationIndex), last = Math.max(index, destinationIndex);
        const slots = children.slice(first, last + 1);
        if (slots.some(item => !item.movable)) throw new Error('Custom or shared fragments cannot be crossed. Choose a position among adjacent source-mapped children.');
        const ordered = [...slots];
        const [moving] = ordered.splice(index - first, 1);
        ordered.splice(destinationIndex - first, 0, moving);
        start = slots[0].start; end = slots.at(-1).end;
        replacement = ordered.map((item, position) => source.slice(item.start, item.end) + (position < slots.length - 1 ? source.slice(slots[position].end, slots[position + 1].start) : '')).join('');
        description = 'Move content to position ' + (destinationIndex + 1) + ' in ' + component.name + ' ' + slot.name;
    }
    const after = source.slice(0, start) + replacement + source.slice(end);
    return {file: slot.file, before: source, after, start, end, replacement, removed: source.slice(start, end), added: replacement, description, affected: 1};
}
