import {sourceNodeRemovalRanges} from './sourceRanges';
import {parseFragment} from 'parse5';
const prefix='data-fdo-ui-toast-';
const keys=['region','id','visible','queued','duration'];
const safeId=value=>typeof value==='string' && /^[A-Za-z][\w-]{0,120}$/.test(value);
export const validToastLimits=(visible,queued,duration)=>Number.isInteger(visible) && visible>=1 && visible<=20 && Number.isInteger(queued) && queued>=0 && queued<=100 && Number.isInteger(duration) && duration>=0 && duration<=600000;
const fieldsOf=node=>{
    if(node?.type!=='ObjectExpression' || node.properties.some(p=>p.type!=='ObjectProperty' || p.computed)) return null;
    const fields=new Map(node.properties.map(p=>[p.key.name ?? p.key.value,p]));
    return fields.size===node.properties.length ? fields : null;
};
export function describeToastActions(files,elements,calls,compatible,html) {
    const nodes=new Map();
    if(elements.some(item=>item.sdkComponent?.identity==='fdo.toast-region')) {
        const queue=[parseFragment(html)];
        for(let index=0;index<queue.length;index++) {
            const node=queue[index],id=node.attrs?.find(attr=>attr.name==='data-fdo-ui-id')?.value;
            if(id) nodes.set(id,node);
            queue.push(...(node.childNodes || []));
        }
    }
    const contains=(region,button)=>{for(let node=nodes.get(button.id);node;node=node.parentNode) if(node===nodes.get(region.id)) return true;return false;};
    const code=Object.entries(files).filter(([file])=>/\.[cm]?[jt]sx?$/.test(file)).map(([,source])=>source).join('\n'),custom=/\bmount(?:Toast|ToastRegion)\b/.test(code);
    const buttons=elements.filter(item=>item.tag==='button');
    const records=buttons.map(button=>{
        const call=calls.get(button.id),fields=fieldsOf(call.node.arguments[1]),attrs=call.attributes;
        const connected=Object.hasOwn(attrs,prefix+'region');
        const config=connected ? Object.fromEntries(keys.map(key=>[key,attrs[prefix+key]])) : null;
        const managed=fields && [...fields.values()].every(p=>p.type==='ObjectProperty')
            && [...fields.keys()].every(key=>['type','disabled','title','class','className','aria-label','aria-description',...(connected ? keys.map(key=>prefix+key) : [])].includes(key))
            && fields.get('type')?.value.type==='StringLiteral' && attrs.type==='button'
            && fields.get('disabled')?.value.type==='BooleanLiteral' && attrs.disabled===!connected
            && fields.get('title')?.value.type==='StringLiteral' && attrs.title===(connected ? 'Enqueue toast' : 'Connect an action in the IDE')
            && (!connected || keys.every(key=>fields.get(prefix+key)?.value.type==='StringLiteral') && safeId(config.region) && safeId(config.id)
                && [config.visible,config.queued,config.duration].every(value=>/^(0|[1-9]\d*)$/.test(value)) && validToastLimits(+config.visible,+config.queued,+config.duration));
        return {button,call,fields,connected,config,managed:!!managed && button.structure?.unique};
    });
    const components=elements.filter(item=>item.structure?.unique && item.sdkComponent?.instanceIdLiteral && safeId(item.sdkComponent.instanceId) && !item.sdkComponent.reason);
    const unique=component=>elements.filter(item=>item.sdkComponent?.instanceId===component.sdkComponent.instanceId).length===1;
    const references=(id,extra)=> (code.match(new RegExp('(^|[^\\w-])'+id+'(?=$|[^\\w-])','g')) || []).length===1+extra;
    for(const record of records) {
        const {button,call,fields,connected,config}=record;
        if(!connected && !record.managed) continue;
        const editable=!!compatible && !custom && record.managed;
        const targets=[];
        if(editable) for(const region of components.filter(item=>item.sdkComponent.identity==='fdo.toast-region' && unique(item))) {
            if(contains(region,button)) continue;
            const regionId=region.sdkComponent.instanceId;
            const uses=records.filter(item=>item.config?.region===regionId);
            if(uses.some(item=>!item.managed) || !references(regionId,uses.length)) continue;
            const others=uses.filter(item=>item.button.id!==button.id);
            const limits=others[0]?.config || (config?.region===regionId ? config : null);
            if(uses.some(item=>limits && (item.config.visible!==limits.visible || item.config.queued!==limits.queued))) continue;
            const children=new Set(region.sdkComponent.slots.find(slot=>slot.name==='body')?.children.map(child=>child.id));
            for(const toast of components.filter(item=>item.sdkComponent.identity==='fdo.toast' && unique(item) && children.has(item.id))) {
                const toastId=toast.sdkComponent.instanceId,toastUses=records.filter(item=>item.config?.id===toastId);
                if(toastUses.some(item=>item.button.id!==button.id) || !references(toastId,toastUses.length)) continue;
                targets.push({regionId,toastId,label:region.label+' → '+toast.label,visible:+(limits?.visible ?? 3),queued:+(limits?.queued ?? 50),locked:!!others.length});
            }
        }
        const current=connected && targets.find(item=>item.regionId===config.region && item.toastId===config.id);
        button.toastAction={editable:editable && (!connected || !!current),status:connected ? 'connected' : 'available',targets,
            regionId:config?.region || '',toastId:config?.id || '',visible:+(config?.visible ?? 3),queued:+(config?.queued ?? 50),duration:+(config?.duration ?? 0),
            reason:!editable ? 'Custom wiring or toast controllers stay in the IDE.' : connected && !current ? 'This toast, region or queue configuration is shared, modified or referenced elsewhere. Review it in the IDE.' : targets.length ? '' : 'Add an SDK Toast Region and use Add toast to region first. Each toast supports one visual enqueue button.',
            file:call.file,source:editable ? {start:call.node.arguments[1].start,end:call.node.arguments[1].end,
                disabled:{start:fields.get('disabled').value.start,end:fields.get('disabled').value.end},title:{start:fields.get('title').value.start,end:fields.get('title').value.end},
                removals:keys.flatMap(key=>fields.has(prefix+key) ? sourceNodeRemovalRanges(files[call.file],call.node.arguments[1].properties,fields.get(prefix+key),call.node.arguments[1].end-1) : [])} : null};
    }
}
export function planToastAction(files,element,request) {
    const action=element.toastAction;
    if(!action?.editable) throw new Error(action?.reason || 'Select an unconnected visual button.');
    const disconnect=request.kind==='disconnect-toast-action';
    if(disconnect && action.status!=='connected') throw new Error('This button has no toast connection.');
    const target=!disconnect && action.targets.find(item=>item.regionId===request.regionId && item.toastId===request.toastId);
    if(!disconnect && (!target || !validToastLimits(request.visible,request.queued,request.duration) || target.locked && (target.visible!==request.visible || target.queued!==request.queued))) throw new Error('Choose an authored toast and valid, consistent queue limits.');
    const source=action.source,before=files[action.file],ranges=[];
    for(const range of [...source.removals].sort((a,b)=>a.start-b.start)) {const prior=ranges.at(-1);if(prior && range.start<=prior.end) prior.end=Math.max(prior.end,range.end);else ranges.push({...range});}
    const edits=[...ranges.map(range=>({...range,replacement:''})),{...source.disabled,replacement:String(disconnect)},{...source.title,replacement:JSON.stringify(disconnect ? 'Connect an action in the IDE' : 'Enqueue toast')}];
    if(!disconnect) {
        const config={region:target.regionId,id:target.toastId,visible:String(request.visible),queued:String(request.queued),duration:String(request.duration)};
        edits.push({start:source.start+1,end:source.start+1,replacement:keys.map(key=>JSON.stringify(prefix+key)+': '+JSON.stringify(config[key])).join(', ')+', '});
    }
    let after=before;
    for(const edit of edits.sort((a,b)=>b.start-a.start)) after=after.slice(0,edit.start)+edit.replacement+after.slice(edit.end);
    return {file:action.file,before,after,start:0,end:before.length,replacement:after,removed:before,added:after,affected:1,
        selectedSource:{file:element.structure.file,start:element.structure.start},description:disconnect ? 'Disconnect toast enqueue button' : 'Connect toast enqueue button'};
}
