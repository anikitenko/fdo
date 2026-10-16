import nodePath from 'node:path';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {isNodesEquivalent} from '@babel/types';
import {simulationPreset} from './localActions';
import {describeBackendPreset,backendDeclarations} from './backendActions';
import {planButtonAction} from './actionBindings';
import {sourceNodeRemovalRanges} from './sourceRanges';
import {planSdkAsyncAction} from './sdkAsyncActions';

const parseModule=source=>parse(source,{sourceType:'module',plugins:['typescript','jsx']});
const range=node=>({file:'/index.ts',start:node.start,end:node.end,replacement:''});
const field=(node,name)=>node?.properties?.find(item=>!item.computed && (item.key?.name ?? item.key?.value)===name)?.value;

export function describeActionCatalog(files,elements,actions,ast,plugin) {
    if(!actions?.localCreationAllowed || ![...actions.handlerNodes.keys()].some(name=>/^visual(?:SetText|Request)\d+$/.test(name))) return [];
    const modules=new Map();let readable=true;
    for(const [file,source] of Object.entries(files)) if(/\.[cm]?[jt]sx?$/.test(file)) {
        try {modules.set(file,file==='/index.ts' ? ast : parseModule(source));} catch {readable=false;}
    }
    const catalog=[];
    for(const [name,property] of actions.handlerNodes) {
        if(!/^visual(?:SetText|Request)\d+$/.test(name)) continue;
        const local=simulationPreset(property.value),backend=describeBackendPreset(property.value,actions);
        const bindings=actions.bindings.elements.filter(node=>field(node,'handler')?.value===name);
        const connected=elements.filter(element=>element.actionConnection?.status==='connected' && element.actionConnection.handler===name);
        let reason=!local && !backend ? 'This callback has changed. Review and remove it in the IDE.' : !readable ? 'Some workspace modules cannot be inspected. Resolve their syntax before removing actions.' : '';
        if(bindings.length > 1) reason='This action is used by multiple controls. Disconnect the extra controls before removing it.';
        else if(bindings.length && (connected.length!==1 || !connected[0].actionConnection.editable)) reason='This binding is customized or shared. Disconnect it in the IDE first.';
        let operations=sourceNodeRemovalRanges(files['/index.ts'],actions.handlerObject.properties,property,actions.handlerObject.end-1).map(item=>({...item,file:'/index.ts',replacement:''}));
        const owned=[range(property),...bindings.map(range)];
        const names=new Set([name]);
        if(backend && !reason) {
            const number=/\d+$/.exec(backend.handler)[0],json=backend.preset==='inspect-json';
            const input=(json?'VisualJsonInput':'VisualTextInput')+number,result=(json?'VisualJsonResult':'VisualTextResult')+number;
            const implementation=(json?'handleVisualJson':'handleVisualText')+number,registry='VisualPluginRegistry'+number;
            [input,result,implementation,registry,backend.handler].forEach(value=>names.add(value));
            const expected=parseModule(backendDeclarations(backend.preset || 'text',input,result,implementation));
            const declarations=expected.program.body.map(node=>ast.program.body.filter(item=>item.declaration?.id?.name===node.declaration.id.name));
            const importExpected=parseModule(`import {PluginRegistry as ${registry}} from '@anikitenko/fdo-sdk';`).program.body[0];
            const imports=ast.program.body.filter(node=>isNodesEquivalent(node,importExpected));
            const registrationExpected=parseModule(`${registry}.registerHandler(${JSON.stringify(backend.handler)}, ${implementation});`).program.body[0];
            const init=plugin.body.body.find(node=>node.type==='ClassMethod' && node.key.name==='init');
            const registrations=init?.body.body.filter(node=>isNodesEquivalent(node,registrationExpected)) || [];
            if(imports.length!==1 || registrations.length!==1 || declarations.some((list,index)=>list.length!==1 || !isNodesEquivalent(list[0],expected.program.body[index]))) reason='Generated backend code or its contract has changed. Review cleanup in the IDE.';
            else {
                const nodes=[imports[0],registrations[0],...declarations.map(list=>list[0])];
                nodes.forEach(node=>{operations.push(range(node));owned.push(range(node));});
                const first=declarations[0][0],comment=expected.program.body[0].leadingComments?.[0];
                const original=first.leadingComments?.find(item=>item.value===comment?.value);
                if(original) operations.push(range(original));
            }
        }
        if(!reason) {
            const traverse=traverseModule.default || traverseModule;
            let referenced=false;
            for(const [file,module] of modules) traverse(module,{enter(path){
                const node=path.node;
                const value=node.type==='Identifier' ? node.name : node.type==='StringLiteral' ? node.value : node.type==='TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;
                if(backend && (node.type==='ExportAllDeclaration' || node.type==='ImportDeclaration' && node.specifiers.some(spec=>spec.type==='ImportNamespaceSpecifier')) && node.source?.value.startsWith('.')) {
                    const resolved=nodePath.posix.resolve(nodePath.posix.dirname(file),node.source.value);
                    if(['/index','/index.ts','/index.tsx'].includes(resolved)) referenced=true;
                }
                if(names.has(value) && !owned.some(item=>item.file===file && node.start>=item.start && node.end<=item.end)) referenced=true;
            }});
            if(referenced) reason='This action or backend contract is referenced elsewhere. Remove those references in the IDE first.';
        }
        // Release unused managed identities, so removing the last action also
        // unlocks input kind editing. Other actions/custom selectors retain them.
        if(!reason) {
            const markers=[local?.marker,backend?.marker,backend?.inputMarker,...(backend?.outputs || []).map(output=>output.marker)].filter(Boolean);
            const traverse=traverseModule.default || traverseModule;
            for(const marker of markers) {
                const key=marker.startsWith('visual-input-') ? 'data-fdo-input' : 'data-fdo-result';
                const attributes=[];
                for(const [file,module] of modules) traverse(module,{ObjectProperty(path){
                    if(!path.node.computed && (path.node.key.name ?? path.node.key.value)===key && path.node.value.type==='StringLiteral' && path.node.value.value===marker && path.parent.type==='ObjectExpression') attributes.push({file,node:path.node,parent:path.parent});
                }});
                if(attributes.length!==1) continue;
                const attribute=attributes[0];let referenced=false;
                for(const [file,module] of modules) traverse(module,{enter(path){
                    const node=path.node;
                    const value=node.type==='StringLiteral' ? node.value : node.type==='TemplateLiteral' ? node.quasis.map(part=>part.value.cooked || '').join('') : null;
                    if(value == null || owned.some(item=>item.file===file && node.start>=item.start && node.end<=item.end) || file===attribute.file && node.start>=attribute.node.start && node.end<=attribute.node.end) return;
                    if(path.key==='key' && path.parent.type==='ObjectProperty') return;
                    if(new RegExp(marker+'(?![0-9])').test(value) || value.includes(key) && !/visual-(?:input|result)-\d+/.test(value)) referenced=true;
                }});
                if(!referenced) operations.push(...sourceNodeRemovalRanges(files[attribute.file],attribute.parent.properties,attribute.node,attribute.parent.end-1).map(item=>({...item,file:attribute.file,replacement:''})));
            }
        }
        catalog.push({name,kind:backend ? backend.preset==='inspect-json' ? 'JSON backend' : 'Text backend' : 'Local action',uses:bindings.length,removable:!reason,reason,operations:reason ? [] : operations,buttonId:connected[0]?.id});
    }
    return catalog;
}

export function planRemoveAction(files,elements,catalog,request) {
    const action=catalog.find(item=>item.name===request.actionName);
    if(!action?.removable) throw new Error(action?.reason || 'Select a removable generated action.');
    if(['SDK async text','SDK async backend'].includes(action.kind)) return planSdkAsyncAction(files,elements.find(item=>item.id===action.buttonId),{kind:'disconnect-sdk-async-action'});
    const operations=[...action.operations];
    if(action.uses) {
        const element=elements.find(item=>item.id===action.buttonId);
        const disconnected=planButtonAction(files,element,{kind:'disconnect-action'});
        operations.push(...disconnected.patches.map(({file,start,end,replacement})=>({file,start,end,replacement})));
    }
    operations.sort((a,b)=>a.file.localeCompare(b.file) || b.start-a.start);
    const current={...files},patches=[];
    for(const operation of operations) {
        const {file,start,end,replacement}=operation,before=current[file],after=before.slice(0,start)+replacement+before.slice(end);
        patches.push({...operation,before,after,removed:before.slice(start,end),added:replacement,description:'Remove generated action '+action.name,affected:1});current[file]=after;
    }
    return {...patches[0],patches};
}
