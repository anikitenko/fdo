// Reproduces the recorded leaf -> expanded leaf -> split composition episode.
// The resumed panels module still needs its local overlay rules as well as
// imports. An allowance regression returns a terminal length event, never a
// completed response containing partial CSS.
const root = '/styles/features.css';
const panels = '/styles/features/panels.css';
const categories = '/styles/features/categories.css';
const components = '/styles/features/components.css';
const tail = '/tail.ts';
const plan = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused workbench module'}))});
const encode = (path, source) => JSON.stringify({path, lines: source.split('\n')});
const composition = '@import "./categories.css";\n@import "./components.css";\n.library { display: none; }\n.library[data-state="open"] { display: flex; }';
const limit = {content: '.incomplete {', finishReason: 'length'};
const replies = [
    {content: plan([root, tail])}, limit,
    {content: plan([panels])}, limit, limit,
    {content: plan([categories, components])}, limit,
    {content: encode(categories, '.category { display: grid; }')},
    {content: encode(components, '.button { padding: 1rem; }')},
    {content: encode(panels, composition), minimumOutputTokens: 3072},
    {content: encode(root, '@import "./features/panels.css";')},
    {content: encode(tail, 'export const done = true;')},
];
const expectedPaths = [categories, components, panels, root, tail];
module.exports = {root, panels, categories, components, tail, replies, expectedPaths, composition};
