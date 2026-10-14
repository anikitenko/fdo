/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPluginAssistantIsolation, CODEX_PROPOSAL_FEATURES} from '../../src/utils/plugins/security/pluginAssistantIsolation';

test.each(['darwin', 'linux', 'win32'])('Gemini uses a separate runtime with a private tool-denying configuration on %s', async platform => {
    const isolated = await createPluginAssistantIsolation({command: process.execPath, args: ['/external/gemini.js'], env: {ELECTRON_RUN_AS_NODE: '1'}, bundled: false}, 'gemini-cli', [], {platform});
    const root = path.dirname(isolated.options.cwd);
    try {
        expect(isolated.command).toBe(process.execPath);
        expect(isolated.options.shell).toBe(false);
        expect(isolated.options.env.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(isolated.options.cwd).not.toBe(process.cwd());
        const settings = JSON.parse(await fs.readFile(isolated.options.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'));
        expect(settings.tools.core).toEqual([]);
        expect(settings.mcp.allowed).toEqual([]);
        expect(await fs.readFile(path.join(settings.adminPolicyPaths[0], 'fdo-proposals.toml'), 'utf8')).toContain('decision = "deny"');
        expect(isolated.options.env.PATH).not.toContain('node_modules');
        expect(isolated.osSandbox).toBe(false);
    } finally {await isolated.cleanup();}
    await expect(fs.access(root)).rejects.toThrow();
});

test.each(['linux', 'win32'])('integrated native Codex starts directly on %s without requiring macOS sandbox-exec', async platform => {
    const isolated = await createPluginAssistantIsolation({command: '/bundled/codex', args: [], bundled: true}, 'codex-cli', [], {platform});
    try {expect(isolated.command).toBe('/bundled/codex'); expect(isolated.args).toEqual([]); expect(isolated.options.shell).toBe(false);}
    finally {await isolated.cleanup();}
    expect(CODEX_PROPOSAL_FEATURES).toEqual(expect.arrayContaining(['shell_tool', 'view_image', 'computer_use', 'apps', 'code_mode_host']));
});

test('Codex rejects a separate executable before copying credentials or creating a workspace', async () => {
    const create = jest.spyOn(fs, 'mkdtemp');
    try {await expect(createPluginAssistantIsolation({command: '/external/codex', args: [], bundled: false}, 'codex-cli')).rejects.toThrow('integrated native Codex'); expect(create).not.toHaveBeenCalled();}
    finally {create.mockRestore();}
});
test.each(['linux', 'win32'])('assigned skill instructions are copied only into the private Codex home on %s', async platform => {
    const source = '---\nname: team-review\ndescription: Team review\n---\nUse clear names.\n';
    const isolated = await createPluginAssistantIsolation({command: '/bundled/codex', args: [], bundled: true}, 'codex-cli', [],
        {platform, codexSkills: [{name: 'team-review', description: 'Team review', content: source}]});
    const file = path.join(isolated.options.env.CODEX_HOME, 'skills', 'team-review', 'SKILL.md');
    expect(isolated.skillNames).toEqual(['team-review']);
    expect(await fs.readFile(file, 'utf8')).not.toContain('Use clear names.');
    await isolated.setActiveSkills(['team-review']);
    expect(await fs.readFile(file, 'utf8')).toBe(source);
    await isolated.setActiveSkills([]);
    expect(await fs.readFile(file, 'utf8')).not.toContain('Use clear names.');
    await expect(isolated.setActiveSkills(['unassigned'])).rejects.toThrow('Only assigned');
    await isolated.cleanup();
    await expect(fs.access(file)).rejects.toThrow();
});

test.each(['unchanged', 'changed', 'logged-out'])('credential refresh preserves the original login state when %s', async state => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-cli-auth-fixture-'));
    const original = path.join(directory, 'auth.json');
    await fs.writeFile(original, JSON.stringify({token: 'fixture-original'}));
    const isolated = await createPluginAssistantIsolation({command: '/bundled/codex', args: [], bundled: true}, 'codex-cli', [], {platform: 'linux', credentialRoot: directory});
    try {
        await fs.writeFile(path.join(isolated.options.env.CODEX_HOME, 'auth.json'), JSON.stringify({token: 'fixture-refreshed'}));
        if (state === 'changed') await fs.writeFile(original, JSON.stringify({token: 'fixture-new-login'}));
        if (state === 'logged-out') await fs.unlink(original);
        if (state === 'unchanged') await expect(isolated.assertAuthentication()).resolves.toBeUndefined();
        else await expect(isolated.assertAuthentication()).rejects.toThrow('authentication changed');
        await isolated.cleanup();
        if (state === 'logged-out') await expect(fs.access(original)).rejects.toThrow();
        else expect(JSON.parse(await fs.readFile(original, 'utf8')).token).toBe(state === 'changed' ? 'fixture-new-login' : 'fixture-refreshed');
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test.each(['linux', 'win32'])('selected remote MCP tools are written to the private home on %s and removed after cleanup', async platform => {
    const server = {id: 'mcp-test', url: 'https://docs.example.com/mcp', enabledTools: ['search'], bearerToken: 'fixture-mcp-secret'};
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-mcp-runtime-'));
    const command = path.join(directory, platform === 'win32' ? 'codex.exe' : 'codex');
    const host = path.join(directory, platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host');
    await fs.writeFile(command, 'native-runtime-fixture'); await fs.writeFile(host, 'native-host-fixture');
    const isolated = await createPluginAssistantIsolation({command, args: [], bundled: true}, 'codex-cli', [], {platform, codexMcpServers: [server], prepareMcpServers: async servers => ({servers, ports: [], close: async () => {}})});
    expect(isolated.codeModeHostPath).toBe(host);
    const file = path.join(isolated.options.env.CODEX_HOME, 'config.toml');
    const config = await fs.readFile(file, 'utf8');
    expect(config).toContain('enabled_tools = ["search"]');
    expect(config).not.toContain(server.bearerToken);
    expect(isolated.options.env.FDO_MCP_TOKEN_fdo_mcp_test).toBe(server.bearerToken);
    await isolated.cleanup(); await expect(fs.access(file)).rejects.toThrow();
    await fs.rm(directory, {recursive: true, force: true});
});

test('MCP startup fails before inference if the bundled code-mode companion is missing', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-mcp-missing-host-'));
    try {
        await expect(createPluginAssistantIsolation({command: path.join(directory, 'codex'), args: [], bundled: true}, 'codex-cli', [],
            {platform: 'linux', codexMcpServers: [{id: 'docs', url: 'https://docs.example.com/mcp', enabledTools: ['search']}] })).rejects.toThrow('code-mode helper is missing');
    } finally {await fs.rm(directory, {recursive: true, force: true});}
});
