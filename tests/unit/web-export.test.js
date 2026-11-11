/** @jest-environment node */
import {beforeAll, expect, test} from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import * as esbuild from 'esbuild';
import {analyzeWebExport,capabilityAdapter,WEB_EXPORT_CONTRACT} from '../../src/utils/plugins/exporting/webExportAnalysis';
import {KNOWN_PLUGIN_CAPABILITIES} from '../../src/utils/plugins/security/pluginCapabilities';
import {prepareWebApplicationExport,exportFingerprint} from '../../src/utils/plugins/exporting/webApplicationExport';
import {compileWebContractRuntime} from '../../src/utils/plugins/exporting/contractRuntimeCompiler';
import {compilePortableHelpers} from '../../src/utils/plugins/exporting/portableHelpers';
import {createMigrationWorkPackage} from '../../src/utils/plugins/exporting/webExportRecovery';
import fixture from '../fixtures/web-export/application.cjs';
const {webExportRuntimeSources,buildWebExportAssets}=require('../../scripts/build-web-export-assets.cjs');
const sdkSource=fs.readFileSync(require.resolve('@anikitenko/fdo-sdk'),'utf8');
const capabilities=['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list'];
const plugin={id:'fixture',name:'Web counter',capabilities};
let viewLibrary;
beforeAll(async()=>{viewLibrary=await buildWebExportAssets();},30000);
const prepare=(files=fixture(),owner=plugin,options={})=>prepareWebApplicationExport({snapshot:{virtual:files,sourceEntry:'index.ts'},plugin:owner,esbuild,sdkSource,viewLibrary,runtimeSources:webExportRuntimeSources(),...options});

test('desktop-provided browser libraries are supported as globals and through window aliases or globalThis',()=>{
    const files=fixture();files['/index.ts']+=`\nfunction frontend(){const ui=window;new ui.Notyf();new window.Notyf();new Notyf();ui['ReactDOM'].createRoot(null);window._.sum([1,2]);Split({});globalThis.hljs.highlight('const n=1',{language:'javascript'});goober.css({color:'red'});React.createElement('span');ReactDOM.createRoot(null);lodash.sum([1]);_.sum([2]);new Terminal();ace.edit('editor');window.ace.edit('editor');}`;
    const report=analyzeWebExport(files,plugin);
    expect(report.blockers).toEqual([]);
    expect(report.adapters).toContainEqual(expect.objectContaining({id:'browser-libraries',status:'supported'}));
    expect(report.locations).toContainEqual(expect.objectContaining({adapter:'browser-libraries',symbol:'Notyf'}));
    expect(report.locations).toContainEqual(expect.objectContaining({adapter:'browser-libraries',symbol:'ace'}));
    const notices=webExportRuntimeSources().thirdPartyNotices;
    expect(notices).toContain('Notyf');expect(notices).toContain('highlight.js');expect(notices).toContain('Split Grid');expect(notices).toContain('Ace (Ajax.org B.V.)');
});

test('unbundled frontend libraries retain an actionable blocker without confusing local objects with window',()=>{
    const files=fixture();files['/index.ts']+=`\nfunction frontend(){const ui=window;new ui.Chart();window.moment();window.dayjs();} function local(window){window.Chart();}`;
    const report=analyzeWebExport(files,plugin);
    expect(report.blockers.filter(value=>value.includes('browser library'))).toHaveLength(3);
    expect(report.blockers.join(' ')).toContain('Use window.FDOCharts');
});

test('unbundled frontend libraries used as globals are blocked without flagging local bindings',()=>{
    const files=fixture();files['/index.ts']+=`\nfunction frontend(){new Chart();moment();dayjs();ace.edit('code');} function local(Chart){new Chart();}`;
    const report=analyzeWebExport(files,plugin);
    expect(report.blockers.filter(value=>value.includes('browser library'))).toHaveLength(3);
    expect(report.blockers.join(' ')).toContain('Use window.FDOCharts');
});

test('the independent conversion contract covers every host capability and all scope families',()=>{
    for(const capability of KNOWN_PLUGIN_CAPABILITIES)expect(WEB_EXPORT_CONTRACT.adapters[capabilityAdapter(capability)]).toBeDefined();
    for(const capability of ['system.fs.scope.custom','system.process.scope.custom','system.network.scope.custom'])expect(capabilityAdapter(capability)).toBeDefined();
    expect(WEB_EXPORT_CONTRACT.contractVersion).toBe('2.3.0');
});

test('pure helpers are compiled without loading the SDK registry or communicator',()=>{
    const source=compilePortableHelpers(sdkSource,['DOM','DOMInput','defineRenderOnLoadActions','resolveRenderOnLoadSource']);
    expect(source).not.toContain('class Communicator');expect(source).not.toContain('class PluginRegistry');
    expect(source).not.toMatch(/require\(["']@anikitenko\/fdo-sdk/);
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'web-helpers-'));
    try {const file=path.join(root,'helpers.cjs');fs.writeFileSync(file,source);const loaded=createRequire(file)(file);expect(new loaded.DOM().createElement('button',{id:'run'},'Run')).toBe('<button id="run">Run</button>');}
    finally{fs.rmSync(root,{recursive:true,force:true});}
    expect(()=>compilePortableHelpers(sdkSource,['Logger'])).toThrow();
});

test('conversion emits editable source, an independent backend, cloud templates and a pinned SDK-free dependency graph',async()=>{
    const result=await prepare();expect(result.report.blockers).toEqual([]);
    const files=result.files,pkg=JSON.parse(files['package.json']),lock=JSON.parse(files['package-lock.json']);
    expect(pkg.dependencies['@anikitenko/fdo-sdk']).toBeUndefined();expect(pkg.dependencies.electron).toBeUndefined();
    expect(Object.keys(lock.packages).some(name=>name.includes('fdo-sdk') || name.endsWith('/electron'))).toBe(false);
    expect(files['backend/app.cjs']).not.toMatch(/require\(["'](?:@anikitenko\/fdo-sdk|electron)/);
    expect(files['backend/source/index.ts']).toContain('../../runtime/authoring.cjs');
    expect(files['Dockerfile']).toContain('USER node');expect(files['Dockerfile']).toContain('npm ci');
    expect(files['.dockerignore']).toContain('.env');expect(files['docker-compose.yml']).toContain('127.0.0.1:8080:8080');
    expect(files['.gcloudignore']).toContain('.env');expect(files['.gcloudignore']).toContain('deployment/*.private.json');
    expect(JSON.parse(files['deployment/aws-ecs.task.json']).requiresCompatibilities).toEqual(['FARGATE']);
    expect(JSON.parse(files['deployment/azure-container-app.json']).properties.template.scale.maxReplicas).toBe(1);
    expect(JSON.parse(files['deployment/gcp-cloud-run.json']).spec.template.spec.containers[0].startupProbe.httpGet.path).toBe('/health/ready');
    expect(files['README.md']).toContain('Rolling revisions may overlap');
    for(const [file,source] of [['AZURE_CONTAINER_APPS.md','AZURE_CONTAINER_APPS_DEPLOYMENT.md'],['AWS_ECS.md','AWS_ECS_DEPLOYMENT.md'],['GCP_CLOUD_RUN.md','GCP_CLOUD_RUN_DEPLOYMENT.md']]) {
        expect(files['docs/'+file]).toBe(fs.readFileSync(path.resolve('docs',source),'utf8'));
        expect(files['README.md']).toContain('docs/'+file);
    }
    expect(result.report.sourceFingerprint).toBe(exportFingerprint(fixture(),plugin));
    expect(exportFingerprint(fixture(),{...plugin,capabilities:[]})).not.toBe(result.report.sourceFingerprint);
});

test('unapproved grants block export while configured services retain runnable packaging',async()=>{
    const missing=await prepare(fixture(),{...plugin,capabilities:[]});expect(missing.files).toBeUndefined();expect(missing.report.blockers.join(' ')).toContain('not approved');
    const files=fixture();files['/index.ts']=files['/index.ts'].replace("['storage','storage.json'","['system.tray','ssh.x11.forward','storage','storage.json'");
    const report=analyzeWebExport(files,{...plugin,capabilities:[...capabilities,'system.tray','ssh.x11.forward']});
    expect(report.blockers).toEqual([]);expect(report.adapters).toEqual(expect.arrayContaining([expect.objectContaining({id:'tray',status:'configuration'}),expect.objectContaining({id:'x11',status:'configuration'})]));
    files['/logic.ts']="export const auth='fdo.auth.start.v1';";
    expect(analyzeWebExport(files,{...plugin,capabilities:[...capabilities,'system.tray','ssh.x11.forward']}).adapters).toContainEqual(expect.objectContaining({id:'authentication',status:'configuration'}));
});

test('a selected port reaches the server, setup, Docker, Compose and all cloud ingress/probe definitions',async()=>{
    const result=await prepare(fixture(),plugin,{port:9090}),files=result.files;
    expect(result.report.deployment.port).toBe(9090);
    expect(files['server.cjs']).toContain("process.env.PORT ||= '9090'");
    expect(files.Dockerfile).toContain('PORT=9090');expect(files.Dockerfile).toContain('EXPOSE 9090');
    expect(files['docker-compose.yml']).toContain('127.0.0.1:9090:9090');expect(files['docker-compose.yml']).toContain('PORT: "9090"');
    expect(files['healthcheck.cjs']).toContain('process.env.PORT||9090');
    const aws=JSON.parse(files['deployment/aws-ecs.task.json']).containerDefinitions[0];
    expect(aws.portMappings[0].containerPort).toBe(9090);expect(aws.environment).toContainEqual({name:'PORT',value:'9090'});
    const azure=JSON.parse(files['deployment/azure-container-app.json']).properties;
    expect(azure.configuration.ingress.targetPort).toBe(9090);
    expect(azure.template.containers[0].env).toContainEqual({name:'PORT',value:'9090'});
    expect(azure.template.containers[0].probes.every(item=>item.httpGet.port===9090)).toBe(true);
    const gcp=JSON.parse(files['deployment/gcp-cloud-run.json']).spec.template.spec.containers[0];
    expect(gcp.ports[0].containerPort).toBe(9090);expect(gcp.startupProbe.httpGet.port).toBe(9090);expect(gcp.livenessProbe.httpGet.port).toBe(9090);
    expect(gcp.env.some(item=>item.name==='PORT')).toBe(false); // Cloud Run supplies its reserved PORT variable.
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'web-port-'));
    try {
        fs.writeFileSync(path.join(root,'setup.cjs'),files['setup.cjs']);execFileSync(process.execPath,[path.join(root,'setup.cjs')]);
        const env=fs.readFileSync(path.join(root,'.env'),'utf8');expect(env).toContain('PORT=9090');expect(env).toContain('WEB_APP_ORIGIN=http://localhost:9090');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
    expect(files['README.md']).toContain('localhost:9090');expect(files['README.md']).toContain('docs/AZURE_CONTAINER_APPS.md');
});

test.each([0,80,1023,65536,-1,9090.5,'9090; echo invalid','',null])('invalid export port %p is rejected before conversion',async port=>{
    await expect(prepare(fixture(),plugin,{port})).rejects.toThrow('1024 to 65535');
});

test('the shipped Azure guide generates a complete private deployment without printing or baking secrets',async()=>{
    const {files}=await prepare(fixture(),plugin,{port:9090});
    const guide=files['docs/AZURE_CONTAINER_APPS.md'],script=guide.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1];
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'web-azure-guide-'));
    try {
        fs.mkdirSync(path.join(root,'deployment'));
        fs.writeFileSync(path.join(root,'deployment/azure-container-app.json'),files['deployment/azure-container-app.json']);
        const key=Buffer.alloc(32,7).toString('base64'),password='a-private-test-password-at-least-24-characters';
        fs.writeFileSync(path.join(root,'.env'),`PORT=9090\nWEB_APP_USERNAME=engineer\nWEB_APP_PASSWORD=${password}\nWEB_APP_SECRET_KEY=${key}\nWEB_APP_ORIGIN=http://localhost:9090\nPROVIDER_API_TOKEN="a=private-token"\n`);
        const output=execFileSync(process.execPath,['-'],{input:script,cwd:root,encoding:'utf8',env:{...process.env,APP:'fdo-test',LOCATION:'westeurope',ACR_SERVER:'example.azurecr.io',ACR_USER:'registry-user',ACR_PASSWORD:'private-registry-password',IMAGE_TAG:'1.0',ENVIRONMENT_ID:'/subscriptions/test/environments/test',DEFAULT_DOMAIN:'test.azurecontainerapps.io',STORAGE_MOUNT_NAME:'test-mount'}});
        const file=path.join(root,'deployment/azure-container-app.private.json'),config=JSON.parse(fs.readFileSync(file,'utf8')),props=config.properties;
        expect(config.identity).toBeUndefined();expect(config.name).toBe('fdo-test');
        expect(props.configuration.ingress.targetPort).toBe(9090);
        expect(props.configuration.registries[0].passwordSecretRef).toBe('registry-password');
        expect(props.configuration.secrets).toContainEqual({name:'app-provider-api-token',value:'a=private-token'});
        expect(props.template.containers[0].env).toEqual(expect.arrayContaining([{name:'PROVIDER_API_TOKEN',secretRef:'app-provider-api-token'},{name:'WEB_APP_ORIGIN',value:'https://fdo-test.test.azurecontainerapps.io'}]));
        expect(props.template.containers[0].volumeMounts).toEqual([{volumeName:'application-data',mountPath:'/data'}]);
        expect(props.template.volumes[0]).toMatchObject({storageName:'test-mount',storageType:'AzureFile',mountOptions:expect.stringContaining('uid=1000')});
        expect(props.template.scale).toEqual({minReplicas:1,maxReplicas:1});
        expect(JSON.stringify(config)).not.toContain('REPLACE_WITH');expect(output).not.toContain(password);expect(output).not.toContain(key);
        expect(fs.statSync(file).mode&0o777).toBe(0o600);
        expect(files['.dockerignore']).toContain('deployment/*.private.json');expect(files['.gitignore']).toContain('deployment/*.private.json');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('the shipped ECS and Cloud Run guides generate complete configuration locally without cloud calls',async()=>{
    const {files}=await prepare(fixture(),plugin,{port:9090});
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'web-cloud-guides-'));
    try {
        const testEnv={...process.env,APP:'fdo-test',AWS_REGION:'eu-west-1',ACCOUNT_ID:'123456789012',ECR_SERVER:'123456789012.dkr.ecr.eu-west-1.amazonaws.com',IMAGE_TAG:'1.0',APP_HOST:'fdo.example.com',SECRET_ARN:'arn:aws:secretsmanager:eu-west-1:123456789012:secret:env-test',EFS_ID:'fs-test',EFS_AP:'fsap-test',PORT:'9090',PROJECT_ID:'test-project',SERVICE_ACCOUNT:'fdo@test-project.iam.gserviceaccount.com',IMAGE_URI:'europe-west1-docker.pkg.dev/test/fdo/app:1.0',APP_ORIGIN:'https://fdo-test-123.europe-west1.run.app',NETWORK:'fdo-network',SUBNET:'fdo-subnet',FILESTORE_IP:'10.42.1.2',SHARE:'data'};
        fs.mkdirSync(path.join(directory,'deployment'));
        for(const file of ['aws-ecs.task.json','gcp-cloud-run.json'])fs.writeFileSync(path.join(directory,'deployment',file),files['deployment/'+file]);
        const key=Buffer.alloc(32,9).toString('base64');
        fs.writeFileSync(path.join(directory,'.env'),`PORT=9090\nWEB_APP_USERNAME=engineer\nWEB_APP_PASSWORD=private-password-longer-than-24-characters\nWEB_APP_SECRET_KEY=${key}\nWEB_APP_ORIGIN=http://localhost:9090\nPROVIDER_API_TOKEN=private-token\n`);
        const awsScripts=[...files['docs/AWS_ECS.md'].matchAll(/node <<'NODE'\n([\s\S]*?)\nNODE/g)].map(match=>match[1]);
        expect(awsScripts).toHaveLength(3);
        for(const script of awsScripts)execFileSync(process.execPath,['-'],{input:script,cwd:directory,env:testEnv});
        const task=JSON.parse(fs.readFileSync(path.join(directory,'deployment/ecs-task.private.json'),'utf8'));
        expect(task.containerDefinitions[0].portMappings[0].containerPort).toBe(9090);
        expect(task.containerDefinitions[0].secrets).toContainEqual({name:'PROVIDER_API_TOKEN',valueFrom:testEnv.SECRET_ARN+':PROVIDER_API_TOKEN::'});
        expect(task.volumes[0].efsVolumeConfiguration).toMatchObject({fileSystemId:'fs-test',transitEncryption:'ENABLED',authorizationConfig:{accessPointId:'fsap-test',iam:'ENABLED'}});
        expect(JSON.stringify(task)).not.toContain('private-token');expect(JSON.stringify(task)).not.toContain('REPLACE_WITH');
        const gcpScript=files['docs/GCP_CLOUD_RUN.md'].match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1];
        execFileSync(process.execPath,['-'],{input:gcpScript,cwd:directory,env:testEnv});
        const config=JSON.parse(fs.readFileSync(path.join(directory,'deployment/gcp-service.private.json'),'utf8'));
        const spec=config.spec.template.spec,c=spec.containers[0];
        expect(c.ports[0].containerPort).toBe(9090);expect(c.env.some(item=>item.name==='PORT')).toBe(false);
        expect(c.env).toContainEqual({name:'PROVIDER_API_TOKEN',valueFrom:{secretKeyRef:{name:'fdo-test-provider-api-token',key:'1'}}});
        expect(config.metadata.annotations['run.googleapis.com/manualInstanceCount']).toBe('1');
        expect(config.spec.template.metadata.annotations['run.googleapis.com/cpu-throttling']).toBe('false');
        expect(spec.serviceAccountName).toBe(testEnv.SERVICE_ACCOUNT);expect(spec.volumes[0].nfs).toEqual({server:'10.42.1.2',path:'/data'});
        expect(JSON.stringify(config)).not.toContain('REPLACE_WITH');expect(JSON.stringify(config)).not.toContain('private-token');
        const uploads=JSON.parse(fs.readFileSync(path.join(directory,'deployment/gcp-secrets.private.json'),'utf8'));
        expect(uploads).toContainEqual({name:'fdo-test-provider-api-token',value:'private-token'});
        for(const file of ['ecs-env.private.json','ecs-task.private.json','gcp-service.private.json','gcp-secrets.private.json'])expect(fs.statSync(path.join(directory,'deployment',file)).mode&0o777).toBe(0o600);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('declarations using imported constant capability lists are resolved without executing plugin code',async()=>{
    const files=fixture();files['/permissions.ts']='export const permissions='+JSON.stringify(capabilities)+';';
    files['/index.ts']="import {permissions} from './permissions';\n"+files['/index.ts'].replace("return ['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list'];",'return permissions;');
    const result=await prepare(files);expect(result.report.blockers).toEqual([]);expect(result.report.capabilities).toEqual([...capabilities].sort());
});

test('installed SDK and parser dependency upgrades require refreshing the exported lockfile',async()=>{
    const result=await prepare(),dependencies=JSON.parse(result.files['package.json']).dependencies;
    expect(dependencies.esbuild).toBe(require('esbuild/package.json').version);
    expect(dependencies['@babel/parser']).toBe(require('@babel/parser/package.json').version);
});

test('converted network operations enforce family, transport, destinations and explicit redirects',()=>{
    const install=webExportRuntimeSources().installApplicationNetworkPolicy;
    const script=`(async()=>{
      globalThis.fetch=async(input,options)=>({redirect:options.redirect});
      const https=require('node:https');https.get=()=>({approved:true});
      (${install})({grantedCapabilities:['system.network','system.network.https'],networkScopes:[{allowedTransports:['fetch'],allowedSchemes:['https'],allowedHostPatterns:['api.example.com'],allowedPorts:['443']}]});
      const result={approved:await fetch('https://api.example.com'),node:require('node:https').get('https://api.example.com')};
      for(const [name,run] of Object.entries({wrongHost:()=>fetch('https://other.example.com'),wrongTransport:()=>fetch('http://api.example.com'),redirect:()=>fetch('https://api.example.com',{redirect:'follow'}),raw:()=>require('node:net').connect(80,'api.example.com')}))try{await run();result[name]=false;}catch{result[name]=true;}
      console.log(JSON.stringify(result));
    })().catch(()=>process.exit(1));`;
    const result=JSON.parse(execFileSync(process.execPath,['-e',script],{encoding:'utf8'}));
    expect(result).toEqual({approved:{redirect:'error'},node:{approved:true},wrongHost:true,wrongTransport:true,redirect:true,raw:true});
});

test('generated cloud application names satisfy the shared DNS and Azure length constraints',async()=>{
    const result=await prepare(fixture(),{...plugin,name:'123 -- Cloud '.repeat(6)});
    expect(result.report.blockers).toEqual([]);
    const name=JSON.parse(result.files['package.json']).name;
    expect(name.length).toBeLessThanOrEqual(32);expect(name).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
});

test('unimported smoke tools do not block conversion or enter the generated runtime source',async()=>{
    const files=fixture();files['/scripts/browser-smoke.cjs']="const fs=require('node:fs');process.parentPort={};require(process.env.PLUGIN_ENTRY);";
    files['/tests/unused.spec.ts']='this is invalid test syntax';
    const result=await prepare(files);
    expect(result.report.blockers).toEqual([]);
    expect(result.report.analysis.excluded).toEqual(expect.arrayContaining(['/scripts/browser-smoke.cjs','/tests/unused.spec.ts']));
    expect(result.files['backend/source/scripts/browser-smoke.cjs']).toBeUndefined();
    expect(result.report.recovery.status).toBe('ready');
});

test('a script or test that is imported by runtime source is still inspected',async()=>{
    const files=fixture();files['/scripts/tool.cjs']="const fs=require('node:fs');module.exports={};";
    files['/index.ts']="import './scripts/tool.cjs';\n"+files['/index.ts'];
    const result=await prepare(files);
    expect(result.report.blockers).toEqual([]);expect(result.files['backend/source/scripts/tool.cjs']).toContain('node:fs');
    expect(result.report.analysis.included).toContain('/scripts/tool.cjs');
    expect(result.files.Dockerfile).toBeDefined();
});

test('process scopes produce a runnable container with tool installation and no migration gate',async()=>{
    const files=fixture();files['/index.ts']=files['/index.ts'].replace("return ['storage'","return ['system.process.exec','system.process.scope.azure-finops','storage'");
    const scope={scope:'azure-finops',allowedExecutables:['/desktop/bin/az'],allowedCwdRoots:['/desktop/project'],allowedEnvKeys:[],requireConfirmation:true,argumentPolicy:{version:1,mode:'first-arg',allowedFirstArgs:['account']}};
    const result=await prepare(files,{...plugin,capabilities:[...capabilities,'system.process.exec','system.process.scope.azure-finops'],customProcessScopes:[scope]});
    expect(result.report.blockers).toEqual([]);
    expect(result.files.Dockerfile).toContain('RUN node tools.cjs install');
    expect(JSON.parse(result.files['deployment/toolchain.json']).tools).toContainEqual(expect.objectContaining({id:'azure-cli',installer:{type:'azure-cli',packageVersion:'2.91.0-1~bookworm'}}));
    expect(result.files['docker-compose.yml']).toContain('application-data:/data');
    expect(result.files['runtime/service-core.cjs']).toContain('executeHostPrivilegedAction');
    const settings=JSON.parse(result.files['deployment/services.json']);
    expect(settings.executables['/desktop/bin/az']).toBe('/usr/bin/az');
    expect(settings.pathMappings['/desktop/project']).toMatch(/^\/data\/scopes\//);
    expect(JSON.parse(result.files['deployment/application.json']).processScopes[0]).toMatchObject(scope);
});

test('migration work packages preserve source and tests separately without credentials or deployable placeholders',async()=>{
    const files=fixture();files['/secrets.ts']='export const secretKeyName="token";';files['/tests/check.test.ts']='export const testFixture=true;';
    files['/credentials.json']='{"value":"private"}';files['/.env.local']='TOKEN=private';files['/dist/index.cjs']='desktop runtime';
    const result=await prepare(files,{...plugin,capabilities:[]}),before={...files};
    const work=createMigrationWorkPackage({virtual:files},result.report,'Counter');
    expect(work['original-plugin/index.ts']).toBe(files['/index.ts']);
    expect(work['original-plugin/secrets.ts']).toBe(files['/secrets.ts']);
    expect(work['original-plugin/tests/check.test.ts']).toBeDefined();
    expect(work['original-plugin/credentials.json']).toBeUndefined();expect(work['original-plugin/.env.local']).toBeUndefined();expect(work['original-plugin/dist/index.cjs']).toBeUndefined();
    expect(work.Dockerfile).toBeUndefined();expect(work['MIGRATION_PLAN.md']).toContain('not a deployable web application');
    expect(files).toEqual(before);
});

test('dynamic capability declarations are checked at startup against existing approved grants',async()=>{
    const files=fixture();files['/other.ts']='export const other=true;';
    files['/index.ts']="import './other';\n"+files['/index.ts'].replace("return ['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list'];",'return this.choosePermissions();');
    files['/index.ts']=files['/index.ts'].replace(' init(){',` choosePermissions(){return ${JSON.stringify(capabilities)};}\n init(){`);
    const result=await prepare(files);
    expect(result.report.blockers).toEqual([]);expect(result.report.warnings.filter(message=>message.includes('declaration is dynamic'))).toHaveLength(1);expect(result.files['runtime/application.cjs']).toContain('capability declaration differs');
});

test('a runtime import of package metadata is preserved without adding SDK runtime dependencies',async()=>{
    const files=fixture();files['/index.ts']="import metadata from './package.json';\n"+files['/index.ts'].replace("version:'1.0.0'",'version:metadata.version');
    const result=await prepare(files);expect(result.report.blockers).toEqual([]);
    expect(result.files['backend/source/package.json']).toBe(files['/package.json']);
    expect(JSON.parse(result.files['package.json']).dependencies['@anikitenko/fdo-sdk']).toBeUndefined();
});

test('migration policy references retain restrictions without copying environment values or credentials',()=>{
    const owner={...plugin,customProcessScopes:[{scope:'azure-finops',allowedExecutables:['/desktop/bin/az'],allowedEnvKeys:['AZURE_CLIENT_SECRET'],environment:{AZURE_CLIENT_SECRET:'private-value'},credentials:'private-value',argumentPolicy:{mode:'allowlist',allowedFirstArgs:['account'],secret:'private-value'}}]};
    const report={contractVersion:'1.1.0',capabilities:['system.process.exec','system.process.scope.azure-finops'],blockers:[],requirements:[],adapters:[]};
    const work=createMigrationWorkPackage({virtual:fixture()},report,'Azure',owner),reference=JSON.parse(work['DESKTOP_POLICY_REFERENCE.json']);
    expect(reference.processScopes[0]).toMatchObject({allowedExecutables:['/desktop/bin/az'],allowedEnvKeys:['AZURE_CLIENT_SECRET'],argumentPolicy:{allowedFirstArgs:['account']}});
    expect(work['DESKTOP_POLICY_REFERENCE.json']).not.toContain('private-value');
    expect(exportFingerprint(fixture(),owner)).not.toBe(exportFingerprint(fixture(),{...owner,customProcessScopes:[]}));
});

 test('ported contract preserves the full public ABI without opening desktop communication',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'web-contract-')),file=path.join(root,'contract.cjs');
    try {
        fs.writeFileSync(file,compileWebContractRuntime(sdkSource));fs.writeFileSync(path.join(root,'native.cjs'),'module.exports={};');
        const output=execFileSync(process.execPath,['-e',`const sdk=require(${JSON.stringify(file)});new sdk.FDO_SDK();console.log(JSON.stringify({exports:Object.keys(sdk).length,registry:typeof sdk.PluginRegistry.registerStore,ssh:typeof sdk.SSHClient}));`],{encoding:'utf8',env:{...process.env,FDO_SDK_LOG_ROOT:path.join(root,'logs')}});
        expect(JSON.parse(output)).toMatchObject({registry:'function',ssh:'function'});expect(JSON.parse(output).exports).toBeGreaterThan(100);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('setup generates private unique credentials once and preserves existing keys',async()=>{
    const result=await prepare(),root=fs.mkdtempSync(path.join(os.tmpdir(),'web-setup-'));
    try{const file=path.join(root,'setup.cjs');fs.writeFileSync(file,result.files['setup.cjs']);execFileSync(process.execPath,[file]);const before=fs.readFileSync(path.join(root,'.env'),'utf8');execFileSync(process.execPath,[file]);expect(fs.readFileSync(path.join(root,'.env'),'utf8')).toBe(before);expect(before).toMatch(/WEB_APP_SECRET_KEY=.{44}/);expect(fs.statSync(path.join(root,'.env')).mode&0o777).toBe(0o600);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('CommonJS and namespace plugins retain runnable packaging without authored TypeScript',async()=>{
    const files=fixture();
    const compiled=await esbuild.build({stdin:{contents:files['/index.ts'],loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['@anikitenko/fdo-sdk']});
    const snapshot={virtual:{'/package.json':files['/package.json'],'/dist/index.cjs':compiled.outputFiles[0].text},sourceEntry:null,runtimeEntry:'dist/index.cjs',hasCompiled:true};
    const result=await prepareWebApplicationExport({snapshot,plugin,esbuild,sdkSource,viewLibrary,runtimeSources:webExportRuntimeSources()});
    expect(result.report.blockers).toEqual([]);expect(result.files.Dockerfile).toBeDefined();
    expect(result.files['backend/app.cjs']).not.toMatch(/require\(["']@anikitenko\/fdo-sdk/);
    const namespace=fixture();namespace['/index.ts']=namespace['/index.ts'].replace("import {DOM,FDO_SDK,PluginRegistry,defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';","import * as SDK from '@anikitenko/fdo-sdk';const {DOM,FDO_SDK,PluginRegistry,defineRenderOnLoadActions}=SDK;");
    expect((await prepare(namespace)).report.blockers).toEqual([]);
});

test('an incompatible host contract cannot become compatible by choosing a web export',async()=>{
    const result=await prepareWebApplicationExport({snapshot:{virtual:fixture(),sourceEntry:'index.ts',sourceCompatibility:{status:'incompatible',issues:['Requires host API >=2.0.0.']}},plugin,esbuild,sdkSource,viewLibrary,runtimeSources:webExportRuntimeSources()});
    expect(result.report.blockers).toContain('Requires host API >=2.0.0.');expect(result.files).toBeUndefined();
});

// Bundling the full SDK, converting it and starting the exported backend need
// an integration-test budget, especially with concurrent CI workers.
test.each([false,true])('a compiled plugin embedding the public SDK is rebound to standalone services (minified=%s)',async minify=>{
    const original=fixture();
    const built=await esbuild.build({stdin:{contents:original['/index.ts'],loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,minify,external:['electron']});
    const result=await prepareWebApplicationExport({snapshot:{virtual:{'/package.json':original['/package.json'],'/dist/index.cjs':built.outputFiles[0].text},sourceEntry:null,runtimeEntry:'dist/index.cjs'},plugin,esbuild,sdkSource,viewLibrary,runtimeSources:webExportRuntimeSources()});
    expect(result.report.blockers).toEqual([]);
    expect(result.files['backend/app.cjs']).not.toMatch(/require\(["'](?:electron|@anikitenko\/fdo-sdk)/);
    expect(result.files['backend/source/dist/index.cjs']).toMatch(/Object\.assign\([^,]+,require\(/);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'web-embedded-'));
    try{
        for(const [file,content] of Object.entries(result.files)){const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
        const script="(async()=>{const runtime=require('./runtime/application.cjs');require('./backend/app.cjs');await runtime.initialize();const result=await runtime.invoke('counter.increment',{});await runtime.shutdown();console.log(JSON.stringify(result));})().catch(error=>{console.error(error);process.exitCode=1;});";
        const output=execFileSync(process.execPath,['-e',script],{cwd:directory,encoding:'utf8',timeout:15000,env:{...process.env,NODE_PATH:path.resolve('node_modules'),WEB_APP_DATA_DIR:path.join(directory,'data'),WEB_APP_SECRET_KEY:Buffer.alloc(32,7).toString('base64')}});
        expect(JSON.parse(output.trim().split('\n').at(-1))).toEqual({value:1});
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
},30000);

test('incomplete build assets fail review before an invalid ZIP can be offered',async()=>{
    await expect(prepareWebApplicationExport({snapshot:{virtual:fixture(),sourceEntry:'index.ts'},plugin,esbuild,sdkSource,viewLibrary,runtimeSources:{}})).rejects.toThrow('standalone runtime assets are incomplete');
});
