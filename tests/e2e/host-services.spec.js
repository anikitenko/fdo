const {test, expect, _electron: electron} = require('@playwright/test');
const {Server, utils} = require('ssh2');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const {launchElectronApp, closeElectronApp, dismissBlueprintOverlays} = require('./helpers/electronApp');
const {deploySdkExample, waitForPluginReady, removePlugin, getPluginLogTail, getPluginDiagnostics, selectPluginOpen} = require('./helpers/sdkExamples');

const capabilities = ['system.process.exec', 'system.process.scope.git', 'secrets.use', 'secrets.consume', 'ssh.use', 'ssh.exec', 'ssh.profiles.list'];
const allCapabilities = [...capabilities, 'secrets.set', 'secrets.get', 'secrets.list', 'secrets.delete'];
const pluginSource = `
const {FDO_SDK, PluginRegistry, requestOperatorTool} = require('@anikitenko/fdo-sdk');
class SecretSSHFixture extends FDO_SDK {
    get metadata() {return {name:'Secret SSH Fixture',version:'1.0.0',author:'FDO',description:'Host services integration fixture',icon:'key'};}
    declareCapabilities() {return ${JSON.stringify(allCapabilities)};}
    init() {
        PluginRegistry.registerHandler('secret-crud', async () => {
            try {
                const missing = await this.secrets.get('backend-generated') === null;
                await this.secrets.set('backend-generated', '');
                const empty = await this.secrets.get('backend-generated') === '';
                const generated = require('node:crypto').randomUUID() + '🔐\\n';
                await this.secrets.set('backend-generated', generated);
                const roundtrip = await this.secrets.get('backend-generated') === generated;
                const listed = (await this.secrets.list()).some(entry => entry.key === 'backend-generated');
                const deleted = await this.secrets.delete('backend-generated');
                return {ok:missing && empty && roundtrip && listed && deleted};
            } catch (error) {return {ok:false,code:error.code || 'UNAVAILABLE'};}
        });
        PluginRegistry.registerHandler('git-check', async input => {
            const response = await requestOperatorTool('git', {command:input.command,args:['ls-remote',input.url],cwd:input.cwd,timeoutMs:10000});
            return {ok:response.ok,code:response.code,hasMain: !!response.result?.stdout?.includes('refs/heads/main')};
        });
        PluginRegistry.registerHandler('ssh-check', async () => {
            try {
                const profiles = await this.ssh.listProfiles();
                const result = await this.ssh.exec({profileId:'fixture-server',command:'fixture status',timeoutMs:3000,maxOutputBytes:1024});
                return {ok: result.stdout === 'fixture success', exitCode: result.exitCode, profiles};
            } catch (error) {return {ok:false,code:error.code || 'UNAVAILABLE'};}
        });
    }
    render() {return '<p>Host service fixture</p>';}
}
new SecretSSHFixture();
`;

test('real plugin consumes host-enrolled credentials for pinned SSH and Git CLI and loses access on revocation', async () => {
    test.setTimeout(120000);
    const host = utils.generateKeyPairSync('ed25519');
    const fingerprint = 'SHA256:' + createHash('sha256').update(utils.parseKey(host.private).getPublicSSH()).digest('base64').replace(/=+$/, '');
    const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-e2e-git-profile-'));
    const gitCommand = process.platform === 'win32' ? execFileSync('where', ['git'], {encoding:'utf8'}).trim().split(/\r?\n/)[0] : execFileSync('/usr/bin/which', ['git'], {encoding:'utf8'}).trim();
    const git = args => execFileSync(gitCommand, args, {cwd:gitRoot,stdio:'pipe'});
    git(['init','--bare','remote.git']); git(['init','seed']);
    fs.writeFileSync(path.join(gitRoot,'seed','fixture.txt'),'profile-aware Git fixture');
    git(['-C','seed','add','.']); git(['-C','seed','-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','fixture']);
    git(['-C','seed','push',path.join(gitRoot,'remote.git'),'HEAD:refs/heads/main']);
    const connections = new Set(); let authentications = 0;
    const server = new Server({hostKeys: [host.private]}, client => {
        connections.add(client); client.on('error', () => {}); client.on('close', () => connections.delete(client));
        client.on('authentication', ctx => {authentications++; return ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'private-e2e-password' ? ctx.accept() : ctx.reject();});
        client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptCommand, reject, info) => {
            if (info.command === "git-upload-pack '/fixture/repo.git'") {
                const stream = acceptCommand(), child = spawn(gitCommand, ['upload-pack',path.join(gitRoot,'remote.git')]);
                stream.pipe(child.stdin); child.stdout.pipe(stream,{end:false}); child.stderr.pipe(stream.stderr);
                child.on('close', code => {stream.exit(code);stream.end();}); stream.on('close',()=>child.kill()); child.stdin.on('error',()=>{}); return;
            }
            if (info.command !== 'fixture status') return reject();
            const stream = acceptCommand(); stream.write('fixture success'); stream.exit(0); stream.end();
        })));
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    let app, page;
    const pluginName = 'secrets-ssh-e2e';
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true}); page = await app.firstWindow();
        await app.evaluate(() => {
            const childProcess = process.getBuiltinModule('node:child_process');
            for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
                const original = childProcess[method];
                childProcess[method] = function(command, ...args) {
                    if (typeof command === 'string' && /(?:^|[\\/])ssh(?:\.exe)?$/i.test(command)) throw new Error('External SSH is unavailable in this test.');
                    return original.call(this, command, ...args);
                };
            }
        });
        await deploySdkExample(page, {relativePath:'secrets-ssh-fixture'}, {pluginName, compiledContent:pluginSource, capabilities});
        await selectPluginOpen(page, pluginName);
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText:'Configure FDO'}).click();
        await page.getByRole('tab', {name:'Credentials & SSH',exact:true}).click();
        await page.getByLabel('Plugin', {exact:true}).selectOption(pluginName);
        await page.getByRole('button', {name:'Add credential',exact:true}).click();
        await expect(page.getByRole('button', {name:'Save credential',exact:true})).toBeDisabled();
        await page.getByLabel('Credential name', {exact:true}).fill('password');
        await page.getByLabel('Secret value', {exact:true}).fill('private-e2e-password');
        await page.getByRole('button', {name:'Save credential',exact:true}).click();
        await expect(page.getByRole('dialog', {name:'Add or replace a credential',exact:true})).toHaveCount(0);
        await expect(page.getByRole('button', {name:'Delete credential password',exact:true})).toBeVisible();
        await page.getByRole('button', {name:'New SSH profile',exact:true}).click();
        await expect(page.getByRole('button', {name:'Save SSH profile',exact:true})).toBeVisible();
        if (process.env.FDO_E2E_CREDENTIALS_SCREENSHOTS === '1') await page.screenshot({path:'/tmp/fdo-ssh-profile-editor.png', animations:'disabled'});
        await page.getByLabel('Profile ID', {exact:true}).fill('fixture-server');
        await page.getByLabel('Display name', {exact:true}).fill('Fixture server');
        await page.getByLabel('Hostname or IP address', {exact:true}).fill('127.0.0.1');
        await page.getByLabel('SSH username', {exact:true}).fill('fixture');
        await page.getByLabel('Port', {exact:true}).fill(String(server.address().port));
        await page.getByLabel('Credential reference', {exact:true}).selectOption('password');
        await page.getByLabel('Trusted host-key fingerprint', {exact:true}).fill('not-a-fingerprint');
        await page.getByLabel('Allowed commands (one exact shell command per line)', {exact:true}).fill('fixture status');
        // Blueprint's painted indicator covers the native input; exercise the
        // visible label just as a user does instead of forcing a hidden click.
        await page.getByText('Authorize this plugin to use this profile for SSH commands and profile discovery', {exact:true}).click();
        await page.getByText('Authorize Git to consume this profile’s credential references',{exact:true}).click();
        await page.getByLabel('Read repositories (one exact server-side path per line)',{exact:true}).fill('/fixture/repo.git');
        await page.getByText('I verified this endpoint and host-key fingerprint through a trusted channel', {exact:true}).click();
        await page.getByRole('button', {name:'Save SSH profile',exact:true}).click();
        const profileDialog = page.getByRole('dialog', {name:'New SSH profile',exact:true});
        await expect(profileDialog.getByRole('alert')).toContainText('Enter the server’s SHA256 host-key fingerprint');
        expect((await profileDialog.getByRole('button', {name:'Save SSH profile',exact:true}).boundingBox()).height).toBeLessThan(45);
        await expect(page.getByLabel('Trusted host-key fingerprint', {exact:true})).toBeFocused();
        if (process.env.FDO_E2E_CREDENTIALS_SCREENSHOTS === '1') await page.screenshot({path:'/tmp/fdo-ssh-save-error.png', animations:'disabled'});
        expect((await page.evaluate(id => window.electron.credentialSettings.state(id), pluginName)).profiles).toHaveLength(0);
        await profileDialog.getByRole('button', {name:'Fetch host key',exact:true}).click();
        await expect(profileDialog.getByText('Fetched host key — not verified', {exact:true})).toBeVisible();
        await expect(page.getByLabel('Trusted host-key fingerprint', {exact:true})).toHaveValue('not-a-fingerprint');
        await expect(profileDialog.getByLabel('I verified this endpoint and host-key fingerprint through a trusted channel')).toBeChecked();
        expect(authentications).toBe(0);
        expect((await page.evaluate(id => window.electron.credentialSettings.state(id), pluginName)).profiles).toHaveLength(0);
        await profileDialog.getByRole('button', {name:'Use this fingerprint',exact:true}).click();
        await expect(profileDialog.getByLabel('I verified this endpoint and host-key fingerprint through a trusted channel')).not.toBeChecked();
        await expect(page.getByLabel('Trusted host-key fingerprint', {exact:true})).toHaveValue(fingerprint);
        await page.getByLabel('Trusted host-key fingerprint', {exact:true}).fill('256 ' + fingerprint + ' fixture@server (ED25519)');
        await page.getByText('I verified this endpoint and host-key fingerprint through a trusted channel', {exact:true}).click();
        // Simulate a credential removed while this dialog was open. The backend
        // must return useful field feedback even with stale form options.
        await page.evaluate(id => window.electron.credentialSettings.deleteSecret(id, 'password'), pluginName);
        await page.getByRole('button', {name:'Save SSH profile',exact:true}).click();
        await expect(profileDialog.getByRole('alert')).toContainText('The selected credential no longer exists');
        await expect(page.getByLabel('Credential reference', {exact:true})).toBeFocused();
        await page.evaluate(id => window.electron.credentialSettings.saveSecret(id, 'password', 'private-e2e-password'), pluginName);
        await page.getByRole('button', {name:'Save SSH profile',exact:true}).click();
        await expect(page.getByRole('button', {name:'Delete SSH profile Fixture server',exact:true})).toBeVisible();
        await expect(page.getByRole('dialog', {name:'New SSH profile',exact:true})).toHaveCount(0);
        await page.getByRole('button', {name:'Edit SSH profile Fixture server',exact:true}).click();
        const editDialog = page.getByRole('dialog', {name:'Edit SSH profile',exact:true});
        await expect(editDialog.getByLabel('I verified this endpoint and host-key fingerprint through a trusted channel')).toBeChecked();
        await editDialog.getByLabel('Display name', {exact:true}).fill('Fixture server updated');
        await expect(editDialog.getByLabel('I verified this endpoint and host-key fingerprint through a trusted channel')).toBeChecked();
        await editDialog.getByRole('button', {name:'Save SSH profile',exact:true}).click();
        await expect(editDialog).toHaveCount(0);
        if (process.env.FDO_E2E_CREDENTIALS_SCREENSHOTS === '1') await page.screenshot({path:'/tmp/fdo-ssh-profile-list.png', animations:'disabled'});
        const invoke = (handler = 'ssh-check') => page.evaluate(({id, handler}) => window.electron.plugin.uiMessage(id, {handler,content:{}}), {id:pluginName, handler});
        const result = await invoke();
        expect(result).toMatchObject({ok:true,exitCode:0,profiles:[{id:'fixture-server',label:'Fixture server updated'}]});
        await page.getByRole('button', {name:'Edit SSH profile Fixture server updated',exact:true}).click();
        await editDialog.getByLabel('Allowed commands (one exact shell command per line)',{exact:true}).fill('');
        await editDialog.getByRole('button', {name:'Save SSH profile',exact:true}).click();
        await expect(editDialog).toHaveCount(0);
        expect(await invoke()).toMatchObject({ok:false,code:'ACCESS_DENIED'});
        await page.getByRole('button', {name:'Edit SSH profile Fixture server updated',exact:true}).click();
        await expect(editDialog.getByLabel('Allow all shell commands (dangerous)')).not.toBeChecked();
        await editDialog.getByText('Allow all shell commands (dangerous)',{exact:true}).click();
        await expect(editDialog.getByLabel('Allowed commands (one exact shell command per line)',{exact:true})).toBeDisabled();
        if (process.env.FDO_E2E_CREDENTIALS_SCREENSHOTS === '1') await page.screenshot({path:'/tmp/fdo-ssh-unrestricted.png',animations:'disabled'});
        await editDialog.getByRole('button', {name:'Save SSH profile',exact:true}).click();
        await expect(editDialog).toHaveCount(0);
        await expect(page.getByText('All shell commands',{exact:true})).toBeVisible();
        expect(await invoke()).toMatchObject({ok:true,exitCode:0});
        await page.getByRole('button', {name:'Edit SSH profile Fixture server updated',exact:true}).click();
        await expect(editDialog.getByLabel('Allow all shell commands (dangerous)')).toBeChecked();
        await editDialog.getByRole('button',{name:'Cancel',exact:true}).click();
        const invokeGit = () => page.evaluate(({id,command,cwd,url}) => window.electron.plugin.uiMessage(id,{handler:'git-check',content:{command,cwd,url}}), {id:pluginName,command:gitCommand,cwd:gitRoot,url:`ssh://fixture@127.0.0.1:${server.address().port}/fixture/repo.git`});
        const gitResult = await invokeGit();
        expect(gitResult).toMatchObject({ok:true,hasMain:true});
        // Doctor must retain an actionable host reason even when the plugin
        // returns only a generic failed-command response to its iframe.
        await page.evaluate(id => window.electron.credentialSettings.saveSecret(id, 'password', 'wrong-e2e-password'), pluginName);
        expect(await invokeGit()).toMatchObject({ok: false, code: 'CONNECTION_FAILED'});
        const audit = await page.evaluate(id => window.electron.plugin.getPrivilegedAudit(id, {limit: 80}), pluginName);
        const failure = audit.events.filter(event => event.scope === 'git' && !event.success).at(-1);
        expect(failure.error).toMatchObject({code: 'CONNECTION_FAILED', diagnosticDetails: {reason: 'AUTHENTICATION_FAILED'}});
        expect(failure.id).toBeTruthy(); expect(failure.correlationId).toBeTruthy();
        expect(JSON.stringify(audit)).not.toContain('wrong-e2e-password');
        expect(JSON.stringify(audit)).not.toContain('private-e2e-password');
        await page.evaluate(id => window.electron.credentialSettings.saveSecret(id, 'password', 'private-e2e-password'), pluginName);

        const profileDir = await app.evaluate(({app}) => app.getPath('userData'));
        for (const name of fs.readdirSync(path.join(profileDir,'host-services'))) {
            expect(fs.readFileSync(path.join(profileDir,'host-services',name)).includes(Buffer.from('private-e2e-password'))).toBe(false);
        }
        const logs = await getPluginLogTail(page, pluginName);
        expect(JSON.stringify(logs)).not.toContain('private-e2e-password');
        expect(JSON.stringify(logs)).not.toContain('refs/heads/main');
        const granted = await page.evaluate(({id, capabilities}) => window.electron.plugin.setCapabilities(id, capabilities), {id:pluginName,capabilities:allCapabilities});
        expect(granted.success).toBe(true);
        await expect.poll(() => invoke('secret-crud'), {timeout:15000}).toMatchObject({ok:true});
        const changed = await page.evaluate(({id, capabilities}) => window.electron.plugin.setCapabilities(id, capabilities), {id:pluginName,capabilities:allCapabilities.filter(cap=>'secrets.consume' !== cap)});
        expect(changed.success).toBe(true); await waitForPluginReady(page, pluginName);
        await expect.poll(() => invoke(), {timeout:15000}).toMatchObject({ok:false});
        await expect.poll(invokeGit, {timeout:15000}).toMatchObject({ok:false});
        // The profile exists but its credential cannot be read back through host UI.
        expect(await page.evaluate(id => window.electron.credentialSettings.state(id), pluginName)).not.toHaveProperty('value');
    } finally {
        if (page) await removePlugin(page, pluginName);
        await closeElectronApp(app);
        for (const connection of connections) connection.end();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(gitRoot,{recursive:true,force:true});
    }
});

test('SSH starter explains an empty store, lists authorized profiles and runs only the selected connection', async () => {
    test.setTimeout(120000);
    const key = utils.generateKeyPairSync('ed25519');
    const trustedHostKey = 'SHA256:' + createHash('sha256').update(utils.parseKey(key.private).getPublicSSH()).digest('base64').replace(/=+$/, '');
    const connections = new Set(); let executions = 0;
    const server = new Server({hostKeys: [key.private]}, connection => {
        connections.add(connection); connection.on('error', () => {}); connection.on('close', () => connections.delete(connection));
        connection.on('authentication', ctx => ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'starter-password' ? ctx.accept() : ctx.reject());
        connection.on('ready', () => connection.on('session', accept => accept().on('exec', (acceptCommand, reject, info) => {
            if (info.command !== 'uptime') return reject(); executions++;
            const stream = acceptCommand(); stream.write('12:00 up 2 days, load average: 0.12, 0.34, 0.56\n'); stream.stderr.write('fixture diagnostic\n'); stream.exit(0); stream.end();
        })));
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    let app, page, editor;
    const pluginName = 'ssh-profile-picker';
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-ssh-starter-'));
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true}); page = await app.firstWindow();
        const opening = app.waitForEvent('window');
        await page.evaluate(name => window.electron.system.openEditorWindow({name, template: 'ssh'}), pluginName);
        editor = await opening;
        await editor.waitForFunction(() => window.__editorTestApi?.getState().currentVersion);
        const files = await editor.evaluate(() => Object.fromEntries(window.__editorTestApi.getState().workspaceTreeIds.filter(id => !id.startsWith('/node_modules/') && !id.startsWith('/dist/'))
            .map(id => [id, window.__editorTestApi.getFileContent(id)]).filter(([, content]) => typeof content === 'string')));
        expect(files['/index.ts']).toContain('listSSHProfiles');
        const checked = await page.evaluate(latestContent => window.electron.plugin.typecheck({latestContent}), files);
        expect(checked.success, JSON.stringify(checked)).toBe(true);
        const starterTests = await page.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
        expect(starterTests.success, JSON.stringify(starterTests)).toBe(true);
        const build = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
        expect(build.success, build.error).toBe(true);
        fs.writeFileSync(path.join(folder, 'index.ts'), files['/index.ts']);
        await editor.close(); editor = null;
        await page.evaluate(() => {window.__E2E__ = false;});
        await deploySdkExample(page, {absPath: path.join(folder, 'index.ts'), relativePath: 'ssh-profile-picker'}, {pluginName,
            compiledContent: build.files.outputFiles.find(file => !file.path.endsWith('.map')).text,
            capabilities: ['ssh.use', 'ssh.exec', 'ssh.profiles.list', 'secrets.use', 'secrets.consume']});
        await selectPluginOpen(page, pluginName);
        const frame = page.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
        await expect(frame.locator('[data-role="profile-status"]')).toContainText('No SSH profiles are available for this plugin');
        await expect(frame.getByRole('button', {name: 'Run uptime', exact: true})).toBeDisabled();
        expect(executions).toBe(0);
        const unapproved = await page.evaluate(async ({id, port, trustedHostKey}) => {
            const api = window.electron.credentialSettings;
            await api.saveSecret(id, 'starter-password', 'starter-password');
            return api.saveProfile(id, {
                id: 'development', label: 'Development', host: '127.0.0.1', port, username: 'fixture', trustedHostKey,
                authentication: {type: 'password', passwordRef: {kind: 'secret', key: 'starter-password'}},
                policy: {consumers: [], commands: []},
            }, true);
        }, {id: pluginName, port: server.address().port, trustedHostKey});
        expect(unapproved.success).toBe(true);
        await frame.getByRole('button', {name: 'Refresh profiles', exact: true}).click();
        await expect(frame.locator('[data-role="profile-status"]')).toContainText('No SSH profiles are available for this plugin');
        await expect(frame.getByRole('option', {name: 'Development', exact: true})).toHaveCount(0);
        expect(executions).toBe(0);
        const saved = await page.evaluate(async ({id, port, trustedHostKey}) => {
            const api = window.electron.credentialSettings;
            const secret = await api.saveSecret(id, 'starter-password', 'starter-password');
            const profiles = [];
            for (const [name, label] of [['development', 'Development'], ['production', 'Production']]) profiles.push(await api.saveProfile(id, {
                id: name, label, host: '127.0.0.1', port, username: 'fixture', trustedHostKey,
                authentication: {type: 'password', passwordRef: {kind: 'secret', key: 'starter-password'}},
                policy: {consumers: ['ssh.exec'], commands: ['uptime']},
            }, true));
            return {secret, profiles};
        }, {id: pluginName, port: server.address().port, trustedHostKey});
        expect(saved.secret.success).toBe(true); expect(saved.profiles.every(result => result.success)).toBe(true);
        await frame.getByRole('button', {name: 'Refresh profiles', exact: true}).click();
        await expect(frame.locator('[data-role="profile-status"]')).toContainText('2 profiles available');
        await expect(frame.getByRole('option', {name: 'Development', exact: true})).toHaveCount(1);
        await expect(frame.getByRole('option', {name: 'Production', exact: true})).toHaveCount(1);
        expect(executions).toBe(0);
        await frame.getByLabel('SSH profile', {exact: true}).selectOption('production');
        await frame.getByRole('button', {name: 'Run uptime', exact: true}).click();
        await expect(frame.locator('[data-role="result"]')).toContainText('Production: uptime completed successfully');
        await expect(frame.getByLabel('Standard output (stdout)', {exact:true})).toHaveValue('12:00 up 2 days, load average: 0.12, 0.34, 0.56\n');
        await expect(frame.getByLabel('Standard error (stderr)', {exact:true})).toHaveValue('fixture diagnostic\n');
        await expect(frame.locator('[data-role="parsed-output"]')).toContainText('"oneMinute": 0.12');
        expect(executions).toBe(1);
        if (process.env.FDO_E2E_CREDENTIALS_SCREENSHOTS === '1') await page.screenshot({path: '/tmp/fdo-ssh-template-list.png', animations: 'disabled'});
    } finally {
        if (editor) await editor.close();
        if (page) await removePlugin(page, pluginName);
        await closeElectronApp(app);
        for (const connection of connections) connection.end();
        await new Promise(resolve => server.close(resolve)); fs.rmSync(folder, {recursive: true, force: true});
    }
});

test('Git starter displays selected repository output using different Git-only SSH profiles', async () => {
    test.setTimeout(120000);
    const hostKey = utils.generateKeyPairSync('ed25519');
    const trustedHostKey = 'SHA256:' + createHash('sha256').update(utils.parseKey(hostKey.private).getPublicSSH()).digest('base64').replace(/=+$/, '');
    const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-git-starter-'));
    const gitExecutable = process.platform === 'win32' ? execFileSync('where', ['git'], {encoding:'utf8'}).trim().split(/\r?\n/)[0] : execFileSync('/usr/bin/which', ['git'], {encoding:'utf8'}).trim();
    const git = args => execFileSync(gitExecutable, args, {cwd: gitRoot, stdio: 'pipe'});
    git(['init', '--bare', 'remote.git']); git(['init', 'seed']);
    fs.writeFileSync(path.join(gitRoot, 'seed', 'example.txt'), 'Git starter');
    git(['-C', 'seed', 'add', '.']); git(['-C', 'seed', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture']);
    git(['-C', 'seed', 'push', path.join(gitRoot, 'remote.git'), 'HEAD:refs/heads/main']);
    const connections = new Set(), accessed = [];
    const server = new Server({hostKeys: [hostKey.private]}, connection => {
        connections.add(connection); connection.on('error', () => {}); connection.on('close', () => connections.delete(connection));
        let authorizedRepository;
        connection.on('authentication', ctx => {
            if (ctx.method === 'password' && ctx.username === 'fixture' && ['work-password', 'personal-password'].includes(ctx.password)) {
                authorizedRepository = ctx.password.split('-')[0]; ctx.accept();
            } else ctx.reject();
        });
        connection.on('ready', () => connection.on('session', accept => accept().on('exec', (acceptCommand, reject, info) => {
            if (info.command !== `git-upload-pack '/${authorizedRepository}.git'`) return reject();
            accessed.push(authorizedRepository);
            const stream = acceptCommand(), child = spawn(gitExecutable, ['upload-pack', path.join(gitRoot, 'remote.git')]);
            stream.pipe(child.stdin); child.stdout.pipe(stream, {end: false}); child.stderr.pipe(stream.stderr);
            child.on('close', code => {stream.exit(code); stream.end();}); stream.on('close', () => child.kill()); child.stdin.on('error', () => {});
        })));
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    let app, page, editor; const pluginName = 'git-repository-picker';
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true}); page = await app.firstWindow();
        const opening = app.waitForEvent('window');
        await page.evaluate(name => window.electron.system.openEditorWindow({name, template: 'gitSsh'}), pluginName);
        editor = await opening; await editor.waitForFunction(() => window.__editorTestApi?.getState().currentVersion);
        const files = await editor.evaluate(() => Object.fromEntries(window.__editorTestApi.getState().workspaceTreeIds.filter(id => !id.startsWith('/node_modules/') && !id.startsWith('/dist/'))
            .map(id => [id, window.__editorTestApi.getFileContent(id)]).filter(([, content]) => typeof content === 'string')));
        const repositories = ['work', 'personal'].map(id => ({id, label: id === 'work' ? 'Work repository' : 'Personal repository', url: `ssh://fixture@127.0.0.1:${server.address().port}/${id}.git`}));
        files['/repositories.ts'] = `export const repositories = ${JSON.stringify(repositories)};\nexport const gitExecutable: string = ''; // Detect installed Git for this platform.\nexport const cwd = ${JSON.stringify(gitRoot)};\n`;
        const configuredRepositories = files['/repositories.ts'];
        const rejectedCwd = process.platform === 'win32' ? 'C:/fdo-disallowed-working-folder' : '/fdo-disallowed-working-folder';
        files['/repositories.ts'] = configuredRepositories.replace(JSON.stringify(gitRoot), JSON.stringify(rejectedCwd));
        const checked = await page.evaluate(latestContent => window.electron.plugin.typecheck({latestContent}), files);
        expect(checked.success, JSON.stringify(checked)).toBe(true);
        const tests = await page.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
        expect(tests.success, JSON.stringify(tests)).toBe(true);
        const build = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
        expect(build.success, build.error).toBe(true);
        fs.writeFileSync(path.join(gitRoot, 'index.ts'), files['/index.ts']);
        await editor.close(); editor = null;
        await page.evaluate(() => {window.__E2E__ = false;});
        await deploySdkExample(page, {absPath: path.join(gitRoot, 'index.ts'), relativePath: pluginName}, {pluginName,
            compiledContent: build.files.outputFiles.find(file => !file.path.endsWith('.map')).text,
            capabilities: ['ssh.use']});
        const saved = await page.evaluate(async ({id, port, trustedHostKey}) => {
            const api = window.electron.credentialSettings, results = [];
            for (const name of ['work', 'personal']) {
                await api.saveSecret(id, name + '-password', name + '-password');
                results.push(await api.saveProfile(id, {id: name, label: name + ' Git connection', host: '127.0.0.1', port, username: 'fixture', trustedHostKey,
                    authentication: {type: 'password', passwordRef: {kind: 'secret', key: name + '-password'}},
                    policy: {consumers: ['git'], commands: [], repositories: [{path: '/' + name + '.git', operations: ['ls-remote']}]},
                }, true));
            }
            return results;
        }, {id: pluginName, port: server.address().port, trustedHostKey});
        expect(saved.every(result => result.success)).toBe(true);
        await selectPluginOpen(page, pluginName);
        const frame = page.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
        const gitCapabilities = ['system.process.exec', 'system.process.scope.git', 'ssh.use', 'ssh.exec', 'secrets.use', 'secrets.consume'];
        const diagnostics = await getPluginDiagnostics(page, pluginName);
        expect(diagnostics).not.toBeNull();
        expect([...diagnostics.capabilities.declaration.declared].sort()).toEqual([...gitCapabilities].sort());
        await expect(frame.getByRole('button', {name: 'List remote references', exact: true})).toBeDisabled();
        for (const capability of gitCapabilities.filter(capability => capability !== 'ssh.use')) {
            await expect(frame.locator('[data-role="repository-status"]')).toContainText(capability);
        }
        const denied = await page.evaluate(id => window.electron.plugin.uiMessage(id, {handler: 'inspectConnections', content: {repositoryId: 'work'}}), pluginName);
        expect(denied.permissions.missing.sort()).toEqual(gitCapabilities.filter(capability => capability !== 'ssh.use').sort());
        expect(accessed).toEqual([]);
        await page.getByRole('button', {name: /Plugins Activated:/i}).click();
        await page.getByRole('button', {name: 'Manage plugins', exact: true}).click();
        const manager = page.getByRole('dialog', {name: /Manage Plugins/i});
        await manager.getByRole('button', {name: 'Expand', exact: true}).click();
        await expect(manager.getByRole('checkbox', {name: 'SSH connections', exact: true})).toBeChecked();
        await manager.getByText('Run remote SSH commands', {exact: true}).click();
        await expect(manager.getByRole('checkbox', {name: 'Allow Scoped Tool Execution', exact: true})).not.toBeChecked();
        await expect(manager.getByRole('checkbox', {name: 'Secret store access', exact: true})).not.toBeChecked();
        await expect(manager.getByRole('checkbox', {name: 'Use credential references', exact: true})).not.toBeChecked();
        await manager.getByText('Allow Scoped Tool Execution', {exact: true}).click();
        await manager.getByText('Git Scope', {exact: true}).click();
        await manager.getByText('Secret store access', {exact: true}).click();
        await expect(manager.getByRole('checkbox', {name: 'Use credential references', exact: true})).not.toBeChecked();
        await manager.getByText('Use credential references', {exact: true}).click();
        await manager.getByRole('button', {name: 'Save Capabilities', exact: true}).click();
        await expect.poll(async () => {
            const saved = await page.evaluate(id => window.electron.plugin.get(id), pluginName);
            return [...saved.plugin.capabilities].sort();
        }).toEqual([...gitCapabilities].sort());
        await manager.getByRole('button', {name: 'Close', exact: true}).click();
        await expect(manager).toHaveCount(0);
        await waitForPluginReady(page, pluginName);
        await expect.poll(async () => {
            const response = await page.evaluate(id => window.electron.plugin.uiMessage(id, {handler: 'listRepositories', content: {}}), pluginName);
            return {repositories: response?.repositories?.length, missing: response?.permissions?.missing};
        }).toEqual({repositories: 2, missing: []});
        await frame.getByRole('button', {name: 'Refresh repositories', exact: true}).click();
        await expect(frame.locator('[data-role="repository-status"]')).toContainText('2 repositories configured');
        expect(accessed).toEqual([]);
        await frame.getByRole('button', {name: 'List remote references', exact: true}).click();
        await expect(frame.locator('[data-role="result"]')).toContainText('Working folder "' + rejectedCwd + '"');
        await expect(frame.locator('[data-role="result"]')).toContainText('Set cwd in repositories.ts');
        await expect(frame.locator('[data-role="result"]')).toContainText('Allowed roots:');
        // A host notice for the intentionally rejected folder may be shown.
        await dismissBlueprintOverlays(page);
        expect(accessed).toEqual([]);
        files['/repositories.ts'] = configuredRepositories;
        const fixedBuild = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
        expect(fixedBuild.success, fixedBuild.error).toBe(true);
        await deploySdkExample(page, {absPath: path.join(gitRoot, 'index.ts'), relativePath: pluginName}, {pluginName,
            compiledContent: fixedBuild.files.outputFiles.find(file => !file.path.endsWith('.map')).text,
            capabilities: gitCapabilities});
        await selectPluginOpen(page, pluginName);
        await expect(frame.locator('[data-role="repository-status"]')).toContainText('2 repositories configured');
        for (const id of ['work', 'personal']) {
            await dismissBlueprintOverlays(page);
            await frame.getByLabel('Git repository', {exact: true}).selectOption(id);
            await expect(frame.locator('[data-role="profile-match"]')).toContainText('Read repository path: /' + id + '.git');
            await expect(frame.locator('[data-role="profile-match"]')).toContainText('SSH username: fixture');
            await frame.getByRole('button', {name: 'List remote references', exact: true}).click();
            await expect(frame.locator('[data-role="result"]')).toContainText('references listed successfully');
            await expect(frame.locator('[data-role="git-detection"]')).toContainText('Using Git:');
            await expect(frame.locator('[data-role="git-detection"]')).toContainText('(FOUND)');
            await expect(frame.getByLabel('Standard output (stdout)', {exact: true})).toHaveValue(/refs\/heads\/main/);
            await expect(frame.locator('[data-role="parsed-output"]')).toContainText('"kind": "branch"');
            await expect(frame.getByLabel('Standard error (stderr)', {exact: true})).toHaveValue('');
        }
        expect(accessed).toEqual(['work', 'personal']);
    } finally {
        if (editor) await editor.close(); if (page) await removePlugin(page, pluginName); await closeElectronApp(app);
        for (const connection of connections) connection.end();
        await new Promise(resolve => server.close(resolve)); fs.rmSync(gitRoot, {recursive: true, force: true});
    }
});

test('Git with SSH grants and no enrolled profile rejects without spawning machine Git or SSH', async () => {
    test.setTimeout(60000);
    const git = process.platform === 'win32' ? execFileSync('where', ['git'], {encoding: 'utf8'}).trim().split(/\r?\n/)[0] : execFileSync('/usr/bin/which', ['git'], {encoding: 'utf8'}).trim();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-git-no-profile-'));
    const pluginName = 'git-missing-profile'; let app, page;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true}); page = await app.firstWindow();
        await app.evaluate(() => {
            const processes = process.getBuiltinModule('node:child_process'), original = processes.spawn;
            globalThis.__unexpectedGitSpawns = 0;
            processes.spawn = function(command, ...args) {
                if (typeof command === 'string' && /(?:^|[\\/])(?:git|ssh)(?:\.exe)?$/i.test(command)) {
                    globalThis.__unexpectedGitSpawns++; throw new Error('Machine Git/SSH must not start without an enrolled profile.');
                }
                return original.call(this, command, ...args);
            };
        });
        await deploySdkExample(page, {relativePath: pluginName}, {pluginName, compiledContent: pluginSource, capabilities});
        // Backend authorization does not depend on selecting an iframe in Home.
        await waitForPluginReady(page, pluginName);
        let result;
        await expect.poll(async () => {
            result = await page.evaluate(({id, command, cwd}) => window.electron.plugin.uiMessage(id, {
                handler: 'git-check', content: {command, cwd, url: 'ssh://fixture@127.0.0.1:9/fixture/repo.git'},
            }), {id: pluginName, command: git, cwd});
            return result.code;
        }).toBe('ACCESS_DENIED');
        expect(result).toMatchObject({ok: false, code: 'ACCESS_DENIED'});
        expect(await app.evaluate(() => globalThis.__unexpectedGitSpawns)).toBe(0);
    } finally {
        if (page) await removePlugin(page, pluginName); await closeElectronApp(app);
        fs.rmSync(cwd, {recursive: true, force: true});
    }
});
