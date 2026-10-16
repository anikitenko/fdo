import {sourceNodeRemovalRanges} from './sourceRanges';
import {readManagedAsyncSetup} from './sdkAsyncActions';

// A deliberately narrow adapter for existing declarative frontend click actions.
// Inspect syntax only: never execute renderOnLoad, handlers or module setup.
const nameOf = node => !node.computed && (node.key?.name ?? node.key?.value);
function properties(node) {
    if (node?.type !== 'ObjectExpression') return null;
    const result = new Map();
    for (const property of node.properties) {
        const name = nameOf(property);
        if (!name || !['ObjectProperty', 'ObjectMethod'].includes(property.type) || result.has(name)) return null;
        result.set(name, property);
    }
    return result;
}
function actionContract(ast, plugin) {
    const imports = ast.program.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === '@anikitenko/fdo-sdk' && node.importKind !== 'type')
        .flatMap(node => node.specifiers.filter(spec => spec.type === 'ImportSpecifier' && spec.importKind !== 'type' && spec.imported.name === 'defineRenderOnLoadActions').map(spec => spec.local.name));
    const methods = plugin.body.body.filter(node => node.type === 'ClassMethod' && nameOf(node) === 'renderOnLoad');
    if (methods.length !== 1 || methods[0].kind !== 'method' || methods[0].static || methods[0].async || methods[0].generator || methods[0].params.length || methods[0].body.body.length !== 1) return null;
    const statement = methods[0].body.body[0], call = statement.argument;
    if (statement.type !== 'ReturnStatement' || call?.type !== 'CallExpression' || call.callee.type !== 'Identifier' || !imports.includes(call.callee.name) || call.arguments.length !== 1) return null;
    const options = properties(call.arguments[0]);
    const handlers = properties(options?.get('handlers')?.value), bindings = options?.get('bindings')?.value;
    if (!handlers || bindings?.type !== 'ArrayExpression' || bindings.elements.some(node => node?.type !== 'ObjectExpression')) return null;
    const declared = new Set([...handlers].filter(([, node]) => (node.type === 'ObjectMethod' && node.kind === 'method') || ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.value?.type)).map(([name]) => name));
    const clicks = new Map(), connected = new Map();
    for (const node of bindings.elements) {
        const fields = properties(node);
        if (!fields) return null;
        const event = fields.get('event')?.value, handler = fields.get('handler')?.value, selector = fields.get('selector')?.value;
        if (event?.type !== 'StringLiteral' || selector?.type !== 'StringLiteral') return null;
        if (event.value !== 'click') continue;
        // A broad/class-based selector could already match the new button and
        // attach a second listener. Only disjoint identity selectors are safe.
        if (!/^\[(?:data-role|data-fdo-action)=["'][\w-]+["']]$/.test(selector.value) && !/^#[a-zA-Z][\w-]*$/.test(selector.value)) return null;
        if (handler?.type !== 'StringLiteral' || !declared.has(handler.value)) continue;
        const generated = /^\[data-fdo-action="(visual-action-\d+)"]$/.exec(selector.value);
        if (generated) {
            const entries = connected.get(generated[1]) || [];
            entries.push({handler: handler.value, node, fields}); connected.set(generated[1], entries);
        }
        if ([...fields].some(([key, property]) => !['selector', 'event', 'handler', 'required', 'preventDefault'].includes(key) ||
            (['required', 'preventDefault'].includes(key) && property.value?.type !== 'BooleanLiteral'))) {
            clicks.set(handler.value, {ambiguous: true});
            continue;
        }
        // Conflicting exemplar options require code review rather than guessing.
        const preventDefault = fields.get('preventDefault')?.value.value ?? false;
        const previous = clicks.get(handler.value);
        clicks.set(handler.value, previous && previous.preventDefault !== preventDefault ? {ambiguous: true} : {...previous, name: handler.value, preventDefault});
    }
    // Managed local presets have no context inputs. Keep them reconnectable even
    // after their last binding was disconnected; preserve arbitrary handlers.
    for (const [name, property] of handlers) {
        if (/^visual(?:SetText|Request)\d+$/.test(name) && property.value?.type === 'ArrowFunctionExpression'
            && property.value.params.length === 0 && !clicks.has(name)) clicks.set(name, {name, preventDefault: true});
    }
    const initMethods = plugin.body.body.filter(node=>node.type === 'ClassMethod' && nameOf(node) === 'init');
    const init = initMethods.length === 1 && initMethods[0];
    const registries = ast.program.body.filter(node=>node.type === 'ImportDeclaration' && node.source.value === '@anikitenko/fdo-sdk' && node.importKind !== 'type')
        .flatMap(node=>node.specifiers.filter(spec=>spec.type === 'ImportSpecifier' && spec.imported.name === 'PluginRegistry' && spec.importKind !== 'type').map(spec=>spec.local.name));
    const backendCreation = init && !init.static && !init.async && !init.generator && !init.params.length && init.kind === 'method'
        && options.get('language')?.value.value === 'typescript' ? {initInsert:init.body.start+1, registrations:init.body.body.flatMap(statement=>{
            const call=statement.type === 'ExpressionStatement' && statement.expression;
            return call?.type === 'CallExpression' && call.callee.type === 'MemberExpression' && !call.callee.computed
                && registries.includes(call.callee.object.name) && call.callee.property.name === 'registerHandler'
                && call.arguments.length === 2 && call.arguments[0].type === 'StringLiteral' ? [{handler:call.arguments[0].value}] : [];
        })} : null;
    const setupProperty=options.get('setup'),setupNode=setupProperty?.value;
    const managedAsync=setupProperty && setupProperty.type!=='ObjectProperty' ? null : readManagedAsyncSetup(setupNode);
    return {bindings, connected, comments:ast.comments, handlerNodes: handlers, backendCreation, handlers: [...clicks.values()].filter(item => !item.ambiguous),
        options:call.arguments[0],language:options.get('language')?.value.value,setupProperty,setupNode,managedAsync,
        handlerObject: options.get('handlers').value,
        localCreationAllowed: managedAsync!==null && [...options.keys()].every(key => ['handlers','bindings','strict','language','setup'].includes(key))};
}

export function describeButtonActions(files, elements, calls, ast, plugin) {
    const contract = actionContract(ast, plugin);
    for (const element of elements.filter(item => item.tag === 'button')) {
        const {node, file, attributes} = calls.get(element.id);
        const token = attributes['data-fdo-action'];
        const connected = contract?.connected.get(token);
        const attrs = properties(node.arguments[1]);
        if (connected) {
            const entry = connected[0];
            const uses = elements.filter(item => calls.get(item.id).attributes['data-fdo-action'] === token).length;
            const references = Object.values(files).reduce((count, source) => count + (source.match(/visual-action-\d+/g) || []).filter(value => value === token).length, 0);
            const fields = entry.fields;
            const editable = connected.length === 1 && uses === 1 && references === 2 && element.structure?.unique && attrs &&
                [...attrs.values()].every(property => property.type === 'ObjectProperty') &&
                [...attrs.keys()].every(key => ['type', 'disabled', 'title', 'class', 'className', 'aria-label', 'aria-description', 'data-fdo-action'].includes(key)) &&
                attrs.get('data-fdo-action')?.value.type === 'StringLiteral' && attrs.get('type')?.value.value === 'button' &&
                attrs.get('disabled')?.value.type === 'BooleanLiteral' && attributes.disabled === false &&
                attrs.get('title')?.value.type === 'StringLiteral' && attributes.title === 'Connected action: ' + entry.handler &&
                fields.size === 5 && fields.get('required')?.value.type === 'BooleanLiteral' && fields.get('required').value.value === false &&
                fields.get('preventDefault')?.value.type === 'BooleanLiteral' &&
                [...fields.keys()].every(key => ['selector', 'event', 'handler', 'required', 'preventDefault'].includes(key));
            element.actionConnection = {status: 'connected', handler: entry.handler, editable: !!editable,
                reason: editable ? '' : 'This target or binding is shared, referenced elsewhere or customized. Change its connection in the IDE.'};
            if (editable) Object.assign(element.actionConnection, {file, handlers: contract.handlers,
                disabled: {start: attrs.get('disabled').value.start, end: attrs.get('disabled').value.end},
                title: {start: attrs.get('title').value.start, end: attrs.get('title').value.end},
                markerRemoval: sourceNodeRemovalRanges(files[file], node.arguments[1].properties, attrs.get('data-fdo-action'), node.arguments[1].end - 1),
                bindingRemoval: sourceNodeRemovalRanges(files['/index.ts'], contract.bindings.elements, entry.node, contract.bindings.end - 1),
                handlerRange: {start: fields.get('handler').value.start, end: fields.get('handler').value.end},
                preventRange: {start: fields.get('preventDefault').value.start, end: fields.get('preventDefault').value.end}});
            continue;
        }
        if (!element.structure?.unique || !attrs || [...attrs.values()].some(property => property.type !== 'ObjectProperty') ||
            [...attrs.keys()].some(key => !['type', 'disabled', 'title', 'class', 'className', 'aria-label', 'aria-description'].includes(key)) ||
            attrs.get('type')?.value.type !== 'StringLiteral' || attributes.type !== 'button' ||
            attrs.get('disabled')?.value.type !== 'BooleanLiteral' || attributes.disabled !== true ||
            attrs.get('title')?.value.type !== 'StringLiteral' || attributes.title !== 'Connect an action in the IDE') continue;
        const connection = {status: 'available', file, attrsStart: node.arguments[1].start,
            attrsEnd: node.arguments[1].end, disabled: {start: attrs.get('disabled').value.start, end: attrs.get('disabled').value.end},
            title: {start: attrs.get('title').value.start, end: attrs.get('title').value.end},
            bindingInsert: contract?.bindings.elements.at(-1)?.end ?? contract?.bindings.start + 1,
            bindingPrefix: contract?.bindings.elements.length ? ', ' : '', handlers: contract?.handlers || []};
        if (contract?.localCreationAllowed) element.localActionCreation = {connection,
            handlerInsert: contract.handlerObject.start + 1, backend: contract.backendCreation};
        element.actionConnection = contract?.handlers.length ? connection :
            {status: 'unavailable', reason: 'No reusable static click actions found. Connect an action in the IDE. Supported actions use a direct defineRenderOnLoadActions return with literal handlers and bindings.'};
    }
    return contract;
}

export function planButtonAction(files, element, request) {
    const target = element.actionConnection;
    const disconnect = request.kind === 'disconnect-action';
    const connected = target?.status === 'connected' && target.editable;
    if (disconnect && !connected) throw new Error('This connection requires editing in the IDE. Select an unmodified, unshared Live UI action target.');
    const handler = !disconnect && (target?.status === 'available' || connected) && target.handlers.find(item => item.name === request.handler);
    if (!disconnect && !handler) throw new Error('Choose an existing click action for a new unconnected button or an editable connection. Other connections require the IDE.');
    if (connected && !disconnect && handler.name === target.handler) throw new Error('Choose a different click action.');
    let operations, description;
    if (disconnect) {
        description = 'Disconnect button action';
        operations = [
            {file: target.file, ...target.disabled, replacement: 'true'},
            {file: target.file, ...target.title, replacement: JSON.stringify('Connect an action in the IDE')},
            ...target.markerRemoval.map(range => ({file: target.file, ...range, replacement: ''})),
            ...target.bindingRemoval.map(range => ({file: '/index.ts', ...range, replacement: ''})),
        ];
    } else if (connected) {
        description = 'Change button action to ' + handler.name;
        operations = [
            {file: '/index.ts', ...target.handlerRange, replacement: JSON.stringify(handler.name)},
            {file: '/index.ts', ...target.preventRange, replacement: JSON.stringify(handler.preventDefault)},
            {file: target.file, ...target.title, replacement: JSON.stringify('Connected action: ' + handler.name)},
        ];
    } else {
        description = 'Connect button to ' + handler.name;
        let number = 1;
        const used = new Set(Object.values(files).flatMap(source => source.match(/visual-action-\d+/g) || []));
        while (used.has('visual-action-' + number)) number++;
        const token = 'visual-action-' + number;
        // Other plugin views may omit this optional control.
        const binding = {selector: `[data-fdo-action="${token}"]`, event: 'click', handler: handler.name, preventDefault: handler.preventDefault, required: false};
        operations = [
            {file: target.file, start: target.disabled.start, end: target.disabled.end, replacement: 'false'},
            {file: target.file, start: target.title.start, end: target.title.end, replacement: JSON.stringify('Connected action: ' + handler.name)},
            {file: target.file, start: target.attrsStart + 1, end: target.attrsStart + 1, replacement: JSON.stringify('data-fdo-action') + ': ' + JSON.stringify(token) + ', '},
            {file: '/index.ts', start: target.bindingInsert, end: target.bindingInsert, replacement: target.bindingPrefix + JSON.stringify(binding)},
        ];
    }
    operations.sort((a, b) => a.file.localeCompare(b.file) || b.start - a.start);
    const current = {...files}, patches = [];
    for (const operation of operations) {
        const {file, start, end, replacement} = operation, before = current[file];
        const after = before.slice(0, start) + replacement + before.slice(end);
        const patch = {...operation, before, after, removed: before.slice(start, end), added: replacement,
            description, affected: 1};
        patches.push(patch); current[file] = after;
    }
    return {...patches[0], patches};
}
