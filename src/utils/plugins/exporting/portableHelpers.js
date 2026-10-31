import {parse} from '@babel/parser';

// Compile only dependency-closed, environment-independent helper modules from
// the installed SDK artifact. No SDK entrypoint, registry or communicator is
// evaluated or included. A changed artifact format fails conversion explicitly.
const visit=(node,fn)=>{
    if(!node || typeof node!=='object')return;
    if(typeof node.type==='string')fn(node);
    for(const [key,value] of Object.entries(node))if(!['loc','start','end','comments','tokens'].includes(key)) {
        if(Array.isArray(value))value.forEach(item=>visit(item,fn));
        else if(value && typeof value==='object')visit(value,fn);
    }
};
export function compilePortableHelpers(source,names) {
    const ast=parse(source,{sourceType:'script'});
    let factories;
    visit(ast,node=>{if(node.type==='VariableDeclarator' && node.id.name==='__webpack_modules__')factories=node.init;});
    if(factories?.type!=='ObjectExpression')throw new Error('The installed SDK helper artifact needs an updated web converter.');
    const modules=new Map(factories.properties.map(property=>[property.key.value,property]));
    const exported=new Map();
    for(const property of factories.properties) {
        const imports=new Map();
        visit(property,node=>{
            if(node.type==='VariableDeclarator' && node.init?.type==='CallExpression' && node.init.callee.name==='__webpack_require__')imports.set(node.id.name,node.init.arguments[0]?.value);
        });
        visit(property,node=>{
            if(node.type!=='CallExpression' || node.callee.type!=='MemberExpression' || node.callee.property.name!=='d' || node.arguments[1]?.type!=='ObjectExpression')return;
            for(const entry of node.arguments[1].properties) {
                const body=entry.value?.body;
                if(body?.type==='MemberExpression' && imports.has(body.object.name))exported.set(entry.key.name || entry.key.value,{id:imports.get(body.object.name),name:body.property.name});
            }
        });
    }
    const selected=new Set(),select=id=>{
        if(selected.has(id))return;
        const property=modules.get(id);
        if(!property)throw new Error('A helper has an unresolved runtime dependency.');
        selected.add(id);
        visit(property,node=>{
            if(node.type!=='CallExpression')return;
            if(node.callee.name==='require')throw new Error('This helper depends on a host or Node service and needs a dedicated web adapter.');
            if(node.callee.type==='MemberExpression' && node.callee.object.name==='__webpack_require__' && !['r','d','n','o','nmd'].includes(node.callee.property.name))throw new Error('This helper needs an updated build-time module converter.');
            if(node.callee.name==='__webpack_require__') {
                const target=node.arguments[0];
                if(target?.type!=='NumericLiteral')throw new Error('This helper has a dynamic runtime dependency.');
                select(target.value);
            }
        });
    };
    const output=[];
    for(const name of [...new Set(names)]) {
        const target=exported.get(name);
        if(!target)throw new Error(`SDK export ${name} needs a dedicated web conversion.`);
        try{select(target.id);}catch(error){throw new Error(`SDK export ${name}: ${error.message}`);}
        output.push(`exports[${JSON.stringify(name)}]=load(${target.id})[${JSON.stringify(target.name)}];`);
    }
    const definitions=[...selected].map(id=>{
        const property=modules.get(id);
        // Object methods need their key; function values need the numeric key.
        return property.type==='ObjectMethod'?source.slice(property.start,property.end):JSON.stringify(id)+':'+source.slice(property.value.start,property.value.end);
    }).join(',\n');
    return `/* Converted pure authoring helpers. Original SDK ISC and bundled third-party license notices are retained below. No SDK runtime is loaded. */
const factories={${definitions}},cache={};
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};factories[id](module,module.exports,load);return module.exports;}
load.d=(target,values)=>{if(Array.isArray(values)){let i=0;while(i<values.length){const key=values[i++],binding=values[i++],descriptor=binding===0?{enumerable:true,value:values[i++]}:{enumerable:true,get:binding};if(!Object.hasOwn(target,key))Object.defineProperty(target,key,descriptor);}}else for(const key in values)if(!Object.hasOwn(target,key))Object.defineProperty(target,key,{enumerable:true,get:values[key]});};
load.o=(target,key)=>Object.hasOwn(target,key);
load.r=target=>Object.defineProperty(target,'__esModule',{value:true});
load.n=value=>{const get=value&&value.__esModule?()=>value.default:()=>value;load.d(get,{a:get});return get;};
load.g=globalThis;load.nmd=module=>{module.paths=[];module.children ||= [];return module;};
${output.join('\n')}
`;
}
