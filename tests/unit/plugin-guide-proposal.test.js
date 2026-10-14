import {generateGuideProposal, validateGuideProposal, GUIDE_PATTERNS} from '../../src/utils/plugins/authoring/pluginGuideProposal';
import {readPluginAcceptanceCriteria} from '../../src/utils/plugins/authoring/pluginAcceptanceCriteria';
const prompt = 'Build a local JSON formatter and preserve favorites across reloads.';
const files = [{path: '/SKILL.md'}, {path: '/index.ts'}, {path: '/tools.test.ts'}];
const proposal = () => ({purpose: 'Local tools', modules: [{path: '/index.ts', responsibility: 'Entry point'}],
    conventions: ['Keep functions small.'], patterns: ['dom-text'], acceptance: [{id: 'format', description: 'Formats valid JSON',
        testFile: '/tools.test.ts', testName: 'formats JSON', requirement: 'local JSON formatter'}]});
const options = request => ({request, prompt, files, fingerprint: 'a'.repeat(64), validateSection: () => [], validateFile: () => [],
    assertActive: () => {}, assertBudget: () => {}, onStage: () => {}});
test('host owns Markdown, fingerprint and verified example code', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify(proposal()));
    const content = await generateGuideProposal(options(request));
    expect(content).toContain('fdo-sdk-fingerprint: ' + 'a'.repeat(64));
    expect(content).toContain(GUIDE_PATTERNS['dom-text']);
    expect(readPluginAcceptanceCriteria(content)).toEqual(proposal().acceptance);
    expect(request).toHaveBeenCalledTimes(1);
});
test('module repair identifies specific fields and supplies a planned-path schema', async () => {
    const invalid = proposal();
    invalid.modules = [{path: '/missing.ts', description: 'Wrong field'},
        {path: '/index.ts', responsibility: 'x'.repeat(801)}, {path: '/index.ts', responsibility: 'Duplicate'}];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(invalid))
        .mockResolvedValueOnce(JSON.stringify({modules: proposal().modules}));
    const content = await generateGuideProposal(options(request));
    const repair = request.mock.calls[1][0];
    expect(repair.responseSchema.required).toEqual(['modules']);
    expect(repair.responseSchema.properties.modules.items.properties.path.enum).toEqual(files.map(file => file.path));
    expect(repair.prompt).toContain('modules[0]: unexpected fields description');
    expect(repair.prompt).toContain('modules[0].path');
    expect(repair.prompt).toContain('modules[0].responsibility: expected a string');
    expect(repair.prompt).toContain('801 characters exceeds 800');
    expect(repair.prompt).toContain('is duplicated');
    expect(repair.prompt).toContain('objects with exactly path and responsibility');
    expect(content).toContain('- /index.ts: Entry point');
});
test('module line wrapping is normalized without spending a provider repair', async () => {
    const draft = proposal(); draft.modules[0].responsibility = 'Start the plugin.\n  Register handlers.';
    const request = jest.fn().mockResolvedValue(JSON.stringify(draft));
    expect(await generateGuideProposal(options(request))).toContain('- /index.ts: Start the plugin. Register handlers.');
    expect(request).toHaveBeenCalledTimes(1);
});
test('unchanged invalid module retry is explicit and manual retry receives precise repair instructions', async () => {
    const invalid = proposal(); invalid.modules[0].responsibility = '';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(invalid))
        .mockResolvedValueOnce(JSON.stringify({modules: invalid.modules}))
        .mockResolvedValueOnce(JSON.stringify({modules: proposal().modules}));
    const recover = jest.fn(async state => {
        expect(state.errors.modules).toContain('retry returned this section unchanged');
        expect(state.errors.modules).toContain('modules[0].responsibility: the string is empty');
        return {action: 'retry'};
    });
    expect(await generateGuideProposal({...options(request), recover})).toContain('- /index.ts: Entry point');
    expect(recover).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[2][0].responseSchema.required).toEqual(['modules']);
    expect(request.mock.calls[2][0].prompt).toContain('retry returned this section unchanged');
});
test('repairs only rejected sections and preserves accepted data', async () => {
    const invalid = proposal(); invalid.acceptance[0].requirement = 'invented requirement';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(invalid))
        .mockResolvedValueOnce(JSON.stringify({acceptance: proposal().acceptance}));
    const content = await generateGuideProposal(options(request));
    expect(content).toContain('Local tools');
    expect(request.mock.calls[1][0].responseSchema.required).toEqual(['acceptance']);
    expect(request.mock.calls[1][0].prompt).toContain('invented') /* error context contains no invalid content yet */;
});
test('unknown SDK patterns are never offered as verified templates', async () => {
    const p = proposal(); p.patterns = [];
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    const content = await generateGuideProposal({...options(request), validateSection: file => file.content.includes('~~~') ? ['unsupported'] : []});
    expect(content).not.toContain('import {DOMText}');
    expect(request.mock.calls[0][0].responseSchema.properties.patterns.maxItems).toBe(0);
});
test('classification-only replies stop automatic recovery and retain valid sections for manual retry', async () => {
    const invalid = proposal(); invalid.patterns = ['invented'];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce('User Safety: safe')
        .mockResolvedValueOnce(JSON.stringify({patterns: []}));
    const recover = jest.fn(async state => {
        expect(state.draft.purpose).toBe('Local tools');
        expect(Object.keys(state.errors)).toEqual(['patterns']);
        return {action: 'retry'};
    });
    await generateGuideProposal({...options(request), recover});
    expect(request).toHaveBeenCalledTimes(3);
    expect(recover).toHaveBeenCalledTimes(1);
});
test('manual edits are validated before use and still produce reviewable Markdown', async () => {
    const request = jest.fn().mockResolvedValue('no proposal');
    const recover = jest.fn(async ({validate}) => {
        expect(Object.keys(await validate({}))).toHaveLength(5);
        expect(await validate(proposal())).toEqual({});
        return {action: 'edit', draft: proposal()};
    });
    const content = await generateGuideProposal({...options(request), recover});
    expect(content).toContain('Formats valid JSON');
    expect(request).toHaveBeenCalledTimes(2);
});
test('malformed acceptance, unknown paths, document injection and changed accepted sections fail', async () => {
    const p = proposal(); p.purpose = '<!-- fdo-acceptance -->'; p.acceptance[0].testFile = '/unknown.test.ts';
    const errors = await validateGuideProposal(p, {prompt, paths: files.map(f => f.path), patterns: ['dom-text']});
    expect(Object.keys(errors)).toEqual(['purpose', 'acceptance']);
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(p)).mockResolvedValueOnce(JSON.stringify(proposal()));
    await expect(generateGuideProposal(options(request))).rejects.toThrow('needs review');
});
test.each(['budget', 'cancel', 'provider'])('does not reinterpret %s failures as invalid proposals', async kind => {
    const request = jest.fn().mockRejectedValue(new Error('provider'));
    const opts = options(request);
    if (kind === 'budget') opts.assertBudget = () => { throw new Error('budget'); };
    if (kind === 'cancel') opts.assertActive = () => { throw new Error('cancel'); };
    await expect(generateGuideProposal(opts)).rejects.toThrow(kind);
    expect(request).toHaveBeenCalledTimes(kind === 'provider' ? 1 : 0);
});

test('structured staged guide must pass review before implementation requests', async () => {
    const {generateStagedWorkspace} = require('../../src/utils/ai/generation/codingWorkspaceGeneration');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: files.map(file => ({...file, contract: 'Required module'}))}))
        .mockResolvedValueOnce(JSON.stringify(proposal()));
    const reviewSkill = jest.fn(async () => { throw new Error('Approval declined'); });
    await expect(generateStagedWorkspace({prompt, request, sdkFingerprint: 'a'.repeat(64),
        guideProposalOptions: {validateSection: () => []}, reviewSkill})).rejects.toThrow('Approval declined');
    expect(request).toHaveBeenCalledTimes(2);
    expect(reviewSkill.mock.calls[0][0].content).toContain('## Verified SDK examples');
});

test('offered template validates against the installed SDK contract', () => {
    const {validatePluginWorkspaceSdkContract} = require('../../src/utils/sdk/pluginWorkspaceSdkContract');
    const sdk = require('@anikitenko/fdo-sdk');
    for (const content of Object.values(GUIDE_PATTERNS)) {
        expect(validatePluginWorkspaceSdkContract({'/example.ts': content}, {runtimeExports: Object.keys(sdk)})).toEqual([]);
    }
});

test('acceptance quotes cannot be sourced from SDK/task context outside user requirements', async () => {
    const p = proposal(); p.acceptance[0].requirement = 'Use installed SDK contracts';
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    await expect(generateGuideProposal({...options(request), prompt: prompt + '\nUse installed SDK contracts', requirements: prompt}))
        .rejects.toThrow('needs review');
});

test('relative paths matching the approved inventory are canonicalized without another request', async () => {
    const p = proposal(); p.modules[0].path = 'index.ts'; p.acceptance[0].testFile = 'tools.test.ts';
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    const content = await generateGuideProposal(options(request));
    expect(content).toContain('- /index.ts:');
    expect(readPluginAcceptanceCriteria(content)[0].testFile).toBe('/tools.test.ts');
    expect(request).toHaveBeenCalledTimes(1);
});
test.each(['../index.ts', './index.ts', 'missing.ts', 'Index.ts'])('path normalization cannot guess an unapproved path: %s', async path => {
    const p = proposal(); p.modules[0].path = path;
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(p)).mockResolvedValueOnce(JSON.stringify({modules: p.modules}));
    await expect(generateGuideProposal(options(request))).rejects.toThrow('needs review');
});

test('acceptance quote repairs identify the exact bad field and offer unchanged source wording', async () => {
    const requirements = 'Give it a clearly labelled editor, a useful empty state, feedback while inspecting, and an easy-to-read result area.';
    const invalid = proposal();
    invalid.acceptance[0].requirement = 'Give it a useful empty state';
    invalid.acceptance[0].testFile = '/missing.test.ts';
    const errors = await validateGuideProposal(invalid, {prompt: requirements, paths: files.map(f => f.path), patterns: ['dom-text']});
    expect(errors.acceptance).toContain('acceptance[0].testFile "/missing.test.ts" is not planned');
    expect(errors.acceptance).toContain('/tools.test.ts');
    expect(errors.acceptance).toContain('acceptance[0].requirement "Give it a useful empty state" is not an exact substring');
    expect(errors.acceptance).toContain(JSON.stringify(requirements));
    expect(invalid.acceptance[0].requirement).toBe('Give it a useful empty state');
    const corrected = {...invalid.acceptance[0], testFile: '/tools.test.ts', requirement: 'a useful empty state'};
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(invalid))
        .mockResolvedValueOnce(JSON.stringify({acceptance: [corrected]}));
    const result = await generateGuideProposal({...options(request), prompt: requirements});
    expect(request.mock.calls[1][0].prompt).toContain('not an exact substring');
    expect(request.mock.calls[1][0].responseSchema.required).toEqual(['acceptance']);
    expect(readPluginAcceptanceCriteria(result)[0].requirement).toBe('a useful empty state');
    expect(request).toHaveBeenCalledTimes(2);
});

test.each([null, {}, {id: 'bad', description: 'bad', testFile: '/tools.test.ts', testName: 'bad', requirement: 42}])('malformed acceptance items produce diagnostics without crashing: %p', async item => {
    const p = proposal(); p.acceptance = [item];
    const errors = await validateGuideProposal(p, {prompt, paths: files.map(f => f.path), patterns: ['dom-text']});
    expect(errors.acceptance).toBeTruthy();
});

test('guide output recovery preserves accepted sections and retries only the unfinished section', async () => {
    const invalid = proposal(); invalid.acceptance[0].requirement = 'invented requirement';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(invalid))
        .mockRejectedValueOnce(Object.assign(new Error('max_output_tokens'), {reasoningOnly: true}))
        .mockResolvedValueOnce(JSON.stringify({acceptance: proposal().acceptance}));
    const content = await generateGuideProposal(options(request));
    expect(content).toContain('Local tools');
    expect(request.mock.calls.map(([value]) => value.maxOutputTokens)).toEqual([4096, 4096, 8192]);
    expect(request.mock.calls[2][0].responseSchema.required).toEqual(['acceptance']);
    expect(request.mock.calls[2][0].prompt).toContain('exhausted its budget on reasoning');
    expect(request.mock.calls[2][0].prompt).toContain('Accepted sections:\n{"purpose":"Local tools"');
});

test.each([true, false])('repeated guide output failure is bounded and does not restart the outer guide (reasoning=%s)', async reasoningOnly => {
    const {generateStagedWorkspace} = require('../../src/utils/ai/generation/codingWorkspaceGeneration');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: files.map(file => ({...file, contract: 'Required module'}))}))
        .mockRejectedValue(Object.assign(new Error('max_output_tokens'), {reasoningOnly}));
    await expect(generateStagedWorkspace({prompt, request, sdkFingerprint: 'a'.repeat(64),
        guideProposalOptions: {validateSection: () => []}})).rejects.toMatchObject({
        code: 'GUIDE_PROPOSAL_OUTPUT_LIMIT', message: expect.stringContaining(reasoningOnly ? 'budget on reasoning' : 'one section retry'),
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].maxOutputTokens).toBe(reasoningOnly ? 8192 : 4096);
});

test('proposal schema offers exact host-owned quotes instead of asking the model to reconstruct them', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify(proposal()));
    await generateGuideProposal(options(request));
    const wire = request.mock.calls[0][0];
    const quotes = wire.responseSchema.properties.acceptance.items.properties.requirement.enum;
    expect(quotes).toEqual([prompt]);
    expect(wire.prompt).toContain(JSON.stringify(quotes));
    expect(wire.prompt).toContain('put test steps and paraphrases in description');
    expect(wire.prompt).toContain('Do not add features');
});

test('source quote choices preserve exact text and bound long sentences', () => {
    const {guideRequirementQuotes} = require('../../src/utils/plugins/authoring/pluginGuideProposal');
    const source = 'Give it a useful empty state.\nRespect reduced-motion preferences! ' + 'long requirement '.repeat(100);
    const quotes = guideRequirementQuotes(source);
    expect(quotes).toContain('Give it a useful empty state.');
    expect(quotes).toContain('Respect reduced-motion preferences!');
    for (const quote of quotes) {
        expect(source).toContain(quote);
        expect(quote.length).toBeGreaterThanOrEqual(12);
        expect(quote.length).toBeLessThanOrEqual(800);
    }
});

test('convention diagnostics identify invalid structure without enforcing a bullet count', async () => {
    const p = proposal(); p.conventions = Array(25).fill('Keep things local.'); p.conventions[4] = 'two\nlines';
    const errors = await validateGuideProposal(p, {prompt, paths: files.map(f => f.path), patterns: ['dom-text']});
    expect(errors.conventions).not.toContain('has 25 items');
    expect(errors.conventions).toContain('conventions[4]');
    expect(errors.conventions).not.toContain('Planned paths');
});

test('guide schema limits testFile to planned test modules and quotes only original requirements', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify(proposal()));
    await generateGuideProposal({...options(request), requirements: prompt,
        prompt: 'EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\n' + prompt,
        files: [...files, {path: '/render.tsx'}, {path: '/styles.css'}, {path: '/tests/ui.spec.tsx'}]});
    const wire = request.mock.calls[0][0];
    expect(wire.responseSchema.properties.acceptance.items.properties.testFile.enum)
        .toEqual(['/tools.test.ts', '/tests/ui.spec.tsx']);
    expect(wire.responseSchema.properties.acceptance.items.properties.requirement.enum).toEqual([prompt]);
    expect(wire.prompt).toContain('Allowed testFile values');
});


test('a product brief over 800 characters and 14 conventions fit without a repair', async () => {
    const p = proposal(); p.purpose = 'A readable product requirement. '.repeat(30).trim();
    p.conventions = Array.from({length: 14}, (_, i) => `Convention ${i + 1}: keep behavior testable.`);
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    const result = await generateGuideProposal(options(request));
    expect(result).toContain(p.purpose);
    for (const convention of p.conventions) expect(result).toContain(convention);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].responseSchema.properties.purpose.maxLength).toBe(16000);
    expect(request.mock.calls[0][0].responseSchema.properties.conventions.maxItems).toBeUndefined();
});

test('the total guide cap still rejects oversized combinations of individually valid sections', async () => {
    const p = proposal(); p.conventions = Array.from({length: 24}, (_, i) => `${i}: ` + 'x'.repeat(790));
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    await expect(generateGuideProposal(options(request))).rejects.toThrow('Guide exceeds 16000 characters');
    expect(request).toHaveBeenCalledTimes(2);
});

test('purpose length failures report their actual size and preserve the injection checks', async () => {
    const p = proposal(); p.purpose = 'x'.repeat(16001);
    const context = {prompt, paths: files.map(f => f.path), patterns: ['dom-text']};
    expect((await validateGuideProposal(p, context)).purpose).toContain('received 16001 characters');
    p.purpose = '<!-- invalid -->';
    expect((await validateGuideProposal(p, context)).purpose).toContain('without code fences or HTML comments');
});


test('long conventions and many short bullets preserve content under the total guide budget', async () => {
    const p = proposal();
    p.conventions = ['a'.repeat(1118), 'b'.repeat(871), 'c'.repeat(1141), ...Array.from({length: 25}, (_, i) => `Keep rule ${i}.`)];
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    const guide = await generateGuideProposal(options(request));
    expect(guide.length).toBeLessThan(16000);
    for (const rule of p.conventions) expect(guide).toContain(rule);
    expect(request).toHaveBeenCalledTimes(1);
});

test('convention rejection identifies copied transport markers without implying a length failure', async () => {
    const p = proposal(); p.conventions = ['x'.repeat(2800) + ' Return ### File: /file.ts ```ts ...code... ```'];
    const errors = await validateGuideProposal(p, {prompt, paths: files.map(f => f.path), patterns: ['dom-text']});
    expect(errors.conventions).toContain('forbidden document/transport marker "```"');
    expect(errors.conventions).not.toContain('characters exceeds');
});

test('staged guide generation uses original requirements and excludes host execution transport', async () => {
    const {generateStagedWorkspace} = require('../../src/utils/ai/generation/codingWorkspaceGeneration');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: files.map(file => ({...file, contract: 'Required module'}))}))
        .mockResolvedValueOnce(JSON.stringify(proposal()));
    const reviewSkill = jest.fn(async () => { throw new Error('stop after guide'); });
    await expect(generateStagedWorkspace({prompt: 'EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\n### File: /path/to/file\n```ts\n' + prompt,
        request, sdkFingerprint: 'a'.repeat(64), reviewSkill,
        guideProposalOptions: {requirements: prompt, validateSection: () => []}})).rejects.toThrow('stop after guide');
    const guidePrompt = request.mock.calls[1][0].prompt;
    expect(guidePrompt).toContain(prompt);
    expect(guidePrompt).not.toContain('EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION');
    expect(guidePrompt).not.toContain('### File: /path/to/file');
    expect(guidePrompt).toContain('Do not copy host execution instructions');
});

test('wrapped convention prose is normalized without an AI retry or lost words', async () => {
    const p = proposal(); p.conventions = ['Keep logic local.\n  Return useful errors.\r\n\r\nTest the interactions.'];
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    const content = await generateGuideProposal(options(request));
    expect(content).toContain('- Keep logic local. Return useful errors. Test the interactions.');
    expect(request).toHaveBeenCalledTimes(1);
    expect(p.conventions[0]).toContain('\n');
});

test('prose normalization does not hide forbidden convention markers', async () => {
    const p = proposal(); p.conventions = ['Keep code local.\n```ts\nexport const x = 1;\n```'];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify(p))
        .mockResolvedValue(JSON.stringify({conventions: p.conventions}));
    await expect(generateGuideProposal(options(request))).rejects.toThrow('forbidden document/transport marker');
    expect(request).toHaveBeenCalledTimes(2);
});

test('every verified offered pattern may be selected without a stale two-pattern limit', async () => {
    const p = proposal(); p.patterns = Object.keys(GUIDE_PATTERNS);
    const request = jest.fn().mockResolvedValue(JSON.stringify(p));
    const content = await generateGuideProposal(options(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].responseSchema.properties.patterns.maxItems).toBe(p.patterns.length);
    for (const id of p.patterns) expect(content).toContain(GUIDE_PATTERNS[id]);
});

test.each([[['dom-text', 'dom-text']], [['invented']]])('pattern diagnostics name invalid IDs or duplicates: %p', async selected => {
    const p = proposal(); p.patterns = selected;
    const errors = await validateGuideProposal(p, {prompt, paths: files.map(f => f.path), patterns: Object.keys(GUIDE_PATTERNS)});
    expect(errors.patterns).toContain(selected[0] === 'invented' ? 'Unknown pattern IDs' : 'only once');
    expect(errors.patterns).not.toContain('Prose');
    expect(errors.patterns).not.toContain('Planned paths');
});
