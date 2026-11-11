const path=require('node:path');
const fs=require('node:fs');
const {packageForResource}=require('./legal/webpack-inventory.cjs');
let browserPackages=[],serviceCore,toolSemver;
const runtimePackages=new Map();
function collectPackages(result,root) {
    for(const file of Object.keys(result.metafile.inputs)) {
        const pkg=packageForResource(path.resolve(root,file),root);
        if(pkg)runtimePackages.set(pkg.root,pkg);
    }
}
function webExportDependencyInventory() {
    return {schemaVersion:1,compiler:'export-runtime',packages:[...runtimePackages.values()].sort((a,b)=>a.root.localeCompare(b.root))};
}
async function buildServiceCore(root) {
    const result=await require('esbuild').build({entryPoints:[path.join(root,'src/utils/plugins/exporting/serviceCoreEntry.js')],bundle:true,platform:'node',format:'cjs',write:false,metafile:true,external:['ssh2','shell-quote'],plugins:[{name:'standalone-host',setup(build){
        build.onResolve({filter:/^@anikitenko\/fdo-sdk$/},()=>({path:'./contract.cjs',external:true}));
        build.onResolve({filter:/^electron$/},()=>({path:'./native.cjs',external:true}));
        build.onResolve({filter:/bundledGit\.cjs$/},()=>({path:'./systemGit.cjs',external:true}));
    }}]});
    serviceCore=result.outputFiles[0].text;
    collectPackages(result,root);
    const versions=await require('esbuild').build({stdin:{contents:"exports.coerce=require('semver/functions/coerce');exports.satisfies=require('semver/functions/satisfies');",resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false,minify:true,metafile:true});
    collectPackages(versions,root);
    toolSemver=versions.outputFiles[0].text;
}

const source=`import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import lodash from 'lodash';
import * as goober from 'goober';
import {Terminal} from '@xterm/xterm';
import * as ui from '@anikitenko/fdo-sdk/ui';
import {createSdkUiViewRuntime} from './src/components/plugin/utils/sdkUiViewRuntime.js';
import {installChartRenderer} from './src/components/plugin/utils/chartBridge.js';
import {installTerminalRenderer} from './src/components/plugin/utils/terminalRenderer.js';
import terminalCss from '@xterm/xterm/css/xterm.css';
import * as chartRenderer from './src/components/plugin/utils/chartRenderer.jsx';
window.__webReact={React,createRoot,flushSync};window.__webUi=ui;window.__createView=createSdkUiViewRuntime;
Object.assign(window,{React,ReactDOM:{...ReactDOM,...ReactDOMClient},lodash,_:lodash,goober,Terminal});
goober.setup(React.createElement);
window.__installWebTerminal=target=>{const style=target.document.createElement('style');style.textContent=terminalCss;target.document.head.appendChild(style);installTerminalRenderer(target);};
window.__installWebCharts=target=>installChartRenderer(target,()=>Promise.resolve(chartRenderer));`;
const browserAssets=[
    {id:'ace',script:'src/assets/js/ace/ace.js',global:'ace'},
    {id:'notyf',script:'src/assets/js/notyf/notyf.min.js',css:'src/assets/css/notyf/notyf.min.css',global:'Notyf'},
    {id:'split-grid',script:'src/assets/js/split-grid.js',global:'Split'},
    {id:'highlight',script:'src/assets/js/hljs/highlight.min.js',css:'src/assets/css/hljs/vs.min.css',global:'hljs'},
];
async function buildWebExportAssets(root=path.resolve(__dirname,'..')) {
    runtimePackages.clear();
    const result=await require('esbuild').build({stdin:{contents:source,resolveDir:root,sourcefile:'standalone-view.js'},bundle:true,platform:'browser',format:'iife',minify:true,write:false,metafile:true,legalComments:'inline',loader:{'.css':'text'},logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'}});
    const roots=new Set();
    for(const file of Object.keys(result.metafile.inputs)) {
        const normalized=file.replace(/\\/g,'/'),marker=normalized.lastIndexOf('node_modules/');
        if(marker<0)continue;
        const parts=normalized.slice(marker+'node_modules/'.length).split('/'),length=parts[0].startsWith('@')?2:1;
        roots.add(path.resolve(root,normalized.slice(0,marker+'node_modules/'.length)+parts.slice(0,length).join('/')));
    }
    browserPackages=[...roots];
    collectPackages(result,root);
    await buildServiceCore(root);
    browserPackages=[...new Set([...browserPackages,...[...runtimePackages.keys()].map(name=>path.join(root,name))])];
    // Run the exact desktop library builds in the nonce-authorized iframe script.
    // Styles are data, not imported CSS modules or requests to desktop URLs.
    const inventory=JSON.parse(fs.readFileSync(path.join(root,'third_party/assets.json'),'utf8'));
    const assets=browserAssets.map(asset=>{
        const group=inventory.groups.find(group=>group.id===asset.id);
        if(!group)throw new Error('Missing standalone browser asset provenance: '+asset.id);
        const scripts=asset.id==='ace'?group.files.filter(file=>file.endsWith('.js')):[asset.script];
        const library=scripts.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n;\n');
        const expose=`\n;window[${JSON.stringify(asset.global)}]=${asset.global};\n`;
        const configure=asset.id==='ace'?';const aceEdit=ace.edit;ace.edit=function(...args){const editor=aceEdit.apply(this,args);editor.session.setUseWorker(false);return editor;};\n':'';
        const styles=asset.css?`{const style=document.createElement('style');style.dataset.fdoLibrary=${JSON.stringify(asset.id)};style.textContent=${JSON.stringify(fs.readFileSync(path.join(root,asset.css),'utf8'))};document.head.appendChild(style);}\n`:'';
        return library+expose+configure+styles;
    });
    return Buffer.from(assets.join('\n;\n')+'\n;\n'+result.outputFiles[0].text);
}
function webExportRuntimeSources(root=path.resolve(__dirname,'..')) {
    const result={serviceCore,toolSemver,toolchainDocumentation:fs.readFileSync(path.join(root,'docs/PLUGIN_DEPLOYMENT_TOOLS.md'),'utf8')};
    const inventory=JSON.parse(fs.readFileSync(path.join(root,'third_party/assets.json'),'utf8'));
    for(const [key,file] of [['azureDeploymentDocumentation','AZURE_CONTAINER_APPS_DEPLOYMENT.md'],['awsDeploymentDocumentation','AWS_ECS_DEPLOYMENT.md'],['gcpDeploymentDocumentation','GCP_CLOUD_RUN_DEPLOYMENT.md']])result[key]=fs.readFileSync(path.join(root,'docs',file),'utf8');
    if(!serviceCore)throw new Error('Build standalone host services before collecting runtime sources.');
    result.workerLiveSource=fs.readFileSync(path.join(root,'src/utils/hostServices/workerLiveSource.js'),'utf8').split('String.raw`')[1].split('`;')[0];
    result.gitSshHelper=fs.readFileSync(path.join(root,'src/utils/hostServices/gitSshHelper.cjs'),'utf8');
    for(const file of ['applicationRuntime.js','sharedWebRuntime.js','networkRuntime.js','webApplicationRuntime.js','serviceRuntime.js','deploymentSetup.js','toolRuntime.js']) {
        const source=fs.readFileSync(path.join(root,'src/utils/plugins/exporting',file),'utf8');
        const ast=require('@babel/parser').parse(source,{sourceType:'module'});
        for(const statement of ast.program.body)if(statement.type==='ExportNamedDeclaration' && statement.declaration?.type==='FunctionDeclaration') {
            const node=statement.declaration;result[node.id.name]=source.slice(node.start,node.end);
        }
    }
    for(const name of ['sharedLogicBroker','sharedLogicContracts','sharedLogicTypeContract'])result[name]=fs.readFileSync(path.join(root,'src/utils/plugins/runtime',name+'.cjs'),'utf8');
    const sdk=require(path.join(root,'node_modules/@anikitenko/fdo-sdk/package.json'));
    result.thirdPartyNotices=`Compiled public contract ABI and authoring helpers: ${sdk.name} ${sdk.version}\nAuthor: ${sdk.author}\nLicense: ${sdk.license}\nSource: ${sdk.repository?.url || sdk.homepage}\nOriginal helper comments and bundled license notices are retained in runtime/contract.cjs and runtime/helpers.cjs.\n`;
    const packages=new Set([...browserPackages,...['react','react-dom','scheduler','goober','semver'].map(name=>path.join(root,'node_modules',name))]);
    for(const asset of browserAssets) {
        const group=inventory.groups.find(group=>group.id===asset.id);
        if(!group)throw new Error('Missing standalone browser asset provenance: '+asset.id);
        result.thirdPartyNotices+='\n--- '+group.name+' '+group.version+' ('+group.license+') ---\nSource: '+group.source+'\n';
        for(const license of group.licenseFiles)result.thirdPartyNotices+=fs.readFileSync(path.join(root,'third_party/licenses',license),'utf8')+'\n';
    }
    for(const directory of packages) {
        const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
        result.thirdPartyNotices+='\n--- '+pkg.name+' '+pkg.version+' ('+(pkg.license || 'see original source')+') ---\n';
        const license=fs.readdirSync(directory).find(file=>/^licen[cs]e(?:\..*)?$/i.test(file));
        if(license)result.thirdPartyNotices+=fs.readFileSync(path.join(directory,license),'utf8');
    }
    return result;
}
if(require.main===module)buildWebExportAssets().then(value=>{const directory=path.resolve(__dirname,'../dist/main/export-runtime');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'view.js'),value);fs.writeFileSync(path.join(directory,'runtime-sources.json'),JSON.stringify(webExportRuntimeSources()));fs.writeFileSync(path.join(directory,'dependencies.json'),JSON.stringify(webExportDependencyInventory(),null,2)+'\n');}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildWebExportAssets,webExportRuntimeSources,webExportDependencyInventory};
