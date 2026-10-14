import {generateStagedWorkspace, validateWorkspaceFile} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
import {readPluginAcceptanceCriteria} from '../../src/utils/plugins/authoring/pluginAcceptanceCriteria';
const criteria = [{id: 'works', description: 'Works', testFile: '/tests/works.test.ts', testName: 'works'}];
const guide = '# Plugin guide\n\n```typescript\nexport const label = "hello";\n```\n\n<!-- fdo-acceptance -->\n```json\n' + JSON.stringify(criteria) + '\n```';
const validate = text => validateWorkspaceFile(text, '/SKILL.md', {allowSourceFence: true});
test.each(['raw', 'long fence', 'legacy nested fence', 'json'])("accepts a complete %s guide without discarding examples", transport => {
    const text = transport === 'raw' ? guide : transport === 'json' ? JSON.stringify({path: '/SKILL.md', content: guide})
        : transport === 'long fence' ? '````markdown\n' + guide + '\n````' : '```markdown\n' + guide + '\n```';
    const result = validate(text);
    expect(result).toContain('~~~typescript\nexport const label = "hello";\n~~~');
    expect(readPluginAcceptanceCriteria(result)).toEqual(criteria);
    expect(result.match(/^```/gm)).toHaveLength(2);
});
test.each([
    guide + '\n```typescript\nexport {};',
    '````markdown\n' + guide,
    guide + '\n### File: /index.ts\n```ts\nexport {};\n```',
    'Here is a guide:\n' + guide,
])('rejects incomplete or ambiguous guide replies', text => {
    expect(() => validate(text)).toThrow();
});
test('does not relax source file transport', () => {
    expect(() => validateWorkspaceFile(guide, '/index.ts', {allowSourceFence: true})).toThrow();
});


test.each([true, false])('decoded guides still pass validation and approval before completion (approved=%s)', async approved => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/SKILL.md', contract: 'Plugin guide'}]}))
        .mockResolvedValueOnce(guide);
    const validateFile = jest.fn(() => []);
    const reviewSkill = jest.fn(async file => {
        if (!approved) throw new Error('Guide approval declined');
        return file.content;
    });
    const onFileCompleted = jest.fn();
    const result = generateStagedWorkspace({prompt: 'Build', request, streamFiles: true, validateFile, reviewSkill, onFileCompleted});
    if (approved) {
        expect(await result).toContain('~~~typescript');
        expect(onFileCompleted).toHaveBeenCalledTimes(1);
    } else {
        await expect(result).rejects.toThrow('Guide approval declined');
        expect(onFileCompleted).not.toHaveBeenCalled();
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(validateFile).toHaveBeenCalled();
    expect(reviewSkill).toHaveBeenCalledWith({path: '/SKILL.md', content: expect.stringContaining('~~~json')});
});

test('Markdown recognition does not depend on acceptance content', () => {
    const incompleteGuide = '# Plugin guide\n\n## Purpose\nBuild the requested workbench.\n';
    expect(validate(incompleteGuide)).toContain(incompleteGuide);
    expect(readPluginAcceptanceCriteria(incompleteGuide)).toEqual([]);
});

test('non-Markdown guide responses get guide-specific format instructions', () => {
    expect(() => validate('I will write a guide.')).toThrow('Return one complete Markdown guide starting with a # title');
    expect(() => validate('# Guide\n~~~json\n[]')).toThrow('Unclosed Markdown code fence');
});

test('missing guide criteria reach content validation and cannot be silently approved', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}]}))
        .mockResolvedValue('# Plugin guide\nPurpose: workbench.');
    const reviewSkill = jest.fn();
    const validateFile = jest.fn(() => ['/SKILL.md: Include the fdo-acceptance JSON block.']);
    await expect(generateStagedWorkspace({prompt: 'Build', request, streamFiles: true, validateFile, reviewSkill}))
        .rejects.toThrow('Include the fdo-acceptance JSON block');
    expect(validateFile).toHaveBeenCalled();
    expect(reviewSkill).not.toHaveBeenCalled();
    expect(request.mock.calls[2][0].prompt).toContain('Include the fdo-acceptance JSON block');
});

test.each(['raw', 'wrapped', 'envelope'])('README examples are document content, not multiple files (%s)', mode => {
    const document = '# JSON Inspector\n\n## Usage\n```json\n{"enabled":true}\n```\n\n## Tests\n```sh\nnode --test\n```';
    const response = mode === 'wrapped' ? '````markdown\n' + document + '\n````'
        : mode === 'envelope' ? JSON.stringify({path: '/README.md', content: document}) : document;
    const result = validateWorkspaceFile(response, '/README.md', {allowSourceFence: true});
    expect(result).toContain('~~~json\n{"enabled":true}\n~~~');
    expect(result).toContain('~~~sh\nnode --test\n~~~');
    expect(result.match(/^```/gm)).toHaveLength(2);
});
test.each([
    '# README\n```sh\nnode --test',
    '# README\n\n### File: /other.md\n# Other\n',
    '### File: /other.md\n# README\n',
])('README transport rejects incomplete fences and other file sections', text => {
    expect(() => validateWorkspaceFile(text, '/README.md', {allowSourceFence: true})).toThrow();
});
