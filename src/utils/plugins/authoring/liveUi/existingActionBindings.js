import path from 'node:path';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {parseFragment} from 'parse5';
import {sourceNodeRemovalRanges} from './sourceRanges';
import {BINDING_FLAGS,BINDING_EVENTS} from './actionBindingOptions';
import {describeHandlerEdits} from './handlerEdits';

const traverse = traverseModule.default || traverseModule;
const propertyName = node => !node.computed && (node.key?.name ?? node.key?.value);
const fields = node => {
    if (node?.type !== 'ObjectExpression') return null;
    const result = new Map();
    for (const item of node.properties) {
        const name = propertyName(item);
        if (!name || result.has(name) || !['ObjectProperty', 'ObjectMethod'].includes(item.type)) return null;
        result.set(name, item);
    }
    return result;
};
const location = (file, node) => ({path:file,line:node.loc.start.line,column:node.loc.start.column+1,
    endLine:node.loc.end.line,endColumn:node.loc.end.column+1});
const excerpt = (files, file, node) => ({location:location(file,node),code:files[file].slice(node.start,node.end).slice(0,6000),truncated:node.end-node.start>6000});

// Follow declarations, never execute a factory, setup callback, or handler.
function readDefinition(files, ast, plugin) {
    const modules = new Map(), owners = new WeakMap(), aliases = new Map();
    let visits = 0;
    const load = file => {
        if (modules.has(file)) return modules.get(file);
        const tree = file === '/index.ts' ? ast : parse(files[file],{sourceType:'module',plugins:['typescript','jsx']});
        let program;
        traverse(tree,{enter(p){owners.set(p.node,file);if(p.isProgram())program=p;}});
        modules.set(file,program);
        return program;
    };
    const importedFile = (file, specifier) => {
        if (!specifier.startsWith('.')) throw new Error('The action factory is outside the plugin workspace.');
        const base = path.posix.resolve(path.posix.dirname(file),specifier);
        const found = [base,...['.ts','.tsx','.js','/index.ts'].map(ext=>base+ext)].find(name=>Object.hasOwn(files,name));
        if (!found) throw new Error('The action factory source is missing.');
        return found;
    };
    const exported = (file, name) => {
        if(++visits>200)throw new Error('The action export chain is dynamic or circular.');
        const program=load(file);
        for (const statement of program.get('body')) {
            if (name==='default' && statement.isExportDefaultDeclaration()) return statement.get('declaration');
            if (!statement.isExportNamedDeclaration()) continue;
            const declaration=statement.get('declaration');
            if (declaration?.node?.id?.name===name) return declaration;
            if (declaration?.isVariableDeclaration()) {
                const item=declaration.get('declarations').find(item=>item.node.id.name===name);
                if(item)return item.get('init');
            }
            for (const spec of statement.get('specifiers')) if ((spec.node.exported?.name ?? spec.node.exported?.value)===name) {
                if(statement.node.source)return exported(importedFile(file,statement.node.source.value),spec.node.local.name);
                return program.scope.getBinding(spec.node.local.name)?.path;
            }
        }
        throw new Error('The exported action factory could not be resolved.');
    };
    const resolve = (p, seen=new Set()) => {
        if (!p?.node || ++visits>200 || seen.has(p.node)) throw new Error('The action definition is dynamic or circular.');
        seen=new Set(seen).add(p.node);
        if (['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression'].includes(p.node.type)) return resolve(p.get('expression'),seen);
        if (p.isVariableDeclarator()) return resolve(p.get('init'),seen);
        if (!p.isIdentifier()) return p;
        const binding=p.scope.getBinding(p.node.name);
        if (!binding?.constant) throw new Error('The action definition uses a mutable or unresolved value.');
        const owner=binding.path;
        if(owner.isImportSpecifier() || owner.isImportDefaultSpecifier()) {
            const target=importedFile(owners.get(owner.node),owner.parent.source.value);
            return resolve(exported(target,owner.isImportDefaultSpecifier()?'default':owner.node.imported.name),seen);
        }
        const resolved=resolve(owner,seen);
        if(owner.isVariableDeclarator())aliases.set(binding,resolved.node);
        return resolved;
    };
    const sdkCall = p => {
        const callee=p.get('callee');
        if(callee.isIdentifier()) {
            const binding=callee.scope.getBinding(callee.node.name)?.path;
            return binding?.isImportSpecifier() && binding.parent.source.value==='@anikitenko/fdo-sdk'
                && binding.parent.importKind!=='type' && binding.node.importKind!=='type'
                && binding.node.imported.name==='defineRenderOnLoadActions';
        }
        if(callee.isMemberExpression() && !callee.node.computed && callee.node.property.name==='defineRenderOnLoadActions') {
            const binding=callee.scope.getBinding(callee.node.object.name)?.path;
            return binding?.isImportNamespaceSpecifier() && binding.parent.source.value==='@anikitenko/fdo-sdk' && binding.parent.importKind!=='type';
        }
        return false;
    };
    const usedOptions=[];
    const read = (p, depth=0) => {
        if(depth>12)throw new Error('The action factory chain is too deep to inspect.');
        p=resolve(p);
        if(!p.isCallExpression())throw new Error('The lifecycle does not return a static SDK action definition.');
        if(sdkCall(p)) {
            if(p.node.arguments.length!==1)throw new Error('The SDK action definition must have one options object.');
            usedOptions.push(p.get('arguments')[0]);
            return resolve(p.get('arguments')[0]);
        }
        const callee=p.get('callee');
        if(callee.isMemberExpression() && !callee.node.computed && callee.node.object.name==='Object'
            && !callee.scope.getBinding('Object') && callee.node.property.name==='assign' && p.node.arguments.length===2) {
            const definition=read(p.get('arguments')[0],depth+1);
            const options=p.get('arguments')[1];
            if(resolve(options).node!==definition.node)throw new Error('The returned action module has additional overrides.');
            usedOptions.push(options);
            return definition;
        }
        const fn=resolve(callee);
        if(!['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(fn.node.type)
            || fn.node.async || fn.node.generator || fn.node.params.length || p.node.arguments.length) throw new Error('The action factory requires dynamic arguments or execution.');
        if(!fn.get('body').isBlockStatement())return read(fn.get('body'),depth+1);
        const statements=fn.get('body.body'), last=statements.at(-1);
        if(!last?.isReturnStatement() || statements.slice(0,-1).some(item=>!item.isVariableDeclaration({kind:'const'}) && !item.isFunctionDeclaration()))
            throw new Error('The action factory has dynamic initialization or control flow.');
        return read(last.get('argument'),depth+1);
    };
    load('/index.ts');
    const lifecycle=plugin.body.body.filter(node=>propertyName(node)==='renderOnLoad');
    if(lifecycle.length!==1 || lifecycle[0].type!=='ClassMethod')throw new Error('The action lifecycle is duplicated or overridden by a dynamic property.');
    let method;
    traverse(ast,{ClassMethod(p){if(p.node===lifecycle[0])method=p;}});
    if(!method || method.node.kind!=='method' || method.node.async || method.node.static || method.node.generator || method.node.params.length
        || method.node.body.body.length!==1 || !method.get('body.body')[0].isReturnStatement()) throw new Error('No direct SDK action lifecycle return is available to inspect.');
    const options=read(method.get('body.body')[0].get('argument'));
    // An options alias escaping to other code can be mutated through its fields.
    for(const [binding,node] of aliases) if(node===options.node) {
        if(binding.referencePaths.some(reference=>!usedOptions.some(allowed=>allowed.node===reference.node)
            && !(reference.parentPath.isVariableDeclarator() && reference.parentPath.get('init').node===reference.node
                && aliases.get(reference.parentPath.scope.getBinding(reference.parentPath.node.id.name))===options.node)))
            throw new Error('The action options are referenced outside the SDK lifecycle definition.');
    }
    return {node:options.node,file:owners.get(options.node)};
}

function selectorTest(selector) {
    const id=/^#([A-Za-z_][\w-]*)$/.exec(selector);
    if(id)return node=>node.attrs.id===id[1];
    const attr=/^\[([\w:-]+)=(?:"([^"\\]*)"|'([^'\\]*)')]$/.exec(selector);
    if(attr)return node=>node.attrs[attr[1].toLowerCase()]===(attr[2] ?? attr[3]);
    const simple=/^([a-z][\w-]*)?(?:\.([\w-]+))?$/.exec(selector);
    if(simple && (simple[1] || simple[2]))return node=>(!simple[1] || node.tag===simple[1]) && (!simple[2] || (node.attrs.class||'').split(/\s+/).includes(simple[2]));
    return null;
}

export function describeExistingBindings(files,elements,html,ast,plugin) {
    let definition, reason='';
    try {definition=readDefinition(files,ast,plugin);} catch(error){reason=error.message;}
    const options=fields(definition?.node), handlers=fields(options?.get('handlers')?.value), bindings=options?.get('bindings')?.value;
    if(!reason && (!handlers || bindings?.type!=='ArrayExpression' || bindings.elements.length>512)) reason='Handlers and bindings must be static object/array literals.';
    const nodes=[];
    const walk=node=>{if(node.tagName)nodes.push({tag:node.tagName,attrs:Object.fromEntries((node.attrs||[]).map(item=>[item.name,item.value]))});for(const child of node.childNodes||[])walk(child);};
    walk(parseFragment(html));
    if(!reason && (handlers.size>512 || bindings.elements.length*nodes.length>20000))reason='Binding analysis exceeds the static review budget. Narrow the selectors or split the lifecycle definition before editing connections here.';
    const nodeIndices=new Map(nodes.map((node,index)=>[node,index]));
    const choices=reason ? [] : [...handlers].filter(([,property])=>property.type==='ObjectMethod' && property.kind==='method'
        || ['ArrowFunctionExpression','FunctionExpression','StringLiteral'].includes(property.value?.type))
        .filter(([name])=>!['__proto__','constructor','prototype'].includes(name))
        .map(([name,property])=>({name,...excerpt(files,definition.file,property)}));
    const records=reason ? [] : bindings.elements.filter(Boolean).map(node=>{
        const map=fields(node), literal=name=>map?.get(name)?.value;
        const selector=literal('selector'), event=literal('event'), handler=literal('handler');
        const test=selector?.type==='StringLiteral' ? selectorTest(selector.value) : null;
        const matches=test ? nodes.filter(test) : [];
        const plain=map && [...map].every(([name,property])=>property.type==='ObjectProperty'
            && (['selector','event','handler'].includes(name) ? property.value.type==='StringLiteral' : BINDING_FLAGS.includes(name) && property.value.type==='BooleanLiteral'));
        const editable=!!(plain && test && event?.type==='StringLiteral' && handler?.type==='StringLiteral' && choices.some(item=>item.name===handler.value));
        return {id:definition.file+':'+node.start, selector:selector?.value ?? '(dynamic selector)',event:event?.value ?? '(dynamic event)',handler:handler?.value ?? '(dynamic handler)',literalHandler:handler?.type==='StringLiteral',
            options:Object.fromEntries(BINDING_FLAGS.map(name=>[name,literal(name)?.value ?? name==='required'])),
            editable,reason:editable?'':!test?'This selector cannot be matched statically. Its source is available for review.':'This binding has dynamic or unsupported fields. Its source is available for review.',
            matches:matches.length,matchedNodes:matches.map(node=>nodeIndices.get(node)),elementIds:matches.map(node=>node.attrs['data-fdo-ui-id']).filter(Boolean),...excerpt(files,definition.file,node),
            file:definition.file,start:node.start,end:node.end,fields:map ? Object.fromEntries([...map].filter(([,property])=>property.type==='ObjectProperty').map(([name,property])=>[name,{start:property.value.start,end:property.value.end}])) : {},
            removal:sourceNodeRemovalRanges(files[definition.file],bindings.elements,node,bindings.end-1)};
    });
    for(const record of records) {
        const matched=new Set(record.matchedNodes);
        record.otherEvents=[...new Set(records.filter(other=>other.id!==record.id && other.matchedNodes.some(index=>matched.has(index))).map(other=>other.event))];
    }
    const setup=options?.get('setup');
    const setupSource=setup ? excerpt(files,definition.file,setup) : null;
    const management=reason ? null : describeHandlerEdits(files,definition.file,options.get('handlers').value,handlers,records);
    const handlerSources=choices.map(handler=>({...handler,...management?.handlers.get(handler.name),uses:records.filter(item=>item.handler===handler.name).length}));
    const unresolved=records.filter(item=>!selectorTest(item.selector));
    for(const element of elements) {
        const node=nodes.find(node=>node.attrs['data-fdo-ui-id']===element.id);
        if(!node || !['button','input','select','textarea','a'].includes(element.tag) && !records.some(item=>item.elementIds.includes(element.id)))continue;
        const identity=node.attrs.id && /^[A-Za-z_][\w-]*$/.test(node.attrs.id) ? '#'+node.attrs.id : null;
        element.sdkBindings={reason,items:records.filter(item=>item.elementIds.includes(element.id)),
            unresolved,handlers:handlerSources,
            handlerContainer:management ? {file:management.file,start:management.start,names:management.names}:null,
            setup:setupSource,
            connect:!reason && identity && records.every(item=>selectorTest(item.selector)) && nodes.filter(item=>item.attrs.id===node.attrs.id).length===1 ? {selector:identity,file:definition.file,start:bindings.start+1}:null};
    }
}

export function planExistingBinding(files,element,request) {
    const target=element.sdkBindings;
    if(!target || target.reason)throw new Error(target?.reason || 'Refresh the selected element before changing its bindings.');
    const action=request.action;
    let operations=[], description;
    if(action==='add') {
        if(!target.connect)throw new Error('A unique static element ID is required to connect a binding.');
        if(!target.handlers.some(item=>item.name===request.handler) || !BINDING_EVENTS.includes(request.event))throw new Error('Choose an existing handler and supported DOM event.');
        if(target.items.some(item=>item.event===request.event))throw new Error('This element already has a binding for that event. Review it before adding another listener.');
        description='Connect SDK '+request.event+' binding';
        operations=[{file:target.connect.file,start:target.connect.start,end:target.connect.start,
            replacement:JSON.stringify({selector:target.connect.selector,event:request.event,handler:request.handler})+', '}];
    } else {
        const item=target.items.find(item=>item.id===request.bindingId);
        if(!item?.editable)throw new Error(item?.reason || 'Select a current editable SDK binding.');
        if(item.matches>1 && request.confirmShared!==true)throw new Error('Review and acknowledge that this binding affects all matching controls.');
        if(action==='remove') {
            description='Disconnect SDK '+item.event+' binding';
            operations=item.removal.map(range=>({file:item.file,...range,replacement:''}));
        } else if(action==='update') {
            if(!target.handlers.some(handler=>handler.name===request.handler) || !BINDING_EVENTS.includes(request.event) && request.event!==item.event)throw new Error('Choose an existing handler and supported DOM event.');
            if(request.event!==item.event && item.otherEvents.includes(request.event))throw new Error('A matching control already has a binding for that event.');
            if(!request.options || Object.keys(request.options).some(name=>!BINDING_FLAGS.includes(name)) || BINDING_FLAGS.some(name=>typeof request.options[name]!=='boolean'))throw new Error('Supply the supported boolean listener options.');
            if(request.options.passive && request.options.preventDefault)throw new Error('A passive listener cannot prevent the default event.');
            description='Update SDK '+item.event+' binding';
            const values={handler:request.handler,event:request.event,...request.options};
            for(const [name,value] of Object.entries(values)) if(value!==(BINDING_FLAGS.includes(name)?item.options[name]:item[name])) {
                const range=item.fields[name];
                operations.push({file:item.file,start:range?.start ?? item.start+1,end:range?.end ?? item.start+1,
                    replacement:range?JSON.stringify(value):JSON.stringify(name)+': '+JSON.stringify(value)+', '});
            }
            if(!operations.length)throw new Error('These binding settings already match.');
        } else throw new Error('Choose a supported binding operation.');
    }
    const current={...files},patches=[];
    for(const operation of operations.sort((a,b)=>b.start-a.start)) {
        const {file,start,end,replacement}=operation,before=current[file];
        const after=before.slice(0,start)+replacement+before.slice(end);
        patches.push({...operation,before,after,removed:before.slice(start,end),added:replacement,description,affected:1});
        current[file]=after;
    }
    return {...patches[0],patches};
}
