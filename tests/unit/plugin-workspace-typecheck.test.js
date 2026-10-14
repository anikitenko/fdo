/** @jest-environment node */
import path from 'node:path';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle', () => ({getHostPluginNodeModulesPath: () => require('node:path').resolve('node_modules')}));
test('typechecks detached sources against installed SDK and returns virtual diagnostic owners', () => {
    const files = {'/logic.ts': 'export const count: number = "wrong";'};
    const before = JSON.stringify(files);
    const result = typecheckPluginWorkspace(files, path.resolve('node_modules'));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({path: '/logic.ts', code: 2322})]));
    expect(JSON.stringify(files)).toBe(before);
});
test('checks SDK method arguments and allows correct plugin source', () => {
    const good = 'import {DOMText} from "@anikitenko/fdo-sdk"; export const html = new DOMText().createSpanText("hello", {});';
    expect(typecheckPluginWorkspace({'/render.ts': good}).diagnostics).toEqual([]);
    expect(typecheckPluginWorkspace({'/render.ts': good.replace('"hello", {}', '{}, "hello"')}).success).toBe(false);
});

test('accepts bundler-style imports and import.meta used by plugin test fixtures', () => {
    expect(typecheckPluginWorkspace({'/asset.test.ts': 'import {test} from "node:test"; import assert from "node:assert/strict"; test("asset URL", () => assert.ok(new URL("./fixture.txt", import.meta.url)));'}).diagnostics).toEqual([]);
});

test('scoped repair checks SDK contracts and union access while unused declarations remain advisory', () => {
    const {validatePluginTypeScriptRepair} = require('../../src/utils/sdk/pluginWorkspaceTypecheck');
    const broken = {path: '/repair.ts', content: `import type {FDOInterface} from "@anikitenko/fdo-sdk";
const FAV_KEY = "unused";
export const capabilities: Pick<FDOInterface, "declareCapabilities"> = {declareCapabilities: (): string[] => ["storage"]};
export function favorite(response: {favorites: string[]} | {isFavorite: boolean}) { return response.isFavorite; }
declare global { interface Window { createBackendReq?: (type: string, data?: unknown) => Promise<unknown>; } }`};
    const unrelated = {path: '/later.ts', content: 'export const count: number = "wrong";'};
    const errors = validatePluginTypeScriptRepair(broken, [broken, unrelated]);
    expect(errors.some(error => error.includes('TS6133'))).toBe(false);
    expect(errors.some(error => error.includes('PluginCapability'))).toBe(true);
    expect(errors.some(error => error.includes('isFavorite'))).toBe(true);
    expect(errors.some(error => error.includes('createBackendReq'))).toBe(true);
    expect(errors.every(error => error.startsWith('/repair.ts:'))).toBe(true);
    const fixed = {...broken, content: `import type {FDOInterface, PluginCapability} from "@anikitenko/fdo-sdk";
export const capabilities: Pick<FDOInterface, "declareCapabilities"> = {declareCapabilities: (): PluginCapability[] => ["storage"]};
export function favorite(response: {favorites: string[]} | {isFavorite: boolean}) { return "isFavorite" in response ? response.isFavorite : false; }
export const request = (type: string) => window.createBackendReq(type);`};
    expect(validatePluginTypeScriptRepair(fixed, [fixed, unrelated])).toEqual([]);
});

test('contextually typed nested render fixtures retain literal IDs and enforce required metadata', () => {
    const contract = {'/types.ts': 'export interface ToolMeta {id: "json-format"; icon: string; keywords: readonly string[];} export interface Categories {tools: readonly ToolMeta[];}',
        '/render.ts': 'import type {Categories} from "./types"; export interface RenderProps {categories: readonly Categories[];} export function Render(props: RenderProps) {return props.categories.length;}'};
    const prefix = 'import {Render, type RenderProps} from "./render";';
    const fixture = '{categories: [{tools: [{id: "json-format", icon: "code", keywords: ["json"]}]}]}';
    expect(typecheckPluginWorkspace({...contract, '/render.test.ts': prefix + `const baseProps = ${fixture}; export const result = Render(baseProps);`}).success).toBe(false);
    expect(typecheckPluginWorkspace({...contract, '/render.test.ts': prefix + `const baseProps: RenderProps = ${fixture}; export const result = Render(baseProps);`}).diagnostics).toEqual([]);
    expect(typecheckPluginWorkspace({...contract, '/render.test.ts': prefix + `const baseProps: RenderProps = ${fixture.replace(', icon: "code", keywords: ["json"]', '')}; export const result = Render(baseProps);`}).success).toBe(false);
});

test('unused optional parameters preserve the interface without hiding real type errors', () => {
    const content = 'export function validateJson(source: string, context?: {origin: string}) { return JSON.parse(source); }';
    expect(typecheckPluginWorkspace({'/validators.ts': content}).diagnostics).toEqual([]);
    const invalid = content + '\nexport const wrong: number = "text";';
    expect(typecheckPluginWorkspace({'/validators.ts': invalid}).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code: 2322})]));
    const {buildWorkspaceMonacoCompilerOptions} = require('../../src/components/editor/utils/workspaceMonacoCompilerOptions');
    expect(buildWorkspaceMonacoCompilerOptions({}).noUnusedParameters).toBe(false);
});

test('host-owned handler example obeys unknown input and direct-payload SDK contracts', () => {
    const {GUIDE_PATTERNS} = require('../../src/utils/plugins/authoring/pluginGuideProposal');
    expect(typecheckPluginWorkspace({'/handler.ts': GUIDE_PATTERNS['validated-handler']}, path.join(process.cwd(), 'node_modules')).diagnostics).toEqual([]);
});

test('backend typecheck accepts explicit TS extension imports and re-exports like the editor', () => {
    const files = {
        '/index.ts': 'import {value} from "./logic.ts"; export {Metadata} from "./types.ts"; export const answer = value;',
        '/logic.ts': 'export const value = 42;',
        '/types.ts': 'export interface Metadata {name: string;}',
    };
    expect(typecheckPluginWorkspace(files, path.join(process.cwd(), 'node_modules')).diagnostics).toEqual([]);
});


test('an unused empty private method is advisory while invalid method calls still fail', () => {
    const files = {'/actions.ts': 'export class Actions { private attachHandlers(_element: HTMLElement): void {} public render(): string {return "<button>Inspect</button>";} }'};
    const result = typecheckPluginWorkspace(files, path.join(process.cwd(), 'node_modules'));
    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({code: 6133, path: '/actions.ts'})]));
    const invalid = {'/actions.ts': files['/actions.ts'] + '\nnew Actions().missingMethod();'};
    expect(typecheckPluginWorkspace(invalid, path.join(process.cwd(), 'node_modules')).diagnostics)
        .toEqual(expect.arrayContaining([expect.objectContaining({code: 2339})]));
    const {buildWorkspaceMonacoCompilerOptions} = require('../../src/components/editor/utils/workspaceMonacoCompilerOptions');
    expect(buildWorkspaceMonacoCompilerOptions({}).noUnusedLocals).toBe(false);
});
