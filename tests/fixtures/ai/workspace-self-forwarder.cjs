// Reduced from the reported duplicate renderDashboard and self-calling export.
const path = '/ui/render.ts';
const implementation = `function renderDashboard(options: RenderOptions): string {
  return '<main>' + options.title + '</main>';
}`;
const source = `export interface RenderOptions { title: string; }
${implementation}

export function renderDashboard(options: RenderOptions): string {
  return renderDashboard(options);
}`;
const corrected = `export interface RenderOptions { title: string; }
export ${implementation}

`;
const consumer = 'import {renderDashboard} from "./ui/render";\nexport const render = () => renderDashboard({title: "Workbench"});';
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
function scenario(raw = false) {
    return {path, source, corrected, implementation, consumer, normalized: true,
        prompt: 'Build a dashboard using the existing workspace.',
        workspaceFiles: [],
        replies: [
            {content: JSON.stringify({files: [
                {path: '/consumer.ts', contract: 'Export render using renderDashboard'},
                {path, contract: 'Export renderDashboard and RenderOptions'},
            ]})},
            {content: encode('/consumer.ts', consumer)},
            ...(raw ? [{content: '{"path":'}] : []),
            {content: raw ? '```typescript\n' + source + '\n```' : encode(path, source)},
        ],
    };
}
module.exports = {scenario};
