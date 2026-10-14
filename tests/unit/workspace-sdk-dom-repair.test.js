import {repairWorkspaceSdkDom} from '../../src/utils/plugins/validation/workspaceSdkDomRepair';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
import {parse} from '@babel/parser';
const recorded = require('../fixtures/ai/workspace-global-sdk-dom.json');

test('replaces the recorded invented constructor and false string signature with the SDK import', () => {
    const fixed = repairWorkspaceSdkDom(recorded);
    expect(fixed.repaired).toBe(true);
    expect(fixed.content).toContain('import { DOM as FdoSdkDOM } from "@anikitenko/fdo-sdk";');
    expect(fixed.content).toContain('new FdoSdkDOM()');
    expect(fixed.content).not.toContain('style: string');
    expect(fixed.content).not.toContain('globalThis');
    expect(fixed.content.match(/dom.createClassFromStyle\(css\./g)).toHaveLength(7);
    expect(fixed.content).toContain('renderWorkbenchShell(initialState, args)');
    expect(() => parse(fixed.content, {sourceType: 'module', plugins: ['typescript']})).not.toThrow();
    expect(repairWorkspaceSdkDom({...recorded, content: fixed.content})).toEqual({content: fixed.content, repaired: false});
});

test('uses an alias absent from every scope', () => {
    const fixed = repairWorkspaceSdkDom({...recorded, content: 'const FdoSdkDOM = 1;\n' + recorded.content});
    expect(fixed.content).toContain('DOM as FdoSdkDOM2');
    expect(fixed.content).toContain('new FdoSdkDOM2()');
});

test.each([
    'const globalThis = custom; const dom = new globalThis.DOM(); dom.createClassFromStyle({}); dom.renderHTML("");',
    'globalThis.DOM = Custom; const dom = new globalThis.DOM(); dom.createClassFromStyle({}); dom.renderHTML("");',
    'const dom = new globalThis.DOM(options); dom.createClassFromStyle({}); dom.renderHTML("");',
    'const dom = new globalThis.DOM(); dom.someOtherApi();',
    'import {DOM} from "@anikitenko/fdo-sdk"; const dom = new DOM(); dom.createClassFromStyle({}); dom.renderHTML("");',
])('preserves unrelated, custom and already valid constructors', content => {
    expect(repairWorkspaceSdkDom({path: '/render.tsx', content})).toEqual({content, repaired: false});
});

test('staged repair fixes the constructor without spending another provider request', async () => {
    const source = 'export function render() { const dom = new (globalThis as any).DOM(); return dom.renderHTML(dom.createClassFromStyle({color: "red"})); }';
    const request = jest.fn(async () => JSON.stringify({path: '/render.ts', content: source}));
    const result = await generateStagedWorkspace({prompt: 'Repair renderer', request,
        workspaceFiles: [{path: '/render.ts', content: source}], repairPaths: ['/render.ts']});
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toContain('new FdoSdkDOM()');
    expect(result).not.toContain('globalThis');
});

test('normalizes null attributes only on a statically identified SDK DOM instance', () => {
    const content = 'import {DOM as D} from "@anikitenko/fdo-sdk"; const dom = new D(); export const html = dom.createElement("span", null, "label");';
    const result = repairWorkspaceSdkDom({path: '/navigation.tsx', content});
    expect(result.content).toContain('createElement("span", {}, "label")');
    expect(result.repaired).toBe(true);
    const custom = content.replace('@anikitenko/fdo-sdk', 'custom-dom');
    expect(repairWorkspaceSdkDom({path: '/navigation.tsx', content: custom}).content).toBe(custom);
});
