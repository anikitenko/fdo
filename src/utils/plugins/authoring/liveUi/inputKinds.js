import {sourceNodeRemovalRanges} from './sourceRanges';
export const INPUT_KINDS=['textarea','text','search','email','url','tel','password','number','date','time','datetime-local'];
const attrs=new Set(['class','className','style','aria-label','aria-description','placeholder','title','type','value','rows','cols','maxlength','maxLength','minlength','minLength','wrap','disabled','readonly','readOnly','data-fdo-input']);
export function describeInputKinds(files,elements,calls) {
    for(const element of elements) {
        if (!['input','textarea'].includes(element.tag) || !element.structure?.unique) continue;
        const call=calls.get(element.id),object=call.node.arguments[1],tag=call.node.arguments[0];
        if (call.node.callee.property?.name !== 'createElement' || tag?.type !== 'StringLiteral' || object?.type !== 'ObjectExpression'
            || object.properties.some(p=>p.type !== 'ObjectProperty' || p.computed || !attrs.has(p.key.name ?? p.key.value))) continue;
        const names=object.properties.map(p=>p.key.name ?? p.key.value);
        if(new Set(names).size !== names.length) continue;
        const type=object.properties.find(p=>(p.key.name ?? p.key.value)==='type');
        if(type && type.value.type !== 'StringLiteral') continue;
        const current=element.tag === 'textarea' ? 'textarea' : type?.value.value || 'text';
        const bound=Object.hasOwn(call.attributes,'data-fdo-input');
        const empty=(!element.text || element.text.value === '') && !call.attributes.value;
        element.inputKind={file:call.file,current,bound,canConvert:!bound && empty,tag:{start:tag.start,end:tag.end},insert:object.start+1,
            type:type ? {start:type.value.start,end:type.value.end,removal:sourceNodeRemovalRanges(files[call.file],object.properties,type,object.end-1)} : null};
    }
}
export function planInputKind(files,element,request) {
    const target=element.inputKind,next=request.value;
    if (!target || !INPUT_KINDS.includes(next)) throw new Error('Select a supported input type.');
    if (target.bound && (target.current === 'textarea' || !['text','search'].includes(next))) throw new Error('Disconnect the input binding in code before changing its control kind. Bound single-line inputs support text/search only.');
    if ((next === 'textarea') !== (target.current === 'textarea') && !target.canConvert) throw new Error('Only empty, unbound controls can switch between textarea and input. Preserve non-empty content and bindings in the IDE.');
    const operations=[];
    if((next === 'textarea') !== (target.current === 'textarea')) operations.push({...target.tag,replacement:JSON.stringify(next === 'textarea' ? 'textarea' : 'input')});
    if(next === 'textarea') {if(target.type) operations.push(...target.type.removal.map(range=>({...range,replacement:''})));}
    else operations.push({start:target.type?.start ?? target.insert,end:target.type?.end ?? target.insert,replacement:target.type ? JSON.stringify(next) : '"type": '+JSON.stringify(next)+', '});
    let source=files[target.file];const patches=operations.sort((a,b)=>b.start-a.start).map(operation=>{
        const before=source;source=before.slice(0,operation.start)+operation.replacement+before.slice(operation.end);
        return {...operation,file:target.file,before,after:source,removed:before.slice(operation.start,operation.end),added:operation.replacement,description:'Change input type',affected:1};
    });
    if(!patches.length || source === files[target.file]) throw new Error('The input type is unchanged.');
    return {...patches[0],patches};
}
