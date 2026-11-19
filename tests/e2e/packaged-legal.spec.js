const {test,expect,_electron:electron}=require('@playwright/test');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');
const fs=require('node:fs');
const path=require('node:path');
const {verifyDistribution}=require('../../scripts/legal/distribution.cjs');

test('packaged application includes verified notices and opens them offline',async({},testInfo)=>{
    test.skip(!process.env.FDO_E2E_EXECUTABLE,'Requires the packaged application runner.');
    let app;
    try{
        app=await launchElectronApp(electron,{isolatedUserDataDir:true});
        const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),resources:process.resourcesPath,platform:process.platform,arch:process.arch}));
        expect(runtime.packaged).toBe(true);
        expect(runtime.version).toBe(require('../../package.json').version);
        const directory=path.join(runtime.resources,'legal');
        const inventory=JSON.parse(fs.readFileSync(path.join(directory,'inventory.json'),'utf8'));
        require('../../scripts/release/legal-evidence.cjs').verifyLegalDirectory(directory,{version:runtime.version,commit:inventory.source.commit,platform:require('../../scripts/legal/clearance.cjs').targetName(runtime)});
        verifyDistribution({resources:runtime.resources,inventory,policy:require('../../third_party/distribution-policy.json')});
        const opened=await app.evaluate(async({Menu,shell})=>{
            const item=Menu.getApplicationMenu().items.flatMap(item=>item.submenu?.items||[]).find(item=>item.label==='Third-party Licenses…');
            if(!item)throw new Error('Missing licenses menu item.');
            const original=shell.openPath;let opened;
            // Capture the OS handoff without launching a user's text editor.
            shell.openPath=async file=>{opened=file;return '';};
            try{await item.click();}finally{shell.openPath=original;}
            return opened;
        });
        expect(opened).toBe(path.join(directory,'THIRD_PARTY_NOTICES.txt'));
        expect(fs.readFileSync(opened,'utf8')).toContain('third-party notices');
        await testInfo.attach('packaged-runtime',{body:JSON.stringify({...runtime,resources:undefined,commit:inventory.source.commit}),contentType:'application/json'});
    }finally{await closeElectronApp(app);}
});
