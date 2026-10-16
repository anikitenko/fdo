import {asyncBackendCreation,asyncBackendCleanup} from './sdkAsyncBackend';
import {validResultDisplay} from './responseMappings';
import {parseExpression} from '@babel/parser';
import {isNodesEquivalent} from '@babel/types';
import {sourceNodeRemovalRanges} from './sourceRanges';

const safeId=value=>typeof value==='string' && /^[A-Za-z][\w-]{0,120}$/.test(value);
function validRow(row) {
    if(!row || !safeId(row.id) || !/^visual-result-\d+$/.test(row.marker) || typeof row.text!=='string'
        || row.text.length>2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row.text)) return false;
    const keys=Object.keys(row).sort().join(',');
    if(keys==='id,marker,text') return true;
    return keys==='backend,display,id,inputMarker,inputTag,marker,preset,text'
        && /^visualAsync(?:Text|Json)Backend\d+$/.test(row.backend)
        && ['text','inspect-json'].includes(row.preset)
        && row.backend.includes('Json') === (row.preset==='inspect-json')
        && validResultDisplay(row.display,row.preset)
        && (row.inputMarker==='' && row.inputTag==='' || /^visual-input-\d+$/.test(row.inputMarker) && ['input','textarea'].includes(row.inputTag));
}
// Self-contained frontend setup. The SDK owns pending/success/error states,
// duplicate protection and AbortSignal delivery; the host view owns disposal.
export function asyncActionSetupSource(rows) {
    const backend=rows.some(row=>row.backend);
    const configs=rows.map(({id,marker,text,...rest})=>({id,selector:`[data-fdo-result="${marker}"]`,text,...(rest.backend ? {...rest,inputMarker:undefined,inputSelector:rest.inputMarker ? `[data-fdo-input="${rest.inputMarker}"]` : ''} : {})}));
    return `async () => {
        const actions${backend ? ': Array<{id: string; selector: string; text: string; backend?: string; preset?: string; display?: string; inputSelector?: string; inputTag?: string}>' : ''} = ${JSON.stringify(configs)};
        const ui = await window.loadFdoUi();
        const controllers: Array<{destroy(): void}> = [];
        try {
            for (const action of actions) {
                const root = document.getElementById(action.id);
                if (!root) continue;
                const target = document.querySelector(action.selector);
                if (!target) throw new Error('The bound result element is unavailable.');
                controllers.push(ui.mountAsyncActionButton(root, {onAction: async ({signal}) => {
                    if (signal.aborted) return;
                    ${backend ? `if (action.backend) {
                        let text = action.text;
                        if (action.inputSelector) {
                            const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(action.inputSelector);
                            if (!input || input.disabled || input.readOnly || (input instanceof HTMLInputElement && !['text', 'search'].includes(input.type))) throw new Error('The bound text input is unavailable.');
                            text = input.value;
                        }
                        if (text.length > 2000) throw new Error('Text must contain at most 2,000 characters.');
                        const response = await window.createBackendReq('UI_MESSAGE', {handler: action.backend, content: {text}});
                        if (signal.aborted) return;
                        const result = response?.result ?? response;
                        if (response?.ok === false || response?.success === false || !result || result.success !== true) throw new Error(String(result?.error || response?.error || 'Invalid backend response.'));
                        if (action.preset === 'inspect-json') {
                            if (typeof result.summary !== 'string' || !['object','array','null','string','number','boolean'].includes(result.valueType) || !Number.isInteger(result.itemCount) || result.itemCount < 0 || !Array.isArray(result.topLevelKeys) || result.topLevelKeys.some((key: unknown) => typeof key !== 'string')) throw new Error('Invalid JSON inspection response.');
                        } else if (typeof result.text !== 'string' || result.length !== result.text.length) throw new Error('Invalid text response.');
                        const value = action.display === 'text' ? result.text : action.display === 'length' ? String(result.length) : action.display === 'summary' ? result.summary : action.display === 'valueType' ? result.valueType : action.display === 'itemCount' ? String(result.itemCount) : action.display === 'topLevelKeys' ? JSON.stringify(result.topLevelKeys, null, 2) : JSON.stringify(result, null, 2);
                        target.textContent = value;
                    } else target.textContent = action.text;` : 'target.textContent = action.text;'}
                }}));
            }
        } catch (error) {
            for (const controller of controllers) controller.destroy();
            throw error;
        }
        return () => { for (const controller of controllers) controller.destroy(); };
    }`;
}
export function readManagedAsyncSetup(node) {
    if (!node) return [];
    const value=node.body?.body?.[0]?.declarations?.[0]?.init;
    if (value?.type!=='ArrayExpression' || !value.elements.length || value.elements.length>50) return null;
    const rows=[];
    for (const item of value.elements) {
        if(item?.type!=='ObjectExpression' || ![3,8].includes(item.properties.length)) return null;
        const row={};
        for(const property of item.properties) {
            if(property.type!=='ObjectProperty' || property.computed || property.value.type!=='StringLiteral') return null;
            row[property.key.name ?? property.key.value]=property.value.value;
        }
        if(!['id,selector,text','backend,display,id,inputSelector,inputTag,preset,selector,text'].includes(Object.keys(row).sort().join(','))) return null;
        if(row.backend) {row.inputMarker=row.inputSelector ? /^\[data-fdo-input="(visual-input-\d+)"]$/.exec(row.inputSelector)?.[1] : '';delete row.inputSelector;}
        row.marker=/^\[data-fdo-result="(visual-result-\d+)"]$/.exec(row.selector)?.[1];
        delete row.selector;
        if(!validRow(row)) return null;
        rows.push(row);
    }
    if(new Set(rows.map(row=>row.id)).size!==rows.length) return null;
    const backends=rows.filter(row=>row.backend).map(row=>row.backend);
    if(new Set(backends).size!==backends.length) return null;
    return isNodesEquivalent(node,parseExpression(asyncActionSetupSource(rows),{plugins:['typescript']})) ? rows : null;
}
export function describeSdkAsyncActions(files,elements,actions) {
    const rows=actions?.managedAsync;
    for(const element of elements.filter(item=>item.sdkComponent?.identity==='fdo.async-action-button')) {
        const id=element.sdkComponent.instanceId, row=rows?.find(item=>item.id===id);
        const disabled=element.sdkComponent.properties.find(item=>item.name==='disabled');
        const code=Object.entries(files).map(([file,source])=>file==='/index.ts' && actions?.setupNode ? source.slice(0,actions.setupNode.start)+source.slice(actions.setupNode.end) : source).join('\n');
        const refs=safeId(id) ? (code.match(new RegExp('(^|[^\\w-])'+id+'(?=$|[^\\w-])','g')) || []).length : 0;
        const cleanup=asyncBackendCleanup(files,row,actions?.setupNode && {start:actions.setupNode.start,end:actions.setupNode.end});
        const editable=!cleanup.reason && !!actions?.localCreationAllowed && !!rows && actions.language==='typescript'
            && !actions.comments?.some(comment=>actions.setupNode && comment.start>actions.setupNode.start && comment.end<actions.setupNode.end)
            && !/\bmountAsyncActionButton\b/.test(code) && safeId(id) && element.sdkComponent.instanceIdLiteral
            && element.structure?.unique && !element.sdkComponent.reason && disabled?.editable && disabled.present
            && disabled.value===!row && refs===1;
        element.asyncAction={editable,status:row ? 'connected' : 'available',row,id,disabled,
            backend:actions?.backendCreation,cleanup:cleanup.operations || [],inputs:[],
            reason:editable ? '' : cleanup.reason || 'Visual async actions need a unique literal ID, an unchanged disabled setting and a direct TypeScript action contract without custom setup or controller wiring.',
            targets:[],rows,setup:actions?.setupNode ? {start:actions.setupNode.start,end:actions.setupNode.end} : null,
            setupRemoval:actions?.setupProperty ? sourceNodeRemovalRanges(files['/index.ts'],actions.options.properties,actions.setupProperty,actions.options.end-1) : [],
            setupInsert:actions?.options.start+1};
        if(row && disabled) {disabled.editable=false;disabled.reason='Disconnect the managed async action before changing its disabled setting.';}
    }
}
export function sdkAsyncActionCatalog(elements) {
    return elements.filter(element=>element.asyncAction?.status==='connected').map(element=>({
        name:'async:'+element.asyncAction.id,kind:element.asyncAction.row?.backend ? 'SDK async backend' : 'SDK async text',uses:1,buttonId:element.id,
        removable:element.asyncAction.editable,reason:element.asyncAction.reason,operations:[],
    }));
}
export function planSdkAsyncAction(files,element,request) {
    const action=element.asyncAction;
    if(!action?.editable) throw new Error(action?.reason || 'Select an editable SDK Async Action Button.');
    const disconnect=request.kind==='disconnect-sdk-async-action';
    if(disconnect && action.status!=='connected' || !disconnect && action.status==='connected') throw new Error('Disconnect the existing action before creating another.');
    const target=!disconnect && action.targets.find(item=>item.id===request.targetId);
    let marker=target?.marker;
    if(!disconnect && !marker) {let n=1;while(Object.values(files).some(source=>source.includes('visual-result-'+n))) n++;marker='visual-result-'+n;}
    const input=!disconnect && request.inputId!=null && action.inputs.find(item=>item.id===request.inputId);
    const backend=!disconnect && request.preset && request.preset!=='local';
    if(!disconnect && !backend && request.inputId!=null) throw new Error('UI text inputs require a backend preset.');
    if(backend && (!action.backend || !['text','inspect-json'].includes(request.preset) || !validResultDisplay(request.display ?? 'json',request.preset) || request.inputId!=null && !input)) throw new Error('Choose a supported backend preset, result display and enabled text input.');
    const row={id:action.id,marker,text:input ? '' : request.text};
    if(backend) {
        let n=1;while(Object.values(files).some(source=>['visualAsyncTextBackend','visualAsyncJsonBackend','VisualAsyncInput','VisualAsyncResult','handleVisualAsync','VisualAsyncRegistry'].some(prefix=>source.includes(prefix+n) || source.includes(prefix+'Text'+n) || source.includes(prefix+'Json'+n)))) n++;
        let inputNumber=1;while(Object.values(files).some(source=>source.includes('visual-input-'+inputNumber))) inputNumber++;
        Object.assign(row,{backend:'visualAsync'+(request.preset==='inspect-json' ? 'Json' : 'Text')+'Backend'+n,preset:request.preset,display:request.display ?? 'json',inputMarker:input ? input.marker || 'visual-input-'+inputNumber : '',inputTag:input?.tag || ''});
    }
    if(!disconnect && (!target || !validRow(row))) throw new Error('Choose a supported result element and up to 2,000 characters of plain text.');
    const rows=action.rows.filter(item=>item.id!==action.id);
    if(!disconnect) rows.push(row);
    if(rows.length>50) throw new Error('At most 50 managed async actions can share a view.');
    const operations=disconnect ? [...action.cleanup] : backend ? asyncBackendCreation(files,action.backend,row) : [];
    operations.push({file:action.disabled.file,start:action.disabled.start,end:action.disabled.end,replacement:String(disconnect)});
    if(rows.length) operations.push({file:'/index.ts',start:action.setup?.start ?? action.setupInsert,end:action.setup?.end ?? action.setupInsert,
        replacement:(action.setup ? '' : 'setup: ')+asyncActionSetupSource(rows)+(action.setup ? '' : ',')});
    else operations.push(...action.setupRemoval.map(range=>({file:'/index.ts',...range,replacement:''})));
    if(target && !target.marker) operations.push({file:target.file,start:target.insert,end:target.insert,replacement:'"data-fdo-result": '+JSON.stringify(marker)+', '});
    if(input && !input.marker) operations.push({file:input.file,start:input.insert,end:input.insert,replacement:'"data-fdo-input": '+JSON.stringify(row.inputMarker)+', '});
    operations.sort((a,b)=>a.file.localeCompare(b.file) || b.start-a.start);
    const current={...files},patches=[];
    for(const operation of operations) {
        const before=current[operation.file],after=before.slice(0,operation.start)+operation.replacement+before.slice(operation.end);
        patches.push({...operation,before,after,removed:before.slice(operation.start,operation.end),added:operation.replacement,affected:1,description:disconnect ? 'Disconnect SDK async action' : backend ? 'Create SDK async backend action' : 'Create SDK async Set result text action'});
        current[operation.file]=after;
    }
    return {...patches[0],patches};
}
