import {validateGeneratedCallbackParameters as validate} from '../../src/utils/plugins/validation/generatedCallbackParameters';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';

const fixture = require('../fixtures/ai/workspace-unused-callback.json');
const corrected = fixture.render.replace('import { CATEGORY_KEYS } from "./features/category/types";\n', '')
    .replace('...CATEGORY_KEYS.map((key) =>\n      renderCategoryWorkspace("category-workspace", "category-result")\n    )',
        'renderCategoryWorkspace("category-workspace", "category-result")');

test('catches the recorded callback and permits removing duplicated rendering', () => {
    expect(validate({path: '/render.tsx', content: fixture.render})).toEqual([
        expect.stringContaining("/render.tsx:40:27: Callback parameter 'key'"),
    ]);
    expect(validate({path: '/render.tsx', content: corrected})).toEqual([]);
    expect(validateGeneratedPluginFiles([{path: '/render.tsx', content: fixture.render}], {partial: true}).warnings.join('\n'))
        .toContain("Callback parameter 'key'");
});

test.each([
    'items.map(key => render(key));',
    'items.map((key, index) => index);',
    'items.map(_key => render());',
    'items.map(({key}) => render());',
    'items.map(function(key) { return arguments[0]; });',
    'items.map(key => () => key);',
    'declare function callback(key: string): void;',
    'function renderHero(state: string) { return state; }',
    'function renderHero(_state: string) { return "hero"; }',
    'function renderHero(state: string) { return arguments[0]; }',
    'function renderHero(state: string) { return () => state; }',
])('does not reject supported or uncertain parameter usage: %s', content => {
    expect(validate({path: '/render.ts', content})).toEqual([]);
});

test.each([
    'function renderHero(state: string): string { return "hero"; }',
    'const renderHero = (state: string): string => "hero";',
    'const renderHero = function(state: string): string { return "hero"; };',
])('catches unused ordinary function parameters before editor application: %s', content => {
    expect(validate({path: '/render.tsx', content})).toEqual([
        expect.stringContaining("Function parameter 'state' is declared but its value is never read"),
    ]);
});

test.each([
    'export function renderHero(state: string): string { return "<h1>Workbench</h1>"; }',
    'export const run = () => [1, 2].map(key => 3);',
    'export function validateJson(source: string, context?: {origin: string}) { return JSON.parse(source); }',
])('unused parameters warn without triggering generation repairs: %s', async content => {
    const validation = validateGeneratedPluginFiles([{path: '/logic.ts', content}], {partial: true});
    expect(validation.errors).toEqual([]);
    expect(validation.warnings.join('\n')).toContain('never read');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/logic.ts', contract: 'Logic'}]}))
        .mockResolvedValueOnce(JSON.stringify({path: '/logic.ts', content}));
    const result = await generateStagedWorkspace({prompt: 'Build a utility', request});
    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toContain(content);
});
