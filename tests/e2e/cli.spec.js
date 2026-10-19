const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {selectPluginOpen} = require('./helpers/sdkExamples');

function spawnCli(args, profile) {
    const packaged = process.env.FDO_E2E_EXECUTABLE;
    return spawn(packaged || require('electron'), ['-r', require.resolve('./helpers/cliNoGuiBootstrap.cjs'), ...(packaged ? [] : ['.']), ...args], {
        cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, ELECTRON_RUN_AS_NODE: '', FDO_E2E: '1', FDO_E2E_MULTI_INSTANCE: '0', FDO_E2E_USER_DATA_DIR: profile},
    });
}
function cli(args, profile) {
    return new Promise((resolve, reject) => {
        const child = spawnCli(args, profile);
        let stdout = '', stderr = '';
        child.stdout.on('data', data => {stdout += data;});child.stderr.on('data', data => {stderr += data;});
        const timer = setTimeout(() => {child.kill();reject(new Error(`CLI did not exit: ${args.join(' ')}\n${stdout}\n${stderr}`));}, 20000);
        child.on('error', error => {clearTimeout(timer);reject(error);});
        child.on('close', code => {clearTimeout(timer);resolve({code, stdout, stderr});});
    });
}
function workspace(root, version = '1.0.0') {
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name:'cli-release-fixture',version,main:'index.ts'}));
    fs.writeFileSync(path.join(root,'metadata.ts'),`export const metadata = {name:'CLI release fixture',version:'${version}',author:'FDO',description:'CLI release smoke',icon:'application'};`);
    fs.writeFileSync(path.join(root, 'index.ts'), `import {metadata} from './metadata';
import {FDO_SDK} from '@anikitenko/fdo-sdk';
class Fixture extends FDO_SDK {
 get metadata(){return metadata;}
 declareCapabilities(){return ['storage'];}
 init(){} render(){return '<h1>CLI version ${version}</h1>';}
}
new Fixture();`);
}

test('CLI runs without a terminal or GUI and preserves errors and source files', async () => {
    test.setTimeout(120000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cli-smoke-'));
    const profile = path.join(root, 'profile'), project = path.join(root, 'plugin with spaces');
    fs.mkdirSync(profile);workspace(project);
    try {
        const validated = await cli(['validate', project, '--json'], profile);
        expect(validated.code, JSON.stringify(validated)).toBe(0);
        expect(JSON.parse(validated.stdout).data).toMatchObject({name: 'cli-release-fixture', capabilities: ['storage'], warnings: []});
        const preview = await cli(['deploy', project, '--dry-run', '--json'], profile);
        expect(preview.code, JSON.stringify(preview)).toBe(0);
        expect(JSON.parse(preview.stdout).data).toMatchObject({dryRun: true, action: 'install', signer: {label: 'root', status: 'will-create'}});
        for (const file of ['dist', 'fdo.signature', 'fdo.meta.json']) expect(fs.existsSync(path.join(project, file))).toBe(false);
        expect(fs.existsSync(path.join(profile, 'plugins.json'))).toBe(false);
        expect(fs.existsSync(path.join(profile, 'certificates.sqlite'))).toBe(false);
        const missingSignerPreview = await cli(['deploy', project, '--dry-run', '--label', 'missing', '--json'], profile);
        expect(missingSignerPreview.code, JSON.stringify(missingSignerPreview)).toBe(1);
        expect(JSON.parse(missingSignerPreview.stdout).error.message).toContain('not found');
        for (const args of [['--help'], ['--cli', '--help'], ['compile', '--help'], ['open', '--help'], ['sign'], ['sdk']]) {
            const result = await cli(args, profile);
            expect(result.code, JSON.stringify(result)).toBe(0);expect(result.stdout).toContain('Usage:');
            expect((result.stdout.match(/Usage:/g) || []).length).toBe(1);
        }
        const version = await cli(['--version'], profile);
        expect(version.code, JSON.stringify(version)).toBe(0);expect(version.stdout.trim()).toBe(require('../../package.json').version);
        for (const args of [['compiel'], ['--unknown'], ['compile'], ['compile', project, '--unknown'], ['compile', path.join(root,'missing')], ['sign','plugin',project,'--label','missing'], ['deploy',project,'--label','missing']]) {
            const result = await cli(args,profile);
            expect(result.code,JSON.stringify({args,...result})).toBe(1);expect(result.stderr).not.toBe('');
        }
        expect(fs.existsSync(path.join(profile,'plugins.json'))).toBe(false);
        const emptyCertificates = await cli(['sign','list'], profile);
        expect(emptyCertificates.code, JSON.stringify(emptyCertificates)).toBe(0);
        expect(emptyCertificates.stdout).toContain('No signing certificates found.');
        const emptyPlugins = await cli(['plugins', 'list', '--json'], profile);
        expect(emptyPlugins.code, JSON.stringify(emptyPlugins)).toBe(0);
        expect(JSON.parse(emptyPlugins.stdout)).toEqual({ok: true, command: 'plugins list', data: []});
        const freshDoctor = await cli(['doctor', '--json'], profile);
        expect(freshDoctor.code, JSON.stringify(freshDoctor)).toBe(1);
        expect(JSON.parse(freshDoctor.stdout).data.checks).toContainEqual(expect.objectContaining({id: 'signing', status: 'warning'}));
        const missingInfo = await cli(['plugins', 'info', 'absent', '--json'], profile);
        expect(missingInfo.code).toBe(1); expect(JSON.parse(missingInfo.stdout).ok).toBe(false);
        const source = fs.readFileSync(path.join(project,'index.ts'),'utf8');
        const compiled = await cli(['--cli','compile',project],profile);
        expect(compiled.code,JSON.stringify(compiled)).toBe(0);expect(compiled.stdout).toContain('Compiled plugin:');
        expect(fs.readFileSync(path.join(project,'index.ts'),'utf8')).toBe(source);
        expect(fs.readdirSync(path.join(project,'dist')).some(file=>file.endsWith('.cjs'))).toBe(true);
        const migrated = await cli(['sdk','migrate','--target',project],profile);
        expect(migrated.code,JSON.stringify(migrated)).toBe(0);expect(migrated.stdout).toContain('Dry-run only.');
        const invalid = await cli(['sdk','migrate','--target',path.join(root,'missing')],profile);
        expect(invalid.code,JSON.stringify(invalid)).toBe(2);
        const unattended = await cli(['sdk','migrate','--target',project,'--write'],profile);
        expect(unattended.code,JSON.stringify(unattended)).toBe(2);expect(unattended.stderr).toContain('interactive terminal');
        // A fresh installation can sign/deploy before the GUI has ever opened.
        const firstSign = await cli(['sign','plugin',project,'--json'], profile);
        expect(firstSign.code,JSON.stringify(firstSign)).toBe(0);
        expect(firstSign.stderr).toContain('Created the default root signing certificate');
        expect(JSON.parse(firstSign.stdout)).toMatchObject({ok: true, command: 'sign plugin'});
        const certificates = await cli(['sign','list'], profile);
        expect((certificates.stdout.match(/^root /gm) || []).length).toBe(1);
        const repeatedSign = await cli(['sign','plugin',project], profile);
        expect(repeatedSign.code,JSON.stringify(repeatedSign)).toBe(0);
        expect(repeatedSign.stdout).not.toContain('Created the default root');
        const firstDeploy = await cli(['deploy',project,'--json'], profile);
        expect(firstDeploy.code,JSON.stringify(firstDeploy)).toBe(0);
        expect(JSON.parse(firstDeploy.stdout)).toMatchObject({ok: true, command: 'deploy'});
        const info = await cli(['plugins','info','cli-release-fixture','--json'], profile);
        expect(info.code, JSON.stringify(info)).toBe(0);
        expect(JSON.parse(info.stdout).data).toMatchObject({id: 'cli-release-fixture', enabled: false, capabilities: [], signature: {status: 'valid'}});
        const registryBeforePreview = fs.readFileSync(path.join(profile, 'plugins.json'), 'utf8');
        const signatureBeforePreview = fs.readFileSync(path.join(project, 'fdo.signature'), 'utf8');
        const updatePreview = await cli(['deploy', project, '--dry-run', '--json'], profile);
        expect(updatePreview.code, JSON.stringify(updatePreview)).toBe(0);
        expect(JSON.parse(updatePreview.stdout).data).toMatchObject({action: 'update', signer: {status: 'existing'}});
        expect(fs.readFileSync(path.join(profile, 'plugins.json'), 'utf8')).toBe(registryBeforePreview);
        expect(fs.readFileSync(path.join(project, 'fdo.signature'), 'utf8')).toBe(signatureBeforePreview);
        const diagnosed = await cli(['doctor','--json'], profile);
        expect(JSON.parse(diagnosed.stdout).data.checks).toContainEqual(expect.objectContaining({id: 'signing', status: 'ok'}));
        fs.appendFileSync(path.join(project, 'dist', fs.readdirSync(path.join(project, 'dist')).find(name => name.endsWith('.cjs'))), '\n// tampered');
        const tampered = await cli(['plugins','info','cli-release-fixture','--json'], profile);
        expect(JSON.parse(tampered.stdout).data.signature.status).toBe('invalid');
        const installed = JSON.parse(fs.readFileSync(path.join(profile,'plugins.json'),'utf8'));
        expect(installed.plugins[0].capabilities).toEqual([]);

    } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('CLI deploy signs, preserves grants and refreshes a running GUI', async () => {
    test.setTimeout(120000);
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-cli-deploy-'));
    const project=path.join(root,'plugin with spaces');workspace(project);
    let app;
    try {
        app=await launchElectronApp(electron,{isolatedUserDataDir:true,env:{FDO_E2E_MULTI_INSTANCE:'0'}});
        const page=await app.firstWindow();
        const profile=await app.evaluate(({app})=>app.getPath('userData'));
        await expect.poll(async()=>await page.evaluate(async()=>{
            const certs=await window.electron.settings.certificates.getRoot();
            return certs.some(cert=>cert.label==='root' && cert.hasPrivateKey);
        }), {timeout:20000}).toBe(true);
        await app.evaluate(({app}) => {globalThis.cliEvents=[];app.on('second-instance', (_event,argv,_cwd,data)=>globalThis.cliEvents.push({argv,data}));});
        const opened = await cli(['open'], profile);
        expect(opened.code, JSON.stringify(opened)).toBe(0);
        await page.evaluate(()=>{window.cliDeployments=[];window.electron.plugin.on.deployFromEditor(id=>window.cliDeployments.push(id));});
        let result=await cli(['deploy',project],profile);
        expect(result.code,JSON.stringify(result)).toBe(0);expect(result.stdout).toContain('Deployed plugin: cli-release-fixture');
        expect(fs.existsSync(path.join(project,'fdo.signature'))).toBe(true);
        await expect.poll(()=>app.evaluate(()=>globalThis.cliEvents),{timeout:10000}).toEqual(expect.arrayContaining([expect.objectContaining({data:expect.objectContaining({fdoCliDeploy:'cli-release-fixture'})})]));
        await expect.poll(()=>page.evaluate(()=>window.cliDeployments.length)).toBe(1);
        const record=await page.evaluate(()=>window.electron.plugin.get('cli-release-fixture'));
        expect(record.plugin.capabilities).toEqual([]);
        await page.evaluate(async()=>{await window.electron.plugin.setCapabilities('cli-release-fixture',['storage']);await window.electron.plugin.activate('cli-release-fixture');});
        await selectPluginOpen(page,'cli-release-fixture');
        const frame=page.frameLocator('iframe[data-plugin-id="cli-release-fixture"]');
        await expect(frame.getByRole('heading',{name:'CLI version 1.0.0'})).toBeVisible();
        workspace(project,'1.1.0');
        result=await cli(['deploy',project],profile);
        expect(result.code,JSON.stringify(result)).toBe(0);
        await expect.poll(()=>page.evaluate(()=>window.cliDeployments.length)).toBe(2);
        await expect(frame.getByRole('heading',{name:'CLI version 1.1.0'})).toBeVisible();
        expect((await page.evaluate(()=>window.electron.plugin.get('cli-release-fixture'))).plugin.capabilities).toEqual(['storage']);
    } finally {await closeElectronApp(app);fs.rmSync(root,{recursive:true,force:true});}
});

test('CLI dev rebuilds on edits, retains artifacts after compiler errors and recovers', async () => {
    test.setTimeout(120000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cli-watch-'));
    const project = path.join(root, 'plugin'), profile = path.join(root, 'profile');
    fs.mkdirSync(profile);workspace(project);
    const child = spawnCli(['dev', project], profile);
    let stdout = '', stderr = '', spawnError;
    child.stdout.on('data', data => {stdout += data;});child.stderr.on('data', data => {stderr += data;});
    child.on('error', error => {spawnError = error;});
    const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({code, signal})));
    try {
        await expect.poll(() => stdout, {timeout: 30000}).toContain('Deployed cli-release-fixture 1.0.0.');
        expect(spawnError).toBeUndefined();
        const registryFile = path.join(profile, 'plugins.json');
        const installed = JSON.parse(fs.readFileSync(registryFile, 'utf8')).plugins[0];
        const bundleFile = path.join(project, installed.entry);
        const bundle = fs.readFileSync(bundleFile, 'utf8'), signature = fs.readFileSync(path.join(project, 'fdo.signature'), 'utf8');
        fs.writeFileSync(path.join(project, 'index.ts'), 'const broken = ;');
        await expect.poll(() => stderr, {timeout: 15000}).toContain('Build/deploy failed:');
        expect(child.exitCode).toBeNull();
        expect(fs.readFileSync(bundleFile, 'utf8')).toBe(bundle);
        expect(fs.readFileSync(path.join(project, 'fdo.signature'), 'utf8')).toBe(signature);
        expect(JSON.parse(fs.readFileSync(registryFile, 'utf8')).plugins[0].metadata.version).toBe('1.0.0');
        workspace(project, '1.1.0');
        await expect.poll(() => stdout, {timeout: 15000}).toContain('Deployed cli-release-fixture 1.1.0.');
        expect(JSON.parse(fs.readFileSync(registryFile, 'utf8')).plugins[0].metadata.version).toBe('1.1.0');
        // Wait through several polling intervals to catch self-triggering build loops.
        await new Promise(resolve => setTimeout(resolve, 1800));
        expect((stdout.match(/Deployed cli-release-fixture/g) || []).length).toBe(2);
        child.kill('SIGINT');
        const result = await closed;
        if (process.platform !== 'win32') {expect(result.code, stderr).toBe(0);expect(stdout).toContain('Stopped watching.');}
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await closed;fs.rmSync(root, {recursive: true, force: true});
    }
});

test('CLI profiles isolate settings, registry and signing identity before persistence starts', async () => {
    test.setTimeout(120000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cli-profiles-'));
    const project = path.join(root, 'plugin'), profile = path.join(root, 'default');
    fs.mkdirSync(profile);workspace(project);
    try {
        const invalid = await cli(['--profile', '../escape', 'plugins', 'list', '--json'], profile);
        expect(invalid.code, JSON.stringify(invalid)).toBe(2);
        expect(JSON.parse(invalid.stdout).error.code).toBe('CLI_STARTUP_ERROR');
        expect(fs.readdirSync(profile)).toEqual([]);
        const deployed = await cli(['--profile', 'development', 'deploy', project, '--json'], profile);
        expect(deployed.code, JSON.stringify(deployed)).toBe(0);
        const named = path.join(profile, 'profiles', 'development');
        expect(fs.existsSync(path.join(named, 'plugins.json'))).toBe(true);
        expect(fs.existsSync(path.join(named, 'certificates.sqlite'))).toBe(true);
        expect(fs.existsSync(path.join(named, 'settings.json'))).toBe(true);
        for (const file of ['plugins.json', 'certificates.sqlite', 'settings.json']) expect(fs.existsSync(path.join(profile, file))).toBe(false);
        const namedList = await cli(['--profile=development', 'plugins', 'list', '--json'], profile);
        expect(JSON.parse(namedList.stdout).data).toEqual([expect.objectContaining({id: 'cli-release-fixture', signature: {status: 'valid'}})]);
        const defaultList = await cli(['plugins', 'list', '--json'], profile);
        expect(JSON.parse(defaultList.stdout).data).toEqual([]);
        const emptyCertificates = await cli(['sign', 'list', '--json'], profile);
        expect(JSON.parse(emptyCertificates.stdout).data).toEqual([]);
        const doctor = await cli(['--profile', 'development', 'doctor', '--json'], profile);
        expect(JSON.parse(doctor.stdout).data.profile).toBe(named);
        const misplaced = await cli(['deploy', project, '--profile', 'other', '--json'], profile);
        expect(misplaced.code).toBe(1);
        expect(fs.existsSync(path.join(profile, 'profiles', 'other'))).toBe(false);
        for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
            const result = await cli(['completion', shell], profile);
            expect(result.code, JSON.stringify(result)).toBe(0);expect(result.stdout).toContain('fdo');
        }
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('named GUI profiles have independent windows, session paths and instance locks', async () => {
    test.setTimeout(120000);
    let primary, named;
    try {
        primary = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_MULTI_INSTANCE: '0'}});
        const base = await primary.evaluate(({app}) => app.getPath('userData'));
        named = await launchElectronApp(electron, {isolatedUserDataDir: true, args: ['--profile', 'development', 'open'],
            env: {FDO_E2E_MULTI_INSTANCE: '0', FDO_E2E_USER_DATA_DIR: base}});
        const paths = await named.evaluate(({app}) => ({data: app.getPath('userData'), session: app.getPath('sessionData')}));
        expect(paths).toEqual({data: path.join(base, 'profiles', 'development'), session: path.join(base, 'profiles', 'development')});
        const opened = await cli(['--profile', 'development', 'open'], base);
        expect(opened.code, JSON.stringify(opened)).toBe(0);
        expect(await primary.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(1);
        expect(await named.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(1);
    } finally {await closeElectronApp(named);await closeElectronApp(primary);}
});

test('CLI init creates usable editor templates and strict verification detects tampering', async () => {
    test.setTimeout(120000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cli-init-')), profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    try {
        const empty = await cli(['plugins', 'verify', '--json'], profile);
        expect(empty.code, JSON.stringify(empty)).toBe(1);
        expect(JSON.parse(empty.stdout).data).toMatchObject({checked: 0, valid: false});
        for (const template of ['blank', 'utility', 'dashboard', 'ssh']) {
            const project = path.join(root, template + ' plugin');
            const created = await cli(['init', project, '--template', template, '--display-name', 'CLI ' + template, '--json'], profile);
            expect(created.code, JSON.stringify(created)).toBe(0);
            expect(JSON.parse(created.stdout).data).toMatchObject({template, name: template + '-plugin', directory: project});
            const validated = await cli(['validate', project, '--json'], profile);
            expect(validated.code, JSON.stringify(validated)).toBe(0);
            expect(JSON.parse(validated.stdout).data.metadata.name).toBe('CLI ' + template);
            expect(fs.existsSync(path.join(project, 'dist'))).toBe(false);
        }
        const project = path.join(root, 'blank plugin');
        const source = fs.readFileSync(path.join(project, 'index.ts'), 'utf8');
        const refused = await cli(['init', project, '--json'], profile);
        expect(refused.code).toBe(1);expect(fs.readFileSync(path.join(project, 'index.ts'), 'utf8')).toBe(source);
        const deployed = await cli(['deploy', project, '--json'], profile);
        expect(deployed.code, JSON.stringify(deployed)).toBe(0);
        const verified = await cli(['plugins', 'verify', '--json'], profile);
        expect(verified.code, JSON.stringify(verified)).toBe(0);
        expect(JSON.parse(verified.stdout).data).toMatchObject({checked: 1, valid: true});
        fs.appendFileSync(path.join(project, 'index.ts'), '\n// changed after signing');
        const invalid = await cli(['plugins', 'verify', 'blank-plugin', '--json'], profile);
        expect(invalid.code, JSON.stringify(invalid)).toBe(1);
        expect(JSON.parse(invalid.stdout).data.plugins[0]).toMatchObject({id: 'blank-plugin', signature: {status: 'invalid'}});
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('CLI tests, profile discovery, rollback, concurrent deploys and log following work together', async () => {
    test.setTimeout(120000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cli-workflow-')), profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    let follower, closed;
    try {
        const project = path.join(root, 'utility');
        expect((await cli(['init', project, '--template', 'utility', '--json'], profile)).code).toBe(0);
        const tested = await cli(['test', project, '--json'], profile);
        expect(tested.code, JSON.stringify(tested)).toBe(0);
        expect(JSON.parse(tested.stdout).data).toMatchObject({success: true, skipped: false});
        fs.writeFileSync(path.join(project, 'failure.test.ts'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('failure',()=>assert.equal(1,2));");
        const failed = await cli(['test', project, '--json'], profile);
        expect(failed.code, JSON.stringify(failed)).toBe(1);expect(JSON.parse(failed.stdout).data.success).toBe(false);
        fs.writeFileSync(path.join(project, 'failure.test.ts'), "import test from 'node:test'; test('timeout',async()=>{await new Promise(resolve=>setTimeout(resolve,10000));});");
        const timedOut = await cli(['test', project, '--timeout', '1', '--json'], profile);
        expect(timedOut.code, JSON.stringify(timedOut)).toBe(1);
        fs.unlinkSync(path.join(project, 'failure.test.ts'));
        const empty = path.join(root, 'empty');fs.mkdirSync(empty);
        expect((await cli(['test', empty, '--json'], profile)).code).toBe(1);
        const other = path.join(root, 'other');expect((await cli(['init', other, '--json'], profile)).code).toBe(0);
        const deployed = await Promise.all([cli(['deploy', project, '--json'], profile), cli(['deploy', other, '--json'], profile)]);
        for (const result of deployed) expect(result.code, JSON.stringify(result)).toBe(0);
        const registryFile = path.join(profile, 'plugins.json');
        const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
        expect(registry.plugins.map(plugin=>plugin.id).sort()).toEqual(['other','utility']);
        const installed = registry.plugins.find(plugin => plugin.id === 'utility');
        const bundle = fs.readFileSync(path.join(project, installed.entry), 'utf8');
        const signature = fs.readFileSync(path.join(project, 'fdo.signature'), 'utf8');
        fs.appendFileSync(path.join(project, 'index.ts'), '\n// modified source');
        const rejected = await cli(['deploy', project, '--label', 'missing', '--json'], profile);
        expect(rejected.code, JSON.stringify(rejected)).toBe(1);
        expect(fs.readFileSync(path.join(project, installed.entry), 'utf8')).toBe(bundle);
        expect(fs.readFileSync(path.join(project, 'fdo.signature'), 'utf8')).toBe(signature);
        expect(JSON.parse(fs.readFileSync(registryFile, 'utf8'))).toEqual(registry);
        const named = await cli(['--profile', 'qa', 'profiles', 'list', '--json'], profile);
        expect(named.code, JSON.stringify(named)).toBe(0);
        expect(JSON.parse(named.stdout).data).toEqual(expect.arrayContaining([
            expect.objectContaining({name:'default',pluginCount:2,current:false}), expect.objectContaining({name:'qa',pluginCount:0,current:true}),
        ]));
        const logDir = path.join(profile, 'plugin-data', 'utility', 'logs');fs.mkdirSync(logDir, {recursive:true});
        const logFile = path.join(logDir,'runtime.log');fs.writeFileSync(logFile,'first\nsecond\n');
        const logs = await cli(['plugins','logs','utility','--lines','1','--json'],profile);
        expect(logs.code,JSON.stringify(logs)).toBe(0);expect(JSON.parse(logs.stdout).data.logs[0].text).toBe('second\n');
        follower = spawnCli(['plugins','logs','utility','--follow','--lines','1'],profile);
        let output='',errors='';follower.stdout.on('data',data=>{output+=data;});follower.stderr.on('data',data=>{errors+=data;});
        closed=new Promise(resolve=>follower.on('close',code=>resolve(code)));
        await expect.poll(()=>output,{timeout:10000}).toContain('second\n');
        fs.appendFileSync(logFile,'appended\n');await expect.poll(()=>output,{timeout:10000}).toContain('appended\n');
        fs.renameSync(logFile,logFile+'.1');fs.writeFileSync(logFile,'rotated\n');
        await expect.poll(()=>output,{timeout:10000}).toContain('rotated\n');
        follower.kill('SIGINT');const code=await closed;
        if(process.platform!=='win32')expect(code,errors).toBe(0);
    } finally {
        if(follower && follower.exitCode===null && follower.signalCode===null)follower.kill('SIGKILL');
        if(closed)await closed;fs.rmSync(root,{recursive:true,force:true});
    }
});
