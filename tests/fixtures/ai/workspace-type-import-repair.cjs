const files = [
    {path: '/backend/tools.ts', contract: 'Consume public tool result types'},
    {path: '/features/tools/types.ts', contract: 'Shared tool base types'},
    {path: '/features/tools/text-json.ts', contract: 'Export TextToolResult and transformText'},
    {path: '/features/tools/logic.ts', contract: 'Export category definitions and all public result types'},
    {path: '/tail.ts', contract: 'Unrelated pending file'},
];
const consumer = `import type {CategoryToolDefinition, CategoryToolResult, TextToolResult} from '../features/tools/logic';
export const example: TextToolResult = {status: 'success', message: 'Done', value: 'Hello', counts: {characters: 5, words: 1}};
export const execute = (tool: CategoryToolDefinition, input: string): CategoryToolResult => tool.handle(input);`;
const types = `export interface ToolCategoryDefinition {key: string; label: string}
export interface ToolResult {status: 'success' | 'error'; message: string}`;
const text = `export interface TextToolResult {status: 'success' | 'error'; message: string; value?: string}
export const transformText = (input: string): TextToolResult => ({status: 'success', message: 'Done', value: input.toUpperCase()});`;
const body = `// Preserve the real implementation during interface repair.
export const textCategory: CategoryToolDefinition = {
    key: 'text', label: 'Text', handle: (input: string): CategoryToolResult => transformText(input),
};
export const run = (input: string): TextToolResult => transformText(input);`;
const broken = `import type {CategoryToolDefinition, CategoryToolResult, TextToolResult} from './types';
import {transformText} from './text-json';
${body}`;
const header = `import type {ToolCategoryDefinition, ToolResult} from './types';
import {transformText} from './text-json';
import type {TextToolResult as BaseTextToolResult} from './text-json';
export interface TextToolResult extends BaseTextToolResult {counts?: {characters: number; words: number}}
export type CategoryToolResult = ToolResult & {value?: string};
export interface CategoryToolDefinition extends ToolCategoryDefinition {handle(input: string): CategoryToolResult}`;
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
const replies = [JSON.stringify({files}), encode(files[0].path, consumer), encode(files[1].path, types),
    encode(files[2].path, text), encode(files[3].path, broken), encode(files[3].path, header), encode(files[4].path, 'export {};')];
module.exports = {files, consumer, types, text, body, broken, header, encode, replies};
