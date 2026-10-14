import {discoverMcpTools} from '../../src/utils/ai/codex/codexMcp';
jest.mock('../../src/utils/ai/codex/codexMcp', () => ({...jest.requireActual('../../src/utils/ai/codex/codexMcp'), discoverMcpTools: jest.fn()}));
/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {registerAiExtensionsHandlers} from '../../src/ipc/aiExtensions';
import {SettingsChannels} from '../../src/ipc/channels';
const source = '---\nname: local-review\ndescription: Team review conventions\n---\nReview observable behavior.\n';
let data, handlers, dialog;
beforeEach(() => {
    data = {'ai.coding': [{id: 'one', provider: 'codex-cli', name: 'Codex One', model: 'one', apiKey: 'secret'},
        {id: 'two', provider: 'codex-cli', name: 'Codex Two', model: 'two'}, {id: 'api', provider: 'openai', apiKey: 'secret'}], 'ai.codexSkills': []};
    handlers = new Map(); dialog = {showOpenDialog: jest.fn()};
    registerAiExtensionsHandlers({ipcMain: {handle: (name, handler) => handlers.set(name, handler)}, dialog,
        BrowserWindow: {fromWebContents: () => null}, settings: {get: (key, fallback) => data[key] ?? fallback, set: (key, value) => {data[key] = value;}}});
});
const call = (key, payload) => handlers.get(SettingsChannels.ai_assistants[key])({sender: {}}, payload);
test('imports a saved copy, assigns several Codex models, disables and removes it without touching the original', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-skill-import-'));
    const file = path.join(directory, 'SKILL.md'); await fs.writeFile(file, source);
    try {
        dialog.showOpenDialog.mockResolvedValue({canceled: false, filePaths: [file]});
        const imported = await call('IMPORT_CODEX_SKILL');
        expect(JSON.stringify(imported.assistants)).not.toContain('secret');
        expect(imported.assistants).toHaveLength(2);
        const skill = imported.skills[0];
        await call('UPDATE_CODEX_SKILL', {id: skill.id, enabled: true, assistantIds: ['one', 'two']});
        expect(data['ai.codexSkills'][0].assistantIds).toEqual(['one', 'two']);
        await expect(call('IMPORT_CODEX_SKILL')).rejects.toThrow('already imported');
        expect(() => call('UPDATE_CODEX_SKILL', {id: skill.id, enabled: true, assistantIds: ['api']})).toThrow('existing Codex');
        expect(data['ai.codexSkills'][0].assistantIds).toEqual(['one', 'two']);
        await call('UPDATE_CODEX_SKILL', {id: skill.id, enabled: false, assistantIds: ['one', 'two']});
        expect(data['ai.codexSkills'][0].enabled).toBe(false);
        expect(call('REMOVE_CODEX_SKILL', {id: skill.id}).skills).toEqual([]);
        expect(await fs.readFile(file, 'utf8')).toBe(source);
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});
test('cancelled imports do not change settings and deleted assistant assignments are removed from the presentation', async () => {
    dialog.showOpenDialog.mockResolvedValue({canceled: true, filePaths: []});
    expect((await call('IMPORT_CODEX_SKILL')).canceled).toBe(true);
    expect(data['ai.codexSkills']).toEqual([]);
    data['ai.codexSkills'] = [{id: 'skill', name: 'local-review', description: 'Team review conventions', content: source, enabled: true, assistantIds: ['deleted', 'one']}];
    expect(call('GET_EXTENSIONS').skills[0].assistantIds).toEqual(['one']);
});

test('MCP discovery saves disabled permissions and never returns its token, then assigns, retests and removes', async () => {
    discoverMcpTools.mockResolvedValue([{name: 'search', description: 'Search docs'}, {name: 'write', description: 'Write'}]);
    const added = await call('CHECK_CODEX_MCP', {name: 'Docs', url: 'https://docs.example.com/mcp', bearerToken: 'mcp-private-token'});
    const server = added.mcpServers[0];
    expect(server).toEqual(expect.objectContaining({enabled: false, enabledTools: [], assistantIds: [], hasBearerToken: true}));
    expect(JSON.stringify(added)).not.toContain('mcp-private-token');
    expect(data['ai.codexMcpServers'][0].bearerToken).toBe('mcp-private-token');
    await call('UPDATE_CODEX_MCP', {id: server.id, enabled: true, assistantIds: ['one', 'two'], enabledTools: ['search']});
    expect(() => call('UPDATE_CODEX_MCP', {id: server.id, enabled: true, assistantIds: ['api'], enabledTools: ['search']})).toThrow('existing Codex');
    expect(() => call('UPDATE_CODEX_MCP', {id: server.id, enabled: true, assistantIds: ['one'], enabledTools: ['invented']})).toThrow('discovered');
    discoverMcpTools.mockResolvedValue([{name: 'write', description: 'Write'}]);
    const retested = await call('CHECK_CODEX_MCP', {id: server.id});
    expect(retested.mcpServers[0].enabledTools).toEqual([]);
    expect(call('REMOVE_CODEX_MCP', {id: server.id}).mcpServers).toEqual([]);
});
test('failed MCP connection does not persist a server', async () => {
    discoverMcpTools.mockRejectedValueOnce(new Error('MCP authentication failed.'));
    await expect(call('CHECK_CODEX_MCP', {name: 'Docs', url: 'https://docs.example.com/mcp'})).rejects.toThrow('authentication');
    expect(data['ai.codexMcpServers']).toBeUndefined();
});

test('OAuth tokens are excluded from inventory and sign-out clears credentials with a new revision', () => {
    data['ai.codexMcpServers']=[{id:'oauth',name:'Private',url:'https://private.example/mcp',authMode:'oauth',authRevision:'old',bearerToken:'',enabled:false,assistantIds:[],enabledTools:[],tools:[],checkedAt:'',headers:{'X-Token':'HEADER_SECRET'}}];
    data['ai.codexMcpAuth']={oauth:{tokens:{access_token:'ACCESS_SECRET',refresh_token:'REFRESH_SECRET'}}};
    const before=call('GET_EXTENSIONS');
    expect(before.mcpServers[0].oauthStatus).toBe('authorized');
    expect(JSON.stringify(before)).not.toMatch(/ACCESS_SECRET|REFRESH_SECRET|HEADER_SECRET/);
    const after=call('MCP_SIGN_OUT',{id:'oauth'});
    expect(after.mcpServers[0].oauthStatus).toBe('signed_out');
    expect(data['ai.codexMcpAuth']).toEqual({});
    expect(data['ai.codexMcpServers'][0].authRevision).not.toBe('old');
});

test('creates disabled hooks, validates assignments, and removes without running commands',()=>{
    const result=call('ADD_CODEX_HOOK',{name:'Team context',event:'UserPromptSubmit',command:'node',args:['/path/hook.js'],environment:{TEAM_TOKEN:'private-value'},timeoutSeconds:10});
    const hook=result.hooks[0];expect(hook.enabled).toBe(false);expect(hook.assistantIds).toEqual([]);expect(hook.environmentKeys).toEqual(['TEAM_TOKEN']);
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(()=>call('UPDATE_CODEX_HOOK',{id:hook.id,enabled:true,assistantIds:['api']})).toThrow('Codex');
    expect(call('UPDATE_CODEX_HOOK',{id:hook.id,enabled:true,assistantIds:['one','two']}).hooks[0].assistantIds).toEqual(['one','two']);
    expect(call('REMOVE_CODEX_HOOK',{id:hook.id}).hooks).toEqual([]);
});
