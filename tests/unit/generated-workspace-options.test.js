import {validateGeneratedWorkspaceOptions} from '../../src/utils/plugins/validation/generatedWorkspaceOptions';
import {validateAiWorkspaceCandidate} from '../../src/components/editor/utils/validateAiWorkspaceCandidate';
const recorded = require('../fixtures/ai/workspace-options-contracts.json');
const files = Object.entries(recorded).map(([path, content]) => ({path, content}));

test('finds the saved CSS-map and inherited options mismatches', () => {
    const errors = validateGeneratedWorkspaceOptions(files);
    expect(errors.join('\n')).toMatch(/\/index.ts:.*renderComposed.*dom, css/);
    expect(errors.join('\n')).toMatch(/\/render.tsx:.*renderSocialWorkspace.*category, title/);
});

const workspace = (argument, definition = 'interface Options {dom: object; css: object; title?: string}') => [
    {path: '/helper.ts', content: `${definition}; export function render(opts: Options) {return opts;}`},
    {path: '/caller.ts', content: `import {render} from './helper'; ${argument}`},
];
test.each(['render({});', 'render({dom: {}});', 'render({css: {}} as any);'])(
    'rejects missing concrete fields: %s', argument => {
        expect(validateGeneratedWorkspaceOptions(workspace(argument))).toHaveLength(1);
    });
test.each(['render({dom: {}, css: {}});', 'const base = {dom: {}}; render({...base, css: {}});',
    'declare const dynamic: any; render(dynamic);', 'function local(render) {render({});}',
    'declare const dynamic: any; render({...dynamic});',
    'const opts = {} as any; opts.dom = {}; opts.css = {}; render(opts);'])(
    'accepts valid or statically uncertain arguments: %s', argument => {
        expect(validateGeneratedWorkspaceOptions(workspace(argument))).toEqual([]);
    });
test('follows inherited imported interfaces through aliases and optional members', () => {
    const errors = validateGeneratedWorkspaceOptions([
        {path: '/base.ts', content: 'export interface Base {title: string; optional?: string}'},
        {path: '/barrel.ts', content: 'export {Base as Parent} from "./base";'},
        ...workspace('render({dom: {}, css: {}});', 'import type {Parent} from "./barrel"; interface Options extends Parent {dom: object; css: object}'),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('fields: title');
});
test('shared candidate validation rejects options defects before any compiler call', async () => {
    const candidate = workspace('render({dom: {}});');
    const build = jest.fn();
    const errors = await validateAiWorkspaceCandidate({files: candidate, workspaceFiles: [], readWorkspace: () => [], build, assertActive: () => {}});
    expect(errors.join('\n')).toContain('required option fields: css');
    expect(build).not.toHaveBeenCalled();
});

test('retained callers direct repair toward the writable dependency', () => {
    const errors = validateGeneratedWorkspaceOptions(workspace('render({dom: {}});'), {writablePaths: ['/helper.ts']});
    expect(errors[0]).toContain('caller is retained and immutable');
    expect(errors[0]).toContain('Writable module(s): /helper.ts');
    expect(errors[0]).toContain('Do not make required input optional');
});

test('does not assign a retained caller/renderer mismatch to an unrelated catalog', () => {
    const files = [...workspace('render({dom: {}});'), {path: '/catalog.ts', content: 'export const tools = [];'}];
    expect(validateGeneratedWorkspaceOptions(files, {writablePaths: ['/catalog.ts']})).toEqual([]);
    expect(validateGeneratedWorkspaceOptions(files)).toHaveLength(1);
    expect(validateGeneratedWorkspaceOptions(files, {writablePaths: ['/caller.ts']})).toHaveLength(1);
});

test('keeps diagnostics when the writable file owns imported or re-exported option types', () => {
    const files = [
        {path: '/types.ts', content: 'export interface Options {categories: string[]; tools: string[]}'},
        {path: '/barrel.ts', content: 'export {Options} from "./types";'},
        {path: '/render.tsx', content: 'import type {Options} from "./barrel"; export function renderApp(options: Options) { return options; }'},
        {path: '/index.ts', content: 'import {renderApp} from "./render"; renderApp({});'},
        {path: '/catalog.ts', content: 'export const tools = [];'},
    ];
    for (const path of ['/types.ts', '/barrel.ts', '/render.tsx', '/index.ts']) {
        expect(validateGeneratedWorkspaceOptions(files, {writablePaths: [path]})).toHaveLength(1);
    }
    expect(validateGeneratedWorkspaceOptions(files, {writablePaths: ['/catalog.ts']})).toEqual([]);
});
