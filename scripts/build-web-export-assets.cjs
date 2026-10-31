const path=require('node:path');
const fs=require('node:fs');
let browserPackages=[],serviceCore,toolSemver;
async function buildServiceCore(root) {
    const result=await require('esbuild').build({entryPoints:[path.join(root,'src/utils/plugins/exporting/serviceCoreEntry.js')],bundle:true,platform:'node',format:'cjs',write:false,external:['ssh2','shell-quote'],plugins:[{name:'standalone-host',setup(build){
        build.onResolve({filter:/^@anikitenko\/fdo-sdk$/},()=>({path:'./contract.cjs',external:true}));
        build.onResolve({filter:/^electron$/},()=>({path:'./native.cjs',external:true}));
        build.onResolve({filter:/bundledGit\.cjs$/},()=>({path:'./systemGit.cjs',external:true}));
    }}]});
    serviceCore=result.outputFiles[0].text;
    const versions=await require('esbuild').build({stdin:{contents:"exports.coerce=require('semver/functions/coerce');exports.satisfies=require('semver/functions/satisfies');",resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false,minify:true});
    toolSemver=versions.outputFiles[0].text;
}

const source=`import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import * as ui from '@anikitenko/fdo-sdk/ui';
import {createSdkUiViewRuntime} from './src/components/plugin/utils/sdkUiViewRuntime.js';
import {installChartRenderer} from './src/components/plugin/utils/chartBridge.js';
import {installTerminalRenderer} from './src/components/plugin/utils/terminalRenderer.js';
import terminalCss from '@xterm/xterm/css/xterm.css';
import * as chartRenderer from './src/components/plugin/utils/chartRenderer.jsx';
window.__webReact={React,createRoot,flushSync};window.__webUi=ui;window.__createView=createSdkUiViewRuntime;
window.__installWebTerminal=target=>{const style=target.document.createElement('style');style.textContent=terminalCss;target.document.head.appendChild(style);installTerminalRenderer(target);};
window.__installWebCharts=target=>installChartRenderer(target,()=>Promise.resolve(chartRenderer));`;
async function buildWebExportAssets(root=path.resolve(__dirname,'..')) {
    const result=await require('esbuild').build({stdin:{contents:source,resolveDir:root,sourcefile:'standalone-view.js'},bundle:true,platform:'browser',format:'iife',minify:true,write:false,metafile:true,legalComments:'inline',loader:{'.css':'text'},logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'}});
    const roots=new Set();
    for(const file of Object.keys(result.metafile.inputs)) {
        const normalized=file.replace(/\\/g,'/'),marker=normalized.lastIndexOf('node_modules/');
        if(marker<0)continue;
        const parts=normalized.slice(marker+'node_modules/'.length).split('/'),length=parts[0].startsWith('@')?2:1;
        roots.add(path.resolve(root,normalized.slice(0,marker+'node_modules/'.length)+parts.slice(0,length).join('/')));
    }
    browserPackages=[...roots];
    await buildServiceCore(root);
    return result.outputFiles[0].contents;
}
function webExportRuntimeSources(root=path.resolve(__dirname,'..')) {
    const result={serviceCore,toolSemver,toolchainDocumentation:fs.readFileSync(path.join(root,'docs/PLUGIN_DEPLOYMENT_TOOLS.md'),'utf8')};
    if(!serviceCore)throw new Error('Build standalone host services before collecting runtime sources.');
    result.workerLiveSource=fs.readFileSync(path.join(root,'src/utils/hostServices/workerLiveSource.js'),'utf8').split('String.raw`')[1].split('`;')[0];
    result.gitSshHelper=fs.readFileSync(path.join(root,'src/utils/hostServices/gitSshHelper.cjs'),'utf8');
    for(const file of ['applicationRuntime.js','networkRuntime.js','webApplicationRuntime.js','serviceRuntime.js','deploymentSetup.js','toolRuntime.js']) {
        const source=fs.readFileSync(path.join(root,'src/utils/plugins/exporting',file),'utf8');
        const ast=require('@babel/parser').parse(source,{sourceType:'module'});
        for(const statement of ast.program.body)if(statement.type==='ExportNamedDeclaration' && statement.declaration?.type==='FunctionDeclaration') {
            const node=statement.declaration;result[node.id.name]=source.slice(node.start,node.end);
        }
    }
    const sdk=require(path.join(root,'node_modules/@anikitenko/fdo-sdk/package.json'));
    result.thirdPartyNotices=`Compiled public contract ABI and authoring helpers: ${sdk.name} ${sdk.version}\nAuthor: ${sdk.author}\nLicense: ${sdk.license}\nSource: ${sdk.repository?.url || sdk.homepage}\nOriginal helper comments and bundled license notices are retained in runtime/contract.cjs and runtime/helpers.cjs.\n`;
    const packages=new Set([...browserPackages,...['react','react-dom','scheduler','goober','semver'].map(name=>path.join(root,'node_modules',name))]);
    for(const directory of packages) {
        const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
        result.thirdPartyNotices+='\n--- '+pkg.name+' '+pkg.version+' ('+(pkg.license || 'see original source')+') ---\n';
        const license=fs.readdirSync(directory).find(file=>/^licen[cs]e(?:\..*)?$/i.test(file));
        if(license)result.thirdPartyNotices+=fs.readFileSync(path.join(directory,license),'utf8');
    }
    return result;
}
if(require.main===module)buildWebExportAssets().then(value=>{const directory=path.resolve(__dirname,'../dist/main/export-runtime');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'view.js'),value);fs.writeFileSync(path.join(directory,'runtime-sources.json'),JSON.stringify(webExportRuntimeSources()));}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildWebExportAssets,webExportRuntimeSources};
