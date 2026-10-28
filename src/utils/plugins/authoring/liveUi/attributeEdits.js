import {encodeHtmlLiteralText} from './htmlLiteralAttributes';
import {sourceNodeRemovalRanges} from './sourceRanges';

export function attributeValueError(value) {
    return typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value) ? 'Use up to 500 characters on one line, without control characters.' : '';
}

export function describeAttributes(files, elements, calls) {
    for (const element of elements) {
        const {node, file, attributes} = calls.get(element.id);
        const attrs = node.arguments[1];
        if (node.callee?.type !== 'MemberExpression' || node.callee.computed || node.callee.property.name !== 'createElement' || !element.structure?.unique || attrs?.type !== 'ObjectExpression' ||
            attrs.properties.some(property => property.type !== 'ObjectProperty' || property.computed)) continue;
        const properties = new Map();
        for (const property of attrs.properties) {
            const name = property.key.name ?? property.key.value;
            if (properties.has(name)) {properties.clear(); break;}
            properties.set(name, property);
        }
        if (attrs.properties.length && !properties.size) continue;
        element.attributeSource = {file, start: attrs.start, end: attrs.end};
        const fields = [['aria-label', 'Accessible label'], ['aria-description', 'Accessible description'], ['title', 'Tooltip']];
        if (['input', 'textarea'].includes(element.tag)) fields.push(['placeholder', 'Placeholder']);
        element.editableAttributes = fields.map(([name, label]) => {
            const property = properties.get(name);
            const managed = name === 'title' && element.tag === 'button' &&
                (attributes['data-fdo-action'] !== undefined || attributes.title === 'Connect an action in the IDE');
            const editable = !managed && (!property || property.value.type === 'StringLiteral');
            return {name, label, present: !!property, editable, value: property?.value.type === 'StringLiteral' ? property.value.value : typeof attributes[name] === 'string' ? attributes[name] : '',
                reason: managed ? 'This tooltip is managed by the click-action connection.' : editable ? '' : 'This attribute is computed. Edit its expression in the IDE.',
                ...(property && editable ? {start: property.value.start, end: property.value.end,
                    removal: sourceNodeRemovalRanges(files[file], attrs.properties, property, attrs.end - 1)} : {})};
        });
    }
}

export function planAttributeEdit(files, element, request) {
    const target = element.attributeSource;
    const field = element.editableAttributes?.find(item => item.name === request.attribute);
    if (!target || !field?.editable) throw new Error('Choose a supported literal attribute on a unique element. Binding identifiers and managed attributes require the IDE.');
    const action = request.action ?? 'set';
    if (!['set', 'remove'].includes(action)) throw new Error('Choose a supported attribute edit action.');
    if (action === 'remove' && !field.present) throw new Error('This attribute is not present.');
    if (action === 'set') {
        const error = attributeValueError(request.value);
        if (error) throw new Error(error);
        if (field.present && field.value === request.value) throw new Error('The attribute value is unchanged.');
    }
    // The installed SDK escapes attribute values when producing HTML. Store the
    // literal text as JSON, not pre-escaped markup (which would escape twice).
    const literal = target.kind === 'html-literal';
    const file = literal && field.present ? field.file || target.file : target.file;
    const quote = literal && field.present ? (field.quote === '"' ? "'" : '"') : target.quote;
    const operations = action === 'remove' ? field.removal.map(range => ({...range, replacement: ''})) :
        literal ? [{start:field.present ? field.start : target.start,end:field.present ? field.end : target.start,
            replacement:(field.present ? '' : ' ') + field.name + '=' + quote + encodeHtmlLiteralText(request.value) + quote}] :
        field.present ? [{start: field.start, end: field.end, replacement: JSON.stringify(request.value)}] :
            [{start: target.start + 1, end: target.start + 1, replacement: JSON.stringify(field.name) + ': ' + JSON.stringify(request.value) + ', '}];
    let source = files[file];
    const patches = operations.sort((a, b) => b.start - a.start).map(operation => {
        const {start, end, replacement} = operation, before = source;
        source = before.slice(0, start) + replacement + before.slice(end);
        return {file, ...operation, before, after: source, removed: before.slice(start, end), added: replacement,
            description: `${action === 'remove' ? 'Remove' : 'Change'} ${element.tag} ${field.name}`, affected: 1};
    });
    return {...patches[0], patches};
}
