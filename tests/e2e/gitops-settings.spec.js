const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {ensureRootSigningCertificate} = require('./helpers/rootCertificate');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('GitOps Settings exposes the repository form and validates input through native IPC', async ({}, testInfo) => {
    test.setTimeout(90000);
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_LIVE_AI: '0'}});
        const location = await app.evaluate(({app}) => ({root:app.getAppPath(), packaged:app.isPackaged}));
        const root = location.packaged ? path.join(path.dirname(location.root),'git') : path.join(location.root,'dist/main/git');
        const {layout,environment} = require('../../src/utils/git/bundledGit.cjs');
        const git = layout(root), env = environment(process.env,git);
        expect(execFileSync(git.command,['--version'],{env,encoding:'utf8',timeout:5000})).toMatch(/^git version /);
        const helper = path.join(git.execPath,process.platform==='win32'?'git-remote-https.exe':'git-remote-https');
        // No arguments invokes helper usage, without making a network request.
        // EACCES/ENOENT and Windows loader failures must not pass as usage exits.
        let httpsHelperStarted;
        try {execFileSync(helper,[],{env,stdio:'ignore',timeout:5000});httpsHelperStarted=true;}
        catch(error){httpsHelperStarted=[1,128,129].includes(error.status);}
        expect(httpsHelperStarted).toBe(true);
        const page = await app.firstWindow();
        await page.waitForFunction(() => typeof window.electron?.settings?.gitops?.list === 'function');
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText: 'Configure FDO'}).click();
        await page.getByRole('tab', {name: 'GitOps', exact: true}).click();
        await expect(page.getByRole('heading', {name: 'GitOps', exact: true})).toBeVisible();
        await expect(page.getByRole('heading', {name: 'No Git repositories'})).toBeVisible();
        await expect(page.locator('.bp6-non-ideal-state')).toBeVisible();
        await page.getByRole('button', {name: 'Add Git Repository', exact: true}).click();
        await page.getByLabel('Repository URL', {exact: true}).fill('http://github.com/acme/tools');
        await page.getByRole('button', {name: 'Verify and save', exact: true}).click();
        await expect(page.getByText('Use an HTTPS Git repository URL without embedded credentials, query parameters, or fragments.')).toBeVisible();
        expect(await page.evaluate(() => window.electron.settings.gitops.list())).toEqual({success: true, repositories: []});
        await page.getByLabel('Repository URL', {exact: true}).fill('https://github.com/acme/tools');
        await page.getByLabel('Revision type', {exact: true}).selectOption('tag');
        await page.getByLabel('Tag name', {exact: true}).fill('v1.2.0');
        await page.getByLabel('Authentication', {exact: true}).selectOption('basic');
        await expect(page.getByLabel('Access token / password', {exact: true})).toHaveAttribute('type', 'password');
        await page.getByLabel('Username', {exact: true}).fill('work-account');
        await page.getByLabel('Access token / password', {exact: true}).fill('test-placeholder');
        await page.getByRole('button', {name: 'Cancel', exact: true}).scrollIntoViewIfNeeded();
        await expect(page.getByRole('button', {name: 'Verify and save', exact: true})).toBeInViewport();
        await page.screenshot({path: testInfo.outputPath('gitops-repository-form.png')});
        await page.getByRole('button', {name: 'Cancel', exact: true}).click();
        await expect(page.getByLabel('Repository URL', {exact: true})).not.toBeVisible();
    } finally { if (app) await closeElectronApp(app); }
});

for (const pluginFormat of ['prebuilt', 'source', 'source-main']) {
const sourcePlugin = pluginFormat !== 'prebuilt';
const sourceMain = pluginFormat === 'source-main';
test(`syncs real Git revisions for ${pluginFormat} plugins, signs with the default certificate, and detaches cleanly`, async ({}, testInfo) => {
    test.skip(process.platform === 'win32', 'The local Git transport fixture uses a POSIX executable wrapper.');
    test.setTimeout(90000);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-gitops-native-'));
    const collectionDir = path.join(directory, 'collection');
    const pluginDir = path.join(directory, 'plugin');
    const bin = path.join(directory, 'bin');
    const realGit = require('../../src/utils/git/bundledGit.cjs').bundledGit().command;
    const commit = (cwd, message) => {
        execFileSync(realGit, ['add', '.'], {cwd});
        execFileSync(realGit, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgSign=false', 'commit', '-m', message], {cwd});
    };
    for (const target of [collectionDir, pluginDir, bin]) fs.mkdirSync(target);
    for (const cwd of [collectionDir, pluginDir]) execFileSync(realGit, ['init', '--initial-branch=main', '--template='], {cwd});
    const actualFixture = sourceMain && process.env.FDO_GITOPS_SOURCE_FIXTURE;
    if (actualFixture) {
        fs.cpSync(actualFixture, pluginDir, {recursive: true, filter: file => !path.relative(actualFixture, file).split(path.sep).some(part => part === 'node_modules' || part.startsWith('.'))});
    } else {
        fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(sourceMain
            ? {name: 'native-plugin', main: 'index.ts'}
            : {name: 'native-plugin', version: '1.0.0', author: 'Fixture', description: 'Native GitOps fixture', main: 'index.cjs', ...(sourcePlugin ? {source: 'index.ts'} : {})}));
    }
    const pluginFile = path.join(pluginDir, sourcePlugin ? 'index.ts' : 'index.cjs');
    const actualSource = actualFixture ? fs.readFileSync(pluginFile, 'utf8') : null;
    const pluginCode = value => actualSource ? `${actualSource}\nexport const gitopsFixtureRevision = ${value};\n` : sourcePlugin
        ? `import {FDO_SDK,PluginRegistry} from '@anikitenko/fdo-sdk'; export default class NativePlugin extends FDO_SDK { _metadata = {name: 'Native Plugin', version: '1.0.0', author: 'Fixture', description: 'Source fixture', icon: 'application'}; get metadata(): typeof this._metadata {return this._metadata;} init():void {} render():string {return '<main><h1>Native GitOps plugin ready</h1></main>';} } PluginRegistry.registerPlugin(new NativePlugin()); export const value: number = ${value};`
        : `const {FDO_SDK,PluginRegistry}=require('@anikitenko/fdo-sdk'); class NativePlugin extends FDO_SDK {get metadata(){return {name:'Native Plugin',version:'1.0.0',author:'Fixture',description:'Native GitOps fixture',icon:'application'};} init(){} render(){return '<main><h1>Native GitOps plugin ready</h1></main>';}} PluginRegistry.registerPlugin(new NativePlugin()); module.exports.value = ${value};`;
    fs.writeFileSync(pluginFile, pluginCode(1));
    commit(pluginDir, 'initial plugin');
    fs.writeFileSync(path.join(collectionDir, 'fdo-plugins.yaml'), `apiVersion: fdo.dev/v1alpha1
kind: PluginCollection
metadata:
  name: native-tools
  displayName: Native Tools
  version: 1.0.0
  maintainers:
    - github: anikitenko
spec:
  plugins:
    - name: native-plugin
      repository: https://fixture.example/plugin
      targetRevision: main
      path: /
`);
    commit(collectionDir, 'initial collection');
    // Test-only transport maps HTTPS URLs to local fixture repositories. Production Git commands run unchanged.
    fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
let args = process.argv.slice(2);
const repositories = ${JSON.stringify({'https://fixture.example/collection': `file://${collectionDir}`, 'https://fixture.example/plugin': `file://${pluginDir}`})};
if (['fetch', 'ls-remote'].includes(args[0])) args = ['-c', 'protocol.file.allow=always', ...args.map(arg => repositories[arg] || arg)];
const result = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit', env: process.env});
process.exit(result.status ?? 1);
`, {mode: 0o755});
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
            FDO_E2E_BUNDLED_GIT_COMMAND:path.join(bin,'git'), FDO_E2E_MULTI_INSTANCE: '0', FDO_E2E_LIVE_AI: '0', PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        }});
        const page = await app.firstWindow();
        await ensureRootSigningCertificate(page);
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText: 'Configure FDO'}).click();
        await page.getByRole('tab', {name: 'GitOps', exact: true}).click();
        await page.getByRole('button', {name: 'Add Git Repository', exact: true}).click();
        await page.getByLabel('Repository URL', {exact: true}).fill('https://fixture.example/collection');
        await page.getByRole('button', {name: 'Verify and save', exact: true}).click();
        // Native Tools can paint from onUpdated while save() is still synchronizing.
        // The form closing confirms save() completed before checking the imported plugin.
        await expect(page.getByLabel('Repository URL', {exact: true})).not.toBeVisible({timeout: 30000});
        await expect(page.getByText('Native Tools', {exact: true})).toBeVisible();
        await expect(page.getByRole('link', {name: '@anikitenko'})).toHaveAttribute('href', 'https://github.com/anikitenko');
        await expect(page.getByText('1 plugin', {exact: true})).toBeVisible();
        let installed = await page.evaluate(() => window.electron.plugin.getAll());
        expect(installed.plugins).toHaveLength(1);
        const first = installed.plugins[0];
        await expect.poll(async () => (await page.evaluate(() => window.electron.notifications.get())).filter(item => item.source === 'gitops' && item.title.endsWith(' imported via GitOps')).length).toBe(1);
        const importNotice = (await page.evaluate(() => window.electron.notifications.get())).find(item => item.source === 'gitops' && item.title.endsWith(' imported via GitOps'));
        expect(importNotice.title).toBe(`${first.metadata.name} imported via GitOps`);
        expect(importNotice.message).toContain('installed inactive with no granted capabilities');
        expect(importNotice.actions).toContainEqual({kind:'manage-plugin',pluginId:first.id});
        expect(importNotice.details).toContain(first.gitops.commit);
        expect((await page.evaluate(id => window.electron.plugin.remove(id), first.id))).toMatchObject({success:false});
        expect(first.entry).toBe(sourceMain ? 'dist/index.cjs' : 'index.cjs');
        expect(first.metadata.author).toBeTruthy();
        if (sourcePlugin) {
            expect(fs.readFileSync(path.join(first.home, 'index.ts'), 'utf8')).toBe(pluginCode(1));
            expect(fs.readFileSync(path.join(first.home, first.entry), 'utf8')).not.toContain('get metadata():');
        }
        expect(first.id).toMatch(/^gitops_/);
        expect(first.gitops.declaredId).toBe('native-plugin');
        expect(await page.evaluate(id => window.electron.plugin.verifySignature(id), first.id)).toMatchObject({success: true, signer: {label: 'root'}});
        expect(await page.evaluate(() => window.electron.plugin.getActivated())).toMatchObject({plugins: []});
        // Installation alone cannot prove the iframe boots. Enable through the
        // actual Manage Plugins switch, with the shipped opaque sandbox.
        await page.getByRole('dialog', {name:'Settings',exact:true}).getByRole('button', {name:'Close',exact:true}).click();
        await page.getByRole('button', {name:/Plugins Activated:/i}).click();
        await page.getByRole('button', {name:'Manage plugins',exact:true}).click();
        const activationManager = page.getByRole('dialog', {name:/Manage Plugins/i});
        await page.evaluate(() => {window.__E2E__ = false;});
        await activationManager.getByText('Enabled',{exact:true}).click();
        await activationManager.getByRole('button', {name:'Close',exact:true}).click();
        const activatedFrame = page.frameLocator(`iframe[data-plugin-id="${first.id}"]`);
        await expect(activatedFrame.locator(actualFixture ? process.env.FDO_GITOPS_EXPECT_UI_SELECTOR || 'main' : 'h1')).toBeVisible({timeout:20000});
        await expect(page.locator(`iframe[data-plugin-id="${first.id}"]`)).toHaveAttribute('sandbox','allow-scripts');
        if(pluginFormat!=='source')expect(await page.evaluate(id => window.electron.plugin.deactivate(id),first.id)).toMatchObject({success:true});
        await page.evaluate(() => {window.__E2E__ = true;});
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText:'Configure FDO'}).click();
        await page.getByRole('tab', {name:'GitOps',exact:true}).click();
        if (!sourcePlugin) {
            await page.getByRole('dialog', {name: 'Settings', exact: true}).getByRole('button', {name: 'Close', exact: true}).click();
            await page.getByRole('button', {name: /Plugins Activated:/i}).click();
            await page.getByRole('button', {name: 'Manage plugins', exact: true}).click();
            const manager = page.getByRole('dialog', {name: /Manage Plugins/i});
            await expect(manager.getByRole('button', {name:'Remove plugin',exact:true})).toBeDisabled();
            const badge = manager.getByRole('button', {name: /View GitOps details for/});
            await expect(badge).toHaveText('GitOps');
            await expect(manager.locator('..')).toHaveClass(/bp6-overlay-enter-done/);
            await page.screenshot({path: testInfo.outputPath('gitops-management-badge.png')});
            await badge.click();
            const details = page.getByRole('dialog', {name: 'GitOps details', exact: true});
            await expect(details.getByText('Native Tools', {exact: true})).toBeVisible();
            await expect(details.getByText(first.gitops.commit, {exact: true})).toBeVisible();
            await expect(details.getByText('root', {exact: true})).toBeVisible();
            await expect(details.locator('input, select, textarea')).toHaveCount(0);
            await expect(details.locator('..')).toHaveClass(/bp6-overlay-enter-done/);
            await page.screenshot({path: testInfo.outputPath('gitops-management-details.png')});
            await details.getByRole('button', {name: 'Close', exact: true}).last().click();
            await manager.getByRole('button', {name: 'Close', exact: true}).click();
            await page.getByLabel('Open command search').click();
            await page.getByRole('menuitem').filter({hasText: 'Configure FDO'}).click();
            await page.getByRole('tab', {name: 'GitOps', exact: true}).click();
        }
        fs.writeFileSync(pluginFile, pluginCode(2));
        commit(pluginDir, 'updated plugin');
        await page.getByRole('button', {name: 'Sync now', exact: true}).click();
        await expect(page.getByText('Plugin checks completed. See each plugin for its result.')).toBeVisible();
        installed = await page.evaluate(() => window.electron.plugin.getAll());
        expect(installed.plugins[0].id).toBe(first.id);
        expect(installed.plugins[0].gitops.commit,JSON.stringify(await page.evaluate(()=>window.electron.settings.gitops.list()))).not.toBe(first.gitops.commit);
        await expect(page.getByText(/updated via GitOps/)).toBeVisible();
        await expect.poll(async () => (await page.evaluate(() => window.electron.notifications.get()))
            .filter(notice => notice.title.endsWith('updated via GitOps')).length).toBe(1);
        const updateNotice = (await page.evaluate(() => window.electron.notifications.get()))
            .find(notice => notice.title.endsWith('updated via GitOps'));
        expect(updateNotice).toMatchObject({type: 'success', read: false});
        expect(updateNotice.details).toContain(installed.plugins[0].gitops.commit);
        expect(updateNotice.details).toContain('https://fixture.example/plugin');
        expect(fs.existsSync(first.home)).toBe(false);
        if(pluginFormat==='source') {
            const approved=installed.plugins[0];
            const beforeTrace=await page.evaluate(id=>window.electron.plugin.getLogTrace(id),first.id);
            const starts=beforeTrace.lifecycleEvents.filter(event=>event.event==='process.spawned').length;
            fs.writeFileSync(pluginFile,pluginCode(3).replace('init():void {}',"declareCapabilities(){return ['ssh.use','ssh.status.watch','secrets.use','secrets.consume'];} init():void {}"));
            commit(pluginDir,'request SSH monitoring permissions');
            await page.getByRole('button',{name:'Sync now',exact:true}).click();
            const reviewButton=page.getByRole('button',{name:'Review permissions',exact:true});
            await expect(reviewButton).toBeVisible();
            const staged=(await page.evaluate(()=>window.electron.plugin.getAll())).plugins[0];
            expect(staged.home).toBe(approved.home);expect(staged.capabilities).toEqual([]);
            expect(staged.gitops.pendingUpdate.addedCapabilities).toHaveLength(4);
            const afterTrace=await page.evaluate(id=>window.electron.plugin.getLogTrace(id),first.id);
            expect(afterTrace.lifecycleEvents.filter(event=>event.event==='process.spawned')).toHaveLength(starts);
            await expect(activatedFrame.getByRole('heading',{name:'Native GitOps plugin ready'})).toBeVisible();
            const notices=(await page.evaluate(()=>window.electron.notifications.get())).filter(notice=>notice.title.includes('update needs permission approval'));
            expect(notices).toHaveLength(1);expect(notices[0].details).toContain('ssh.status.watch');
            await reviewButton.click();
            let reviewDialog=page.getByRole('dialog',{name:'Review update for native-plugin',exact:true});
            await expect(reviewDialog.getByRole('button',{name:'Grant listed permissions and update'})).toBeDisabled();
            await reviewDialog.getByRole('button',{name:'Decline this version'}).click();
            await expect(reviewDialog).toHaveCount(0);
            expect((await page.evaluate(()=>window.electron.plugin.getAll())).plugins[0].home).toBe(approved.home);
            await page.getByRole('button',{name:'Review again',exact:true}).click();await reviewButton.click();
            reviewDialog=page.getByRole('dialog',{name:'Review update for native-plugin',exact:true});
            const checkboxes=reviewDialog.getByRole('checkbox');await expect(checkboxes).toHaveCount(4);
            for(let index=0;index<4;index++)await checkboxes.nth(index).locator('..').click();
            await page.screenshot({path:testInfo.outputPath('gitops-permission-review.png')});
            await reviewDialog.getByRole('button',{name:'Grant listed permissions and update'}).click();
            await expect(reviewDialog).toHaveCount(0);
            const applied=(await page.evaluate(()=>window.electron.plugin.getAll())).plugins[0];
            expect(applied.gitops.commit).toBe(staged.gitops.pendingUpdate.candidate.gitops.commit);
            expect(applied.capabilities.sort()).toEqual(['secrets.consume','secrets.use','ssh.status.watch','ssh.use']);
            expect(applied.gitops.pendingUpdate).toBeUndefined();
            expect((await page.evaluate(()=>window.electron.plugin.getActivated())).plugins).toContain(first.id);
            await expect(activatedFrame.getByRole('heading',{name:'Native GitOps plugin ready'})).toBeVisible();
            await page.evaluate(id=>window.electron.plugin.deactivate(id),first.id);
        }
        const intervalGroup = page.getByRole('group', {name: 'Check interval for Native Tools'});
        await intervalGroup.getByRole('spinbutton', {name: 'minutes', exact: true}).fill('7');
        await intervalGroup.getByRole('button', {name: 'Save interval'}).click();
        await expect.poll(async () => (await page.evaluate(() => window.electron.settings.gitops.list())).repositories[0].checkIntervalMinutes).toBe(7);
        if (!sourcePlugin) {
            fs.appendFileSync(path.join(collectionDir, 'fdo-plugins.yaml'), `    - name: unavailable-plugin
      repository: https://fixture.example/plugin
      targetRevision: missing-release
      path: /
`);
            commit(collectionDir, 'add unavailable declaration');
            await page.getByRole('button', {name: 'Sync now', exact: true}).click();
            await expect(page.getByRole('button', {name: /Plugins \(2\)/})).toBeVisible();
            await page.getByRole('button', {name: /Plugins \(2\)/}).click();
            const unavailable = page.getByRole('region', {name: 'Plugin unavailable-plugin'});
            await expect(unavailable.getByText(/contact the collection maintainer/)).toBeVisible();
            await expect(page.getByRole('region', {name: 'Plugin native-plugin'}).getByText('Installed', {exact: true})).toBeVisible();
            // Once the maintainer publishes the missing tag, the user can retry this plugin alone.
            execFileSync(realGit, ['tag', 'missing-release'], {cwd: pluginDir});
            const beforeRetry = (await page.evaluate(() => window.electron.plugin.getAll())).plugins.find(plugin => plugin.gitops.declaredId === 'native-plugin');
            await page.getByRole('dialog', {name: 'Settings', exact: true}).getByRole('button', {name: 'Close', exact: true}).click();
            await page.getByRole('button', {name: /^Open notifications/}).click();
            await page.getByPlaceholder('Filter notifications...').fill('unavailable-plugin');
            const incident = page.getByRole('listitem').filter({hasText: 'Couldn’t synchronize unavailable-plugin'});
            await incident.getByRole('button', {name: 'Retry', exact: true}).click();
            const recovered = page.getByRole('listitem').filter({hasText: 'unavailable-plugin in Native Tools synchronization recovered'});
            await expect(recovered.getByText('Resolved', {exact: true})).toBeVisible();
            await recovered.getByRole('button', {name: 'View GitOps repository', exact: true}).click();
            await expect(page.getByRole('tab', {name: 'GitOps', exact: true})).toHaveAttribute('aria-selected', 'true');
            await page.getByRole('button', {name: /Plugins \(2\)/}).click();
            await expect(unavailable.getByText('Installed', {exact: true})).toBeVisible();
            const afterRetry = await page.evaluate(() => window.electron.plugin.getAll());
            expect(afterRetry.plugins).toHaveLength(2);
            expect(afterRetry.plugins.find(plugin => plugin.id === beforeRetry.id).home).toBe(beforeRetry.home);
        } else {
            await page.getByRole('button', {name: /Plugins \(1\)/}).click();
        }
        await page.screenshot({path: testInfo.outputPath('gitops-synchronized-collection.png')});
        await page.getByRole('button', {name: 'Remove', exact: true}).click();
        await expect(page.getByRole('heading', {name: 'No Git repositories'})).toBeVisible();
        installed = await page.evaluate(() => window.electron.plugin.getAll());
        expect(installed.plugins[0].gitops).toBeUndefined();
        expect(await page.evaluate(id => window.electron.plugin.verifySignature(id), first.id)).toMatchObject({success: true, signer: {label: 'root'}});
        expect((await page.evaluate(() => window.electron.notifications.get()))
            .filter(notice => notice.title.endsWith('updated via GitOps'))).toEqual([updateNotice]);
        await page.getByRole('dialog', {name: 'Settings', exact: true}).getByRole('button', {name: 'Close', exact: true}).click();
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText: 'View system notifications'}).click();
        await page.getByPlaceholder('Filter notifications...').fill('updated via GitOps');
        const history = page.getByRole('list', {name: 'Notifications'});
        await expect(history.getByRole('heading').filter({hasText: updateNotice.title})).toBeVisible();
        await expect(history.getByRole('listitem')).toContainText(updateNotice.message);
        await history.getByRole('button', {name: 'Show details', exact: true}).click();
        await expect(history.getByRole('listitem')).toContainText(updateNotice.details);
        await history.getByRole('button', {name: 'View plugin', exact: true}).click();
        await expect(page.getByRole('dialog', {name: /Manage Plugins/i})).toBeVisible();
        expect(await page.evaluate(() => window.electron.plugin.getActivated())).toMatchObject({plugins: []});
    } finally {
        if (app) await closeElectronApp(app);
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
}
