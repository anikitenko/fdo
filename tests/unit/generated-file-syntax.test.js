import {validateGeneratedFileSyntax} from '../../src/utils/generatedFileSyntax';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';

test.each([
    ['/features/text/logic.ts', 'export const x: string = ;'],
    ['/features/index.tsx', 'export const x = <div>'],
    ['/lib/worker.mjs', 'export function f( {'],
    ['/tests/logic.test.ts', 'import test from "node:test"; test("x", () => {'],
    ['/styles/overlay.css', '.overlay { color: red;'],
    ['/data/options.json', '{"theme":}'],
])('validates syntax independently for %s', (path, content) => {
    expect(validateGeneratedPluginFiles([{path, content}], {partial: true}).errors.join('\n')).toContain(`${path}:`);
});

test.each(['// new Plugin();', 'const example = "new Plugin()";', 'function later() { new Plugin(); }']) (
    'entry must actually instantiate the plugin: %s', suffix => {
        expect(validateGeneratedFileSyntax({path: '/index.ts', content: `class Plugin extends FDO_SDK {}\n${suffix}`}, {entry: true}))
            .toEqual([expect.stringContaining('new Plugin()')]);
    });

test.each(['new Plugin();', 'export default new Plugin();', 'const instance = new Plugin();']) (
    'accepts executable entry instantiation: %s', suffix => {
        expect(validateGeneratedFileSyntax({path: '/index.ts', content: `class Plugin extends FDO_SDK {}\n${suffix}`}, {entry: true})).toEqual([]);
    });

test('accepts an aliased SDK import and preserves real source newlines', () => {
    const content = 'import {FDO_SDK as Base} from "@anikitenko/fdo-sdk";\n// entry\nclass Plugin extends Base {}\nnew Plugin();';
    expect(validateGeneratedPluginFiles([{path: '/index.ts', content}], {partial: true}).errors).toEqual([]);
});

test('nested index helpers and extracted classes do not have to instantiate a plugin', () => {
    expect(validateGeneratedPluginFiles([{path: '/features/index.ts', content: 'export class Feature extends FDO_SDK {}'}]).errors).toEqual([]);
});

test('file-local UI rules run without an entry, while pending wrappers are allowed', () => {
    const path = '/features/render.ts';
    expect(validateGeneratedPluginFiles([{path, content: 'export const field = `<input>`;'}], {partial: true}).errors).toEqual([]);
    expect(validateGeneratedPluginFiles([{path, content: 'export const field = DOM.createElement("div");'}], {partial: true}).errors)
        .toEqual([expect.stringContaining('DOM.createElement(...) is not an SDK static method')]);
});
