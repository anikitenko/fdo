// Reduced from the live render.tsx that passed parsing but failed Babel's
// build transform with Duplicate declaration "renderOnLoad".
const path = '/render.tsx';
const source = `import { renderOnLoad } from "./ui/actions";
export function renderOnLoad() {
  return renderOnLoad();
}`;
const corrected = `import { renderOnLoad as createActions } from "./ui/actions";
export function renderOnLoad() {
  return createActions();
}`;
const context = 'export function renderOnLoad() { return { source: "actions" }; }';
const consumer = 'import {renderOnLoad} from "./render";\nexport const actions = renderOnLoad();';
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
function scenario(raw = false) {
    const file = content => raw ? '```typescript\n' + content + '\n```' : encode(path, content);
    return {path, source, corrected, context, consumer, raw,
        prompt: 'ORIGINAL SCAFFOLD REQUEST. Build a workbench with reusable actions.',
        workspaceFiles: [{path: '/unrelated.ts', content: 'export const unrelated = "UNRELATED_IMPLEMENTATION";'}],
        replies: [
            {content: JSON.stringify({files: [
                {path: '/ui/actions.ts', contract: 'Export renderOnLoad'},
                {path: '/consumer.ts', contract: 'Export actions using renderOnLoad'},
                {path, contract: 'Compose and export renderOnLoad', visualReference: true},
            ]})},
            {content: encode('/ui/actions.ts', context)},
            {content: encode('/consumer.ts', consumer)},
            ...(raw ? [{content: '{"path":'}] : []),
            {content: file(source)},
            {content: file(corrected)},
        ],
    };
}
module.exports = {scenario};
