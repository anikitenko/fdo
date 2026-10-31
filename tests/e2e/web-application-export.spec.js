const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {createRequire,Module}=require('node:module');
const {buildWebExportAssets,webExportRuntimeSources}=require('../../scripts/build-web-export-assets.cjs');
const fixture=require('../fixtures/web-export/application.cjs');
test.use({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL});

test('exported SDK-free application serves browser actions and retains encrypted state across a restart',async({browser})=>{
    test.setTimeout(120000);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-web-standalone-')),output=path.join(directory,'application');
    let child,context;
    const originalNodePath=process.env.NODE_PATH;
    const password=crypto.randomBytes(24).toString('base64'),key=crypto.randomBytes(32).toString('base64');
    const stop=async()=>{if(!child || child.exitCode!==null)return;const current=child;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{current.kill('SIGKILL');reject(new Error('Standalone server did not shut down.'));},12000);current.once('exit',()=>{clearTimeout(timer);resolve();});current.kill('SIGTERM');});};
    try {
        const converter=path.join(directory,'converter.cjs');
        require('esbuild').buildSync({entryPoints:[path.resolve('src/utils/plugins/exporting/webApplicationExport.js')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:converter});
        process.env.NODE_PATH=path.resolve('node_modules');Module._initPaths();
        const files=fixture(),capabilities=['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list','system.process.exec','system.process.scope.test-cli'];
        files['/index.ts']=files['/index.ts'].replace("return ['storage'","return ['system.process.exec','system.process.scope.test-cli','storage'");
        files['/index.ts']=files['/index.ts'].replace("strict:true,handlers:",`strict:true,setup:async()=>{
            const plot=document.createElement('div');plot.id='chart';plot.style.width='400px';document.querySelector('section').appendChild(plot);
            await window.FDOCharts.create(plot,{type:'bar',label:'Standalone chart',xKey:'day',data:[{day:'Monday',value:3}],series:[{key:'value'}],height:160});
        },handlers:`);
        const result=await createRequire(converter)(converter).prepareWebApplicationExport({snapshot:{virtual:files,sourceEntry:'index.ts'},plugin:{id:'fixture',name:'Web counter',capabilities,customProcessScopes:[{scope:'test-cli',allowedExecutables:['/desktop/bin/fake-cli'],allowedCwdRoots:['/desktop/project'],allowedEnvKeys:[],requireConfirmation:true,timeoutCeilingMs:2000,argumentPolicy:{version:1,mode:'first-arg',allowedFirstArgs:['account']}}]},
            sdkSource:fs.readFileSync(require.resolve('@anikitenko/fdo-sdk'),'utf8'),viewLibrary:await buildWebExportAssets(),runtimeSources:webExportRuntimeSources(),esbuild:require('esbuild')});
        expect(result.report.blockers).toEqual([]);
        expect(result.report.adapters).toContainEqual(expect.objectContaining({id:'charts',status:'supported'}));
        for(const [file,content] of Object.entries(result.files)){const target=path.join(output,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
        const fake=path.join(directory,'fake-cli');fs.writeFileSync(fake,'#!'+process.execPath+'\nconsole.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n',{mode:0o700});
        const serviceFile=path.join(output,'deployment/services.json'),services=JSON.parse(fs.readFileSync(serviceFile,'utf8'));services.executables['/desktop/bin/fake-cli']=fake;fs.writeFileSync(serviceFile,JSON.stringify(services));
        execFileSync('npm',['ci','--ignore-scripts','--offline','--no-audit','--no-fund'],{cwd:output,stdio:'pipe',timeout:30000});
        execFileSync(process.execPath,['build.cjs'],{cwd:output,stdio:'pipe',timeout:30000});
        const doctor=JSON.parse(execFileSync(process.execPath,['tools.cjs','check'],{cwd:output,encoding:'utf8',timeout:30000}));
        expect(doctor).toMatchObject({ok:true,tools:[{id:'fake-cli',status:'ready'}]});
        expect(fs.existsSync(path.join(output,'node_modules','@anikitenko','fdo-sdk'))).toBe(false);
        expect(fs.existsSync(path.join(output,'node_modules','electron'))).toBe(false);
        const data=path.join(directory,'state');let logs='';
        const start=async()=>{
            const env={...process.env,PORT:'0',WEB_APP_DATA_DIR:data,WEB_APP_USERNAME:'engineer',WEB_APP_PASSWORD:password,WEB_APP_SECRET_KEY:key};
            delete env.NODE_PATH;delete env.ESBUILD_BINARY_PATH;
            child=spawn(process.execPath,['server.cjs'],{cwd:output,env,stdio:['ignore','pipe','pipe']});
            child.stdout.on('data',value=>logs+=value.toString());child.stderr.on('data',value=>logs+=value.toString());
            await expect.poll(()=>logs.match(/Web application listening on port (\d+)/g)?.at(-1),{message:'Server startup: '+logs}).toBeTruthy();
            const port=logs.match(/Web application listening on port (\d+)/g).at(-1).match(/\d+/)[0],url='http://127.0.0.1:'+port;
            await expect.poll(async()=>fetch(url+'/health/ready').then(response=>response.status)).toBe(200);
            return url;
        };
        let url=await start();
        expect((await fetch(url+'/api/view')).status).toBe(401);
        context=await browser.newContext({httpCredentials:{username:'engineer',password}});
        const page=await context.newPage();await page.goto(url);
        const frame=page.frameLocator('iframe[title="Application"]');
        await expect(frame.getByRole('heading',{name:'Standalone counter'})).toBeVisible();
        await expect(frame.getByRole('figure',{name:'Standalone chart'}).locator('svg').first()).toBeVisible();
        await frame.getByRole('button',{name:'Increment',exact:true}).click();
        await expect(frame.locator('#value')).toHaveText('1');
        await expect(page.locator('#status')).toBeHidden();
        const headers={'Authorization':'Basic '+Buffer.from('engineer:'+password).toString('base64'),'Content-Type':'application/json','X-Web-App-Request':'1'};
        const action=async(handler,content={})=>{const response=await fetch(url+'/api/actions',{method:'POST',headers,body:JSON.stringify({handler,content})});return {status:response.status,body:await response.json()};};
        expect(await action('credentials.save',{value:'standalone-test-secret'})).toMatchObject({status:200,body:{result:{saved:true}}});
        expect(fs.readFileSync(path.join(data,'services.enc')).includes(Buffer.from('standalone-test-secret'))).toBe(false);
        expect((await fetch(url+'/api/actions',{method:'POST',headers:{...headers,'Origin':'https://untrusted.example'},body:'{}'})).status).toBe(403);
        expect((await action('fdo.unknown.v1')).status).toBe(400);
        expect((await action('missing.handler')).status).toBe(404);
        headers['X-Web-App-View']=(await fetch(url+'/api/view',{headers}).then(response=>response.json())).viewId;
        const cli={action:'system.process.exec',payload:{scope:'test-cli',command:'/desktop/bin/fake-cli',args:['account','show'],timeoutMs:1000,encoding:'utf8',dryRun:false,reason:'Export CLI regression'}};
        const approved=action('requestPrivilegedAction',cli);
        let approval;
        await expect.poll(async()=>{const result=await fetch(url+'/api/confirmations',{headers}).then(response=>response.json());approval=result.items[0];return approval?.id;}).toBeTruthy();
        const secondView=(await fetch(url+'/api/view',{headers}).then(response=>response.json())).viewId;
        expect((await fetch(url+'/api/confirmations',{method:'POST',headers:{...headers,'X-Web-App-View':secondView},body:JSON.stringify({id:approval.id,approved:true})})).status).toBe(403);
        expect((await fetch(url+'/api/confirmations',{method:'POST',headers,body:JSON.stringify({id:approval.id,approved:true})})).status).toBe(200);
        const execution=await approved;expect(execution).toMatchObject({status:200,body:{result:{ok:true,result:{exitCode:0}}}});
        expect(JSON.parse(execution.body.result.result.stdout)).toEqual({args:['account','show'],cwd:expect.stringContaining('scopes/root-')});
        expect(await action('requestPrivilegedAction',{...cli,payload:{...cli.payload,command:'/bin/sh'}})).toMatchObject({status:200,body:{result:{ok:false}}});
        expect(await action('requestPrivilegedAction',{...cli,payload:{...cli.payload,args:['delete','everything']}})).toMatchObject({status:200,body:{result:{ok:false}}});
        const denied=action('requestPrivilegedAction',cli);
        await expect.poll(async()=>{const result=await fetch(url+'/api/confirmations',{headers}).then(response=>response.json());approval=result.items[0];return approval?.id;}).toBeTruthy();
        await fetch(url+'/api/confirmations',{method:'POST',headers,body:JSON.stringify({id:approval.id,approved:false})});
        expect(await denied).toMatchObject({body:{result:{ok:false,code:'CANCELLED'}}});
        delete headers['X-Web-App-View'];

        await page.screenshot({path:test.info().outputPath('standalone-web-application.png')});
        await stop();logs='';url=await start();
        expect(await action('counter.current')).toMatchObject({status:200,body:{result:{value:1}}});
        expect(await action('credentials.read')).toMatchObject({status:200,body:{result:{value:'standalone-test-secret'}}});
    } finally {await context?.close();await stop();if(originalNodePath===undefined)delete process.env.NODE_PATH;else process.env.NODE_PATH=originalNodePath;Module._initPaths();fs.rmSync(directory,{recursive:true,force:true});}
});
