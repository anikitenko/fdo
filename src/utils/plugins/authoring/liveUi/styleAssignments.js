// Assign an existing stylesheet class through the same SDK DOM instance that
// creates the element. Keep CSS as CSS; never manufacture generated class hashes.
export function describeStyleAssignments(elements, calls, renderedDomInstances) {
    for (const element of elements) {
        const {node, file, styleOptions = [], styleSheets = [], dom} = calls.get(element.id);
        element.availableStyles = styleOptions;
        element.styleSheets = styleSheets;
        if (element.sdkComponent) continue;
        const attrs = node.arguments[1];
        if (!renderedDomInstances.get(dom)?.has(element.id) || !element.structure?.unique || node.callee.object.type !== 'Identifier' || attrs?.type !== 'ObjectExpression' ||
            attrs.properties.some(property => property.type !== 'ObjectProperty' || property.computed)) continue;
        const properties = attrs.properties.filter(property => ['class', 'className'].includes(property.key.name ?? property.key.value));
        if (properties.length > 1) continue;
        const value = properties[0]?.value;
        element.styleAssignment = {file, receiver: node.callee.object.name,
            start: value?.start ?? attrs.start + 1, end: value?.end ?? attrs.start + 1, insert: !value};
    }
}

export function planStyleAssignment(files, elements, element, request) {
    const target = element.styleAssignment;
    const style = element.availableStyles?.find(item => item.file === request.styleFile && item.key === request.styleKey);
    if (!target || !style) throw new Error('Choose an existing stylesheet class on an element with static, unshared attributes. Use the IDE for computed attributes.');
    const base = `${target.receiver}.createClassFromStyle(${style.binding}[${JSON.stringify(style.key)}])`;
    const expression = element.classNameAssignment?.value ? `(${base}) + ${JSON.stringify(" "+element.classNameAssignment.value)}` : base;
    return {...target, replacement: target.insert ? `"class": ${expression}, ` : expression,
        description: `Assign .${style.key} to ${element.tag}`,
        affected: elements.filter(item => item.styleAssignment?.file === target.file && item.styleAssignment.start === target.start).length};
}

export function classNamesError(value) {
    if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return 'Use up to 500 characters on one line.';
    if (value.trim().split(/\s+/).filter(Boolean).some(name=>name.length > 80 || !/^-?[_a-zA-Z-][a-zA-Z0-9_-]*$/.test(name))) return 'Enter class names separated by spaces, without dots or CSS selectors; for example pure-button pure-button-primary.';
    return '';
}

export function describeClassNames(files,elements,calls) {
    for (const element of elements) {
        const target=element.styleAssignment,call=calls.get(element.id);
        if (!target) continue;
        const fields=call.node.arguments[1].properties.filter(item=>['class','className'].includes(item.key.name ?? item.key.value));
        const node=fields[0]?.value;
        const actual=call.attributes.class ?? call.attributes.className;
        if (node && typeof actual !== 'string') continue;
        let value='',base=node ? files[target.file].slice(node.start,node.end) : '';
        if (node?.type === 'StringLiteral') {value=node.value;base='';}
        else if (node?.type === 'BinaryExpression' && node.operator === '+' && node.right.type === 'StringLiteral'
            && node.right.value.startsWith(' ') && !classNamesError(node.right.value.trim())) {
            value=node.right.value.trim();base=files[target.file].slice(node.left.start,node.left.end);
        }
        element.classNameAssignment={...target,value,base};
    }
}

export function planClassNames(files,element,request) {
    const target=element.classNameAssignment,error=classNamesError(request.value);
    if (!target) throw new Error('Select a unique SDK element with static attributes and a string class expression.');
    if (error) throw new Error(error);
    const value=[...new Set(request.value.trim().split(/\s+/).filter(Boolean))].join(' ');
    const expression=target.base ? value ? `(${target.base}) + ${JSON.stringify(' '+value)}` : target.base : JSON.stringify(value);
    return {...target,replacement:target.insert ? '"class": '+expression+', ' : expression,description:'Assign class names',affected:1};
}
