const path = '/features/personal-space/render-actions.ts';
const source = `import type { ElementContext } from "../../context";

export interface PersonalSpaceActionHandlers {
  readonly "tool-space-close": ({
    element,
  }: {
    readonly element: HTMLElement;
  }): void;
}

export const handlers: PersonalSpaceActionHandlers = {
  "tool-space-close": ({ element }: ElementContext): void => {
    element.dataset.state = "closed";
    element.focus();
  },
};`;
const corrected = source.replace('  }): void;', '  }) => void;');
const context = 'export interface ElementContext { readonly element: HTMLElement; }';
const consumer = `import {handlers} from "./features/personal-space/render-actions";\nexport const close = handlers["tool-space-close"];`;
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
function scenario(raw = false) {
    const file = content => raw ? '```typescript\n' + content + '\n```' : encode(path, content);
    return {path, source, corrected, context, consumer, raw,
        prompt: 'ORIGINAL SCAFFOLD REQUEST. Build a workbench with reusable actions.',
        workspaceFiles: [{path: '/unrelated.ts', content: 'export const unrelated = "UNRELATED_IMPLEMENTATION";'}],
        replies: [
            {content: JSON.stringify({files: [
                {path: '/context.ts', contract: 'Export ElementContext'},
                {path: '/consumer.ts', contract: 'Export close using handlers from personal-space actions'},
                {path, contract: 'Export handlers and PersonalSpaceActionHandlers for dialog close', visualReference: true},
            ]})},
            {content: encode('/context.ts', context)},
            {content: encode('/consumer.ts', consumer)},
            ...(raw ? [{content: '{"path":'}] : []),
            {content: file(source)},
            {content: file(corrected)},
        ],
    };
}
module.exports = {scenario};
