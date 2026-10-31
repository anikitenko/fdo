import {subset,validRange} from 'semver';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {createToolchainPlan} from '../exporting/toolchainPlan';
import catalog from '../../../../contracts/web-export-tools.json';
import exportContract from '../../../../contracts/web-export.json';
import {resolveGeneratedImport} from '../validation/generatedWorkspaceImports';
import {pluginBuildSource} from '../runtime/pluginBuildArtifact';
const traverse=Reflect.get(traverseModule,'default') || traverseModule;
const PACKAGE='/package.json';
const object=value=>value && typeof value==='object' && !Array.isArray(value);
export const DEPLOYMENT_REVIEW_PROMPT='Workspace quality review. Focus on this plugin’s deployment requirements. Trace its actual CLI calls, validate fdo.deployment against the supplied host catalog, and separate source defects from image installation, cloud authentication and resource authorization. Propose only justified package/source changes. Host source inspection, builds, typechecks and plugin tests may supply evidence. Do not run CLI installers, cloud commands or login, grant permissions, invent artifact URLs/checksums, or remove requirements to silence diagnostics. Review first; source changes wait for the normal engineer review workflow.';
const basename=value=>String(value).split(/[\\/]/).at(-1).replace(/\.exe$/i,'');
const stable=value=>JSON.stringify(value && typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(stable(item) || 'null')):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]) || 'null')])):value);
const entries=input=>Array.isArray(input)?Object.fromEntries(input.map(file=>[file.path,file.content])):input || {};
const helpers=new Set(['createScopedProcessExecActionRequest','createProcessExecActionRequest','createOperatorToolActionRequest']);
function readPackage(source) {
    if(typeof source!=='string')throw new Error('Create package.json to declare deployment requirements.');
    const pkg=JSON.parse(source);
    if(!object(pkg) || pkg.fdo!=null && !object(pkg.fdo))throw new Error('package.json and its fdo field must be objects.');
    return pkg;
}
function usage(files) {
    /** @type {Array<{command?: string, id?: string|null, path: string, line: number, confirmed: boolean, dynamic?: boolean, expression?: string}>} */
    const evidence=[];
    const candidates=new Map(),seen=new Set(),limitations=[];
    let entry;try{entry=pluginBuildSource(files);}catch{ /* Package diagnostics are reported separately. */ }
    if(!entry)try{entry=JSON.parse(files[PACKAGE] || '{}').main;}catch{ /* Incomplete package. */ }
    const pending=entry?['/'+entry.replace(/^\/+/, '')]:Object.keys(files).filter(file=>/^\/(?:src\/)?index\.[cm]?[jt]sx?$/.test(file));
    const paths=new Set(Object.keys(files));
    const add=(command,file,node,confirmed)=>{
        const id=Object.entries(catalog.tools).find(([,tool])=>tool.commands.includes(basename(command)))?.[0];
        const candidate={command,id:id || null,path:file,line:node.loc?.start.line || 1,confirmed};
        if(id && (!candidates.has(id) || confirmed))candidates.set(id,candidate);
        return candidate;
    };
    let processDetected=false;
    while(pending.length && seen.size<250) {
        const file=pending.pop();if(seen.has(file) || typeof files[file]!=='string' || !/\.[cm]?[jt]sx?$/.test(file) || /(?:node_modules|dist)\//.test(file))continue;seen.add(file);
        let ast;try{ast=parse(files[file],{sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy']});}catch{limitations.push(file+': source inspection is incomplete.');continue;}
        const include=value=>{if(typeof value!=='string' || !value.startsWith('.'))return;const resolved=resolveGeneratedImport(file,value,paths);if(resolved)pending.push(resolved);};
        traverse(ast,{
            ImportDeclaration(p){if(p.node.importKind!=='type')include(p.node.source.value);},
            'ExportNamedDeclaration|ExportAllDeclaration'(p){if(p.node.exportKind!=='type')include(p.node.source?.value);},
            CallExpression(p){
                const node=p.node;if(node.callee.name==='require' || node.callee.type==='Import')include(node.arguments[0]?.value);
                const callee=node.callee.type==='SequenceExpression'?node.callee.expressions.at(-1):node.callee;
                let name=callee.name || callee.property?.name;
                const binding=callee.type==='Identifier'?p.scope.getBinding(callee.name)?.path:null;
                if(binding?.isImportSpecifier())name=binding.node.imported.name;
                if(!helpers.has(name))return;
                processDetected=true;
                const options=node.arguments.find(argument=>argument?.type==='ObjectExpression');
                const command=options?.properties.find(property=>(property.key?.name || property.key?.value)==='command')?.value;
                evidence.push(command?.type==='StringLiteral'?add(command.value,file,command,true):{path:file,line:node.loc.start.line,confirmed:false,dynamic:true,expression:command?files[file].slice(command.start,command.end):'SDK preset / wrapper'});
            },
            ObjectProperty(p){const name=p.node.key.name || p.node.key.value;if(/^(?:cli|command|executable|cliPath|commandPath)$/i.test(name) && p.node.value.type==='StringLiteral')add(p.node.value.value,file,p.node.value,false);},
            StringLiteral(p){if(p.node.value==='system.process.exec')processDetected=true;},
        });
    }
    return {processDetected,evidence,candidates:processDetected?[...candidates.values()]:[],limitations};
}
export function deploymentCatalog() {return {schemaVersion:catalog.schemaVersion,exportContractVersion:exportContract.contractVersion,baseImage:catalog.baseImage,tools:catalog.tools};}
export function workspaceDeployment(input={}) {
    const files=entries(input),observed=usage(files),errors=[];
    let pkg={},declaration=null,plan=null,editable=false;
    try {
        pkg=readPackage(files[PACKAGE]);
        editable=true;declaration=pkg.fdo?.deployment ?? null;
        if(declaration!=null && (!object(declaration) || declaration.schemaVersion!==catalog.schemaVersion || !Array.isArray(declaration.tools) || declaration.tools.some(tool=>!object(tool) || typeof tool.id!=='string' || tool.installer!=null && !object(tool.installer))))editable=false;
        plan=createToolchainPlan(files[PACKAGE],[]);
    }catch(error){errors.push(error.message);}
    const declaredIds=new Set(plan?.tools.map(tool=>tool.id) || []);
    const uncovered=observed.candidates.filter(candidate=>candidate.confirmed && !declaredIds.has(candidate.id));
    const unknownCalls=observed.evidence.filter(item=>item.confirmed && !item.id && !plan?.tools.some(tool=>tool.commands.includes(basename(item.command))));
    const status=errors.length?'invalid':!declaration && observed.processDetected?'needs-declaration':uncovered.length || unknownCalls.length?'needs-review':declaration?'declared':'no-tools-detected';
    const tools=plan?.tools || [];
    const authentication=[...new Map([...tools.map(tool=>({id:tool.id,...tool})),...observed.candidates.filter(item=>!declaredIds.has(item.id)).map(item=>({id:item.id,...catalog.tools[item.id]}))]
        .filter(tool=>tool.authentication).map(tool=>[tool.authentication.provider,{toolId:tool.id,...tool.authentication,status:'not-verified'}])).values()];
    return {status,editable,declaration,tools,suggestions:observed.candidates.filter(candidate=>!declaredIds.has(candidate.id)),usage:observed.evidence,
        packageAvailable:typeof files[PACKAGE]==='string',processDetected:observed.processDetected,errors,uncovered,unknownCalls,authentication,catalog:deploymentCatalog(),
        checks:{declaration:status,installation:'not-run',authentication:authentication.length?'not-verified':'not-assessed',authorization:'not-verified'},
        limitations:observed.limitations,
        nextStep:errors.length?'Correct the declaration in package.json.':status==='needs-declaration'?'Review the detected CLI usage and declare the tools actually required.':uncovered.length || unknownCalls.length?'Review CLI calls not covered by the declared tool list.':'Build the exported image to verify installation; configure any required runtime identity and external-service permissions.'};
}
export function deploymentInstructions(files) {
    const state=workspaceDeployment(files);
    const facts={...state,catalog:{...state.catalog,tools:Object.fromEntries(Object.entries(state.catalog.tools).map(([id,tool])=>[id,{commands:tool.commands,version:tool.version,executable:tool.executable,installer:tool.installer.type}]))}};
    return 'PLUGIN DEPLOYMENT CONTRACT (host-owned; source evidence, not execution)\n'+JSON.stringify(facts)+'\n'
        +`Every CLI-backed scaffold must plan package.json fdo.deployment with schemaVersion ${state.catalog.schemaVersion} and the actual required tools. A process allowlist contains permitted alternatives, not a dependency installation list. Use the supplied catalog for IDs and versions; do not guess installers, download URLs or hashes. Preserve existing declarations, required version constraints, custom sources and base-image pins. Static preview, TypeScript, build and tests do not establish installed CLIs, Azure login or cloud RBAC. Those are deployment checks, never source repair by disabling working operations, embedding credentials, running login during render/init, or widening grants. For ambiguous/custom dependencies, state the exact engineer decision and use Live UI → Deployment requirements.\n`;
}
export function deploymentFindings(files) {
    const state=workspaceDeployment(files),hasPackage=typeof entries(files)[PACKAGE]==='string';
    if(!hasPackage)return [];
    return [...state.errors.map(message=>({severity:'error',file:PACKAGE,code:'FDO_DEPLOYMENT_INVALID',issue:'Invalid deployment declaration.',evidence:message,repair:'Correct fdo.deployment using the host schema and catalog. Preserve capabilities, support ranges and unrelated package fields; do not invent artifact sources or checksums.'})),
        ...state.uncovered.map(item=>({severity:'warning',file:PACKAGE,code:'FDO_DEPLOYMENT_UNDECLARED',issue:`CLI ${item.id} is called but is absent from the deployment tool list.`,evidence:`${item.path}:${item.line} calls ${item.command}.`,repair:`Review adding the catalog tool ${item.id} to fdo.deployment.tools. Preserve all existing requirements and process policies. Image installation and cloud authentication are separate, unverified deployment steps.`}))];
}
export function validateAiDeploymentChanges(beforeInput,afterInput) {
    const beforeFiles=entries(beforeInput),afterFiles=entries(afterInput),after=workspaceDeployment(afterFiles),before=workspaceDeployment(beforeFiles),errors=[];
    if(Object.hasOwn(afterFiles,PACKAGE))errors.push(...after.errors.map(message=>PACKAGE+': '+message));
    const newlyIntroduced=after.usage.filter(item=>item.confirmed).filter(item=>!before.usage.some(old=>old.confirmed && old.command===item.command));
    const introducedProcess=after.processDetected && !before.processDetected;
    if((newlyIntroduced.length || introducedProcess && after.usage.length) && !after.declaration)errors.push(PACKAGE+': FDO_DEPLOYMENT_REQUIRED: New CLI calls require fdo.deployment.tools. Add justified catalog dependencies in this workspace change; use Live UI Deployment requirements for custom tools.');
    if((newlyIntroduced.length || introducedProcess) && after.usage.length && after.declaration && !after.declaration.tools?.length)errors.push(PACKAGE+': FDO_DEPLOYMENT_REQUIRED: Identify the CLI used by the new process calls; an empty tools list cannot describe those dependencies. Review it in Live UI Deployment requirements.');
    if(newlyIntroduced.length || introducedProcess)for(const item of after.unknownCalls)errors.push(PACKAGE+': FDO_DEPLOYMENT_UNKNOWN: '+item.command+' needs a reviewed custom tool definition in Live UI Deployment requirements; do not invent an installer or checksum.');
    if(newlyIntroduced.length)for(const item of after.uncovered)errors.push(PACKAGE+': FDO_DEPLOYMENT_UNDECLARED: Declare the required catalog tool '+item.id+'.');
    if(before.declaration && after.declaration && before.declaration.schemaVersion!==after.declaration.schemaVersion)errors.push(PACKAGE+': AI cannot migrate or downgrade the deployment schema during code repair. Review the supported schema and migrate explicitly in the IDE.');
    if(before.declaration) {
        if(!after.declaration)errors.push(PACKAGE+': AI cannot remove the deployment declaration to bypass setup checks. Review removals in Live UI Deployment requirements.');
        else {
            const nextIds=new Set((Array.isArray(after.declaration.tools)?after.declaration.tools:[]).map(tool=>tool.id));
            for(const previous of Array.isArray(before.declaration.tools)?before.declaration.tools:[]){const next=(Array.isArray(after.declaration.tools)?after.declaration.tools:[]).find(item=>item.id===previous.id);if(!next)continue;const oldRange=previous.version || catalog.tools[previous.id]?.version || '*',newRange=next.version || catalog.tools[next.id]?.version || '*';if(validRange(oldRange) && validRange(newRange) && !subset(newRange,oldRange))errors.push(PACKAGE+': AI cannot weaken the required version for '+previous.id+' from '+oldRange+' to '+newRange+'. Review version policy changes in Live UI Deployment requirements.');}
            for(const tool of Array.isArray(before.declaration.tools)?before.declaration.tools:[])if(!nextIds.has(tool.id))errors.push(PACKAGE+': AI cannot remove required tool '+tool.id+' to silence deployment diagnostics. Review the change in Live UI.');
        }
    }
    if(after.declaration?.baseImage!==before.declaration?.baseImage)errors.push(PACKAGE+': Review base-image changes in Live UI Deployment requirements before AI uses them.');
    for(const tool of Array.isArray(after.declaration?.tools)?after.declaration.tools:[])if(tool.installer && stable(tool)!==stable((Array.isArray(before.declaration?.tools)?before.declaration.tools:[]).find(previous=>previous.id===tool.id)))errors.push(PACKAGE+': Review custom installer changes for '+tool.id+' in Live UI Deployment requirements; AI must not invent trusted artifact sources or hashes.');
    return [...new Set(errors)];
}
