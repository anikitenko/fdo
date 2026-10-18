/** @jest-environment node */
import {inspectToolPrerequisites} from '../../src/utils/system/toolPrerequisites';
import {getAllHostProcessScopePolicies} from '../../src/utils/plugins/security/privilegedProcessScopeRegistry';
import {TOOL_INSTALL_CATALOG, x11InstallGuide} from '../../src/utils/system/toolInstallCatalog';
const missing = async () => {throw Object.assign(new Error('missing'), {code:'ENOENT'});};
const file = async () => ({isFile:() => true});
test('new capability scopes are discovered and reuse an executable recipe without UI registration', async () => {
    const policies = {newScope:{scope:'new-cloud-workflow',category:'Cloud',allowedExecutables:['/usr/bin/az','C:\\tools\\az.cmd']}, oldScope:{scope:'azure-cli',category:'Cloud',allowedExecutables:['/usr/bin/az']}};
    const inventory = await inspectToolPrerequisites({platform:'linux', policies, stat:file, access:missing});
    expect(inventory.tools).toHaveLength(1);
    expect(inventory.tools[0]).toMatchObject({id:'az',status:'missing',paths:['/usr/bin/az'],capabilities:['system.process.scope.new-cloud-workflow','system.process.scope.azure-cli'],installation:{label:'Azure CLI',url:expect.stringContaining('learn.microsoft.com')}});
    expect(inventory.tools[0].installation.command).toBe('');
});
test('Windows command wrappers and executable names deduplicate; Unix candidates are excluded', async () => {
    const result = await inspectToolPrerequisites({platform:'win32', policies:{az:{scope:'azure-cli',category:'Cloud',allowedExecutables:['C:\\tools\\az.cmd','C:\\other\\az.exe','/usr/bin/az']}},stat:file,access:async () => {}});
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({id:'az',status:'found',executable:'C:\\tools\\az.cmd',installation:{command:'winget install --exact --id Microsoft.AzureCLI'}});
    expect(result.x11).toMatchObject({supported:false,url:'',command:''});
});
test('unreadable files are unavailable, directories are never executables, unknown tools have no guessed installer', async () => {
    const result = await inspectToolPrerequisites({platform:'linux', policies:{a:{scope:'new',category:'New',allowedExecutables:['/usr/bin/unknown','/usr/bin/directory']}},stat:async candidate => ({isFile:() => !candidate.endsWith('directory')}),access:async () => {throw Object.assign(new Error('denied'),{code:'EACCES'});}});
    expect(result.tools.find(tool => tool.id==='unknown')).toMatchObject({status:'unavailable',installation:null});
    expect(result.tools.find(tool => tool.id==='directory')).toMatchObject({status:'missing',executable:''});
});
test('live registry inventory includes all curated tool families and checks only files, without spawning programs', async () => {
    for (const platform of ['darwin','linux','win32']) {
        const result = await inspectToolPrerequisites({platform,stat:file,access:missing});
        expect(result.tools.map(tool => tool.id)).toEqual(expect.arrayContaining(['git','az','aws','docker','kubectl','helm','terraform']));
        expect(result.tools.every(tool => ['missing','unsupported'].includes(tool.status))).toBe(true);
        expect(result.tools.every(tool => tool.installation===null || tool.installation.url.startsWith('https://'))).toBe(true);
    }
    expect(Object.keys(getAllHostProcessScopePolicies()).length).toBeGreaterThan(20);
});
test('all recipes use HTTPS and X11 installation is distinct from authenticated availability', () => {
    for (const recipe of Object.values(TOOL_INSTALL_CATALOG)) expect(new URL(recipe.url).protocol).toBe('https:');
    expect(x11InstallGuide('darwin').command).toBe('brew install --cask xquartz');
    expect(x11InstallGuide('linux').note).toContain('authenticated session');
    expect(x11InstallGuide('win32').note).toContain('not supported');
});
test('every curated tool capability has a host-owned installation recipe, including executable aliases', () => {
    for (const policy of Object.values(getAllHostProcessScopePolicies()).filter(entry => !entry.fallback)) {
        for (const candidate of policy.allowedExecutables) {
            const name = candidate.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
            expect({scope:policy.scope,executable:name,hasRecipe:!!TOOL_INSTALL_CATALOG[name]}).toMatchObject({hasRecipe:true});
        }
    }
});
