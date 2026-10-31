import path from 'node:path';
import {createHash} from 'node:crypto';
import {builtinModules} from 'node:module';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import runtimeLock from '../../../../contracts/web-export-runtime-lock.json';
import sdkPackage from '@anikitenko/fdo-sdk/package.json';
import appPackage from '../../../../package.json';
import {analyzeWebExport} from './webExportAnalysis';
import {compileWebContractRuntime,rebindEmbeddedWebContract} from './contractRuntimeCompiler';
import {hostPluginContract} from '../../sdk/pluginHostContract';
import {getHostProcessScopePolicy,normalizeCustomProcessScope} from '../security/privilegedProcessScopeRegistry';
import {getHostFsScopePolicy,normalizeCustomFilesystemScope} from '../security/privilegedFsScopeRegistry';
import {createToolchainPlan} from './toolchainPlan';
import {cloudTemplates,deploymentReadme} from './cloudTemplates';
import {buildRuntimeSecurityPolicy} from '../security/pluginCapabilities';
import {compileCssStyleModule} from '../../esbuild/plugins/cssStyleModule';
import {EsbuildVirtualFsPlugin} from '../../esbuild/plugins/virtual-fs';
import {inspectGitOpsCapabilities} from '../../gitops/inspectCapabilities';
import {runtimeSourceGraph} from './runtimeSourceGraph';
import {attachWebExportRecovery} from './webExportRecovery';
const traverse=Reflect.get(traverseModule,'default') || traverseModule;

export function exportFingerprint(files,plugin) {
    const hash=createHash('sha256');
    for(const file of Object.keys(files).sort())hash.update(file).update('\0').update(files[file]).update('\0');
    hash.update(JSON.stringify([plugin.id,[...(plugin.capabilities || [])].sort(),plugin.customProcessScopes || [],plugin.customFilesystemScopes || []]));
    return hash.digest('hex');
}
const authoring="module.exports=require('./application.cjs').abi;\n";
const projectName=value=>{
    let name=String(value || 'web-application').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'') || 'web-application';
    if(!/^[a-z]/.test(name))name='app-'+name;
    return name.slice(0,32).replace(/-+$/,'');
};

export async function prepareWebApplicationExport({snapshot,plugin,esbuild,sdkSource,viewLibrary,runtimeSources}) {
    for(const key of ['toolRuntime','toolSemver','serviceCore','workerLiveSource','gitSshHelper','applicationRuntime','installApplicationNetworkPolicy','backendWorker','webServer','webFrontend','iframeRuntime','createWebServices','deploymentSetup','thirdPartyNotices'])if(typeof runtimeSources?.[key]!=='string' || !runtimeSources[key])throw new Error('The standalone runtime assets are incomplete. Rebuild or update FDO before exporting ('+key+').');
    const selectedEntry=snapshot.sourceEntry || snapshot.runtimeEntry;
    let declaration,metafile;
    if(selectedEntry)try {
        const bundled=await esbuild.build({entryPoints:['/'+selectedEntry],bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent',external:['@anikitenko/fdo-sdk'],plugins:[EsbuildVirtualFsPlugin(snapshot.virtual)],tsconfigRaw:{compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false}}});
        metafile=bundled.metafile;
        declaration=inspectGitOpsCapabilities(bundled.outputFiles[0].text);
    }catch{ /* The converted build below supplies actionable import diagnostics. */ }
    const graph=runtimeSourceGraph(snapshot.virtual,selectedEntry || '',metafile);
    const dynamicDeclaration=!!declaration?.error;
    const reviewedDeclaration=dynamicDeclaration?{capabilities:plugin.capabilities || []}:declaration;
    const report=analyzeWebExport(snapshot.sourceEntry?graph.files:{},plugin,snapshot.sourceEntry?reviewedDeclaration:reviewedDeclaration || {capabilities:plugin.capabilities || []});
    if(dynamicDeclaration)report.warnings.push('The capability declaration is dynamic. Export carries only the existing approved grants; startup validates the actual declaration before plugin initialization.');
    report.analysis={entry:selectedEntry || null,included:graph.included,excluded:graph.excluded,method:metafile?'build-dependencies':'static-imports'};
    const blocked=()=>({report:attachWebExportRecovery(report)});
    report.sourceFingerprint=exportFingerprint(snapshot.virtual,plugin);
    report.build={fdo:appPackage.version,sdk:sdkPackage.version};
    if(!selectedEntry)report.blockers.push('No plugin entry point was found.');
    const compatibility=snapshot.sourceEntry?snapshot.sourceCompatibility:snapshot.compatibility;
    if(compatibility?.status==='incompatible')report.blockers.push(...compatibility.issues);
    report.compatibility=compatibility || {status:'unverified'};
    if(report.blockers.length)return blocked();
    let contractRuntime;
    try{contractRuntime=compileWebContractRuntime(sdkSource);}
    catch(error){report.blockers.push(error.message);return blocked();}
    const name=projectName(plugin.name),files={};
    const entry='backend/source/'+selectedEntry;
    for(const [file,originalSource] of Object.entries(graph.files)) {
        let source=originalSource;
        if(!/\.(?:[cm]?[jt]sx?|json|css)$/.test(file) || /\.d\.[jt]s$/.test(file))continue;
        if(/(?:^|\/)(?:credentials|secrets)[^/]*\.json$/i.test(file) || /(?:^|\/)(?:data|logs)\//.test(file)) {
            report.blockers.push(`${file}: private runtime data must be supplied through deployment storage or secrets, not bundled as source.`);return blocked();
        }
        const destination='backend/source'+file;
        if(file.endsWith('.css')) {
            let compiled;
            try{compiled=await compileCssStyleModule(snapshot.virtual,file);}
            catch(error){report.blockers.push(`${file}: CSS conversion failed: ${error.message}`);return blocked();}
            files[destination+'.cjs']=compiled.replace(/^export default /,'module.exports=');
            files[destination]=source;continue;
        }
        if(!/\.[cm]?[jt]sx?$/.test(file)){files[destination]=source;continue;}
        const contractRequest=path.posix.relative(path.posix.dirname('/'+destination),'/runtime/authoring.cjs');
        try{source=rebindEmbeddedWebContract(source,contractRequest.startsWith('.')?contractRequest:'./'+contractRequest);}catch(error){report.blockers.push(file+': '+error.message);return blocked();}
        const ast=parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy']}),edits=[];
        traverse(ast,{StringLiteral(p){
            const value=p.node.value;
            if(value==='@anikitenko/fdo-sdk') {
                const relative=path.posix.relative(path.posix.dirname('/'+destination),'/runtime/authoring.cjs');
                edits.push({start:p.node.start,end:p.node.end,value:JSON.stringify(relative.startsWith('.')?relative:'./'+relative)});
            } else if(value.endsWith('.css'))edits.push({start:p.node.start,end:p.node.end,value:JSON.stringify(value+'.cjs')});
        }});
        files[destination]=edits.sort((a,b)=>b.start-a.start).reduce((content,edit)=>content.slice(0,edit.start)+edit.value+content.slice(edit.end),source);
    }
    const processScopes=report.capabilities.filter(id=>id.startsWith('system.process.scope.')).map(id=>{const scope=id.slice('system.process.scope.'.length);const custom=plugin.customProcessScopes?.find(item=>item.scope===scope);return custom?normalizeCustomProcessScope(custom,{pluginId:plugin.id}):getHostProcessScopePolicy(scope,{pluginId:plugin.id});}).filter(Boolean);
    const filesystemScopes=report.capabilities.filter(id=>id.startsWith('system.fs.scope.')).map(id=>{const scope=id.slice('system.fs.scope.'.length);const custom=plugin.customFilesystemScopes?.find(item=>item.scope===scope);return custom?normalizeCustomFilesystemScope(custom,{pluginId:plugin.id}):getHostFsScopePolicy(scope,{pluginId:plugin.id});}).filter(Boolean);
    const manifest={name,pluginId:plugin.id,hostContract:hostPluginContract(),processScopes,filesystemScopes,compatibility:report.compatibility,contractVersion:report.contractVersion,applicationApiVersion:report.applicationApiVersion,capabilities:report.capabilities,
        networkPolicy:buildRuntimeSecurityPolicy(report.capabilities)};
    const persistent=true,encrypted=true;
    let toolchain;
    try{toolchain=createToolchainPlan(snapshot.virtual['/package.json'],processScopes,report.capabilities);}
    catch(error){report.blockers.push('Tool requirements: '+error.message);return blocked();}
    const executables=toolchain.executables;
    report.toolchain=toolchain;report.warnings.push(...toolchain.warnings);
    const pathMappings={};
    for(const scope of [...processScopes,...filesystemScopes])for(const original of scope.allowedCwdRoots || scope.allowedRoots || [])if(!pathMappings[original])pathMappings[original]='/data/scopes/root-'+Object.keys(pathMappings).length;
    report.configuration=report.adapters.filter(adapter=>adapter.status==='configuration');
    const frontendEntryUrl='/assets/application.js';
    Object.assign(files,{
        'docs/TOOLCHAIN.md':runtimeSources.toolchainDocumentation || 'See deployment/toolchain.json and run node tools.cjs check.\n',
        'deployment/toolchain.json':JSON.stringify(toolchain,null,2)+'\n',
        'runtime/tool-semver.cjs':runtimeSources.toolSemver,
        'runtime/tools.cjs':'module.exports=('+runtimeSources.toolRuntime+')();\n',
        'tools.cjs':"const tools=require('./runtime/tools.cjs');(async()=>{const command=process.argv[2] || 'check';if(!['check','install'].includes(command))throw new Error('Usage: node tools.cjs check|install');const result=command==='install'?await tools.install():tools.check();console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;})().catch(error=>{console.error(error.message);process.exitCode=1;});\n",
        'runtime/application.cjs':'module.exports=('+runtimeSources.applicationRuntime+')();\n',
        'runtime/network.cjs':'exports.install='+runtimeSources.installApplicationNetworkPolicy+';\n',
        'runtime/helpers.cjs':"module.exports=require('./contract.cjs');\n",'runtime/authoring.cjs':authoring,
        'runtime/contract.cjs':contractRuntime,'runtime/service-core.cjs':runtimeSources.serviceCore,
        'runtime/services.cjs':'exports.create=function(options){const service=('+runtimeSources.createWebServices+')(options);const sendHostServiceMessage=body=>body.operation?service.endpoint.operation(body.operation,body.payload):service.endpoint.request(body.request);const hostServiceError=code=>Object.assign(new Error(code),{code});'+runtimeSources.workerLiveSource+';Object.assign(service.hostServices,{watchSSHStatus:watchHostSSHStatus,startSSHExecution:startHostSSHExecution,openSSHTerminal:openHostSSHTerminal});return service;};\n',
        'runtime/native.cjs':"module.exports=new Proxy({},{get(){throw new Error('Desktop native APIs require an explicit web adapter.');}});\n",
        'runtime/systemGit.cjs':"exports.bundledGit=()=>({execPath:'/usr/lib/git-core',binPaths:['/usr/bin']});\n",
        'runtime/git-ssh-helper.cjs':runtimeSources.gitSshHelper,
        'deployment/services.json':JSON.stringify({executables,pathMappings,sshProfiles:[],secretEnvironment:{},aiAssistants:[],gateway:{url:''}},null,2)+'\n',
        'setup.cjs':'('+runtimeSources.deploymentSetup+')();\n',
        'start.sh':'#!/bin/sh\nset -eu\nif command -v node >/dev/null 2>&1; then node setup.cjs; else docker compose --profile setup run --rm setup; fi\ndocker compose up --build\n',
        'THIRD_PARTY_NOTICES.txt':runtimeSources.thirdPartyNotices,
        'server.cjs':'('+runtimeSources.webServer+')();\n','worker.cjs':'('+runtimeSources.backendWorker+')();\n',
        'frontend/application.js':runtimeSources.iframeRuntime+'\n('+runtimeSources.webFrontend+')();\n',
        'frontend/view.js':typeof viewLibrary==='string'?viewLibrary:Buffer.from(viewLibrary).toString('utf8'),
        'frontend/index.html':`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Web application</title><style>html,body{margin:0;height:100%;font:16px system-ui}#status{padding:16px}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><p id="status" role="status">Loading application…</p><iframe id="application" title="Application" sandbox="allow-scripts" allow="clipboard-read; clipboard-write"></iframe><script src="${frontendEntryUrl}" defer></script></body></html>\n`,
        'deployment/application.json':JSON.stringify(manifest,null,2)+'\n',
        'healthcheck.cjs':"require('node:http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/ready',response=>process.exit(response.statusCode===200?0:1)).on('error',()=>process.exit(1));\n",
        '.env.example':'WEB_APP_USERNAME=engineer\nWEB_APP_PASSWORD=\nWEB_APP_SECRET_KEY=\nWEB_APP_ORIGIN=http://localhost:8080\n',
        '.gitignore':'node_modules/\n.env\ndata/\n*.enc\n',
        '.dockerignore':'.git\nnode_modules\n.env\n.env.*\ndata\n*.enc\ndeployment/toolchain.lock.json\n',
        'Dockerfile':`FROM ${toolchain.baseImage}\nUSER root\nENV NODE_ENV=production PORT=8080 WEB_APP_DATA_DIR=/data AZURE_CONFIG_DIR=/data/azure HOME=/data PATH=/opt/fdo-tools/bin:$PATH\nWORKDIR /app\nCOPY deployment/toolchain.json deployment/toolchain.json\nCOPY runtime/tools.cjs runtime/tool-semver.cjs runtime/\nCOPY tools.cjs .\nRUN node tools.cjs install\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev --ignore-scripts && npm cache clean --force\nCOPY . .\nRUN npm run build && mkdir -p /data && chown -R node:node /data\nUSER node\nEXPOSE 8080\nHEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","healthcheck.cjs"]\nCMD ["node","server.cjs"]\n`,
        'docker-compose.yml':'services:\n  setup:\n    image: node:24-bookworm-slim\n    profiles: [setup]\n    working_dir: /project\n    volumes: [".:/project"]\n    command: [node, setup.cjs]\n  application:\n    build: .\n    ports: ["127.0.0.1:8080:8080"]\n    env_file:\n      - path: .env\n        required: false\n    init: true\n    cap_drop: [ALL]\n    security_opt: ["no-new-privileges:true"]\n    volumes: ["application-data:/data"]\nvolumes:\n  application-data: {}\n',
        ...cloudTemplates(name,{persistent,encrypted}),
    });
    const dependencies={...runtimeLock.packages[''].dependencies};
    files['package.json']=JSON.stringify({name,version:'1.0.0',private:true,scripts:{start:'node server.cjs',build:'node build.cjs'},engines:{node:'>=24'},dependencies},null,2)+'\n';
    const lock=JSON.parse(JSON.stringify(runtimeLock));lock.name=name;lock.packages[''].name=name;
    files['package-lock.json']=JSON.stringify(lock,null,2)+'\n';
    const buildOptions={entryPoints:[entry],bundle:true,platform:'node',format:'cjs',outfile:'backend/app.cjs',target:'node24',
        tsconfigRaw:{compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false}}};
    files['build.cjs']=`const path=require('node:path');const root=__dirname;require('esbuild').build({...${JSON.stringify(buildOptions)},absWorkingDir:root,plugins:[{name:'application-services',setup(build){build.onResolve({filter:/application\\.cjs$|helpers\\.cjs$/},args=>{const resolved=path.resolve(path.dirname(args.importer),args.path);for(const name of ['application.cjs','helpers.cjs'])if(resolved===path.join(root,'runtime',name))return {path:'../runtime/'+name,external:true};});}}]}).catch(error=>{console.error(error.message);process.exitCode=1;});\n`;
    const virtual=Object.fromEntries(Object.entries(files).map(([file,content])=>['/'+file,content]));
    const runtimePlugin={name:'standalone-services',setup(build){build.onResolve({filter:/application\.cjs$|helpers\.cjs$/},args=>{
        const resolved=path.posix.resolve(path.posix.dirname(args.importer),args.path);
        for(const name of ['application.cjs','helpers.cjs'])if(resolved==='/runtime/'+name)return {path:'../runtime/'+name,external:true};
    });}};
    const conversionFailed=message=>{report.blockers.push('Application conversion: '+message);return blocked();};
    try {
        const result=await esbuild.build({...buildOptions,entryPoints:['/'+entry],write:false,metafile:true,logLevel:'silent',plugins:[runtimePlugin,EsbuildVirtualFsPlugin(virtual)]});
        if(result.warnings.length)return conversionFailed(result.warnings.map(item=>item.text).join('; '));
        for(const output of Object.values(result.metafile.outputs))for(const item of output.imports)if(item.external && !builtinModules.includes(item.path.replace(/^node:/,'')) && !['../runtime/application.cjs','../runtime/helpers.cjs'].includes(item.path))return conversionFailed('External dependency '+item.path+' needs a standalone dependency conversion.');
        files['backend/app.cjs']=result.outputFiles.find(file=>file.path.endsWith('app.cjs')).text;
        if(/require\(["'](?:electron|@anikitenko\/fdo-sdk)["'/]/.test(files['backend/app.cjs']))return conversionFailed('A desktop runtime dependency remains in the application bundle.');
    }catch(error){return conversionFailed(error.message);}
    attachWebExportRecovery(report);
    files['conversion-report.json']=JSON.stringify(report,null,2)+'\n';
    files['README.md']=deploymentReadme(name,report);
    return {report,files,filename:name+'-web-application.zip'};
}
