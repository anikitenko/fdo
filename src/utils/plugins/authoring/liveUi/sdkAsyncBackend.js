import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {isNodesEquivalent} from '@babel/types';
import {backendDeclarations} from './backendActions';
import nodePath from 'node:path';

const parseModule=source=>parse(source,{sourceType:'module',plugins:['typescript','jsx']});
export function asyncBackendNames(handler) {
    const match=/^visualAsync(Text|Json)Backend(\d+)$/.exec(handler || '');
    if(!match) return null;
    const suffix=match[1]+match[2];
    return {input:'VisualAsyncInput'+suffix,result:'VisualAsyncResult'+suffix,
        implementation:'handleVisualAsync'+suffix,registry:'VisualAsyncRegistry'+suffix};
}
export function asyncBackendSource(row) {
    const names=asyncBackendNames(row.backend);
    return backendDeclarations(row.preset,names.input,names.result,names.implementation);
}
export function asyncBackendCreation(files,context,row) {
    const names=asyncBackendNames(row.backend);
    return [
        {file:'/index.ts',start:0,end:0,replacement:`import {PluginRegistry as ${names.registry}} from '@anikitenko/fdo-sdk';\n`},
        {file:'/index.ts',start:context.initInsert,end:context.initInsert,replacement:`\n        ${names.registry}.registerHandler(${JSON.stringify(row.backend)}, ${names.implementation});\n`},
        {file:'/index.ts',start:files['/index.ts'].length,end:files['/index.ts'].length,replacement:asyncBackendSource(row)},
    ];
}
// Only unchanged, privately owned declarations can be removed automatically.
export function asyncBackendCleanup(files,row,setup) {
    if(!row?.backend) return {operations:[]};
    const names=asyncBackendNames(row.backend),operations=[],owned=[];
    const reason='Generated async backend code is modified, shared or referenced elsewhere. Review its setup and cleanup in the IDE.';
    try {
        const modules=Object.entries(files).filter(([file])=>/\.[cm]?[jt]sx?$/.test(file)).map(([file,source])=>[file,parseModule(source)]);
        const ast=modules.find(([file])=>file==='/index.ts')[1];
        const expected=[...parseModule(`import {PluginRegistry as ${names.registry}} from '@anikitenko/fdo-sdk';`).program.body,
            ...parseModule(asyncBackendSource(row)).program.body];
        const traverse=traverseModule.default || traverseModule;
        for(const node of expected) {
            const matches=ast.program.body.filter(candidate=>isNodesEquivalent(candidate,node));
            if(matches.length!==1) return {reason};
            const original=matches[0];
            if(ast.comments.some(comment=>comment.start>original.start && comment.end<original.end)) return {reason};
            const range={file:'/index.ts',start:original.start,end:original.end,replacement:''};
            operations.push(range);owned.push(range);
            for(const comment of original.leadingComments || []) if(node.leadingComments?.some(item=>item.value===comment.value)) operations.push({file:'/index.ts',start:comment.start,end:comment.end,replacement:''});
        }
        const registration=parseModule(`${names.registry}.registerHandler(${JSON.stringify(row.backend)}, ${names.implementation});`).program.body[0];
        const matches=[];
        traverse(ast,{ExpressionStatement(path){if(isNodesEquivalent(path.node,registration)) matches.push(path.node);}});
        if(matches.length!==1) return {reason};
        if(ast.comments.some(comment=>comment.start>matches[0].start && comment.end<matches[0].end)) return {reason};
        const range={file:'/index.ts',start:matches[0].start,end:matches[0].end,replacement:''};
        operations.push(range);owned.push(range);
        if(setup) owned.push({file:'/index.ts',...setup});
        const identifiers=new Set([row.backend,...Object.values(names)]);
        let referenced=false;
        for(const [file,module] of modules) traverse(module,{enter(path){
            const node=path.node;
            if(owned.some(item=>item.file===file && node.start>=item.start && node.end<=item.end)) return;
            const value=node.type==='Identifier' ? node.name : node.type==='StringLiteral' ? node.value : node.type==='TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;
            if(identifiers.has(value)) referenced=true;
            if(['ImportDeclaration','ExportAllDeclaration','ExportNamedDeclaration'].includes(node.type) && node.source?.value.startsWith('.')) {
                const resolved=nodePath.posix.resolve(nodePath.posix.dirname(file),node.source.value);
                if(['/','/index','/index.ts','/index.tsx'].includes(resolved)) referenced=true;
            }
        }});
        return referenced ? {reason} : {operations};
    } catch {return {reason};}
}
