import {sourceNodeRemovalRanges} from './sourceRanges';
// Item keys and body expressions are never rewritten by label/state edits.
const emptyBody=node=>node?.type==='StringLiteral' && node.value==='' || node?.type==='BinaryExpression' && node.operator==='+' && emptyBody(node.left) && emptyBody(node.right);
const fieldsOf=node=>{
    if(node?.type!=='ObjectExpression' || node.properties.some(p=>p.type!=='ObjectProperty' || p.computed || p.method)) return null;
    const entries=node.properties.map(p=>[p.key.name ?? p.key.value,p.value]);
    return new Set(entries.map(([key])=>key)).size===entries.length ? new Map(entries) : null;
};
export const sdkContentSlots=component=>[...(component?.slots || []),...(component?.collection?.items || []).flatMap(item=>item.slot ? [item.slot] : [])];
const combineEdits=(source,edits)=>{
    const start=Math.min(...edits.map(item=>item.start)),end=Math.max(...edits.map(item=>item.end));
    let replacement=source.slice(start,end);
    for(const edit of [...edits].sort((a,b)=>b.start-a.start)) replacement=replacement.slice(0,edit.start-start)+edit.value+replacement.slice(edit.end-start);
    return {start,end,replacement};
};
export function describeSdkCollection(node,file,definition,values,source,files) {
    if(!['fdo.tabs','fdo.accordion'].includes(definition.identity)) return null;
    const root=fieldsOf(node.arguments[1]),array=root?.get('items');
    const label=definition.identity==='fdo.tabs' ? 'label' : 'title',flag=definition.identity==='fdo.tabs' ? 'disabled' : 'open';
    const reason='Shared, computed or ambiguous items stay in the IDE.';
    if(!root || array?.type!=='ArrayExpression' || array.elements.length>50 || !array.elements.length) return {editable:false,reason,items:[]};
    const rows=array.elements.map((item,index)=>{
        const fields=fieldsOf(item),key=fields?.get('key');
        if(key?.type!=='StringLiteral' || !fields?.get('body')) return null;
        const text=fields.get(label),state=fields.get(flag),body=fields.get('body');
        const occupiedKey=key.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        const reference=new RegExp('(^|[^\\w-])'+occupiedKey+'(?=$|[^\\w-])');
        const references=Object.entries(files).some(([path,code])=>reference.test(path===file ? code.slice(0,key.start)+code.slice(key.end) : code)
            || [values.id+'-tab-'+key.value,values.id+'-panel-'+key.value,values.id+'-'+key.value].some(id=>code.includes(id)));
        const receiver=node.arguments[0]?.type==='Identifier' ? node.arguments[0].name : null;
        return {slot:{name:'item:'+key.value,label:values.items[index][label]+' · Body',property:'body',itemKey:key.value,file,start:body.start,end:body.end,insert:false,receiver,editable:!!receiver},removalRanges:sourceNodeRemovalRanges(source,array.elements,item,array.end-1),key:key.value,label:values.items[index][label],flag:!!values.items[index][flag],start:item.start,end:item.end,
            labelTarget:text?.type==='StringLiteral' ? {start:text.start,end:text.end} : null,
            flagTarget:!state || state.type==='BooleanLiteral' ? {start:state?.start ?? item.start+1,end:state?.end ?? item.start+1,insert:!state} : null,
            removable:emptyBody(body) && !references,
            reason:references ? 'This item key or derived ID is referenced elsewhere. Update its consumers in the IDE before removing it.' : emptyBody(body) ? '' : 'This item contains authored content. Remove its supported content blocks below, or clear its body in the IDE before removing it.'};
    });
    if(rows.some(row=>!row) || new Set(rows.map(row=>row.key)).size!==rows.length) return {editable:false,reason,items:[]};
    const active=root.get('activeKey'),activeProperty=node.arguments[1].properties.find(property=>(property.key.name ?? property.key.value)==='activeKey');
    const activeTarget=definition.identity==='fdo.tabs' ? {editable:!active || active.type==='StringLiteral',present:!!active,insert:!active,start:active?.start ?? node.arguments[1].start+1,end:active?.end ?? node.arguments[1].start+1,
        removals:activeProperty ? sourceNodeRemovalRanges(source,node.arguments[1].properties,activeProperty,node.arguments[1].end-1) : []} : null;
    return {activeTarget,effectiveActiveKey:values.activeKey ?? rows.find(row=>!row.flag)?.key,file,start:array.start,end:array.end,editable:true,labelProperty:label,flagProperty:flag,
        multiple:!!values.multiple,activeKey:values.activeKey ?? null,items:rows,reason:''};
}
export function planSdkCollection(files,element,request) {
    const component=element.sdkComponent,collection=component?.collection;
    if(!element.structure?.unique || component?.reason || !collection?.editable) throw new Error(collection?.reason || 'Select a unique SDK Tabs or Accordion with literal items.');
    const {items,file}=collection,before=files[file],index=items.findIndex(item=>item.key===request.key),item=items[index];
    let start=collection.start,end=collection.end,replacement;
    const tab=component.identity==='fdo.tabs';
    if(request.action==='default-tab') {
        const target=collection.activeTarget,value=request.value;
        if(!tab || !target?.editable) throw new Error('The default tab uses shared or computed options. Edit it in the IDE.');
        if(typeof value!=='string' || value!=='' && !items.some(row=>row.key===value && !row.flag)) throw new Error('Choose an enabled tab, or the first-enabled SDK default.');
        if(value===(collection.activeKey ?? '') && (value!=='' || !target.present)) throw new Error('This is already the default tab setting.');
        if(value==='') ({start,end,replacement}=combineEdits(before,target.removals.map(range=>({...range,value:''}))));
        else {({start,end}=target);replacement=(target.insert ? '"activeKey":' : '')+JSON.stringify(value)+(target.insert ? ',' : '');}
    } else if(request.action==='add') {
        if(items.length>=50) throw new Error('Use at most 50 visually managed items.');
        let count=1,key;do {key='item-'+count++;} while(Object.values(files).some(source=>source.includes(key)));
        const added=JSON.stringify({key,[collection.labelProperty]:tab ? 'New tab' : 'New section',body:''});
        // Appending before the trailing gap preserves its comma/comments and the default active tab.
        start=end=items.at(-1).end;replacement=', '+added;
    } else if(!item) throw new Error('Select a current item.');
    else if(request.action==='label') {
        if(!item.labelTarget || typeof request.value!=='string' || !request.value.trim() || request.value.length>2000 || /[\r\n\u0000-\u001f]/.test(request.value)) throw new Error('Use a non-empty label of up to 2,000 characters on one line.');
        ({start,end}=item.labelTarget);replacement=JSON.stringify(request.value);
    } else if(request.action==='flag') {
        if(!item.flagTarget || typeof request.value!=='boolean') throw new Error('This item state must be edited in the IDE.');
        if(tab && request.value && (items.filter(row=>!row.flag).length===1 && !item.flag || collection.activeKey===item.key)) throw new Error('Keep an enabled tab and select another active key before disabling the active tab.');
        const flagEdit=(row,value)=>({...row.flagTarget,value:(row.flagTarget.insert ? JSON.stringify(collection.flagProperty)+':' : '')+JSON.stringify(value)+(row.flagTarget.insert ? ', ' : '')});
        const edits=[flagEdit(item,request.value)];
        if(!tab && request.value && !collection.multiple) {
            const others=items.filter(row=>row!==item && row.flag);
            if(others.some(row=>!row.flagTarget)) throw new Error('Another open section has a computed state. Edit that state in the IDE before changing the initial section.');
            edits.push(...others.map(row=>flagEdit(row,false)));
        }
        ({start,end,replacement}=combineEdits(before,edits));
    } else if(request.action==='remove') {
        if(!item.removable) throw new Error(item.reason);
        if(items.length===1 || tab && (collection.activeKey===item.key || !items.some(row=>row!==item && !row.flag))) throw new Error('Keep at least one enabled item and select another active key before removing the active tab.');
        start=Math.min(...item.removalRanges.map(range=>range.start));end=Math.max(...item.removalRanges.map(range=>range.end));
        replacement=before.slice(start,end);
        for(const range of [...item.removalRanges].sort((a,b)=>b.start-a.start)) replacement=replacement.slice(0,range.start-start)+replacement.slice(range.end-start);
    } else if(['up','down'].includes(request.action)) {
        const target=index+(request.action==='up' ? -1 : 1);
        if(!items[target]) throw new Error('Choose an adjacent item within this collection.');
        const ordered=[...items];[ordered[index],ordered[target]]=[ordered[target],ordered[index]];
        replacement=before.slice(collection.start,items[0].start)+ordered.map((row,i)=>before.slice(row.start,row.end)+(i<items.length-1 ? before.slice(items[i].end,items[i+1].start) : '')).join('')+before.slice(items.at(-1).end,collection.end);
    } else throw new Error('Choose a supported collection operation.');
    const after=before.slice(0,start)+replacement+before.slice(end);
    return {file,before,after,start,end,replacement,removed:before.slice(start,end),added:replacement,affected:1,description:request.action+' '+component.name+' item'};
}
