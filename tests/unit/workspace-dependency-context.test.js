import {compactWorkspaceDependency} from '../../src/utils/workspaceDependencyContext';

const padding = '/* Long module documentation. */\n'.repeat(70);

test('omits unrelated private implementation while retaining public aliases and transitive supporting types', () => {
    const source = `${padding}
type Mode = 'upper' | 'lower';
interface Options { mode: Mode }
const privateFixture = 'PRIVATE_FIXTURE';
function privateRenderer(): string { return 'PRIVATE_RENDERER'; }
function publicRenderer(options: Options): string { return privateRenderer(); }
export { publicRenderer as render };
export const inferred = () => privateFixture;
`;
    const result = compactWorkspaceDependency('/render.ts', source);
    expect(result).toContain('interface Options');
    expect(result).toContain('type Mode');
    expect(result).toContain('function publicRenderer(options: Options): string');
    expect(result).toContain('publicRenderer as render');
    expect(result).toContain("const privateFixture = 'PRIVATE_FIXTURE'");
    expect(result).not.toContain('function privateRenderer');
    expect(result.length).toBeLessThan(source.length / 3);
});

test('does not resend private test fixtures or guess dynamic CommonJS export shapes', () => {
    const source = `${padding}import test from 'node:test';
const fixture = 'UNRELATED_TEST_FIXTURE';
test('behavior', () => console.log(fixture));`;
    expect(compactWorkspaceDependency('/logic.test.ts', source)).not.toContain('UNRELATED_TEST_FIXTURE');
    const commonjs = `${padding}const fixture = 42; module.exports = {fixture};`;
    expect(compactWorkspaceDependency('/logic.cjs', commonjs)).toBe(commonjs);
});

test('retains actual interfaces, aliases, imports and inferred return shapes while omitting typed implementations', () => {
    const source = `${padding}
import type {Input} from './types';
interface Options { mode: 'upper' | 'lower' }
export type {Input as TextInput};
export interface Result { value: string; options: Options }
export function transform(input: Input, options: Options): Result { throw new Error('private implementation'); }
export const values: readonly string[] = ['implementation-only'];
export const inferred = () => ({actualKey: 42});
export default class Renderer {
    constructor(public options: Options) { console.log('constructor implementation'); }
    render(): string { return 'class implementation'; }
}
export {transform as convert};`;
    const result = compactWorkspaceDependency('/logic.ts', source);
    expect(result).toContain("import type {Input} from './types'");
    expect(result).toContain("interface Options { mode: 'upper' | 'lower' }");
    expect(result).toContain('export type {Input as TextInput}');
    expect(result).toContain('export interface Result { value: string; options: Options }');
    expect(result).toContain('transform(input: Input, options: Options): Result');
    expect(result).toContain('export {transform as convert}');
    expect(result).toContain('readonly string[]');
    expect(result).toContain('({actualKey: 42})');
    expect(result).toContain('constructor(public options: Options)');
    expect(result).toContain('render(): string');
    expect(result).not.toMatch(/private implementation|implementation-only|constructor implementation|class implementation/);
    expect(result.length).toBeLessThan(source.length / 2);
});

test('CSS context retains selectors, imports, keyframe names and custom properties without rule bodies', () => {
    const source = `${padding}@import './theme.css';
.panel, .panel:hover { --accent: red; background: red; }
@media (max-width: 600px) { .compact > button { padding: 20px; } }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;
    const result = compactWorkspaceDependency('/styles.css', source);
    expect(result).toContain("@import './theme.css'");
    expect(result).toContain('.panel, .panel:hover');
    expect(result).toContain('.compact > button');
    expect(result).toContain('--accent');
    expect(result).toContain('@keyframes pulse');
    expect(result).not.toMatch(/background: red|padding: 20px/);
});

test('preserves short, non-code, and unsupported source rather than guessing its interface', () => {
    for (const [path, source] of [['/small.ts', 'export const value = 1;'], ['/data.json', JSON.stringify({text: padding})],
        ['/unsupported.ts', `${padding}export function broken(`]]) {
        expect(compactWorkspaceDependency(path, source)).toBe(source);
    }
});
