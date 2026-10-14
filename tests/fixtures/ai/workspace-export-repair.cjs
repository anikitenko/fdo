// Reduced from /ui/compose.ts returning entry metadata/class exports instead
// of renderDashboard. The real provider's full reply is not replayed here.
const path = '/ui/compose.ts';
const source = `import { renderTitle } from "./title";
export interface WebToolsWorkbenchMetadata { name: string; }
export const webToolsMetadata = { name: "Workbench" };
export class WebToolsWorkbenchPlugin {
  render() { return renderTitle(webToolsMetadata.name); }
}
new WebToolsWorkbenchPlugin();`;
const corrected = `import { renderTitle } from "./title";
export function renderDashboard(options: { title: string }): string {
  return '<main>' + renderTitle(options.title) + '</main>';
}`;
const context = 'export function renderTitle(title: string): string { return "<h1>" + title + "</h1>"; }';
const consumer = 'import {renderDashboard} from "./ui/compose";\nexport const render = () => renderDashboard({title: "Workbench"});';
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
function scenario(raw = false) {
    const file = content => raw ? '```typescript\n' + content + '\n```' : encode(path, content);
    return {path, source, corrected, context, consumer, raw,
        repairHeading: 'FOCUSED WORKSPACE EXPORT REPAIR',
        prompt: 'ORIGINAL SCAFFOLD REQUEST. Build the full plugin entry, metadata and dashboard.',
        workspaceFiles: [{path: '/unrelated.ts', content: 'export const unrelated = "UNRELATED_IMPLEMENTATION";'}],
        replies: [
            {content: JSON.stringify({files: [
                {path: '/ui/title.ts', contract: 'Export renderTitle(title: string): string'},
                {path: '/render.tsx', contract: 'Render using renderDashboard({title})'},
                {path, contract: 'Export renderDashboard(options: {title: string}): string; compose dashboard markup.', visualReference: true},
            ]})},
            {content: encode('/ui/title.ts', context)},
            {content: encode('/render.tsx', consumer)},
            ...(raw ? [{content: '{"path":'}] : []),
            {content: file(source)},
            {content: file(corrected)},
        ],
    };
}
module.exports = {scenario};
