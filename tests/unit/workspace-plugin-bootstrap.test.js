import {repairPluginBootstrap} from '../../src/utils/plugins/validation/workspacePluginBootstrap';
import {validateGeneratedFileSyntax} from '../../src/utils/plugins/validation/generatedFileSyntax';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
const base = 'import {FDO_SDK as Base} from "@anikitenko/fdo-sdk";\n';
const source = base + 'export default class Inspector extends Base {}';
test('adds an executable startup for the exported SDK entry exactly once', () => {
    const fixed = repairPluginBootstrap({path: '/index.ts', content: source});
    expect(fixed.repaired).toBe(true);
    expect(fixed.content).toContain('new Inspector();');
    expect(validateGeneratedFileSyntax({path: '/index.ts', content: fixed.content}, {entry: true})).toEqual([]);
    expect(repairPluginBootstrap({path: '/index.ts', content: fixed.content}).repaired).toBe(false);
});
test.each([
    source + '\nnew Inspector();',
    source + '\nregister(Inspector);',
    source + '\nfunction later() { return new Inspector(); }',
    base + 'abstract class Inspector extends Base {}',
    base + 'class Inspector extends Base { constructor(value: string) { super(); } }',
    base + 'class Inspector extends Base {} class Other extends Base {}',
    source.replace('@anikitenko/fdo-sdk', 'custom-sdk'),
])('leaves existing or ambiguous bootstrap behavior unchanged', content => {
    expect(repairPluginBootstrap({path: '/index.ts', content})).toEqual({content, repaired: false});
});
test('never starts a helper module', () => {
    expect(repairPluginBootstrap({path: '/features/index.ts', content: source}).repaired).toBe(false);
});
test('staged entry repair adds startup without an extra provider request', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify({path: '/index.ts', content: source}));
    const result = await generateStagedWorkspace({prompt: 'Fix plugin entry', request,
        workspaceFiles: [{path: '/index.ts', content: source}], repairPaths: ['/index.ts']});
    expect(result).toContain('new Inspector();');
    expect(request).toHaveBeenCalledTimes(1);
});
