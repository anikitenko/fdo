import {resolveCodexCliInvocation} from '../../src/utils/ai/codex/codexCli';
/** @jest-environment node */
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {app, ipcMain} from 'electron';
import {settings} from '../../src/utils/persistence/store';
import {registerAiCodingAgentHandlers} from '../../src/ipc/ai_coding_agent';
import {AiCodingAgentChannels} from '../../src/ipc/channels';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
import {createGenerationCheckpointStore} from '../../src/utils/ai/generation/codingGenerationCheckpoint';

jest.mock('electron', () => ({app: {getPath: jest.fn(), getAppPath: () => '/fdo', isPackaged: true}, ipcMain: {handle: jest.fn()}}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(), set: jest.fn()}}));
jest.mock('../../src/utils/ai/codex/codexCli', () => ({resolveCodexCliInvocation: jest.fn(async () => ({command: '/fdo/codex', args: [], bundled: true, source: 'bundled', version: '0.162.1', execCapabilities: {supportsSandbox: true, supportsSkipGitRepoCheck: true, supportsModel: true}}))}));
jest.mock('../../src/utils/ai/generation/geminiCli', () => ({resolveGeminiCliInvocation: jest.fn(async () => ({command: '/electron', args: ['/external/gemini.js'], bundled: false}))}));
jest.mock('../../src/utils/plugins/security/pluginAssistantIsolation', () => ({CODEX_PROPOSAL_FEATURES: ['shell_tool', 'unified_exec', 'view_image', 'code_mode_host'], createPluginAssistantIsolation: async (invocation, _provider, _hostPaths, options) => ({command: invocation.command, args: [], options: {cwd: '/private/empty', shell: false}, skillNames: options?.codexSkills?.map(skill => skill.name), setActiveSkills: async () => {}, cleanup: async () => {}})}));
jest.mock('../../src/utils/sdk/installedSdkValidation', () => ({createInstalledSdkValidator: () => {const validate = () => []; validate.capabilities = {sdkVersion: 'test', fingerprint: 'test'}; validate.plan = () => []; return validate;}}));
jest.mock('../../src/utils/ai/generation/codingWorkspaceGeneration', () => ({useStagedWorkspaceGeneration: (_provider, workspace) => !!workspace, generateStagedWorkspace: jest.fn()}));
jest.mock('node:child_process', () => ({spawn: jest.fn()}));

test.each(['codex-cli', 'gemini-cli'].flatMap(provider => [undefined, 'smaller-scope'].map(recoveryMode => [provider, recoveryMode])))('%s stages generation with recovery %s and emits only one final completion', async (provider, recoveryMode) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-cli-stages-'));
    app.getPath.mockReturnValue(directory);
    const assistant = {id: 'cli', purpose: 'coding', provider, model: 'test-model'};
    const skillContent = '---\nname: team-review\ndescription: Team review\n---\nUse clear names.';
    settings.get.mockImplementation((key, fallback) => key === 'ai.coding' ? [assistant] : key === 'ai.codexSkills'
        ? [{content: skillContent, enabled: true, assistantIds: ['cli']}, {content: skillContent.replace('team-review', 'unassigned-review'), enabled: true, assistantIds: ['other']}] : fallback);
    const prompts = [];
    let launchCount = 0;
    spawn.mockImplementation(() => {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
        child.kill = jest.fn(); child.stdin.end = prompt => {prompts.push(prompt); const answer = launchCount++ % 2 === 0 ? '{"files":[{"path":"/a.ts"}]}' : '```typescript\nexport const a = 1;\n```';
            Promise.resolve().then(() => {child.stdout.emit('data', Buffer.from(answer)); child.emit('close', 0);});};
        return child;
    });
    generateStagedWorkspace.mockImplementationOnce(async options => {
        if (recoveryMode) {
            expect(options.prompt).toContain('Smaller-scope generation request');
            expect(options.prompt).toContain('/large-module.ts');
        }
        await options.request({prompt: 'Return ONLY compact JSON inventory.', workspaceStep: 'Planning workspace files', maxOutputTokens: 2048, maximumResponseCharacters: 2048, minimumRequests: 1});
        await options.onCheckpoint({completed: [], pending: [{path: '/a.ts', contract: 'Export a'}], plan: [{path: '/a.ts', contract: 'Export a'}]});
        const source = await options.request({prompt: 'Return ONLY one complete fenced source file.', workspaceStep: '/a.ts', maxOutputTokens: 4096, maximumResponseCharacters: 4096, minimumRequests: 1});
        expect(source).toContain('export const a = 1');
        await options.onCheckpoint({completed: [{path: '/a.ts', contract: 'Export a', content: 'export const a = 1;'}], pending: [], plan: [{path: '/a.ts', contract: 'Export a'}]});
        return '### File: /a.ts\n```typescript\nexport const a = 1;\n```';
    });
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.PLAN_CODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    try {
        const result = await handler(event, {requestId: `staged-${provider}`, assistantId: 'cli', workspaceId: provider, workspaceFiles: [], prompt: 'Build helpers', userRequirements: 'Build helpers', recoveryMode, recoveryPath: '/large-module.ts'});
        expect(result.success).toBe(true);
        expect(prompts).toHaveLength(2);
        expect(prompts[0]).toContain('Return ONLY compact JSON inventory');
        expect(prompts[1]).toContain('Return ONLY one complete fenced source file');
        expect(prompts[1]).not.toContain('SOLUTION READY TO APPLY');
        if (provider === 'codex-cli') {
            expect(prompts.every(prompt => prompt.includes('"name":"team-review"'))).toBe(true);
            expect(prompts.some(prompt => prompt.includes('$team-review'))).toBe(false);
            expect(prompts.some(prompt => prompt.includes('$unassigned-review'))).toBe(false);
        } else expect(prompts.some(prompt => prompt.includes('$team-review'))).toBe(false);
        expect(event.senderFrame.send.mock.calls.filter(([channel]) => channel === AiCodingAgentChannels.on_off.STREAM_DONE)).toHaveLength(1);
        expect((await createGenerationCheckpointStore(path.join(directory, 'ai-generation-checkpoints')).load(provider)).completed[0].path).toBe('/a.ts');
        expect((await createGenerationCheckpointStore(path.join(directory, 'ai-generation-checkpoints')).load(provider)).requirements).toBe('Build helpers');
        if (provider === 'gemini-cli') expect(spawn.mock.lastCall[1]).toEqual(expect.arrayContaining(['/external/gemini.js', '--output-format', 'text']));
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test('resuming a saved generation refuses changed Codex skill assignments before requesting any files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-cli-skills-resume-'));
    app.getPath.mockReturnValue(directory);
    const assistant = {id: 'cli', purpose: 'coding', provider: 'codex-cli', model: 'test-model'};
    settings.get.mockImplementation((key, fallback) => key === 'ai.coding' ? [assistant] : key === 'ai.codexSkills'
        ? [{enabled: true, assistantIds: ['cli'], content: '---\nname: new-skill\ndescription: New conventions\n---\nUse clear names.'}] : fallback);
    const store = createGenerationCheckpointStore(path.join(directory, 'ai-generation-checkpoints'));
    const saved = store.create({workspaceId: 'skills-resume', workspaceFiles: [], prompt: 'Build helpers', requirements: 'Build helpers', sdkFingerprint: 'test'});
    await store.save({...saved, codexSkillFingerprint: 'old-selection'});
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.PLAN_CODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    const calls = generateStagedWorkspace.mock.calls.length;
    try {
        const result = await handler(event, {requestId: 'changed-skills', assistantId: 'cli', workspaceId: 'skills-resume', checkpointId: saved.id,
            recoveryMode: 'resume', workspaceFiles: [], prompt: 'Build helpers', userRequirements: 'Build helpers'});
        expect(result.success).toBe(false);
        expect(result.error).toContain('Assigned Codex extensions changed');
        expect(generateStagedWorkspace.mock.calls).toHaveLength(calls);
        expect((await store.load('skills-resume')).id).toBe(saved.id);
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test.each(['implicit', 'explicit'])('Codex %s skill disclosure loads only needed instructions and never publishes control responses', async mode => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-cli-disclosure-'));
    app.getPath.mockReturnValue(directory);
    settings.get.mockImplementation((key, fallback) => key === 'ai.coding'
        ? [{id: 'cli', purpose: 'coding', provider: 'codex-cli', model: 'test-model'}] : key === 'ai.codexSkills'
            ? [{enabled: true, assistantIds: ['cli'], content: '---\nname: team-review\ndescription: Review conventions\n---\nREVIEW_BODY'}] : fallback);
    const prompts = [], answers = mode === 'implicit' ? ['{"fdoSkillRequests":["team-review"]}', 'UI code', 'Logic code'] : ['UI code', 'Logic code'];
    spawn.mockImplementation(() => {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.kill = jest.fn();
        child.stdin.end = prompt => {prompts.push(prompt); const answer = answers.shift(); Promise.resolve().then(() => {child.stdout.emit('data', Buffer.from(answer)); child.emit('close', 0);});};
        return child;
    });
    generateStagedWorkspace.mockImplementationOnce(async options => {
        expect(await options.request({prompt: 'Create UI', workspaceStep: '/render.tsx', minimumRequests: 1})).toBe('UI code');
        expect(await options.request({prompt: 'Create logic', workspaceStep: '/logic.ts', minimumRequests: 1})).toBe('Logic code');
        return '### File: /a.ts\n```typescript\nexport const a = 1;\n```';
    });
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.PLAN_CODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    const requirements = mode === 'explicit' ? '$team-review Build helpers' : 'Build helpers';
    try {
        const result = await handler(event, {requestId: `disclosure-${mode}`, assistantId: 'cli', workspaceId: `disclosure-${mode}`, workspaceFiles: [], prompt: requirements, userRequirements: requirements});
        expect(result.success).toBe(true);
        expect(prompts).toHaveLength(mode === 'implicit' ? 3 : 2);
        if (mode === 'implicit') {
            expect(prompts[0]).not.toContain('$team-review');
            expect(prompts[1]).toContain('$team-review');
            expect(prompts[2]).not.toContain('$team-review');
        } else expect(prompts.every(prompt => prompt.includes('$team-review'))).toBe(true);
        const contentEvents = event.senderFrame.send.mock.calls.filter(([channel, data]) => channel === AiCodingAgentChannels.on_off.STREAM_DELTA && data.type === 'content');
        expect(contentEvents).toEqual([]);
        const completions = event.senderFrame.send.mock.calls.filter(([channel]) => channel === AiCodingAgentChannels.on_off.STREAM_DONE);
        expect(completions).toHaveLength(1);
        expect(completions[0][1].fullContent).not.toContain('fdoSkillRequests');
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test('Codex MCP requests expose configuration and actual call status, and missing assignments fail before inference', async () => {
    const assistant = {id: 'mcp-codex', provider: 'codex-cli', model: 'test-model', firstResponseTimeoutMs: 90000};
    const server = {id: 'docs', name: 'Docs', enabled: true, assistantIds: [assistant.id], enabledTools: ['search'], url: 'https://docs.example.com/mcp', bearerToken: 'private-token', tools: []};
    let configured = false;
    settings.get.mockImplementation((key, fallback) => key === 'ai.coding' ? [assistant] : key === 'ai.codexSkills' ? [] : key === 'ai.codexMcpServers' ? (configured ? [server] : []) : fallback);
    resolveCodexCliInvocation.mockResolvedValue({command: '/fdo/codex', args: [], bundled: true, execCapabilities: {supportsJson: true, supportsModel: true}});
    spawn.mockClear();
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.SMART_MODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    const payload = {requestId: 'mcp-docs', assistantId: assistant.id, prompt: 'Use the configured Docs MCP server to find documentation.'};
    const missing = await handler(event, payload);
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('No enabled MCP tools');
    expect(spawn).not.toHaveBeenCalled();
    configured = true;
    spawn.mockImplementation(() => {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.kill = jest.fn();
        child.stdin.end = prompt => {
            expect(prompt).toContain('Local shell and filesystem tools are disabled; that does not disable MCP');
            Promise.resolve().then(() => {
                child.stdout.emit('data', Buffer.from([
                    {type: 'item.completed', item: {type: 'agent_message', text: 'I will look up the docs.'}},
                    {type: 'item.started', item: {id: 'docs-call', type: 'mcp_tool_call', server: 'fdo_docs', tool: 'search'}},
                ].map(e => JSON.stringify(e)).join('\n') + '\n'));
                // Fast-forward a real 60-second tool wait through the backend watchdog.
                jest.advanceTimersByTime(60000);
                expect(child.kill).not.toHaveBeenCalled();
                child.stdout.emit('data', Buffer.from([
                    {type: 'item.completed', item: {id: 'docs-call', type: 'mcp_tool_call', server: 'fdo_docs', tool: 'search', status: 'completed'}},
                    {type: 'item.completed', item: {type: 'agent_message', text: 'Documentation retrieved.'}},
                ].map(e => JSON.stringify(e)).join('\n') + '\n'));
                child.emit('close', 0);
            });
        };
        return child;
    });
    jest.useFakeTimers();
    let result;
    try {result = await handler(event, {...payload, requestId: 'mcp-docs-configured'});}
    finally {jest.useRealTimers();}
    expect(result.success).toBe(true);
    const sent = JSON.stringify(event.senderFrame.send.mock.calls);
    expect(sent).toContain('MCP enabled: Docs (1 tools)');
    expect(sent).toContain('MCP: calling fdo_docs / search');
    expect(sent).toContain('MCP: fdo_docs / search completed');
    expect(sent).not.toContain('private-token');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['features.code_mode_host=true', 'features.shell_tool=false', 'features.unified_exec=false']));
});

test('active native turns survive four minutes without answer text and ignore stale JSON cooldowns',async()=>{
    jest.useFakeTimers();
    const {markCodexJsonModeCooldown}=require('../../src/utils/ai/codex/codexCliJsonModePreference');
    const assistant={id:'reasoning-codex',provider:'codex-cli',model:'fixture',firstResponseTimeoutMs:240000};
    settings.get.mockImplementation((key,fallback)=>key==='ai.coding'?[assistant]:fallback);
    resolveCodexCliInvocation.mockResolvedValue({command:'/fdo/codex',args:[],bundled:true,execCapabilities:{supportsJson:true,supportsModel:true}});
    markCodexJsonModeCooldown({assistantId:assistant.id,model:assistant.model,command:'/fdo/codex'});
    let launched;
    spawn.mockImplementation((_command,args)=>{
        expect(args).toContain('--json');
        const child=new EventEmitter();launched=child;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=jest.fn();
        child.stdin.end=()=>Promise.resolve().then(()=>{
            for(const event of [{type:'thread.started',thread_id:'fixture'},{type:'turn.started'},{type:'item.started',item:{id:'r1',type:'reasoning',text:'PRIVATE_NATIVE_REASONING'}}])child.stdout.emit('data',Buffer.from(JSON.stringify(event)+'\n'));
            jest.advanceTimersByTime(300000);expect(child.kill).not.toHaveBeenCalled();
            for(const event of [{type:'item.completed',item:{id:'r1',type:'reasoning',text:'PRIVATE_NATIVE_REASONING'}},{type:'item.completed',item:{id:'answer',type:'agent_message',text:'Delayed native answer.'}},{type:'turn.completed'}])child.stdout.emit('data',Buffer.from(JSON.stringify(event)+'\n'));
            child.emit('close',0);
        });
        return child;
    });
    registerAiCodingAgentHandlers();
    const handler=ipcMain.handle.mock.calls.find(([name])=>name===AiCodingAgentChannels.SMART_MODE)[1];
    const event={sender:Object.assign(new EventEmitter(),{isDestroyed:()=>false}),senderFrame:{send:jest.fn(),isDestroyed:()=>false,detached:false}};
    try{
        const result=await handler(event,{requestId:'native-reasoning-delay',assistantId:assistant.id,prompt:'Explain this supplied example.'});
        expect(result.success).toBe(true);expect(result.content).toContain('Delayed native answer.');expect(launched.kill).not.toHaveBeenCalled();
        expect(JSON.stringify(event.senderFrame.send.mock.calls)).not.toContain('PRIVATE_NATIVE_REASONING');expect(jest.getTimerCount()).toBe(0);
    }finally{jest.clearAllTimers();jest.useRealTimers();}
});
