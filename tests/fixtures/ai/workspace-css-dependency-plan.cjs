const rejected = require('node:fs').readFileSync(require('node:path').join(__dirname, 'workspace-unplanned-styles.css'), 'utf8');
const dependencies = ['/features/dashboard/styles.css', '/features/json/workspace.css', '/features/categories/styles.css',
    '/features/library/styles.css', '/features/personal-space/styles.css'];
const helpers = dependencies.map(path => ({path, contract: 'Implement this feature stylesheet'}));
const root = {path: '/styles.css', contract: 'Compose the complete workbench styling'};
const entry = {path: '/index.ts', contract: 'Retained plugin entry'};
const tail = {path: '/logic.test.ts', contract: 'Pending tests'};
const source = path => path.endsWith('.css') ? '.panel { color: teal; }' : 'export {};';
const encode = (path, content = source(path)) => JSON.stringify({path, lines: content.trimEnd().split('\n')});
const composition = dependencies.map(path => `@import ".${path}";`).join('\n') + '\n.shell { color: teal; }';
const replies = [JSON.stringify({files: [entry, root, tail]}), encode(entry.path), encode(root.path, rejected),
    JSON.stringify({files: helpers}), ...dependencies.map(path => encode(path)), encode(root.path, composition), encode(tail.path)];
module.exports = {root, helpers, entry, tail, dependencies, composition, rejected, encode, replies};
