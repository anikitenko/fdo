import {parse} from '@babel/parser';
import {sdkComponentCatalog, sdkComponentDefaults} from './sdkComponentCatalog';
import {parseFragment} from 'parse5';

const layoutTags = new Set(['main','section','div','article','aside','header','footer','nav']);

function insertionTargets(html, rootId, elements, calls) {
    const byId = new Map(elements.map(element => [element.id, element]));
    const owner = calls.get(rootId)?.dom;
    const targets = new Set(), queue = [{node: parseFragment(html), inside: false}];
    for (let index = 0; index < queue.length; index++) {
        const {node, inside} = queue[index];
        const id = node.attrs?.find(attr => attr.name === 'data-fdo-ui-id')?.value;
        const element = byId.get(id);
        const overlay = node.attrs?.some(attr => attr.name === 'popover' || attr.name === 'data-fdo-component'
            || attr.name === 'role' && attr.value.toLowerCase().split(/\s+/).some(role => ['dialog','alertdialog'].includes(role)));
        const safe = layoutTags.has(node.tagName) && element?.structure?.unique && !!element.structure.container
            && calls.get(id)?.dom === owner && !overlay;
        const eligible = safe && (id === rootId || inside);
        if (eligible) targets.add(id);
        for (const child of node.childNodes || []) queue.push({node: child, inside: !!eligible});
    }
    return targets;
}

export function describeSdkInsertions(files, elements, calls, html, contract, entries) {
    const catalog = sdkComponentCatalog(contract).filter(item=>item.supported);
    if (!catalog.length) return;
    // A region's authored body is distinct from its runtime queue. Only the
    // published Toast builder is offered here; never insert through generated DOM.
    const toast = catalog.find(item=>item.identity === 'fdo.toast');
    for (const element of elements) {
        const entry = entries.get(calls.get(element.id)?.dom);
        if (toast && element.structure?.unique && !element.sdkComponent?.reason
            && element.sdkComponent?.identity === 'fdo.toast-region'
            && ['@anikitenko/fdo-sdk','@anikitenko/fdo-sdk/ui'].includes(entry)) {
            for (const slot of element.sdkComponent.slots.filter(item=>item.property === 'body' && item.editable)) {
                slot.sdkInsertions = [{...toast,entry}];
            }
        }
    }
    let root = html;
    let previous;
    do {
        previous = root;
        root = root.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
    } while (root !== previous);
    root = root.trim();
    const rootId = /^<main\b[^>]*\bdata-fdo-ui-id="([^"]+)"/i.exec(root)?.[1];
    if (!rootId) return;
    const targets = insertionTargets(html, rootId, elements, calls);
    for (const element of elements) {
        const call = calls.get(element.id);
        // Every rendered ancestor back to main must be an independently editable
        // SDK layout. Never introduce relationships through forms, overlays,
        // opaque literal wrappers, shared calls or dynamic compositions.
        if (!targets.has(element.id) || !['@anikitenko/fdo-sdk','@anikitenko/fdo-sdk/ui'].includes(entries.get(call.dom))) continue;
        element.sdkInsertions = catalog.map(item=>({...item,entry:entries.get(call.dom)}));
    }
}
export function planSdkComponentInsertion(files, element, request) {
    const component = element.sdkInsertions?.find(item=>item.identity === request.component && item.supported);
    const container = element.structure?.container;
    if (!element.structure?.unique || !container || !component) throw new Error('Select a supported SDK layout container under the top-level main to add an SDK component.');
    return insertComponent(files,element.structure.file,component,container,
        (old,call)=>container.missing ? ', ' + call : '(' + old + ') + ' + call);
}

export function planSdkSlotComponentInsertion(files, element, request) {
    const slot=element.sdkComponent?.slots.find(item=>item.name === request.slot && item.editable);
    const component=slot?.sdkInsertions?.find(item=>item.identity === request.component && item.supported);
    if (!element.structure?.unique || element.sdkComponent?.reason || !slot || !component) throw new Error('Select an editable Toast Region body to add a toast.');
    return insertComponent(files,slot.file,component,slot,(old,call)=>slot.insert
        ? JSON.stringify(slot.property) + ': ' + call + ', '
        : '(' + old + ') + ' + call);
}

function insertComponent(files,file,component,container,compose) {
    const before=files[file];
    const occupied = name => Object.values(files).some(source=>new RegExp('(^|[^\\w-])' + name + '(?=$|[^\\w-])').test(source));
    let id='fdo-' + component.identity.slice(4), suffix=2;
    while(occupied(id)) id='fdo-' + component.identity.slice(4) + '-' + suffix++;
    const base='fdo' + component.create[0].toUpperCase() + component.create.slice(1);
    let binding=base; suffix=2;
    while(new RegExp('\\b' + binding + '\\b').test(before)) binding=base + suffix++;
    const options=sdkComponentDefaults(component.identity,id,component.name);
    const call=binding + '(' + container.receiver + ', ' + JSON.stringify(options) + ')';
    const old=before.slice(container.start,container.end);
    const replacement=compose(old,call);
    let after=before.slice(0,container.start) + replacement + before.slice(container.end);
    // Use the DOM receiver's own published SDK entry. A fresh local alias avoids
    // shadowing imports, local bindings, types or helper names in this module.
    const prefix='import {' + component.create + ' as ' + binding + '} from ' + JSON.stringify(component.entry) + ';\n';
    const program=parse(before,{sourceType:'module',plugins:['typescript','jsx']}).program;
    const offset=program.directives.at(-1)?.end ?? program.interpreter?.end ?? (after.charCodeAt(0) === 0xfeff ? 1 : 0);
    after=after.slice(0,offset) + (offset ? '\n' : '') + prefix + after.slice(offset);
    return {file,before,after,start:0,end:before.length,replacement:after,removed:before,added:after,affected:1,
        insertedComponentId:id,description:'Add SDK ' + component.name};
}
