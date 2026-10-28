import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {parseFragment} from 'parse5';
import {isGeneratedTestFile} from './generatedWorkspaceTestDiagnostics';

const traverse = traverseModule['default'] || traverseModule;
const events = new Set(['click','dblclick','auxclick','submit','input','change','keydown','keyup','keypress',
    'pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','contextmenu','drop','dragstart','dragend']);
const actionHelpers = new Set(['defineRenderOnLoadActions','createRenderOnLoadActionsSource']);
const omitted = new Set(['start','end','loc','extra','leadingComments','trailingComments','innerComments']);
const canonical = node => JSON.stringify(node,(key,value)=>omitted.has(key) ? undefined : value);
const key = node => node?.computed ? node.property?.value : node?.property?.name;
const property = node => node?.computed ? node.key?.value : node?.key?.name ?? node?.key?.value;
const unwrap = path => ['TSAsExpression','TSNonNullExpression','TSTypeAssertion','TSSatisfiesExpression','ParenthesizedExpression'].includes(path?.node?.type)
    ? unwrap(path.get('expression')) : path;
function resolve(path, seen = new Set()) {
    path = unwrap(path);
    if (!path?.node || seen.has(path.node)) return path;
    seen.add(path.node);
    if (path.isIdentifier()) {
        const binding = path.scope.getBinding(path.node.name);
        if (binding?.constant && binding.path.isVariableDeclarator() && binding.path.node.init) return resolve(binding.path.get('init'),seen);
    }
    return path;
}
function literal(path) {
    path = resolve(path);
    if (path?.isStringLiteral()) return path.node.value;
    if (path?.isTemplateLiteral() && !path.node.expressions.length) return path.node.quasis[0].value.cooked;
    if (path?.isBinaryExpression({operator:'+'})) {
        const left=literal(path.get('left')),right=literal(path.get('right'));
        if (typeof left==='string' && typeof right==='string') return left+right;
    }
}
function eventNames(path) {
    const value=literal(path);
    if (typeof value==='string') return [value];
    path=resolve(path);
    if (path?.isConditionalExpression()) return [...eventNames(path.get('consequent')),...eventNames(path.get('alternate'))];
    if (!path?.isIdentifier()) return [];
    const binding=path.scope.getBinding(path.node.name),owner=binding?.path;
    let values;
    if (owner?.isVariableDeclarator() && owner.parentPath.parentPath?.isForOfStatement()) values=resolve(owner.parentPath.parentPath.get('right'));
    const fn=owner?.parentPath;
    if (fn?.isFunction() && fn.node.params[0]===owner.node && fn.parentPath.isCallExpression()
        && ['forEach','map'].includes(key(fn.parentPath.node.callee))) values=resolve(fn.parentPath.get('callee.object'));
    return values?.isArrayExpression() ? values.get('elements').flatMap(item=>{const value=literal(item);return typeof value==='string'?[value]:[];}) : [];
}
function sdkActionName(call) {
    const callee=call.get('callee');
    let imported;
    if (callee.isIdentifier()) imported=callee.scope.getBinding(callee.node.name)?.path;
    else if (callee.isMemberExpression()) {
        const binding=callee.scope.getBinding(callee.node.object.name)?.path;
        if (binding?.isImportNamespaceSpecifier() && /^@anikitenko\/fdo-sdk(?:\/ui)?$/.test(binding.parent.source.value)) return key(callee.node);
    }
    if (imported?.isImportSpecifier() && /^@anikitenko\/fdo-sdk(?:\/ui)?$/.test(imported.parent.source.value)
        && imported.node.importKind!=='type' && imported.parent.importKind!=='type') return imported.node.imported.name || imported.node.imported.value;
}
function domTarget(path) {
    path=resolve(path);
    if (!path?.node) return false;
    if (path.isCallExpression() || path.isOptionalCallExpression()) return ['querySelector','getElementById','closest'].includes(key(path.node.callee));
    if (path.isMemberExpression() || path.isOptionalMemberExpression()) return key(path.node)==='forms' || domTarget(path.get('object'));
    return path.isIdentifier() && /HTMLFormElement/.test(canonical(path.node.typeAnnotation) || '');
}
function serialized(path) {
    return !!path.findParent(parent => {
        if (parent.isReturnStatement()) return true;
        if (parent.isClassMethod() || parent.isObjectMethod()) return /^(renderOnLoad|onLoad)$/.test(parent.node.key.name || parent.node.key.value);
        if (parent.isFunctionDeclaration()) return /(?:onLoad|renderOnLoad|Script|Source)$/.test(parent.node.id?.name || '');
        if (parent.isVariableDeclarator()) return /script|source|onload|handler/i.test(parent.node.id?.name || '');
        if (parent.isCallExpression()) return /^(defineRenderOnLoad|defineRenderOnLoadActions|createRenderOnLoadActionsSource)$/.test(parent.node.callee.name || key(parent.node.callee) || '');
        return false;
    });
}

// A generation contract, not a security audit or a runtime sandbox. Inspect ASTs
// and decoded frontend source without executing workspace code or callbacks.
function findings(file) {
    const result=[];
    const add=(node,reason,signature,origin=1)=>result.push({signature:reason+':'+signature,
        message:`${file.path}:${origin + (node?.loc?.start.line || 1) - 1}: SDK_ACTION_BINDING_REQUIRED: user interactions must use defineRenderOnLoadActions(...) with explicit bindings; command controls use type="button" and event="click". ${reason} Return the SDK descriptor from renderOnLoad(); keep DOM mutations inside its handlers and backend mutations in registered handlers.`});
    const html=(text,node,origin)=>{
        if (!/<(?:button|input|form|[a-z][\w:-]*\s[^>]*\bon[a-z]+=)/i.test(text)) return;
        let count=0;
        const walk=(item,inForm=false)=>{
            if (++count>20000) return;
            const attrs=new Map((item.attrs||[]).map(attr=>[attr.name,attr.value]));
            for (const [name,value] of attrs) if (name.startsWith('on') && events.has(name.slice(2))) add(node,`Replace inline ${name} markup with an SDK binding.`,canonical([item.tagName,name,value]),origin);
            const type=attrs.get('type')?.toLowerCase();
            if ((item.tagName==='button' && (type==='submit' || inForm && !type)) || item.tagName==='input' && type==='submit') {
                add(node,'Native form submission is unsupported in the plugin iframe; use an explicit command button.',canonical([item.tagName,'submit',attrs.get('id')||attrs.get('name')||'']),origin);
            }
            for (const child of item.childNodes||[]) walk(child,inForm||item.tagName==='form');
        };
        walk(parseFragment(text));
    };
    const inspect=(source,origin=1,depth=0)=>{
        if (depth>4 || source.length>2000000) return;
        let ast;
        try {ast=parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy'],allowReturnOutsideFunction:true});}
        catch {return;} // Source syntax validation owns malformed modules.
        const call=path=>{
            const callee=path.get('callee'),method=key(callee.node);
            if (callee.isMemberExpression() || callee.isOptionalMemberExpression()) {
                const event=literal(path.get('arguments.0'));
                const interactive=eventNames(path.get('arguments.0')).filter(name=>events.has(name));
                if (method==='addEventListener' && interactive.length) add(path.node,`Replace the manual ${[...new Set(interactive)].join('/')} listener, including listeners inside setup, with an SDK handler/binding.`,canonical(path.node),origin);
                if (['submit','requestSubmit'].includes(method) && domTarget(callee.get('object'))) add(path.node,`Replace form.${method}() with the same SDK action used by the command button.`,canonical(path.node),origin);
                if (method==='setAttribute' && /^on/.test(event||'') && events.has(event.slice(2))) add(path.node,'Do not install HTML event handlers with setAttribute().',canonical(path.node),origin);
                if (method==='setAttribute' && event==='type' && literal(path.get('arguments.1'))==='submit' && domTarget(callee.get('object'))) add(path.node,'Use a type="button" command control instead of switching to native submission.',canonical(path.node),origin);
                if (method==='createElement' || method==='createStaticButton') {
                    const tag=method==='createStaticButton'?'button':literal(path.get('arguments.0'));
                    const options=resolve(path.get(method==='createStaticButton'?'arguments.3':'arguments.1'));
                    if (options?.isObjectExpression()) for (const prop of options.get('properties')) {
                        const name=property(prop.node);
                        if (['button','input'].includes(tag) && name==='type' && literal(prop.get('value'))==='submit') add(prop.node,'Replace the SDK DOM submit control with a type="button" command control.',canonical(prop.node),origin);
                        if (/^on/.test(name||'') && events.has(name.slice(2))) add(prop.node,`Replace the inline ${name} DOM property with an SDK binding.`,canonical(prop.node),origin);
                    }
                }
            }
            if (actionHelpers.has(sdkActionName(path))) {
                const options=resolve(path.get('arguments.0'));
                if (options?.isObjectExpression()) for (const prop of options.get('properties')) if (property(prop.node)==='bindings') {
                    const bindings=resolve(prop.get('value'));
                    if (bindings?.isArrayExpression()) for (const binding of bindings.get('elements')) {
                        const value=resolve(binding);
                        if (value?.isObjectExpression()) for (const field of value.get('properties')) if (property(field.node)==='event' && literal(field.get('value'))==='submit') {
                            add(field.node,'Use a click binding for the command; do not depend on form submission.',canonical(field.node),origin);
                        }
                    }
                }
            }
        };
        try {traverse(ast,{
            CallExpression:call,OptionalCallExpression:call,
            AssignmentExpression(path){
                const left=path.node.left,name=key(left);
                const clearing=path.node.right.type==='NullLiteral' || path.get('right').isIdentifier({name:'undefined'});
                if (!clearing && ['MemberExpression','OptionalMemberExpression'].includes(left.type) && /^on/.test(name||'') && events.has(name.slice(2))) add(path.node,`Replace the manual ${name} assignment with an SDK binding.`,canonical(path.node),origin);
                if (name==='type' && literal(path.get('right'))==='submit' && domTarget(path.get('left.object'))) add(path.node,'Use a type="button" command control instead of switching to native submission.',canonical(path.node),origin);
            },
            TemplateLiteral(path){
                const text=path.node.quasis.map((quasi,index)=>(quasi.value.cooked||'')+(index<path.node.expressions.length?`__fdo_template_hole_${index}__`:'')).join('');
                html(text,path.node,origin);
                if (depth || serialized(path)) inspect(text,origin+(path.node.loc?.start.line||1)-1,depth+1);
            },
            StringLiteral(path){html(path.node.value,path.node,origin);if ((depth||serialized(path)) && /addEventListener|\.on\w+\s*=|requestSubmit|\.submit\s*\(/.test(path.node.value)) inspect(path.node.value,origin+(path.node.loc?.start.line||1)-1,depth+1);},
        });} catch (error) {
            // Babel can parse import/local collisions before its scope crawler
            // rejects them. Preserve the syntax diagnostic and its repair owner.
            if (!/Duplicate declaration|already been declared/.test(error.message)) throw error;
        }
    };
    inspect(file.content);
    return result;
}

export function validateGeneratedInteractions(files,{baseline=[]}={}) {
    const original=new Map(baseline.map(file=>[file.path,file]));
    return files.flatMap(file=>{
        if (!/\.[cm]?[jt]sx?$/.test(file.path) || isGeneratedTestFile(file.path)) return [];
        const before=original.get(file.path);
        if (before?.content===file.content) return [];
        const retained=new Map();
        for (const issue of before ? findings(before) : []) retained.set(issue.signature,(retained.get(issue.signature)||0)+1);
        return findings(file).flatMap(issue=>{
            const count=retained.get(issue.signature)||0;
            if (count) {retained.set(issue.signature,count-1);return [];}
            return [issue.message];
        });
    });
}
