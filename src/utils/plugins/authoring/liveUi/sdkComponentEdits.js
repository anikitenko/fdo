import {describeToastProgress} from './sdkToastProgress';
import {describeSdkCollection,sdkContentSlots} from './sdkCollectionEdits';
import {describeSdkMotion} from './sdkComponentMotion';
import {describeSdkAppearance} from './sdkComponentAppearance';
// Only published composition calls are mapped. Generated internal markup has no
// invented source location; identity, event bindings and controller code stay in code.
const textProperties = new Set(['title', 'description', 'ariaLabel', 'cancelLabel', 'confirmLabel', 'pendingLabel', 'label', 'message', 'dismissLabel', 'successLabel']);
const choices = {variant:['info','success','warning','error'], orientation:['horizontal','vertical']};
export function sdkPropertyValueValid(field, value) {
    if (field.kind === 'boolean') return typeof value === 'boolean';
    if (field.kind === 'number' || field.kind === 'number-or-null') return field.kind === 'number-or-null' && value === null || typeof value === 'number' && Number.isFinite(value);
    if (field.kind === 'enum') return field.choices?.includes(value);
    return typeof value === 'string' && value.length <= 2000 && !/[\r\n\u0000-\u001f]/.test(value);
}
const presets = {
    text: ['p', {}, 'New text'],
    container: ['section', {'aria-label': 'New section'}, ''],
    singleLineInput: ['input', {type:'text','aria-label':'New text input',placeholder:'Enter text'}, ''],
    input: ['textarea', {'aria-label': 'New input', placeholder: 'Enter text'}, ''],
    button: ['button', {type: 'button', disabled: true, title: 'Connect an action in the IDE'}, 'New button'],
    result: ['pre', {role: 'status', 'aria-live': 'polite'}, 'Results appear here'],
};
export function describeSdkComponent(node, file, definition, values, source, files) {
    const options = node.arguments[1];
    const staticOptions = options?.type === 'ObjectExpression' && options.properties.every(property => property.type === 'ObjectProperty' && !property.computed && !property.method);
    const names = staticOptions ? options.properties.map(property => property.key.name ?? property.key.value) : [];
    const writable = staticOptions && new Set(names).size === names.length;
    const fields = writable ? new Map(options.properties.map(property => [property.key.name ?? property.key.value, property.value])) : new Map();
    const target = name => {
        const value = fields.get(name);
        return {file, start: value?.start ?? options?.start + 1, end: value?.end ?? options?.start + 1, insert: !value};
    };
    const properties = (definition.editableProperties || []).filter(item =>
        textProperties.has(item.name) && item.kind === 'text' || ['boolean','number','number-or-null'].includes(item.kind) && !item.name.includes('.') || item.kind === 'enum' && choices[item.name]).map(item => {
        const value = fields.get(item.name);
        const editable = writable && (!value || ['StringLiteral','NumericLiteral','BooleanLiteral','NullLiteral'].includes(value.type));
        return {name:item.name, kind:item.kind, choices:choices[item.name], value:values?.[item.name] ?? (item.kind === 'boolean' ? item.name === 'visible' : item.kind === 'number-or-null' ? null : item.kind === 'number' ? 100 : ''), present:!!value, editable,
            ...target(item.name), reason:editable ? '' : 'Computed or shared options stay in code.'};
    });
    const receiver = node.arguments[0]?.type === 'Identifier' ? node.arguments[0].name : null;
    const slots = (definition.slots || []).filter(item => ['body', 'footer'].includes(item.property)).map(item => ({name: item.name, property: item.property,
        editable: writable && !!receiver, receiver, ...target(item.property)}));
    return {identity: definition.identity, previewStates:['fdo.dialog','fdo.confirmation-dialog','fdo.popover','fdo.tabs','fdo.toast-region'].includes(definition.identity) ? [] : (definition.states || []).filter(state=>state !== 'destroyed'), instanceId: typeof values?.id === 'string' ? values.id : null, instanceIdLiteral: fields.get('id')?.type === 'StringLiteral', name: definition.name, properties, slots, appearance: describeSdkAppearance(node, file, definition), motion: describeSdkMotion(node, file, definition, values),
        toastProgress:describeToastProgress(node,file,definition,values,source,files),
        collection:describeSdkCollection(node,file,definition,values,source,files),
        reason: writable ? '' : 'Use a literal, unshared options object to edit this SDK component visually. IDs, ARIA references, classes and handlers stay in code.'};
}
export function planSdkComponentEdit(files, element, request) {
    const component = element.sdkComponent;
    if (!element.structure?.unique || !component || component.reason) throw new Error(component?.reason || 'Select a unique SDK component call.');
    let target, expression, name;
    if (request.kind === 'component-property') {
        target = component.properties.find(item => item.name === request.property && item.editable);
        if (!target || !sdkPropertyValueValid(target, request.value)) throw new Error('Choose an editable SDK property and a valid value for its declared type.');
        expression = JSON.stringify(request.value); // SDK escapes text exactly once.
        name = target.name;
    } else {
        target = sdkContentSlots(component).find(item => item.name === request.slot && item.editable);
        if (!target || !Object.hasOwn(presets, request.component)) throw new Error('Choose an editable body/footer slot and a supported component.');
        name = target.property;
        expression = target.receiver + '.createElement(' + presets[request.component].map(arg => JSON.stringify(arg)).join(', ') + ')';
        if (!target.insert) expression = '(' + files[target.file].slice(target.start, target.end) + ') + ' + expression;
    }
    return {...target, replacement: target.insert ? JSON.stringify(name) + ': ' + expression + ', ' : expression,
        description: (request.kind === 'component-slot' ? 'Add ' + request.component + ' to ' : 'Change ') + component.name + ' ' + name, affected: 1};
}
