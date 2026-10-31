import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse=traverseModule.default || traverseModule;

// Preserve the installed public ABI and its validation/storage semantics, while
// removing the private desktop transport. HTTP invokes the registry directly.
// The generated project neither installs nor resolves the SDK package.
export function compileWebContractRuntime(source) {
    const ast=parse(source,{sourceType:'script'}),edits=[];
    traverse(ast,{CallExpression(p){if(p.node.callee.name==='require' && p.node.arguments[0]?.value==='electron')edits.push({start:p.node.arguments[0].start,end:p.node.arguments[0].end,value:JSON.stringify('./native.cjs')});}});
    let entry,transport,baseFound=false;
    traverse(ast,{ClassDeclaration(p){
        if(p.node.id?.name==='Communicator')transport=p.findParent(parent=>parent.isObjectMethod() || parent.isObjectProperty());
        if(p.node.id?.name!=='FDO_SDK')return;
        baseFound=true;
        for(const member of p.node.body.body) {
            if(member.key?.name==='communicator')edits.push({start:member.start,end:member.end,value:''});
            if(member.kind!=='constructor')continue;
            for(const statement of member.body.body) {
                const expression=statement.expression;
                const assignment=expression?.type==='AssignmentExpression' && expression.left.type==='MemberExpression' && expression.left.object.type==='ThisExpression' && expression.left.property.name==='communicator';
                const emission=expression?.type==='CallExpression' && expression.callee.type==='MemberExpression' && expression.callee.object.type==='MemberExpression' && expression.callee.object.object.type==='ThisExpression' && expression.callee.object.property.name==='communicator';
                if(assignment || emission)edits.push({start:statement.start,end:statement.end,value:''});
            }
        }
        entry=p.findParent(parent=>parent.isObjectMethod() || parent.isObjectProperty());
    }});
    if(!baseFound || !entry || !transport)throw new Error('The installed contract artifact needs a web-runtime compiler update.');
    const transportId=transport.node.key.value;
    entry.traverse({VariableDeclaration(p){
        if(p.node.declarations.length===1 && p.node.declarations[0].init?.callee?.name==='__webpack_require__' && p.node.declarations[0].init.arguments[0]?.value===transportId)edits.push({start:p.node.start,end:p.node.end,value:''});
    }});
    edits.push({start:transport.node.start,end:transport.node.end,value:`${JSON.stringify(transportId)}() { throw new Error("Desktop transport is not part of this web runtime."); }`});
    return '/* Public contract compiled for a standalone HTTP backend. Desktop transport removed. Original notices retained. */\n'+edits.sort((a,b)=>b.start-a.start).reduce((value,edit)=>value.slice(0,edit.start)+edit.value+value.slice(edit.end),source);
}

// Webpack-authored plugins may embed their own SDK. Rebind that public module
// to the export's reviewed contract instead of starting an embedded communicator.
export function rebindEmbeddedWebContract(source,request) {
    const ast=parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy']});
    const edits=[],rebound=new Set();
    const factoryFor=p=>p.findParent(parent=>parent.isObjectMethod() && typeof parent.node.key.value==='number');
    const bind=p=>{
        const factory=factoryFor(p);if(!factory || !factory.node.params[1]?.name || rebound.has(factory.node))return;
        rebound.add(factory.node);
        edits.push({start:factory.node.body.start,end:factory.node.body.end,value:`{Object.assign(${factory.node.params[1].name},require(${JSON.stringify(request)}));}`});
    };
    traverse(ast,{
        CallExpression(p){
            if(p.node.callee.name==='require' && p.node.arguments[0]?.value==='electron')edits.push({start:p.node.arguments[0].start,end:p.node.arguments[0].end,value:JSON.stringify(request.replace('authoring.cjs','native.cjs'))});
            if(p.node.callee.type==='MemberExpression' && p.node.callee.property.name==='defineProperty' && p.node.arguments[1]?.value==='FDO_SDK')bind(p);
        },
        ObjectProperty(p){if((p.node.key.name || p.node.key.value)==='FDO_SDK' && ['ArrowFunctionExpression','FunctionExpression'].includes(p.node.value.type))bind(p);},
        ClassDeclaration(p){
            if(/^_?Communicator\d*$/.test(p.node.id?.name || '')){const factory=factoryFor(p);if(factory)edits.push({start:factory.node.body.start,end:factory.node.body.end,value:'{throw new Error("Desktop transport was removed from the web application.");}'});}
            if(/^_?FDO_SDK\d*$/.test(p.node.id?.name || ''))bind(p);
        },
    });
    return edits.filter(edit=>!edits.some(outer=>outer!==edit && outer.start<=edit.start && outer.end>=edit.end)).sort((a,b)=>b.start-a.start).reduce((value,edit)=>value.slice(0,edit.start)+edit.value+value.slice(edit.end),source);
}
