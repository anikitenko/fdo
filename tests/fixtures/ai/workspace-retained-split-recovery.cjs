// The split inventory is the recorded live response. Host state here is a
// minimal transaction covering completed, pending and existing retained files.
const split = require('./workspace-split-retained-contracts.json');
const logic = {path: '/features/tools/logic.ts',
    contract: 'Implements the shared local formatter, validation helpers, and deterministic category tool operations.',
    visualReference: false};
const entry = {path: '/index.ts', contract: 'Plugin entry', visualReference: false};
const root = {path: '/render.tsx', contract: 'Compose the workbench', visualReference: true};
const workspaceFiles = [{path: '/features/tools/model.ts', content: 'export const retainedModel = true;'}];
const helpers = split.files.filter(item => item.path !== logic.path && item.path !== workspaceFiles[0].path);
const source = path => path.endsWith('.css') ? '.panel { color: teal; }' : 'export {};';
const encoded = path => JSON.stringify({path, lines: [source(path)]});
const replies = [
    {content: JSON.stringify({files: [entry, root, logic]})},
    {content: encoded(entry.path)},
    {content: '', finishReason: 'length'},
    {content: JSON.stringify(split)},
    ...helpers.map(item => ({content: encoded(item.path)})),
    {content: encoded(root.path)},
    {content: encoded(logic.path)},
];
module.exports = {replies, workspaceFiles, logic, root, helpers,
    expectedPaths: [entry, ...helpers, root, logic].map(item => item.path)};
