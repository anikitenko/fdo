import {parse, parseExpression} from '@babel/parser';
import {isNodesEquivalent} from '@babel/types';
import traverseModule from '@babel/traverse';
import {parseFragment} from 'parse5';
import {describeBackendPreset} from './backendActions';
import {planButtonAction} from './actionBindings';

const markerName = 'data-fdo-result';
const markerPattern = /^visual-result-\d+$/;
const inputMarkerPattern = /^visual-input-\d+$/;
const resultTags = new Set(['p','pre','span','output']);
const resultAttributes = new Set(['class','className','style','role','aria-label','aria-description','aria-live','title',markerName]);
const escapeUnsafeChars = value => value.replace(/[<>\/\u2028\u2029]/g, char => ({
    '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\u2028': '\\u2028', '\u2029': '\\u2029'
})[char]);
const literalFields = node => {
    if (node?.type !== 'ObjectExpression' || node.properties.some(p => p.type !== 'ObjectProperty' || p.computed)) return null;
    const entries = node.properties.map(p => [p.key.name ?? p.key.value,p]);
    return new Set(entries.map(([name]) => name)).size === entries.length ? new Map(entries) : null;
};

function markerCounts(files, html) {
    const source = new Map(), rendered = new Map();
    const add = (map,value) => {if (typeof value === 'string' && /^visual-(?:result|input)-\d+$/.test(value)) map.set(value,(map.get(value) || 0)+1);};
    const traverse = traverseModule.default || traverseModule;
    for (const [path,content] of Object.entries(files)) {
        if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
        try {
            traverse(parse(content,{sourceType:'module',plugins:['typescript','jsx']}),{
                StringLiteral: node => {if(node.parent?.type==='ObjectProperty' && !node.parent.computed && (node.parent.key.name ?? node.parent.key.value)==='data-fdo-ui-confirm-text') return;add(source,node.node.value);},
                TemplateLiteral: node => {if (!node.node.expressions.length) add(source,node.node.quasis[0].value.cooked);},
            });
        } catch { /* Workspace validation owns invalid modules. */ }
    }
    const queue = [parseFragment(html)];
    for (let i=0;i<queue.length;i++) {
        add(rendered,queue[i].attrs?.find(attr=>attr.name === markerName)?.value);
        add(rendered,queue[i].attrs?.find(attr=>attr.name === 'data-fdo-input')?.value);
        queue.push(...(queue[i].childNodes || []));
    }
    return {source,rendered};
}

// Recognize the complete preset syntax, never execute or infer arbitrary code.
export function simulationPreset(node) {
    const statements = node?.body?.body;
    const selector = statements?.[0]?.declarations?.[0]?.init?.arguments?.[0];
    const text = statements?.[1]?.consequent?.expression?.right;
    if (selector?.type !== 'StringLiteral' || text?.type !== 'StringLiteral' || text.value.length > 2000) return null;
    const match = /^\[data-fdo-result="(visual-result-\d+)"]$/.exec(selector.value);
    if (!match) return null;
    const expected = parseExpression(`() => { const target = document.querySelector(${escapeUnsafeChars(JSON.stringify(selector.value))}); if (target) target.textContent = ${escapeUnsafeChars(JSON.stringify(text.value))}; }`);
    return isNodesEquivalent(node,expected) ? {marker:match[1],text:text.value} : null;
}

export function describeLocalActions(files,elements,calls,html,actions) {
    if (!elements.some(element=>element.localActionCreation || element.actionConnection?.editable || element.asyncAction?.editable || calls.get(element.id)?.attributes['data-fdo-ui-confirm-selector'])) return;
    const counts = markerCounts(files,html);
    const targets = elements.flatMap(element => {
        const call = calls.get(element.id), fields = call && literalFields(call.node.arguments[1]);
        if (!resultTags.has(element.tag) || !element.structure?.unique || !element.text || !fields
            || [...fields.keys()].some(name=>!resultAttributes.has(name))
            || call.attributes.role && !['status','alert','note','presentation','none'].includes(call.attributes.role)) return [];
        const marker = call.attributes[markerName];
        if (fields.has(markerName) && (fields.get(markerName).value.type !== 'StringLiteral' || !markerPattern.test(marker)
            || counts.source.get(marker) !== 1 || counts.rendered.get(marker) !== 1)) return [];
        return [{id:element.id,label:element.label,file:call.file,line:element.location.line,
            marker:marker || '',insert:call.node.arguments[1].start+1}];
    });
    const inputAttributes = new Set(['class','className','style','aria-label','aria-description','placeholder','title','type','value','rows','cols','maxlength','maxLength','minlength','minLength','wrap','disabled','readonly','readOnly','data-fdo-input']);
    const inputs = elements.flatMap(element=>{
        const call = calls.get(element.id), fields = call && literalFields(call.node.arguments[1]);
        if (!['textarea','input'].includes(element.tag) || !element.structure?.unique || !fields
            || [...fields.keys()].some(name=>!inputAttributes.has(name))
            || call.attributes.disabled || call.attributes.readonly || call.attributes.readOnly) return [];
        if (element.tag === 'input' && (fields.has('type') && fields.get('type').value.type !== 'StringLiteral'
            || !['text','search'].includes(call.attributes.type || 'text'))) return [];
        const marker = call.attributes['data-fdo-input'];
        if (fields.has('data-fdo-input') && (fields.get('data-fdo-input').value.type !== 'StringLiteral' || !inputMarkerPattern.test(marker)
            || counts.source.get(marker) !== 1 || counts.rendered.get(marker) !== 1)) return [];
        return [{id:element.id,label:element.tag+' · '+String(call.attributes['aria-label'] || call.attributes.placeholder || 'Text input'),file:call.file,line:element.location.line,tag:element.tag,
            text:String(call.attributes.value ?? element.text?.value ?? '').slice(0,2000),marker:marker || '',insert:call.node.arguments[1].start+1}];
    });
    for (const element of elements) {
        if(element.asyncAction?.editable) {
            element.asyncAction.targets=targets;element.asyncAction.inputs=inputs;
            const row=element.asyncAction.row,target=targets.find(item=>item.marker===row?.marker);
            const input=row?.inputMarker && inputs.find(item=>item.marker===row.inputMarker && item.tag===row.inputTag);
            if(target && (!row.inputMarker || input)) element.localActionSimulation=row.backend
                ? {kind:'backend-request',targetId:target.id,handler:row.backend,preset:row.preset,display:row.display,text:input ? input.text : row.text,...(input ? {inputId:input.id,inputLabel:input.label} : {})}
                : {kind:'set-text',targetId:target.id,text:row.text};
        }
        if (element.localActionCreation) {element.localActionCreation.targets = targets;element.localActionCreation.inputs = inputs;}
        if (!actions?.localCreationAllowed || element.actionConnection?.status !== 'connected' || !element.actionConnection.editable) continue;
        const preset = simulationPreset(actions.handlerNodes.get(element.actionConnection.handler)?.value);
        const target = preset && targets.find(item=>item.marker === preset.marker);
        if (target) element.localActionSimulation = {kind:'set-text',targetId:target.id,text:preset.text};
        const backend = describeBackendPreset(actions.handlerNodes.get(element.actionConnection.handler)?.value,actions);
        const backendTarget = backend && targets.find(item=>item.marker === backend.marker);
        const input = backend?.inputMarker && inputs.find(item=>item.marker === backend.inputMarker && item.tag === backend.inputTag);
        const outputs=backend?.outputs?.map(output=>({target:targets.find(item=>item.marker===output.marker),display:output.display})) || [];
        if (backendTarget && (!backend.inputMarker || input) && outputs.every(output=>output.target)) {
            element.localActionSimulation = {kind:'backend-request',targetId:backendTarget.id,handler:backend.handler,
                text:input ? input.text : backend.text,...(outputs.length ? {outputs:outputs.map(output=>({targetId:output.target.id,display:output.display}))} : {}),...(backend.preset ? {preset:backend.preset} : {}),...(backend.display ? {display:backend.display} : {}),...(input ? {inputId:input.id,inputLabel:input.label} : {})};
            const callback=actions.handlerNodes.get(element.actionConnection.handler).value;
            const selector=callback.body.body[0].declarations[0].init.arguments[0];
            const expression=callback.body.body[4].block.body.find(statement=>statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression' && statement.expression.left.object?.name === 'target' && statement.expression.left.property?.name === 'textContent').expression.right;
            element.backendResultMapping={file:'/index.ts',callback:{start:callback.start,end:callback.end},comments:(actions.comments || []).filter(comment=>comment.start>callback.start && comment.end<callback.end).map(comment=>files['/index.ts'].slice(comment.start,comment.end)),...(outputs.length ? {outputs:outputs.map(output=>({targetId:output.target.id,display:output.display}))} : {}),selector:{start:selector.start,end:selector.end},expression:{start:expression.start,end:expression.end},config:backend,targets,targetId:backendTarget.id,display:backend.display || 'json'};
        }
    }
    return {targets,inputs};
}

export function planLocalAction(files,element,request) {
    const creation = element.localActionCreation;
    const target = creation?.targets.find(item=>item.id === request.targetId);
    if (!creation || !element.structure?.unique || !target) throw new Error('Select an unconnected Live UI button and a unique supported SDK text/result element. Custom setup or wiring stays in the IDE.');
    if (typeof request.text !== 'string' || request.text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(request.text)) throw new Error('Use up to 2,000 characters of plain result text.');
    const occupied = Object.values(files).join('\n');
    let number = 1;
    while (occupied.includes('visualSetText'+number)) number++;
    const name = 'visualSetText'+number;
    number = 1;
    while (occupied.includes('visual-result-'+number)) number++;
    const marker = target.marker || 'visual-result-'+number;
    const selector = `[${markerName}="${marker}"]`;
    const safeSelectorLiteral = escapeUnsafeChars(JSON.stringify(selector));
    const safeTextLiteral = escapeUnsafeChars(JSON.stringify(request.text));
    // No backend closure, tool execution or interpolation. The deployed handler
    // writes textContent, including for strings that resemble HTML or code.
    const handler = `${JSON.stringify(name)}: () => { const target = document.querySelector(${safeSelectorLiteral}); if (target) target.textContent = ${safeTextLiteral}; }, `;
    const connection = planButtonAction(files,{...element,actionConnection:{...creation.connection,handlers:[{name,preventDefault:true}]}},{kind:'connect-action',handler:name});
    const operations = connection.patches.map(({file,start,end,replacement})=>({file,start,end,replacement}));
    operations.push({file:'/index.ts',start:creation.handlerInsert,end:creation.handlerInsert,replacement:handler});
    if (!target.marker) operations.push({file:target.file,start:target.insert,end:target.insert,replacement:JSON.stringify(markerName)+': '+JSON.stringify(marker)+', '});
    operations.sort((a,b)=>a.file.localeCompare(b.file) || b.start-a.start);
    const current = {...files}, patches = [];
    for (const operation of operations) {
        const {file,start,end,replacement} = operation, before = current[file];
        const after = before.slice(0,start)+replacement+before.slice(end);
        patches.push({...operation,before,after,removed:before.slice(start,end),added:replacement,description:'Create local Set result text action',affected:1});
        current[file] = after;
    }
    return {...patches[0],patches};
}
