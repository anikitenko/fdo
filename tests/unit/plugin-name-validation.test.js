import {validateNewPluginName} from '../../src/utils/plugins/authoring/pluginNameValidation';

test.each([
    ['', 'required'], ['   ', 'required'], ['../tools', 'invalid_characters'], ['A/B', 'invalid_characters'],
    ['A\\B', 'invalid_characters'], ['<script>', 'invalid_characters'], ['A\nB', 'invalid_characters'],
    ['🐱', 'invalid_characters'], ['Команда', 'empty_id'], ['a'.repeat(81), 'too_long'], ['CON', 'reserved'], ['LPT1', 'reserved'],
])('rejects %j with actionable feedback', (name, code) => {
    expect(validateNewPluginName(name)).toEqual(expect.objectContaining({valid: false, code, message: expect.any(String)}));
});
test('uses the same ID normalization as the editor and catches equivalent names', () => {
    expect(validateNewPluginName('  Team_Tools.v2  ')).toEqual(expect.objectContaining({valid: true, name: 'Team_Tools.v2', id: 'team-tools-v2'}));
    expect(validateNewPluginName('TEAM.Tools', {plugins: [{id: 'team-tools'}]}).code).toBe('plugin_exists');
    expect(validateNewPluginName('Team Tools', {plugins: [{id: 'author__tool', metadata: {name: 'Team-Tools'}}]}).code).toBe('plugin_exists');
});
test('distinguishes an existing workspace from unavailable browser storage', () => {
    const check = jest.fn(id => id === 'team-tools');
    expect(validateNewPluginName('Team Tools', {hasSavedWorkspace: check}).code).toBe('workspace_exists');
    expect(check).toHaveBeenCalledWith('team-tools');
    expect(validateNewPluginName('Team Tools', {hasSavedWorkspace: () => {throw new Error('blocked');}}).code).toBe('storage_unavailable');
});
