import {sourceNodeRemovalRanges} from './sourceRanges';
const initialTitle='Connect an action in the IDE';
const safeId=value=>typeof value==='string' && /^[A-Za-z][\w-]{0,120}$/.test(value);
const fieldsOf=node=>{
    if(node?.type!=='ObjectExpression' || node.properties.some(p=>p.type!=='ObjectProperty' || p.computed)) return null;
    const entries=node.properties.map(p=>[p.key.name ?? p.key.value,p]);
    return new Set(entries.map(([key])=>key)).size===entries.length ? new Map(entries) : null;
};
export function describeSdkOpeners(files,elements,calls,compatibleActions,resultTargets=[]) {
    const dataRanges=elements.flatMap(element=>{
        const call=calls.get(element.id),value=fieldsOf(call?.node.arguments[1])?.get('data-fdo-ui-confirm-text')?.value;
        return value?.type==='StringLiteral' ? [{file:call.file,start:value.start,end:value.end}] : [];
    });
    const code=Object.entries(files).filter(([file])=>/\.[cm]?[jt]sx?$/.test(file)).map(([file,source])=>{
        for(const range of [...new Map(dataRanges.filter(item=>item.file===file).map(item=>[item.start,item])).values()].sort((a,b)=>b.start-a.start)) source=source.slice(0,range.start)+source.slice(range.end);
        return source;
    }).join('\n');
    const customMount=/\bmount(?:Dialog|Popover|ConfirmationDialog)\b/.test(code);
    const buttons=elements.filter(e=>e.tag==='button');
    const roots=elements.filter(e=>e.sdkComponent && ['fdo.dialog','fdo.popover','fdo.confirmation-dialog'].includes(e.sdkComponent.identity) && e.sdkComponent.instanceIdLiteral && safeId(e.sdkComponent.instanceId) && e.structure?.unique && !e.sdkComponent.reason);
    for(const button of buttons) {
        const {node,file,attributes}=calls.get(button.id),fields=fieldsOf(node.arguments[1]);
        const targetId=attributes['data-fdo-ui-open'];
        const allowed=['type','disabled','title','class','className','aria-label','aria-description',...(targetId ? ['data-fdo-ui-open','aria-controls','aria-haspopup','data-fdo-ui-confirm-selector','data-fdo-ui-confirm-text'] : [])];
        const unique=button.structure?.unique && fields && [...fields.keys()].every(key=>allowed.includes(key));
        const target=roots.find(root=>root.sdkComponent.instanceId===targetId);
        const confirmation=target?.sdkComponent.identity==='fdo.confirmation-dialog';
        const selector=attributes['data-fdo-ui-confirm-selector'],text=attributes['data-fdo-ui-confirm-text'];
        const marker=typeof selector==='string' && /^\[data-fdo-result="(visual-result-\d+)"]$/.exec(selector)?.[1];
        const result=marker && resultTargets.find(item=>item.marker===marker);
        const validText=typeof text==='string' && text.length<=2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
        const confirmValid=confirmation ? !!result && validText && fields?.get('data-fdo-ui-confirm-selector')?.value.type==='StringLiteral' && fields?.get('data-fdo-ui-confirm-text')?.value.type==='StringLiteral'
            : !fields?.has('data-fdo-ui-confirm-selector') && !fields?.has('data-fdo-ui-confirm-text');
        const managed=confirmValid && target && fields?.get('data-fdo-ui-open')?.value.type==='StringLiteral' && fields.get('aria-controls')?.value.type==='StringLiteral' && attributes['aria-controls']===targetId &&
            attributes.title==='Open ' + target.sdkComponent.name && attributes.disabled===false &&
            (['fdo.dialog','fdo.confirmation-dialog'].includes(target.sdkComponent.identity) ? attributes['aria-haspopup']==='dialog' && fields.get('aria-haspopup')?.value.type==='StringLiteral' : !fields.has('aria-haspopup'));
        const initial=!targetId && attributes.disabled===true && attributes.title===initialTitle;
        const editable=!!unique && !!compatibleActions && !customMount && fields.get('type')?.value.value==='button' && fields.get('disabled')?.value.type==='BooleanLiteral' && fields.get('title')?.value.type==='StringLiteral' && (initial || managed);
        const targets=editable ? roots.filter(root=>{
            const id=root.sdkComponent.instanceId;
            const uses=buttons.filter(item=>calls.get(item.id).attributes['data-fdo-ui-open']===id);
            const refs=(code.match(new RegExp('(^|[^\\w-])' + id + '(?=$|[^\\w-])','g')) || []).length;
            return elements.filter(item=>item.sdkComponent?.instanceId===id).length===1 && !uses.some(item=>item.id!==button.id) && refs===(id===targetId ? 3 : 1);
        }).map(root=>({id:root.sdkComponent.instanceId,name:root.sdkComponent.name,label:root.label,identity:root.sdkComponent.identity})) : [];
        if (!initial && !targetId) continue;
        const connected=!!targetId;
        const current=targets.find(item=>item.id===targetId);
        button.overlayOpener={status:connected ? 'connected' : 'available',targetId:targetId || '',targets,resultTargets,confirmation:confirmation && result ? {targetId:result.id,text} : null,editable:editable && (!connected || !!current),
            reason:!editable ? 'Custom wiring or controller setup is preserved. Connect this button in the IDE.' : connected && !current ? 'This opener or target is shared or referenced elsewhere. Edit it in the IDE.' : targets.length ? '' : 'Add an SDK Dialog, Confirmation Dialog or Popover with an unused literal ID first.',file};
        if(button.overlayOpener.editable) button.overlayOpener.source={start:node.arguments[1].start,end:node.arguments[1].end,
            disabled:{start:fields.get('disabled').value.start,end:fields.get('disabled').value.end},
            title:{start:fields.get('title').value.start,end:fields.get('title').value.end},
            removals:['data-fdo-ui-open','aria-controls','aria-haspopup','data-fdo-ui-confirm-selector','data-fdo-ui-confirm-text'].flatMap(key=>fields.has(key) ? sourceNodeRemovalRanges(files[file],node.arguments[1].properties,fields.get(key),node.arguments[1].end-1) : [])};
    }
}
export function planSdkOpener(files,element,request) {
    const connection=element.overlayOpener,source=connection?.source;
    if(!connection?.editable || !source) throw new Error(connection?.reason || 'Select an unused Live UI button.');
    const disconnect=request.kind==='disconnect-overlay-opener';
    if(disconnect && connection.status!=='connected') throw new Error('This button has no managed overlay opener.');
    const target=!disconnect && connection.targets.find(item=>item.id===request.targetId);
    if(!disconnect && !target) throw new Error('Choose an available SDK Dialog, Confirmation Dialog or Popover.');
    const confirmation=target?.identity==='fdo.confirmation-dialog';
    const result=confirmation && connection.resultTargets.find(item=>item.id===request.confirmTargetId);
    if(confirmation && (!result || typeof request.confirmText!=='string' || request.confirmText.length>2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(request.confirmText))) throw new Error('Choose a supported confirmation result element and up to 2,000 characters of plain text.');
    let marker=result?.marker;
    if(result && !marker) {let n=1;while(Object.values(files).some(code=>code.includes('visual-result-'+n))) n++;marker='visual-result-'+n;}
    const ranges=[];
    for(const range of [...source.removals].sort((a,b)=>a.start-b.start)) {const previous=ranges.at(-1);if(previous && range.start<=previous.end) previous.end=Math.max(previous.end,range.end);else ranges.push({...range});}
    const edits=[...ranges.map(range=>({...range,replacement:''})),{...source.disabled,replacement:String(disconnect)}, {...source.title,replacement:JSON.stringify(disconnect ? initialTitle : 'Open ' + target.name)}].map(edit=>({...edit,file:connection.file}));
    if(!disconnect) {
        const attrs={'data-fdo-ui-open':target.id,'aria-controls':target.id,...(['fdo.dialog','fdo.confirmation-dialog'].includes(target.identity) ? {'aria-haspopup':'dialog'} : {}),
            ...(confirmation ? {'data-fdo-ui-confirm-selector':`[data-fdo-result="${marker}"]`,'data-fdo-ui-confirm-text':request.confirmText} : {})};
        edits.push({file:connection.file,start:source.start+1,end:source.start+1,replacement:Object.entries(attrs).map(([key,value])=>JSON.stringify(key)+': '+JSON.stringify(value)).join(', ')+', '});
    }
    if(result && !result.marker) edits.push({file:result.file,start:result.insert,end:result.insert,replacement:'"data-fdo-result": '+JSON.stringify(marker)+', '});
    const selectedSource={file:element.structure.file,start:element.structure.start+edits
        .filter(edit=>edit.file===element.structure.file && edit.end<=element.structure.start)
        .reduce((shift,edit)=>shift+edit.replacement.length-(edit.end-edit.start),0)};
    const patches=[];
    for(const file of new Set(edits.map(edit=>edit.file))) {
        const before=files[file];let after=before;
        for(const edit of edits.filter(edit=>edit.file===file).sort((a,b)=>b.start-a.start)) after=after.slice(0,edit.start)+edit.replacement+after.slice(edit.end);
        patches.push({file,before,after,start:0,end:before.length,replacement:after,removed:before,added:after,
            description:disconnect ? 'Disconnect overlay opener' : 'Connect button to ' + target.label,affected:1,
            selectedSource});
    }
    return {...patches[0],patches};
}
