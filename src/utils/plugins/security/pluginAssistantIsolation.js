import {prepareCodexHookBridge} from '../../ai/codex/codexHookRuntime';
import {prepareMcpBridges} from '../../ai/mcp/mcpRuntimeBridge';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {codexMcpConfiguration} from '../../ai/codex/codexMcp';
import {codexSkillCatalog} from '../../ai/codex/codexSkillDisclosure';
import os from 'node:os';

const quote = value => JSON.stringify(value);
export const CODEX_PROPOSAL_FEATURES = ['shell_tool', 'unified_exec', 'apps', 'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'code_mode', 'code_mode_host', 'js_repl', 'view_image', 'remote_plugin', 'skill_search', 'skill_mcp_dependency_install', 'image_generation', 'artifact', 'workspace_dependencies', 'goals'];

// Trusted CLI runtimes get only supplied context, a temporary workspace, and their own authentication.
// Local model tools are disabled; assigned remote MCP tools are explicitly allowed. On macOS bundled Codex additionally runs under a process-level seatbelt profile.
// The portable mode is a runtime tool policy, not an OS filesystem sandbox.
export async function createPluginAssistantIsolation(invocation, provider, hostPaths = [], {platform = process.platform, credentialRoot, codexSkills = [], codexMcpServers = [], codexHooks = [], onHookActivity, prepareHookBridge = prepareCodexHookBridge, prepareMcpServers = prepareMcpBridges} = {}) {
    if (!['codex-cli', 'gemini-cli'].includes(provider)) throw new Error('Unsupported CLI assistant.');
    if (provider === 'codex-cli' && (!invocation.bundled || invocation.args?.length)) throw new Error('FDO requires its integrated native Codex runtime. Repair the bundled runtime for this platform.');
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-plugin-assistant-')));
    let mcpRuntime, hookRuntime;
    let hookListener = onHookActivity;
    try {
        const home = path.join(root, 'home');
        const workspace = path.join(root, 'workspace');
        const config = path.join(home, provider === 'codex-cli' ? '.codex' : '.gemini');
        await fs.mkdir(config, {recursive: true}); await fs.mkdir(workspace);
        const skillNames = [];
        if (provider === 'codex-cli') {
            for (const skill of codexSkills) {
                if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || skillNames.includes(skill.name)) throw new Error('Invalid or duplicate assigned Codex skill name.');
                const directory = path.join(config, 'skills', skill.name);
                await fs.mkdir(directory, {recursive: true});
                const metadata = codexSkillCatalog(codexSkills).find(item => item.name === skill.name);
                await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${JSON.stringify(metadata.description)}\n---\nFull instructions are available from FDO on demand.`, {mode: 0o600});
                skillNames.push(skill.name);
            }
        }
        const originalConfig = credentialRoot || (provider === 'codex-cli' ? process.env.CODEX_HOME || path.join(os.homedir(), '.codex') : path.join(os.homedir(), '.gemini'));
        const authentication = [];
        const digest = content => createHash('sha256').update(content).digest('hex');
        for (const file of provider === 'codex-cli' ? ['auth.json'] : ['oauth_creds.json', 'google_accounts.json']) {
            try {
                const origin = path.join(originalConfig, file), target = path.join(config, file);
                const content = await fs.readFile(origin);
                await fs.writeFile(target, content, {mode: 0o600});
                authentication.push({origin, target, digest: digest(content)});
            }
            catch (error) {if (error.code !== 'ENOENT') throw error;}
        }
        const env = {HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
            CODEX_HOME: config, GEMINI_CLI_HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
            TMPDIR: root, TEMP: root, TMP: root, LANG: 'en_US.UTF-8',
            PATH: platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin:/usr/sbin:/sbin',
            ...(platform === 'win32' ? {SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.WINDIR || 'C:\\Windows'} : {}),
            ...(invocation.env?.ELECTRON_RUN_AS_NODE ? {ELECTRON_RUN_AS_NODE: '1'} : {})};
        for (const key of provider === 'codex-cli' ? [] : ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_GENAI_USE_VERTEXAI']) {
            if (process.env[key]) env[key] = process.env[key];
        }
        if (provider === 'gemini-cli') {
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                const credentials = path.join(config, 'application_credentials.json');
                await fs.copyFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, credentials); await fs.chmod(credentials, 0o600);
                env.GOOGLE_APPLICATION_CREDENTIALS = credentials;
            }
            const policyPath = path.join(config, 'policies'); await fs.mkdir(policyPath);
            await fs.writeFile(path.join(policyPath, 'fdo-proposals.toml'), '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', {mode: 0o600});
            const settingsPath = path.join(config, 'settings.json');
            const selectedType = env.GEMINI_API_KEY || env.GOOGLE_API_KEY ? 'gemini-api-key' : env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ? 'vertex-ai' : 'oauth-personal';
            await fs.writeFile(settingsPath, JSON.stringify({tools: {core: []}, mcp: {allowed: []}, mcpServers: {},
                adminPolicyPaths: [policyPath], policyPaths: [policyPath], useWriteTodos: false,
                general: {enableAutoUpdate: false}, telemetry: {enabled: false}, security: {disableYoloMode: true, auth: {selectedType}}}), {mode: 0o600});
            env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsPath; env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = settingsPath;
        }
        let command = invocation.command, args = [];
        let codeModeHostPath;
        if (provider === 'codex-cli' && codexMcpServers.length) {
            const hostName = platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host';
            const bundledHost = path.join(path.dirname(invocation.command), hostName);
            try {await fs.access(bundledHost);}
            catch {throw new Error('The bundled Codex code-mode helper is missing. Repair or reinstall FDO to use MCP tools with this model.');}
            codeModeHostPath = bundledHost;
            if (platform === 'darwin') {
                codeModeHostPath = path.join(root, hostName);
                await fs.copyFile(bundledHost, codeModeHostPath); await fs.chmod(codeModeHostPath, 0o700);
            }
        }
        if (provider === 'codex-cli' && codexMcpServers.length) {
            mcpRuntime = await prepareMcpServers(codexMcpServers);
            const mcp = codexMcpConfiguration(mcpRuntime.servers);
            await fs.writeFile(path.join(config, 'config.toml'), mcp.content, {mode: 0o600});
            Object.assign(env, mcp.env);
        }
        if (provider === 'codex-cli' && codexHooks.length) {
            hookRuntime = await prepareHookBridge(codexHooks, {platform, onActivity: activity => hookListener?.(activity)});
            Object.assign(env, hookRuntime.env);
            await fs.writeFile(path.join(config, 'hooks.json'), JSON.stringify(hookRuntime.config), {mode:0o600});
        }
        let osSandbox = false;
        if (provider === 'codex-cli' && platform === 'darwin') {
            await fs.access('/usr/bin/sandbox-exec');
            const executable = path.join(root, 'codex'); await fs.copyFile(invocation.command, executable); await fs.chmod(executable, 0o700);
            const protectedPaths = [...new Set(await Promise.all([os.homedir(), process.cwd(), ...hostPaths].filter(Boolean).map(async value => {
                try {return await fs.realpath(value);} catch {return path.resolve(value);}
            })))];
            const profilePath = path.join(root, 'isolation.sb');
            const permittedPorts = [...new Set([...(mcpRuntime?.ports || []), ...(hookRuntime?.ports || [])])];
            const loopbackRestriction = permittedPorts.length
                ? `(deny network* (remote ip "localhost:*"))\n${permittedPorts.map(port => `(allow network-outbound (remote ip "localhost:${port}"))`).join('\n')}`
                : '(deny network* (remote ip "localhost:*"))';
            await fs.writeFile(profilePath, `(version 1)\n(allow default)\n${protectedPaths.map(dir => `(deny file-read* file-write* (subpath ${quote(dir)}))`).join('\n')}\n${loopbackRestriction}\n`, {mode: 0o600});
            command = '/usr/bin/sandbox-exec'; args = ['-f', profilePath, executable]; osSandbox = true;
        }
        return {command, args, options: {cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true},
            osSandbox, skillNames, codeModeHostPath,
            setHookActivityListener(listener) {hookListener = listener;},
            hooksActive: Boolean(codexHooks.length),
            async setActiveSkills(names) {
                if (names.some(name => !skillNames.includes(name))) throw new Error('Only assigned Codex skills may be loaded.');
                const metadata = codexSkillCatalog(codexSkills);
                for (const skill of codexSkills) {
                    const content = names.includes(skill.name) ? skill.content
                        : `---\nname: ${skill.name}\ndescription: ${JSON.stringify(metadata.find(item => item.name === skill.name).description)}\n---\nFull instructions are available from FDO on demand.`;
                    await fs.writeFile(path.join(config, 'skills', skill.name, 'SKILL.md'), content, {mode: 0o600});
                }
            },
            async assertAuthentication() {
                for (const file of authentication) {
                    let content; try {content = await fs.readFile(file.origin);} catch (error) {if (error.code !== 'ENOENT') throw error;}
                    if (!content || digest(content) !== file.digest) throw new Error('CLI authentication changed during generation. Resume saved work using the current login.');
                }
            },
            async cleanup() {
                try {
                    for (const file of authentication) {
                        let refreshed; try {refreshed = await fs.readFile(file.target);} catch {continue;}
                        if (digest(refreshed) === file.digest) continue;
                        try {JSON.parse(refreshed.toString('utf8'));} catch {continue;}
                        // Update the original inode only if it is still the login we copied.
                        // Logout or an atomic replacement cannot be undone by this refresh.
                        let handle;
                        try {
                            handle = await fs.open(file.origin, 'r+');
                            if (digest(await handle.readFile()) !== file.digest) continue;
                            let written = 0; while (written < refreshed.length) {const result = await handle.write(refreshed, written, refreshed.length - written, written); if (!result.bytesWritten) throw new Error('Unable to persist CLI authentication refresh.'); written += result.bytesWritten;} await handle.truncate(refreshed.length); await handle.sync();
                        } catch (error) {if (error.code !== 'ENOENT') throw error;}
                        finally {await handle?.close();}
                    }
                } finally {await hookRuntime?.close(); await mcpRuntime?.close(); await fs.rm(root, {recursive: true, force: true});}
            }};
    } catch (error) {await hookRuntime?.close(); await mcpRuntime?.close(); await fs.rm(root, {recursive: true, force: true}); throw error;}
}
