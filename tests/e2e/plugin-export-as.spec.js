const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launchElectronApp,closeElectronApp,dismissBlueprintOverlays}=require('./helpers/electronApp');
const fixture=require('../fixtures/web-export/application.cjs');

test('Manage Plugins reviews and saves a standalone web archive through Export As',async()=>{
    test.setTimeout(120000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'web-export-save-'));
    try {
        const output=path.join(directory,'application.zip');
        const userData=await app.evaluate(({app})=>app.getPath('userData'));
        {
            const home=path.join(userData,'plugins','web-export-fixture');
            for(const [file,content] of Object.entries(fixture())){const target=path.join(home,file.replace(/^\//,''));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
            const registry=path.join(userData,'plugins.json');
            const data=fs.existsSync(registry)?JSON.parse(fs.readFileSync(registry,'utf8')):{plugins:[]};
            data.plugins.push({id:'web-export-fixture',home,entry:'dist/index.cjs',metadata:{name:'Web counter',version:'1.0.0',author:'FDO',description:'Web export fixture',icon:'code'},
                capabilities:['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list']});
            fs.writeFileSync(registry,JSON.stringify(data));
        }
        await app.evaluate(({dialog},output)=>{
            dialog.showSaveDialog=async()=>({canceled:false,filePath:output});
        },output);
        const window=await app.firstWindow();await window.reload();await window.waitForLoadState('domcontentloaded');await dismissBlueprintOverlays(window);
        await window.getByRole('button',{name:/Plugins Activated:/i}).click();
        await window.getByRole('button',{name:'Manage plugins',exact:true}).click();
        await window.getByRole('button',{name:'Export As…',exact:true}).click();
        const dialog=window.getByRole('dialog',{name:'Export As · Web counter',exact:true});
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Export format',{exact:true}).selectOption('web');
        await expect(dialog.getByText('Application conversion prepared',{exact:true})).toBeVisible();
        await expect(dialog.getByRole('button',{name:'Azure deployment guide',exact:true})).toBeVisible();
        await dialog.getByRole('button',{name:'Azure deployment guide',exact:true}).click();
        const deploymentGuide=window.getByRole('dialog',{name:'Cloud deployment guide',exact:true});
        await expect(deploymentGuide.getByRole('region',{name:'Azure Container Apps deployment instructions'})).toContainText('Storage File Data SMB MI Admin');
        await deploymentGuide.getByLabel('Deployment platform').selectOption('aws');
        await expect(deploymentGuide.getByRole('region',{name:'AWS ECS Fargate deployment instructions'})).toContainText('EFS');
        const guideBounds=await deploymentGuide.boundingBox(),closeBounds=await deploymentGuide.getByRole('button',{name:'Close guide',exact:true}).boundingBox();
        expect(guideBounds.y+guideBounds.height-closeBounds.y-closeBounds.height).toBeLessThan(24);
        await deploymentGuide.screenshot({path:test.info().outputPath('aws-ecs-deployment-guide.png'),animations:'disabled'});
        await deploymentGuide.getByLabel('Deployment platform').selectOption('gcp');
        await expect(deploymentGuide.getByRole('region',{name:'Google Cloud Run deployment instructions'})).toContainText('Filestore');
        await expect(deploymentGuide.getByRole('region',{name:'Google Cloud Run deployment instructions'})).toContainText('.gcloudignore');
        await deploymentGuide.getByLabel('Jump to section').selectOption({label:'6. Deploy with storage, credentials and background CPU'});
        await expect(deploymentGuide.getByRole('heading',{name:'6. Deploy with storage, credentials and background CPU'})).toBeInViewport();
        await deploymentGuide.screenshot({path:test.info().outputPath('gcp-cloud-run-deployment-guide.png'),animations:'disabled'});
        await window.keyboard.press('Escape');
        await expect(deploymentGuide).not.toBeVisible();
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Container port',{exact:true}).fill('9090');
        await expect(dialog.getByRole('button',{name:'Export web application',exact:true})).toBeDisabled();
        await dialog.getByRole('button',{name:'Review installed version',exact:true}).click();
        await expect(dialog.getByText('Application conversion prepared',{exact:true})).toBeVisible();
        await dialog.getByText(/Capabilities and services ·/).click();
        await expect(dialog.getByText('secrets.get',{exact:true})).toBeVisible();
        await window.screenshot({path:test.info().outputPath('export-as-web-application.png'),animations:'disabled'});
        await dialog.getByRole('button',{name:'Export web application',exact:true}).click();
        await expect(dialog.getByRole('status')).toContainText(output);
        expect(fs.readFileSync(output).subarray(0,2).toString()).toBe('PK');
        const exported=(await require('unzipper').Open.buffer(fs.readFileSync(output))).files;
        expect((await exported.find(file=>file.path==='Dockerfile').buffer()).toString()).toContain('EXPOSE 9090');
        expect((await exported.find(file=>file.path==='docker-compose.yml').buffer()).toString()).toContain('127.0.0.1:9090:9090');
        for(const [file,source] of [['docs/AZURE_CONTAINER_APPS.md','AZURE_CONTAINER_APPS_DEPLOYMENT.md'],['docs/AWS_ECS.md','AWS_ECS_DEPLOYMENT.md'],['docs/GCP_CLOUD_RUN.md','GCP_CLOUD_RUN_DEPLOYMENT.md']])expect((await exported.find(entry=>entry.path===file).buffer()).toString()).toBe(fs.readFileSync(path.resolve('docs',source),'utf8'));
        await dialog.getByText(/Container CLI tools ·/).click();
        await expect(dialog.getByText(/No container CLI tools were identified/)).toBeVisible();
        const editorOpened=app.waitForEvent('window');
        await dialog.getByRole('button',{name:'Edit package.json tool requirements',exact:true}).click();
        const editor=await editorOpened;
        await editor.waitForLoadState('domcontentloaded');
        await expect(editor.getByRole('region',{name:'Container tool setup'})).toBeVisible({timeout:30000});
        await expect.poll(()=>editor.evaluate(()=>window.__editorTestApi?.getState?.().activeTabId)).toBe('/package.json');
        await expect.poll(()=>editor.evaluate(()=>window.__editorTestApi?.getState?.().selectedId)).toBe('/package.json');
        await editor.screenshot({path:test.info().outputPath('export-tool-requirements-editor.png'),animations:'disabled'});
        const bar=editor.getByRole('region',{name:'Container tool setup'});
        expect((await bar.boundingBox()).height).toBeLessThan(140);
        await bar.getByRole('button',{name:'Installation guide'}).click();
        const guide=editor.getByRole('dialog',{name:'Container tool installation guide'});
        await expect(guide).toBeVisible();
        await guide.getByLabel('How is the tool distributed?').selectOption('artifact');
        await expect(guide.getByText(/Template: replace the example URL and hash/)).toBeVisible();
        await guide.getByLabel('How is the tool distributed?').selectOption('image');
        await expect(guide.getByText('Prepare a base image with the tool installed',{exact:true})).toBeVisible();
        await guide.screenshot({path:test.info().outputPath('custom-tool-installation-guide.png'),animations:'disabled'});
        await guide.getByRole('button',{name:'Close guide'}).click();
        await expect(guide).not.toBeVisible();
        await expect.poll(()=>editor.evaluate(()=>window.__editorTestApi?.getState?.().activeTabId)).toBe('/package.json');

    }finally{await closeElectronApp(app);fs.rmSync(directory,{recursive:true,force:true});}
});

test('approved CLI export includes Docker and Compose without a migration gate',async()=>{
    test.setTimeout(120000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'web-migration-save-'));
    try {
        const output=path.join(directory,'migration.zip'),files=fixture();
        files['/index.ts']=files['/index.ts'].replace("return ['storage'","return ['system.process.exec','system.process.scope.azure-finops','storage'");
        files['/scripts/browser-smoke.cjs']="const fs=require('node:fs');process.parentPort={};require(process.env.PLUGIN_ENTRY);";
        const userData=await app.evaluate(({app})=>app.getPath('userData')),home=path.join(userData,'plugins','migration-fixture');
        for(const [file,content] of Object.entries(files)){const target=path.join(home,file.replace(/^\//,''));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
        const registry=path.join(userData,'plugins.json'),data=fs.existsSync(registry)?JSON.parse(fs.readFileSync(registry,'utf8')):{plugins:[]};
        const grants=['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list','system.process.exec','system.process.scope.azure-finops'];
        data.plugins.push({id:'migration-fixture',home,entry:'dist/index.cjs',metadata:{name:'Azure migration fixture',version:'1.0.0',author:'FDO',description:'CLI migration fixture',icon:'code'},capabilities:grants});
        fs.writeFileSync(registry,JSON.stringify(data));
        await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
        const window=await app.firstWindow();await window.reload();await window.waitForLoadState('domcontentloaded');await dismissBlueprintOverlays(window);
        await window.getByRole('button',{name:/Plugins Activated:/i}).click();await window.getByRole('button',{name:'Manage plugins',exact:true}).click();
        await window.getByRole('button',{name:'Export As…',exact:true}).click();
        const dialog=window.getByRole('dialog',{name:'Export As · Azure migration fixture',exact:true});
        await dialog.getByLabel('Export format',{exact:true}).selectOption('web');
        await expect(dialog.getByText('Application conversion prepared',{exact:true})).toBeVisible();
        await expect(dialog.getByRole('button',{name:'Export web application',exact:true})).toBeEnabled();
        await expect(dialog.getByRole('button',{name:'Export migration work package',exact:true})).toHaveCount(0);
        await expect(dialog.getByText(/direct node:fs access/)).toHaveCount(0);
        await dialog.getByText(/Analysis scope ·/).click();
        await expect(dialog.getByText('Excluded: /scripts/browser-smoke.cjs',{exact:true})).toBeVisible();
        await window.screenshot({path:test.info().outputPath('web-migration-recovery.png'),animations:'disabled'});
        await dialog.getByRole('button',{name:'Export web application',exact:true}).click();
        await expect(dialog.getByRole('status')).toContainText(output);expect(fs.readFileSync(output).subarray(0,2).toString()).toBe('PK');
        expect(fs.readFileSync(path.join(home,'index.ts'),'utf8')).toBe(files['/index.ts']);
        expect(JSON.parse(fs.readFileSync(registry,'utf8')).plugins.find(item=>item.id==='migration-fixture').capabilities).toEqual(grants);
        const entries=(await require('unzipper').Open.buffer(fs.readFileSync(output))).files.map(file=>file.path);expect(entries).toEqual(expect.arrayContaining(['Dockerfile','docker-compose.yml','runtime/service-core.cjs','setup.cjs']));
    }finally{await closeElectronApp(app);fs.rmSync(directory,{recursive:true,force:true});}
});
