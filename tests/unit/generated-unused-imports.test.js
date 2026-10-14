import {repairGeneratedUnusedImports as repair} from '../../src/utils/plugins/validation/generatedUnusedImports';

const fix = content => repair({path: '/render.tsx', content});
test('removes the live unused theme binding while retaining the used icon', () => {
    const result = fix('import {getToolIcon, getCategoryColor} from "./theme"; export const icon = getToolIcon();');
    expect(result.names).toEqual(['getCategoryColor']);
    expect(result.content).toContain('import { getToolIcon }');
});
test('preserves module evaluation when the last runtime binding is removed', () => {
    expect(fix('import unused from "./effects";').content).toBe('import "./effects";');
});
test('preserves evaluation when only type specifiers remain', () => {
    const result = fix('import {unused, type Used} from "./effects"; export type Result = Used;');
    expect(result.names).toEqual(['unused']);
    expect(result.content).toContain('import "./effects";');
    expect(result.content).toContain('type Used');
});
test('removes unused type imports without introducing evaluation', () => {
    expect(fix('import type {Unused} from "./types";').content).toBe('');
});
test.each([
    'import {Used} from "./types"; export type Result = Used;',
    'import Used from "./component"; export const render = () => <Used />;',
    'import {used} from "./lib"; export {used};',
    'import unused from "./lib"; eval("unused()");',
    'const unused = sideEffect();',
])('retains references and executable expressions: %s', content => {
    expect(fix(content)).toEqual({content, names: []});
});
test('does not mistake a shadowed local for an import reference', () => {
    expect(fix('import {unused} from "./lib"; export function f(unused) { return unused; }').names).toEqual(['unused']);
});
test('preserves the implicit classic JSX runtime import', () => {
    const content = 'import React from "react"; export const render = () => <div />;';
    expect(fix(content)).toEqual({content, names: []});
});

test('retains TypeScript annotation imports', () => {
    const content = 'import {Metadata} from "./types"; export class Plugin { metadata: Metadata; }';
    expect(fix(content)).toEqual({content, names: []});
});

test('a source re-export does not keep an unused same-named local import alive', () => {
    const result = repair({path: '/index.ts', content: 'export {METADATA} from "./metadata.ts";\nimport {METADATA} from "./metadata.ts";'});
    expect(result.names).toEqual(['METADATA']);
    expect(result.content).toContain('export {METADATA} from "./metadata.ts";');
    expect(result.content).toContain('import "./metadata.ts";');
});

test('staged scoped cleanup responds to TS6133 without regenerating imported metadata', async () => {
    const {generateStagedWorkspace} = require('../../src/utils/ai/generation/codingWorkspaceGeneration');
    const content = 'export {METADATA} from "./metadata.ts";\nimport {METADATA} from "./metadata.ts";';
    const request = jest.fn().mockResolvedValue(JSON.stringify({path: '/entry.ts', content}));
    const result = await generateStagedWorkspace({prompt: '/entry.ts:2:1: TS6133: METADATA is never read.', request,
        workspaceFiles: [{path: '/entry.ts', content}, {path: '/metadata.ts', content: 'export const METADATA = {name: "Inspector"};'}],
        repairPaths: ['/entry.ts']});
    expect(result).toContain('import "./metadata.ts";');
    expect(result).toContain('export {METADATA}');
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).not.toContain('### File: /metadata.ts');
});
