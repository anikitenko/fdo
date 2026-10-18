import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as sdk from '@anikitenko/fdo-sdk';
import {normalizeCapabilityList,toCanonicalCapabilityId} from '../plugins/security/pluginCapabilities';
const traverse=traverseModule.default||traverseModule;
const helpers=new Set(['createCapabilityBundle','createSSHCapabilityBundle','createSecretsCapabilityBundle','createFilesystemCapabilityBundle','createProcessCapabilityBundle','createWorkflowCapabilityBundle','createStorageCapabilityBundle','createAICapabilityBundle','createNetworkScopeCapability','createNetworkCapabilityBundle','createOperatorToolCapabilityPreset']);
const problem=()=>new Error('The capability declaration could not be inspected safely. Use a static array or SDK capability helpers with constant arguments; the approved version has been kept.');

// Evaluate only literal data and installed, allowlisted SDK factories. Never
// execute candidate modules, constructors, lifecycle code or arbitrary helpers.
export function inspectGitOpsCapabilities(content) {
 try {
  const ast=parse(content,{sourceType:'unambiguous',plugins:['typescript','jsx']});let steps=0;const visiting=new Set();
  const imported=(nodePath)=>{
   if(nodePath.isSequenceExpression())return imported(nodePath.get('expressions').at(-1));
   if(nodePath.isIdentifier()) {
    const binding=nodePath.scope.getBinding(nodePath.node.name);if(!binding?.constant)return null;
    const p=binding.path;
    if(p.isImportSpecifier()&&p.parent.source.value==='@anikitenko/fdo-sdk')return p.node.imported.name;
    if(p.isVariableDeclarator()&&p.node.id.type==='ObjectPattern'&&p.node.init?.type==='CallExpression'&&p.node.init.callee.name==='require'&&p.node.init.arguments[0]?.value==='@anikitenko/fdo-sdk')return p.node.id.properties.find(item=>item.value?.name===nodePath.node.name)?.key?.name;
   }
   if(nodePath.isMemberExpression()&&!nodePath.node.computed&&nodePath.get('object').isIdentifier()) {
    const binding=nodePath.scope.getBinding(nodePath.node.object.name);if(!binding?.constant)return null;
    const p=binding.path;
    const namespace=p.isImportNamespaceSpecifier()&&p.parent.source.value==='@anikitenko/fdo-sdk';
    const required=p.isVariableDeclarator()&&p.node.init?.type==='CallExpression'&&p.node.init.callee.name==='require'&&p.node.init.arguments[0]?.value==='@anikitenko/fdo-sdk';
    if(namespace||required)return nodePath.node.property.name;
   }
   return null;
  };
  const value=p=>{
   if(++steps>10000||!p?.node)throw problem();
   if(p.isStringLiteral()||p.isBooleanLiteral()||p.isNumericLiteral()||p.isNullLiteral())return p.node.value??null;
   if(p.isTSAsExpression()||p.isTSSatisfiesExpression()||p.isParenthesizedExpression())return value(p.get('expression'));
   if(p.isArrayExpression())return p.get('elements').flatMap(item=>item.isSpreadElement()?value(item.get('argument')):[value(item)]);
   if(p.isObjectExpression()) {
    const result=Object.create(null);
    for(const item of p.get('properties')) {
     if(!item.isObjectProperty()||item.node.computed)throw problem();
     const name=item.node.key.name||item.node.key.value;
     if(['__proto__','constructor','prototype'].includes(name))throw problem();result[name]=value(item.get('value'));
    }
    return result;
   }
   if(p.isIdentifier()) {
    const binding=p.scope.getBinding(p.node.name);
    if(!binding?.constant||!binding.path.isVariableDeclarator()||visiting.has(binding))throw problem();
    // Mutation/escape outside the declaration makes static data unreliable.
    if(binding.referencePaths.some(reference=>reference.parentPath.isMemberExpression()&&(reference.parentPath.parentPath.isAssignmentExpression()||reference.parentPath.parentPath.isCallExpression())))throw problem();
    visiting.add(binding);try{return value(binding.path.get('init'));}finally{visiting.delete(binding);}
   }
   if(p.isCallExpression()) {
    const name=imported(p.get('callee'));if(!helpers.has(name)||typeof sdk[name]!=='function')throw problem();
    const args=p.get('arguments').map(argument=>value(argument));
    return sdk[name](...args);
   }
   throw problem();
  };
  const declarations=[];
  traverse(ast,{
   ClassMethod(p){if((p.node.key.name||p.node.key.value)==='declareCapabilities'){if(p.node.computed||p.node.kind!=='method'||p.node.static)throw problem();declarations.push(p);}},
   'ClassProperty|ObjectMethod|ObjectProperty'(p){if((p.node.key?.name||p.node.key?.value)==='declareCapabilities')throw problem();},
   MemberExpression(p){if((p.node.property.name||p.node.property.value)==='declareCapabilities')throw problem();},
  });
  if(!declarations.length)return {capabilities:[],error:''};
  if(declarations.length!==1)return {capabilities:[],error:problem().message};
  const body=declarations[0].get('body.body');
  if(body.some(p=>!p.isVariableDeclaration()&&!p.isReturnStatement())||body.filter(p=>p.isReturnStatement()).length!==1)return {capabilities:[],error:problem().message};
  const result=value(body.find(p=>p.isReturnStatement()).get('argument'));
  if(!Array.isArray(result)||result.length>512||result.some(item=>typeof item!=='string'||item.length>200))return {capabilities:[],error:problem().message};
  const canonical=[...new Set(result.map(toCanonicalCapabilityId))].sort();
  if(normalizeCapabilityList(canonical).length!==canonical.length)return {capabilities:[],error:'This update requests capabilities the installed FDO does not support. Update FDO before approving it.'};
  return {capabilities:canonical,error:''};
 }catch(error){return {capabilities:[],error:error.message?.startsWith('This update requests capabilities')?error.message:problem().message};}
}
