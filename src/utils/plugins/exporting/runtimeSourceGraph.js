import path from 'node:path';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse=traverseModule.default || traverseModule;
const normalize=value=>'/'+String(value).replace(/^virtual:/,'').replace(/^\/+/, '');

// Follow imports rather than directory names: a runtime dependency in scripts/
// must still be checked, while an unimported smoke test must not block export.
export function runtimeSourceGraph(files,entry,metafile) {
    const root=normalize(entry),selected=new Set([root]),pending=[root];
    if(metafile)for(const name of Object.keys(metafile.inputs)) {
        const file=normalize(name);
        if(Object.hasOwn(files,file)){selected.add(file);pending.push(file);}
    }
    const result=()=>({files:Object.fromEntries([...selected].filter(file=>typeof files[file]==='string').map(file=>[file,files[file]])),
        included:[...selected].filter(file=>Object.hasOwn(files,file)).sort(),excluded:Object.keys(files).filter(file=>/\.[cm]?[jt]sx?$/.test(file) && !selected.has(file)).sort()});
    if(metafile)return result();
    const resolve=(from,value)=>{
        if(!value.startsWith('.'))return null;
        const target=path.posix.resolve(path.posix.dirname(from),value);
        const stems=[target,...(/\.[cm]?js$/.test(target)?[target.replace(/\.[cm]?js$/,'')]:[])];
        return stems.flatMap(stem=>[stem,...['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts','.json','.css','/index.ts','/index.tsx','/index.js'].map(extension=>stem+extension)]).find(file=>Object.hasOwn(files,file));
    };
    const visited=new Set();
    while(pending.length) {
        const file=pending.pop();if(visited.has(file))continue;visited.add(file);
        if(!/\.[cm]?[jt]sx?$/.test(file))continue;
        let ast;try{ast=parse(files[file],{sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy']});}catch{continue;}
        const include=value=>{if(typeof value!=='string')return;const dependency=resolve(file,value);if(dependency && !selected.has(dependency)){selected.add(dependency);pending.push(dependency);}};
        traverse(ast,{
            ImportDeclaration(p){if(p.node.importKind!=='type' && (!p.node.specifiers.length || p.node.specifiers.some(item=>item.importKind!=='type')))include(p.node.source.value);},
            'ExportNamedDeclaration|ExportAllDeclaration'(p){if(p.node.exportKind!=='type')include(p.node.source?.value);},
            CallExpression(p){if(p.node.callee.name==='require' || p.node.callee.type==='Import')include(p.node.arguments[0]?.value);},
        });
    }
    return result();
}
