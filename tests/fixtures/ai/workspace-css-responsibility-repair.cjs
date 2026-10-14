const root = {path: '/styles/base.css', contract: 'Shared tokens and controls for the workbench', visualReference: true};
const tail = {path: '/tail.ts', contract: 'Unrelated remaining work'};
const workspaceFiles = [{path: '/styles/base-tokens.css', content: '.existing { color: teal; }'}];
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
const echo = JSON.stringify({files: [root]});
const responsibilities = JSON.stringify({helpers: [
    {name: 'tokens', contract: 'Define the workspace spacing tokens'},
    {name: 'controls', contract: 'Style shared buttons and focus states'},
]});
const composition = '@import "./base-tokens-2.css";\n@import "./base-controls.css";';
const expectedPaths = ['/styles/base-tokens-2.css', '/styles/base-controls.css', root.path, tail.path];
const replies = [
    {content: JSON.stringify({files: [root, tail]})},
    {content: '.partial {', finishReason: 'length'},
    {content: echo},
    {content: responsibilities},
    {content: encode(expectedPaths[0], ':root { --space: 1rem; }')},
    {content: encode(expectedPaths[1], '.button { padding: var(--space); } .button:focus-visible { outline: 2px solid; }')},
    {content: encode(root.path, composition)},
    {content: encode(tail.path, 'export const done = true;')},
];
module.exports = {root, tail, workspaceFiles, echo, responsibilities, composition, expectedPaths, replies};
