import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import contract from '../../../../contracts/web-export.json';
import {KNOWN_PLUGIN_CAPABILITIES,toCanonicalCapabilityId} from '../security/pluginCapabilities';
import {getGrantedNetworkScopePolicies} from '../security/networkScopeRegistry';
import {inspectGitOpsCapabilities} from '../../gitops/inspectCapabilities';
const traverse=Reflect.get(traverseModule,'default') || traverseModule;
export const WEB_EXPORT_CONTRACT=contract;
const runtimeExports=new Set(['FDO_SDK','PluginRegistry','SecretStore','requireCapability']);
const reservedService=name=>/^fdo\.(auth|session)\./.test(name)?'authentication':/^fdo\.ai\./.test(name)?'ai':name==='fdo.browser.open.v1'?'browser':null;
const helperAdapters={createProcessCapabilityBundle:'process',createScopedProcessExecActionRequest:'process',createProcessExecActionRequest:'process',createOperatorToolActionRequest:'process',createFilesystemMutateActionRequest:'filesystem',createHostsWriteActionRequest:'filesystem',createSSHCapabilityBundle:'ssh',createAICapabilityBundle:'ai'};
function isBrowserWindow(node,scope,seen=new Set()) {
    while(node && ['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression'].includes(node.type))node=node.expression;
    if(node?.type!=='Identifier')return false;
    if(node.name==='window')return !scope.getBinding(node.name);
    if(seen.has(node.name) || seen.size>12)return false;
    seen.add(node.name);const binding=scope.getBinding(node.name);
    return !!binding?.constant && binding.path.isVariableDeclarator() && isBrowserWindow(binding.path.node.init,binding.path.scope,seen);
}
export function capabilityAdapter(id) {
    return contract.capabilities[toCanonicalCapabilityId(id)] || Object.entries(contract.scopeFamilies).find(([prefix])=>id.startsWith(prefix))?.[1];
}
export function analyzeWebExport(files,plugin={},declarationOverride) {
    const blockers=[],capabilities=new Set(),services=new Set(),imports=new Set(),locations=[];
    let declarationFailed=!!declarationOverride?.error;
    const location=(file,node,adapter,symbol)=>{if(!locations.some(item=>item.file===file && item.line===node.loc.start.line && item.symbol===symbol))locations.push({file,line:node.loc.start.line,column:node.loc.start.column+1,adapter,symbol});};
    if(declarationOverride?.error)blockers.push('Runtime capability declaration: '+declarationOverride.error);
    declarationOverride?.capabilities.forEach(id=>capabilities.add(id));
    for(const id of KNOWN_PLUGIN_CAPABILITIES)if(!capabilityAdapter(id))blockers.push(`The web conversion contract has no mapping for host capability ${id}.`);
    for(const [file,source] of Object.entries(files)) {
        if(!/\.[cm]?[jt]sx?$/.test(file) || /\.d\.[jt]s$/.test(file))continue;
        let ast;
        try{ast=parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy']});}
        catch(error){blockers.push(`${file}: ${error.message}`);continue;}
        if(!declarationOverride) {
            const declaration=inspectGitOpsCapabilities(source);
            if(declaration.error){declarationFailed=true;blockers.push(`${file}: ${declaration.error}`);}
            declaration.capabilities.forEach(id=>capabilities.add(id));
        }
        traverse(ast,{
            ImportDeclaration(p) {
                const node=p.node;
                if(node.importKind==='type')return;
                if(node.source.value==='@anikitenko/fdo-sdk') {
                    for(const specifier of node.specifiers)if(specifier.importKind!=='type') {
                        if(specifier.type!=='ImportSpecifier')continue;
                        else {
                            const references=p.scope.getBinding(specifier.local.name)?.referencePaths || [];
                            if(references.some(reference=>!reference.findParent(parent=>parent.node.type.startsWith('TS') && !['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression'].includes(parent.node.type))))imports.add(specifier.imported.name || specifier.imported.value);
                            if(specifier.imported.name==='SecretStore')services.add('encrypted-secrets');
                        }
                    }
                } else if(node.source.value==='electron')blockers.push(`${file}: Electron APIs must be replaced with web behavior.`);
                else if(node.source.value.startsWith('@anikitenko/fdo-sdk/'))blockers.push(`${file}: SDK subpath ${node.source.value} needs an explicit web conversion.`);
                
                if(/^(?:node:)?(?:net|tls|dgram|dns)(?:\/|$)/.test(node.source.value))services.add('raw-network');
            },
            StringLiteral(p) {
                const adapter=reservedService(p.node.value);
                if(adapter){services.add(adapter);location(file,p.node,adapter,p.node.value);}
                const permissionAdapter=capabilityAdapter(p.node.value);
                if(permissionAdapter)location(file,p.node,permissionAdapter,p.node.value);
                if(['requestPrivilegedAction','__host.privilegedAction'].includes(p.node.value))for(const capability of capabilities) {
                    const adapter=capabilityAdapter(capability);
                    if(['process','filesystem','clipboard'].includes(adapter))location(file,p.node,adapter,p.node.value);
                }
                if(p.node.value==='system.fs.mutate' || ['system.host.write','system.hosts.write'].includes(p.node.value) && p.parent.type==='ObjectProperty' && (p.parent.key.name || p.parent.key.value)==='action')services.add('filesystem');
                if(/<script\b/i.test(p.node.value))blockers.push(`${file}:${p.node.loc.start.line}: move inline scripts into self-contained frontend actions before web conversion.`);
            },
            TemplateElement(p){if(/<script\b/i.test(p.node.value.raw))blockers.push(`${file}:${p.node.loc.start.line}: move inline scripts into self-contained frontend actions before web conversion.`);},
            ClassMethod(p){if(p.node.key.name==='declareCapabilities')location(file,p.node,'declaration','declareCapabilities');},
            MemberExpression(p) {
                const name=p.node.computed?p.node.property.value:p.node.property.name;

                if(name==='ssh' && p.node.object.type==='ThisExpression'){services.add('ssh');location(file,p.node,'ssh','this.ssh');}
                if(name==='secrets' && p.node.object.type==='ThisExpression'){services.add('encrypted-secrets');location(file,p.node,'encrypted-secrets','this.secrets');}
                if(['electron','ipcRenderer','parentPort'].includes(name))blockers.push(`${file}:${p.node.loc.start.line}: desktop messaging must be replaced with a web operation.`);
                if(isBrowserWindow(p.node.object,p.scope) && ['Notyf','Chart','Terminal','ReactDOM','lodash','_','dayjs','moment'].includes(name))blockers.push(`${file}:${p.node.loc.start.line}: browser library ${name} needs a standalone frontend bundle or replacement with supported UI helpers.`);
                if(isBrowserWindow(p.node.object,p.scope) && name==='FDOCharts'){services.add('charts');location(file,p.node,'charts','FDOCharts');}
            },
            CallExpression(p) {
                const node=p.node;
                const binding=node.callee.type==='Identifier'?p.scope.getBinding(node.callee.name)?.path:null;
                const sdkHelper=binding?.isImportSpecifier() && binding.parent.source.value==='@anikitenko/fdo-sdk'?binding.node.imported.name:null;
                if(helperAdapters[sdkHelper])location(file,node,helperAdapters[sdkHelper],sdkHelper);
                if(node.type==='CallExpression' && node.callee.type==='MemberExpression' && node.callee.property.name==='createElement' && node.arguments[0]?.value==='script')blockers.push(`${file}: script elements need an explicit frontend module conversion.`);
                if(node.callee.type==='Identifier' && node.callee.name==='fetch' || node.callee.type==='MemberExpression' && node.callee.object.name==='window' && node.callee.property.name==='fetch')services.add('network');

                if(node.callee.name==='require' || node.callee.type==='Import') {
                    const target=node.arguments[0]?.value;
                    
                    if(typeof target==='string' && /^(?:node:)?(?:net|tls|dgram|dns)(?:\/|$)/.test(target))services.add('raw-network');
                    if(target==='electron' || target?.startsWith('@anikitenko/fdo-sdk/'))blockers.push(`${file}: ${target} needs an explicit standalone conversion.`);
                }
                if(['Import','Identifier'].includes(node.callee.type) && (node.callee.type==='Import' || node.callee.name==='require') && node.arguments[0]?.type!=='StringLiteral')blockers.push(`${file}: dynamic module loading cannot be converted safely.`);
            },
        });
    }
    const granted=new Set((plugin.capabilities || []).map(toCanonicalCapabilityId));
    if(!declarationFailed && services.has('encrypted-secrets') && !capabilities.has('secrets.use'))blockers.push('SecretStore usage requires a declared and approved secrets.use capability.');
    if(!declarationFailed && services.has('network') && !capabilities.has('system.network'))blockers.push('Network usage requires declared and approved transport and destination capabilities.');
    const networkScopes=getGrantedNetworkScopePolicies([...capabilities]);
    for(const capability of capabilities)if(capability.startsWith('system.network.scope.') && !networkScopes.some(scope=>'system.network.scope.'+scope.scope===capability))blockers.push(`Network scope ${capability} has no resolved destination policy. Supply an explicit web deployment policy.`);
    const requirements=[...capabilities].map(id=>{
        const adapter=capabilityAdapter(id),definition=contract.adapters[adapter];
        if(!definition)blockers.push(`Capability ${id} has no standalone mapping.`);
        if(!granted.has(id))blockers.push(`Capability ${id} is declared but is not approved for this plugin. Review its grants before exporting.`);
        services.add(adapter);
        return {capability:id,adapter,status:definition?.status || 'blocked',description:definition?.description || 'No conversion available.'};
    });
    const adapters=[...services].filter(Boolean).map(id=>({id,...contract.adapters[id]}));
    for(const adapter of adapters)if(adapter.status==='blocked')blockers.push(adapter.description);
    return {contractVersion:contract.contractVersion,applicationApiVersion:contract.applicationApiVersion,
        capabilities:[...capabilities].sort(),requirements,adapters,locations,
        imports:[...imports].sort(),helpers:[...imports].filter(name=>!runtimeExports.has(name)),
        blockers:[...new Set(blockers)],warnings:[
            'The exported application is a single trusted workspace. Browser sessions share its backend state; it is not a multi-tenant service.',
            'Desktop data, credentials, grants outside this plugin, certificates and SSH profiles are never included.',
            'Cloud network access, persistent volumes and application access credentials must be configured separately.',
        ]};
}
