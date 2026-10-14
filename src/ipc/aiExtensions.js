import {validateCodexHook, publicCodexHook} from '../utils/ai/codex/codexHooks';
import {runCodexHookCommand} from '../utils/ai/codex/codexHookRuntime';
import os from 'node:os';
import {configureMcpCredentialsStore, hasMcpOAuthCredentials, startMcpOAuth} from '../utils/ai/mcp/mcpOAuth';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {discoverMcpTools, validateMcpServer, publicMcpServer} from '../utils/ai/codex/codexMcp';
import {SettingsChannels} from './channels';
import {codexAssistantChoices, parseCodexSkill, validateCodexSkillAssignments, MAX_CODEX_SKILLS} from '../utils/ai/codex/codexSkills';

export function registerAiExtensionsHandlers({ipcMain, dialog, BrowserWindow, settings, openExternal}) {
    const channels = SettingsChannels.ai_assistants;
    const signIns = new Map();
    configureMcpCredentialsStore({get: id => settings.get('ai.codexMcpAuth', {})[id] || {}, save: (id, record, revision) => {
        const current = settings.get('ai.codexMcpServers', []).find(s => s.id === id);
        if (!current || (current.authRevision || '') !== revision) throw new Error('MCP authorization changed. Sign in again.');
        settings.set('ai.codexMcpAuth', {...settings.get('ai.codexMcpAuth', {}), [id]: record});
    }});
    const storedServers = () => {
        const ids = new Set(codexAssistantChoices(settings.get('ai.coding', [])).map(a => a.id));
        return settings.get('ai.codexMcpServers', []).map(s => ({...s, assistantIds: s.assistantIds.filter(id => ids.has(id))}));
    };
    const inventory = () => {
        const assistants = codexAssistantChoices(settings.get('ai.coding', []));
        const allowed = new Set(assistants.map(assistant => assistant.id));
        return {hooks: settings.get('ai.codexHooks', []).map(hook => publicCodexHook({...hook,assistantIds:hook.assistantIds.filter(id=>allowed.has(id))})), mcpServers: storedServers().map(server => ({...publicMcpServer({...server, assistantIds: server.assistantIds.filter(id => allowed.has(id))}), oauthStatus: (signIns.get(server.id)?.status !== 'authorized' ? signIns.get(server.id)?.status : undefined) || (hasMcpOAuthCredentials(server.id) ? 'authorized' : 'signed_out'), oauthMessage: signIns.get(server.id)?.message || ''})), skills: settings.get('ai.codexSkills', []).map(skill => ({...skill, assistantIds: skill.assistantIds.filter(id => allowed.has(id))})), assistants};
    };
    const save = skills => {
        validateCodexSkillAssignments(skills, settings.get('ai.coding', []));
        settings.set('ai.codexSkills', skills);
        for (const window of BrowserWindow.getAllWindows?.() || []) {
            if (!window.isDestroyed()) window.webContents.send(channels.on_off.EXTENSIONS_UPDATED);
        }
        return inventory();
    };
    const notify = () => {
        for (const window of BrowserWindow.getAllWindows?.() || []) {
            if (!window.isDestroyed()) window.webContents.send(channels.on_off.EXTENSIONS_UPDATED);
        }
    };
    const saveServers = servers => {
        if (servers.length > 20) throw new Error('Add at most 20 MCP servers.');
        servers.forEach(server => validateMcpServer(server, settings.get('ai.coding', [])));
        settings.set('ai.codexMcpServers', servers); notify(); return inventory();
    };
    const storedHooks = () => {
        const ids = new Set(codexAssistantChoices(settings.get('ai.coding', [])).map(a=>a.id));
        return settings.get('ai.codexHooks', []).map(h=>({...h,assistantIds:h.assistantIds.filter(id=>ids.has(id))}));
    };
    const saveHooks = hooks => {
        if(hooks.length>30)throw new Error('Add at most 30 hooks.');
        hooks.forEach(h=>validateCodexHook(h,settings.get('ai.coding',[])));
        settings.set('ai.codexHooks',hooks);notify();return inventory();
    };
    ipcMain.handle(channels.ADD_CODEX_HOOK,(_event,input)=>{
        const hooks=storedHooks();
        const hook={id:randomUUID(),name:input.name?.trim(),event:input.event,toolPattern:input.toolPattern || '',command:input.command,args:input.args || [],cwd:input.cwd || '',environment:input.environment || {},timeoutSeconds:input.timeoutSeconds,enabled:false,assistantIds:[]};
        validateCodexHook(hook,settings.get('ai.coding',[]));
        if(hooks.some(h=>h.name===hook.name))throw new Error('Choose a unique hook name.');
        return saveHooks([...hooks,hook]);
    });
    ipcMain.handle(channels.UPDATE_CODEX_HOOK,(_event,{id,enabled,assistantIds})=>{
        const hooks=storedHooks();if(!hooks.some(h=>h.id===id))throw new Error('This hook no longer exists. Refresh AI Extensions.');
        return saveHooks(hooks.map(h=>h.id===id?{...h,enabled,assistantIds}:h));
    });
    ipcMain.handle(channels.REMOVE_CODEX_HOOK,(_event,{id})=>saveHooks(storedHooks().filter(h=>h.id!==id)));
    let testingHook=false;
    ipcMain.handle(channels.TEST_CODEX_HOOK,async(_event,{id})=>{
        if(testingHook)throw new Error('A hook test is already running.');
        const hook=storedHooks().find(h=>h.id===id);if(!hook)throw new Error('This hook no longer exists.');
        validateCodexHook(hook,settings.get('ai.coding',[]));testingHook=true;
        try {
            const result=await runCodexHookCommand(hook,{hook_event_name:hook.event,session_id:'fdo-hook-test',cwd:hook.cwd||os.homedir(),model:'fdo-hook-test',permission_mode:'plan',prompt:'FDO synthetic hook test',tool_name:'mcp__fdo_probe__test',tool_input:{},tool_response:{},last_assistant_message:'FDO sample response',stop_hook_active:false,source:'startup',reason:'other',trigger:'auto'});
            let output=(result.stdout || result.stderr).slice(0,4000);
            for(const value of Object.values(hook.environment))if(value)output=output.split(value).join('[REDACTED]');
            return {...inventory(),hookTest:{id,exitCode:result.exitCode,durationMs:result.durationMs,output,status:result.exitCode===0?'completed':result.exitCode===2?'blocked':'failed'}};
        }finally{testingHook=false;}
    });
    let checking = false;
    ipcMain.handle(channels.CHECK_CODEX_MCP, async (_event, input) => {
        if (checking) throw new Error('An MCP connection test is already running.');
        const servers = storedServers();
        const previous = input.id ? servers.find(s => s.id === input.id) : undefined;
        if (input.id && !previous) throw new Error('This MCP server no longer exists. Refresh AI Extensions.');
        const server = previous ? {...previous} : {id: randomUUID(), name: input.name, url: input.url || '',
            transport: input.transport || 'http', authMode: input.authMode || (input.bearerToken ? 'bearer' : 'none'),
            command: input.command || '', args: input.args || [], cwd: input.cwd || '', environment: input.environment || {}, headers: input.headers || {},
            oauthClientId: input.oauthClientId || '', oauthScopes: input.oauthScopes || '', oauthCallbackPort: input.oauthCallbackPort || 0, authRevision: randomUUID(),
            bearerToken: input.bearerToken || '', enabled: false, assistantIds: [], enabledTools: [], tools: [], checkedAt: ''};
        validateMcpServer(server, settings.get('ai.coding', []));
        if (!previous && servers.some(s => s.name === server.name)) throw new Error('Choose a unique MCP server name.');
        if (!previous && server.authMode === 'oauth') return saveServers([...servers, server]);
        checking = true;
        try {
            const tools = await discoverMcpTools(server);
            // Merge into the latest settings so concurrent removal cannot resurrect a connection.
            const current = storedServers();
            if (previous && !current.some(s => s.id === previous.id)) throw new Error('This server was removed during discovery.');
            if (!previous && current.some(s => s.name === server.name)) throw new Error('Choose a unique MCP server name.');
            const latest = current.find(s => s.id === server.id) || server;
            const updated = {...latest, tools, enabledTools: latest.enabledTools.filter(name => tools.some(t => t.name === name)), checkedAt: new Date().toISOString()};
            return saveServers(previous ? current.map(s => s.id === server.id ? updated : s) : [...current, updated]);
        } finally {checking = false;}
    });
    ipcMain.handle(channels.UPDATE_CODEX_MCP, (_event, {id, enabled, assistantIds, enabledTools}) => {
        const servers = storedServers();
        if (!servers.some(s => s.id === id)) throw new Error('This MCP server no longer exists. Refresh AI Extensions.');
        return saveServers(servers.map(s => s.id === id ? {...s, enabled, assistantIds, enabledTools} : s));
    });
    ipcMain.handle(channels.MCP_SIGN_IN, async (_event, {id}) => {
        const server = storedServers().find(s => s.id === id);
        if (!server || server.authMode !== 'oauth') throw new Error('Choose an OAuth HTTP server to sign in.');
        if (signIns.get(id)?.status === 'pending') return inventory();
        signIns.set(id, {status: 'pending', message: 'Waiting for browser sign-in.'}); notify();
        try {
            const session = await startMcpOAuth(server, {openExternal, onFinish: result => {
                const current = storedServers().find(s => s.id === id);
                if (current?.authRevision === server.authRevision) {signIns.set(id, result); notify();}
            }});
            if (signIns.get(id)?.status === 'pending') signIns.get(id).cancel = session.cancel;
        } catch (error) {signIns.set(id, {status: 'error', message: error.message}); notify();}
        return inventory();
    });
    ipcMain.handle(channels.MCP_CANCEL_SIGN_IN, (_event, {id}) => {signIns.get(id)?.cancel?.(); return inventory();});
    ipcMain.handle(channels.MCP_SIGN_OUT, (_event, {id}) => {
        signIns.get(id)?.cancel?.(); signIns.delete(id);
        const auth = {...settings.get('ai.codexMcpAuth', {})}; delete auth[id]; settings.set('ai.codexMcpAuth', auth);
        return saveServers(storedServers().map(s => s.id === id ? {...s, authRevision: randomUUID()} : s));
    });
    ipcMain.handle(channels.REMOVE_CODEX_MCP, (_event, {id}) => {
        signIns.get(id)?.cancel?.(); signIns.delete(id);
        const auth = {...settings.get('ai.codexMcpAuth', {})}; delete auth[id]; settings.set('ai.codexMcpAuth', auth);
        return saveServers(storedServers().filter(s => s.id !== id));
    });
    ipcMain.handle(channels.GET_EXTENSIONS, () => inventory());
    ipcMain.handle(channels.IMPORT_CODEX_SKILL, async event => {
        const options = {title: 'Import Codex skill instructions', properties: ['openFile'], filters: [{name: 'SKILL.md', extensions: ['md']}]};
        const owner = BrowserWindow.fromWebContents(event.sender);
        const result = await (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options));
        if (result.canceled || !result.filePaths?.length) return {...inventory(), canceled: true};
        const file = result.filePaths[0];
        if (path.basename(file) !== 'SKILL.md') throw new Error('Select the skill’s SKILL.md file. Supporting files are not imported.');
        const handle = await fs.open(file, 'r');
        let content;
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 64000) throw new Error('Select a SKILL.md text file of at most 16000 characters.');
            content = await handle.readFile('utf8');
        } finally {await handle.close();}
        const parsed = parseCodexSkill(content);
        const {skills} = inventory();
        if (skills.length >= MAX_CODEX_SKILLS) throw new Error('Import at most 50 Codex skills.');
        if (skills.some(skill => skill.name === parsed.name)) throw new Error(`Skill ${parsed.name} is already imported. Remove it before importing an updated copy.`);
        return save([...skills, {...parsed, id: randomUUID(), enabled: true, assistantIds: []}]);
    });
    ipcMain.handle(channels.UPDATE_CODEX_SKILL, (_event, {id, enabled, assistantIds}) => {
        const {skills} = inventory();
        if (!skills.some(skill => skill.id === id)) throw new Error('This skill no longer exists. Refresh AI Extensions.');
        return save(skills.map(skill => skill.id === id ? {...skill, enabled, assistantIds} : skill));
    });
    ipcMain.handle(channels.REMOVE_CODEX_SKILL, (_event, {id}) => save(inventory().skills.filter(skill => skill.id !== id)));
}
