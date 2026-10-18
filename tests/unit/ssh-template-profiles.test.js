import {beforeEach, expect, jest, test} from '@jest/globals';
import {stripTypeScriptTypes} from 'node:module';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
const source = createPluginTemplateFiles({name: 'ssh-test', template: 'ssh'})['/profile-ui.ts'];
const output = stripTypeScriptTypes(source).replace(/^export /gm, '');
const {loadProfiles, inspectProfile} = new Function(output + '\nreturn {loadProfiles, inspectProfile};')();
beforeEach(() => {
    document.body.innerHTML = '<p data-role="profile-status"></p><select data-role="profile"></select><button data-role="inspect"></button><button data-role="refresh-profiles"></button><p data-role="result"></p><textarea data-role="stdout" readonly></textarea><textarea data-role="stderr" readonly></textarea><pre data-role="parsed-output"></pre>';
    window.createBackendReq = jest.fn();
});
test('empty profiles show setup guidance and prevent execution, with refresh available', async () => {
    window.createBackendReq.mockResolvedValue({status: 'ready', profiles: []});
    await loadProfiles();
    expect(document.querySelector('[data-role="profile-status"]')).toHaveTextContent('No SSH profiles are available for this plugin');
    expect(document.querySelector('[data-role="profile-status"]')).toHaveTextContent('Settings → Credentials & SSH');
    expect(document.querySelector('[data-role="inspect"]')).toBeDisabled();
    expect(document.querySelector('[data-role="refresh-profiles"]')).toBeEnabled();
    await inspectProfile(); expect(window.createBackendReq).toHaveBeenCalledTimes(1);
});
test('lists safe profile labels, retains selection on refresh and executes only the chosen profile', async () => {
    const profiles = [{id: 'work', label: /* language=TEXT */ '<img src=x onerror=alert(1)>'}, {id: 'personal', label: 'Personal connection'}];
    window.createBackendReq.mockResolvedValue({status: 'ready', profiles});
    await loadProfiles();
    const select = document.querySelector('[data-role="profile"]');
    expect(select.options).toHaveLength(2); expect(select.querySelector('img')).toBeNull();
    select.value = 'personal'; await loadProfiles(); expect(select.value).toBe('personal');
    window.createBackendReq.mockResolvedValue({message: 'Personal connection: uptime completed successfully.', stdout: /* language=TEXT */ '<img src=x>\nload average: 0.12, 0.34, 0.56', stderr: 'example warning', parsed: {loadAverage: {oneMinute: 0.12, fiveMinutes: 0.34, fifteenMinutes: 0.56}}});
    await inspectProfile();
    expect(window.createBackendReq).toHaveBeenLastCalledWith('UI_MESSAGE', {handler: 'inspectConnections', content: {profileId: 'personal'}});
    expect(document.querySelector('[data-role="result"]')).toHaveTextContent('uptime completed successfully');
    expect(document.querySelector('[data-role="stdout"]')).toHaveValue(/* language=TEXT */ '<img src=x>\nload average: 0.12, 0.34, 0.56');
    expect(document.querySelector('[data-role="stderr"]')).toHaveValue('example warning');
    expect(document.querySelector('[data-role="parsed-output"]')).toHaveTextContent('"oneMinute": 0.12');
    expect(document.querySelector('img')).toBeNull();
    window.createBackendReq.mockRejectedValue(new Error('transport failed'));
    await inspectProfile();
    expect(document.querySelector('[data-role="stdout"]')).toHaveValue('');
    expect(document.querySelector('[data-role="stderr"]')).toHaveValue('');
    expect(document.querySelector('[data-role="parsed-output"]')).toHaveTextContent('No command output received');
});

test('the backend parsing example handles Linux, macOS and unfamiliar output', () => {
    const logic = createPluginTemplateFiles({name: 'ssh-test', template: 'ssh'})['/logic.ts'];
    const {parseUptimeOutput} = new Function(stripTypeScriptTypes(logic).replace(/^export /gm, '') + '\nreturn {parseUptimeOutput};')();
    for (const output of ['load average: 0.12, 0.34, 0.56\n', 'load averages: 0.12 0.34 0.56']) {
        expect(parseUptimeOutput(output)).toEqual({loadAverage: {oneMinute: 0.12, fiveMinutes: 0.34, fifteenMinutes: 0.56}});
    }
    expect(parseUptimeOutput('unfamiliar output')).toBeNull();
});
