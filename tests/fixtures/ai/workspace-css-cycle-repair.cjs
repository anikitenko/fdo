const root = {path: '/features/ui/styles/dashboard.css', contract: 'Dashboard composition'};
const shared = {path: '/features/ui/styles/shared.css', contract: 'Shared tokens and controls'};
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
const workspaceFiles = [{path: '/styles.css', content: '@import "./features/ui/styles/dashboard.css";'}];
const composition = '@import "./shared-tokens.css";';
const expectedPaths = ['/features/ui/styles/shared-tokens.css', shared.path, root.path];
const replies = [
    {content: JSON.stringify({files: [root, shared]})},
    {content: '.partial {', finishReason: 'length'},
    {content: JSON.stringify({files: [shared]})},
    {content: '.partial {', finishReason: 'length'},
    // Real new helper plus an unsafe ancestor: reject the entire proposal.
    {content: JSON.stringify({files: [{path: '/discarded.css', contract: 'Rejected helper'}, root]})},
    {content: JSON.stringify({helpers: [{name: 'tokens', contract: 'Define shared spacing tokens'}]})},
    {content: encode(expectedPaths[0], ':root { --space: 1rem; }')},
    {content: encode(shared.path, composition)},
    {content: encode(root.path, '@import "./shared.css"; .dashboard { padding: var(--space); }')},
];
module.exports = {root, shared, workspaceFiles, composition, expectedPaths, replies, repairIndex: 5};
