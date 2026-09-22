import {workspaceFileSchema, WORKSPACE_MANIFEST_SCHEMA, generateStagedWorkspace, parseWorkspaceManifest, useStagedWorkspaceGeneration, validateWorkspaceFile} from '../../src/utils/codingWorkspaceGeneration';

const manifest = JSON.stringify({files: [
    {path: '/render.ts', contract: 'Export render(): string'},
    {path: '/index.ts', contract: 'Import render from ./render and use it in the plugin'},
]});
const file = (path, content = 'export {};') => `### File: ${path}\n\`\`\`typescript\n${content}\n\`\`\``;
const recordedInvalidManifest = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../fixtures/ai/workspace-manifest-unescaped-quotes.txt'), 'utf8');
const oversizedManifest = JSON.stringify(require('../fixtures/ai/workspace-manifest-oversized-contract.json'));
const flattenedEntry = require('../fixtures/ai/workspace-file-flattened-entry.json');
const providerTimeout = () => Object.assign(new Error('408 Request timeout'), {status: 408});

const brokenStringSource = 'export const id = "category";\nexport const label = "Unterminated;\nexport const ready = true;';
const fixedStringSource = brokenStringSource.replace('"Unterminated;', '"Unterminated";');

test('corrects only known split CSS helper references before validation without spending a repair request', async () => {
    const root = {path: '/styles/features.css', contract: 'Category, library and personal styles'};
    const helpers = ['workspace', 'library', 'personal-space'].map(name => ({path: `/styles/features/${name}.css`, contract: `${name} styles`}));
    const content = '@import "./workspace.css";\n@import "./library.css";\n@import "./personal-space.css";\n.result { color: green; }';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [root]}))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(JSON.stringify({files: helpers}));
    for (const helper of helpers) request.mockResolvedValueOnce(file(helper.path, '.panel { color: green; }'));
    request.mockResolvedValueOnce(file(root.path, content));
    const onValidation = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build styles', request, workspaceFiles: [], onValidation});
    expect(result).toContain('@import "./features/workspace.css";');
    expect(result).toContain('@import "./features/library.css";');
    expect(result).toContain('@import "./features/personal-space.css";\n.result { color: green; }');
    expect(request).toHaveBeenCalledTimes(7);
    expect(onValidation).not.toHaveBeenCalled();
    expect(request.mock.calls.at(-1)[0].prompt).toContain('@import "./features/workspace.css";');
});

test('uses planned image relevance across file generation and repair without removing written requirements', async () => {
    const files = [
        {path: '/logic.ts', contract: 'Export run', visualReference: false},
        {path: '/render.ts', contract: 'Render the reference', visualReference: true},
        {path: '/legacy.ts', contract: 'Legacy plan without relevance'},
    ];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files}))
        .mockResolvedValueOnce(file('/logic.ts', 'export const run = ;'))
        .mockResolvedValueOnce(file('/logic.ts', 'export const run = 42;'))
        .mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/legacy.ts'));
    await generateStagedWorkspace({prompt: 'Keep all written acceptance criteria.', request});
    expect(request.mock.calls.slice(1).map(([options]) => options.includeImage)).toEqual([false, false, true, true]);
    for (const [options] of request.mock.calls) expect(options.prompt).toContain('Keep all written acceptance criteria.');
    expect(() => parseWorkspaceManifest(JSON.stringify({files: [{...files[0], visualReference: 'false'}]}))).toThrow('must be a boolean');
});

test('repairs imports within a staged file and keeps completed modules without replanning', async () => {
    const files = [{path: '/logic.ts', contract: 'Export run'}, {path: '/render.tsx', contract: 'Export render'}];
    const dependency = file('/logic.ts', 'export const run = () => "ok";');
    const bad = 'import {render} from "./render"; import {missing} from "./logic"; export const view = missing;';
    const good = 'import {run} from "./logic"; export const render = run;';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files})).mockResolvedValueOnce(dependency)
        .mockResolvedValueOnce(file('/render.tsx', bad)).mockResolvedValueOnce(file('/render.tsx', good));
    const result = await generateStagedWorkspace({prompt: 'Build workspace', request, workspaceFiles: []});
    expect(result).toBe(`${dependency}\n\n${file('/render.tsx', good)}`);
    expect(request).toHaveBeenCalledTimes(4);
    const repair = request.mock.calls[3][0].prompt;
    expect(repair).toContain('resolves to this same file');
    expect(repair).toContain('does not export missing');
    expect(repair).toContain(`BEGIN REJECTED SOURCE\n${bad}`);
    expect(repair).toContain('This is not the plugin bootstrap');
});

test('allows pending dependencies and validates their exports when generated', async () => {
    const files = [{path: '/render.ts', contract: 'Render'}, {path: '/logic.ts', contract: 'Export run'}];
    const consumer = file('/render.ts', 'import {run} from "./logic"; export const render = run;');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files})).mockResolvedValueOnce(consumer)
        .mockResolvedValueOnce(file('/logic.ts', 'export const wrong = 1;'))
        .mockResolvedValueOnce(file('/logic.ts', 'export const run = () => "ok";'));
    await expect(generateStagedWorkspace({prompt: 'Build workspace', request, workspaceFiles: []})).resolves.toContain('export const run');
    expect(request.mock.calls[3][0].prompt).toContain('/logic.ts does not export run');
    expect(request.mock.calls[3][0].prompt).toContain('Generate ONLY /logic.ts');
});

test('uses the current workspace for repairs and rejects dependencies outside its plan', async () => {
    const workspaceFiles = [{path: '/logic.ts', content: 'export const run = () => "retained";'}];
    const files = [{path: '/render.ts', contract: 'Render'}];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files}))
        .mockResolvedValueOnce(file('/render.ts', 'import {run} from "./invented"; export const render = run;'))
        .mockResolvedValueOnce(file('/render.ts', 'import {run} from "./logic"; export const render = run;'));
    const result = await generateStagedWorkspace({prompt: 'Repair renderer', request, workspaceFiles});
    expect(result.match(/### File:/g)).toHaveLength(1);
    expect(request.mock.calls[2][0].prompt).toContain('has no file in the workspace or approved plan');
    expect(request.mock.calls[2][0].prompt).toContain(workspaceFiles[0].content);
});

test.each(['complete', 'source repeats', 'format repeats', 'budget exhausted'])(
    'format repair does not consume source repair: %s', async outcome => {
        const path = '/features/categories/render.ts';
        const plan = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'}, {path, contract: 'Render category'}]});
        const dependency = file('/types.ts');
        const invalidSource = JSON.stringify({path, lines: brokenStringSource.split('\n')});
        const options = budgetedWorkspace(outcome === 'budget exhausted' ? 4 : 'auto', [plan, dependency,
            'Not a file envelope', invalidSource, outcome === 'source repeats' ? invalidSource
                : outcome === 'format repeats' ? 'Not a file envelope' : JSON.stringify({path, lines: fixedStringSource.split('\n')})]);
        const onValidation = jest.fn();
        const result = generateStagedWorkspace({...options, onValidation});
        if (outcome === 'complete') await expect(result).resolves.toBe(`${dependency}\n\n${file(path, fixedStringSource)}`);
        else await expect(result).rejects.toThrow(outcome === 'budget exhausted' ? '1 requests needed, 0 remaining' : `(${outcome.startsWith('source') ? 'source' : 'format'} validation)`);
        expect(options.request).toHaveBeenCalledTimes(outcome === 'budget exhausted' ? 4 : 5);
        expect(onValidation.mock.calls.slice(0, 2).map(([event]) => event)).toEqual([
            {path, kind: 'format', repairAvailable: true}, {path, kind: 'source', repairAvailable: true},
        ]);
        if (outcome !== 'budget exhausted') {
            const repair = options.request.mock.calls[4][0];
            expect(repair.prompt).toContain(`${path}:2:22: invalid source syntax: Unterminated string constant`);
            expect(repair.prompt).toContain('2 | export const label = "Unterminated;');
            expect(repair.prompt).toContain(`BEGIN REJECTED SOURCE\n${brokenStringSource}\nEND REJECTED SOURCE`);
            expect(repair.prompt).toContain(dependency);
            expect(repair.prompt).not.toContain('BEGIN REJECTED FILE RESPONSE');
            expect(repair.prompt).not.toContain('Not a file envelope');
        }
    });

function deepestStylesheetResponses() {
    return [JSON.stringify({files: [{path: '/styles.css', contract: 'Styles'}]}), outputLimit(),
        JSON.stringify({files: [{path: '/styles/components.css', contract: 'Component styles'}]}), outputLimit(), outputLimit(),
        JSON.stringify({files: [{path: '/styles/surfaces.css', contract: 'Surface styles'}]}), new Error('max_output_tokens')];
}

test('a deepest stylesheet gets one complete larger response before the split guard', async () => {
    const options = budgetedWorkspace('auto', [...deepestStylesheetResponses(),
        file('/styles/surfaces.css', '.surface { color: red; }'),
        file('/styles/components.css', '@import "./surfaces.css";'), file('/styles.css', '@import "./styles/components.css";')]);
    const onStage = jest.fn();
    const result = await generateStagedWorkspace({...options, onStage});
    expect(options.request.mock.calls.map(([call]) => call.maxOutputTokens)).toEqual([2048, 3072, 2048, 1536, 3072, 2048, 1024, 2048, 1024, 1536]);
    expect(options.request.mock.calls[7][0].prompt).toContain('must fit within 2048 output tokens');
    expect(result).toContain('.surface { color: red; }');
    expect(result.match(/### File:/g)).toHaveLength(3);
    expect(onStage.mock.calls.some(([stage]) => stage.label === 'Retrying complete file: /styles/surfaces.css (2048 output tokens)')).toBe(true);
});

test('a larger retry remains bounded and rejects another truncated response', async () => {
    const options = budgetedWorkspace('auto', [...deepestStylesheetResponses(), new Error('max_output_tokens')]);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('after bounded file splitting');
    expect(options.request).toHaveBeenCalledTimes(8);
});

test('an exhausted request budget prevents the larger file retry', async () => {
    const options = budgetedWorkspace(9, deepestStylesheetResponses());
    await expect(generateStagedWorkspace(options)).rejects.toThrow('3 requests needed, 2 remaining');
    expect(options.request).toHaveBeenCalledTimes(7);
});

test.each(['Cancelled', 'Deadline reached'])('larger response retry respects %s before sending a request', async message => {
    let stopped = false;
    const options = budgetedWorkspace('auto', deepestStylesheetResponses());
    await expect(generateStagedWorkspace({...options,
        onStage: stage => { if (stage.label.startsWith('Retrying complete file: /styles/surfaces.css')) stopped = true; },
        assertActive: () => { if (stopped) throw new Error(message); },
    })).rejects.toThrow(message);
    expect(options.request).toHaveBeenCalledTimes(7);
});

test('nested output-limit splits reduce the actual response allowance and preserve complete output', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/render.tsx', contract: 'Render UI'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/ui/categories.ts', contract: 'Render categories'}]}))
        .mockRejectedValueOnce(outputLimit()).mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/ui/category-runner.ts', contract: 'Run selected category'}]}))
        .mockResolvedValueOnce(file('/ui/category-runner.ts'))
        .mockResolvedValueOnce(file('/ui/categories.ts'))
        .mockResolvedValueOnce(file('/render.tsx'));
    const result = await generateStagedWorkspace({prompt: 'Build UI', request});
    expect(request.mock.calls.map(([call]) => call.maxOutputTokens)).toEqual([2048, 6144, 2048, 3072, 6144, 2048, 1536, 1536, 2048]);
    expect(request.mock.calls[5][0].prompt).toContain('Each new helper will have at most 1536 output tokens');
    expect(request.mock.calls[6][0]).toMatchObject({workspaceStep: '/ui/category-runner.ts'});
    expect(request.mock.calls[6][0].prompt).toContain('must fit within 1536 output tokens');
    expect(result).toBe(['/ui/category-runner.ts', '/ui/categories.ts', '/render.tsx'].map(path => file(path)).join('\n\n'));
});

test.each(['auto', '11'])('admits a renderer split after two independent feature splits using the remaining budget: %s', async limit => {
    const paths = ['/media.ts', '/social.ts', '/render.tsx'];
    const responses = [JSON.stringify({files: paths.map(path => ({path, contract: 'Export feature renderer'}))})];
    for (const [index, path] of paths.entries()) responses.push(outputLimit(),
        JSON.stringify({files: [{path: `/helpers/feature${index}.ts`, contract: 'Export focused helper'}]}),
        file(`/helpers/feature${index}.ts`), file(path));
    const options = budgetedWorkspace(limit, responses);
    if (limit === 'auto') {
        const result = await generateStagedWorkspace(options);
        expect(result.match(/### File:/g)).toHaveLength(6);
        expect(result).toContain('### File: /render.tsx');
        expect(options.request).toHaveBeenCalledTimes(13);
    } else {
        await expect(generateStagedWorkspace(options)).rejects.toThrow('3 requests needed, 1 remaining');
        expect(options.request).toHaveBeenCalledTimes(10); // No unaffordable split request.
    }
});

test('independent splitting still stops at the existing maximum of 36 workspace files', async () => {
    const paths = Array.from({length: 12}, (_, i) => `/feature${i}.ts`);
    const responses = [JSON.stringify({files: paths.map(path => ({path, contract: 'Feature'}))})];
    for (let group = 0; group < 2; group++) {
        const helpers = Array.from({length: 12}, (_, i) => ({path: `/helpers/g${group}h${i}.ts`, contract: 'Helper'}));
        responses.push(outputLimit(), JSON.stringify({files: helpers}), ...helpers.map(helper => file(helper.path)), file(paths[group]));
    }
    responses.push(outputLimit());
    const options = budgetedWorkspace('auto', responses);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('workspace safety limit of 36 files');
    expect(options.request).toHaveBeenCalledTimes(32);
});

test('later requests and split plans use compact interfaces but final output retains complete source', async () => {
    const source = `export interface Result { value: string }\nexport function transform(): Result {\n${'// Implementation detail kept only in the actual file\n'.repeat(90)}return {value: 'hello'};\n}`;
    const plan = JSON.stringify({files: [{path: '/logic.ts', contract: 'Export transform(): Result'},
        {path: '/render.ts', contract: 'Export renderer'}]});
    const request = jest.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(file('/logic.ts', source))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/helper.ts', contract: 'Render helper'}]}))
        .mockResolvedValueOnce(file('/helper.ts')).mockResolvedValueOnce(file('/render.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(result).toContain(file('/logic.ts', source));
    for (const [{prompt}] of request.mock.calls.slice(2)) {
        expect(prompt).toContain('export interface Result { value: string }');
        expect(prompt).toContain('export function transform(): Result');
        expect(prompt).not.toContain('Implementation detail kept only');
    }
});

test('decomposes an oversized file and retains completed dependencies', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce(file('/render.ts'))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/lifecycle.ts', contract: 'Export lifecycle helpers'}]}))
        .mockResolvedValueOnce(file('/lifecycle.ts')).mockResolvedValueOnce(file('/index.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(result).toBe(['/render.ts', '/lifecycle.ts', '/index.ts'].map(path => file(path)).join('\n\n'));
    expect(request.mock.calls[3][0].prompt).toContain('exceeded its file response budget');
    expect(request.mock.calls[3][0].prompt).toContain(file('/render.ts'));
    expect(request).toHaveBeenCalledTimes(6);
});

test('persistent planning timeout identifies its step without trying to split an unknown file', async () => {
    const request = jest.fn().mockRejectedValue(providerTimeout());
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('Workspace step "Planning workspace files" timed out');
    expect(request).toHaveBeenCalledTimes(1);
});

test('HTTP 408 changes file transport once and retains completed files and source repair context', async () => {
    const plan = JSON.stringify({files: [{path: '/ready.ts', contract: 'Ready'}, {path: '/shared/webseo.ts', contract: 'SEO'},
        {path: '/tail.ts', contract: 'Tail'}]});
    const request = jest.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(file('/ready.ts'))
        .mockResolvedValueOnce(file('/shared/webseo.ts', 'export const title = ;'))
        .mockRejectedValueOnce(providerTimeout())
        .mockResolvedValueOnce('```ts\nexport const title = "Ready";\n```')
        .mockResolvedValueOnce('```ts\nexport const tail = true;\n```');
    const stages = [];
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request, onStage: stage => stages.push(stage)});
    expect(result.match(/### File:/g)).toHaveLength(3);
    expect(request.mock.calls[3][0].responseSchema).toBeDefined();
    for (const [call] of request.mock.calls.slice(4)) {
        expect(call.bufferedResponse).toBe(false);
        expect(call.responseSchema).toBeUndefined();
    }
    expect(request.mock.calls[4][0].prompt).toContain('BEGIN REJECTED SOURCE\nexport const title = ;');
    expect(stages.some(stage => stage.label === 'Retrying file with streaming: /shared/webseo.ts')).toBe(true);
    expect(stages.some(stage => stage.label.startsWith('Splitting'))).toBe(false);
});

test('persistent HTTP 408 stops after the transport switch without splitting', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockRejectedValue(providerTimeout());
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('/render.ts timed out at the provider while streaming');
    expect(request).toHaveBeenCalledTimes(3);
});

test.each(['cancelled', 'deadline', 'budget'])('streaming recovery respects %s', async reason => {
    let stopped = false;
    const options = budgetedWorkspace(reason === 'budget' ? 3 : 'auto', [manifest, providerTimeout(), file('/render.ts')]);
    await expect(generateStagedWorkspace({...options,
        onStage: stage => { if (stage.label.startsWith('Retrying file with streaming')) stopped = true; },
        assertActive: () => { if (stopped && reason !== 'budget') throw new Error(reason); },
    })).rejects.toThrow(reason === 'budget' ? '2 requests needed, 1 remaining' : reason);
    expect(options.request).toHaveBeenCalledTimes(2);
});

test('streaming does not reset source repair limits', async () => {
    const broken = 'export const title = ;';
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce(file('/render.ts', broken))
        .mockRejectedValueOnce(providerTimeout()).mockResolvedValueOnce(`\`\`\`ts\n${broken}\n\`\`\``);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('after one repair of /render.ts');
    expect(request).toHaveBeenCalledTimes(4);
});

test('output-limited streaming files may still split, retaining streaming for new helpers', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockRejectedValueOnce(providerTimeout())
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/helper.ts', contract: 'Helper'}]}))
        .mockResolvedValueOnce('```ts\nexport {};\n```').mockResolvedValueOnce('```ts\nexport {};\n```')
        .mockResolvedValueOnce('```ts\nexport {};\n```');
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).resolves.toContain('### File: /helper.ts');
    expect(request.mock.calls[3][0].responseSchema.properties.files.maxItems).toBe(12);
    expect(request.mock.calls.slice(4).every(([call]) => call.bufferedResponse === false && !call.responseSchema)).toBe(true);
});

test.each([new Error('408 Request timeout'), Object.assign(new Error('Aborted'), {status: 408, errors: [{code: 3008}]})])(
    'never splits ambiguous timeouts or provider aborts', async error => {
        const request = jest.fn().mockResolvedValueOnce(manifest).mockRejectedValueOnce(error);
        await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toBe(error);
        expect(request).toHaveBeenCalledTimes(2);
    });
const missingCommaSource = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../fixtures/ai/workspace-render-missing-comma.ts'), 'utf8');

test('syntax repair receives the exact rejected module and preserves completed work', async () => {
    const path = '/features/personal/render.ts';
    const corrected = missingCommaSource.replace('class: "space-section"\n', 'class: "space-section",\n');
    const dependency = file('/types.ts');
    const tail = file('/index.ts');
    const plan = JSON.stringify({files: [
        {path: '/types.ts', contract: 'Shared types'}, {path, contract: 'Render personal space'},
        {path: '/index.ts', contract: 'Entry'},
    ]});
    const request = jest.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(dependency)
        .mockResolvedValueOnce(JSON.stringify({path, lines: missingCommaSource.split('\n')}))
        .mockImplementationOnce(async options => {
            expect(options.prompt).toContain(`${path}:6:5: invalid source syntax`);
            expect(options.prompt).toContain(`BEGIN REJECTED SOURCE\n${missingCommaSource}\nEND REJECTED SOURCE`);
            expect(options.prompt).toContain('Inspect the preceding lines too');
            expect(options.prompt).toContain(dependency);
            return JSON.stringify({path, lines: corrected.split('\n')});
        }).mockResolvedValueOnce(tail);
    const onStage = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build personal space', request, onStage});
    expect(result).toBe([dependency, file(path, corrected), tail].join('\n\n'));
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[4][0].prompt).not.toContain('BEGIN REJECTED SOURCE');
    expect(request.mock.calls[4][0].prompt).not.toContain(missingCommaSource);
    expect(onStage.mock.calls.every(([stage]) => !stage.content.includes(missingCommaSource))).toBe(true);
});

test.each([
    ['/styles.css', '.panel {', '.panel {}'],
    ['/data.json', '{"visible":}', '{"visible":true}'],
])('provides rejected source to the same bounded repair path for %s', async (path, invalid, valid) => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Feature data'}]}))
        .mockResolvedValueOnce(JSON.stringify({path, lines: [invalid]}))
        .mockResolvedValueOnce(JSON.stringify({path, lines: [valid]}));
    await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request.mock.calls[2][0].prompt).toContain(`BEGIN REJECTED SOURCE\n${invalid}\nEND REJECTED SOURCE`);
    expect(request).toHaveBeenCalledTimes(3);
});

test('recovers the recorded flattened entry using explicit physical source lines', async () => {
    const lines = ["import {FDO_SDK} from '@anikitenko/fdo-sdk';", '// Entry lifecycle',
        'class WebToolsWorkbenchPlugin extends FDO_SDK {}', '', 'new WebToolsWorkbenchPlugin();'];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/index.ts', contract: 'Start plugin'}]}))
        .mockResolvedValueOnce(JSON.stringify(flattenedEntry))
        .mockResolvedValueOnce(JSON.stringify({path: '/index.ts', lines}));
    const result = await generateStagedWorkspace({prompt: 'Repair entry', request});
    expect(result).toBe(file('/index.ts', lines.join('\n')));
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].prompt).toContain('no executable plugin class');
    expect(request.mock.calls[2][0].responseSchema.required).toEqual(['path', 'lines']);
});

test.each(['/features/text/logic.ts', '/render.tsx', '/actions.js', '/styles.css', '/tests/logic.test.ts', '/data.json'])(
    'line transport preserves exact source characters and boundaries for %s', path => {
        const lines = ['// Comments cannot swallow the next line', '', '  const pattern = /\\s+/;',
            '  const value = "Привіт 👋\\n";', 'const template = `hello ${value}`;', ''];
        const result = validateWorkspaceFile(JSON.stringify({path, lines}), path);
        expect(result).toContain(`\n${lines.join('\n')}\n\`\`\``);
    });

test.each([
    [{lines: []}, 'source lines'], [{lines: [null]}, 'source lines'],
    [{lines: ['a\nb']}, 'source lines'], [{lines: ['a\rb']}, 'source lines'],
    [{lines: ['']}, 'empty'], [{lines: Array(2001).fill('')}, 'source lines'],
    [{lines: ['x'.repeat(24000), 'y'.repeat(24000)]}, 'exceeds'],
    [{lines: ['```']}, 'code-fence'], [{lines: ['export {};'], content: 'ambiguous'}, 'Expected exactly'],
])('rejects invalid line payloads without inferring source %#', (data, reason) => {
    expect(() => validateWorkspaceFile(JSON.stringify({path: '/a.ts', ...data}), '/a.ts')).toThrow(reason);
});

test('native file schema requires bounded physical lines, including blank lines', () => {
    const validate = new (require('ajv'))().compile(workspaceFileSchema('/a.ts'));
    expect(validate({path: '/a.ts', lines: ['// comment', '', 'export {};']})).toBe(true);
    for (const value of [{path: '/a.ts', content: 'export {};'}, {path: '/b.ts', lines: ['export {};']},
        {path: '/a.ts', lines: ['a\nb']}, {path: '/a.ts', lines: []}]) expect(validate(value)).toBe(false);
});

test('repairs syntax and entry lifecycle locally without regenerating completed dependencies', async () => {
    const inventory = JSON.stringify({files: [
        {path: '/features/text/logic.ts', contract: 'Export upper(value: string): string'},
        {path: '/styles/panels.css', contract: 'Panel styles'},
        {path: '/index.ts', contract: 'Start the plugin'},
    ]});
    const logic = file('/features/text/logic.ts', 'export const upper = (value: string) => value.toUpperCase();');
    const css = file('/styles/panels.css', '.panel { display: grid; }');
    const entry = 'class Workbench extends FDO_SDK {}\nnew Workbench();';
    const request = jest.fn().mockResolvedValueOnce(inventory)
        .mockResolvedValueOnce(file('/features/text/logic.ts', 'export const upper = ('))
        .mockResolvedValueOnce(logic)
        .mockResolvedValueOnce(file('/styles/panels.css', '.panel {'))
        .mockResolvedValueOnce(css)
        .mockResolvedValueOnce(file('/index.ts', 'class Workbench extends FDO_SDK {}'))
        .mockResolvedValueOnce(file('/index.ts', entry));
    const onStage = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build a modular plugin', request, onStage});
    expect(result).toBe([logic, css, file('/index.ts', entry)].join('\n\n'));
    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls[2][0].prompt).toContain('/features/text/logic.ts:1:');
    expect(request.mock.calls[4][0].prompt).toContain('/styles/panels.css:1:');
    expect(request.mock.calls[6][0].prompt).toContain('new Workbench()');
    expect(request.mock.calls[6][0].prompt).toContain(logic);
    expect(request.mock.calls[6][0].prompt).toContain(css);
    expect(onStage.mock.calls.every(([stage]) => !stage.content.includes('export const upper = (\n'))).toBe(true);
});

test('rejects a flattened entry before accepting it as a completed file', async () => {
    const entry = "import {FDO_SDK} from '@anikitenko/fdo-sdk'; // entry: class Workbench extends FDO_SDK {} new Workbench();";
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/index.ts', contract: 'Start plugin'}]}))
        .mockResolvedValue(JSON.stringify({path: '/index.ts', content: entry}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('no executable plugin class');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].prompt).toContain('Preserve real newlines');
});

test('replans the recorded 3259-character contract without dropping files or increasing limits', async () => {
    const paths = JSON.parse(oversizedManifest).files.map(entry => entry.path);
    const compact = JSON.stringify({files: paths.map(path => ({path, contract: 'Preserve the original task and shared exports.'}))});
    const request = jest.fn().mockResolvedValueOnce(oversizedManifest).mockResolvedValueOnce(compact);
    for (const path of paths) request.mockResolvedValueOnce(file(path));
    const result = await generateStagedWorkspace({prompt: 'Keep every Workbench feature and test.', request});
    expect(result).toBe(paths.map(path => file(path)).join('\n\n'));
    expect(request).toHaveBeenCalledTimes(6);
    expect(request.mock.calls[0][0].prompt).toContain('maximum 240 characters');
    expect(request.mock.calls[1][0].prompt).toContain('at most 6000 characters');
    expect(request.mock.calls[1][0].maxOutputTokens).toBe(2048);
    for (const [options] of request.mock.calls) expect(options.prompt).toContain('Keep every Workbench feature and test.');
});

test('shares the single plan retry between syntax and schema failures', async () => {
    const request = jest.fn().mockResolvedValueOnce(recordedInvalidManifest).mockResolvedValueOnce(oversizedManifest);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('at most 6000 characters');
    expect(request).toHaveBeenCalledTimes(2);
});

test.each(['null', '{"files":[]}', '{"files":[{"path":"/a.ts"}]}',
    JSON.stringify({files: [{path: '/a.ts', contract: {exports: ['render']}}]}), ' '.repeat(16001)])(
    'bounds recovery for invalid plan shape or contract: %s', async text => {
        const request = jest.fn().mockResolvedValue(text);
        await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('after one retry');
        expect(request).toHaveBeenCalledTimes(2);
    });

test('checks all paths before retrying a contract error', async () => {
    const files = [{path: '/render.tsx', contract: 'x'.repeat(3259)}];
    files.push({path: '/../host.ts', contract: 'Unsafe'});
    const request = jest.fn().mockResolvedValue(JSON.stringify({files}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('invalid or duplicate path');
    expect(request).toHaveBeenCalledTimes(1);
});

test('replans once after the recorded unescaped quotes failure, then generates only the requested file', async () => {
    const path = '/render.test.ts';
    const request = jest.fn().mockResolvedValueOnce(recordedInvalidManifest)
        .mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Test render and action source using node:test'}]}))
        .mockResolvedValueOnce(file(path));
    const onStage = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Repair only /render.test.ts. Keep behavior unchanged.', request, onStage}))
        .resolves.toBe(file(path));
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1][0].prompt).toContain('Repair only /render.test.ts. Keep behavior unchanged.');
    expect(request.mock.calls[1][0].prompt).toContain('FILE PLAN VALIDATION RETRY');
    expect(request.mock.calls[1][0].prompt).not.toContain(recordedInvalidManifest);
    expect(onStage.mock.calls[1][0].label).toContain('invalid JSON');
});

test('stops after two invalid JSON plans without generating any files', async () => {
    const request = jest.fn().mockResolvedValue(recordedInvalidManifest);
    await expect(generateStagedWorkspace({prompt: 'Repair the tests', request})).rejects.toThrow('file-plan validation failed after one retry');
    expect(request).toHaveBeenCalledTimes(2);
});

test.each(['{"files":[{"path":"/../host.ts","contract":"invalid"}]}'])(
    'does not retry unsafe paths: %s', async text => {
        const request = jest.fn().mockResolvedValue(text);
        await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow();
        expect(request).toHaveBeenCalledTimes(1);
    });

test('does not replan when the provider stream fails before completion', async () => {
    const request = jest.fn().mockRejectedValue(new SyntaxError('Malformed SSE'));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('Malformed SSE');
    expect(request).toHaveBeenCalledTimes(1);
});

test('cancellation during plan recovery prevents further provider calls', async () => {
    let cancelled = false;
    const request = jest.fn().mockResolvedValue(recordedInvalidManifest);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request,
        onStage: stage => { if (stage.label.includes('Retrying')) cancelled = true; },
        assertActive: () => { if (cancelled) throw new Error('Cancelled'); },
    })).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledTimes(1);
});

test('enables staged generation for Cloudflare workspace requests only', () => {
    expect(useStagedWorkspaceGeneration('cloudflare', true)).toBe(true);
    expect(useStagedWorkspaceGeneration('cloudflare', false)).toBe(false);
    expect(useStagedWorkspaceGeneration('openai', true)).toBe(false);
});

test('generates one complete file per call, sharing contracts and pending dependencies', async () => {
    const render = file('/render.ts', 'export const render = () => "Hello";');
    const index = file('/index.ts', 'import {render} from "./render";');
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce(render).mockResolvedValueOnce(index);
    const onStage = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build my plugin and preserve its styles.', request, onStage});
    expect(result).toBe(`${render}\n\n${index}`);
    expect(request.mock.calls.map(([options]) => options.maxOutputTokens)).toEqual([2048, 6144, 6144]);
    expect(request.mock.calls[2][0].prompt).toContain(render);
    for (const [options] of request.mock.calls) expect(options.prompt).toContain('preserve its styles');
    expect(onStage.mock.calls.map(([stage]) => stage.index)).toEqual([0, 1, 2]);
    expect(onStage.mock.calls[2][0]).toMatchObject({content: render, total: 2});
});

test('does not return any applicable result when a later file stream is incomplete', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce(file('/render.ts'))
        .mockRejectedValueOnce(new Error('Stream ended before a completion event'));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('completion event');
    expect(request).toHaveBeenCalledTimes(3);
});

test('cancellation between files prevents the next provider request', async () => {
    let cancelled = false;
    const request = jest.fn().mockResolvedValueOnce(manifest).mockImplementationOnce(async () => {
        cancelled = true;
        return file('/render.ts');
    });
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request, assertActive: () => {
        if (cancelled) throw new Error('Cancelled');
    }})).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledTimes(2);
});

test.each(['/../host.ts', '/Users/me/host.ts', '/node_modules/sdk.ts', '/.git/config', '/src//foo.ts', '/src/./foo.ts', '/.env', '/bad\nname.ts'])(
    'rejects unsafe manifest path %s before file generation', path => {
        expect(() => parseWorkspaceManifest(JSON.stringify({files: [{path, contract: 'contract'}]}))).toThrow();
    });

test('rejects duplicate paths, missing contracts, oversized and empty plans', () => {
    for (const files of [[], [{path: '/a.ts'}], [
        {path: '/a.ts', contract: 'one'}, {path: '/A.ts', contract: 'two'},
    ], Array.from({length: 37}, (_, i) => ({path: `/file${i}.ts`, contract: 'module'}))]) {
        expect(() => parseWorkspaceManifest(JSON.stringify({files}))).toThrow();
    }
});

test('rejects wrong, extra, empty, oversized or unfinished file sections', () => {
    for (const text of [file('/wrong.ts'), `${file('/a.ts')}\n${file('/b.ts')}`, file('/a.ts', ''),
        file('/a.ts', 'x'.repeat(48001)), '### File: /a.ts\n```ts\nexport {};']) {
        expect(() => validateWorkspaceFile(text, '/a.ts')).toThrow();
    }
});

const outputLimit = () => new Error('max_output_tokens');

test('retries a truncated inventory with inventory instructions, never a full workspace response', async () => {
    const request = jest.fn().mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build all screens with feature folders.', request});
    expect(result).toContain('### File: /index.ts');
    expect(request.mock.calls.map(([value]) => value.maxOutputTokens)).toEqual([2048, 2048, 6144, 6144]);
    expect(request.mock.calls[1][0].prompt).toContain('file inventory exceeded its output limit');
    expect(request.mock.calls[1][0].prompt).not.toContain('OUTPUT-LIMIT RECOVERY');
});

test('reports repeated plan truncation as a planning error with no file requests', async () => {
    const request = jest.fn().mockRejectedValue(outputLimit());
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('file inventory exceeded its response budget');
    expect(request).toHaveBeenCalledTimes(2);
});

test('splits an oversized module into a helper and composition file without regenerating completed files', async () => {
    const original = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'},
        {path: '/render.ts', contract: 'Export render()'}, {path: '/index.ts', contract: 'Plugin entry'}]});
    const revised = JSON.stringify({files: [{path: '/features/dashboard.ts', contract: 'Export dashboard()'},
        {path: '/render.ts', contract: 'Compose dashboard()'}]});
    const request = jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(file('/types.ts'))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(revised)
        .mockResolvedValueOnce(file('/features/dashboard.ts')).mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(result).toBe(['/types.ts', '/features/dashboard.ts', '/render.ts', '/index.ts'].map(path => file(path)).join('\n\n'));
    expect(request.mock.calls[3][0].prompt).toContain('MODULE SPLIT REQUIRED');
    expect(request.mock.calls[3][0].prompt).toContain(file('/types.ts'));
    expect(request.mock.calls[5][0].prompt).toContain(file('/features/dashboard.ts'));
});

test.each([
    [{path: '/render.ts', contract: 'Still monolithic'}],
    [{path: '/types.ts', contract: 'Overwrite completed'}, {path: '/helper.ts', contract: 'Helper'}, {path: '/render.ts', contract: 'Render'}],
    [{path: '/helper.ts', contract: 'Helper'}, {path: '/index.ts', contract: 'Overwrite pending'}, {path: '/render.ts', contract: 'Render'}],
].map(entries => [entries]))('rejects repeated splits that rewrite retained paths or add no new helper', async entries => {
    const original = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'}, ...JSON.parse(manifest).files]});
    const request = jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(file('/types.ts'))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValue(JSON.stringify({files: entries}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('Cannot split');
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[4][0].prompt).toContain('FILE PLAN VALIDATION RETRY');
});

test('limits recursive module splitting to two attempts in the same dependency branch', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/helper1.ts', contract: 'Helper'}, {path: '/render.ts', contract: 'Render'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockRejectedValueOnce(outputLimit()) // One larger response at depth one.
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/helper2.ts', contract: 'Helper'}, {path: '/helper1.ts', contract: 'Compose helper2'}]}))
        .mockRejectedValueOnce(outputLimit()) // One larger response at depth two.
        .mockRejectedValueOnce(outputLimit());
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('after bounded file splitting');
    expect(request).toHaveBeenCalledTimes(8);
});

test('cancelling a truncated file prevents the split request', async () => {
    let cancelled = false;
    const request = jest.fn().mockResolvedValueOnce(manifest).mockImplementationOnce(async () => {
        cancelled = true;
        throw outputLimit();
    });
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request,
        assertActive: () => { if (cancelled) throw new Error('Cancelled'); },
    })).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledTimes(2);
});

test('splits an oversized stylesheet into relative CSS imports with smaller per-file budgets', async () => {
    const initial = JSON.stringify({files: [{path: '/styles.css', contract: 'Workbench styles'}]});
    const split = JSON.stringify({files: [{path: '/styles/layout.css', contract: 'Shell layout'},
        {path: '/features/text/styles.css', contract: 'Text workspace styles'},
        {path: '/styles.css', contract: 'Compose feature styles'}]});
    const cssFile = (path, source) => `### File: ${path}\n\`\`\`css\n${source}\n\`\`\``;
    const root = cssFile('/styles.css', '@import "./styles/layout.css";\n@import "./features/text/styles.css";');
    const request = jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(split)
        .mockResolvedValueOnce(cssFile('/styles/layout.css', '.shell { padding: 24px; }'))
        .mockResolvedValueOnce(cssFile('/features/text/styles.css', '.text { color: white; }'))
        .mockResolvedValueOnce(root);
    const result = await generateStagedWorkspace({prompt: 'Build a modular workbench.', request});
    expect(request.mock.calls.map(([options]) => options.maxOutputTokens)).toEqual([2048, 3072, 2048, 1536, 1536, 1536]);
    expect(request.mock.calls[2][0].prompt).toContain('This is a CSS file');
    expect(request.mock.calls[5][0].prompt).toContain('must fit within 1536 output tokens');
    expect(result).toContain(root);
});

// Exercise the actual live-test accounting, including already spent requests.
function budgetedWorkspace(limit, responses) {
    jest.resetModules();
    const {reserveLiveAiTestRequest, assertLiveAiTestRequestsAvailable} = require('../../src/utils/liveAiTestBudget');
    const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: String(limit)};
    let index = 0;
    return {
        prompt: 'Build the full modular plugin.',
        assertBudget: count => assertLiveAiTestRequestsAvailable(count, env),
        request: jest.fn(async () => {
            reserveLiveAiTestRequest(env);
            const response = responses[index++];
            if (response instanceof Error) throw response;
            return response;
        }),
    };
}

test.each(['auto', '16'])('initial plan can retain twelve feature modules plus composition, styles and tests: %s', async limit => {
    const paths = ['text', 'json', 'data', 'seo', 'images', 'social'].flatMap(feature =>
        [`/features/${feature}/logic.ts`, `/features/${feature}/render.ts`]);
    paths.push('/styles.css', '/render.tsx', '/index.ts', '/render.test.ts');
    const plan = JSON.stringify({files: paths.map(path => ({path, contract: 'Implement this module'}))});
    const responses = [plan, ...paths.map(path => file(path, path.endsWith('.css') ? '.shell {color: red;}' : 'export {};'))];
    const options = budgetedWorkspace(limit, responses);
    if (limit === 'auto') {
        const result = await generateStagedWorkspace(options);
        expect(result.match(/### File:/g)).toHaveLength(16);
        expect(result).toContain('### File: /render.test.ts');
        expect(options.request).toHaveBeenCalledTimes(17);
        expect(options.request.mock.calls[0][0].responseSchema.properties.files.maxItems).toBe(36);
    } else {
        await expect(generateStagedWorkspace(options)).rejects.toThrow('16 requests needed, 15 remaining');
        expect(options.request).toHaveBeenCalledTimes(1);
    }
});

test('rejects a 12-file plan under a 12-request cap before generating source', async () => {
    const plan = JSON.stringify({files: Array.from({length: 12}, (_, i) => ({path: `/features/f${i}.ts`, contract: 'Feature module'}))});
    const options = budgetedWorkspace(12, [plan]);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('12 requests needed, 11 remaining (1/12 used)');
    expect(options.request).toHaveBeenCalledTimes(1);
});

test.each(['auto', '16'])('splits a full initial CSS plan using the actual remaining request budget: %s', async limit => {
    const completed = Array.from({length: 4}, (_, i) => ({path: `/shared/f${i}.ts`, contract: 'Shared types'}));
    const root = {path: '/styles/workspace.css', contract: 'Workspace styles'};
    const tail = Array.from({length: 7}, (_, i) => ({path: `/features/f${i}.ts`, contract: 'Feature'}));
    const helpers = [{path: '/styles/fields.css', contract: 'Field styles'}, {path: '/styles/results.css', contract: 'Result styles'}];
    const css = (path, content) => JSON.stringify({path, lines: [content]});
    const options = budgetedWorkspace(limit, [
        JSON.stringify({files: [...completed, root, ...tail]}), ...completed.map(entry => file(entry.path)), outputLimit(),
        JSON.stringify({files: helpers}), css(helpers[0].path, '.field {}'), css(helpers[1].path, '.result {}'),
        css(root.path, '@import "./fields.css"; @import "./results.css";'), ...tail.map(entry => file(entry.path)),
    ]);
    if (limit === '16') {
        await expect(generateStagedWorkspace(options)).rejects.toThrow('10 requests needed, 9 remaining (7/16 used)');
        expect(options.request).toHaveBeenCalledTimes(7); // Stop before spending on any helper.
    } else {
        const result = await generateStagedWorkspace(options);
        expect(result.match(/^### File:/gm)).toHaveLength(14);
        for (const entry of [...completed, root, ...tail, ...helpers]) expect(result).toContain(`### File: ${entry.path}\n`);
        expect(options.request).toHaveBeenCalledTimes(17);
        expect(globalThis.__FDO_E2E_LIVE_AI_BUDGET__).toMatchObject({mode: 'adaptive', used: 17, allocated: 17, ceiling: 50});
    }
});

test('completes when the plan exactly fits the remaining budget', async () => {
    const options = budgetedWorkspace(3, [manifest, file('/render.ts'), file('/index.ts')]);
    await expect(generateStagedWorkspace(options)).resolves.toContain('### File: /index.ts');
    expect(options.request.mock.calls.map(([request]) => request.minimumRequests)).toEqual([2, 2, 1]);
});

test('accounts for planning retries before starting source generation', async () => {
    const options = budgetedWorkspace(3, [recordedInvalidManifest, manifest]);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('2 requests needed, 1 remaining (2/3 used)');
    expect(options.request).toHaveBeenCalledTimes(2);
});

test('does not request a split plan when its minimum file set is unaffordable', async () => {
    const options = budgetedWorkspace(5, [manifest, outputLimit()]);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('4 requests needed, 3 remaining (2/5 used)');
    expect(options.request).toHaveBeenCalledTimes(2);
});

test('rechecks a split plan which adds more helpers than the remaining budget permits', async () => {
    const split = JSON.stringify({files: [{path: '/helper1.ts', contract: 'Helper'}, {path: '/helper2.ts', contract: 'Helper'}, JSON.parse(manifest).files[0]]});
    const options = budgetedWorkspace(6, [manifest, outputLimit(), split]);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('4 requests needed, 3 remaining (3/6 used)');
    expect(options.request).toHaveBeenCalledTimes(3);
});

test.each([
    ['.overlay { display: grid; }', 'Expected exactly one File heading'],
    [file('/styles/wrong.css'), 'does not match the requested path'],
    [file('/styles/overlay.css', ''), 'source code is empty'],
    [file('/styles/overlay.css', 'x'.repeat(48001)), 'exceeds 48000 characters'],
    [`${file('/styles/overlay.css')}\n${file('/extra.ts')}`, 'additional or nested code fences'],
    ['### File: /styles/overlay.css\n```css\n.overlay {}', 'Expected exactly one File heading'],
])('retries a completed response with invalid CSS file format: %s', async (invalid, reason) => {
    const plan = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'},
        {path: '/styles/overlay.css', contract: 'Overlay styles'}, {path: '/index.ts', contract: 'Entry'}]});
    const overlay = file('/styles/overlay.css', '.overlay { display: grid; }');
    const request = jest.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(file('/types.ts'))
        .mockResolvedValueOnce(invalid).mockResolvedValueOnce(overlay).mockResolvedValueOnce(file('/index.ts'));
    const onStage = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request, onStage});
    expect(result).toBe([file('/types.ts'), overlay, file('/index.ts')].join('\n\n'));
    const retry = request.mock.calls[3][0];
    expect(retry.maxOutputTokens).toBe(3072);
    expect(retry.prompt).toContain('FILE VALIDATION RETRY');
    expect(retry.prompt).toContain(reason);
    expect(retry.prompt).toContain(file('/types.ts'));
    expect(request.mock.calls[4][0].prompt).not.toContain('FILE VALIDATION RETRY');
    expect(onStage.mock.calls.map(([stage]) => stage.index)).toEqual([0, 1, 2, 2, 3]);
    expect(onStage.mock.calls[3][0].label).toBe('Repairing file: /styles/overlay.css');
});

test('bounds repairs per file and preserves the last failure reason', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce('bare source')
        .mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/wrong.ts')).mockResolvedValueOnce(file('/wrong.ts'));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('after one repair of /index.ts');
    expect(request).toHaveBeenCalledTimes(5);
});

test('a format retry cannot spend the requests needed by remaining files', async () => {
    const options = budgetedWorkspace(3, [manifest, 'bare source']);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('2 requests needed, 1 remaining');
    expect(options.request).toHaveBeenCalledTimes(2);
});

test('cancellation after an invalid completed file prevents its format retry', async () => {
    let cancelled = false;
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce('bare source');
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request,
        onStage: stage => { if (stage.label.startsWith('Repairing file')) cancelled = true; },
        assertActive: () => { if (cancelled) throw new Error('Cancelled'); },
    })).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledTimes(2);
});


test('constrains inventories and each requested file with separate schemas', async () => {
    const invalid = require('node:fs').readFileSync(require('node:path').join(__dirname,
        '../fixtures/ai/workspace-manifest-missing-contract-key.txt'), 'utf8');
    expect(() => parseWorkspaceManifest(invalid)).toThrow('invalid JSON');
    const request = jest.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request.mock.calls.map(([request]) => request.responseSchema)).toEqual([
        WORKSPACE_MANIFEST_SCHEMA, WORKSPACE_MANIFEST_SCHEMA, workspaceFileSchema('/render.ts'), workspaceFileSchema('/index.ts'),
    ]);
    const validate = new (require('ajv'))().compile(WORKSPACE_MANIFEST_SCHEMA);
    expect(validate(JSON.parse(manifest))).toBe(true);
    for (const value of [{files: [{path: '/render.ts'}]}, {files: [{path: '/render.ts', contract: 'x'.repeat(241)}]},
        {files: []}, {files: Array(37).fill({path: '/render.ts', contract: 'Render'})}]) expect(validate(value)).toBe(false);
});


test('encodes recorded rendered TypeScript as file data without requiring a model-authored heading', async () => {
    const path = '/features/text/logic.ts';
    const content = require('node:fs').readFileSync(require('node:path').join(__dirname,
        '../fixtures/ai/workspace-text-logic-rendered.txt'), 'utf8');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Text transforms'}]}))
        .mockResolvedValueOnce(JSON.stringify({path, content}));
    const result = await generateStagedWorkspace({prompt: 'Implement text tools', request});
    expect(result).toBe(file(path, content));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].responseSchema.properties.path.enum).toEqual([path]);
    expect(request.mock.calls[1][0].prompt).toContain('The host creates');
});

test('structured file serialization preserves escaped quotes, backslashes, Unicode and line endings', () => {
    const content = 'export const text = "Привіт 👋";\r\nexport const pattern = /\\s+/;\r\nconst template = `hello ${text}`;';
    expect(validateWorkspaceFile(JSON.stringify({path: '/a.ts', content}), '/a.ts')).toBe(file('/a.ts', content));
});

test.each([
    [{path: '/wrong.ts', content: 'export {};'}, 'does not match'],
    [{path: '/a.ts', content: ''}, 'empty'],
    [{path: '/a.ts', content: 'x'.repeat(48001)}, 'exceeds'],
    [{path: '/a.ts'}, 'Expected exactly'],
    [{path: '/a.ts', content: 12}, 'Expected exactly'],
    [{path: '/a.ts', content: 'export {};', extra: 'file'}, 'Expected exactly'],
    [{path: '/a.ts', content: '```ts\nexport {};\n```'}, 'code-fence'],
])('rejects invalid structured file data %#', (value, reason) => {
    expect(() => validateWorkspaceFile(JSON.stringify(value), '/a.ts')).toThrow(reason);
});

test('never repairs malformed or truncated file JSON', () => {
    expect(() => validateWorkspaceFile('{"path":"/a.ts","content":"export ', '/a.ts')).toThrow('invalid JSON');
});

test.each(['quotes', 'backslashes'])('format repair receives the exact invalid JSON and location: %s', async defect => {
    const path = '/features/categories/actionHandler.ts';
    const source = 'export const label = "category";\nexport const pattern = /\\s+/;';
    const valid = JSON.stringify({path, lines: source.split('\n')});
    const invalid = defect === 'quotes' ? valid.replace('\\"category\\"', '"category"')
        : valid.replace('\\\\s', '\\s');
    const dependency = file('/types.ts');
    const tail = file('/tail.ts');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [
        {path: '/types.ts', contract: 'Shared types'}, {path, contract: 'Category actions'},
        {path: '/tail.ts', contract: 'Compose actions'},
    ]})).mockResolvedValueOnce(dependency).mockResolvedValueOnce(invalid)
        .mockImplementationOnce(async options => {
            expect(options.prompt).toContain(`BEGIN REJECTED FILE RESPONSE\n${invalid}\nEND REJECTED FILE RESPONSE`);
            expect(options.prompt).toMatch(/invalid JSON at character \d+ \(line 1, column \d+\)/);
            expect(options.prompt).toContain(dependency);
            expect(options.responseSchema).toBeUndefined();
            expect(options.bufferedResponse).toBe(true);
            expect(options.prompt).toContain('SOURCE FORMAT RECOVERY');
            return `\`\`\`typescript\n${source}\n\`\`\``;
        }).mockResolvedValueOnce(tail);
    const onStage = jest.fn();
    const onValidation = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build categories', request, onStage, onValidation});
    expect(result).toBe([dependency, file(path, source), tail].join('\n\n'));
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[4][0].prompt).not.toContain('BEGIN REJECTED FILE RESPONSE');
    expect(request.mock.calls[4][0].responseSchema).toBeUndefined();
    expect(request.mock.calls[4][0].bufferedResponse).toBe(true);
    expect(onStage.mock.calls.every(([stage]) => !stage.content.includes(invalid))).toBe(true);
    expect(onValidation).toHaveBeenCalledWith({path, kind: 'format', repairAvailable: true,
        jsonErrorLocation: {position: expect.any(Number), line: 1, column: expect.any(Number)}});
    expect(JSON.stringify(onValidation.mock.calls)).not.toContain(invalid);
});

test.each([
    '```ts\nexport {};',
    'Explanation\n```ts\nexport {};',
    '```ts\nexport {};\n```\n### File: /other.ts',
    '### File: /other.ts (changed)\n```ts\nexport {};\n```',
    '~~~ts\nexport {};\n~~~\n```ts\nexport {};\n```',
    '```ts\nexport {};\n```\n```ts\nexport {};\n```',
    '```ts\n\n```',
    `\`\`\`ts\n${'x'.repeat(48001)}\n\`\`\``,
    file('/wrong.ts'),
])('raw-source recovery rejects ambiguous, missing, oversized or wrong-path output %#', response => {
    expect(() => validateWorkspaceFile(response, '/a.ts', {allowSourceFence: true})).toThrow();
});

test('a pathless code block is accepted only for an explicitly requested source response', () => {
    const response = '```ts\n// comment\nexport const pattern = /\\s+/;\n```';
    expect(() => validateWorkspaceFile(response, '/a.ts')).toThrow();
    expect(validateWorkspaceFile(response, '/a.ts', {allowSourceFence: true}))
        .toBe(`### File: /a.ts\n${response}`);
});

test.each([
    ['Looking at the diagnostics, the input roles need to match the actions.\n\n', '\nThe input roles now match.'],
    ['### File: /a.ts\n', '\nUpdated the requested file.'],
    ['', '\n'],
])('source-mode accepts one complete block with prose without changing its source %#', (prefix, suffix) => {
    const source = '// Source whitespace stays intact\nexport const pattern = /\\s+/;\n\nexport const label = `category`;';
    const block = `\`\`\`ts\n${source}\n\`\`\``;
    expect(validateWorkspaceFile(prefix + block + suffix, '/a.ts', {allowSourceFence: true}))
        .toBe(`### File: /a.ts\n${block}`);
});

test('completed source-mode prose does not consume another format repair or leak into applied files', async () => {
    const path = '/ui/screens/category-workspace.ts';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Category markup'}]}))
        .mockResolvedValueOnce('{invalid JSON')
        .mockResolvedValueOnce('Looking at the diagnostics, align the input roles.\n```ts\nexport const inputRole = "tool-category-input";\n```\nThe file is complete.');
    const result = await generateStagedWorkspace({prompt: 'Repair category markup', request});
    expect(result).toBe(`### File: ${path}\n\`\`\`ts\nexport const inputRole = "tool-category-input";\n\`\`\``);
    expect(request).toHaveBeenCalledTimes(3);
});

test.each([false, true])('raw-source format recovery retains source validation and its bounded repair: %s', repeats => {
    const path = '/categories.ts';
    const invalid = 'Here is the requested category file.\n```ts\nexport const category = ;\n```';
    const valid = '```ts\nexport const category = "text";\n```';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Category'}]}))
        .mockResolvedValueOnce('{invalid JSON').mockResolvedValueOnce(invalid)
        .mockResolvedValueOnce(repeats ? invalid : valid);
    return (async () => {
        const result = generateStagedWorkspace({prompt: 'Build categories', request});
        if (repeats) await expect(result).rejects.toThrow('(source validation)');
        else await expect(result).resolves.toBe(`### File: ${path}\n${valid}`);
        expect(request).toHaveBeenCalledTimes(4);
        expect(request.mock.calls[3][0]).toMatchObject({bufferedResponse: true});
        expect(request.mock.calls[3][0].responseSchema).toBeUndefined();
        expect(request.mock.calls[3][0].prompt).toContain('BEGIN REJECTED SOURCE');
        expect(request.mock.calls[3][0].prompt).not.toContain('using the requested path/lines schema');
    })();
});

test('oversized malformed response is not copied or partially salvaged into repair context', async () => {
    const invalid = '{"path":"/a.ts","lines":["' + 'x'.repeat(48000);
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/a.ts', contract: 'Small module'}]}))
        .mockResolvedValueOnce(invalid).mockResolvedValueOnce(file('/a.ts'));
    expect(await generateStagedWorkspace({prompt: 'Build module', request})).toBe(file('/a.ts'));
    expect(request.mock.calls[2][0].prompt).not.toContain('BEGIN REJECTED FILE RESPONSE');
    expect(request.mock.calls[2][0].prompt).not.toContain('x'.repeat(100));
});

test('successful source recovery selects source responses for later files and split helpers, but keeps plan schemas', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [
        {path: '/first.ts', contract: 'First module'}, {path: '/styles.css', contract: 'Styles'},
    ]})).mockResolvedValueOnce('{bad JSON').mockResolvedValueOnce('```ts\nexport {};\n```')
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles/layout.css', contract: 'Layout'}]}))
        .mockResolvedValueOnce('```css\n.layout { display: grid; }\n```')
        .mockResolvedValueOnce('```css\n@import "./styles/layout.css";\n```');
    const result = await generateStagedWorkspace({prompt: 'Build workspace', request});
    expect(request).toHaveBeenCalledTimes(7);
    for (const index of [2, 3, 5, 6]) {
        expect(request.mock.calls[index][0]).toMatchObject({bufferedResponse: true});
        expect(request.mock.calls[index][0].responseSchema).toBeUndefined();
    }
    expect(request.mock.calls[4][0].responseSchema.properties.files).toBeDefined();
    expect(result).toContain('@import "./styles/layout.css";');
    expect(result.match(/### File:/g)).toHaveLength(3);
    const next = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/a.ts', contract: 'Module'}]}))
        .mockResolvedValueOnce(file('/a.ts'));
    await generateStagedWorkspace({prompt: 'New transaction', request: next});
    expect(next.mock.calls[1][0].responseSchema).toEqual(workspaceFileSchema('/a.ts'));
});

test('JSON diagnostics retain numeric locations without leaking generated text', () => {
    const invalid = '{\n  "path": "/a.ts",\n  "lines": ["export const x = "sensitive-source";"]\n}';
    try {
        validateWorkspaceFile(invalid, '/a.ts');
        throw new Error('Expected invalid JSON to be rejected');
    } catch (error) {
        expect(error.jsonErrorLocation).toEqual({position: invalid.indexOf('sensitive-source'), line: 3, column: 32});
        expect(error.message).not.toContain('sensitive-source');
        expect(error.rejectedResponse).toBeUndefined();
    }
});

test('repairs a colliding CSS split once and retains completed source and pending contracts', async () => {
    const types = {path: '/types.ts', contract: 'Shared types'};
    const root = {path: '/styles.css', contract: 'Style every requested feature'};
    const entry = {path: '/index.ts', contract: 'Register the plugin with existing public interfaces'};
    const helper = {path: '/styles/layout.css', contract: 'Shell layout and responsive rules'};
    const initial = JSON.stringify({files: [types, root, entry]});
    const valid = JSON.stringify({files: [helper, {...root, contract: 'Compose layout styles with relative @import'}]});
    const request = jest.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(file(types.path))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(JSON.stringify({files: [entry, helper]}))
        .mockResolvedValueOnce(valid).mockResolvedValueOnce(file(helper.path, '.shell { display: grid; }'))
        .mockResolvedValueOnce(file(root.path, '@import "./styles/layout.css";'))
        .mockResolvedValueOnce(file(entry.path));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request).toHaveBeenCalledTimes(8);
    expect(result).toBe([file(types.path), file(helper.path, '.shell { display: grid; }'),
        file(root.path, '@import "./styles/layout.css";'), file(entry.path)].join('\n\n'));
    const retry = request.mock.calls[4][0];
    expect(retry.prompt).toContain('/index.ts is retained by the host');
    expect(retry.prompt).toContain('FILE PLAN VALIDATION RETRY');
    expect(retry.responseSchema.properties.files).toMatchObject({minItems: 1, maxItems: 12});
    expect(request.mock.calls[7][0].prompt).toContain(JSON.stringify(entry));
    expect(request.mock.calls.filter(([options]) => options.responseSchema.properties.path?.enum[0] === '/types.ts')).toHaveLength(1);
});

test('split validation shares the planning retry rather than multiplying recovery attempts', async () => {
    const request = jest.fn().mockResolvedValueOnce('{invalid').mockResolvedValueOnce(manifest)
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(JSON.stringify({files: [{path: '/render.ts', contract: 'Still monolithic'}]}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('file-plan validation failed after one retry');
    expect(request).toHaveBeenCalledTimes(4);
});

test.each([false, true])('CSS split reuses a %s completed dependency without changing its source or contract', async alreadyCompleted => {
    const root = {path: '/styles.css', contract: 'Compose layout'};
    const layout = {path: '/styles/layout.css', contract: 'Original layout contract'};
    const initial = JSON.stringify({files: alreadyCompleted ? [layout, root] : [root, layout]});
    const layoutFile = file(layout.path, '.layout { display: grid; }');
    const rootFile = file(root.path, '@import "./styles/layout.css";');
    const split = JSON.stringify({files: [{...layout, contract: 'REPLACE the original contract'}]});
    const options = budgetedWorkspace(5, [initial, ...(alreadyCompleted ? [layoutFile] : []),
        outputLimit(), split, ...(!alreadyCompleted ? [layoutFile] : []), rootFile]);
    expect(await generateStagedWorkspace(options)).toBe(`${layoutFile}\n\n${rootFile}`);
    expect(options.request).toHaveBeenCalledTimes(5);
    expect(options.request.mock.calls.filter(([call]) => call.workspaceStep === layout.path)).toHaveLength(1);
    const composition = options.request.mock.calls[4][0];
    expect(composition.prompt).toContain(layout.contract);
    expect(composition.prompt).not.toContain('REPLACE the original contract');
    expect(composition.maxOutputTokens).toBe(1536);
});

test('CSS reuse preserves the pending prefix order and admits only new helpers against the budget', async () => {
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const tokens = {path: '/styles/tokens.css', contract: 'Tokens before layout'};
    const layout = {path: '/styles/layout.css', contract: 'Layout uses tokens'};
    const tail = {path: '/tail.ts', contract: 'Unrelated pending file'};
    const helper = {path: '/styles/motion.css', contract: 'Reduced motion'};
    const paths = [tokens.path, layout.path, helper.path, root.path, tail.path];
    const options = budgetedWorkspace(8, [JSON.stringify({files: [root, tokens, layout, tail]}),
        outputLimit(), JSON.stringify({files: [layout, helper]}),
        ...paths.map(path => file(path, path.endsWith('.css') ? '.panel {}' : 'export {};'))]);
    await generateStagedWorkspace(options);
    expect(options.request.mock.calls.slice(3).map(([call]) => call.workspaceStep)).toEqual(paths);
    expect(options.request).toHaveBeenCalledTimes(8);
});

test('CSS reuse rejects a dependency on its composition ancestor', async () => {
    const root = {path: '/styles.css', contract: 'Root'};
    const helper = {path: '/styles/layout.css', contract: 'Layout'};
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [root]}))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(JSON.stringify({files: [helper]}))
        .mockRejectedValueOnce(outputLimit()).mockRejectedValueOnce(outputLimit()).mockResolvedValue(JSON.stringify({files: [root]}));
    await expect(generateStagedWorkspace({prompt: 'Build styles', request})).rejects.toThrow('circular module composition');
    expect(request).toHaveBeenCalledTimes(7);
});

test('CSS reuse does not accept a case-variant of a retained dependency', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [
        {path: '/styles.css', contract: 'Root'}, {path: '/styles/layout.css', contract: 'Layout'},
    ]})).mockRejectedValueOnce(outputLimit()).mockResolvedValue(JSON.stringify({files: [
        {path: '/styles/Layout.css', contract: 'Different case'},
    ]}));
    await expect(generateStagedWorkspace({prompt: 'Build styles', request})).rejects.toThrow('/styles/Layout.css is retained');
    expect(request).toHaveBeenCalledTimes(4);
});

test('bounds helper inventories independently of retained files', async () => {
    const initial = JSON.stringify({files: [{path: '/render.ts', contract: 'Render'},
        ...Array.from({length: 11}, (_, i) => ({path: `/pending${i}.ts`, contract: 'Retained'}))]});
    const invalid = JSON.stringify({files: Array.from({length: 13}, (_, i) => ({path: `/helper${i}.ts`, contract: 'Helper'}))});
    const request = jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(outputLimit()).mockResolvedValue(invalid);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('must contain 1–12 files');
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[2][0].responseSchema.properties.files.maxItems).toBe(12);
});

test('CSS split rejects non-CSS helpers before requesting their source', async () => {
    const initial = JSON.stringify({files: [{path: '/styles.css', contract: 'Styles'}]});
    const invalid = JSON.stringify({files: [{path: '/helper.ts', contract: 'Styles'}, {path: '/styles.css', contract: 'Compose'}]});
    const request = jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(outputLimit()).mockResolvedValue(invalid);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('stylesheet helpers must be CSS files');
    expect(request).toHaveBeenCalledTimes(4);
});

test('split validation retry stops when the minimum remaining work exceeds budget', async () => {
    const invalid = JSON.stringify({files: [{path: '/render.ts', contract: 'Still monolithic'}]});
    const options = budgetedWorkspace(6, [manifest, outputLimit(), invalid]);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('4 requests needed, 3 remaining');
    expect(options.request).toHaveBeenCalledTimes(3);
});

test.each(['omitted', 'first', 'middle', 'last'])('host schedules the original CSS module with its contract preserved when it is %s in the split reply', async position => {
    const types = {path: '/types.ts', contract: 'Shared types'};
    const original = {path: '/styles/panels.css', contract: 'Preserve panel classes, responsive layout and reduced motion'};
    const entry = {path: '/index.ts', contract: 'Register plugin'};
    const helpers = [{path: '/styles/panels/layout.css', contract: 'Panel layout and responsive rules'},
        {path: '/styles/panels/motion.css', contract: 'Panel motion and reduced motion'}];
    const proposed = [...helpers];
    if (position !== 'omitted') proposed.splice({first: 0, middle: 1, last: 2}[position], 0,
        {...original, contract: 'Discard the original responsibilities'});
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [types, original, entry]}))
        .mockResolvedValueOnce(file(types.path)).mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: proposed}))
        .mockResolvedValueOnce(file(helpers[0].path, '.panel { display: grid; }'))
        .mockResolvedValueOnce(file(helpers[1].path, '@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }'))
        .mockResolvedValueOnce(file(original.path, '@import "./panels/layout.css";\n@import "./panels/motion.css";'))
        .mockResolvedValueOnce(file(entry.path));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request).toHaveBeenCalledTimes(8);
    expect(request.mock.calls.filter(([options]) => options.responseSchema.properties.path)
        .map(([options]) => options.responseSchema.properties.path.enum[0]))
        .toEqual([types.path, original.path, helpers[0].path, helpers[1].path, original.path, entry.path]);
    expect(request.mock.calls[6][0].prompt).toContain(`Its contract: ${original.contract}`);
    expect(request.mock.calls[6][0].prompt).toContain('Implement only the thin composition');
    expect(request.mock.calls[6][0].prompt).not.toContain('Discard the original responsibilities');
    expect(result).toContain('### File: /styles/panels.css');
    expect(result.match(/### File: \/styles\/panels.css/g)).toHaveLength(1);
});

test('a case-variant of the oversized path cannot masquerade as a new helper', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockRejectedValueOnce(outputLimit())
        .mockResolvedValue(JSON.stringify({files: [{path: '/Render.ts', contract: 'Conflicting helper'}]}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('/Render.ts is retained by the host');
    expect(request).toHaveBeenCalledTimes(4);
});

test.each([false, true])('a second split retains helpers without renewing output recovery (truncated again: %s)', async truncatedAgain => {
    const original = {path: '/styles.css', contract: 'Full workspace styles'};
    const layout = {path: '/styles/layout.css', contract: 'Layout'};
    const panels = {path: '/styles/panels.css', contract: 'Panels'};
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [original]}))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(JSON.stringify({files: [layout]}))
        .mockResolvedValueOnce(file(layout.path, '.shell { display: grid; }'))
        .mockRejectedValueOnce(outputLimit()).mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [panels]}))
        .mockResolvedValueOnce(file(panels.path, '.panel { padding: 12px; }'))
        .mockImplementationOnce(async () => {
            if (truncatedAgain) throw outputLimit();
            return file(original.path, '@import "./styles/layout.css";\n@import "./styles/panels.css";');
        });
    const result = generateStagedWorkspace({prompt: 'Build plugin', request});
    if (truncatedAgain) await expect(result).rejects.toThrow('after bounded file splitting');
    else await expect(result).resolves.toContain('### File: /styles.css');
    expect(request).toHaveBeenCalledTimes(9);
    expect(request.mock.calls[8][0].prompt).toContain(`these completed helpers: ${JSON.stringify([layout, panels])}`);
    expect(request.mock.calls.filter(([options]) => options.responseSchema.properties.path?.enum[0] === layout.path)).toHaveLength(1);
});
