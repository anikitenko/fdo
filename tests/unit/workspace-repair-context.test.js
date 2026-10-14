import {workspaceRepairContext} from '../../src/utils/plugins/validation/workspaceRepairContext';

test('test repair receives pending implementation bodies, literals and return shapes', () => {
    const files = [
        {path: '/tests/json.test.ts', content: 'import {format} from "../json";'},
        {path: '/json.ts', content: 'export function format(): object { return {output: {a: 1}}; }'},
        {path: '/unrelated.ts', content: 'const SECRET_UNRELATED = 1;'},
    ];
    const context = workspaceRepairContext('/tests/json.test.ts', files);
    expect(context).toContain(files[1].content);
    expect(context).not.toContain('SECRET_UNRELATED');
});
test('implementation repair receives full assertions from its latest repaired consumers', () => {
    const files = [{path: '/json.ts', content: 'export const format = () => "";'},
        {path: '/json.test.ts', content: 'import {format} from "./json"; test("old", () => assert.equal(format(), "old"));'}];
    const repaired = {...files[1], content: 'import {format} from "./json"; test("roundtrip", () => assert.equal(format(), "{\\"a\\":1}"));'};
    const context = workspaceRepairContext('/json.ts', files, [repaired]);
    expect(context).toContain(repaired.content);
    expect(context).not.toContain('test("old"');
});
test('includes re-export contracts without pulling in the transitive workspace', () => {
    const files = [{path: '/a.ts', content: 'export {value} from "./b";'},
        {path: '/b.ts', content: 'export {value} from "./c";'},
        {path: '/c.ts', content: 'export const value = 1;'}];
    expect(workspaceRepairContext('/a.ts', files)).toContain('File: /b.ts');
    expect(workspaceRepairContext('/a.ts', files)).not.toContain('File: /c.ts');
});

test('supplies candidate styles read through literal file lists without granting write scope', () => {
    const files = [
        {path: '/test/styles.test.ts', content: 'const files = ["styles/panel/inputs.css", `styles/shell.css`]; files.forEach(readCssFile);'},
        {path: '/styles/panel/inputs.css', content: '.wt-input {background:url("data:image/svg+xml,www.w3.org");}'},
        {path: '/styles/shell.css', content: '.wt-shell {display:grid;}'},
        {path: '/private.ts', content: 'UNRELATED_SOURCE'},
    ];
    const result = workspaceRepairContext('/test/styles.test.ts', files);
    expect(result).toContain(files[1].content);
    expect(result).toContain(files[2].content);
    expect(result).toContain('not permission to edit');
    expect(result).not.toContain('UNRELATED_SOURCE');
});

test('asset evidence uses latest candidate content and excludes external or traversal paths', () => {
    const files = [
        {path: '/test/styles.test.ts', content: 'const paths = ["styles/a.css", "../secret.css", "https://example.com/remote.css"];'},
        {path: '/styles/a.css', content: 'OLD_CSS'},
        {path: '/secret.css', content: 'SECRET_CSS'},
        {path: '/remote.css', content: 'REMOTE_CSS'},
    ];
    const result = workspaceRepairContext('/test/styles.test.ts', files, [{path: '/styles/a.css', content: 'NEW_CSS'}]);
    expect(result).toContain('NEW_CSS');
    expect(result).not.toMatch(/OLD_CSS|SECRET_CSS|REMOTE_CSS/);
});

test('follows nested type contracts and re-exports without pulling in runtime dependencies', () => {
    const files = [
        {path: '/render.test.ts', content: 'import {Render} from "./render";'},
        {path: '/render.ts', content: 'import type {Input} from "./compose"; export function Render(props: Input) { return props; }'},
        {path: '/compose.ts', content: 'import {type ToolMeta} from "./barrel"; import {runtime} from "./runtime"; export interface Input {tools: readonly ToolMeta[]}'},
        {path: '/barrel.ts', content: 'export type {ToolMeta} from "./types";'},
        {path: '/types.ts', content: 'import type {Input} from "./compose"; export interface ToolMeta {id: "json"; icon: string; keywords: readonly string[]; parent?: Input}'},
        {path: '/runtime.ts', content: 'RUNTIME_SHOULD_NOT_APPEAR'},
    ];
    const latest = {...files[4], content: files[4].content.replace('"json"', '"json-format"')};
    const context = workspaceRepairContext('/render.test.ts', files, [latest]);
    expect(context).toContain('READ-ONLY TYPE CONTRACT: /compose.ts');
    expect(context).toContain('READ-ONLY TYPE CONTRACT: /types.ts');
    expect(context).toContain(latest.content);
    expect(context).toContain('Parameters<typeof importedFunction>[0]');
    expect(context).not.toContain('RUNTIME_SHOULD_NOT_APPEAR');
    expect(context.match(/READ-ONLY TYPE CONTRACT: \/compose.ts/g)).toHaveLength(1);
});

test('reports disconnected global and lexical mock captures without changing test source', () => {
    const target = {path: '/acceptance.test.ts', content: `let lastHandledResult: {type: string} | undefined;
export function capture(data: {type: string}) { (globalThis as any).lastHandledResult = data; }
export function read() { return lastHandledResult; }`};
    const evidence = workspaceRepairContext(target.path, [target]);
    expect(evidence).toContain('globalThis.lastHandledResult is assigned');
    expect(evidence).toContain('separate lexical binding');
    expect(evidence).toContain('restore mocked methods');
    expect(target.content).toContain('(globalThis as any).lastHandledResult = data');
});
