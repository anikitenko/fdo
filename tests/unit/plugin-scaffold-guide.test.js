import {ensurePluginScaffoldGuide, reviewPluginScaffoldGuide} from '../../src/utils/plugins/authoring/pluginScaffoldGuide';
import {parseAiWorkspacePlanResponse} from '../../src/components/editor/utils/aiCodingAgentPlanResponse';

const section = (path, content, language = 'typescript') => `### File: ${path}\n\`\`\`${language}\n${content}\n\`\`\``;
const scaffold = section('/index.ts', 'export const plugin = 42;');
const guide = section('/SKILL.md', '# Plugin guide\n\nThis plugin exposes plugin. Test its public behavior.', 'markdown');

test('recovers only the missing guide and retains generated implementation source', async () => {
    const request = jest.fn(async () => guide);
    const onRecovery = jest.fn();
    const result = await ensurePluginScaffoldGuide({content: scaffold, request, onRecovery});
    const files = parseAiWorkspacePlanResponse(result).files;
    expect(files.map(file => file.path)).toEqual(['/index.ts', '/SKILL.md']);
    expect(files[0].content).toBe(parseAiWorkspacePlanResponse(scaffold).files[0].content);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('export const plugin = 42;');
    expect(onRecovery).toHaveBeenCalledTimes(1);
});

test.each([
    {content: `${scaffold}\n\n${guide}`},
    {content: scaffold, workspaceFiles: [{path: '/SKILL.md', content: '# Existing guide\nPreserve my conventions.'}]},
    {content: scaffold, repairPaths: ['/index.ts']},
    {content: section('/render.tsx', 'export const render = () => "hello";')},
])('does not regenerate accepted or out-of-scope guidance: %j', async options => {
    const request = jest.fn();
    expect(await ensurePluginScaffoldGuide({...options, request})).toBe(options.content);
    expect(request).not.toHaveBeenCalled();
});

test.each([
    '',
    `${guide}\n\n${section('/index.ts', 'export const changed = true;')}`,
    section('/SKILL.md', 'No Markdown title', 'markdown'),
    section('/SKILL.md', '# Oversized\n' + 'x'.repeat(16000), 'markdown'),
])('rejects unsuccessful recovery without returning an incomplete scaffold', async recovered => {
    const request = jest.fn(async () => recovered);
    await expect(ensurePluginScaffoldGuide({content: scaffold, request})).rejects.toThrow('Guide recovery failed');
    expect(request).toHaveBeenCalledTimes(1);
});

test('replaces an empty generated guide rather than appending a duplicate', async () => {
    const result = await ensurePluginScaffoldGuide({content: `${scaffold}\n\n${section('/SKILL.md', '', 'markdown')}`, request: async () => guide});
    expect(parseAiWorkspacePlanResponse(result).files.filter(file => file.path === '/SKILL.md')).toHaveLength(1);
});

test('withholds the candidate until the guide is explicitly approved and includes human edits', async () => {
    let approve;
    const reviewSkill = jest.fn(() => new Promise(resolve => { approve = resolve; }));
    let finished = false;
    const pending = reviewPluginScaffoldGuide({content: `${scaffold}\n\n${guide}`, reviewSkill})
        .then(content => { finished = true; return content; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(reviewSkill).toHaveBeenCalledTimes(1);
    approve('# Human-reviewed guide\nKeep existing behavior.');
    const result = await pending;
    expect(result).toContain('# Human-reviewed guide');
    expect(parseAiWorkspacePlanResponse(result).files[0].content).toBe('export const plugin = 42;');
});

test('does not request a second approval for a staged or recovered guide already reviewed', async () => {
    const reviewSkill = jest.fn();
    const content = `${scaffold}\n\n${guide}`;
    const approvedGuideContent = parseAiWorkspacePlanResponse(guide).files[0].content + '\n';
    expect(await reviewPluginScaffoldGuide({content, approvedGuideContent, reviewSkill})).toBe(content);
    expect(reviewSkill).not.toHaveBeenCalled();
});
