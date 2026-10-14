import {isUnfencedWorkspaceModule} from '../../src/utils/plugins/validation/unfencedWorkspaceSource';
import {generateStagedWorkspace, parseWorkspaceManifest, validateWorkspaceFile} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
const path = '/features/tools/types.ts';
const source = '// Shared tool contracts\nexport type ToolId = "json" | "text";\nexport interface Tool { id: ToolId; label: string; }\n';

test('wraps the entire completed TypeScript module without changing source', () => {
    expect(isUnfencedWorkspaceModule(source, path)).toBe(true);
    const result = validateWorkspaceFile(source, path, {allowSourceFence: true});
    expect(result).toBe(`### File: ${path}\n\`\`\`typescript\n${source}\n\`\`\``);
});
test.each([
    'Here is the code:\n' + source,
    source + '\nDone',
    '```typescript\n' + source,
    source + '\n### File: /other.ts\nexport const other = 1;',
    'export interface Tool {',
    '// All done',
    'const nothing = true;',
    'export const value = ;',
    'x'.repeat(48001),
])('does not recognize prose, partial responses or ambiguous modules', text => {
    expect(isUnfencedWorkspaceModule(text, path)).toBe(false);
});
test.each(['/styles.css', '/SKILL.md', '/data.json'])('does not infer raw source for %s', otherPath => {
    expect(isUnfencedWorkspaceModule(source, otherPath)).toBe(false);
});
test('raw TypeScript does not bypass explicit JSON transport', () => {
    expect(() => validateWorkspaceFile(source, path)).toThrow();
});
test('accepts an unfenced file without retrying its format', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Shared types'}]}))
        .mockResolvedValueOnce(source);
    const validateFile = jest.fn(() => []);
    const completed = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build', request, streamFiles: true, validateFile, onFileCompleted: completed});
    expect(result).toContain(source);
    expect(request).toHaveBeenCalledTimes(2);
    expect(validateFile).toHaveBeenCalledWith({path, content: source});
    expect(completed).toHaveBeenCalledTimes(1);
});
test('an unfenced module still fails source validation without completing the file', async () => {
    const request = jest.fn(async options => options.planStage
        ? JSON.stringify({files: [{path, contract: 'Shared types'}]}) : source);
    const completed = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Build', request, streamFiles: true,
        validateFile: () => [`${path}: SDK contract violation`], onFileCompleted: completed})).rejects.toThrow('SDK contract violation');
    expect(completed).not.toHaveBeenCalled();
    expect(request.mock.calls[2][0].prompt).toContain('SDK contract violation');
});

test('reports malformed unfenced module syntax instead of only requesting fences', () => {
    expect(() => validateWorkspaceFile('import {DOM} from "@anikitenko/fdo-sdk";\nexport const value = ;', '/index.ts', {allowSourceFence: true}))
        .toThrow(/unfenced module also has a syntax error:.*\(2:21\)/);
    expect(() => validateWorkspaceFile('Here is your implementation:', '/index.ts', {allowSourceFence: true}))
        .not.toThrow(/unfenced module also has a syntax error/);
});

test('format repair receives syntax evidence and still validates the corrected module', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/index.ts', contract: 'Entry module'}]}))
        .mockResolvedValueOnce('export const value = ;')
        .mockResolvedValueOnce('export const value = 1;');
    const validateFile = jest.fn(() => []);
    await generateStagedWorkspace({prompt: 'Build', request, streamFiles: true, validateFile});
    expect(request.mock.calls[2][0].prompt).toContain('unfenced module also has a syntax error');
    expect(validateFile).toHaveBeenCalledWith({path: '/index.ts', content: 'export const value = 1;'});
});

const pseudoRead = 'Let me first inspect the workspace.\n<tool_call>Read\n<argkey>filepath</arg_key>\n<arg_value>/features/tools/types.ts</arg_value>\n</tool_call>';
test('textual tool requests are diagnosed without treating them as executable tools', () => {
    expect(() => validateWorkspaceFile(pseudoRead, path, {allowSourceFence: true})).toThrow('does not expose Read, filesystem, or other tools');
});
test('a textual tool request receives one format correction with the actual rejection', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Shared types'}]}))
        .mockResolvedValueOnce(pseudoRead).mockResolvedValueOnce(source);
    const result = await generateStagedWorkspace({prompt: 'Build', request, streamFiles: true});
    expect(result).toContain(source);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].prompt).toContain('XML tool-call text is not executed');
});
test('repeated textual tool requests cannot complete a file or create a tool loop', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Shared types'}]}))
        .mockResolvedValue(pseudoRead);
    const completed = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Build', request, streamFiles: true, onFileCompleted: completed}))
        .rejects.toThrow('textual <tool_call> requests');
    expect(request).toHaveBeenCalledTimes(3);
    expect(completed).not.toHaveBeenCalled();
});
test('tool-call strings inside valid source remain ordinary data', () => {
    const text = 'export const example = "<tool_call>Read</tool_call>";';
    expect(validateWorkspaceFile(text, path, {allowSourceFence: true})).toContain(text);
});

test.each([false, true])('classification-only replies get an implementation diagnostic (source=%s)', allowSourceFence => {
    expect(() => validateWorkspaceFile('User Safety: safe', path, {allowSourceFence})).toThrow('with no implementation');
});
test('classification-only output receives bounded repair without completing a file', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Shared types'}]}))
        .mockResolvedValue('User Safety: safe');
    const completed = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Build', request, streamFiles: true, onFileCompleted: completed}))
        .rejects.toMatchObject({code: 'AI_PROVIDER_CLASSIFICATION_ONLY',
            message: expect.stringContaining('choose an explicit model ID instead of the random router')});
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].prompt).toContain('not a classification task');
    expect(completed).not.toHaveBeenCalled();
});
test('classification wording in legitimate source is preserved', () => {
    const text = 'export const label = "User Safety: safe";';
    expect(validateWorkspaceFile(text, path, {allowSourceFence: true})).toContain(text);
});

test.each(['User Safety: safe Response Safety: safe', 'User Safety: safe\nResponse Safety: safe'])('detects combined safety classifications without accepting a file: %s', text => {
    expect(() => validateWorkspaceFile(text, path)).toThrow('with no implementation');
    expect(() => parseWorkspaceManifest(text)).toThrow('with no workspace file plan');
});

test('classification-only plans get one corrective attempt and a model-selection diagnostic', async () => {
    const request = jest.fn().mockResolvedValue('User Safety: safe Response Safety: safe');
    const completed = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Build a JSON inspector', request, onFileCompleted: completed}))
        .rejects.toMatchObject({code: 'AI_PROVIDER_CLASSIFICATION_ONLY', message: expect.stringContaining('Select a coding-capable model')});
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].prompt).toContain('Do not return User Safety or Response Safety labels');
    expect(completed).not.toHaveBeenCalled();
});
