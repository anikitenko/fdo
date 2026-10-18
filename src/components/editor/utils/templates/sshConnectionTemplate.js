import {STARTER_STYLES} from './starterStyles';

export function sshConnectionTemplateFiles(name) {
    return {
        '/index.ts': `import {FDO_SDK, PluginRegistry, defineRenderOnLoadActions, createSSHCapabilityBundle} from '@anikitenko/fdo-sdk';
import {Render} from './render';
import {loadProfiles, inspectProfile} from './profile-ui';
import {connectionError, parseUptimeOutput} from './logic';
class SSHConnections extends FDO_SDK {
    get metadata() {return {name: ${JSON.stringify(name)}, version: '1.0.0', author: 'Your team', description: 'SSH commands through authorized profiles', icon: 'key'};}
    declareCapabilities() {return createSSHCapabilityBundle();}
    init(): void {
        PluginRegistry.registerHandler('listSSHProfiles', async () => {
            try {return {status: 'ready', profiles: await this.ssh.listProfiles()};}
            catch (error) {return {status: 'error', message: connectionError(error), profiles: []};}
        });
        PluginRegistry.registerHandler('inspectConnections', async (input: unknown) => {
            const id = input && typeof input === 'object' && 'profileId' in input ? input.profileId : null;
            if (typeof id !== 'string' || !id) return {message: 'Choose an SSH profile before running uptime.'};
            try {
                const profiles = await this.ssh.listProfiles();
                const profile = profiles.find(item => item.id === id);
                if (!profile) return {message: 'This profile is no longer available. Refresh the profile list and choose an authorized connection.'};
                const result = await this.ssh.exec({profileId: id, command: 'uptime', timeoutMs: 10000, maxOutputBytes: 4096});
                // This example deliberately displays uptime output. For other commands,
                // select/redact fields before returning output to UI; never log it by default.
                return {message: profile.label + (result.exitCode === 0 ? ': uptime completed successfully' : result.exitCode === null ? ': uptime completed without an exit status' : ': uptime ended with exit code ' + String(result.exitCode)) + ' (' + Math.round(result.durationMs) + ' ms).' + (result.truncated ? ' Output was truncated at the capture limit.' : ''),
                    stdout: result.stdout, stderr: result.stderr, parsed: parseUptimeOutput(result.stdout)};
            } catch (error) {return {message: connectionError(error)};}
        });
    }
    render(): string {return Render(${JSON.stringify(name)});}
    renderOnLoad() {
        return defineRenderOnLoadActions({strict: true, language: 'typescript', setup: loadProfiles,
            handlers: {refreshProfiles: loadProfiles, inspect: inspectProfile},
            bindings: [
                {selector: '[data-role="refresh-profiles"]', event: 'click', handler: 'refreshProfiles', preventDefault: true, required: true},
                {selector: '[data-role="inspect"]', event: 'click', handler: 'inspect', preventDefault: true, required: true},
            ]});
    }
}
new SSHConnections();
`,
        '/render.tsx': `import {DOM} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
import {escapeText} from './text';
export function Render(name: string): string {
    const dom = new DOM();
    const shell = dom.createClassFromStyle(styles.shell), panel = dom.createClassFromStyle(styles.panel), list = dom.createClassFromStyle(styles.profileList), actions = dom.createClassFromStyle(styles.connectionActions), output = dom.createClassFromStyle(styles.commandOutput);
    return dom.renderHTML(dom.createElement('main', {class: shell}, [
        dom.createElement('h1', {}, escapeText(name)),
        dom.createElement('p', {}, 'Choose an authorized SSH profile to run uptime. Manage credentials, trusted host keys and command access in Settings → Credentials & SSH.'),
        dom.createElement('section', {class: panel, 'aria-label': 'SSH profiles'}, [
            dom.createElement('h2', {}, 'SSH profiles'),
            dom.createElement('p', {'data-role': 'profile-status', role: 'status'}, 'Loading authorized profiles…'),
            dom.createElement('label', {for: 'ssh-profile-selector'}, 'SSH profile'),
            dom.createElement('select', {id: 'ssh-profile-selector', 'data-role': 'profile', class: list, size: '5', disabled: 'disabled'},
                dom.createElement('option', {value: ''}, 'Profiles will appear here')),
            dom.createElement('div', {class: actions}, [
            dom.createElement('button', {type: 'button', 'data-role': 'refresh-profiles', class: 'pure-button'}, 'Refresh profiles'),
            dom.createElement('button', {type: 'button', 'data-role': 'inspect', class: 'pure-button pure-button-primary', disabled: 'disabled'}, 'Run uptime'),
            ].join('')),
        ].join('')),
        dom.createElement('p', {'data-role': 'result', 'aria-live': 'polite'}, 'Choose a profile, then run uptime. No connection is opened until you click Run uptime.'),
        dom.createElement('section', {class: panel, 'aria-label': 'Command output'}, [
            dom.createElement('h2', {}, 'Command output'),
            dom.createElement('label', {for: 'ssh-stdout'}, 'Standard output (stdout)'),
            dom.createElement('textarea', {id: 'ssh-stdout', 'data-role': 'stdout', class: output, rows: '5', readonly: 'readonly', placeholder: 'Output appears after running uptime'}, ''),
            dom.createElement('label', {for: 'ssh-stderr'}, 'Standard error (stderr)'),
            dom.createElement('textarea', {id: 'ssh-stderr', 'data-role': 'stderr', class: output, rows: '3', readonly: 'readonly', placeholder: 'No error output'}, ''),
            dom.createElement('h3', {}, 'Parsed load averages'),
            dom.createElement('pre', {'data-role': 'parsed-output', class: output}, 'Run uptime to parse the 1, 5 and 15 minute load averages.'),
            dom.createElement('p', {}, 'See parseUptimeOutput in logic.ts for the parsing example. It supports common Linux and macOS uptime formats and returns null for unrecognized output; the raw output remains available above.'),
        ].join('')),
    ].join('')));
}
`,
        '/profile-ui.ts': `// Serialized callbacks run in the iframe: keep each function self-contained.
export async function loadProfiles(): Promise<void> {
    const select = document.querySelector<HTMLSelectElement>('[data-role="profile"]');
    const status = document.querySelector<HTMLElement>('[data-role="profile-status"]');
    const run = document.querySelector<HTMLButtonElement>('[data-role="inspect"]');
    const refresh = document.querySelector<HTMLButtonElement>('[data-role="refresh-profiles"]');
    if (!select || !status || !run || !refresh) return;
    const previous = select.value, token = String(Number(select.dataset.request || 0) + 1);
    select.dataset.request = token; select.disabled = true; run.disabled = true; refresh.disabled = true;
    status.textContent = 'Loading authorized profiles…';
    try {
        const response = await window.createBackendReq('UI_MESSAGE', {handler: 'listSSHProfiles', content: {}});
        if (!select.isConnected || select.dataset.request !== token) return;
        const profiles: {id: string; label: string}[] = Array.isArray(response?.profiles)
            ? response.profiles.filter((item: unknown): item is {id: string; label: string} => !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' && 'label' in item && typeof item.label === 'string') : [];
        select.replaceChildren();
        for (const profile of profiles) {const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.label; select.append(option);}
        if (profiles.length) {
            select.value = profiles.some(profile => profile.id === previous) ? previous : profiles[0].id;
            select.disabled = false; run.disabled = false;
            status.textContent = profiles.length + (profiles.length === 1 ? ' profile available.' : ' profiles available.') + ' Select a connection below.';
        } else {
            status.textContent = response?.status === 'error' && typeof response.message === 'string' ? response.message
                : 'No SSH profiles are available for this plugin. Plugin capability grants and profile access are separate approvals. In Settings → Credentials & SSH, select this plugin and edit your existing profile (or create one). Under Command access, add uptime and enable “Authorize this plugin to use this profile for SSH commands and profile discovery”, then verify trust and save. Git-only profiles are not listed here. Refresh this list after saving.';
        }
    } catch {
        if (select.isConnected && select.dataset.request === token) status.textContent = 'Could not load SSH profiles. Check this plugin’s grants in Manage Plugins, then refresh.';
    } finally {if (select.isConnected && select.dataset.request === token) refresh.disabled = false;}
}

export async function inspectProfile(): Promise<void> {
    const select = document.querySelector<HTMLSelectElement>('[data-role="profile"]');
    const target = document.querySelector<HTMLElement>('[data-role="result"]');
    const run = document.querySelector<HTMLButtonElement>('[data-role="inspect"]');
    const refresh = document.querySelector<HTMLButtonElement>('[data-role="refresh-profiles"]');
    if (!select || !target || !run || !refresh || !select.value) return;
    const stdout = document.querySelector<HTMLTextAreaElement>('[data-role="stdout"]');
    const stderr = document.querySelector<HTMLTextAreaElement>('[data-role="stderr"]');
    const parsed = document.querySelector<HTMLElement>('[data-role="parsed-output"]');
    if (stdout) stdout.value = '';
    if (stderr) stderr.value = '';
    if (parsed) parsed.textContent = 'Waiting for command output…';
    const profileId = select.value; run.disabled = true; refresh.disabled = true; select.disabled = true;
    target.textContent = 'Running uptime on the selected profile…';
    try {
        const result = await window.createBackendReq('UI_MESSAGE', {handler: 'inspectConnections', content: {profileId}});
        if (!target.isConnected) return;
        target.textContent = typeof result?.message === 'string' ? result.message : 'No command result was returned. Refresh profiles and try again.';
        if (stdout) stdout.value = typeof result?.stdout === 'string' ? result.stdout : '';
        if (stderr) stderr.value = typeof result?.stderr === 'string' ? result.stderr : '';
        if (parsed) parsed.textContent = result?.parsed ? JSON.stringify(result.parsed, null, 2) : 'No load averages could be parsed. Review the raw output and command status.';
    } catch {
        target.textContent = 'Could not run uptime. Check profile access, trusted host key and command policy in Settings.';
        if (parsed) parsed.textContent = 'No command output received.';
    }
    finally {if (select.isConnected) {select.disabled = false; run.disabled = false; refresh.disabled = false;}}
}
`,
        '/logic.ts': `// Example: parse common Linux "load average: 0.12, 0.34, 0.56"
// and macOS "load averages: 0.12 0.34 0.56" output without altering raw text.
export function parseUptimeOutput(stdout: string): {loadAverage: {oneMinute: number; fiveMinutes: number; fifteenMinutes: number}} | null {
    const match = stdout.match(/load averages?:\\s*([0-9]+(?:\\.[0-9]+)?)[,\\s]+([0-9]+(?:\\.[0-9]+)?)[,\\s]+([0-9]+(?:\\.[0-9]+)?)(?=\\s|$)/i);
    if (!match) return null;
    const values = match.slice(1).map(Number);
    if (!values.every(Number.isFinite)) return null;
    return {loadAverage: {oneMinute: values[0], fiveMinutes: values[1], fifteenMinutes: values[2]}};
}

export function connectionError(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    switch (code) {
        case 'ACCESS_DENIED': return 'SSH access is not approved or the command is not allowed. Review this plugin’s grants in Manage Plugins and authorize uptime in Settings → Credentials & SSH.';
        case 'LOCKED': return 'Your system credential store is locked. Unlock it, then refresh profiles.';
        case 'HOST_KEY_REJECTED': return 'The server identity could not be verified. Review this profile’s trusted host key in Settings before reconnecting.';
        case 'TIMEOUT': return 'The SSH connection or command timed out. Check the server and try again.';
        case 'CONNECTION_FAILED': return 'Could not connect to the selected server. Review its endpoint and saved credential in Settings.';
        default: return 'SSH profiles could not be loaded. Review this plugin’s grants in Manage Plugins and secure storage in Settings → Credentials & SSH, then refresh.';
    }
}
`,
        '/text.ts': `export function escapeText(value: unknown): string {
    return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char));
}
`,
        '/styles.css': STARTER_STYLES + '\n.profileList {display: block; width: 100%; margin: 12px 0; padding: 8px; color: #e6edf3; background: #101820; border: 1px solid #607789; border-radius: 8px;}\n.connectionActions {display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px;}\n.commandOutput {display: block; box-sizing: border-box; width: 100%; margin: 8px 0 16px; padding: 12px; color: #e6edf3; background: #101820; border: 1px solid #607789; border-radius: 8px; font-family: monospace; white-space: pre-wrap; overflow-wrap: anywhere; resize: vertical;}\n',
        '/starter.test.ts': `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Render} from './render';
import {connectionError, parseUptimeOutput} from './logic';
test('lists profiles without opening a connection on render', () => {
    const html = Render('<Team>'); assert.ok(html.includes('&lt;Team&gt;')); assert.match(html, /data-role="profile"/); assert.match(html, /data-role="refresh-profiles"/); assert.match(html, /data-role="inspect"/); assert.match(html, /aria-live="polite"/);
});
test('turns denied access and provider failures into useful safe guidance', () => {
    assert.ok(connectionError({code: 'ACCESS_DENIED'}).includes('Manage Plugins'));
    assert.ok(connectionError({code: 'LOCKED'}).includes('Unlock'));
    assert.ok(!connectionError({message: 'private credential'}).includes('private credential'));
});
test('parses common uptime formats and leaves unknown output unparsed', () => {
    assert.deepEqual(parseUptimeOutput('12:00 up 2 days, load average: 0.12, 0.34, 0.56'), {loadAverage: {oneMinute: 0.12, fiveMinutes: 0.34, fifteenMinutes: 0.56}});
    assert.deepEqual(parseUptimeOutput('12:00 up 2 days, load averages: 1.2 3.4 5.6'), {loadAverage: {oneMinute: 1.2, fiveMinutes: 3.4, fifteenMinutes: 5.6}});
    assert.equal(parseUptimeOutput('unrecognized output'), null);
});
`,
    };
}
