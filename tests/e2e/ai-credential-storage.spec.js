const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('migrates legacy AI secrets to OS protection, redacts IPC and survives restart', async ({}, testInfo) => {
    test.setTimeout(120000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-ai-credentials-'));
    const fixtureDir = path.resolve('artifacts/e2e-ai-credentials', String(process.pid));
    fs.mkdirSync(fixtureDir, {recursive: true});
    const fixturePath = path.join(fixtureDir, 'storage-fixture.cjs');
    await esbuild.build({stdin: {resolveDir: process.cwd(), contents: `
        import Store from 'electron-store';
        import {settings} from './src/utils/persistence/store';
        import {PREFIX} from './src/utils/persistence/aiCredentialSettings.cjs';
        const raw = () => new Store({cwd:process.env.FDO_E2E_USER_DATA_DIR,name:'settings',encryptionKey:'FDO-APPLICATION'});
        export function seed() {
            raw().set({
                'ai.chat': [{id:'fixture-chat',name:'Fixture Chat',provider:'openai',model:'fixture',apiKey:'fdo-synthetic-chat-secret',default:true}],
                'ai.coding': [{id:'fixture-code',name:'Fixture Coding',provider:'openrouter',model:'fixture',apiKey:'fdo-synthetic-code-secret',default:true}],
                'ai.codexMcpServers': [{id:'fixture-mcp',name:'Fixture MCP',url:'https://example.invalid/mcp',bearerToken:'fdo-synthetic-bearer-secret',headers:{Authorization:'fdo-synthetic-header-secret'},environment:{TOKEN:'fdo-synthetic-env-secret'},enabled:false,assistantIds:[],enabledTools:[],tools:[],checkedAt:''}],
                'ai.codexMcpAuth': {'fixture-mcp':{tokens:{access_token:'fdo-synthetic-oauth-secret',refresh_token:'fdo-synthetic-refresh-secret'}}},
                'ai.codexHooks': [{id:'fixture-hook',name:'Fixture hook',event:'SessionStart',toolPattern:'',command:'node',args:[],cwd:'',environment:{TOKEN:'fdo-synthetic-hook-secret'},timeoutSeconds:10,enabled:false,assistantIds:[]}],
            });
            return raw().get('ai.chat')[0].apiKey === 'fdo-synthetic-chat-secret';
        }
        export function legacyPresent() {return raw().get('ai.chat')[0].apiKey === 'fdo-synthetic-chat-secret';}
        export function saveNewKey() {settings.set('ai.chat.0.apiKey', 'fdo-synthetic-replacement-secret');}
        export function inspect() {
            const data = raw().store, serialized = JSON.stringify(data);
            return {
                fixedKeyCannotRevealSecrets: !serialized.includes('fdo-synthetic-'),
                apiKeyIsOsEncrypted: data.ai.chat[0].apiKey.startsWith(PREFIX),
                mainChatKeyWorks: settings.resolveAiAssistant('chat',{id:'fixture-chat'}).apiKey === 'fdo-synthetic-chat-secret',
                mainCodingKeyWorks: settings.resolveAiAssistant('coding',{id:'fixture-code'}).apiKey === 'fdo-synthetic-code-secret',
                mcpBearerWorks: settings.get('ai.codexMcpServers')[0].bearerToken === 'fdo-synthetic-bearer-secret',
                mcpHeaderWorks: settings.get('ai.codexMcpServers')[0].headers.Authorization === 'fdo-synthetic-header-secret',
                mcpEnvironmentWorks: settings.get('ai.codexMcpServers')[0].environment.TOKEN === 'fdo-synthetic-env-secret',
                oauthWorks: settings.get('ai.codexMcpAuth')['fixture-mcp'].tokens.refresh_token === 'fdo-synthetic-refresh-secret',
                hookEnvironmentWorks: settings.get('ai.codexHooks')[0].environment.TOKEN === 'fdo-synthetic-hook-secret',
            };
        }
    `}, bundle: true, platform:'node',format:'cjs',target:'node24',external:['electron'],outfile:fixturePath,logLevel:'silent'});
    let app;
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir:true, env:{FDO_E2E_USER_DATA_DIR:profile}});
    const inspect = app => app.evaluate((_electron, filename) => process.mainModule.require(filename).inspect(), fixturePath);
    try {
        app = await launch();
        expect(await app.evaluate((_electron, filename) => process.mainModule.require(filename).seed(), fixturePath)).toBe(true);
        let page = await app.firstWindow();
        await page.getByTestId('header-command-search').waitFor({timeout:30000});
        await app.evaluate(({safeStorage}) => {
            globalThis.__originalCredentialAvailability = safeStorage.isEncryptionAvailable;
            safeStorage.isEncryptionAvailable = () => false;
        });
        await expect(page.evaluate(() => window.electron.settings.ai.secureCredentials())).rejects.toThrow(/OS credential store/);
        const lockedSave = await app.evaluate((_electron, filename) => {
            try {process.mainModule.require(filename).saveNewKey();return 'unexpected-success';}
            catch (error) {return error.code;}
        }, fixturePath);
        expect(lockedSave).toBe('AI_CREDENTIAL_STORE_LOCKED');
        expect(await app.evaluate((_electron, filename) => process.mainModule.require(filename).legacyPresent(), fixturePath)).toBe(true);
        const pending = await page.evaluate(() => window.electron.settings.ai.getAssistants());
        expect(pending.every(assistant => assistant.apiKey === '' && assistant.credentialMigrationPending)).toBe(true);
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText:'Configure FDO'}).click();
        await page.getByRole('tab', {name:/AI Assistants/i}).click();
        await expect(page.getByText('Credential migration needs your keychain', {exact:true})).toBeVisible();
        await app.evaluate(({safeStorage}) => {safeStorage.isEncryptionAvailable = globalThis.__originalCredentialAvailability;});
        await page.getByRole('button', {name:'Retry credential migration'}).click();
        await expect(page.getByText('OS-protected credentials', {exact:true})).toBeVisible();
        // Recreate the legacy fixture to verify automatic startup migration too.
        expect(await app.evaluate((_electron, filename) => process.mainModule.require(filename).seed(), fixturePath)).toBe(true);
        await closeElectronApp(app);app = undefined;
        // Startup performs the legacy migration before exposing assistant IPC.
        app = await launch();page = await app.firstWindow();
        await page.getByTestId('header-command-search').waitFor({timeout:30000});
        const first = await inspect(app);
        for (const value of Object.values(first)) expect(value).toBe(true);
        const publicList = await page.evaluate(() => window.electron.settings.ai.getAssistants());
        expect(publicList).toHaveLength(2);
        for (const assistant of publicList) expect(assistant).toMatchObject({apiKey:'',hasApiKey:true,credentialMigrationPending:false});
        expect(JSON.stringify(publicList)).not.toContain('fdo-synthetic-');
        expect(JSON.stringify(publicList)).not.toContain('fdo-os-credential:');
        await page.evaluate(() => {
            window.__credentialUpdates = [];
            window.electron.settings.ai.on.updated((_event, list) => window.__credentialUpdates.push(list));
        });
        await page.evaluate(() => window.electron.settings.ai.secureCredentials());
        await expect.poll(() => page.evaluate(() => window.__credentialUpdates.length)).toBeGreaterThan(0);
        const updates = await page.evaluate(() => window.__credentialUpdates);
        expect(JSON.stringify(updates)).not.toContain('fdo-synthetic-');
        expect(JSON.stringify(updates)).not.toContain('fdo-os-credential:');
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText:'Configure FDO'}).click();
        await page.getByRole('tab', {name:/AI Assistants/i}).click();
        await expect(page.getByText('OS-protected credentials', {exact:true})).toBeVisible();
        await closeElectronApp(app);app = undefined;
        app = await launch();
        const afterRestart = await inspect(app);
        for (const value of Object.values(afterRestart)) expect(value).toBe(true);
        const host = await app.evaluate(({app}) => ({packaged:app.isPackaged,version:app.getVersion(),electron:process.versions.electron,platform:process.platform,mockKeychain:app.commandLine.hasSwitch('use-mock-keychain')}));
        if (process.env.FDO_E2E_EXECUTABLE) expect(host.packaged).toBe(true);
        const evidence = testInfo.outputPath('ai-credential-storage.json');
        fs.writeFileSync(evidence, JSON.stringify({host, first, afterRestart, lockedMigrationPreserved:true,lockedSaveRejected:true,retryUiWorks:true,listsRedacted:true,broadcastsRedacted:true},null,2));
        await testInfo.attach('ai-credential-storage', {path:evidence,contentType:'application/json'});
    } finally {
        if (app) await closeElectronApp(app);
        fs.rmSync(profile, {recursive:true,force:true});fs.rmSync(fixtureDir, {recursive:true,force:true});
    }
});
