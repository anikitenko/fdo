import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {parseFragment} from 'parse5';
import {isGeneratedTestFile} from './generatedWorkspaceTestDiagnostics';

const traverse = traverseModule['default'] || traverseModule;
const events = new Set(['click','dblclick','auxclick','submit','input','change','keydown','keyup','keypress',
    'pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','contextmenu','drop','dragstart','dragend']);
const actionHelpers = new Set(['defineRenderOnLoadActions','createRenderOnLoadActionsSource']);
export const INTERACTION_DIAGNOSTIC_CODE = 'SDK_ACTION_BINDING_REQUIRED';
export {isSandboxedFormSubmissionError} from '../authoring/pluginActionGuidance';
const productionFile = file => /\.[cm]?[jt]sx?$/.test(file.path) && !isGeneratedTestFile(file.path)
    && !/\.d\.[cm]?ts$|(?:^|\/)(?:fixtures?|docs?|node_modules)(?:\/|$)/i.test(file.path);
const omitted = new Set(['start','end','loc','extra','leadingComments','trailingComments','innerComments']);
const canonical = node => JSON.stringify(node,(key,value)=>omitted.has(key) ? undefined : value);
const key = node => node?.computed ? node.property?.value : node?.property?.name;
const property = node => node?.computed ? node.key?.value : node?.key?.name ?? node?.key?.value;
const textInputType = type => !['hidden','checkbox','radio','file','button','submit','image','reset','range','color'].includes(String(type||'text').toLowerCase());
function htmlTextFields(node) {
    return (node.tagName==='input' && textInputType(node.attrs?.find(attr=>attr.name==='type')?.value)?1:0)
        +(node.childNodes||[]).reduce((total,child)=>total+htmlTextFields(child),0);
}
const unwrap = path => ['TSAsExpression','TSNonNullExpression','TSTypeAssertion','TSSatisfiesExpression','ParenthesizedExpression'].includes(path?.node?.type)
    ? unwrap(path.get('expression')) : path;
function resolve(path, seen = new Set()) {
    path = unwrap(path);
    if (!path?.node || seen.has(path.node)) return path;
    seen.add(path.node);
    if (path.isIdentifier()) {
        const binding = path.scope.getBinding(path.node.name);
        if (binding?.constant && binding.path.isVariableDeclarator() && binding.path.node.init) return resolve(binding.path.get('init'),seen);
        if(binding?.constant && binding.path.isFunctionDeclaration())return binding.path;
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
function attributeValue(path,name,seen=new Set()) {
    path=resolve(path);
    if(!path?.node)return undefined;
    if(!path.isObjectExpression()||seen.has(path.node))return null;
    seen=new Set(seen).add(path.node);
    for(const prop of path.get('properties').reverse()){
        if(prop.isSpreadElement()){
            const value=attributeValue(prop.get('argument'),name,seen);
            if(value!==undefined)return value;
        }else if(String(property(prop.node)||'').toLowerCase()===name)return prop.get('value');
    }
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
    if(/HTML(?:Form|Button|Input)Element/.test(canonical(path?.node?.typeAnnotation)||''))return true;
    path=resolve(path);
    if (!path?.node) return false;
    if (path.isCallExpression() || path.isOptionalCallExpression()) return ['querySelector','getElementById','closest','createElement'].includes(key(path.node.callee));
    if (path.isMemberExpression() || path.isOptionalMemberExpression()) return key(path.node)==='forms' || domTarget(path.get('object'));
    return path.isIdentifier() && /HTMLFormElement/.test(canonical(path.scope.getBinding(path.node.name)?.path.node.typeAnnotation) || '');
}
function textData(path) {
    const parent=path.findParent(item=>item.isAssignmentExpression()||item.isFunction());
    return parent?.isAssignmentExpression() && ['textContent','innerText','value'].includes(key(parent.node.left));
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

function staticTextFields(path,seen=new Set()) {
    path=resolve(path);
    if(!path?.node || seen.has(path.node))return null;
    seen=new Set(seen).add(path.node);
    const text=literal(path);
    if(typeof text==='string')return htmlTextFields(parseFragment(text));
    let children;
    if(path.isArrayExpression())children=path.get('elements');
    else if(path.isCallExpression()){
        const method=key(path.node.callee),args=path.get('arguments');
        if(['createStaticButton','createButton'].includes(method))return 0;
        if(method==='createInput')return typeof literal(args[0])==='string'?Number(textInputType(literal(args[0]))):null;
        if(method==='createElement'){
            const tag=literal(args[0]),props=resolve(args[1]);
            if(tag==='input'){
                if(!props?.isObjectExpression())return null;
                const type=props.get('properties').find(prop=>property(prop.node)==='type');
                return Number(textInputType(type?literal(type.get('value')):'text'));
            }
            children=args.slice(2);
        }else return null;
    }else return null;
    const counts=children.map(child=>staticTextFields(child,seen));
    return counts.includes(null)?null:counts.reduce((total,count)=>total+count,0);
}

function keyboardGuard(options) {
    const props=options.get('properties'),handlers=resolve(props.find(prop=>property(prop.node)==='handlers')?.get('value'));
    const bindings=resolve(props.find(prop=>property(prop.node)==='bindings')?.get('value'));
    if(!bindings?.isArrayExpression())return false;
    for(const item of bindings.get('elements')){
        const binding=resolve(item);
        if(!binding?.isObjectExpression())continue;
        const fields=binding.get('properties'),field=name=>fields.find(prop=>property(prop.node)===name)?.get('value');
        if(!['keydown','keypress'].includes(literal(field('event'))))continue;
        if(field('preventDefault')?.isBooleanLiteral({value:true}))return true;
        const handlerName=literal(field('handler'));
        const prop=handlers?.isObjectExpression() && handlers.get('properties').find(prop=>property(prop.node)===handlerName);
        const handler=prop && (prop.isObjectMethod()?prop:resolve(prop.get('value')));
        if(!handler?.node)continue;
        let guarded=false;
        const call=path=>{if(key(path.node.callee)==='preventDefault')guarded=true;};
        if(handler.isFunction())handler.traverse({CallExpression:call,OptionalCallExpression:call});
        else if(typeof literal(handler)==='string'){
            try{traverse(parse('('+literal(handler)+')',{plugins:['typescript']}),{CallExpression:call,OptionalCallExpression:call});}catch{/* SDK validation owns invalid handlers. */}
        }
        if(guarded)return true;
    }
    return false;
}

// A generation contract, not a security audit or a runtime sandbox. Inspect ASTs
// and decoded frontend source without executing workspace code or callbacks.
function findings(file) {
    const result=[],implicitButtons=[],enterForms=[];let hasForms=false,hasKeyboardGuard=false;
    const add=(node,reason,signature,origin=1,target=result)=>target.push({signature:reason+':'+signature,
        message:`${file.path}:${origin + (node?.loc?.start.line || 1) - 1}: SDK_ACTION_BINDING_REQUIRED: user interactions must use defineRenderOnLoadActions(...) with explicit bindings; command controls use type="button" and event="click". ${reason} Return the SDK descriptor from renderOnLoad(); keep DOM mutations inside its handlers and backend mutations in registered handlers.`});
    const html=(text,node,origin)=>{
        if (!/<(?:button|input|form|[a-z][\w:-]*\s[^>]*\bon[a-z]+=)/i.test(text)) return;
        if(/^\s*[\[{]/.test(text)){try{JSON.parse(text);return;}catch{/* Not a JSON sample. */}}
        let count=0;
        const walk=item=>{
            if (++count>20000) return;
            const attrs=new Map((item.attrs||[]).map(attr=>[attr.name,attr.value]));
            if(item.tagName==='form'){
                hasForms=true;
                if(htmlTextFields(item)===1)add(node,'A form with one text-entry input can submit implicitly on Enter. Use an SDK keydown guard or a non-submitting grouping element.',canonical(['implicit-enter',attrs.get('id')||'']),origin,enterForms);
            }
            for (const [name,value] of attrs) if (name.startsWith('on') && events.has(name.slice(2))) add(node,`Replace inline ${name} markup with an SDK binding.`,canonical([item.tagName,name,value]),origin);
            const type=attrs.get('type')?.toLowerCase();
            if ((item.tagName==='button' && type==='submit') || item.tagName==='input' && ['submit','image'].includes(type)) {
                add(node,'Native form submission is unsupported in the plugin iframe; use an explicit command button.',canonical([item.tagName,'submit',attrs.get('id')||attrs.get('name')||'']),origin);
            }
            if(item.tagName==='button' && !['button','reset','submit'].includes(type))add(node,'A button without a valid explicit type defaults to submit when associated with a form. Use type="button".',canonical(['implicit-button',attrs.get('id')||attrs.get('name')||'']),origin,implicitButtons);
            for (const child of item.childNodes||[]) walk(child);
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
                if(method==='createForm' || method==='createElement' && event==='form')hasForms=true;
                if(method==='createForm' && staticTextFields(path.get('arguments.0'))===1
                    || method==='createElement' && event==='form' && path.get('arguments').slice(2).reduce((total,child)=>{
                        const count=staticTextFields(child);return total===null||count===null?null:total+count;
                    },0)===1)add(path.node,'An SDK-built form with one text-entry input can submit implicitly on Enter. Use an SDK keydown guard or a non-submitting grouping element.',canonical(path.node),origin,enterForms);
                const interactive=eventNames(path.get('arguments.0')).filter(name=>events.has(name));
                if (method==='addEventListener' && interactive.length) add(path.node,`Replace the manual ${[...new Set(interactive)].join('/')} listener, including listeners inside setup, with an SDK handler/binding.`,canonical(path.node),origin);
                if (['submit','requestSubmit'].includes(method) && domTarget(callee.get('object'))) add(path.node,`Replace form.${method}() with the same SDK action used by the command button.`,canonical(path.node),origin);
                if (method==='setAttribute' && /^on/.test(event||'') && events.has(event.slice(2))) add(path.node,'Do not install HTML event handlers with setAttribute().',canonical(path.node),origin);
                if (method==='setAttribute' && event==='type' && literal(path.get('arguments.1'))==='submit' && domTarget(callee.get('object'))) add(path.node,'Use a type="button" command control instead of switching to native submission.',canonical(path.node),origin);
                if(method==='createInput' && ['submit','image'].includes(event))add(path.node,'SDK submit/image inputs still invoke native form submission; use a type="button" command.',canonical(path.node),origin);
                if (method==='createElement' || method==='createStaticButton' || method==='createButton') {
                    const tag=method==='createElement'?event:'button';
                    const options=resolve(path.get(method==='createStaticButton'?'arguments.3':method==='createButton'?'arguments.4':'arguments.1'));
                    const typeField=attributeValue(options,'type');
                    const types=typeField===null?null:typeField===undefined?[]:eventNames(typeField).map(type=>type.toLowerCase());
                    if (options?.isObjectExpression()) for (const prop of options.get('properties')) {
                        const name=property(prop.node);
                        if (/^on/i.test(name||'') && events.has(name.slice(2).toLowerCase())) add(prop.node,`Replace the inline ${name} DOM property with an SDK binding.`,canonical(prop.node),origin);
                    }
                    if(['button','input'].includes(tag) && types?.some(type=>['submit','image'].includes(type)))add(path.node,'Replace the SDK DOM submit control with a type="button" command control.',canonical(path.node),origin);
                    if(tag==='button' && types && (!types.length && !typeField || types.some(type=>!['button','reset','submit'].includes(type))))add(path.node,'An SDK-built button without a valid explicit type defaults to submit when associated with a form. Set type="button" in its attributes.',canonical(path.node),origin,implicitButtons);
                    if(method==='createButton')add(path.node,'Replace the legacy SDK inline button callback with createStaticButton and an SDK action binding.',canonical(path.node),origin);
                }
            }
            if (actionHelpers.has(sdkActionName(path))) {
                const options=resolve(path.get('arguments.0'));
                if(options?.isObjectExpression() && keyboardGuard(options))hasKeyboardGuard=true;
                if (options?.isObjectExpression()) for (const prop of options.get('properties')) if (property(prop.node)==='bindings') {
                    const bindings=resolve(prop.get('value'));
                    if (bindings?.isArrayExpression()) for (const binding of bindings.get('elements')) {
                        const value=resolve(binding);
                        if (value?.isObjectExpression()) for (const field of value.get('properties')) if (property(field.node)==='event') {
                            const event=literal(field.get('value'));
                            if(event==='submit')add(field.node,'Use a click binding for the command; do not depend on form submission.',canonical(field.node),origin);
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
                if(path.parentPath.isTSLiteralType()||path.parentPath.isTSTemplateLiteralType?.()||textData(path))return;
                const text=path.node.quasis.map((quasi,index)=>(quasi.value.cooked||'')+(index<path.node.expressions.length?`__fdo_template_hole_${index}__`:'')).join('');
                html(text,path.node,origin);
                if (depth || serialized(path)) inspect(text,origin+(path.node.loc?.start.line||1)-1,depth+1);
            },
            StringLiteral(path){if(path.parentPath.isTSLiteralType()||textData(path))return;html(path.node.value,path.node,origin);if ((depth||serialized(path)) && /addEventListener|\.on\w+\s*=|requestSubmit|\.submit\s*\(/.test(path.node.value)) inspect(path.node.value,origin+(path.node.loc?.start.line||1)-1,depth+1);},
        });} catch (error) {
            // Babel can parse import/local collisions before its scope crawler
            // rejects them. Preserve the syntax diagnostic and its repair owner.
            if (!/Duplicate declaration|already been declared/.test(error.message)) throw error;
        }
    };
    inspect(file.content);
    return {issues:result,implicitButtons,enterForms,hasForms,hasKeyboardGuard};
}

function workspaceFindings(files,{checkKeyboard=true}={}) {
    const entries=files.filter(productionFile).map(file=>[file.path,findings(file)]);
    const hasForms=entries.some(([,entry])=>entry.hasForms);
    const hasKeyboardGuard=entries.some(([,entry])=>entry.hasKeyboardGuard);
    return new Map(entries.map(([path,entry])=>[path,[...entry.issues,...(hasForms?entry.implicitButtons:[]),...(checkKeyboard&&!hasKeyboardGuard?entry.enterForms:[])]]));
}

export function validateGeneratedInteractions(files,{baseline=[],requiredPaths=[],checkKeyboard=true}={}) {
    const original=workspaceFindings(baseline,{checkKeyboard}),current=workspaceFindings(files,{checkKeyboard});
    return files.flatMap(file=>{
        const retained=new Map();
        for (const issue of requiredPaths.includes(file.path)?[]:original.get(file.path)||[]) retained.set(issue.signature,(retained.get(issue.signature)||0)+1);
        return (current.get(file.path)||[]).flatMap(issue=>{
            const count=retained.get(issue.signature)||0;
            if (count) {retained.set(issue.signature,count-1);return [];}
            return [issue.message];
        });
    });
}

export function findWorkspaceInteractionIssues(files=[]) {
    return [...workspaceFindings(files)].flatMap(([file,issues])=>issues.length?[{
        severity:'warning',code:INTERACTION_DIAGNOSTIC_CODE,file,
        issue:'UI interactions use unsupported event wiring or native form submission.',
        evidence:issues.map(issue=>issue.message).join('\n'),
        repair:'Migrate the confirmed interaction wiring to defineRenderOnLoadActions with strict bindings and a stable lifecycleKey returned from renderOnLoad. Use explicit type="button" controls and SDK click actions. Prevent implicit Enter submission through an SDK keydown handler that calls event.preventDefault only for the command key, or use a non-submitting SDK grouping element. Preserve validation, accessibility, multiline input, pending/error states, confirmations and backend handlers. The host sandbox intentionally has no allow-forms permission; do not request or add it. Verify real clicks and Enter produce the intended action without native submission.',
    }]:[]);
}

export function interactionRepairDiagnostics(findings=[]) {
    return findings.filter(finding=>finding.code===INTERACTION_DIAGNOSTIC_CODE).map(finding=>`${finding.file}:1: ${INTERACTION_DIAGNOSTIC_CODE}: ${finding.repair}`).join('\n');
}
