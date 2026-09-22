import {validateGeneratedWorkspaceImports as validate} from '../../src/utils/generatedWorkspaceImports';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';

const source = (path, content) => ({path, content});

test('rejects the recorded live renderer self-import before applying it', () => {
    const content = require('fs').readFileSync(require('path').join(__dirname,
        '../fixtures/ai/workspace-render-self-import.tsx'), 'utf8');
    expect(validateGeneratedPluginFiles([source('/render.tsx', content)], {partial: true}).errors)
        .toContainEqual(expect.stringContaining('resolves to this same file'));
});

test.each([
    ['/render.tsx', 'import {render} from "./render";'],
    ['/ui/index.ts', 'export * from "../ui";'],
    ['/styles/layout.css', '@import "./../styles/layout.css";'],
])('rejects self dependencies in %s', (path, content) => {
    expect(validate([source(path, content)])).toContainEqual(expect.stringContaining('resolves to this same file'));
});

test('resolves existing, pending, directory and absolute imports with virtual build precedence', () => {
    const files = [source('/ui/render.ts', 'import "../styles.css"; import {item} from "./parts"; import "/actions.ts"; import x from "sdk";')];
    expect(validate(files, {paths: ['/ui/render.ts', '/styles.css', '/ui/parts/index.ts', '/actions.ts']})).toEqual([]);
    expect(validate(files, {paths: ['/ui/render.ts']})).toHaveLength(3);
    expect(validate(files, {checkMissing: false})).toEqual([]);
    expect(validate([source('/ui.ts', 'import "./ui";')], {paths: ['/ui.ts', '/ui.js']})).toEqual([]);
});

test('checks named, aliased, default and re-exported imports against actual source', () => {
    const dependencies = [source('/logic.ts', 'export type Mode = string; export const {run, stop: halt} = tools; export default 1;')];
    const good = source('/render.ts', 'import value, {run as execute, halt, type Mode} from "./logic"; export {run as action} from "./logic";');
    expect(validate([good], {sources: [good, ...dependencies]})).toEqual([]);
    const bad = source('/render.ts', 'import {missing} from "./logic";');
    expect(validate([bad], {sources: [bad, ...dependencies]})).toEqual([
        '/render.ts: /logic.ts does not export missing. Keep imports and the dependency\'s actual public interface consistent.',
    ]);
});

test('does not invent exports for CSS maps, JSON, CommonJS or star re-exports', () => {
    const dependencies = [source('/style.css', '.shell {}'), source('/data.json', '{}'),
        source('/cjs.cjs', 'module.exports = compute();'), source('/barrel.ts', 'export * from "./unknown";')];
    const consumer = source('/render.ts', 'import styles from "./style.css"; import data from "./data.json"; import {x} from "./cjs.cjs"; import {y} from "./barrel";');
    expect(validate([consumer], {sources: [consumer, ...dependencies]})).toEqual([]);
});

test('syntax diagnostics remain owned by the source parser', () => {
    expect(validate([source('/bad.ts', 'export const = ;')])).toEqual([]);
});
