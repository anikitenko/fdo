import {validateGeneratedWorkspaceCalls} from '../../src/utils/plugins/validation/generatedWorkspaceCalls';
const saved = require('../fixtures/ai/workbench-render-call-errors.json');
const files = Object.entries(saved).map(([path, content]) => ({path, content}));

test('rejects all three recorded render errors, then accepts the corrected caller', () => {
    const errors = validateGeneratedWorkspaceCalls(files);
    expect(errors).toHaveLength(3);
    expect(errors.join('\n')).toMatch(/DOM is not defined/);
    expect(errors.join('\n')).toMatch(/renderDashboard.*zero parameters/);
    expect(errors.join('\n')).toMatch(/renderJsonWorkspace.*zero parameters/);
    const corrected = files.map(file => file.path !== '/render.tsx' ? file : {...file,
        content: 'import { DOM } from "@anikitenko/fdo-sdk";\n' + file.content
            .replace('renderDashboard(cardClass)', 'renderDashboard()')
            .replace('renderJsonWorkspace(resultClass)', 'renderJsonWorkspace()')});
    expect(validateGeneratedWorkspaceCalls(corrected)).toEqual([]);
});

test.each([
    'import { DOM } from "@anikitenko/fdo-sdk"; new DOM();',
    'function run(DOM) { return new DOM(); }',
    'class DOM {} new DOM();',
    'const example = "new DOM()"; // new DOM()',
])('respects lexical bindings and ignores source text: %s', content => {
    expect(validateGeneratedWorkspaceCalls([{path: '/render.ts', content}])).toEqual([]);
});

test.each([
    'export const render = (value?: string) => value;',
    'export const render: (value: string) => string = () => "ok";',
    'export function render(value: string): string; export function render() {return "ok";}',
    'export const render = (...args: string[]) => args.join();',
])('does not infer an incompatible signature from %s', content => {
    expect(validateGeneratedWorkspaceCalls([{path: '/render.ts', content},
        {path: '/caller.ts', content: 'import {render} from "./render"; render("value");'}])).toEqual([]);
});

test('follows export aliases and barrels, respects caller shadowing and JS extra arguments', () => {
    const sources = [{path: '/render.ts', content: 'const make = () => "ok"; export {make as render};'},
        {path: '/barrel.ts', content: 'export {render as view} from "./render";'},
        {path: '/caller.ts', content: 'import {view as draw} from "./barrel"; draw("bad"); function local(draw) {draw("ok");}'},
        {path: '/caller.js', content: 'import {view} from "./barrel"; view("allowed in JS");'}];
    const errors = validateGeneratedWorkspaceCalls(sources);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('draw from /barrel.ts declares zero parameters');
});

test('directs repairs to the generated dependency when its caller is already immutable', () => {
    const sources = [{path: '/render.ts', content: 'export const render = () => "ok";'},
        {path: '/caller.ts', content: 'import {render} from "./render"; render("required");'}];
    const errors = validateGeneratedWorkspaceCalls(sources, {writablePaths: ['/render.ts']});
    expect(errors[0]).toContain('Implement its required argument contract in /render.ts');
    expect(errors[0]).toContain('do not change the retained caller');
});

test.each(['i', ''])('rejects a regex cursor with non-scanning flags %s', flags => {
    const errors = validateGeneratedWorkspaceCalls([{path: '/html.ts', content: `export function scan(text, from) { const re = new RegExp("<img>", "${flags}"); re.lastIndex = from; return re.exec(text); }`}]);
    expect(errors.join('\n')).toContain('lastIndex is ignored');
});
test.each(['g', 'gi', 'y'])('accepts scanning flags %s', flags => {
    expect(validateGeneratedWorkspaceCalls([{path: '/html.ts', content: `const re = /tag/${flags}; re.lastIndex = 2;`}])).toEqual([]);
});
