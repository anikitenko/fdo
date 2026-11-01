import {parse,parseExpression} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {sourceNodeRemovalRanges} from './sourceRanges';
import {handlerNameError} from './actionBindingOptions';

const traverse=traverseModule.default || traverseModule;
const options={sourceType:'module',plugins:['typescript']};
function callbackSource(files,file,property) {
    if(property.type==='ObjectMethod')return `${property.async?'async ':''}function (${property.params.map(node=>files[file].slice(node.start,node.end)).join(', ')}) ${files[file].slice(property.body.start,property.body.end)}`;
    return property.value.type==='StringLiteral' ? property.value.value : files[file].slice(property.value.start,property.value.end);
}
export function validateHandlerFunction(code) {
    if(typeof code!=='string' || !code.trim() || code.length>20000)throw new Error('Supply a complete handler function, up to 20,000 characters.');
    let node;
    try {node=parseExpression(code,options);} catch(error){throw new Error('Handler syntax: '+error.message);}
    if(!['ArrowFunctionExpression','FunctionExpression'].includes(node.type) || node.generator || node.params.length>1)
        throw new Error('Use a complete function with zero parameters or one SDK context parameter, such as ({document, element, event}) => { ... }.');
    return code;
}

// Handler code is parsed as data. It is never called to inspect or edit it.
export function describeHandlerEdits(files,file,object,properties,records) {
    const complete=records.every(item=>typeof item.handler==='string' && item.fields.handler && item.literalHandler);
    const handlers=new Map();
    for(const [name,property] of properties) {
        let code='',reason='';
        if(property.type!=='ObjectMethod' && !['ArrowFunctionExpression','FunctionExpression','StringLiteral'].includes(property.value?.type))continue;
        try {code=validateHandlerFunction(callbackSource(files,file,property));}catch(error){reason=error.message;}
        const references=records.filter(item=>item.handler===name);
        handlers.set(name,{functionSource:code,editReason:reason,
            representation:property.type==='ObjectMethod'?'method':property.value.type==='StringLiteral'?'string':'function',
            valueRange:{start:property.type==='ObjectMethod'?property.start:property.value.start,end:property.type==='ObjectMethod'?property.end:property.value.end},
            keyRange:{start:property.key.start,end:property.key.end},
            removal:sourceNodeRemovalRanges(files[file],object.properties,property,object.end-1),
            references:references.map(item=>({selector:item.selector,event:item.event,location:item.location,range:item.fields.handler})),
            referencesComplete:complete,
        });
    }
    return {file,start:object.start+1,names:[...properties.keys()],handlers};
}

function directLookup(files,name) {
    const key=node=>node?.computed?node.property?.value:node?.property?.name;
    const handlersObject=(node,scope,seen=new Set())=>{
        if(!node)return false;
        if(['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression'].includes(node.type))return handlersObject(node.expression,scope,seen);
        if(['MemberExpression','OptionalMemberExpression'].includes(node.type))return key(node)==='handlers';
        if(node.type!=='Identifier' || seen.has(node.name))return false;
        seen.add(node.name);
        const binding=scope.getBinding(node.name),declaration=binding?.path;
        if(!binding?.constant || !declaration?.isVariableDeclarator())return false;
        const {id,init}=declaration.node;
        if(id.type==='ObjectPattern')return id.properties.some(property=>property.type==='ObjectProperty' &&
            (property.key.name || property.key.value)==='handlers' && property.value.type==='Identifier' && property.value.name===node.name);
        return handlersObject(init,declaration.scope,seen);
    };
    for(const [file,source] of Object.entries(files)) if(/\.[cm]?[jt]sx?$/.test(file)) {
        let found=false;
        try {
            const ast=parse(source,{...options,plugins:['typescript','jsx']});
            traverse(ast,{
                'MemberExpression|OptionalMemberExpression'(p){
                    if(key(p.node)===name && handlersObject(p.node.object,p.scope))found=true;
                },
                VariableDeclarator(p){
                    if(p.node.id.type==='ObjectPattern' && handlersObject(p.node.init,p.scope) &&
                        p.node.id.properties.some(property=>property.type==='ObjectProperty' && (property.key.name || property.key.value)===name))found=true;
                },
            });
        }catch{throw new Error(`Resolve syntax errors in ${file} before renaming a handler.`);}
        if(found)throw new Error(`A direct handlers.${name} lookup exists in ${file}. Update that consumer before renaming or removing this handler.`);
    }
}

export function planHandlerEdit(files,element,request) {
    const target=element.sdkBindings,container=target?.handlerContainer;
    if(!container || target.reason)throw new Error(target?.reason || 'Refresh the SDK handler definition before editing it.');
    const handler=target.handlers.find(item=>item.name===request.handler);
    const action=request.action,operations=[];
    const adding=action==='create' || action==='duplicate';
    if(adding || action==='rename') {
        const error=handlerNameError(request.name);
        if(error)throw new Error(error);
        if(container.names.includes(request.name))throw new Error('A handler with this name already exists. Choose a different name.');
    }
    if(!adding || action==='duplicate') {
        if(!handler)throw new Error('Select a current SDK handler.');
        if(['update','rename'].includes(action) && (handler.uses>1 || !handler.referencesComplete) && request.confirmSharedHandler!==true)
            throw new Error('Acknowledge that this handler change affects every binding using it.');
    }
    let description;
    if(action==='create' || action==='duplicate') {
        if(container.names.length>=512)throw new Error('This action module has reached the handler limit.');
        const code=validateHandlerFunction(action==='duplicate'?handler.functionSource:request.code);
        description=action==='duplicate'?'Duplicate SDK handler':'Create SDK click handler';
        operations.push({file:container.file,start:container.start,end:container.start,replacement:JSON.stringify(request.name)+': (\n'+code+'\n),\n'});
    } else if(action==='update') {
        if(handler.editReason)throw new Error(handler.editReason);
        const code=validateHandlerFunction(request.code);
        if(code===handler.functionSource)throw new Error('This handler code already matches.');
        description='Update SDK handler '+handler.name;
        operations.push({file:container.file,...handler.valueRange,replacement:handler.representation==='method'
            ? JSON.stringify(handler.name)+': (\n'+code+'\n)' : handler.representation==='string'?JSON.stringify(code):'(\n'+code+'\n)'});
    } else if(action==='rename') {
        if(!handler.referencesComplete)throw new Error('Some bindings choose their handler dynamically. Review those references before renaming.');
        directLookup(files,handler.name);
        description='Rename SDK handler '+handler.name+' to '+request.name;
        operations.push({file:container.file,...handler.keyRange,replacement:JSON.stringify(request.name)},
            ...handler.references.map(reference=>({file:container.file,...reference.range,replacement:JSON.stringify(request.name)})));
    } else if(action==='remove') {
        if(handler.uses || !handler.referencesComplete)throw new Error('Disconnect or rewire all bindings before removing this handler. Dynamic references must be resolved first.');
        if(container.names.length<=1)throw new Error('The SDK action module needs at least one handler.');
        directLookup(files,handler.name);
        description='Remove unused SDK handler '+handler.name;
        operations.push(...handler.removal.map(range=>({file:container.file,...range,replacement:''})));
    } else throw new Error('Choose a supported handler operation.');
    const current={...files},patches=[];
    for(const operation of operations.sort((a,b)=>b.start-a.start)) {
        const {file,start,end,replacement}=operation,before=current[file],after=before.slice(0,start)+replacement+before.slice(end);
        patches.push({...operation,before,after,removed:before.slice(start,end),added:replacement,description,affected:Math.max(1,handler?.uses||0)});
        current[file]=after;
    }
    return {...patches[0],patches};
}
