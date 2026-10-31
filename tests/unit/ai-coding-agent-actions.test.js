import {allowsWorkspaceIntent, resolveFileActionTarget, fileActionScopeError, codingResponseKind} from '../../src/components/editor/utils/aiCodingAgentActions';

test('workspace intent interpretation belongs to Smart and Plan; explicit actions keep their scope', () => {
    for (const action of ['generate', 'edit', 'explain', 'fix']) expect(allowsWorkspaceIntent(action)).toBe(false);
    for (const action of ['smart', 'plan']) expect(allowsWorkspaceIntent(action)).toBe(true);
});

test('file actions use the selection or open file and preserve the full baseline', () => {
    const target = {currentFilePath: '/render.ts', currentFileContent: 'export const view = 1;'};
    expect(resolveFileActionTarget({...target, action: 'edit'})).toMatchObject({code: target.currentFileContent, path: '/render.ts', hasSelection: false, error: ''});
    expect(resolveFileActionTarget({...target, action: 'fix', selectedCode: 'view = 1'})).toMatchObject({code: 'view = 1', content: target.currentFileContent, hasSelection: true});
    expect(resolveFileActionTarget({action: 'explain'})).toMatchObject({code: '', scope: 'workspace', error: ''});
});

test.each(['/Users/me/index.ts', '/node_modules/sdk/index.ts', '/dist/plugin.js', ''])('does not use an absent or non-workspace edit target %s', currentFilePath => {
    expect(resolveFileActionTarget({action: 'edit', currentFilePath, currentFileContent: 'const x = 1;'}).error).toContain('Open a nonempty plugin file');
});

test('single-file actions reject an entire multi-file proposal before any patch is applied', () => {
    const patch = path => `\`\`\`patch\nFile: ${path}\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n\`\`\``;
    expect(fileActionScopeError({requestedAction: 'fix', targetFilePath: '/render.ts', content: patch('/render.ts')})).toBe('');
    expect(fileActionScopeError({requestedAction: 'fix', targetFilePath: '/render.ts', content: patch('/render.ts') + '\n' + patch('/index.ts')})).toContain('outside /render.ts');
    expect(fileActionScopeError({requestedAction: 'edit', targetFilePath: '/render.ts', content: '### File: /index.ts\n```ts\nexport {};\n```'})).toContain('outside /render.ts');
    expect(fileActionScopeError({requestedAction: 'smart', targetFilePath: '/render.ts', content: patch('/index.ts')})).toBe('');
});

test('prose remains an answer and multiple unmarked implementations require clarification', () => {
    expect(codingResponseKind('No changes proposed: supply the failing diagnostic.')).toBe('answer');
    expect(codingResponseKind('```ts\nexport const x = 1;\n```')).toBe('changes');
    expect(codingResponseKind('```ts\nexport const x = 1;\n```\nOr:\n```ts\nexport const x = 2;\n```')).toBe('ambiguous');
    expect(codingResponseKind('```ts\n// SOLUTION READY TO APPLY\nexport const x = 1;\n```\nReference:\n```ts\nexample();\n```')).toBe('changes');
});
