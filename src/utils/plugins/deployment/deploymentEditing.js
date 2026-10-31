import {createToolchainPlan} from '../exporting/toolchainPlan';
import {workspaceDeployment} from './workspaceDeployment';
const PACKAGE='/package.json';
const read=source=>{if(typeof source!=='string')throw new Error('Create package.json before editing deployment requirements.');const pkg=JSON.parse(source);if(!pkg || typeof pkg!=='object' || Array.isArray(pkg) || pkg.fdo!=null && (typeof pkg.fdo!=='object' || Array.isArray(pkg.fdo)))throw new Error('package.json and its fdo field must be objects.');return pkg;};
const without=pkg=>{const result={...pkg};if(result.fdo){const {deployment,...rest}=result.fdo;if(Object.keys(rest).length)result.fdo=rest;else delete result.fdo;}else delete result.fdo;return result;};
export function reviewDeploymentChange(beforeFiles,afterFiles) {
    const changed=[...new Set([...Object.keys(beforeFiles),...Object.keys(afterFiles)])].filter(file=>beforeFiles[file]!==afterFiles[file]);
    if(changed.some(file=>file!==PACKAGE))throw new Error('A deployment edit may change only package.json fdo.deployment.');
    const before=read(beforeFiles[PACKAGE]),after=read(afterFiles[PACKAGE]);
    if(JSON.stringify(without(before))!==JSON.stringify(without(after)))throw new Error('Deployment changes cannot modify source, scripts, dependencies, support policy or capability grants.');
    if(!changed.length)return {deployment:before.fdo?.deployment || null,assessment:workspaceDeployment(beforeFiles),warnings:[]};
    if(!after.fdo?.deployment)throw new Error('Use an explicit tools: [] declaration for no CLI dependencies; do not remove the deployment contract.');
    createToolchainPlan(afterFiles[PACKAGE],[]);
    return {deployment:after.fdo.deployment,assessment:workspaceDeployment(afterFiles),warnings:['Only deployment metadata changes. No tool is installed and no cloud login, permission change or runtime verification occurs.','Rebuild and redeploy the plugin before exporting this updated declaration.']};
}
export function planDeploymentEdit(files,request) {
    const before=files[PACKAGE],pkg=read(before),declaration=request.declaration;
    if(!declaration || typeof declaration!=='object' || Array.isArray(declaration))throw new Error('Provide a deployment declaration.');
    if(JSON.stringify(pkg.fdo?.deployment)===JSON.stringify(declaration))return null;
    pkg.fdo={...(pkg.fdo || {}),deployment:declaration};
    const indent=before.match(/\n([\t ]+)"/)?.[1] || 2,after=JSON.stringify(pkg,null,indent)+(before.endsWith('\n')?'\n':'');
    reviewDeploymentChange(files,{...files,[PACKAGE]:after});
    return {file:PACKAGE,before,after,start:0,end:before.length,removed:before,added:after,description:'Deployment tool requirements',affected:1};
}
