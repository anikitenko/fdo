import {normalizeGeneratedModuleExports} from '../../src/utils/plugins/validation/generatedModuleExports';
import {validateGeneratedFileSyntax} from '../../src/utils/plugins/validation/generatedFileSyntax';

const fixture = require('../fixtures/ai/workspace-self-forwarder.cjs').scenario();
const normalize = content => normalizeGeneratedModuleExports({path: '/render.ts', content});

test('exports the single implementation and removes its redundant self-forwarding wrapper', () => {
    const result = normalize(fixture.source);
    expect(result.names).toEqual(['renderDashboard']);
    expect(result.content).toBe(fixture.corrected);
    expect(result.content).toContain(fixture.implementation);
    expect(validateGeneratedFileSyntax({path: '/render.ts', content: result.content})).toEqual([]);
    expect(normalize(result.content)).toEqual({content: result.content, names: []});
});

test('preserves an already exported implementation without doubling the export', () => {
    const source = fixture.source.replace(fixture.implementation, `export ${fixture.implementation}`);
    expect(normalize(source).content).toBe(fixture.corrected);
});

test('preserves source and comments when the wrapper precedes the implementation', () => {
    const source = '// API\nexport function run(value) { return run(value); }\n// Implementation\nfunction run(value) { return value + 1; }';
    const result = normalize(source);
    expect(result.content).toBe('// API\n\n// Implementation\nexport function run(value) { return value + 1; }');
    const {runInNewContext} = require('node:vm');
    expect(runInNewContext(result.content.replace('export function', 'function') + '\nrun(4)')).toBe(5);
});

test.each([
    'function run(x) { return x; }\nexport function run(x) { return x + 1; }',
    'function run(x) { return x; }\nexport function run(x) { console.log(x); return run(x); }',
    'function run(x) { return x; }\nexport function run(x) { return run(x + 1); }',
    'function run(x) { return x; }\nexport function run(x) { return run(); }',
    'function run(x, y) { return x; }\nexport function run(x, y) { return run(y, x); }',
    'function run(x: string) { return x; }\nexport function run(x: number) { return run(x); }',
    'function run(x = make()) { return x; }\nexport function run(x = make()) { return run(x); }',
    'function run(...args) { return args; }\nexport function run(...args) { return run(...args); }',
    'async function run(x) { return x; }\nexport async function run(x) { return run(x); }',
    'function run(x) { return x; }\nexport function run(x) { return run(x); }\nfunction run(x) { return 0; }',
    'export function run(x) { return run(x); }',
    'function run(x) { return run(x); }\nexport function run(x) { return run(x); }',
    'import {run} from "./impl";\nexport function run(x) { return run(x); }',
    'function outer() { function run(x) { return x; } }\nexport function run(x) { return run(x); }',
    'function run(x) { return x; }\nexport function run(x) { return run(x); }\nconst broken = ;',
    'function run(x) { return x; }\nexport function run(x) { "use strict"; return run(x); }',
])('leaves ambiguous or non-equivalent declarations for validation: %s', source => {
    expect(normalize(source)).toEqual({content: source, names: []});
});

test('never interprets strings, comments or non-source files as wrappers', () => {
    const content = `const example = ${JSON.stringify(fixture.source)};`;
    expect(normalize(content)).toEqual({content, names: []});
    expect(normalizeGeneratedModuleExports({path: '/example.md', content: fixture.source}).names).toEqual([]);
});
