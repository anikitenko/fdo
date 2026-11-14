const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('native URL events and second-instance argv dispatch only valid registry links', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir:true});
    try {
        await app.evaluate(({app}) => {
            globalThis.deepLinkRequests = [];
            globalThis.originalDeepLinkFetch = globalThis.fetch;
            globalThis.fetch = async url => {
                if (String(url).includes('/api/v1/plugins/')) return new Response(JSON.stringify({plugin:{id:'example',name:'Example Plugin'},releases:[]}));
                globalThis.deepLinkRequests.push(String(url));
                await new Promise(resolve => {globalThis.releaseDeepLinkRequest = resolve;});
                throw new Error('Offline deep-link test');
            };
            let prevented = false;
            app.emit('open-url', {preventDefault(){prevented=true;}}, 'fdo-fiddle://registry/plugins/example/1.2.3?url=evil');
            globalThis.deepLinkPrevented = prevented;
        });
        expect(await app.evaluate(()=>globalThis.deepLinkPrevented)).toBe(true);
        expect(await app.evaluate(()=>globalThis.deepLinkRequests.length)).toBe(0);
        await app.evaluate(({app}) => app.emit('open-url', {preventDefault(){}}, 'fdo-fiddle://registry/plugins/example/1.2.3'));
        await expect.poll(()=>app.evaluate(()=>globalThis.deepLinkRequests.length)).toBe(1);
        const page = await app.firstWindow();
        const progress = page.getByRole('dialog', {name:'Install plugin',exact:true});
        await expect(progress).toBeVisible();
        await expect(progress.getByText('Checking release and publisher…')).toBeVisible();
        await expect(progress.getByLabel('Plugin installation', {exact:true})).toBeVisible();
        await app.evaluate(()=>globalThis.releaseDeepLinkRequest());
        await expect(progress.getByText('Installation failed')).toBeVisible();
        await expect(progress.getByText('Offline deep-link test',{exact:true})).toBeVisible();
        await progress.getByText('Close',{exact:true}).click();
        await expect(progress).not.toBeVisible();
        await app.evaluate(({app}) => app.emit('second-instance', {}, ['FDO','fdo-fiddle://registry/plugins/example/2.0.0'], '', {}));
        await expect.poll(()=>app.evaluate(()=>globalThis.deepLinkRequests.length)).toBe(2);
        await expect(progress).toBeVisible();
        await expect(progress.getByText('Checking release and publisher…')).toBeVisible();
        await app.evaluate(()=>globalThis.releaseDeepLinkRequest());
        await expect(progress.getByText('Installation failed')).toBeVisible();
        expect(await app.evaluate(()=>globalThis.deepLinkRequests.every(url=>url.startsWith('https://plugins.fdo.alexvwan.me/')))).toBe(true);
    } finally {
        await app.evaluate(()=>{if(globalThis.originalDeepLinkFetch) globalThis.fetch=globalThis.originalDeepLinkFetch;}).catch(()=>{});
        await closeElectronApp(app);
    }
});

test('live registry honors certificate status and keeps networking intact',async()=>{
    test.skip(process.env.FDO_E2E_LIVE_NETWORK !== '1','Explicit live-network validation');
    test.setTimeout(60000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    try {
        await app.evaluate(({dialog,app})=>{
            globalThis.liveInstallApproval=null;
            globalThis.liveRegistryDownloads=0;
            const realFetch=globalThis.fetch;
            globalThis.fetch=(...args)=>{if(String(args[0]).includes('/packages/'))globalThis.liveRegistryDownloads++;return realFetch(...args);};
            const original=dialog.showMessageBox.bind(dialog);
            dialog.showMessageBox=async(...args)=>{
                const options=args.at(-1);
                if(options.title==='Install registry plugin'){
                    globalThis.liveInstallApproval=options.message;
                    return {response:0}; // Exercise the real verification path without installing.
                }
                return original(...args);
            };
            app.emit('open-url',{preventDefault(){}},'fdo-fiddle://registry/plugins/test-shared-1/1.0.1');
        });
        const page=await app.firstWindow();
        await expect.poll(()=>page.evaluate(async()=>{
            const state=await window.electron.registryInstall.getStatus();
            return ['blocked','cancelled','error'].includes(state.phase)?state.phase:'pending';
        }),{timeout:45000}).not.toBe('pending');
        const status=await page.evaluate(()=>window.electron.registryInstall.getStatus());
        const dialog=page.getByRole('dialog',{name:'Install plugin',exact:true});
        if(status.phase==='blocked'){
            await expect(dialog.getByText('Release unavailable')).toBeVisible();
            expect(status.error).toMatch(/revoked|expired/);
            expect(await app.evaluate(()=>globalThis.liveInstallApproval)).toBeNull();
            expect(await app.evaluate(()=>globalThis.liveRegistryDownloads)).toBe(0);
        }else{
            expect(status.phase).toBe('cancelled');
            expect(await app.evaluate(()=>globalThis.liveInstallApproval)).toBe('Install Website Availability Provider v1.0.1?');
            await expect(dialog.getByText('Website Availability Provider',{exact:true})).toBeVisible();
            await expect(dialog.getByText('Installation cancelled')).toBeVisible();
        }
        const result=await app.evaluate(async()=>{
            const response=await fetch('https://github.com',{signal:AbortSignal.timeout(15000)});
            await response.body?.cancel(); return response.status;
        });
        expect(result).toBe(200);
        const gitResult=await app.evaluate(async()=>{
            const path=process.getBuiltinModule('node:path');
            const root=path.join(process.cwd(),'dist/main/git');
            const {execFile}=process.getBuiltinModule('node:child_process');
            return new Promise(resolve=>execFile(path.join(root,'bin/git'),[
                '-c','credential.helper=','-c','http.followRedirects=false','-c','http.sslVerify=true',
                'ls-remote','https://github.com/anikitenko/fdo-plugins.git','HEAD',
            ],{env:{...process.env,GIT_EXEC_PATH:path.join(root,'libexec/git-core'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'},timeout:15000},error=>resolve({success:!error,code:error?.code})));
        });
        expect(gitResult.success).toBe(true);
    }finally {await closeElectronApp(app);}
});
