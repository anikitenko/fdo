import {repairAsyncTestCallbacks} from '../../src/utils/plugins/validation/workspaceAsyncTests';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
import {validatePluginAcceptanceCriteria} from '../../src/utils/plugins/authoring/pluginAcceptanceCriteria';
const file = content => ({path: '/tests/acceptance.test.ts', content});
const guide = {path: '/SKILL.md', content: '<!-- fdo-acceptance -->\n~~~json\n' + JSON.stringify([
    {id: 'valid', description: 'Validates JSON', testFile: '/tests/acceptance.test.ts', testName: 'handles valid JSON'},
]) + '\n~~~'};
test.each(['test', 'it as check', 'default'])('repairs only the node:test callback and preserves assertions (%s)', style => {
    const named = style === 'default' ? 'test' : style.includes(' as ') ? 'check' : style;
    const imported = style === 'default' ? 'test' : `{${style}}`;
    const content = `import ${imported} from 'node:test';\n${named}('handles valid JSON', () => { const logic = await import('../logic'); if (!logic.valid) throw new Error('invalid'); });`;
    const result = repairAsyncTestCallbacks(file(content));
    expect(result.repaired).toBe(true);
    expect(result.content).toBe(content.replace('() =>', 'async () =>'));
    expect(repairAsyncTestCallbacks(file(result.content)).repaired).toBe(false);
});
test.each([
    "function load() { return await import('../logic'); }",
    "import {test} from 'custom-runner'; test('case', () => { await load(); });",
    "import {test} from 'node:test'; test('case', () => { function load() { await work(); } });",
    "import {describe} from 'node:test'; describe('suite', () => { await work(); });",
    "import {test} from 'node:test'; function wrapper(test) {test('case', () => {await work();});}",
])('does not change arbitrary, nested or unrecognized async boundaries', content => {
    expect(repairAsyncTestCallbacks(file(content))).toEqual({content, repaired: false});
});
test('acceptance checks defer syntax failures and still reject a missing declaration after parsing succeeds', () => {
    const malformed = "import {test} from 'node:test'; test('handles valid JSON', () => { await import('../logic'); });";
    expect(validatePluginAcceptanceCriteria([guide, file(malformed)])).toEqual([]);
    expect(validatePluginAcceptanceCriteria([guide, file("import {test} from 'node:test'; test('different name', () => {});")]))
        .toEqual([expect.stringContaining('handles valid JSON')]);
});
test('generation fixes the test without another provider request or deleting assertions', async () => {
    const content = "import {test} from 'node:test'; test('handles valid JSON', () => { await Promise.resolve(); if (JSON.parse('{}') === null) throw new Error('invalid'); });";
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/tests/acceptance.test.ts', contract: 'Acceptance test'}]}))
        .mockResolvedValueOnce(JSON.stringify(file(content)));
    const result = await generateStagedWorkspace({prompt: 'Add a test', request, workspaceFiles: [guide]});
    expect(result).toContain('async () =>');
    expect(result).toContain("throw new Error('invalid')");
    expect(request).toHaveBeenCalledTimes(2);
});
