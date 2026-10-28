import {workspaceModuleSplitRepair} from '../../src/utils/plugins/validation/workspaceModuleSplitRepair';
import {getValidationRepairPaths} from '../../src/components/editor/utils/aiCodingAgentPlanRepair';
import {workspaceFileSchema, WORKSPACE_MANIFEST_SCHEMA, generateStagedWorkspace, parseWorkspaceManifest, useStagedWorkspaceGeneration, validateWorkspaceFile} from '../../src/utils/ai/generation/codingWorkspaceGeneration';

const manifest = JSON.stringify({files: [
    {path: '/render.ts', contract: 'Export render(): string'},
    {path: '/index.ts', contract: 'Import render from ./render and use it in the plugin'},
]});
const file = (path, content = 'export {};') => `### File: ${path}\n\`\`\`typescript\n${content}\n\`\`\``;

test('an explicit test request cannot be dropped from the initial inventory', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/logic.test.ts', contract: 'Test tools and error cases'}]}))
        .mockResolvedValueOnce(file('/logic.test.ts', 'import {test} from "node:test"; test("behavior", () => {});'));
    await generateStagedWorkspace({prompt: 'Build tools. Add tests for the tools and their error cases.', request});
    expect(request.mock.calls[1][0].planStage).toBe(true);
    expect(request.mock.calls[1][0].prompt).toContain('inventory has no test file');
    expect(request.mock.calls[2][0].workspaceStep).toBe('/logic.test.ts');
});

test('an explicit request not to add tests does not require a test inventory', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    await generateStagedWorkspace({prompt: 'Change the colors; do not add tests.', request});
    expect(request).toHaveBeenCalledTimes(3);
});

test('targeted repairs recheck workspace foundation errors before accepting the file', async () => {
    const path = '/features/dashboard/render.ts';
    const invalid = 'export const render = () => `<input><button>Search</button>`;';
    const fixed = 'export const render = () => `<form class="pure-form pure-form-stacked"><input><button type="button" class="pure-button pure-button-primary">Search</button></form>`;';
    const request = jest.fn().mockResolvedValueOnce(file(path, invalid)).mockResolvedValueOnce(file(path, fixed));
    const onFileValidated = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Correct the reported form foundation errors.',
        workspaceFiles: [{path, content: invalid}, {path: '/retained.ts', content: 'export const retained = true;'}],
        repairPaths: [path], request, onFileValidated});
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].prompt).toContain('interactive forms must use the injected Pure CSS foundation');
    expect(request.mock.calls.every(([call]) => call.workspaceStep === path)).toBe(true);
    expect(onFileValidated).toHaveBeenCalledTimes(1);
    expect(result).toContain(fixed);
    expect(result).not.toContain('### File: /retained.ts');
});

test('repeatedly ignoring a workspace validation repair exhausts the existing bounded retries', async () => {
    const path = '/dashboard.ts';
    const content = 'export const render = () => `<input><button>Run</button>`;';
    const request = jest.fn().mockResolvedValue(file(path, content));
    const onFileValidated = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Repair form foundation', repairPaths: [path], request,
        workspaceFiles: [{path, content}], onFileValidated})).rejects.toThrow('Workspace file validation failed');
    expect(request.mock.calls.length).toBeGreaterThan(1);
    expect(request.mock.calls.length).toBeLessThanOrEqual(4);
    expect(onFileValidated).not.toHaveBeenCalled();
});

test('a targeted leaf can rely on foundation classes in retained workspace files', async () => {
    const path = '/field.ts';
    const request = jest.fn().mockResolvedValue(file(path, 'export const field = `<input>`;'));
    await generateStagedWorkspace({prompt: 'Repair field', repairPaths: [path], request,
        workspaceFiles: [{path, content: 'export const field = `<input>`;'}, {path: '/wrapper.ts',
            content: 'export const wrapper = `<form class="pure-form pure-form-stacked"><button class="pure-button pure-button-primary">Run</button></form>`;'}]});
    expect(request).toHaveBeenCalledTimes(1);
});
const recordedInvalidManifest = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../fixtures/ai/workspace-manifest-unescaped-quotes.txt'), 'utf8');
const oversizedManifest = JSON.stringify(require('../fixtures/ai/workspace-manifest-oversized-contract.json'));
const flattenedEntry = require('../fixtures/ai/workspace-file-flattened-entry.json');
const cssSplitUnrelatedDuplicates = require('../fixtures/ai/workspace-css-split-unrelated-duplicates.json');
const providerTimeout = () => Object.assign(new Error('408 Request timeout'), {status: 408});

const brokenStringSource = 'export const id = "category";\nexport const label = "Unterminated;\nexport const ready = true;';
const fixedStringSource = brokenStringSource.replace('"Unterminated;', '"Unterminated";');

test('streaming file policy avoids buffered envelopes and carries an early size bound', async () => {
    const request = jest.fn().mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(file('/render.ts', 'export const render = () => "done";'))
        .mockResolvedValueOnce(file('/index.ts', 'export {render} from "./render";'));
    await generateStagedWorkspace({prompt: 'Build the workspace', request, streamFiles: true});
    for (const [call] of request.mock.calls.slice(1)) {
        expect(call.bufferedResponse).toBe(false);
        expect(call.responseSchema).toBeUndefined();
        expect(call.maximumResponseCharacters).toBe(49024);
    }
});

test.each(['json', 'legacy', 'source'])('preserves inline backticks in %s file transport', format => {
    const source = 'export const clean = (text: string) => text.replace(/```$/, "");\nexport const after = true;';
    const wrapped = file('/features/actions.ts', source);
    const response = format === 'json' ? JSON.stringify({path: '/features/actions.ts', lines: source.split('\n')})
        : format === 'source' ? `\`\`\`typescript\n${source}\n\`\`\`` : wrapped;
    expect(validateWorkspaceFile(response, '/features/actions.ts', {allowSourceFence: format === 'source'})).toBe(wrapped);
});

test('recorded return-type repair cannot pass by repeating the diagnostic owner unchanged', async () => {
    const fixture = require('../fixtures/ai/workspace-unchanged-return-repair.json');
    const original = fixture.files['/index.ts'];
    const corrected = original.replace('renderOnLoad(): string', 'renderOnLoad()');
    const request = jest.fn().mockResolvedValueOnce(file('/index.ts', original))
        .mockResolvedValueOnce(file('/index.ts', corrected));
    const getEvidence = jest.fn(() => 'Installed SDK declarations');
    const onFileValidated = jest.fn();
    const result = await generateStagedWorkspace({prompt: `Repair these problems:\n${fixture.diagnostics}`,
        workspaceFiles: Object.entries(fixture.files).map(([path, content]) => ({path, content})),
        repairPaths: ['/index.ts'], request, getEvidence, onFileValidated});
    expect(result).toContain('renderOnLoad() {');
    expect(result).not.toContain('renderOnLoad(): string');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].prompt).toContain('repair repeated diagnostic files unchanged');
    expect(getEvidence.mock.calls[0][0].diagnostics).toBe(fixture.diagnostics);
    expect(onFileValidated.mock.calls).toEqual([['/index.ts']]);
});

test('an unchanged repair is bounded and cannot manufacture validated progress', async () => {
    const source = 'export const value: string = 1;';
    const request = jest.fn().mockResolvedValue(file('/value.ts', source));
    const onFileValidated = jest.fn();
    await expect(generateStagedWorkspace({prompt: '/value.ts:1:14 [8] Incorrect type',
        workspaceFiles: [{path: '/value.ts', content: source}], repairPaths: ['/value.ts'],
        request, onFileValidated})).rejects.toThrow('No changes from this request were applied');
    expect(request).toHaveBeenCalledTimes(2);
    expect(onFileValidated).not.toHaveBeenCalled();
});

test('keeps a successful sibling repair while retrying an unchanged diagnostic owner', async () => {
    const source = 'export const value: string = 1;';
    const sibling = `export function render(): string { return "${'a'.repeat(1900)}"; }`;
    const fixedSibling = sibling.replace('return "a', 'return "b');
    const request = jest.fn().mockResolvedValueOnce(file('/value.ts', source))
        .mockResolvedValueOnce(file('/render.ts', fixedSibling))
        .mockResolvedValueOnce(file('/value.ts', 'export const value: string = "fixed";'));
    const result = await generateStagedWorkspace({prompt: '/value.ts:1:14 [8] Incorrect type',
        workspaceFiles: [{path: '/value.ts', content: source}, {path: '/render.ts', content: sibling}],
        repairPaths: ['/value.ts', '/render.ts'], request});
    expect(request).toHaveBeenCalledTimes(3);
    expect(result).toContain(fixedSibling);
    expect(result).toContain('"fixed"');
    expect([...result.matchAll(/^### File: (.+)$/gm)].map(match => match[1]).sort()).toEqual(['/render.ts', '/value.ts']);
});

test('a dependency-side correction may leave its diagnostic consumer unchanged', async () => {
    const consumer = 'import {value} from "./value"; export const text: string = value;';
    const request = jest.fn().mockResolvedValueOnce(file('/consumer.ts', consumer))
        .mockResolvedValueOnce(file('/value.ts', 'export const value = "fixed";'));
    await expect(generateStagedWorkspace({prompt: '/consumer.ts:1:40 [8] Incorrect type',
        workspaceFiles: [{path: '/consumer.ts', content: consumer}, {path: '/value.ts', content: 'export const value = 1;'}],
        repairPaths: ['/consumer.ts', '/value.ts'], request})).resolves.toContain('"fixed"');
    expect(request).toHaveBeenCalledTimes(2);
});

test('refreshes SDK evidence after rejection without replaying planning context or adding model calls', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [
            {path: '/labels.ts', contract: 'Export labels', visualReference: true},
            {path: '/helper.ts', contract: 'Export helper', visualReference: false},
        ]}))
        .mockResolvedValueOnce(file('/labels.ts', brokenStringSource))
        .mockResolvedValueOnce(file('/labels.ts', fixedStringSource))
        .mockResolvedValueOnce(file('/helper.ts', 'export const helper = 1;'));
    const getEvidence = jest.fn(({diagnostics}) => diagnostics ? 'UPDATED SDK EVIDENCE' : 'CURRENT SDK EVIDENCE');
    await generateStagedWorkspace({prompt: 'Build labels', request, getEvidence, planningEvidence: 'PLAN SDK EVIDENCE'});
    expect(request).toHaveBeenCalledTimes(4);
    expect(getEvidence).toHaveBeenCalledTimes(3);
    expect(getEvidence.mock.calls[1][0]).toMatchObject({targetPath: '/labels.ts', source: brokenStringSource});
    expect(getEvidence.mock.calls[1][0].diagnostics).toContain('invalid source syntax');
    expect(request.mock.calls[0][0].prompt).toContain('PLAN SDK EVIDENCE');
    expect(request.mock.calls[1][0].prompt).toContain('CURRENT SDK EVIDENCE');
    expect(request.mock.calls[1][0].prompt).not.toContain('PLAN SDK EVIDENCE');
    expect(request.mock.calls[2][0].prompt).toContain('UPDATED SDK EVIDENCE');
    expect(request.mock.calls.slice(1).map(([call]) => call.includeImage)).toEqual([true, false, false]);
});

test.each(['initial', 'source repair', 'format recovery'])('normalizes reserved binding markers during staged %s', async phase => {
    const path = '/features/space/actions.ts';
    const source = `export function bind(element: HTMLElement) {
    if (element.dataset.bound) return;
    element.dataset["bound"] = "true";
    element.setAttribute("data-bound", "true");
    window.addEventListener("resize", () => element.classList.toggle("compact", window.innerWidth < 800));
}`;
    const expected = source.replace('dataset.bound', 'dataset.pluginListenerBound')
        .replace('dataset["bound"]', 'dataset.pluginListenerBound')
        .replace('"data-bound"', '"data-plugin-listener-bound"');
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [
        {path, contract: 'Export bind(element) to attach the space action'},
        {path: '/render.ts', contract: 'Compose the space actions'},
    ]}));
    if (phase === 'source repair') request.mockResolvedValueOnce(file(path, 'export const bind = ;'));
    if (phase === 'format recovery') request.mockResolvedValueOnce('{"path":');
    request.mockResolvedValueOnce(phase === 'format recovery' ? `\`\`\`typescript\n${source}\n\`\`\`` : file(path, source));
    const tail = file('/render.ts', 'export {bind} from "./features/space/actions";');
    request.mockResolvedValueOnce(tail);
    const onStage = jest.fn();
    const onValidation = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build space actions', request, onStage, onValidation});
    expect(result).toBe(`${file(path, expected)}\n\n${tail}`);
    expect(request).toHaveBeenCalledTimes(phase === 'initial' ? 3 : 4);
    expect(request.mock.calls.at(-1)[0].prompt).toContain(expected);
    expect(onStage.mock.calls.some(([stage]) => stage.label === `Renamed reserved host binding markers in ${path}`)).toBe(true);
    if (phase === 'initial') expect(onValidation).not.toHaveBeenCalled();
});

test.each([false, true])('corrects initial-plan CSS imports without spending repairs, composition first=%s', async compositionFirst => {
    const names = ['dashboard', 'workspace', 'library', 'space', 'category'];
    const root = {path: '/styles.css', contract: 'Compose workbench styles'};
    const dependencies = ['/styles/base.css', ...names.map(name => `/features/workbench/styles/${name}.css`)]
        .map(path => ({path, contract: 'Feature styles'}));
    const files = compositionFirst ? [root, ...dependencies] : [...dependencies, root];
    const content = '@import "./styles/base.css";\n'
        + names.map(name => `@import "./styles/workbench/${name}.css";`).join('\n')
        + '\n.shell { color: red; }';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files}));
    for (const item of files) request.mockResolvedValueOnce(file(item.path, item === root ? content : '.panel { color: green; }'));
    const onValidation = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Build the workbench styles', workspaceFiles: [], request, onValidation});
    expect(result).toContain(content.replaceAll('./styles/workbench/', './features/workbench/styles/'));
    expect(result.match(/### File:/g)).toHaveLength(7);
    expect(request).toHaveBeenCalledTimes(8);
    expect(onValidation).not.toHaveBeenCalled();
    const generation = request.mock.calls[compositionFirst ? 1 : 7][0].prompt;
    expect(generation).toContain('"specifier":"./features/workbench/styles/dashboard.css"');
    expect(generation).toContain('do not import this whole list');
});

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

test('keeps generation requirements and focuses syntax repairs on the rejected implementation', async () => {
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
    for (const [options] of request.mock.calls) {
        if (options.prompt.startsWith('FOCUSED WORKSPACE SYNTAX REPAIR')) {
            expect(options.prompt).toContain('preserve its behavior');
            expect(options.includeImage).toBe(false);
        } else expect(options.prompt).toContain('Keep all written acceptance criteria.');
    }
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
    expect(request.mock.calls[3][0].prompt).toContain('Return a complete replacement for ONLY /logic.ts');
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

test('the file prompt forbids directory-style specifiers and the repair receives the directory diagnostics', async () => {
    const plan = JSON.stringify({files: [
        {path: '/render.tsx', contract: 'Render the workspace'},
        {path: '/features/dashboard/data.ts', contract: 'Dashboard data'}]});
    const bad = file('/render.tsx', 'import "./features/dashboard";\nexport const render = () => null;');
    const good = file('/render.tsx', 'import "./features/dashboard/data.ts";\nexport const render = () => null;');
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(good)
        .mockResolvedValueOnce(file('/features/dashboard/data.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build workbench', request, workspaceFiles: []});
    expect(result).toBe(`${good}\n\n${file('/features/dashboard/data.ts')}`);
    expect(request).toHaveBeenCalledTimes(4);
    // The first attempt already carries the rule that would prevent the
    // directory import, and the repair receives the concrete directory
    // diagnostics (missing index module plus the planned files under it).
    expect(request.mock.calls[1][0].prompt).toContain('directory-style specifiers resolve only through an index module');
    const repair = request.mock.calls[2][0].prompt;
    expect(repair).toContain('is a directory, not a module');
    expect(repair).toContain('its planned files are /features/dashboard/data.ts');
    expect(repair).toContain('import one of those files directly instead of the directory');
});

test('an abort after a repeated source failure reports the original rejection next to the repaired one', async () => {
    const path = '/render.ts';
    const plan = JSON.stringify({files: [{path, contract: 'Render'}]});
    const invalidSource = JSON.stringify({path, lines: brokenStringSource.split('\n')});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(invalidSource)
        .mockResolvedValueOnce(invalidSource)
        // An identical second rejection earns one flagged final round; the
        // third identical reply exhausts it.
        .mockResolvedValueOnce(invalidSource);
    const error = await generateStagedWorkspace({prompt: 'Build', request}).catch(reason => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(`Workspace file validation failed after repeated repairs of ${path} (source validation)`);
    // Every repeated round keeps both rejections visible in the final error,
    // not only the last one.
    expect(error.message).toContain('First rejection:');
    expect(error.message.match(/Unterminated string constant/g)).toHaveLength(2);
    // The first repair was told this is the file's only source repair and
    // that later defects are invisible to the reported diagnostic.
    expect(request.mock.calls[2][0].prompt).toContain('repair allowance is bounded');
    expect(request).toHaveBeenCalledTimes(4);
});

test.each(['complete', 'source repeats', 'format repeats', 'budget exhausted'])(
    'format repair does not consume source repair: %s', async outcome => {
        const path = '/features/categories/render.ts';
        const plan = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'}, {path, contract: 'Render category'}]});
        const dependency = file('/types.ts');
        const invalidSource = JSON.stringify({path, lines: brokenStringSource.split('\n')});
        const options = budgetedWorkspace(outcome === 'budget exhausted' ? 4 : 'auto', [plan, dependency,
            'Not a file envelope', invalidSource, outcome === 'source repeats' ? invalidSource
                : outcome === 'format repeats' ? 'Not a file envelope' : JSON.stringify({path, lines: fixedStringSource.split('\n')}),
            // An identical second source rejection earns one flagged final round.
            ...(outcome === 'source repeats' ? [invalidSource] : outcome === 'format repeats' ? ['Not a file envelope'] : [])]);
        const onValidation = jest.fn();
        const result = generateStagedWorkspace({...options, onValidation});
        if (outcome === 'complete') await expect(result).resolves.toBe(`${dependency}\n\n${file(path, fixedStringSource)}`);
        else await expect(result).rejects.toThrow(outcome === 'budget exhausted' ? '1 requests needed, 0 remaining' : `(${outcome.startsWith('source') ? 'source' : 'format'} validation)`);
        expect(options.request).toHaveBeenCalledTimes(outcome === 'budget exhausted' ? 4 : outcome === 'source repeats' || outcome === 'format repeats' ? 6 : 5);
        expect(onValidation.mock.calls.slice(0, 2).map(([event]) =>
            ({path: event.path, kind: event.kind, repairAvailable: event.repairAvailable}))).toEqual([
            {path, kind: 'format', repairAvailable: true}, {path, kind: 'source', repairAvailable: true},
        ]);
        // The rejection text rides along for artifacts: positions without
        // reasons cannot say which defect consumed a round.
        if (outcome !== 'budget exhausted') expect(onValidation.mock.calls[1][0].reason).toContain('invalid source syntax');
        if (outcome !== 'budget exhausted') {
            const repair = options.request.mock.calls[4][0];
            expect(repair.prompt).toContain(`${path}:2:22: invalid source syntax: Unterminated string constant`);
            // The parser reports where it stopped, never what it found: the
            // reason now quotes the source at the position with a column
            // marker (recorded live failure — two identical re-emissions of
            // an invalid interpolation while "expected }" gave no localizer).
            expect(repair.prompt).toContain('Source at that position (| marks 2:22)');
            expect(repair.prompt).toContain('label = |"Unterminated');
            expect(repair.prompt).toContain('2 | export const label = "Unterminated;');
            expect(repair.prompt).toContain(`BEGIN REJECTED SOURCE\n${brokenStringSource}\nEND REJECTED SOURCE`);
            expect(repair.prompt).not.toContain(dependency);
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
    expect(options.request.mock.calls.map(([call]) => call.maxOutputTokens)).toEqual([2048, 3072, 2048, 1536, 3072, 2048, 1024, 3072, 3072, 1536]);
    expect(options.request.mock.calls[7][0].prompt).toContain('must fit within 3072 output tokens');
    expect(result).toContain('.surface { color: red; }');
    expect(result.match(/### File:/g)).toHaveLength(3);
    expect(onStage.mock.calls.some(([stage]) => stage.label === 'Retrying complete file: /styles/surfaces.css (3072 output tokens)')).toBe(true);
});

test('a larger retry remains bounded and rejects another truncated response', async () => {
    const options = budgetedWorkspace('auto', [...deepestStylesheetResponses(), new Error('max_output_tokens')]);
    const result = generateStagedWorkspace(options);
    await expect(result).rejects.toThrow('after bounded file splitting');
    await expect(result).rejects.toMatchObject({failure: {schemaVersion: '1.0.0', code: 'WORKSPACE_GENERATION_BUDGET_EXHAUSTED', path: '/styles/surfaces.css', stage: 'file-generation', workspaceChanged: false, resumable: false, recoveryActions: ['smaller-scope'], splitDepth: 2, maximumSplitDepth: 2, requestedOutputTokens: 3072}});
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

test('nested splits focus helpers while preserving an expanded parent allowance', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/render.tsx', contract: 'Render UI'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/ui/categories.ts', contract: 'Render categories'}]}))
        .mockRejectedValueOnce(outputLimit()).mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/ui/category-runner.ts', contract: 'Run selected category'}]}))
        .mockResolvedValueOnce(file('/ui/category-runner.ts'))
        .mockResolvedValueOnce(file('/ui/categories.ts'))
        .mockResolvedValueOnce(file('/render.tsx'));
    const result = await generateStagedWorkspace({prompt: 'Build UI', request});
    expect(request.mock.calls.map(([call]) => call.maxOutputTokens)).toEqual([2048, 6144, 2048, 3072, 6144, 2048, 1536, 6144, 2048]);
    expect(request.mock.calls[5][0].prompt).toContain('retained composition file has at most 6144 output tokens');
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

test('a full initial inventory is replanned before generation, leaving capacity for a later split', async () => {
    const inventory = count => JSON.stringify({files: Array.from({length: count}, (_, i) =>
        ({path: `/feature${i}.ts`, contract: 'Implement feature operations'}))});
    const responses = [inventory(36), inventory(24),
        ...Array.from({length: 19}, (_, i) => file(`/feature${i}.ts`)), outputLimit(),
        JSON.stringify({files: [{path: '/helper.ts', contract: 'Implement focused helper'}]}),
        file('/helper.ts'), ...Array.from({length: 5}, (_, i) => file(`/feature${i + 19}.ts`))];
    const options = budgetedWorkspace('auto', responses);
    const result = await generateStagedWorkspace(options);
    expect(result.match(/### File:/g)).toHaveLength(25);
    const calls = options.request.mock.calls.map(([call]) => call);
    expect(calls.slice(0, 2).every(call => call.planStage)).toBe(true);
    expect(calls[0].responseSchema.properties.files.maxItems).toBe(24);
    expect(calls[1].prompt).toContain('received 36');
    expect(calls.filter(call => call.workspaceStep === '/feature0.ts')).toHaveLength(1);
    expect(result).toContain('### File: /helper.ts');
});

test('an initial inventory that keeps spending the split reserve fails before generating files', async () => {
    const plan = JSON.stringify({files: Array.from({length: 25}, (_, i) =>
        ({path: `/feature${i}.ts`, contract: 'Feature'}))});
    const request = jest.fn().mockResolvedValue(plan);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request}))
        .rejects.toThrow('file-plan validation failed after one retry');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(([call]) => call.planStage)).toBe(true);
});

test('independent splitting still stops at the existing maximum of 36 workspace files', async () => {
    const paths = Array.from({length: 12}, (_, i) => `/feature${i}.ts`);
    const responses = [JSON.stringify({files: paths.map(path => ({path, contract: 'Feature'}))})];
    for (let group = 0; group < 2; group++) {
        const helpers = Array.from({length: 12}, (_, i) => ({path: `/helpers/g${group}h${i}.ts`, contract: 'Helper'}));
        responses.push(outputLimit(), JSON.stringify({files: helpers}), ...helpers.map(helper => file(helper.path)), file(paths[group]));
    }
    responses.push(outputLimit(), outputLimit());
    const options = budgetedWorkspace('auto', responses);
    await expect(generateStagedWorkspace(options)).rejects.toThrow('workspace safety limit of 36 files');
    expect(options.request).toHaveBeenCalledTimes(33);
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
        .mockRejectedValueOnce(providerTimeout()).mockResolvedValueOnce(`\`\`\`ts\n${broken}\n\`\`\``)
        // The identical repeat earns one flagged final round before failing.
        .mockResolvedValueOnce(`\`\`\`ts\n${broken}\n\`\`\``);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('after repeated repairs of /render.ts');
    expect(request).toHaveBeenCalledTimes(5);
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
            expect(options.prompt).not.toContain(dependency);
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
    // Stylesheet repairs get CSS rules (a missed semicolon is the common
    // postcss diagnostic); TypeScript string rules would be misleading there.
    const repair = request.mock.calls[2][0].prompt;
    if (path.endsWith('.css')) {
        expect(repair).toContain('declaration must end with a semicolon');
        expect(repair).not.toContain('cannot span physical source lines');
    }
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

test.each([
    [[], 'lines array arrived empty'],
    [Array(2001).fill(''), 'lines array arrived with 2001 items'],
])('states what arrived when the lines array shape is wrong %#', (lines, reason) => {
    expect(() => validateWorkspaceFile(JSON.stringify({path: '/a.ts', lines}), '/a.ts')).toThrow(reason);
});

test('a lines-shape rejection names the offending items and reaches the format repair', async () => {
    const plan = JSON.stringify({files: [{path: '/render.test.ts', contract: 'Renderer tests'}]});
    // One good item, one item carrying an embedded line break, one item
    // that is not a string: all three shapes of the recorded live failure.
    const bad = JSON.stringify({path: '/render.test.ts', lines: ['ok line', 'multi\nline', 42]});
    // Source-clean TypeScript: the fixture targets the lines-shape rejection,
    // so it must not trip unrelated source rules (plugin test API imports).
    const fixed = JSON.stringify({path: '/render.test.ts', lines: ['export const value = 1;', '', 'export const sample = () => value;']});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(fixed);
    const result = await generateStagedWorkspace({prompt: 'Build tests', request, workspaceFiles: []});
    expect(result).toBe(file('/render.test.ts', 'export const value = 1;\n\nexport const sample = () => value;'));
    expect(request).toHaveBeenCalledTimes(3);
    const repair = request.mock.calls[2][0].prompt;
    expect(repair).toContain('but 2 items violate that');
    expect(repair).toContain('lines[1] contains an embedded line break');
    expect(repair).toContain('lines[2] is number');
    // The lines envelope rejected the source, so the single repair escalates
    // to the fenced protocol exactly like an invalid-JSON format failure:
    // no response schema is sent, and the prompt switches to the fence.
    expect(repair).toContain('SOURCE FORMAT RECOVERY');
    expect(request.mock.calls[2][0].responseSchema).toBeUndefined();
    expect(request.mock.calls[2][0].bufferedResponse).toBe(true);
});

test.each([
    [{lines: 'export {};'}, '"lines" (string)'],
    [{lines: ['export {};'], description: 'explanation'}, '"description" (string)'],
    [{source: 'export {};'}, '"source" (string)'],
    [{lines: ['export {};'], content: 'export {};'}, '"content" (string)'],
    [{lines: null}, '"lines" (null)'],
])('wrong JSON envelope switches its existing repair to source without accepting invalid data %#', async (fields, detail) => {
    const path = '/features/tools/types.ts';
    const bad = JSON.stringify({path, ...fields});
    expect(() => validateWorkspaceFile(bad, path)).toThrow(detail);
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path, contract: 'Shared tool types'}]}))
        .mockResolvedValueOnce(bad).mockResolvedValueOnce('```ts\nexport type Tool = {label: string};\n```');
    const result = await generateStagedWorkspace({prompt: 'Build tool types', request});
    expect(result).toContain('export type Tool = {label: string};');
    expect(result).not.toContain('description');
    expect(request).toHaveBeenCalledTimes(3);
    const repair = request.mock.calls[2][0];
    expect(repair.responseSchema).toBeUndefined();
    expect(repair.bufferedResponse).toBe(true);
    expect(repair.prompt).toContain('SOURCE FORMAT RECOVERY');
    expect(repair.prompt).toContain(detail);
});

test.each(['complete', 'format repeats', 'invalid source', 'budget exhausted'])(
    'source rejection then wrong JSON envelope retains diagnostics and bounded repairs: %s', async outcome => {
        const path = '/features/tools/types.ts';
        const plan = JSON.stringify({files: [{path: '/constants.ts', contract: 'Constants'},
            {path, contract: 'Tool definitions'}, {path: '/styles.css', contract: 'Tool styles'}]});
        const broken = 'export const tools = [{key: "text", "    label: "Text & Content"}];';
        const valid = 'export const tools = [{key: "text", label: "Text & Content"}];';
        const wrong = JSON.stringify({path, lines: [valid], explanation: 'Corrected the source'});
        const final = outcome === 'format repeats' ? wrong
            : `\`\`\`ts\n${outcome === 'invalid source' ? broken : valid}\n\`\`\``;
        const options = budgetedWorkspace(outcome === 'budget exhausted' ? 5 : 'auto', [plan,
            file('/constants.ts'), JSON.stringify({path, lines: [broken]}), wrong, final,
            ...(outcome === 'invalid source' ? [final] : ['```css\n.tools { color: red; }\n```'])]);
        const result = generateStagedWorkspace({...options, workspaceFiles: []});
        if (outcome === 'complete') {
            expect(await result).toContain(valid);
            expect(options.request).toHaveBeenCalledTimes(6);
            expect(options.request.mock.calls[5][0].responseSchema).toBeUndefined();
        } else {
            await expect(result).rejects.toThrow(outcome === 'budget exhausted' ? '2 requests needed, 1 remaining'
                : outcome === 'format repeats' ? '(format validation)' : '(source validation)');
            expect(options.request).toHaveBeenCalledTimes(outcome === 'budget exhausted' ? 4 : outcome === 'format repeats' ? 5 : 6);
        }
        if (outcome !== 'budget exhausted') {
            const repair = options.request.mock.calls[4][0];
            expect(repair.responseSchema).toBeUndefined();
            expect(repair.prompt).toContain('invalid source syntax');
            expect(repair.prompt).toContain('Received fields:');
            expect(repair.prompt).toContain('still unresolved');
        }
    });

test('native file schema requires bounded physical lines, including blank lines', () => {
    const validate = new (require('ajv'))().compile(workspaceFileSchema('/a.ts'));
    expect(validate({path: '/a.ts', lines: ['// comment', '', 'export {};']})).toBe(true);
    for (const value of [{path: '/a.ts', content: 'export {};'}, {path: '/b.ts', lines: ['export {};']},
        {path: '/a.ts', lines: ['a\nb']}, {path: '/a.ts', lines: []}]) expect(validate(value)).toBe(false);
});

test('the file-plan request supersedes any embedded file-sections demand from the caller prompt', async () => {
    const inventory = JSON.stringify({files: [{path: '/index.ts', contract: 'Start the plugin'}]});
    const request = jest.fn().mockResolvedValueOnce(inventory).mockRejectedValue(new Error('stop after prompts'));
    await expect(generateStagedWorkspace({
        prompt: 'EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\nReturn ONLY complete executable workspace file sections.',
        request,
    })).rejects.toThrow('stop after prompts');
    const planPrompt = request.mock.calls[0][0].prompt;
    expect(planPrompt).toContain('This header supersedes every earlier response-format instruction');
    expect(planPrompt).toContain('Respond ONLY with the compact JSON inventory');
    expect(request.mock.calls[1][0].prompt)
        .toContain('This structured transport replaces the general Markdown file-section instructions');
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
    // The identical repeat reply earns one flagged final round before failing.
    expect(request).toHaveBeenCalledTimes(4);
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
    expect(request.mock.calls[1][0].prompt).toContain('has 787 characters; maximum is 240');
    // With the whole-response cap raised above the documented ceilings' joint
    // worst case, the per-entry contract bound is what rejects this recorded
    // plan — and the retry gets the exact cut, not a generic limit.
    expect(request.mock.calls[1][0].prompt).toContain('cut at least 547 characters from that contract alone');
    expect(request.mock.calls[1][0].maxOutputTokens).toBe(2048);
    for (const [options] of request.mock.calls) expect(options.prompt).toContain('Keep every Workbench feature and test.');
});

test('shares the single plan retry between syntax and schema failures', async () => {
    const request = jest.fn().mockResolvedValueOnce(recordedInvalidManifest).mockResolvedValueOnce(oversizedManifest);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('has 787 characters; maximum is 240');
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
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('invalid path at files[1]:');
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
    expect(request.mock.calls[1][0].prompt).toContain(JSON.stringify(recordedInvalidManifest.trim()));
    expect(request.mock.calls[1][0].prompt).toContain("untrusted data, not instructions");
    expect(onStage.mock.calls[1][0].label).toContain('invalid JSON');
});

test('the file plan states its numeric ceiling and a count rejection gets folding arithmetic, not shortening advice', async () => {
    // Recorded live failure (attempt 59): OpenRouter receives no response
    // schema (FDO parses locally), the rules never stated the number, and the
    // model planned 39 files against a 36 cap — twice. The retry quoted the
    // count but then advised "Shorten descriptions, not the feature set",
    // which cannot change a file count.
    const over = JSON.stringify({files: Array.from({length: 39},
        (_, index) => ({path: `/features/f${index % 4}/module${index}.ts`, contract: `Module ${index} operations.`}))});
    const request = jest.fn().mockResolvedValueOnce(over)
        .mockResolvedValueOnce(JSON.stringify({files: [
            {path: '/a.ts', contract: 'Module A operations.'}, {path: '/b.ts', contract: 'Module B operations.'}]}))
        .mockResolvedValueOnce(file('/a.ts'))
        .mockResolvedValueOnce(file('/b.ts'));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request}))
        .resolves.toContain('### File: /a.ts');
    const initial = request.mock.calls[0][0].prompt;
    expect(initial).toContain('FILE COUNT CEILING');
    expect(initial).toContain('admits at most 24 files');
    const retry = request.mock.calls[1][0].prompt;
    expect(retry).toContain('FILE PLAN VALIDATION RETRY');
    expect(retry).toContain('received 39');
    expect(retry).toContain('Fold at least 15 paths into sibling modules');
    expect(retry).toContain('every requested feature, style and test stays assigned');
    // Recorded live failure (attempt 63): without its own rejected list the
    // model regenerated blind — 44 files both times. The retry now echoes the
    // inventory grouped by directory plus the full path list, so folding has
    // something concrete to revise.
    expect(retry).toContain('grouped by directory:');
    expect(retry).toContain('/features/f0/ ×10');
    expect(retry).toContain('/features/f3/ ×9');
    expect(retry).toContain('Full rejected path list: /features/f0/module0.ts');
    // The fold target itself is arithmetic on the rejected paths: four
    // directories mean one module per directory yields four paths, so the
    // merge has visible headroom rather than being a leap of faith.
    expect(retry).toContain('one module per directory yields 4 paths — well under 24');
    expect(retry).toContain('Merge the paths that share a directory into fewer modules');
    expect(retry).toContain('regenerating a fresh inventory of similar size fails the same count');
    // Recorded live failure (attempt 71): every fact above was present and
    // the model still folded one entry short of the stated delta — the
    // prompt then ENDED on shortening advice. The deciding number is now the
    // last instruction in both the tail and the shared coda.
    // Recorded live failures (attempts 71 and 73): every fold fact plus a
    // recount demand was in the prompt and the model still returned 37 —
    // it cannot count a forty-entry array. The ceiling is now also stated as
    // a per-directory cap whose product is bounded by construction (this
    // fixture has 4 directories: 8 × 4 + 3 = 35), and the initial plan
    // prompt budgets the feature-directory template against the ceiling
    // before the first inventory is ever written.
    expect(retry).toContain('cap every directory at 5 entries');
    expect(retry).toContain('5 × 4 + 3 = 23 at worst, inside 24 by construction');
    expect(retry).toContain('count the returned files array itself: it must read 24 or fewer');
    expect(retry).toContain('build it to that number as you write — a plan one entry over the ceiling is rejected in full');
    expect(retry.indexOf('build it to that number as you write')).toBeGreaterThan(retry.indexOf('count the returned files array itself'));
    expect(initial).toContain('Budget the shape before writing it');
    expect(initial).toContain('Two entries per feature directory');
    expect(retry).not.toContain('Shorten descriptions, not the feature set');
});

test('an over-cap plan response states its exact overage and the arithmetic its retry must cut', async () => {
    // Recorded live failure (attempt 61): the first plan was 7158 chars, the
    // retry cut it to 6107 — 107 over the 6000 cap — but was told only "at
    // most 6000", never how close it was.
    const big = JSON.stringify({files: [{path: '/a.ts', contract: 'x'.repeat(9500)}]});
    expect(big.length).toBeGreaterThan(9000);
    const request = jest.fn().mockResolvedValueOnce(big)
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/a.ts', contract: 'Module A operations.'}]}))
        .mockResolvedValueOnce(file('/a.ts'));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request, workspaceFiles: []}))
        .resolves.toContain('### File: /a.ts');
    const retry = request.mock.calls[1][0].prompt;
    const over = big.length - 9000;
    expect(retry).toContain(`received ${big.length} (${over} over)`);
    expect(retry).toContain(`cut at least ${over} more characters`);
    expect(retry).toContain('File count is already within its ceiling');
    expect(retry).not.toContain('The rejection is the file count itself');
});

test('a non-count plan rejection keeps the description-shortening tail', async () => {
    const request = jest.fn().mockResolvedValueOnce('{invalid JSON')
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/a.ts', contract: 'Module A operations.'}]}))
        .mockResolvedValueOnce(file('/a.ts'));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request}))
        .resolves.toContain('### File: /a.ts');
    expect(request.mock.calls[1][0].prompt).toContain('invalid JSON');
    expect(request.mock.calls[1][0].prompt).toContain('Correct the JSON serialization');
    expect(request.mock.calls[1][0].prompt).toContain('FILE COUNT CEILING');
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

test('enables staged generation for Cloudflare and OpenRouter workspace requests only', () => {
    expect(useStagedWorkspaceGeneration('cloudflare', true)).toBe(true);
    expect(useStagedWorkspaceGeneration('cloudflare', false)).toBe(false);
    expect(useStagedWorkspaceGeneration('openrouter', true)).toBe(true);
    expect(useStagedWorkspaceGeneration('openrouter', false)).toBe(false);
    expect(useStagedWorkspaceGeneration('openai', true)).toBe(false);
});

test('workspace and repair transport are staged for both CLI and API assistants', () => {
    expect(useStagedWorkspaceGeneration('codex-cli', true, ['/new.ts'])).toBe(true);
    expect(useStagedWorkspaceGeneration('codex-cli', true)).toBe(true);
    expect(useStagedWorkspaceGeneration('codex-cli', false)).toBe(false);
    expect(useStagedWorkspaceGeneration('gemini-cli', true, ['/new.ts'])).toBe(true);
    expect(useStagedWorkspaceGeneration('openai', true, ['/new.ts'])).toBe(true);
    expect(useStagedWorkspaceGeneration('openrouter', true, ['/new.ts'])).toBe(true);
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

test('identical plan echoes produce one file in first-occurrence order', () => {
    const a = {path: '/features/a.ts', contract: 'Export a', visualReference: false};
    const b = {path: '/features/b.ts', contract: 'Export b'};
    expect(parseWorkspaceManifest(JSON.stringify({files: [a, b, {...a}, {...b}]}))).toEqual([a, b]);
});

test.each([
    {path: '/A.ts', contract: 'First responsibility', visualReference: false},
    {path: '/a.ts', contract: 'Different responsibility', visualReference: false},
    {path: '/a.ts', contract: 'First responsibility', visualReference: true},
])('conflicting duplicate %# gets one corrective plan request without choosing a contract', async duplicate => {
    const original = {path: '/a.ts', contract: 'First responsibility', visualReference: false};
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [original, duplicate]}))
        .mockResolvedValueOnce(JSON.stringify({files: [original]})).mockResolvedValueOnce(file('/a.ts'));
    expect(await generateStagedWorkspace({prompt: 'Build', request})).toBe(file('/a.ts'));
    expect(request).toHaveBeenCalledTimes(3);
    const retry = request.mock.calls[1][0].prompt;
    expect(retry).toContain('files[0] "/a.ts" and files[1]');
    expect(retry).toContain('Correct the named duplicate entries');
});

test('repeated conflicting duplicates exhaust the existing plan retry', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify({files: [
        {path: '/a.ts', contract: 'First'}, {path: '/a.ts', contract: 'Second'}]}));
    await expect(generateStagedWorkspace({prompt: 'Build', request})).rejects.toThrow('after one retry');
    expect(request).toHaveBeenCalledTimes(2);
});

test.each(['/../host.ts', '/Users/me/host.ts', '/.GIT/config', '/NODE_MODULES/x.ts', '/DIST/out.ts', '/.ENV'])(
    'a duplicate does not conceal unsafe path %s or grant another request', async path => {
        const request = jest.fn().mockResolvedValue(JSON.stringify({files: [
            {path: '/a.ts', contract: 'First'}, {path: '/a.ts', contract: 'Second'}, {path, contract: 'Forbidden'}]}));
        await expect(generateStagedWorkspace({prompt: 'Build', request})).rejects.toThrow(`invalid path at files[2]: ${JSON.stringify(path)}`);
        expect(request).toHaveBeenCalledTimes(1);
    });

test('a corrected split inventory can repeat an identical helper without another retry or regeneration', async () => {
    const retained = {path: '/types.ts', contract: 'Shared types'};
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const helper = {path: '/styles/panel.css', contract: 'Panel styles'};
    const options = budgetedWorkspace(7, [JSON.stringify({files: [retained, root]}), file(retained.path),
        outputLimit(), JSON.stringify({files: [{path: helper.path, contract: ''}]}),
        JSON.stringify({files: [helper, root, {...helper}]}), file(helper.path, '.panel { color: red; }'),
        file(root.path, '@import "./styles/panel.css";')]);
    const result = await generateStagedWorkspace({...options, workspaceFiles: []});
    expect(options.request).toHaveBeenCalledTimes(7);
    expect(result.match(/### File:/g)).toHaveLength(3);
    expect(result.match(/### File: \/styles\/panel.css/g)).toHaveLength(1);
    expect(result.match(/### File: \/types.ts/g)).toHaveLength(1);
    expect(options.request.mock.calls[4][0].prompt).toContain('FILE PLAN VALIDATION RETRY');
});

test('the recorded CSS split discards unrelated conflicting proposals without changing retained modules', async () => {
    const retained = {path: '/features/workbench/actions.ts', contract: 'Retain actions'};
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const css = cssSplitUnrelatedDuplicates.files.filter(item => item.path.endsWith('.css'));
    const options = budgetedWorkspace(12, [JSON.stringify({files: [retained, root]}), file(retained.path),
        outputLimit(), JSON.stringify({files: [{path: '/styles/helper.css', contract: ''}]}),
        JSON.stringify(cssSplitUnrelatedDuplicates), ...css.map(item => file(item.path, '.panel { color: red; }')),
        file(root.path, css.map(item => `@import ".${item.path}";`).join('\n'))]);
    const result = await generateStagedWorkspace({...options, workspaceFiles: []});
    expect(options.request).toHaveBeenCalledTimes(12);
    expect(result.match(/### File:/g)).toHaveLength(8);
    expect(result.match(/### File: \/features\/workbench\/actions.ts/g)).toHaveLength(1);
    expect(result).not.toContain('### File: /features/workbench/catalog.ts');
    expect(result).not.toContain('### File: /render.test.ts');
    // Unrelated duplicates remain a rejection in an initial workspace plan.
    expect(() => parseWorkspaceManifest(JSON.stringify(cssSplitUnrelatedDuplicates))).toThrow('conflicting duplicate paths');
});

test('CSS split scope still checks discarded proposal paths and conflicting CSS contracts', () => {
    expect(() => parseWorkspaceManifest(JSON.stringify({files: [
        {path: '/styles/a.css', contract: 'Valid'}, {path: '/../bad.ts', contract: 'Forbidden'}]}), {cssOnly: true}))
        .toThrow('invalid path at files[1]');
    expect(() => parseWorkspaceManifest(JSON.stringify({files: [
        {path: '/styles/a.css', contract: 'First'}, {path: '/styles/a.css', contract: 'Second'}]}), {cssOnly: true}))
        .toThrow('conflicting duplicate paths');
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
    // Only the corrective round escalates: repeating the budget that just
    // truncated the plan cannot produce a fitting answer, so the retry gets
    // the larger ceiling plus the stated bound it must satisfy.
    expect(request.mock.calls.map(([value]) => value.maxOutputTokens)).toEqual([2048, 4096, 6144, 6144]);
    expect(request.mock.calls[1][0].prompt).toContain('file inventory exceeded its output limit');
    expect(request.mock.calls[1][0].prompt).toContain('9000-character inventory maximum');
    expect(request.mock.calls[1][0].prompt).toContain('omit every unchanged path');
    expect(request.mock.calls[1][0].prompt).not.toContain('OUTPUT-LIMIT RECOVERY');
});

test('reports repeated plan truncation as a planning error with no file requests', async () => {
    const request = jest.fn().mockRejectedValue(outputLimit());
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('file inventory exceeded its response budget');
    expect(request).toHaveBeenCalledTimes(2);
});

test.each(['provider-limit', 'early-size-abort'])('splits an oversized module without regenerating completed files: %s', async failure => {
    const original = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'},
        {path: '/render.ts', contract: 'Export render()'}, {path: '/index.ts', contract: 'Plugin entry'}]});
    const revised = JSON.stringify({files: [{path: '/features/dashboard.ts', contract: 'Export dashboard()'},
        {path: '/render.ts', contract: 'Compose dashboard()'}]});
    const request = jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(file('/types.ts'))
        .mockRejectedValueOnce(failure === 'early-size-abort' ? Object.assign(new Error('too large'), {code: 'CODING_RESPONSE_TOO_LARGE'}) : outputLimit()).mockResolvedValueOnce(revised)
        .mockResolvedValueOnce(file('/features/dashboard.ts')).mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(result).toBe(['/types.ts', '/features/dashboard.ts', '/render.ts', '/index.ts'].map(path => file(path)).join('\n\n'));
    expect(request.mock.calls[3][0].prompt).toContain('MODULE SPLIT REQUIRED');
    expect(request.mock.calls[3][0].prompt).toContain(file('/types.ts'));
    expect(request.mock.calls[5][0].prompt).toContain(file('/features/dashboard.ts'));
});

test.each([
    [{path: '/render.ts', contract: 'Still monolithic'}],
    [{path: '/types.ts', contract: 'Overwrite completed'}, {path: '/render.ts', contract: 'Render'}],
    [{path: '/index.ts', contract: 'Overwrite pending'}, {path: '/render.ts', contract: 'Render'}],
].map(entries => [entries]))('rejects repeated splits containing only retained paths and no new helper', async entries => {
    const original = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'}, ...JSON.parse(manifest).files]});
    const request = jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(file('/types.ts'))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValue(JSON.stringify({files: entries}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('Cannot split');
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[4][0].prompt).toContain('FOCUSED MODULE DECOMPOSITION RETRY');
});

test('a module split still receives its corrective retry after the initial plan spent its own', async () => {
    const original = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'},
        {path: '/render.ts', contract: 'Export render()'}, {path: '/index.ts', contract: 'Plugin entry'}]});
    // The split introduces a case collision with /types.ts; its corrective
    // retry must remain available after an initial-plan correction.
    const badSplit = JSON.stringify({files: [{path: '/Types.ts', contract: 'Overwrite completed'},
        {path: '/features/dashboard.ts', contract: 'Export dashboard()'}]});
    const goodSplit = JSON.stringify({files: [{path: '/features/dashboard.ts', contract: 'Export dashboard()'},
        {path: '/render.ts', contract: 'Compose dashboard()'}]});
    const request = jest.fn().mockResolvedValueOnce(recordedInvalidManifest).mockResolvedValueOnce(original)
        .mockResolvedValueOnce(file('/types.ts'))
        .mockRejectedValueOnce(outputLimit()) // /render.ts exceeds its response budget.
        .mockResolvedValueOnce(badSplit).mockResolvedValueOnce(goodSplit)
        .mockResolvedValueOnce(file('/features/dashboard.ts')).mockResolvedValueOnce(file('/render.ts'))
        .mockResolvedValueOnce(file('/index.ts'));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(result).toContain('### File: /index.ts');
    expect(request).toHaveBeenCalledTimes(9);
    expect(request.mock.calls[4][0].prompt).toContain('MODULE SPLIT REQUIRED');
    expect(request.mock.calls[5][0].prompt).toContain('FILE PLAN VALIDATION RETRY');
    expect(request.mock.calls[5][0].prompt).toContain('retained by the host');
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
    expect(request.mock.calls[2][0].prompt).toContain('Only CSS entries are admitted for this split');
    expect(request.mock.calls[5][0].prompt).toContain('must fit within 1536 output tokens');
    expect(result).toContain(root);
});

// Exercise the actual live-test accounting, including already spent requests.
function budgetedWorkspace(limit, responses) {
    jest.resetModules();
    const {reserveLiveAiTestRequest, assertLiveAiTestRequestsAvailable} = require('../../src/utils/ai/testing/liveAiTestBudget');
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
        expect(options.request.mock.calls[0][0].responseSchema.properties.files.maxItems).toBe(24);
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
    const initialSchema = {...WORKSPACE_MANIFEST_SCHEMA, properties: {...WORKSPACE_MANIFEST_SCHEMA.properties,
        files: {...WORKSPACE_MANIFEST_SCHEMA.properties.files, maxItems: 24}}};
    expect(request.mock.calls.map(([request]) => request.responseSchema)).toEqual([
        initialSchema, initialSchema, workspaceFileSchema('/render.ts'), workspaceFileSchema('/index.ts'),
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
            // Recorded live failure (attempt 72): a stylesheet returned bare
            // CSS twice while the fence rule sat mid-prompt — the request
            // ended on budget and content advice instead. The exact shape is
            // now the request's final statement.
            expect(options.prompt.trim().endsWith('no JSON, file heading, prose or second fence anywhere.')).toBe(true);
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
        reason: expect.stringContaining('invalid JSON'),
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
        .mockResolvedValueOnce(repeats ? invalid : valid)
        // An identical second source rejection earns one flagged final round.
        .mockResolvedValueOnce(repeats ? invalid : valid);
    return (async () => {
        const result = generateStagedWorkspace({prompt: 'Build categories', request});
        if (repeats) await expect(result).rejects.toThrow(`after repeated repairs of ${path} (source validation)`);
        else await expect(result).resolves.toBe(`### File: ${path}\n${valid}`);
        expect(request).toHaveBeenCalledTimes(repeats ? 5 : 4);
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
    expect.assertions(3);
    const invalid = '{\n  "path": "/a.ts",\n  "lines": ["export const x = "sensitive-source";"]\n}';
    try {
        validateWorkspaceFile(invalid, '/a.ts');
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
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(JSON.stringify({files: [{...helper, contract: 'Conflicting layout'}, helper]}))
        .mockResolvedValueOnce(valid).mockResolvedValueOnce(file(helper.path, '.shell { display: grid; }'))
        .mockResolvedValueOnce(file(root.path, '@import "./styles/layout.css";'))
        .mockResolvedValueOnce(file(entry.path));
    const result = await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request).toHaveBeenCalledTimes(8);
    expect(result).toBe([file(types.path), file(helper.path, '.shell { display: grid; }'),
        file(root.path, '@import "./styles/layout.css";'), file(entry.path)].join('\n\n'));
    const retry = request.mock.calls[4][0];
    expect(retry.prompt).toContain('conflicting duplicate paths');
    expect(retry.prompt).toContain('FILE PLAN VALIDATION RETRY');
    expect(retry.responseSchema.properties.files).toMatchObject({minItems: 1, maxItems: 12});
    expect(request.mock.calls[7][0].prompt).toContain(JSON.stringify(entry));
    expect(request.mock.calls.filter(([options]) => options.responseSchema.properties.path?.enum[0] === '/types.ts')).toHaveLength(1);
});

test('a split reply that verbatim-echoes host-retained listings is filtered instead of rejected', async () => {
    const types = {path: '/types.ts', contract: 'Shared types'};
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const entry = {path: '/index.ts', contract: 'Plugin entry'};
    const helper = {path: '/styles/base.css', contract: 'Base tokens'};
    // The split prompt prints retained listings as JSON, so models copy them
    // back verbatim alongside their real helpers. That echo carries no
    // rewrite — filtering it must not spend the corrective retry.
    const echo = JSON.stringify({files: [types, entry, helper]});
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [types, root, entry]}))
        .mockResolvedValueOnce(file(types.path))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(echo)
        .mockResolvedValueOnce(file(helper.path, '.base { color: teal; }'))
        .mockResolvedValueOnce(file(root.path, '@import "./styles/base.css";'))
        .mockResolvedValueOnce(file(entry.path));
    const result = await generateStagedWorkspace({prompt: 'Build styles', request});
    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls[3][0].prompt).not.toContain('FILE PLAN VALIDATION RETRY');
    expect(result).toBe([file(types.path), file(helper.path, '.base { color: teal; }'),
        file(root.path, '@import "./styles/base.css";'), file(entry.path)].join('\n\n'));
    // Only the genuinely new path became a helper; echoed retained entries
    // kept their host-owned position and were not scheduled twice.
    expect(result.match(/### File: \/index\.ts/g)).toHaveLength(1);
    expect(result.match(/### File: \/types\.ts/g)).toHaveLength(1);
});

test('a correction-pass stylesheet split reuses an existing workspace stylesheet without regenerating it', async () => {
    // Recorded live failure: in the Problems-panel correction pass the only
    // files completed so far are non-CSS, so the split reply had no reuse
    // target at all and both attempts came back as listing echoes.
    const base = {path: '/styles/base.css', content: '.base { color: navy; }'};
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const entry = {path: '/index.ts', contract: 'Plugin entry'};
    const extra = {path: '/styles/extra.css', contract: 'Extra rules'};
    const plan = JSON.stringify({files: [root, entry]});
    const splitReply = JSON.stringify({files: [root, {path: base.path, contract: 'Base tokens'}, extra]});
    const request = jest.fn()
        .mockResolvedValueOnce(plan)
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(splitReply)
        .mockResolvedValueOnce(file(extra.path, '.extra { color: teal; }'))
        .mockResolvedValueOnce(file(root.path, '@import "./styles/base.css";\n@import "./styles/extra.css";'))
        .mockResolvedValueOnce(file(entry.path));
    const result = await generateStagedWorkspace({prompt: 'Build styles', request, workspaceFiles: [base]});
    expect(result).toBe([file(extra.path, '.extra { color: teal; }'),
        file(root.path, '@import "./styles/base.css";\n@import "./styles/extra.css";'), file(entry.path)].join('\n\n'));
    // The existing stylesheet is offered as a reuse target and the
    // acceptance rule ends the split instructions.
    const splitPrompt = request.mock.calls[2][0].prompt;
    expect(splitPrompt).toContain('Reusable CSS dependencies (exact paths');
    expect(splitPrompt).toContain('"/styles/base.css"');
    expect(splitPrompt).toContain('VALIDATION RULE');
    // Host-retained existing files are never scheduled for regeneration.
    expect(request.mock.calls.some(([options]) =>
        options.responseSchema?.properties?.path?.enum?.[0] === '/styles/base.css')).toBe(false);
    expect(result).not.toContain('.base { color: navy; }');
});

test('a split reply whose entries are all echoes is rejected with the exact missing proposal', async () => {
    const types = {path: '/types.ts', contract: 'Shared types'};
    const entry = {path: '/index.ts', contract: 'Plugin entry'};
    const plan = JSON.stringify({files: [types, entry]});
    const echo = JSON.stringify({files: [types]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(echo)
        .mockResolvedValue(echo);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request}))
        .rejects.toThrow('echoes propose nothing');
    // Round one already carries the acceptance rule...
    expect(request.mock.calls[2][0].prompt).toContain('VALIDATION RULE');
    // The only retry now requests responsibilities rather than another inventory.
    const retry = request.mock.calls[3][0].prompt;
    expect(retry).toContain('FOCUSED MODULE DECOMPOSITION RETRY');
    expect(retry).toContain('unused sibling .ts paths');
    expect(retry).toContain('Do not return a files array');
    expect(retry).not.toContain('Shorten descriptions, not the feature set');
    expect(request.mock.calls[3][0].responseSchema.required).toEqual(['helpers']);
});

test('a stylesheet split echo retry requests responsibilities instead of another full inventory', async () => {
    // Recorded live failure (attempt 74): after a successful first split,
    // the composition of /features/styles/features.css exceeded its budget
    // again; the second split's corrective retry fell through to the
    // shortening default while the message demanded a path "nowhere
    // above" — excluding the reusable-CSS option a stylesheet reply may
    // legitimately use — and the model answered with a 144-character echo.
    const layout = {path: '/styles/layout.css', contract: 'Shell layout'};
    const entry = {path: '/index.ts', contract: 'Plugin entry'};
    const plan = JSON.stringify({files: [layout, entry]});
    const echo = JSON.stringify({files: [layout]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(echo)
        .mockResolvedValue(echo);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request}))
        .rejects.toThrow('expected 1–12 helpers, not file paths');
    const retry = request.mock.calls[3][0].prompt;
    expect(retry).not.toContain('Shorten descriptions, not the feature set');
    expect(retry).toContain('FOCUSED CSS DECOMPOSITION RETRY');
    expect(retry).not.toContain('STAGED WORKSPACE GENERATION — FILE PLAN ONLY');
    expect(request.mock.calls[3][0].responseSchema.required).toEqual(['helpers']);
});

test('an import-only repair states that imports the rejections do not name must be reproduced exactly', async () => {
    // Recorded live failure: round one rejected only "./plugin", and the
    // single repair repointed those names at "./index", which never exported
    // them — trading one rejection for another.
    const plan = JSON.stringify({files: [{path: '/render.tsx', contract: 'Render the workbench'}]});
    const broken = 'import { metadata } from "./plugin";\nexport const render = metadata;';
    const fixed = 'const metadata = 1;\nexport const render = metadata;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/render.tsx', broken))
        .mockResolvedValueOnce(file('/render.tsx', fixed));
    const result = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(result).toBe(file('/render.tsx', fixed));
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('Every rejection above failed import validation');
    // The preservation rule sits with the recency facts, after the rejected
    // source itself, and no cross-file contract accompanies it here.
    expect(retry).toContain('every import these rejections do not name must be reproduced exactly — same specifier and same imported names');
    expect(retry.indexOf('IMPORT PRESERVATION')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry).not.toContain('RE-VALIDATION CONTRACT');
    // The selection rule travels with every import-only repair: the choice
    // must come verbatim from the rejection's own export list and reach
    // every use (attempt 77: ten mismatches, a near-no-op repair, then a
    // suffix-strip into names that appeared in none of the listed sets).
    expect(retry).toContain('the replacement is verbatim one of the exports that same rejection lists');
    expect(retry).toContain('every use of the old name in this file');
});

test('an export-mismatch repair receives the exact export list and the choice rule together', async () => {
    // Recorded live failure (attempt 77): /features/categories/render.ts
    // carried ten simultaneous export mismatches; the first repair echoed,
    // the second stripped "Workspace" suffixes into bare names that matched
    // none of the stated exports, and the source budget died.
    const dep = {path: '/features/data/render.ts', contract: 'Render the data workspace'};
    const consumer = {path: '/features/categories/render.ts', contract: 'Render categories'};
    const plan = JSON.stringify({files: [dep, consumer]});
    const broken = 'import { renderDataWorkspace } from "../data/render";\nexport const categories = () => renderDataWorkspace();';
    const fixed = 'import { render } from "../data/render";\nexport const categories = () => render();';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file(dep.path, 'export const render = () => "data";'))
        .mockResolvedValueOnce(file(consumer.path, broken))
        .mockResolvedValueOnce(file(consumer.path, fixed));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .resolves.toContain(`### File: ${consumer.path}`);
    const retry = request.mock.calls[3][0].prompt;
    expect(retry).toContain('does not export renderDataWorkspace');
    expect(retry).toContain('It exports render');
    expect(retry).toContain('the replacement is verbatim one of the exports that same rejection lists');
    expect(retry).toContain('never a name formed from the module path or your original import');
    expect(retry).toContain('every use of the old name in this file');
});

test('plan requests carry the plan-stage marker and file requests do not', async () => {
    // The stage marker describes the request; it does not override the
    // assistant's thinking preference.
    const plan = JSON.stringify({files: [{path: '/index.ts', contract: 'Entry module'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/index.ts', 'export const entry = 1;'));
    await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(request.mock.calls[0][0].planStage).toBe(true);
    expect(request.mock.calls[1][0].planStage).toBeUndefined();
});

test('a stylesheet written as a style-map literal gets the plain-CSS conversion in its one repair', async () => {
    // Recorded live failure: render.tsx consumed css.shell, and the model
    // answered with JavaScript object literals inside the .css file — both
    // rounds died on the same object-literal token.
    const plan = JSON.stringify({files: [{path: '/styles.css', contract: 'Structural styles'}]});
    const wrong = 'export const shell = {\n  background: \'#17302e\',\n  \'& button\': {\n    cursor: \'pointer\',\n  },\n};';
    const fixed = '.shell {\n  background: #17302e;\n}\n.shell button {\n  cursor: pointer;\n}';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/styles.css', wrong))
        .mockResolvedValueOnce(file('/styles.css', fixed));
    const result = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(result).toBe(file('/styles.css', fixed));
    // Round one already states the format contract where the model reads...
    expect(request.mock.calls[1][0].prompt).toContain('Write plain CSS: @import lines followed by rules of real selectors');
    expect(request.mock.calls[1][0].prompt).toContain('what makes css.shell exist');
    // ...and the repair names the exact conversion after the rejected source.
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('STYLE-MAP CONVERSION');
    expect(retry.indexOf('STYLE-MAP CONVERSION')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry).toContain('"export const shell = {" becomes ".shell {"');
});

test('an import repair of a file with required exports carries the export contract after the rejected source', async () => {
    // Recorded live failure: the single repair fixed four invented import
    // paths but returned an imports-only stub, and /index.ts's immutable
    // {render} import failed cross-file validation with no repair left.
    const plan = JSON.stringify({files: [
        {path: '/index.ts', contract: 'Plugin entry importing render'},
        {path: '/render.tsx', contract: 'Render the workbench'}]});
    const index = 'import { render } from "./render";\nexport const run = () => render();';
    const broken = 'import { renderDashboard } from "./features/dashboard/dashboard";\nexport const render = () => null;';
    const stub = 'import { bindActions } from "./features/actions/actions";\nimport css from "./styles.css";';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/index.ts', index))
        .mockResolvedValueOnce(file('/render.tsx', broken))
        .mockResolvedValueOnce(file('/render.tsx', stub));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('does not export render');
    const retry = request.mock.calls[3][0].prompt;
    expect(retry).toContain('EXPORT CONTRACT');
    expect(retry.indexOf('EXPORT CONTRACT')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry).toContain('export every required name ["render"]');
    expect(retry).toContain('a reply containing only import statements exports nothing');
    expect(retry).not.toContain('RE-VALIDATION CONTRACT');
});

test('the staged plan prompt closes with the inventory response shape, after any embedded section demand', async () => {
    // Recorded live failure: the problems-repair prompt ends with a concrete
    // fenced "### File:" template, and both the initial plan and its escalated
    // 4096-token retry streamed section-shaped output until the response
    // budget cut them off mid-stream.
    const inventory = JSON.stringify({files: [{path: '/a.ts', contract: 'Export a value'}]});
    const sectionDemand = 'Return ONLY complete executable workspace file sections:\n### File: /path/to/file\n```typescript\n...complete file content...\n```';
    const request = jest.fn()
        .mockResolvedValueOnce('### File: /a.ts\n```typescript\nexport {};\n```')
        .mockResolvedValueOnce(inventory)
        .mockResolvedValueOnce(file('/a.ts', 'export {};'));
    const result = await generateStagedWorkspace({prompt: sectionDemand, request, workspaceFiles: []});
    expect(result).toBe(file('/a.ts', 'export {};'));
    // Round one: the closing shape is the last instruction, after the demand.
    const first = request.mock.calls[0][0].prompt;
    expect(first).toContain('RESPONSE SHAPE');
    expect(first).toContain('section-shaped output is discarded before parsing');
    expect(first.indexOf('RESPONSE SHAPE')).toBeGreaterThan(first.indexOf('Return ONLY complete executable workspace file sections'));
    // Round two: the corrective block also precedes the closing shape.
    const retry = request.mock.calls[1][0].prompt;
    expect(retry).toContain('FILE PLAN VALIDATION RETRY');
    expect(retry.indexOf('RESPONSE SHAPE')).toBeGreaterThan(retry.indexOf('FILE PLAN VALIDATION RETRY'));
    expect(retry.lastIndexOf('RESPONSE SHAPE')).toBeGreaterThan(retry.lastIndexOf('### File:'));
});

test('an entry-file import repair carries the plugin-entry shape and forbids an imports-only reply', async () => {
    // Recorded live failure: round one rejected only an invented metadata
    // import; the single repair fixed it but returned three import lines and
    // nothing else — the class was gone, and the file had no repair left.
    const plan = JSON.stringify({files: [
        {path: '/index.ts', contract: 'Plugin entry importing render'},
        {path: '/render.tsx', contract: 'Render the workbench'}]});
    const entry = "import { FDO_SDK, FDOInterface, PluginMetadata } from '@anikitenko/fdo-sdk';\n"
        + "import { metadata } from './features/dashboard/metadata';\n"
        + "export class Workbench extends FDO_SDK implements FDOInterface {\n"
        + "  readonly metadata: PluginMetadata = {name: 'Workbench', icon: 'applications'};\n"
        + "  render() { return ''; }\n}\nnew Workbench();";
    const stub = "import { FDO_SDK, FDOInterface, PluginMetadata } from '@anikitenko/fdo-sdk';\n"
        + "import { render } from './render';";
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/index.ts', entry))
        .mockResolvedValueOnce(file('/index.ts', stub));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('has no executable plugin class');
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('PLUGIN ENTRY SHAPE');
    expect(retry.indexOf('PLUGIN ENTRY SHAPE')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry).toContain('module-scope instantiation');
    // The completeness rule is the last corrective fact the model reads.
    expect(retry.lastIndexOf('is an incomplete file')).toBeGreaterThan(
        retry.lastIndexOf('A response identical to the rejected source'));
});

test('a syntax-only repair inventories the rejected source\'s import specifiers instead of editing them', async () => {
    // Recorded live failure: round one rejected only a missing semicolon, and
    // the single repair changed "./styles.css" to "./styles" — a fresh import
    // rejection consumed the file's only repair round.
    const plan = JSON.stringify({files: [
        {path: '/render.tsx', contract: 'Render the workbench'},
        {path: '/styles.css', contract: 'Structural styles'},
        {path: '/logic.ts', contract: 'Workbench logic'}]});
    const broken = 'import css from "./styles.css";\nimport {run} from "./logic";\nexport const render = () => {\n  return run();\n';
    const repointed = 'import css from "./styles";\nimport {run} from "./logic";\nexport const render = () => run();';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/render.tsx', broken))
        .mockResolvedValueOnce(file('/render.tsx', repointed));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('resolves to "/styles"');
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('IMPORT INVENTORY');
    expect(retry).toContain('exactly these source specifiers, in order: ./styles.css, ./logic');
    expect(retry).toContain('add no specifier absent from this list');
    expect(retry.indexOf('IMPORT INVENTORY')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry.indexOf('The rejections to fix, restated after the source:')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
});

test('an ambiguous filename repair restates its rejections after the embedded source, tail-match fixes included', async () => {
    // Recorded live failure: a wrong-depth @import rejection told the model
    // exactly which specifier to write; the single repair changed the file but
    // kept its own import — anchored on the embedded source over the note
    // that sat above it.
    const plan = JSON.stringify({files: [
        {path: '/features/library/styles/library.css', contract: 'Library styles'},
        {path: '/features/workspace/styles/workspace.css', contract: 'Workspace styles'}]});
    const wrong = "@import './../workspace/styles/workspace.css';\n.shell { color: red; }";
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/features/library/styles/library.css', wrong))
        .mockResolvedValueOnce(file('/features/library/styles/library.css', wrong))
        // An identical second rejection earns one flagged final round; the
        // third identical reply exhausts it and fails as repeated repairs.
        .mockResolvedValueOnce(file('/features/library/styles/library.css', wrong));
    // Another known workspace.css prevents automatic basename correction.
    await expect(generateStagedWorkspace({prompt: 'Build', request,
        workspaceFiles: [{path: '/other/workspace.css', content: '.other { color: blue; }'}]}))
        .rejects.toThrow('after repeated repairs of /features/library/styles/library.css');
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('The rejections to fix, restated after the source:');
    // The exact specifier fix appears again, after the source the model anchors on.
    expect(retry.lastIndexOf('write "../../workspace/styles/workspace.css"'))
        .toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry.indexOf('The rejections to fix, restated after the source:'))
        .toBeGreaterThan(retry.indexOf('IMPORT PRESERVATION'));
});

test('an identical repeat rejection earns one flagged final round and then fails as exhausted', async () => {
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}, {path: '/b.ts', contract: 'B'}]});
    const bad = 'import {x} from "./missing";\nexport const a = x;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', bad))
        .mockResolvedValueOnce(file('/a.ts', bad))
        .mockResolvedValueOnce(file('/a.ts', bad));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('after repeated repairs of /a.ts');
    expect(request).toHaveBeenCalledTimes(4);
    // The ordinary repair carries no repeat notice; the flagged round does,
    // and it stays ordered before the restated rejections it refers to.
    expect(request.mock.calls[2][0].prompt).not.toContain('REPEAT REJECTION');
    const third = request.mock.calls[3][0].prompt;
    expect(third).toContain('REPEAT REJECTION');
    expect(third.indexOf('REPEAT REJECTION'))
        .toBeLessThan(third.indexOf('The rejections to fix, restated after the source:'));
});

test('a flagged repeat round that applies the notes converges and completes the workspace', async () => {
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}, {path: '/b.ts', contract: 'B'}]});
    const bad = 'import {x} from "./missing";\nexport const a = x;';
    const fixed = 'export const a = 1;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', bad))
        .mockResolvedValueOnce(file('/a.ts', bad))
        .mockResolvedValueOnce(file('/a.ts', fixed))
        .mockResolvedValueOnce(file('/b.ts', 'export const b = 1;'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .resolves.toContain('export const b = 1;');
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[3][0].prompt).toContain('REPEAT REJECTION');
});

test('a changed second source rejection earns one flagged final round that the shared budget then exhausts', async () => {
    // Recorded live failure (attempt 55): a file with two independent syntax
    // defects — the parser reports only the first — fixed defect one, was
    // shown defect two, and had no repair left. A rejection that differs from
    // the previous one now earns the same single extra round an identical
    // repeat gets; a further rejection still fails.
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}]});
    const first = 'export const a = ;';
    const second = 'export const a = 1;\nexport const broken = ;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', first))
        .mockResolvedValueOnce(file('/a.ts', second))
        // A rejection identical to the previous one must NOT open a second
        // extra round: repeat and progression share one budget per path.
        .mockResolvedValueOnce(file('/a.ts', second));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('after repeated repairs of /a.ts');
    expect(request).toHaveBeenCalledTimes(4);
    // The ordinary repair carries no progression notice; the flagged round
    // does, ordered before the restated rejections it refers to.
    expect(request.mock.calls[2][0].prompt).not.toContain('PROGRESSED REJECTION');
    expect(request.mock.calls[2][0].prompt).not.toContain('REPEAT REJECTION');
    const third = request.mock.calls[3][0].prompt;
    expect(third).toContain('PROGRESSED REJECTION');
    expect(third).not.toContain('REPEAT REJECTION');
    expect(third.indexOf('PROGRESSED REJECTION'))
        .toBeLessThan(third.indexOf('The rejections to fix, restated after the source:'));
});

test('a progression round that corrects the newly surfaced defect completes the workspace', async () => {
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', 'export const a = ;'))
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;\nexport const broken = ;'))
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .resolves.toContain('export const a = 1;');
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3][0].prompt).toContain('PROGRESSED REJECTION');
});

test('a format intervention returns the one extra source round as a second episode', async () => {
    // Recorded live failure (attempt 58): source defect A, changed defect B
    // (extra round spent), then a format failure — the envelope repair
    // regenerated the response — and the first source rejection after that
    // intervention died on the exhausted source allowance instead of being
    // answered. The format grant re-arms the extra round only; the base
    // repair stays spent, so the post-format rejection still flows through
    // the progression gate and gets exactly one flagged final round.
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', 'export const a = ;'))                                   // source A → plain repair
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;\nexport const b = ;'))              // source B (changed) → extra round
        .mockResolvedValueOnce('{invalid JSON')                                                       // format → intervention, allowance returns
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = ;')) // source C → progression re-granted
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .resolves.toContain('export const a = 1;');
    expect(request).toHaveBeenCalledTimes(6);
    expect(request.mock.calls[3][0].prompt).toContain('PROGRESSED REJECTION');
    expect(request.mock.calls[5][0].prompt).toContain('PROGRESSED REJECTION');
});

test('a second episode exhausts its single extra round and then fails as repeated repairs', async () => {
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', 'export const a = ;'))
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;\nexport const b = ;'))
        .mockResolvedValueOnce('{invalid JSON')
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = ;'))
        // The episode's flagged final round still fails: no third episode —
        // only a format grant re-arms, and the format repair is spent.
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = ;'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('after repeated repairs of /a.ts');
    expect(request).toHaveBeenCalledTimes(6);
});

test('a rejection that keeps changing keeps earning rounds until the four-response cap', async () => {
    // Recorded live failure (attempt 68): /index.ts migrated its defect every
    // round — merged metadata lines, then an unresolvable import, then a stray
    // quote — each reply fixing exactly what the last one stated, fatal on the
    // third defect with complete diagnostics and no round left to answer them.
    // Progressions now stack while the path stays within four source responses.
    const plan = JSON.stringify({files: [{path: '/index.ts', contract: 'A'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/index.ts', 'export const a = ;'))
        .mockResolvedValueOnce(file('/index.ts', 'import "./missing";\nexport const a = 1;'))
        .mockResolvedValueOnce(file('/index.ts', 'export const a = 1;\nexport const b = ;'))
        .mockResolvedValueOnce(file('/index.ts', 'export const a = 1;\nexport const b = 2;'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .resolves.toContain('export const b = 2;');
    expect(request).toHaveBeenCalledTimes(5);
    // The first progression does not claim finality; the one at the cap does.
    expect(request.mock.calls[3][0].prompt).toContain('PROGRESSED REJECTION');
    expect(request.mock.calls[3][0].prompt).toContain('earns exactly one more corrective round');
    expect(request.mock.calls[4][0].prompt).toContain("This is the file's final corrective round");
});

test('a fifth source response is never sent: the four-response cap fails the file', async () => {
    const plan = JSON.stringify({files: [{path: '/index.ts', contract: 'A'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/index.ts', 'export const a = ;'))
        .mockResolvedValueOnce(file('/index.ts', 'import "./missing";\nexport const a = 1;'))
        .mockResolvedValueOnce(file('/index.ts', 'export const a = 1;\nexport const b = ;'))
        .mockResolvedValueOnce(file('/index.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = ;'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .rejects.toThrow('after repeated repairs of /index.ts');
    expect(request).toHaveBeenCalledTimes(5);
});

test('a round rejected for both an import and a source defect instructs fixing both, never preserving the flagged import', async () => {
    // Defect family closed with the attempt-69 budget fix: a mixed round fell
    // into the syntax branch, whose "flag no import" claim told the model to
    // reproduce verbatim the specifier the very same fileIssue rejects — a
    // contradiction no reply can satisfy. Parse failures suppress import
    // analysis, so the reachable mixed round pairs a semantic rejection (an
    // entry that parses but never instantiates its plugin) with an import
    // rejection in the same reply.
    const plan = JSON.stringify({files: [{path: '/index.ts', contract: 'Plugin entry.'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/index.ts', 'import "./missing";\nclass Plugin extends FDO_SDK {}'))
        .mockResolvedValueOnce(file('/index.ts', 'class Plugin extends FDO_SDK {}\nnew Plugin();'));
    await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}))
        .resolves.toContain('new Plugin();');
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('FILE VALIDATION RETRY');
    expect(retry).toContain('name both import failures and source defects');
    expect(retry).not.toContain('flag no import');
});

test('an accepted file\u2019s repair history cannot leak into the next file\u2019s format repair or fatal', async () => {
    // Recorded live failure (attempt 60): sourceIssue was reset nowhere on
    // file completion, so a completed file's resolved rejection (an export
    // contract already fixed) was merged into the NEXT file's first format
    // rejection — the repair prompt quoted phantom diagnostics about other
    // files instead of the fence defect it had to fix.
    const plan = JSON.stringify({files: [
        {path: '/a.ts', contract: 'Module A.'}, {path: '/b.ts', contract: 'Module B.'}]});
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', 'import { x } from "./missing";')) // source rejection \u2192 repair
        .mockResolvedValueOnce(file('/a.ts'))                                   // accepted: history must die here
        .mockResolvedValueOnce(file('/wrong.ts'))                              // /b.ts heading mismatch (format)
        .mockResolvedValueOnce(file('/wrong.ts'));                             // second failure \u2192 format fatal
    const failure = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}).catch(error => error);
    expect(failure.message).toContain('after one repair of /b.ts');
    expect(failure.message).not.toContain('has no file in the workspace');
    expect(failure.message).toContain('heading does not match');
    const repair = request.mock.calls[4][0].prompt;
    expect(repair).toContain('FILE VALIDATION RETRY');
    expect(repair).toContain('heading does not match');
    expect(repair).not.toContain('has no file in the workspace');
    expect(request).toHaveBeenCalledTimes(5);
});

test('fence-failure diagnostics state exactly what the parser found', () => {
    expect(() => validateWorkspaceFile('Here is the source: export const a = 1;', '/a.ts', {allowSourceFence: true}))
        .toThrow('no ``` fence line at all');
    expect(() => validateWorkspaceFile('```ts\nexport const a = 1;', '/a.ts', {allowSourceFence: true}))
        .toThrow('1 fence line (line 1) but no closed block');
    expect(() => validateWorkspaceFile('```ts\nexport const a = 1;\n```\ntext\n```js\nconst b = 2;\n```', '/a.ts', {allowSourceFence: true}))
        .toThrow('2 closed blocks');
});

test('the one-block-plus-shape-violation rejection names the fences, headings and their lines', () => {
    // Recorded live failure (attempt 69): a single closed block accompanied
    // by stray fences or conflicting file headings was rejected with a bare
    // three-way label, its repair lead claimed a JSON envelope failure for a
    // response that was never JSON, and the only format repair repeated the
    // same 6,100-character response byte-for-byte.
    expect(() => validateWorkspaceFile('```ts\nexport {};\n```\n### File: /other.ts', '/a.ts', {allowSourceFence: true}))
        .toThrow('1 file heading ("/other.ts" at line 4)');
    expect(() => validateWorkspaceFile('### File: /other.ts (changed)\n```ts\nexport {};\n```', '/a.ts', {allowSourceFence: true}))
        .toThrow('naming "/a.ts"');
    expect(() => validateWorkspaceFile('~~~\nnotes\n~~~\n```ts\nexport {};\n```', '/a.ts', {allowSourceFence: true}))
        .toThrow('2 fence lines outside the block');
    expect(() => validateWorkspaceFile('Explanation with ``` inside\n```ts\nexport {};\n```', '/a.ts', {allowSourceFence: true}))
        .toThrow('1 fence marker appears in the surrounding prose');
});

test('a permanent source failure quotes the offending lines from the rejected body', async () => {
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'A'}, {path: '/b.ts', contract: 'B'}]});
    const broken = 'export const a = 1;\nexport const broken = ;\nexport const c = 3;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', broken))
        .mockResolvedValueOnce(file('/a.ts', broken))
        .mockResolvedValueOnce(file('/a.ts', broken));
    const error = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []}).catch(reason => reason);
    expect(error.message).toContain('after repeated repairs of /a.ts');
    // Positions alone cannot diagnose a reply that repeats the defect: the
    // fatal error carries the surrounding lines of the rejected source.
    expect(error.message).toContain('Rejected source around line 2:');
    expect(error.message).toContain('2: export const broken = ;');
});

test('a retained split echo that omits only visualReference is filtered, not rejected', async () => {
    // Recorded live failure: the model echoed a retained entry with its
    // path and contract verbatim but dropped the optional visualReference
    // flag, and the strict equality spent both split attempts. The flag is
    // inert in a reply — the host keeps its own scheduling entry.
    const types = {path: '/types.ts', contract: 'Shared types', visualReference: false};
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const entry = {path: '/index.ts', contract: 'Plugin entry'};
    const helper = {path: '/styles/base.css', contract: 'Base tokens'};
    const droppedFlag = JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'}, helper]});
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [types, root, entry]}))
        .mockResolvedValueOnce(file(types.path))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(droppedFlag)
        .mockResolvedValueOnce(file(helper.path, '.base { color: teal; }'))
        .mockResolvedValueOnce(file(root.path, '@import "./styles/base.css";'))
        .mockResolvedValueOnce(file(entry.path));
    const result = await generateStagedWorkspace({prompt: 'Build styles', request});
    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls[3][0].prompt).not.toContain('FILE PLAN VALIDATION RETRY');
    expect(result).toBe([file(types.path), file(helper.path, '.base { color: teal; }'),
        file(root.path, '@import "./styles/base.css";'), file(entry.path)].join('\n\n'));
    expect(result.match(/### File: \/types\.ts/g)).toHaveLength(1);
});

test.each(['paraphrased', 'conflicting duplicates', 'invalid annotations'])(
    'split proposals ignore %s on exact retained paths without spending a retry', async kind => {
        const types = {path: '/types.ts', contract: 'Shared types', visualReference: false};
        const root = {path: '/render.ts', contract: 'Export render()'};
        const entry = {path: '/index.ts', contract: 'Plugin entry', visualReference: false};
        const workspaceFiles = [{path: '/existing.ts', content: 'export const original = true;'}];
        const helper = {path: '/features/dashboard.ts', contract: 'Export dashboard()'};
        const echoes = [types, root, entry, workspaceFiles[0]].flatMap(item => {
            const echo = {path: item.path, contract: 'UNAUTHORIZED_REWRITE', visualReference: true};
            return kind === 'conflicting duplicates' ? [echo, {...echo, contract: 'SECOND_REWRITE'}]
                : kind === 'invalid annotations' ? [{path: item.path, contract: null, visualReference: 'invalid'}] : [echo];
        });
        const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [types, root, entry]}))
            .mockResolvedValueOnce(file(types.path)).mockRejectedValueOnce(outputLimit())
            .mockResolvedValueOnce(JSON.stringify({files: [...echoes, helper]}))
            .mockResolvedValueOnce(file(helper.path)).mockResolvedValueOnce(file(root.path))
            .mockResolvedValueOnce(file(entry.path));
        const result = await generateStagedWorkspace({prompt: 'Build plugin', request, workspaceFiles});
        expect(request).toHaveBeenCalledTimes(7);
        expect(result).toBe([types, helper, root, entry].map(item => file(item.path)).join('\n\n'));
        for (const [options] of request.mock.calls.slice(4)) {
            expect(options.prompt).not.toContain('FILE PLAN VALIDATION RETRY');
            expect(options.prompt).not.toContain('UNAUTHORIZED_REWRITE');
            expect(options.prompt).not.toContain('SECOND_REWRITE');
            expect(options.prompt).toContain(JSON.stringify(types));
            expect(options.prompt).toContain(JSON.stringify(entry));
        }
        expect(request.mock.calls.at(-1)[0].includeImage).toBe(false);
        expect(request.mock.calls[5][0].prompt).toContain('Its contract: Export render()');
    });


test('a format failure during a source repair carries both diagnostics into the final repair', async () => {
    const plan = JSON.stringify({files: [{path: '/render.ts', contract: 'Render the tool workspace'}]});
    const badSource = 'import {missing} from "./nope";\nexport const render = () => missing;';
    const fixedSource = 'export const render = () => null;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/render.ts', badSource))
        // The source repair's malformed envelope fails format validation
        // before its content ever reaches source validation again.
        .mockResolvedValueOnce('{"path":"/render.ts","lines":["export const render = () => null;"]')
        .mockResolvedValueOnce(file('/render.ts', fixedSource));
    const result = await generateStagedWorkspace({prompt: 'Build workbench', request, workspaceFiles: []});
    expect(result).toBe(file('/render.ts', fixedSource));
    expect(request).toHaveBeenCalledTimes(4);
    // The original source rejection must survive the intervening format
    // failure: the final repair sees every unresolved rejection for the
    // file, not only the most recent one.
    const finalRepair = request.mock.calls[3][0].prompt;
    expect(finalRepair).toContain('SOURCE FORMAT RECOVERY');
    expect(finalRepair).toContain('FILE VALIDATION RETRY');
    expect(finalRepair).toContain('has no file in the workspace or approved plan');
    expect(finalRepair).toContain('still unresolved');
});

test('an import-only source rejection repairs imports instead of hunting for syntax defects', async () => {
    const plan = JSON.stringify({files: [{path: '/render.tsx', contract: 'Compose feature renderers'}]});
    const bad = 'import {renderSpace} from "./features/space/render";\nexport const render = () => renderSpace();';
    const good = 'export const render = () => null;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/render.tsx', bad))
        .mockResolvedValueOnce(file('/render.tsx', good));
    const result = await generateStagedWorkspace({prompt: 'Build workbench', request, workspaceFiles: []});
    expect(result).toBe(file('/render.tsx', good));
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('FILE VALIDATION RETRY');
    expect(retry).toContain('has no file in the workspace or approved plan');
    expect(retry).toContain('Fix exactly the rejected imports');
    expect(retry).toContain('Never re-emit a rejected import unchanged');
    // The syntax-oriented wording would send this repair after a line/column
    // defect that an import rejection never reports.
    expect(retry).not.toContain('Use the diagnostic line/column');
    expect(retry).not.toContain('syntax checker reports only its first defect');
});

test('a completed module importing a pending name drives both the request and its cross-file repair', async () => {
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'Entry helper'},
        {path: '/b.ts', contract: 'Shared tool'}]});
    const importer = 'import {thing} from "./b";\nexport const a = thing;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', importer))
        .mockResolvedValueOnce(file('/b.ts', 'export const other = 1;'))
        .mockResolvedValueOnce(file('/b.ts', 'export const thing = 1;'));
    const result = await generateStagedWorkspace({prompt: 'Build tools', request});
    expect(result).toBe([file('/a.ts', importer), file('/b.ts', 'export const thing = 1;')].join('\n\n'));
    // The first request for /b.ts already states the inbound requirement, so
    // the mismatch ideally never happens.
    const first = request.mock.calls[2][0].prompt;
    expect(first).toContain('Completed modules that already import this file');
    expect(first).toContain('/a.ts imports { thing } from this file.');
    expect(first).toContain('Required exports (completed modules already import');
    expect(first).toContain('"thing"');
    // If the model still omits the export, the repair names the applied
    // subject as immutable, directs the fix here, and forbids a verbatim echo.
    const retry = request.mock.calls[3][0].prompt;
    expect(retry).toContain('FOCUSED WORKSPACE EXPORT REPAIR');
    expect(retry).toContain('/b.ts does not export thing');
    expect(retry).toContain('/a.ts imports ["thing"] from this module.');
    expect(retry).toContain('completed files are immutable');
    expect(retry).toContain('identical to the rejected source');
    expect(retry).not.toContain('Use the diagnostic line/column');
    // The requirement and the anti-echo rule are the last words after the
    // rejected source: a weak model anchors on the embedded source copy, so
    // corrective facts stated before it get ignored.
    expect(retry.indexOf('RE-VALIDATION CONTRACT')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    expect(retry.indexOf('identical to the rejected source')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
});

test('a syntax repair preserves unflagged imports, stated after the rejected source', async () => {
    // Recorded live failure: the repair for a missing semicolon rewrote
    // sibling imports one directory too deep, trading a syntax defect for
    // import rejections that the single repair could no longer absorb.
    const plan = JSON.stringify({files: [{path: '/a.ts', contract: 'Entry'},
        {path: '/b.ts', contract: 'Dependency'}]});
    const broken = 'import {thing} from "./b";\nexport const a = ,;';
    const fixed = 'import {thing} from "./b";\nexport const a = 1;';
    const dependency = 'export const thing = 1;';
    const request = jest.fn().mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(file('/a.ts', broken))
        .mockResolvedValueOnce(file('/a.ts', fixed))
        .mockResolvedValueOnce(file('/b.ts', dependency));
    const result = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(result).toBe([file('/a.ts', fixed), file('/b.ts', dependency)].join('\n\n'));
    const retry = request.mock.calls[2][0].prompt;
    expect(retry).toContain('FILE VALIDATION RETRY');
    // Syntax branch retained: diagnostics with lines still get the
    // line/column framing, and the import-preservation rule is the last
    // word after the embedded source copy.
    expect(retry).toContain('Use the diagnostic line/column');
    expect(retry.indexOf('Preserve every dependency source specifier')).toBeGreaterThan(retry.indexOf('END REJECTED SOURCE'));
    // No cross-file export requirement exists here, so that block stays out.
    expect(retry).not.toContain('RE-VALIDATION CONTRACT');
});

test('split validation keeps exactly one corrective retry after the transaction spent its plan retry', async () => {
    const invalidSplit = () => JSON.stringify({files: [{path: '/render.ts', contract: 'Still monolithic'}]});
    const request = jest.fn().mockResolvedValueOnce('{invalid').mockResolvedValueOnce(manifest)
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(invalidSplit())
        .mockResolvedValueOnce(invalidSplit());
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('file-plan validation failed after one retry');
    // Initial plan (2), oversized file (1), split revision (2): at most one
    // retry per planning question — recovery stays bounded, never multiplied.
    expect(request).toHaveBeenCalledTimes(5);
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

test('the split prompt marks composition ancestors as not reusable before validation rejects them', async () => {
    const root = {path: '/styles.css', contract: 'Root styles'};
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [root]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [
            {path: '/styles/dashboard.css', contract: 'Dashboard styles'},
            {path: '/styles/panel.css', contract: 'Panel styles'}]}))
        // A helper's reduced allowance gets its one larger retry before the
        // split guard; both attempts must hit the output limit to split.
        .mockRejectedValueOnce(outputLimit())
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles/widget.css', contract: 'Widget styles'}]}))
        .mockResolvedValueOnce(file('/styles/widget.css', '.widget {}'))
        .mockResolvedValueOnce(file('/styles/dashboard.css', '.dash {}'))
        .mockResolvedValueOnce(file('/styles/panel.css', '.panel {}'))
        .mockResolvedValueOnce(file('/styles.css', '.root {}'));
    const result = await generateStagedWorkspace({prompt: 'Build styles', request});
    expect(request).toHaveBeenCalledTimes(10);
    // The root's own split has no composition graph yet: no warning line.
    expect(request.mock.calls[2][0].prompt).not.toContain('NOT reusable for this module');
    // Once /styles.css composes the dashboard leaf, the leaf's split prompt
    // must mark the root as circular BEFORE the model can propose it, and
    // the corrective retry carries the actionable rejection.
    const dashboardSplit = request.mock.calls[5][0].prompt;
    expect(dashboardSplit).toContain('NOT reusable for this module');
    expect(dashboardSplit).toContain('"/styles.css"');
    expect(result).toContain(file('/styles.css', '.root {}'));
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

test('reports the actual count when a plan violates the file bound', () => {
    expect(() => parseWorkspaceManifest(JSON.stringify({files: []}), {maxFiles: 12}))
        .toThrow('must contain 1–12 files; received 0.');
    expect(() => parseWorkspaceManifest(JSON.stringify({files: Array.from({length: 13}, (_, i) => ({path: `/f${i}.ts`, contract: 'x'}))}), {maxFiles: 12}))
        .toThrow('must contain 1–12 files; received 13 (/f0.ts, /f1.ts, /f2.ts, /f3.ts, /f4.ts, /f5.ts, +7 more).');
});

test('reports the actual shape when a plan has no files array', () => {
    expect(() => parseWorkspaceManifest(JSON.stringify({modules: [{path: '/a.ts', contract: 'x'}]}), {maxFiles: 12}))
        .toThrow('the files property is missing (top-level keys: modules)');
    expect(() => parseWorkspaceManifest(JSON.stringify({files: '/a.ts'}), {maxFiles: 12}))
        .toThrow('the files property is a string');
    expect(() => parseWorkspaceManifest(JSON.stringify([{path: '/a.ts', contract: 'x'}]), {maxFiles: 12}))
        .toThrow('received a top-level array');
});

test('bounds helper inventories independently of retained files', async () => {
    const initial = JSON.stringify({files: [{path: '/render.ts', contract: 'Render'},
        ...Array.from({length: 11}, (_, i) => ({path: `/pending${i}.ts`, contract: 'Retained'}))]});
    const invalid = JSON.stringify({files: Array.from({length: 13}, (_, i) => ({path: `/helper${i}.ts`, contract: 'Helper'}))});
    const request = jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(outputLimit()).mockResolvedValue(invalid);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('at most 12 new helpers fit within the workspace safety limit of 36 files');
    expect(request).toHaveBeenCalledTimes(4);
    // The schema still advertises the helper bound; enforcement happens in
    // validateSplit, which separates new helpers from host-retained echoes.
    expect(request.mock.calls[2][0].responseSchema.properties.files.maxItems).toBe(12);
});

test('split accepts a reply padded with host echoes beyond the helper count when new helpers stay bounded', async () => {
    const root = {path: '/styles.css', contract: 'Compose styles'};
    const retained = ['/styles/tokens.css', '/styles/layout.css', '/styles/reset.css'].map(path => ({path, contract: 'Existing styles'}));
    const helpers = Array.from({length: 9}, (_, i) => ({path: `/styles/helpers/h${i}.css`, contract: `Helper ${i}`}));
    // 13 entries: the oversized module echo, three retained CSS echoes and
    // nine NEW helpers. The old raw count rejected this at 12 before
    // validateSplit could separate echoes from the bounded helper set.
    const splitReply = JSON.stringify({files: [root, ...retained, ...helpers]});
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [root, ...retained]}))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(splitReply)
        .mockImplementation(async options => file(options.workspaceStep,
            options.workspaceStep === root.path
                ? helpers.map(helper => `@import "./${helper.path.slice('/styles/'.length)}";`).join('\n')
                : '.panel { color: teal; }'));
    const result = await generateStagedWorkspace({prompt: 'Build styles', request});
    expect(request).toHaveBeenCalledTimes(16);
    expect(result).toContain(`### File: ${helpers[8].path}`);
    expect(result).toContain(`### File: ${root.path}`);
});

test('CSS split rejects non-CSS helpers before requesting their source', async () => {
    const initial = JSON.stringify({files: [{path: '/styles.css', contract: 'Styles'}]});
    const invalid = JSON.stringify({files: [{path: '/helper.ts', contract: 'Styles'}, {path: '/styles.css', contract: 'Compose'}]});
    const request = jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(outputLimit()).mockResolvedValue(invalid);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('expected 1–12 helpers, not file paths');
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
    // A re-split knows it is one: the second split prompt states the
    // composition that already exists and that restating it is an echo,
    // so the model moves MORE responsibilities out instead of proposing
    // the same decomposition twice (attempt 74's episode-two failure).
    // The composition's own output-limit replay precedes the re-split:
    // split #1 plan is [2], the replayed composition is [5], split #2 is [6].
    expect(request.mock.calls[6][0].prompt).toContain('This module has already been split');
    expect(request.mock.calls[6][0].prompt).toContain('["/styles/layout.css"]');
    expect(request.mock.calls[6][0].prompt).not.toContain('Shorten descriptions, not the feature set');
    expect(request.mock.calls[2][0].prompt).not.toContain('This module has already been split');
    expect(request.mock.calls.filter(([options]) => options.responseSchema.properties.path?.enum[0] === layout.path)).toHaveLength(1);
});

describe('per-file repair history across helper generation', () => {
    const fixture = require('../fixtures/ai/workspace-repair-after-split.cjs');
    test('splitting never renews an already spent extra source repair', async () => {
        const responses = fixture.replies.map(reply => reply.finishReason === 'length' ? outputLimit() : reply.content);
        // Spend the progression round before its output limit triggers a split.
        responses.splice(3, 0, responses[6]);
        const options = budgetedWorkspace(9, responses);
        const onValidation = jest.fn();
        await expect(generateStagedWorkspace({...options, workspaceFiles: [], onValidation}))
            .rejects.toThrow('after repeated repairs of /ui/dashboard.ts');
        expect(options.request).toHaveBeenCalledTimes(8);
        expect(onValidation.mock.calls.at(-1)[0]).toMatchObject({path: fixture.parent.path, repairAvailable: false});
    });

    test.each(['repaired', 'repeated rejection', 'budget exhausted', 'unchanged rejection'])(
        'retains the parent rejection and bounded policy: %s', async outcome => {
            const responses = fixture.replies.map(reply => reply.finishReason === 'length' ? outputLimit() : reply.content);
            if (outcome === 'repeated rejection') responses[7] = responses[6];
            if (outcome === 'unchanged rejection') {
                responses[2] = fixture.encoded(fixture.parent.path, 'export const renderDashboard = ;');
                responses[6] = responses[2];
            }
            const options = budgetedWorkspace(outcome === 'budget exhausted' ? 7 : 8, responses);
            const onValidation = jest.fn();
            const result = generateStagedWorkspace({...options, workspaceFiles: [], onValidation});
            if (outcome === 'repeated rejection') {
                await expect(result).rejects.toThrow('after repeated repairs of /ui/dashboard.ts');
                expect(onValidation.mock.calls.at(-1)[0].repairAvailable).toBe(false);
            } else if (outcome === 'budget exhausted') {
                await expect(result).rejects.toThrow('request budget cannot complete');
            } else {
                await expect(result).resolves.toContain(fixture.repaired);
            }
            const requests = options.request.mock.calls.map(([request]) => request);
            expect(requests).toHaveLength(outcome === 'budget exhausted' ? 7 : 8);
            expect(onValidation.mock.calls[1][0]).toMatchObject({path: fixture.parent.path, kind: 'source', repairAvailable: true});
            expect(onValidation.mock.calls[1][0].reason).toContain(outcome === 'unchanged rejection'
                ? 'invalid source syntax' : 'does not export renderDashboard');
            if (requests[7]) {
                expect(requests[7].prompt).toContain(outcome === 'unchanged rejection' ? 'REPEAT REJECTION' : 'PROGRESSED REJECTION');
                expect(requests[7].prompt).toContain('renderDashboard');
                expect(requests[7].prompt).toContain('Required exports');
                if (outcome !== 'unchanged rejection') expect(requests[7].prompt).toContain('RE-VALIDATION CONTRACT');
            }
        });
});

test('the recorded split proposal preserves the host logic contract and schedules only new helpers', async () => {
    const fixture = require('../fixtures/ai/workspace-retained-split-recovery.cjs');
    const options = budgetedWorkspace(fixture.replies.length, fixture.replies.map(reply =>
        reply.finishReason === 'length' ? outputLimit() : reply.content));
    const result = await generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles});
    expect([...result.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(fixture.expectedPaths);
    expect(options.request).toHaveBeenCalledTimes(fixture.replies.length);
    const final = options.request.mock.calls.at(-1)[0];
    expect(final.prompt).toContain(`Its contract: ${fixture.logic.contract}`);
    expect(final.includeImage).toBe(false);
    for (const [requestOptions] of options.request.mock.calls.slice(4)) {
        expect(requestOptions.prompt).not.toContain('FILE PLAN VALIDATION RETRY');
        expect(requestOptions.prompt).not.toContain('Implements deterministic JSON, text, URL, HTML, SVG, data URL, and social-preview transformations.');
    }
});

test('retained split paths cannot conceal unsafe paths or conflicting new helpers', () => {
    const retained = {path: '/logic.ts', contract: 'Ignored annotation'};
    const helper = {path: '/helper.ts', contract: 'New helper'};
    const options = {retainedPaths: [retained.path]};
    expect(parseWorkspaceManifest(JSON.stringify({files: [retained]}), options)).toEqual([]);
    expect(() => parseWorkspaceManifest(JSON.stringify({files: [retained, helper, {...helper, contract: 'Conflict'}]}), options))
        .toThrow('conflicting duplicate paths');
    expect(() => parseWorkspaceManifest(JSON.stringify({files: [retained, {...helper, contract: ''}]}), options))
        .toThrow('must be a non-empty string');
    for (const path of ['/../escape.ts', '/.git/config', '/node_modules/host.js']) {
        expect(() => parseWorkspaceManifest(JSON.stringify({files: [retained, {path}]}),
            {retainedPaths: [retained.path, path]})).toThrow('invalid path');
    }
});

describe('validated output allowance within a workspace transaction', () => {
    test.each(['css', 'ts'].flatMap(extension => ['json', 'fenced'].map(format => [extension, format])))(
        'avoids repeated undersized %s siblings (%s) within the absolute live request ceiling', async (extension, format) => {
        const root = `/root.${extension}`;
        const a = `/a.${extension}`, b = `/b.${extension}`;
        const source = extension === 'css' ? '.panel { color: teal; }' : 'export {};';
        const base = extension === 'css' ? 3072 : 6144;
        const options = budgetedWorkspace(50, []);
        const {reserveLiveAiTestRequest} = require('../../src/utils/ai/testing/liveAiTestBudget');
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '50'};
        const requestCount = format === 'fenced' ? 9 : 7;
        for (let i = 0; i < 50 - requestCount; i++) reserveLiveAiTestRequest(env);
        let planned = false, split = false;
        options.request.mockImplementation(async request => {
            reserveLiveAiTestRequest(env);
            if (!planned) {
                planned = true;
                return JSON.stringify({files: [...(format === 'fenced' ? [{path: `/seed.${extension}`, contract: 'Shared base'}] : []),
                    {path: root, contract: 'Compose two modules'}]});
            }
            if (request.prompt.includes('MODULE SPLIT REQUIRED')) {
                split = true;
                return JSON.stringify({files: [a, b].map(path => ({path, contract: 'Focused module'}))});
            }
            const path = request.workspaceStep;
            if (format === 'fenced' && request.responseSchema) return '{invalid json';
            if (path === `/seed.${extension}`) return `\`\`\`\n${source}\n\`\`\``;
            if (!split || path !== root && request.maxOutputTokens < base) throw outputLimit();
            return format === 'fenced' ? `\`\`\`\n${source}\n\`\`\`` : file(path, source);
        });
        const result = await generateStagedWorkspace({...options, workspaceFiles: []});
        expect(result.match(/### File:/g)).toHaveLength(format === 'fenced' ? 4 : 3);
        expect(options.request).toHaveBeenCalledTimes(requestCount);
        const calls = options.request.mock.calls.map(([call]) => call).slice(-4);
        expect(calls[0].maxOutputTokens).toBe(base / 2);
        expect(calls[1].maxOutputTokens).toBe(base);
        expect(calls[2].maxOutputTokens).toBe(base);
        expect(calls[2].prompt).toContain(`must fit within ${base} output tokens`);
        expect(calls[3].maxOutputTokens).toBe(Math.min(base / 2, 2048));
        expect(() => reserveLiveAiTestRequest(env)).toThrow('limit reached (50)');
    });
});

test('learned allowances stay separate for CSS and source files', async () => {
    const plan = entries => JSON.stringify({files: entries.map(path => ({path, contract: 'Focused module'}))});
    const request = jest.fn().mockResolvedValueOnce(plan(['/render.ts', '/styles.css']))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(plan(['/helper.ts']))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(file('/helper.ts'))
        .mockResolvedValueOnce(file('/render.ts'))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(plan(['/base.css']))
        .mockResolvedValueOnce(file('/base.css', '.base { color: red; }'))
        .mockResolvedValueOnce(file('/styles.css', '@import "./base.css";'));
    await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(request.mock.calls[4][0].maxOutputTokens).toBe(6144);
    expect(request.mock.calls[8][0].maxOutputTokens).toBe(1536);
});

test('JSON response expansion does not inflate a later fenced-source recovery', async () => {
    const plan = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused module'}))});
    const request = jest.fn().mockResolvedValueOnce(plan(['/root.css']))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(plan(['/a.css', '/b.css']))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(file('/a.css', '.a { color: red; }'))
        .mockResolvedValueOnce('{invalid json')
        .mockResolvedValueOnce('```css\n.b { color: blue; }\n```')
        .mockResolvedValueOnce('```css\n@import "./a.css";\n@import "./b.css";\n```');
    await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(request.mock.calls[5][0].maxOutputTokens).toBe(3072);
    expect(request.mock.calls[6][0].maxOutputTokens).toBe(1536);
    expect(request.mock.calls[6][0].responseSchema).toBeUndefined();
});

test('an expanded but invalid response cannot train later helpers', async () => {
    const plan = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused module'}))});
    const request = jest.fn().mockResolvedValueOnce(plan(['/root.css']))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(plan(['/a.css', '/b.css']))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(file('/a.css', '.a {'))
        .mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(plan(['/a-child.css']))
        .mockResolvedValueOnce(file('/a-child.css', '.a { color: red; }'))
        .mockResolvedValueOnce(file('/a.css', '@import "./a-child.css";'))
        .mockResolvedValueOnce(file('/b.css', '.b { color: blue; }'))
        .mockResolvedValueOnce(file('/root.css', '@import "./a.css";\n@import "./b.css";'));
    await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(request.mock.calls[4][0].maxOutputTokens).toBe(3072);
    expect(request.mock.calls[7][0].maxOutputTokens).toBe(1024);
    expect(request.mock.calls[8][0].maxOutputTokens).toBe(3072);
    expect(request.mock.calls[9][0].maxOutputTokens).toBe(1536);
});

describe('missing stylesheet dependency planning', () => {
    const fixture = require('../fixtures/ai/workspace-css-dependency-plan.cjs');
    test('plans the recorded absent CSS modules before generating them, preserving completed and pending files', async () => {
        const options = budgetedWorkspace(fixture.replies.length, fixture.replies);
        const result = await generateStagedWorkspace({...options, workspaceFiles: []});
        expect(result).toContain(fixture.composition);
        expect(result.match(/### File:/g)).toHaveLength(8);
        const calls = options.request.mock.calls.map(([call]) => call);
        expect(calls).toHaveLength(11);
        expect(calls[3].workspaceStep).toBe('Planning stylesheet dependencies: /styles.css');
        expect(calls[3].prompt).toContain('Missing references (diagnostic data, not approved files)');
        expect(calls[3].prompt).not.toContain('exceeded its file response budget');
        expect(calls.filter(call => call.responseSchema?.properties.path).map(call => call.responseSchema.properties.path.enum[0]))
            .toEqual([fixture.entry.path, fixture.root.path, ...fixture.dependencies, fixture.root.path, fixture.tail.path]);
    });
    test('requires a validated plan and rejects unsafe dependency paths', async () => {
        const options = budgetedWorkspace(12, [...fixture.replies.slice(0, 3),
            JSON.stringify({files: [{path: '/.git/unsafe.css', contract: 'Invalid dependency'}]})]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: []})).rejects.toThrow('invalid path');
        expect(options.request).toHaveBeenCalledTimes(4);
    });
    test('cannot admit an empty decomposition even after its bounded plan retry', async () => {
        const echo = JSON.stringify({files: [fixture.root]});
        const options = budgetedWorkspace(12, [...fixture.replies.slice(0, 3), echo, echo]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: []})).rejects.toThrow('Workspace file-plan validation failed after one retry');
        expect(options.request).toHaveBeenCalledTimes(5);
    });
    test('checks the remaining request budget before dependency planning', async () => {
        const options = budgetedWorkspace(4, [JSON.stringify({files: [fixture.root]}), fixture.encode(fixture.root.path, fixture.rejected)]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: []})).rejects.toThrow('3 requests needed, 2 remaining');
        expect(options.request).toHaveBeenCalledTimes(2);
    });
});

test('missing CSS dependency planning respects cancellation before inference', async () => {
    const fixture = require('../fixtures/ai/workspace-css-dependency-plan.cjs');
    const options = budgetedWorkspace(12, fixture.replies);
    let cancelled = false;
    await expect(generateStagedWorkspace({...options, workspaceFiles: [],
        onStage: stage => { if (stage.label.startsWith('Planning stylesheet dependencies')) cancelled = true; },
        assertActive: () => { if (cancelled) throw new Error('Cancelled'); },
    })).rejects.toThrow('Cancelled');
    expect(options.request).toHaveBeenCalledTimes(3);
});

test('a malformed sole stylesheet is repaired as source before considering dependency planning', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles.css', contract: 'Styles'}]}))
        .mockResolvedValueOnce(file('/styles.css', '@import "./missing.css"; .broken {'))
        .mockResolvedValueOnce(file('/styles.css', '.panel { color: teal; }'));
    const result = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
    expect(result).toContain('.panel { color: teal; }');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].workspaceStep).toBe('/styles.css');
    expect(request.mock.calls[2][0].prompt).not.toContain('MODULE SPLIT REQUIRED');
});

describe('focused type interface repairs', () => {
    const fixture = require('../fixtures/ai/workspace-type-import-repair.cjs');
    test('repairs incoming and outgoing contracts in one bounded header request while preserving implementation', async () => {
        const options = budgetedWorkspace(7, fixture.replies);
        const result = await generateStagedWorkspace({...options, workspaceFiles: [
            {path: '/existing.ts', content: 'export interface ExistingResult {value: string}'},
        ]});
        expect(result).toContain(fixture.header);
        expect(result).toContain(fixture.body);
        expect(result.match(/### File:/g)).toHaveLength(5);
        expect(options.request).toHaveBeenCalledTimes(7);
        const repair = options.request.mock.calls[5][0].prompt;
        expect(repair).toContain('FOCUSED TYPE INTERFACE REPAIR');
        expect(repair).toContain('An import type declaration alone does not re-export anything');
        expect(repair).toContain(fixture.consumer);
        expect(repair).toContain('Dependency: /existing.ts');
        expect(repair).toContain('ExistingResult');
        expect(repair).not.toContain('the replacement is verbatim one of the exports');
        expect(options.request.mock.calls[6][0].prompt).not.toContain('FOCUSED TYPE INTERFACE REPAIR');
    });
    test('rejects executable header replacements and retains the original body for the bounded next repair', async () => {
        const responses = [...fixture.replies];
        responses.splice(5, 0, fixture.encode(fixture.files[3].path, 'export const run = () => "REPLACED";'));
        const options = budgetedWorkspace(8, responses);
        const result = await generateStagedWorkspace({...options, workspaceFiles: []});
        expect(result).toContain(fixture.body);
        expect(result).not.toContain('REPLACED');
        expect(options.request.mock.calls[6][0].prompt).toContain('FOCUSED TYPE INTERFACE REPAIR');
        expect(options.request).toHaveBeenCalledTimes(8);
    });
    test('does not issue a header request beyond the remaining budget', async () => {
        const options = budgetedWorkspace(6, fixture.replies);
        await expect(generateStagedWorkspace({...options, workspaceFiles: []})).rejects.toThrow('2 requests needed, 1 remaining');
        expect(options.request).toHaveBeenCalledTimes(5);
    });
    test('a truncated interface header cannot trigger implementation splitting', async () => {
        const options = budgetedWorkspace(7, [...fixture.replies.slice(0, 5), outputLimit()]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: []})).rejects.toThrow('interface repair');
        expect(options.request).toHaveBeenCalledTimes(6);
    });
});

describe('CSS split responsibility recovery', () => {
    const fixture = require('../fixtures/ai/workspace-css-responsibility-repair.cjs');
    const replies = fixture.replies.map(reply => reply.finishReason === 'length' ? outputLimit() : reply.content);
    test('uses the existing plan retry to allocate safe sibling helpers and preserve the pending tail', async () => {
        const options = budgetedWorkspace(replies.length, replies);
        const result = await generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles});
        expect([...result.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(fixture.expectedPaths);
        expect(result).toContain(fixture.composition);
        expect(result).not.toContain('.partial');
        expect(result).not.toContain('.existing');
        expect(options.request).toHaveBeenCalledTimes(8);
        expect(options.request.mock.calls[3][0].responseSchema.required).toEqual(['helpers']);
        expect(options.request.mock.calls[4][0].prompt).toContain('/styles/base-tokens-2.css');
    });
    test.each([
        {helpers: [{name: '../escape', contract: 'Invalid'}]},
        {helpers: [{name: 'tokens.css', contract: 'Invalid'}]},
        {helpers: [{name: 'tokens', contract: 'First'}, {name: 'tokens', contract: 'Second'}]},
        {helpers: [{name: 'tokens', path: '/styles/base.css', contract: 'Unauthorized path'}]},
        {helpers: []},
        {files: [fixture.root]},
    ])('rejects invalid responsibilities without renewing the plan allowance: %j', invalid => {
        const options = budgetedWorkspace(10, [...replies.slice(0, 3), JSON.stringify(invalid)]);
        return expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles}))
            .rejects.toThrow('Workspace file-plan validation failed after one retry');
    });
    test('admits generated paths through the normal contract validation', async () => {
        const options = budgetedWorkspace(10, [...replies.slice(0, 3), JSON.stringify({helpers: [{name: 'tokens', contract: ''}]})]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles})).rejects.toThrow('Interface contract');
        expect(options.request).toHaveBeenCalledTimes(4);
    });
    test('does not enlarge the request allowance to generate extra helpers', async () => {
        const options = budgetedWorkspace(7, replies);
        await expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles}))
            .rejects.toThrow('4 requests needed, 3 remaining');
        expect(options.request).toHaveBeenCalledTimes(4);
    });
});

describe('retained composition output allowance', () => {
    const fixture = require('../fixtures/ai/workspace-css-composition-allowance.cjs');
    test.each(['json', 'fenced'])('preserves the expanded parent allowance after nested splitting (%s)', async format => {
        const request = jest.fn(async options => {
            const reply = fixture.replies[request.mock.calls.length - 1];
            if (!reply) throw new Error('Unexpected request');
            if (reply.finishReason === 'length' || options.maxOutputTokens < (reply.minimumOutputTokens || 0)) throw outputLimit();
            const value = JSON.parse(reply.content);
            return format === 'fenced' && value.lines
                ? `### File: ${value.path}\n\`\`\`css\n${value.lines.join('\n')}\n\`\`\`` : reply.content;
        });
        const result = await generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: []});
        expect([...result.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(fixture.expectedPaths);
        expect(result).toContain(fixture.composition);
        expect(result).not.toContain('.incomplete');
        expect(request).toHaveBeenCalledTimes(12);
        const calls = request.mock.calls.map(([call]) => call);
        expect(calls.filter(call => call.workspaceStep === fixture.panels).map(call => call.maxOutputTokens)).toEqual([1536, 3072, 3072]);
        expect(calls[5].prompt).toContain('retained composition file has at most 3072 output tokens');
        expect(calls[6].maxOutputTokens).toBe(1024);
        expect(calls[9].prompt).toContain('must fit within 3072 output tokens');
        expect(calls[10].maxOutputTokens).toBe(1536);
    });
    test('does not grant a fresh expansion or another split if the resumed composition still overflows', async () => {
        const replies = fixture.replies.slice(0, 10).map((reply, index) =>
            reply.finishReason === 'length' || index === 9 ? outputLimit() : reply.content);
        const options = budgetedWorkspace(20, replies);
        await expect(generateStagedWorkspace({...options, workspaceFiles: []})).rejects.toThrow('after bounded file splitting');
        expect(options.request).toHaveBeenCalledTimes(10);
        expect(options.request.mock.calls[9][0].maxOutputTokens).toBe(3072);
    });
    test('keeps the existing request ceiling for the complete nested transaction', async () => {
        const options = budgetedWorkspace(12, fixture.replies.map(reply => reply.finishReason === 'length' ? outputLimit() : reply.content));
        const result = await generateStagedWorkspace({...options, workspaceFiles: []});
        expect(result).toContain(fixture.composition);
        expect(options.request).toHaveBeenCalledTimes(12);
        expect(options.request.mock.calls[9][0].maxOutputTokens).toBe(3072);
    });
});


describe('CSS ancestor split recovery', () => {
    const fixture = require('../fixtures/ai/workspace-css-cycle-repair.cjs');
    const replies = fixture.replies.map(reply => reply.finishReason === 'length' ? outputLimit() : reply.content);
    test('advertises only safe reuse targets and recovers with one host-assigned decomposition', async () => {
        const options = budgetedWorkspace(replies.length, replies);
        const result = await generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles});
        expect([...result.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(fixture.expectedPaths);
        expect(result).not.toContain('/discarded.css');
        expect(options.request).toHaveBeenCalledTimes(replies.length);
        const split = options.request.mock.calls[4][0].prompt;
        const reusable = JSON.parse(split.match(/Reusable CSS dependencies[^\n]+: (\[[^\n]*])/)[1]);
        expect(reusable).toEqual([]);
        const repair = options.request.mock.calls[5][0];
        expect(repair.responseSchema.required).toEqual(['helpers']);
        expect(repair.prompt).toContain('Forbidden dependencies');
        expect(repair.prompt).toContain(fixture.root.path);
        expect(repair.prompt).toContain('/styles.css');
    });
    test('does not silently discard a cycle or allow a third plan attempt', async () => {
        const options = budgetedWorkspace(10, [...replies.slice(0, 5), replies[4]]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles}))
            .rejects.toThrow('circular module composition');
        expect(options.request).toHaveBeenCalledTimes(6);
    });
});


describe('focused workspace syntax repair', () => {
    const {scenario} = require('../fixtures/ai/workspace-syntax-repair.cjs');
    test.each([false, true])('repairs a function-type annotation while preserving imports, runtime code and consumers (raw=%s)', async raw => {
        const fixture = scenario(raw);
        const options = budgetedWorkspace(fixture.replies.length, fixture.replies.map(reply => reply.content));
        const result = await generateStagedWorkspace({...options, prompt: fixture.prompt, workspaceFiles: fixture.workspaceFiles});
        expect(result).toContain(fixture.corrected);
        expect(result).toContain(fixture.consumer);
        expect(options.request).toHaveBeenCalledTimes(fixture.replies.length);
        const repair = options.request.mock.calls.at(-1)[0];
        expect(repair.prompt).toContain('FOCUSED WORKSPACE SYNTAX REPAIR');
        expect(repair.prompt).toContain('Function-type syntax uses =>');
        expect(repair.prompt).toContain(fixture.source);
        expect(repair.prompt).toContain('/consumer.ts imports { handlers }');
        expect(repair.prompt).not.toContain('UNRELATED_IMPLEMENTATION');
        expect(repair.prompt).not.toContain('ORIGINAL SCAFFOLD REQUEST');
        expect(repair.prompt).not.toContain(fixture.context);
        expect(repair.includeImage).toBe(false);
        expect(repair.responseSchema ? 'json' : 'source').toBe(raw ? 'source' : 'json');
    });
    test('repeating the malformed type still exhausts the existing repair allowance', async () => {
        const fixture = scenario();
        const invalid = fixture.replies.at(-2).content;
        const replies = [...fixture.replies.slice(0, -1).map(reply => reply.content), invalid, invalid];
        const options = budgetedWorkspace(replies.length, replies);
        await expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles}))
            .rejects.toThrow('after repeated repairs');
        expect(options.request).toHaveBeenCalledTimes(replies.length);
    });
});


describe('source module split responsibility recovery', () => {
    const fixture = require('../fixtures/ai/workspace-source-split-repair.cjs');
    const replies = fixture.replies.map(reply => reply.finishReason === 'length' ? outputLimit() : reply.content);
    test('allocates unused TSX helpers and preserves completed consumers and the pending tail', async () => {
        const options = budgetedWorkspace(replies.length, replies);
        const result = await generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles});
        expect([...result.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(fixture.expectedPaths);
        expect(result).toContain(fixture.composition);
        expect(result).not.toContain('export const existing');
        expect(result).not.toContain('.partial');
        expect(options.request).toHaveBeenCalledTimes(replies.length);
        const retry = options.request.mock.calls[fixture.repairIndex][0];
        expect(retry.responseSchema.required).toEqual(['helpers']);
        expect(retry.prompt).toContain('Public exports required from the retained composition: ["renderDashboard"]');
        expect(retry.prompt).toContain('exports and their types/signatures');
        expect(retry.prompt).not.toContain('import {renderDashboard}');
    });
    test.each([
        {helpers: [{name: '../escape', contract: 'Unsafe'}]},
        {helpers: [{name: 'cards.tsx', contract: 'Extension injection'}]},
        {helpers: [{name: 'cards', contract: 'One'}, {name: 'cards', contract: 'Duplicate'}]},
        {helpers: [{name: 'cards', path: '/render.tsx', contract: 'Overwrite'}]},
        {helpers: [{name: 'cards', contract: ''}]},
        {helpers: []},
        {files: [fixture.root]},
    ])('rejects an invalid corrective response without granting another retry: %j', async invalid => {
        const options = budgetedWorkspace(12, [...replies.slice(0, fixture.repairIndex), JSON.stringify(invalid)]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles}))
            .rejects.toThrow('Workspace file-plan validation failed after one retry');
        expect(options.request).toHaveBeenCalledTimes(fixture.repairIndex + 1);
    });
    test('checks new helpers against the remaining request budget before generating any', async () => {
        const extraHelpers = JSON.stringify({helpers: [
            {name: 'cards', contract: 'Export renderCards'}, {name: 'navigation', contract: 'Export renderNavigation'},
        ]});
        const options = budgetedWorkspace(replies.length, [...replies.slice(0, fixture.repairIndex), extraHelpers]);
        await expect(generateStagedWorkspace({...options, workspaceFiles: fixture.workspaceFiles}))
            .rejects.toThrow('5 requests needed, 4 remaining');
        expect(options.request).toHaveBeenCalledTimes(5);
    });
    test.each(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.css'])('preserves the module language for %s helper paths', extension => {
        const parent = '/features/view' + extension;
        const repair = workspaceModuleSplitRepair({file: {path: parent, contract: 'Render'},
            paths: [parent, '/features/view-cards' + extension], maxHelpers: 2, maxContractCharacters: 240,
            maxManifestCharacters: 9000, helperTokens: 1024, prompt: 'Build'});
        const manifest = parseWorkspaceManifest(repair.decode(JSON.stringify({helpers: [{name: 'cards', contract: 'Export renderCards'}]})));
        expect(manifest[0].path).toBe('/features/view-cards-2' + extension);
    });
    test('does not invent module imports for data files', () => {
        expect(workspaceModuleSplitRepair({file: {path: '/data.json'}})).toBeNull();
    });
});

describe('host-scoped Problems repairs', () => {
    const fixture = require('../fixtures/ai/workspace-targeted-repair.cjs');
    test('repairs one diagnostic owner without planning or regenerating the workspace at the recorded 66/82 budget', async () => {
        jest.resetModules();
        const budget = require('../../src/utils/ai/testing/liveAiTestBudget');
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: 'auto'};
        for (let i = 0; i < 66; i++) {
            budget.reserveLiveAiTestRequest(env);
            if (i < 32) budget.recordLiveAiTestValidatedFile(i === 0 ? '/index.ts' : `/file${i}.ts`, env);
        }
        expect(budget.getLiveAiTestBudget(env)).toMatchObject({used: 66, ceiling: 82});
        expect(() => budget.assertLiveAiTestRequestsAvailable(18, env)).toThrow('18 requests needed, 16 remaining');
        const request = jest.fn(async () => { budget.reserveLiveAiTestRequest(env); return fixture.replies[0].content; });
        const original = JSON.stringify(fixture.workspaceFiles);
        const result = await generateStagedWorkspace({prompt: fixture.prompt, workspaceFiles: fixture.workspaceFiles,
            repairPaths: ['/index.ts'], request, assertBudget: count => budget.assertLiveAiTestRequestsAvailable(count, env),
            onFileValidated: path => budget.recordLiveAiTestValidatedFile(path, env)});
        expect(result).toContain(fixture.corrected.trim());
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][0]).toMatchObject({workspaceStep: '/index.ts', includeImage: false});
        expect(request.mock.calls[0][0].prompt).toContain(fixture.source);
        expect(request.mock.calls[0][0].prompt).toContain('/consumer.ts imports { Workbench }');
        expect(request.mock.calls[0][0].prompt).not.toContain('KEEP_EXISTING_STYLES');
        expect(request.mock.calls[0][0].prompt).not.toContain('KEEP_EXISTING_RENDER');
        expect(JSON.stringify(fixture.workspaceFiles)).toBe(original);
        expect(budget.getLiveAiTestBudget(env)).toMatchObject({used: 67, ceiling: 82, validatedFiles: 32});
    });
    test.each([[], ['/missing.ts'], ['/index.ts', '/index.ts'], ['/../index.ts'], 'index.ts'])('rejects an invalid host scope before any inference: %j', async repairPaths => {
        const request = jest.fn();
        await expect(generateStagedWorkspace({request, workspaceFiles: fixture.workspaceFiles, repairPaths}))
            .rejects.toThrow('Targeted repair requires');
        expect(request).not.toHaveBeenCalled();
    });
    test('cannot split or re-plan an overflowing repair into unrelated files', async () => {
        const request = jest.fn().mockRejectedValue(outputLimit());
        await expect(generateStagedWorkspace({prompt: fixture.prompt, workspaceFiles: fixture.workspaceFiles,
            repairPaths: ['/index.ts'], request})).rejects.toThrow('targeted repairs cannot regenerate or split unrelated files');
        expect(request).toHaveBeenCalledTimes(3);
        expect(request.mock.calls[2][0].prompt).toContain('SCOPED LINE RANGE REPAIR');
        expect(request.mock.calls[1][0].prompt).toContain('SCOPED EXACT FILE REPAIR');
        expect(request.mock.calls.every(([call]) => call.workspaceStep === '/index.ts' && !call.planStage)).toBe(true);
    });
    test('rejects a response for an unrelated file and preserves the snapshot', async () => {
        const request = jest.fn().mockResolvedValue(file('/styles.css', '.replacement {}'));
        await expect(generateStagedWorkspace({prompt: fixture.prompt, workspaceFiles: fixture.workspaceFiles,
            repairPaths: ['/index.ts'], request})).rejects.toThrow('one complete /index.ts');
        expect(request).toHaveBeenCalledTimes(2);
        expect(fixture.workspaceFiles[2].content).toContain('KEEP_EXISTING_STYLES');
    });
    test('checks repaired exports against unchanged consumers', async () => {
        const request = jest.fn().mockResolvedValue(JSON.stringify({path: '/index.ts', lines: ['export const other = true;']}));
        await expect(generateStagedWorkspace({prompt: fixture.prompt, workspaceFiles: fixture.workspaceFiles,
            repairPaths: ['/index.ts'], request})).rejects.toThrow('does not export Workbench');
    });
});

test.each([false, true])('repairs conflicting imported bindings within generation, source transport=%s', async raw => {
    const fixture = require('../fixtures/ai/workspace-import-binding-repair.cjs').scenario(raw);
    const request = jest.fn();
    for (const reply of fixture.replies) request.mockResolvedValueOnce(reply.content);
    const onValidation = jest.fn();
    const result = await generateStagedWorkspace({...fixture, request, onValidation});
    expect(result).toContain(fixture.corrected);
    expect(result).toContain(fixture.context);
    expect(result).toContain(fixture.consumer);
    expect(request).toHaveBeenCalledTimes(fixture.replies.length);
    expect(onValidation.mock.calls.some(([event]) => event.reason.includes('Import binding'))).toBe(true);
    const repair = request.mock.calls.at(-1)[0];
    expect(repair.prompt).toContain('FOCUSED WORKSPACE SYNTAX REPAIR');
    expect(repair.prompt).toContain('Alias the import');
    expect(repair.prompt).toContain('changing the local alias and its references');
    expect(repair.prompt).not.toContain('ORIGINAL SCAFFOLD REQUEST');
    expect(repair.includeImage).toBe(false);
});

test.each([false, true])('normalizes a duplicate self-forwarding export without another provider repair, raw=%s', async raw => {
    const fixture = require('../fixtures/ai/workspace-self-forwarder.cjs').scenario(raw);
    const request = jest.fn();
    fixture.replies.forEach(reply => request.mockResolvedValueOnce(reply.content));
    const onFileValidated = jest.fn();
    const onStage = jest.fn();
    const result = await generateStagedWorkspace({...fixture, request, onFileValidated, onStage});
    expect(result).toContain(fixture.corrected.trim());
    expect(result).toContain(fixture.consumer);
    expect(request).toHaveBeenCalledTimes(fixture.replies.length);
    expect(onFileValidated).toHaveBeenCalledTimes(2);
    expect(onStage.mock.calls.some(([stage]) => stage.label.includes('Removed redundant export wrapper'))).toBe(true);
});

test.each([false, true])('repairs a wrong-role module from its required exports and callers, raw=%s', async raw => {
    const fixture = require('../fixtures/ai/workspace-export-repair.cjs').scenario(raw);
    const options = budgetedWorkspace(fixture.replies.length, fixture.replies.map(reply => reply.content));
    const onFileValidated = jest.fn();
    const result = await generateStagedWorkspace({...fixture, ...options, prompt: fixture.prompt, onFileValidated});
    expect(result).toContain(fixture.corrected);
    expect(result).toContain(fixture.consumer);
    expect(result).toContain(fixture.context);
    expect(result).not.toContain('new WebToolsWorkbenchPlugin');
    expect(onFileValidated).toHaveBeenCalledTimes(3);
    expect(options.request).toHaveBeenCalledTimes(fixture.replies.length);
    const repair = options.request.mock.calls.at(-1)[0];
    expect(repair.prompt).toContain(fixture.repairHeading);
    expect(repair.prompt).toContain('Required exports: ["renderDashboard"]');
    expect(repair.prompt).toContain(fixture.consumer);
    expect(repair.prompt).toContain(fixture.context);
    expect(repair.prompt).toContain(fixture.source);
    expect(repair.prompt).not.toContain('ORIGINAL SCAFFOLD REQUEST');
    expect(repair.prompt).not.toContain('UNRELATED_IMPLEMENTATION');
    expect(repair.prompt).not.toContain('the replacement is verbatim one of the exports');
    expect(repair.includeImage).toBe(false);
});

test('a focused export repair that keeps the wrong interface still exhausts the existing bounded repairs', async () => {
    const fixture = require('../fixtures/ai/workspace-export-repair.cjs').scenario();
    const request = jest.fn();
    fixture.replies.slice(0, -1).forEach(reply => request.mockResolvedValueOnce(reply.content));
    request.mockResolvedValue(fixture.replies.at(-2).content);
    const onFileValidated = jest.fn();
    await expect(generateStagedWorkspace({...fixture, request, onFileValidated}))
        .rejects.toThrow('after repeated repairs of /ui/compose.ts');
    expect(request).toHaveBeenCalledTimes(fixture.replies.length + 1);
    expect(onFileValidated).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.at(-1)[0].prompt).toContain('REPEAT REJECTION');
});


test.each([['css', 3072], ['ts', 6144]])('depth-two %s retry reaches the complete-file ceiling without another split', async (extension, ceiling) => {
    const root = `/root.${extension}`, branch = `/branch.${extension}`, leaf = `/controls.${extension}`;
    const manifest = path => JSON.stringify({files: [{path, contract: 'Focused module'}]});
    const seen = [];
    const request = jest.fn(async options => {
        seen.push(options);
        switch (seen.length) {
            case 1: return manifest(root);
            case 2: throw outputLimit();
            case 3: return manifest(branch);
            case 4: case 5: throw outputLimit();
            case 6: return manifest(leaf);
            default: {
                if (options.workspaceStep === leaf && options.maxOutputTokens < ceiling) throw outputLimit();
                const source = extension === 'css' ? (options.workspaceStep === leaf ? '.control { display: flex; }'
                    : `@import "./${options.workspaceStep === branch ? 'controls' : 'branch'}.css";`)
                    : 'export const ready = true;';
                return file(options.workspaceStep, source);
            }
        }
    });
    const result = await generateStagedWorkspace({prompt: 'Build focused modules', request});
    expect(result).toContain(`### File: ${leaf}`);
    expect(seen.filter(call => call.workspaceStep === leaf).map(call => call.maxOutputTokens))
        .toEqual([extension === 'css' ? 1024 : 1536, ceiling]);
    expect(request).toHaveBeenCalledTimes(10);
});

test.each([false, true])('at 36 files CSS splitting selects only existing dependencies (invalid first: %s)', async invalidFirst => {
    const root = '/styles/base.css';
    const helpers = ['/styles/tokens.css', '/styles/controls.css', ...Array.from({length: 10}, (_, i) => `/styles/part${i}.css`)];
    const tail = Array.from({length: 23}, (_, i) => `/tail${i}.ts`);
    const manifest = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused module'}))});
    const calls = [];
    let reuseAttempts = 0;
    let controlsAttempts = 0;
    const request = jest.fn(async options => {
        calls.push(options);
        if (calls.length === 1) return manifest([root, ...tail]);
        if (calls.length === 2) throw outputLimit();
        if (calls.length === 3) return manifest(helpers);
        if (options.planStage) {
            reuseAttempts++;
            expect(options.prompt).toContain('REUSE EXISTING CSS DEPENDENCIES ONLY');
            expect(options.prompt).not.toContain('Add smaller .css files');
            const allowed = options.responseSchema.properties.files.items.properties.path.enum;
            expect(allowed).toContain('/styles/tokens.css');
            expect(allowed).not.toContain(root);
            expect(allowed).not.toContain('/styles/controls.css');
            return manifest([invalidFirst && reuseAttempts === 1 ? '/styles/new.css' : '/styles/tokens.css']);
        }
        if (options.workspaceStep === '/styles/controls.css' && controlsAttempts++ < 2) throw outputLimit();
        const source = options.workspaceStep === root ? helpers.map(path => `@import "./${path.split('/').pop()}";`).join('\n')
            : options.workspaceStep === '/styles/controls.css' ? '@import "./tokens.css"; .control { color: var(--ink); }'
            : options.workspaceStep.endsWith('.css') ? ':root { --ink: black; }' : 'export {};';
        return file(options.workspaceStep, source);
    });
    const result = await generateStagedWorkspace({prompt: 'Build a workspace', request});
    expect(result.match(/### File:/g)).toHaveLength(36);
    expect(result).not.toContain('### File: /styles/new.css');
    expect(reuseAttempts).toBe(invalidFirst ? 2 : 1);
    const composition = calls.filter(call => call.workspaceStep === '/styles/controls.css').at(-1);
    expect(composition.maxOutputTokens).toBe(3072);
    expect(composition.includeImage).toBe(false);
    expect(composition.prompt).toContain('FOCUSED CSS COMPOSITION');
    expect(calls.filter(call => call.workspaceStep === '/styles/tokens.css')).toHaveLength(1);
});

test('runtime repair gives test requests the repaired implementation and preserves original assertions as evidence', async () => {
    const original = 'export function role(): string { return "bug"; }';
    const repaired = 'export function role(): string { return "img"; }';
    const assertion = 'import {test} from "node:test"; import assert from "node:assert/strict"; import {role} from "./logic"; test("SVG role", () => assert.equal(role(), "img"));';
    const workspaceFiles = [{path: '/logic.test.ts', content: assertion}, {path: '/logic.ts', content: original}];
    const repairPaths = getValidationRepairPaths([
        '/logic.test.ts: Generated tests failed (1). SVG role is incorrect.',
        '/logic.ts: Implementation referenced by a failing test or its stack',
    ], workspaceFiles);
    const request = jest.fn(async options => {
        if (options.workspaceStep === '/logic.ts') {
            expect(options.prompt).toContain(assertion);
            return file('/logic.ts', repaired);
        }
        expect(options.prompt).toContain(repaired);
        expect(options.prompt).not.toContain(original);
        return file('/logic.test.ts', assertion);
    });
    await generateStagedWorkspace({prompt: 'Fix the SVG role without weakening its assertion.', workspaceFiles, repairPaths, request});
    expect(request.mock.calls.map(([options]) => options.workspaceStep)).toEqual(['/logic.ts', '/logic.test.ts']);
});

test('scoped test-first repair carries pending implementations and then repaired assertions', async () => {
    const implementation = 'export function format(): string { return "json-format"; }\n' + '// context padding\n'.repeat(130);
    const originalTest = 'import {format} from "./logic"; export const check = () => format() === "json-formatter";';
    const correctedTest = 'import {format} from "./logic"; export const check = () => format() === "json-format";\n' + '// test padding\n'.repeat(150);
    const request = jest.fn(async options => {
        if (options.workspaceStep === '/logic.test.ts') {
            expect(options.prompt).toContain(implementation);
            return file('/logic.test.ts', correctedTest);
        }
        expect(options.prompt).toContain(correctedTest);
        expect(options.prompt).not.toContain(originalTest);
        return file('/logic.ts', implementation);
    });
    await generateStagedWorkspace({prompt: 'Repair the mismatched ID without changing the documented catalog', request,
        workspaceFiles: [{path: '/logic.test.ts', content: originalTest}, {path: '/logic.ts', content: implementation}],
        repairPaths: ['/logic.test.ts', '/logic.ts']});
    expect(request).toHaveBeenCalledTimes(2);
});

test('CSS composition sees concrete selected styles rather than a second workspace design request', async () => {
    const css = '.control { color: var(--ink); }\n' + '/* preserve concrete dependency */\n'.repeat(80);
    const plan = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused styles'}))});
    const request = jest.fn()
        .mockResolvedValueOnce(plan(['/unrelated.ts', '/styles.css']))
        .mockResolvedValueOnce(file('/unrelated.ts', 'export const UNRELATED_SOURCE_SENTINEL = "private details";'))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(plan(['/controls.css']))
        .mockResolvedValueOnce(file('/controls.css', css))
        .mockResolvedValueOnce(file('/styles.css', '@import "./controls.css"; .unique { margin: 0; }'));
    await generateStagedWorkspace({prompt: 'Preserve a purple accent and reduced motion.', request});
    const composition = request.mock.calls.at(-1)[0];
    expect(composition.prompt).toContain('FOCUSED CSS COMPOSITION');
    expect(composition.prompt).toContain(css);
    expect(composition.prompt).toContain('purple accent and reduced motion');
    expect(composition.prompt).not.toContain('UNRELATED_SOURCE_SENTINEL');
    expect(composition.prompt).toContain('@import "./controls.css";');
    expect(composition.includeImage).toBe(false);
    expect(request).toHaveBeenCalledTimes(6);
});

test.each(['complete', 'overflow', 'cancel', 'budget'])('a full workspace gets one focused source completion attempt: %s', async outcome => {
    const paths = Array.from({length: 24}, (_, i) => `/feature${i}.ts`);
    const helpers = Array.from({length: 12}, (_, i) => `/helpers/part${i}.ts`);
    const manifest = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused source module'}))});
    let planned = false, split = false, lateCalls = 0, stopped = false;
    const request = jest.fn(async options => {
        if (!planned) { planned = true; return manifest(paths); }
        if (options.planStage) { split = true; return manifest(helpers); }
        if (!split) throw outputLimit();
        if (options.workspaceStep === paths[1]) {
            lateCalls++;
            if (lateCalls === 1) throw outputLimit();
            expect(options.prompt).toContain('COMPLETE EXISTING MODULE AT WORKSPACE CAPACITY');
            expect(options.maxOutputTokens).toBe(8192);
            expect(options.includeImage).toBe(false);
            expect(options.prompt).toContain('/helpers/part0.ts');
            if (outcome === 'overflow') throw outputLimit();
        }
        if (options.workspaceStep === paths[2]) expect(options.maxOutputTokens).toBe(6144);
        return file(options.workspaceStep, 'export const ready = true;');
    });
    const result = generateStagedWorkspace({prompt: 'Build a workspace', request,
        onStage: stage => { if (outcome === 'cancel' && stage.label.startsWith('Completing ')) stopped = true; },
        assertActive: () => { if (stopped) throw new Error('Cancelled'); },
        assertBudget: () => { if (outcome === 'budget' && lateCalls === 1) throw new Error('Budget exhausted'); }});
    if (outcome === 'complete') expect((await result).match(/### File:/g)).toHaveLength(36);
    else await expect(result).rejects.toThrow(outcome === 'cancel' ? 'Cancelled' : outcome === 'budget' ? 'Budget exhausted' : 'workspace safety limit of 36 files');
    expect(lateCalls).toBe(['cancel', 'budget'].includes(outcome) ? 1 : 2);
    expect(request.mock.calls.filter(([call]) => call.planStage)).toHaveLength(2);
});

test.each([false, true])('explicit exhaustive CSS delegation assembles the root without another provider request (raw=%s)', async preferSourceResponses => {
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles.css', contract: 'Layout, controls and responsive states'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({importsOnly: true, files: [
            {path: '/styles/layout.css', contract: 'All shell layout and responsive layout rules'},
            {path: '/styles/controls.css', contract: 'All control styles, states and reduced motion rules'},
        ]}))
        .mockResolvedValueOnce(file('/styles/layout.css', '.shell { display: grid; } @media(max-width:600px) { .shell { display:block; } }'))
        .mockResolvedValueOnce(file('/styles/controls.css', '.control { color: purple; } .control:focus { outline: 2px solid; }'));
    const result = await generateStagedWorkspace({prompt: 'Build responsive styling', request, preferSourceResponses});
    expect(result).toContain('@import "./styles/layout.css";\n@import "./styles/controls.css";');
    expect(result).toContain('.control:focus');
    expect(result).toContain('@media(max-width:600px)');
    expect(result.match(/### File:/g)).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[2][0].responseSchema.properties.importsOnly).toEqual({type: 'boolean'});
    expect(request.mock.calls[2][0].prompt).toContain('Never declare full delegation while leaving required rules unassigned');
});

test('CSS delegation mode cannot be enabled by a truthy string', () => {
    expect(() => parseWorkspaceManifest(JSON.stringify({importsOnly: 'true', files: [
        {path: '/controls.css', contract: 'Control rules'},
    ]}), {includeCompositionMode: true})).toThrow('importsOnly must be a boolean');
});

test('explicit residual CSS mode preserves rules owned by the root', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles.css', contract: 'Controls and shell'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({importsOnly: false, files: [{path: '/controls.css', contract: 'Controls only'}]}))
        .mockResolvedValueOnce(file('/controls.css', '.control { color: purple; }'))
        .mockResolvedValueOnce(file('/styles.css', '@import "./controls.css"; .shell { display: grid; }'));
    const result = await generateStagedWorkspace({prompt: 'Build styles', request});
    expect(result).toContain('.shell { display: grid; }');
    expect(request).toHaveBeenCalledTimes(5);
});

test('imports-only delegation cannot hide a failed helper', async () => {
    const failure = new Error('Provider unavailable');
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles.css', contract: 'Controls and shell'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({importsOnly: true, files: [{path: '/controls.css', contract: 'All controls and shell rules'}]}))
        .mockRejectedValueOnce(failure);
    await expect(generateStagedWorkspace({prompt: 'Build styles', request})).rejects.toThrow('Provider unavailable');
    expect(request).toHaveBeenCalledTimes(4);
});

test.each([false, true])('overflowing scoped repair uses exact edits and preserves unrelated files (raw=%s)', async preferSourceResponses => {
    const workspaceFiles = [{path: '/logic.ts', content: 'export const result = 1;\nexport const retained = 42;'},
        {path: '/other.ts', content: 'export const untouched = true;'}];
    const original = JSON.stringify(workspaceFiles);
    const request = jest.fn().mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({edits: [{before: 'result = 1', after: 'result = 2'}]}));
    const stages = [];
    const result = await generateStagedWorkspace({prompt: '/logic.ts: result should be 2', workspaceFiles,
        repairPaths: ['/logic.ts'], request, preferSourceResponses, onStage: stage => stages.push(stage.label)});
    expect(result).toContain('result = 2');
    expect(result).toContain('retained = 42');
    expect(result).not.toContain('### File: /other.ts');
    expect(JSON.stringify(workspaceFiles)).toBe(original);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toMatchObject({includeImage: false, workspaceStep: '/logic.ts'});
    expect(request.mock.calls[1][0].prompt).toContain('/logic.ts: result should be 2');
    expect(stages).toContain('Repairing exact sections of /logic.ts');
});

test('exact repair fallback still validates the reconstructed source', async () => {
    const request = jest.fn().mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({edits: [{before: '1', after: '('}]}))
        .mockRejectedValue(new Error('Stop after validation'));
    const onValidation = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Fix result', workspaceFiles: [{path: '/logic.ts', content: 'export const result = 1;'}],
        repairPaths: ['/logic.ts'], request, onValidation})).rejects.toThrow();
    expect(onValidation).toHaveBeenCalled();
    expect(onValidation.mock.calls.some(([event]) => event.reason.includes('syntax'))).toBe(true);
});

test.each(['budget', 'cancel'])('scoped exact fallback respects %s before another request', async stop => {
    let calls = 0;
    const request = jest.fn(async () => { calls++; throw outputLimit(); });
    const guard = () => { if (calls) throw new Error(`stopped by ${stop}`); };
    await expect(generateStagedWorkspace({prompt: 'Repair result',
        workspaceFiles: [{path: '/logic.ts', content: 'export const result = 1;'}], repairPaths: ['/logic.ts'], request,
        ...(stop === 'budget' ? {assertBudget: guard} : {assertActive: guard}),
    })).rejects.toThrow(`stopped by ${stop}`);
    expect(request).toHaveBeenCalledTimes(1);
});

test('format-only recovery excludes the broad task and unrelated workspace context', async () => {
    const task = 'ORIGINAL_TASK_SENTINEL ' + 'large task context '.repeat(4000);
    const rejected = '```ts\nexport const first = 1;\n```\n```ts\nexport const second = 2;\n```';
    const request = jest.fn().mockResolvedValueOnce(rejected)
        .mockResolvedValueOnce('```ts\nexport const first = 1;\nexport const second = 2;\n```');
    const result = await generateStagedWorkspace({prompt: task, streamFiles: true,
        repairPaths: ['/logic.ts'], workspaceFiles: [
            {path: '/logic.ts', content: 'export const first = 0;'},
            {path: '/unrelated.ts', content: 'export const UNRELATED_SENTINEL = 42;'},
        ], request});
    const retry = request.mock.calls[1][0];
    expect(retry.prompt).toContain('FOCUSED FILE FORMAT REPAIR');
    expect(retry.prompt).toContain(rejected);
    expect(retry.prompt).not.toContain('ORIGINAL_TASK_SENTINEL');
    expect(retry.prompt).not.toContain('UNRELATED_SENTINEL');
    expect(retry.prompt.length).toBeLessThan(12000);
    expect(retry.includeImage).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toContain('export const second = 2;');
});

test('rejects unavailable SDK exports before accepting a staged file', async () => {
    const {validatePluginWorkspaceSdkContract} = require('../../src/utils/sdk/pluginWorkspaceSdkContract');
    const invalid = 'import {registerStyles} from "@anikitenko/fdo-sdk"; export const value = registerStyles({});';
    const corrected = 'export const value = "corrected";';
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/view.ts', contract: 'Export value'}]}))
        .mockResolvedValueOnce(file('/view.ts', invalid))
        .mockResolvedValueOnce(file('/view.ts', corrected));
    const onFileValidated = jest.fn();
    const validateFile = jest.fn(file => validatePluginWorkspaceSdkContract([file], {runtimeExports: ['DOM']}));
    const result = await generateStagedWorkspace({prompt: 'Create view', request, validateFile, onFileValidated});
    expect(result).toContain(corrected);
    expect(result).not.toContain('registerStyles');
    expect(request.mock.calls[2][0].prompt).toContain('does not provide "registerStyles"');
    expect(onFileValidated).toHaveBeenCalledTimes(1);
    expect(validateFile).toHaveBeenCalledTimes(2);
});

test('repairs reversed DOMText arguments before publishing the staged renderer', async () => {
    const {validatePluginWorkspaceSdkContract} = require('../../src/utils/sdk/pluginWorkspaceSdkContract');
    const invalid = 'import {DOMText} from "@anikitenko/fdo-sdk"; const text = new DOMText(); export const html = text.createSpanText({}, "wrench");';
    const corrected = invalid.replace('{}, "wrench"', '"wrench", {}');
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/view.ts', contract: 'Export html'}]}))
        .mockResolvedValueOnce(file('/view.ts', invalid))
        .mockResolvedValueOnce(file('/view.ts', corrected));
    const onFileValidated = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Create view', request, onFileValidated,
        validateFile: source => validatePluginWorkspaceSdkContract([source], {runtimeExports: ['DOMText']})});
    expect(request.mock.calls[2][0].prompt).toContain('createSpanText(text, options)');
    expect(result).toContain(corrected);
    expect(onFileValidated).toHaveBeenCalledTimes(1);
});

test('an unavailable SDK validation runtime fails closed before accepting source', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/view.ts', contract: 'Export value'}]}))
        .mockResolvedValueOnce(file('/view.ts', 'export const value = 1;'));
    const onFileValidated = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Create view', request, onFileValidated,
        validateFile: () => { throw new Error('SDK runtime unavailable'); },
    })).rejects.toThrow('SDK runtime unavailable');
    expect(onFileValidated).not.toHaveBeenCalled();
});

test('repairs the file closing a CSS cycle before accepting its source', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [
            {path: '/panels.css', contract: 'Panel styles using shared alerts'},
            {path: '/alerts.css', contract: 'Shared alert styles'},
        ]}))
        .mockResolvedValueOnce(file('/panels.css', '@import "./alerts.css"; .panel {display:block;}'))
        .mockResolvedValueOnce(file('/alerts.css', '@import "./panels.css"; .alert {color:red;}'))
        .mockResolvedValueOnce(file('/alerts.css', '.alert {color:red;}'));
    const result = await generateStagedWorkspace({prompt: 'Create panel and alert styles', request, workspaceFiles: []});
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3][0].prompt).toContain('/alerts.css: Circular CSS import:');
    expect(result).toContain('.panel {display:block;}');
    expect(result).toContain('.alert {color:red;}');
    expect(result).not.toContain('@import "./panels.css"');
});

test('repairs a split helper back import while the parent remains unwritten', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({files: [{path: '/styles/common.css', contract: 'Common card styling'}]}))
        .mockRejectedValueOnce(outputLimit())
        .mockResolvedValueOnce(JSON.stringify({importsOnly: true, files: [{path: '/styles/cards.css', contract: 'All card styles'}]}))
        .mockResolvedValueOnce(file('/styles/cards.css', '@import "./common.css"; .card {display:grid;}'))
        .mockResolvedValueOnce(file('/styles/cards.css', '.card {display:grid;}'));
    const result = await generateStagedWorkspace({prompt: 'Create common card styles', request, workspaceFiles: []});
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[3][0].prompt).toContain('FORBIDDEN CSS BACK IMPORTS: ["/styles/common.css"]');
    expect(request.mock.calls[4][0].workspaceStep).toBe('/styles/cards.css');
    expect(request.mock.calls[4][0].prompt).toContain('/styles/cards.css: Circular CSS import:');
    expect(result).toContain('@import "./cards.css";');
    expect(result).toContain('.card {display:grid;}');
    expect(result).not.toContain('@import "./common.css"');
});

test.each(['corrected', 'repeated', 'budget', 'cancel'])('exact match correction is atomic and bounded: %s', async outcome => {
    const original = 'export const value = 1;\nexport const other = 1;';
    const bad = JSON.stringify({edits: [{before: '1', after: '2'}]});
    const request = jest.fn().mockRejectedValueOnce(outputLimit()).mockResolvedValueOnce(bad)
        .mockImplementationOnce(options => {
            if (outcome === 'repeated') return bad;
            expect(options.responseSchema.properties.edits.items.properties.start).toEqual({type: 'integer', minimum: 1, maximum: 2});
            expect(options.prompt).not.toContain('SCOPED EXACT FILE REPAIR');
            const anchor = 1;
            return JSON.stringify({edits: [{start: anchor, end: anchor, after: 'export const value = 2;'}]});
        });
    let cancelled = false;
    const result = generateStagedWorkspace({prompt: 'Fix value', repairPaths: ['/logic.ts'],
        workspaceFiles: [{path: '/logic.ts', content: original}], request,
        onStage: stage => { if (outcome === 'cancel' && stage.label.startsWith('Correcting exact')) cancelled = true; },
        assertActive: () => { if (cancelled) throw new Error('Cancelled'); },
        assertBudget: () => { if (outcome === 'budget' && request.mock.calls.length === 2) throw new Error('Budget exhausted'); },
    });
    if (outcome === 'corrected') {
        expect(await result).toContain('value = 2;\nexport const other = 1;');
        expect(request.mock.calls[2][0].prompt).toContain('before block has 2 exact matches');
        expect(request.mock.calls[2][0].prompt).toContain('1 | export const value = 1;');
        expect(request.mock.calls[2][0].prompt).toContain('2 | export const other = 1;');
    } else await expect(result).rejects.toThrow(outcome === 'repeated' ? '/logic.ts: Anchored file repair rejected' : outcome === 'budget' ? 'Budget exhausted' : 'Cancelled');
    expect(request).toHaveBeenCalledTimes(['budget', 'cancel'].includes(outcome) ? 2 : 3);
});

test('a cross-file diagnostic never quotes the same line number from the rejected file', async () => {
    expect.assertions(3);
    const source = '// catalog line\n'.repeat(63) + 'export const tools = [];';
    const request = jest.fn().mockResolvedValue(file('/catalog.ts', source));
    try {
        await generateStagedWorkspace({prompt: 'Repair catalog', workspaceFiles: [{path: '/catalog.ts', content: source}],
            repairPaths: ['/catalog.ts'], request,
            validateFile: () => ['/index.ts:64:16: renderApp is missing categories and tools'],
        });
    } catch (error) {
        expect(error.message).toContain('/index.ts:64:16:');
        expect(error.message).not.toContain('Rejected source around line');
        expect(error.message).not.toContain('64: export const tools');
    }
});

test('generated style tests receive asset evidence and semantic assertion guidance during repair', async () => {
    const css = '.wt-input {background:url("data:image/svg+xml,www.w3.org");}';
    const testSource = 'const stylesheets = ["styles/input.css"]; export const files = stylesheets;';
    const request = jest.fn().mockResolvedValue(file('/test/styles.test.ts', testSource));
    await generateStagedWorkspace({prompt: 'Fix CSS selector assertions', repairPaths: ['/test/styles.test.ts'],
        workspaceFiles: [{path: '/test/styles.test.ts', content: testSource}, {path: '/styles/input.css', content: css}], request});
    expect(request.mock.calls[0][0].prompt).toContain(css);
    expect(request.mock.calls[0][0].prompt).toContain('Check CSS class names in selectors only');
    expect(request.mock.calls[0][0].prompt).toContain('keep rendering escapes intact');
});

test('a split with one remaining slot gets a one-helper corrective schema', async () => {
    const paths = ['/first.css', '/styles/components.css', ...Array.from({length: 22}, (_, i) => `/feature${i}.ts`)];
    const inventory = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused module'}))});
    let firstSplit = false, secondSplit = false, corrected = false;
    const request = jest.fn(async options => {
        if (options.planStage) {
            if (options.responseSchema.properties.helpers) {
                expect(options.responseSchema.properties.helpers.maxItems).toBe(1);
                expect(options.prompt).toContain('Return 1–1 cohesive responsibilities');
                const example = options.prompt.match(/Return JSON of this shape: (.*)\./)[1];
                expect(JSON.parse(example).helpers).toHaveLength(1);
                corrected = true;
                return JSON.stringify({helpers: [{name: 'controls', contract: 'Button styling'}]});
            }
            if (options.workspaceStep.includes('/first.css')) {
                firstSplit = true;
                return inventory(Array.from({length: 11}, (_, i) => `/part${i}.css`));
            }
            if (options.workspaceStep.includes('/styles/components.css')) {
                secondSplit = true;
                return inventory(['/styles/buttons.css', '/styles/inputs.css']);
            }
            return inventory(paths);
        }
        if (options.workspaceStep === '/first.css' && !firstSplit) throw outputLimit();
        if (options.workspaceStep === '/styles/components.css' && !secondSplit) throw outputLimit();
        return file(options.workspaceStep, options.workspaceStep.endsWith('.css') ? '.control { color: black; }' : 'export {};');
    });
    const result = await generateStagedWorkspace({prompt: 'Build workspace', request});
    expect(corrected).toBe(true);
    expect(result.match(/### File:/g)).toHaveLength(36);
    expect(result).toContain('### File: /styles/components-controls.css');
    expect(result).not.toContain('### File: /styles/buttons.css');
});

test('plugin SKILL.md is generated first and supplied to subsequent file requests', async () => {
    const guide = '# Plugin contracts\nUse canonical ID json.formatter. Preserve escaping and test assertions.';
    const request = jest.fn(async options => {
        if (options.planStage) return JSON.stringify({files: [
            {path: '/logic.ts', contract: 'Export tool ID'}, {path: '/SKILL.md', contract: 'Plugin development conventions'},
        ]});
        if (options.workspaceStep === '/SKILL.md') return file('/SKILL.md', guide);
        expect(options.prompt).toContain(guide);
        expect(options.prompt).toContain('authorized file scope and executable validation take precedence');
        return file('/logic.ts', 'export const id = "json.formatter";');
    });
    const result = await generateStagedWorkspace({prompt: 'Create a plugin with its guide', request});
    expect(request.mock.calls.filter(([options]) => !options.planStage).map(([options]) => options.workspaceStep))
        .toEqual(['/SKILL.md', '/logic.ts']);
    expect(result).toContain('### File: /SKILL.md');
});

test('existing plugin guidance is bounded read-only context during targeted repairs', async () => {
    const guide = '# Keep meaningful tests\n' + 'x'.repeat(17000) + 'OUTSIDE_CONTEXT';
    const request = jest.fn(async options => {
        expect(options.prompt).toContain('# Keep meaningful tests');
        expect(options.prompt).toContain('[Skill excerpt limited to 16000 characters.]');
        expect(options.prompt).not.toContain('OUTSIDE_CONTEXT');
        return file('/logic.ts', 'export const value = 2;');
    });
    const result = await generateStagedWorkspace({prompt: 'Repair value', request, repairPaths: ['/logic.ts'],
        workspaceFiles: [{path: '/SKILL.md', content: guide}, {path: '/logic.ts', content: 'export const value = 1;'}]});
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).not.toContain('### File: /SKILL.md');
});

test('invalid generated skill examples are repaired before the guide reaches implementation requests', async () => {
    const {validatePluginWorkspaceSdkContract} = require('../../src/utils/sdk/pluginWorkspaceSdkContract');
    const invalid = '# Guide\n~~~ts\nimport {registerStyles} from "@anikitenko/fdo-sdk";\n~~~';
    const corrected = '# Guide\n~~~ts\nimport {DOMText} from "@anikitenko/fdo-sdk";\nnew DOMText().createSpanText("label", {});\n~~~';
    let attempts = 0;
    const request = jest.fn(async options => {
        if (options.planStage) return JSON.stringify({files: [{path: '/SKILL.md', contract: 'SDK examples'}, {path: '/logic.ts', contract: 'Value'}]});
        if (options.workspaceStep === '/SKILL.md') {
            if (++attempts === 1) return JSON.stringify({path: '/SKILL.md', content: invalid});
            expect(options.prompt).toContain('does not provide "registerStyles"');
            return JSON.stringify({path: '/SKILL.md', content: corrected});
        }
        expect(options.prompt).toContain(corrected);
        expect(options.prompt).not.toContain(invalid);
        return file('/logic.ts', 'export const value = 1;');
    });
    const result = await generateStagedWorkspace({prompt: 'Create plugin', request,
        validateFile: source => validatePluginWorkspaceSdkContract([source], {runtimeExports: ['DOMText']})});
    expect(attempts).toBe(2);
    expect(result).toContain(corrected);
});

test('invalid retained skill guidance is withheld without authorizing a guide rewrite', async () => {
    const {validatePluginWorkspaceSdkContract} = require('../../src/utils/sdk/pluginWorkspaceSdkContract');
    const guide = '# UNSUPPORTED_GUIDE_INSTRUCTION\n~~~ts\nimport {registerStyles} from "@anikitenko/fdo-sdk";\n~~~';
    const request = jest.fn(async options => {
        expect(options.prompt).toContain('Plugin guidance /SKILL.md was withheld');
        expect(options.prompt).not.toContain('UNSUPPORTED_GUIDE_INSTRUCTION');
        return file('/logic.ts', 'export const value = 2;');
    });
    const result = await generateStagedWorkspace({prompt: 'Fix value', request, repairPaths: ['/logic.ts'],
        workspaceFiles: [{path: '/SKILL.md', content: guide}, {path: '/logic.ts', content: 'export const value = 1;'}],
        validateFile: source => validatePluginWorkspaceSdkContract([source], {runtimeExports: ['DOMText']})});
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).not.toContain('### File: /SKILL.md');
});

test('guide approval pauses implementation and edited approved content becomes its context', async () => {
    let approve;
    let shown;
    const reviewStarted = new Promise(resolve => { shown = resolve; });
    const reviewSkill = jest.fn(file => { shown(file); return new Promise(resolve => { approve = resolve; }); });
    const request = jest.fn(async options => {
        if (options.planStage) return JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}, {path: '/logic.ts', contract: 'Value'}]});
        if (options.workspaceStep === '/SKILL.md') return JSON.stringify({path: '/SKILL.md', content: '# Proposed guide'});
        expect(options.prompt).toContain('# Approved edited guide');
        return file('/logic.ts', 'export const value = 1;');
    });
    const result = generateStagedWorkspace({prompt: 'Build plugin', request, reviewSkill});
    await reviewStarted;
    expect(request).toHaveBeenCalledTimes(2);
    approve('# Approved edited guide');
    expect(await result).toContain('# Approved edited guide');
    expect(request).toHaveBeenCalledTimes(3);
});

test('rejected guide review does not generate implementation files', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}, {path: '/logic.ts', contract: 'Value'}]}))
        .mockResolvedValueOnce(JSON.stringify({path: '/SKILL.md', content: '# Guide'}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request,
        reviewSkill: async () => { throw new Error('Cancelled'); }})).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledTimes(2);
});

test('stale SDK guide cannot be silently used by an unrelated scoped repair', async () => {
    const request = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Fix value', request, sdkFingerprint: 'a'.repeat(64), repairPaths: ['/logic.ts'],
        workspaceFiles: [{path: '/SKILL.md', content: '# Old guide'}, {path: '/logic.ts', content: 'export const value = 1;'}]}))
        .rejects.toThrow('fingerprint is missing or stale');
    expect(request).not.toHaveBeenCalled();
});

test('rejects unavailable planned APIs before generating any source', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify({files: [{path: '/logic.ts', contract: 'Unknown API'}]}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request, validatePlan: () => ['/logic.ts: Unknown SDK API']})).rejects.toThrow('Unknown SDK API');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([options]) => options.planStage)).toBe(true);
});

test('SDK migration requires a guide in the plan and reviews unchanged guide content', async () => {
    const criterion = [{id: 'proof', description: 'Proves behavior', testFile: '/proof.test.ts', testName: 'proof'}];
    const content = '# Guide\n<!-- fdo-acceptance -->\n~~~json\n' + JSON.stringify(criterion) + '\n~~~';
    const reviewSkill = jest.fn(async file => file.content + '\n<!-- fdo-sdk-fingerprint: ' + 'a'.repeat(64) + ' -->');
    const request = jest.fn(async options => options.planStage
        ? JSON.stringify({files: [{path: '/SKILL.md', contract: 'Migrate guide'}]})
        : JSON.stringify({path: '/SKILL.md', content}));
    const result = await generateStagedWorkspace({prompt: 'Migrate guide', request, sdkFingerprint: 'a'.repeat(64), reviewSkill,
        workspaceFiles: [{path: '/SKILL.md', content}]});
    expect(reviewSkill).toHaveBeenCalledTimes(1);
    expect(result).toContain('fdo-sdk-fingerprint');
});

test('guide generation and format repair explain acceptance JSON and preserve tilde fences', async () => {
    const guide = '# Guide\n<!-- fdo-acceptance -->\n~~~json\n[{"id":"behavior","description":"Required behavior","testFile":"/behavior.test.ts","testName":"works"}]\n~~~';
    let attempts = 0;
    const request = jest.fn(async options => {
        if (options.planStage) return JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}]});
        expect(options.prompt).toContain('<!-- fdo-acceptance -->');
        expect(options.prompt).toContain('~~~json');
        expect(options.prompt).toContain('Preserve the acceptance block');
        if (++attempts === 1) return file('/SKILL.md', guide.replaceAll('~~~', '```'));
        return '```markdown\n' + guide + '\n```';
    });
    const result = await generateStagedWorkspace({prompt: 'Create guide', request, streamFiles: true});
    expect(attempts).toBe(2);
    expect(result).toContain(guide);
});

test('guide output overflow retries concisely once and never requests a split plan', async () => {
    const request = jest.fn(async options => {
        if (options.planStage) return JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}]});
        throw outputLimit();
    });
    await expect(generateStagedWorkspace({prompt: 'Create guide', request})).rejects.toThrow('guides cannot be split');
    expect(request.mock.calls.filter(([options]) => options.planStage)).toHaveLength(1);
    expect(request.mock.calls).toHaveLength(3);
    expect(request.mock.calls[2][0].prompt).toContain('FINAL CONCISION RETRY');
});

test('guide character overflow is recovered before approval without splitting', async () => {
    let attempts = 0;
    const reviewSkill = jest.fn(async entry => entry.content);
    const request = jest.fn(async options => options.planStage
        ? JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}]})
        : file('/SKILL.md', ++attempts === 1 ? 'x'.repeat(16001) : '# Concise guide'));
    await generateStagedWorkspace({prompt: 'Create guide', request, reviewSkill});
    expect(attempts).toBe(2);
    expect(reviewSkill).toHaveBeenCalledTimes(1);
});

test('guide lines are bounded by its character budget rather than the source line ceiling', () => {
    const lines = Array.from({length: 2001}, () => 'a');
    expect(workspaceFileSchema('/SKILL.md').properties.lines.maxItems).toBe(16001);
    expect(validateWorkspaceFile(JSON.stringify({path: '/SKILL.md', lines}), '/SKILL.md')).toContain('a\na');
    expect(() => validateWorkspaceFile(JSON.stringify({path: '/logic.ts', lines}), '/logic.ts')).toThrow('2001');
});

test('repairs missing acceptance declarations before completing a generated test file', async () => {
    const testPath = '/favorites.test.ts';
    const criterion = {id: 'favorites-persist', description: 'Favorites survive save and load', testFile: testPath, testName: 'load and save favorites round-trip'};
    const guide = '# Guide\n<!-- fdo-acceptance -->\n~~~json\n' + JSON.stringify([criterion,
        {...criterion, id: 'later', testFile: '/later.test.ts', testName: 'later behavior'}]) + '\n~~~';
    let attempts = 0;
    const completed = jest.fn();
    const request = jest.fn(async options => {
        if (options.planStage) return JSON.stringify({files: [{path: testPath, contract: 'Favorites persistence tests'}]});
        expect(options.prompt).toContain('APPROVED ACCEPTANCE TESTS REQUIRED IN /favorites.test.ts');
        expect(options.prompt).toContain('load and save favorites round-trip');
        expect(options.prompt).toContain('meaningful assertions');
        if (++attempts === 1) return file(testPath, 'import {test} from "node:test"; test("unrelated", () => {});');
        expect(completed).not.toHaveBeenCalled();
        expect(options.prompt).toContain('Acceptance favorites-persist requires');
        return file(testPath, 'import {test} from "node:test"; import assert from "node:assert/strict"; test("load and save favorites round-trip", () => { const saved = JSON.stringify(["json"]); assert.deepEqual(JSON.parse(saved), ["json"]); });');
    });
    const result = await generateStagedWorkspace({prompt: 'Implement favorites tests', request,
        workspaceFiles: [{path: '/SKILL.md', content: guide}], onFileCompleted: completed});
    expect(attempts).toBe(2);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(result).toContain('load and save favorites round-trip');
});

test('scoped repairs recheck TypeScript before accepting a file and use latest repaired dependencies', async () => {
    const workspaceFiles = [{path: '/a.ts', content: 'export const a = 0;'}, {path: '/b.ts', content: 'export const b = 0;'}];
    let attempts = 0;
    const validateRepairFile = jest.fn((entry, candidate) => {
        if (entry.path === '/a.ts' && entry.content.includes('"wrong"')) return ['/a.ts:1:14: TS2322: Type string is not assignable to number.'];
        if (entry.path === '/b.ts') expect(candidate.find(item => item.path === '/a.ts').content).toBe('export const a: number = 1;');
        return [];
    });
    const request = jest.fn(async options => {
        if (options.workspaceStep === '/a.ts') {
            if (++attempts === 1) return file('/a.ts', 'export const a: number = "wrong";');
            expect(options.prompt).toContain('TS2322');
            return file('/a.ts', 'export const a: number = 1;');
        }
        return file('/b.ts', 'export const b = 2;');
    });
    await generateStagedWorkspace({prompt: 'Repair compiler errors', workspaceFiles, repairPaths: ['/a.ts', '/b.ts'], request, validateRepairFile});
    expect(attempts).toBe(2);
    expect(validateRepairFile).toHaveBeenCalledTimes(3);
});

test.each(['recovers', 'stops', 'budget exhausted'])('guide source repair interrupted by repeated missing fences %s within a bounded budget', async outcome => {
    const criterion = {id: 'behavior', description: 'Required behavior', testFile: '/behavior.test.ts', testName: 'works'};
    const guide = values => '# Guide\n<!-- fdo-acceptance -->\n~~~json\n' + JSON.stringify(values) + '\n~~~';
    const valid = guide([criterion]);
    const invalid = guide([{...criterion, testName: ''}]);
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/SKILL.md', contract: 'Guide'}]}))
        .mockResolvedValueOnce(file('/SKILL.md', invalid))
        .mockResolvedValueOnce('Here is the guide:\n' + valid).mockResolvedValueOnce('Here is the guide:\n' + valid)
        .mockResolvedValueOnce(outcome === 'recovers' ? '```markdown\n' + valid + '\n```' : 'Here is the guide:\n' + valid);
    const completed = jest.fn();
    const result = generateStagedWorkspace({prompt: 'ORIGINAL WORKSPACE REQUEST', request, streamFiles: true,
        onFileCompleted: completed, assertBudget: () => {
            if (outcome === 'budget exhausted' && request.mock.calls.length >= 4) throw new Error('Request budget exhausted');
        }, validateFile: item => {
            if (item.content.includes('"testName":""')) return ['/SKILL.md: Acceptance criterion 1: testName must be a non-empty string.'];
            return [];
        }});
    if (outcome === 'recovers') {
        expect(await result).toContain(valid);
        expect(completed).toHaveBeenCalledTimes(1);
    } else {
        await expect(result).rejects.toThrow(outcome === 'budget exhausted' ? 'Request budget exhausted' : 'repeated repairs of /SKILL.md (format validation)');
        expect(completed).not.toHaveBeenCalled();
    }
    expect(request).toHaveBeenCalledTimes(outcome === 'budget exhausted' ? 4 : 5);
    for (const [options] of request.mock.calls.slice(3)) {
        expect(options.prompt).toContain('FOCUSED FILE FORMAT REPAIR');
        expect(options.prompt).not.toContain('ORIGINAL WORKSPACE REQUEST');
        expect(options.prompt).toContain('testName must be a non-empty string');
        expect(options.prompt).toContain(valid);
        expect(options.includeImage).toBe(false);
    }
    if (outcome !== 'budget exhausted') expect(request.mock.calls[4][0].prompt).toContain('FINAL FORMAT RECOVERY');
});

test('invalid plan JSON reports parser coordinates without quoting its contents in the error message', () => {
    const broken = '{"files":[\n{"path":"/a.ts","contract":"Export a"}\n{"path":"/b.ts"}]}';
    let error;
    try { parseWorkspaceManifest(broken); } catch (caught) { error = caught; }
    expect(error.code).toBe('INVALID_WORKSPACE_MANIFEST_JSON');
    expect(error.rejectedManifest).toBe(broken);
    expect(error.jsonErrorLocation).toMatchObject({line: 3, column: 1});
    expect(error.message).toContain('line 3, column 1');
    expect(error.message).not.toContain('Export a');
});
test('a complete unlabelled JSON fence is a valid plan envelope', () => {
    const files = [{path: '/a.ts', contract: 'Export a'}];
    expect(parseWorkspaceManifest('```\n' + JSON.stringify({files}) + '\n```')).toEqual(files);
});

test('host-required guide occupies a slot before plan admission without duplication', () => {
    const files = Array.from({length: 23}, (_, i) => ({path: `/f${i}.ts`, contract: 'Feature'}));
    const plan = parseWorkspaceManifest(JSON.stringify({files}), {maxFiles: 24, requiredGuide: true});
    expect(plan).toHaveLength(24);
    expect(plan.at(-1).path).toBe('/SKILL.md');
    expect(parseWorkspaceManifest(JSON.stringify({files: plan}), {maxFiles: 24, requiredGuide: true})).toEqual(plan);
    expect(() => parseWorkspaceManifest(JSON.stringify({files: [...files, {path: '/extra.ts', contract: 'Extra'}]}), {maxFiles: 24, requiredGuide: true})).toThrow('received 25');
    expect(parseWorkspaceManifest(JSON.stringify({files}), {maxFiles: 24})).toHaveLength(23);
});
test.each([true, false])('omitted required guide is generated and reviewed before implementation (approval=%s)', async approved => {
    const guide = '# Guide\n<!-- fdo-acceptance -->\n~~~json\n[{"id":"works","description":"Works","testFile":"/works.test.ts","testName":"works"}]\n~~~';
    const request = jest.fn(async options => options.planStage
        ? JSON.stringify({files: [{path: '/logic.ts', contract: 'Logic'}]})
        : file(options.workspaceStep, options.workspaceStep === '/SKILL.md' ? guide : 'export {};'));
    const reviewSkill = jest.fn(async item => {
        expect(request).toHaveBeenCalledTimes(2);
        if (!approved) throw new Error('Review declined');
        return item.content;
    });
    const result = generateStagedWorkspace({prompt: 'Build plugin', sdkFingerprint: 'a'.repeat(64), request, reviewSkill});
    if (approved) {
        expect(await result).toContain('/logic.ts');
        expect(request).toHaveBeenCalledTimes(3);
    } else {
        await expect(result).rejects.toThrow('Review declined');
        expect(request).toHaveBeenCalledTimes(2);
    }
    expect(request.mock.calls[1][0].workspaceStep).toBe('/SKILL.md');
    expect(reviewSkill).toHaveBeenCalledTimes(1);
});

test('host-added guide is included in the remaining request budget before generation', async () => {
    const options = budgetedWorkspace(2, [JSON.stringify({files: [{path: '/logic.ts', contract: 'Logic'}]})]);
    await expect(generateStagedWorkspace({...options, sdkFingerprint: 'a'.repeat(64)})).rejects.toThrow('2 requests needed, 1 remaining');
    expect(options.request).toHaveBeenCalledTimes(1);
});

test.each(['tokens', 'characters'])('compact repair overflow gets one anchored correction: %s', async kind => {
    const overflow = () => kind === 'tokens' ? outputLimit() : Object.assign(new Error('too large'), {code: 'CODING_RESPONSE_TOO_LARGE'});
    const workspaceFiles = [{path: '/render.tsx', content: 'export const value = 1;\nexport const retained = 42;'}];
    const request = jest.fn().mockRejectedValueOnce(overflow()).mockRejectedValueOnce(overflow())
        .mockResolvedValueOnce(JSON.stringify({edits: [{start: 1, end: 1, after: 'export const value = 2;'}]}));
    const validateFile = jest.fn(() => []);
    const result = await generateStagedWorkspace({prompt: 'Fix value', workspaceFiles, repairPaths: ['/render.tsx'], request, validateFile});
    expect(result).toContain('value = 2');
    expect(result).toContain('retained = 42');
    expect(workspaceFiles[0].content).toContain('value = 1');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].prompt).toContain('SCOPED LINE RANGE REPAIR');
    expect(validateFile).toHaveBeenCalledWith({path: '/render.tsx', content: 'export const value = 2;\nexport const retained = 42;'});
});

test('repeated compact repair output limits stop without completing a file', async () => {
    const request = jest.fn().mockRejectedValue(outputLimit());
    const completed = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Fix value', workspaceFiles: [{path: '/render.tsx', content: 'export const value = 1;'}],
        repairPaths: ['/render.tsx'], request, onFileCompleted: completed})).rejects.toThrow('Compact targeted repair exceeded');
    expect(request).toHaveBeenCalledTimes(3);
    expect(completed).not.toHaveBeenCalled();
});


test('reasoning-only plan exhaustion gets one larger retry without relaxing inventory bounds', async () => {
    const failure = Object.assign(outputLimit(), {reasoningOnly: true});
    const request = jest.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request.mock.calls.map(([value]) => value.maxOutputTokens)).toEqual([2048, 8192, 6144, 6144]);
    expect(request.mock.calls[1][0].maximumResponseCharacters).toBe(9000);
    expect(request.mock.calls[1][0].prompt).toContain('budget on reasoning without returning an inventory');
});

test('repeated reasoning-only truncation reports the cause and stops before file generation', async () => {
    const request = jest.fn().mockRejectedValue(Object.assign(outputLimit(), {reasoningOnly: true}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request}))
        .rejects.toThrow('Workspace planning exhausted its output budget on reasoning');
    expect(request).toHaveBeenCalledTimes(2);
});

test('source mode accepts raw JSON file contents without changing their bytes', () => {
    const content = '{\n  "name": "json-inspector",\n  "version": "1.0.0",\n  "scripts": {"test": "node --test"}\n}\n';
    const result = validateWorkspaceFile(content, '/package.json', {allowSourceFence: true});
    expect(result).toContain(content.trimEnd());
    expect(() => validateWorkspaceFile(content, '/package.json')).toThrow('Expected exactly path and lines');
    expect(() => validateWorkspaceFile(content, '/render.ts', {allowSourceFence: true})).toThrow('Expected exactly path and lines');
});

test.each([
    '{"path":"/other.json","content":"{}"}',
    '{"path":"/package.json","name":"example"}',
    '{"lines":[],"name":"example"}',
    '{"content":{},"name":"example"}',
    '{"name":"example",}',
    '{"name":"example"',
])('raw JSON recovery never hides malformed source or an invalid file envelope: %s', content => {
    expect(() => validateWorkspaceFile(content, '/package.json', {allowSourceFence: true})).toThrow();
});

test('a package envelope failure recovers when the provider returns raw JSON again', async () => {
    const content = '{"name":"json-inspector","version":"1.0.0"}';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/package.json', contract: 'Package metadata'}]}))
        .mockResolvedValue(content);
    const result = await generateStagedWorkspace({prompt: 'Update package metadata', request});
    expect(result).toContain(content);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].responseSchema).toBeUndefined();
});

test('a misplaced importsOnly entry is a repairable shape error, not an unsafe path', () => {
    expect.assertions(2);
    const plan = JSON.stringify({files: [{path: '/styles.css', contract: 'Styles'}, {importsOnly: true}]});
    try { parseWorkspaceManifest(plan, {includeCompositionMode: true}); }
    catch (error) {
        expect(error.code).toBe('INVALID_WORKSPACE_MANIFEST_SCHEMA');
        expect(error.message).toContain('importsOnly is a top-level plan flag');
    }
});

test('missing file paths receive the existing bounded corrective plan retry', async () => {
    const malformed = JSON.stringify({files: [{path: '/render.ts', contract: 'Render'}, {contract: 'Entry'}]});
    const request = jest.fn().mockResolvedValueOnce(malformed).mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(file('/render.ts')).mockResolvedValueOnce(file('/index.ts'));
    await generateStagedWorkspace({prompt: 'Build plugin', request});
    expect(request.mock.calls[1][0].prompt).toContain('invalid path at files[1]');
    expect(request).toHaveBeenCalledTimes(4);
    const repeated = jest.fn().mockResolvedValue(malformed);
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request: repeated})).rejects.toThrow('after one retry');
    expect(repeated).toHaveBeenCalledTimes(2);
});

test('a missing path cannot hide an unsafe path later in the plan', async () => {
    const request = jest.fn().mockResolvedValue(JSON.stringify({files: [{importsOnly: true},
        {path: '/../outside.ts', contract: 'Unsafe'}]}));
    await expect(generateStagedWorkspace({prompt: 'Build plugin', request})).rejects.toThrow('invalid path at files[1]');
    expect(request).toHaveBeenCalledTimes(1);
});

test('a late type contract leaves an earlier generated caller mismatch for complete candidate validation', async () => {
    const inventory = JSON.stringify({files: [
        {path: '/logic.ts', contract: 'Inspection implementation'},
        {path: '/caller.ts', contract: 'Inspection caller'},
        {path: '/types.ts', contract: 'Inspection types'},
    ]});
    const logic = 'import type {Input} from "./types"; export function inspect(input: Input) {return input;}';
    const caller = 'import {inspect} from "./logic"; export const result = inspect({input: "{}"});';
    const types = 'export interface Input {text: string;}';
    const response = (path, content) => JSON.stringify({path, content});
    const request = jest.fn().mockResolvedValueOnce(inventory)
        .mockResolvedValueOnce(response('/logic.ts', logic))
        .mockResolvedValueOnce(response('/caller.ts', caller))
        .mockResolvedValueOnce(response('/types.ts', types));
    const result = await generateStagedWorkspace({prompt: 'Create local inspection modules', request});
    expect(request).toHaveBeenCalledTimes(4);
    expect(result).toContain(types);
    const {validateGeneratedWorkspaceOptions} = require('../../src/utils/plugins/validation/generatedWorkspaceOptions');
    const errors = validateGeneratedWorkspaceOptions([{path: '/logic.ts', content: logic},
        {path: '/caller.ts', content: caller}, {path: '/types.ts', content: types}]);
    expect(errors).toEqual([expect.stringContaining('/caller.ts:')]);
    expect(errors[0]).toContain('missing required option fields: text');
    expect(errors[0]).not.toContain('immutable');
});

test('an import/class binding collision reaches source repair before SDK traversal can throw', async () => {
    const invalid = 'import {JSONInspectorPlugin} from "./logic"; export class JSONInspectorPlugin {}';
    const corrected = 'import {JSONInspectorPlugin as Logic} from "./logic"; export class JSONInspectorPlugin extends Logic {}';
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/actions.ts', contract: 'Action wrapper'}]}))
        .mockResolvedValueOnce(JSON.stringify({path: '/actions.ts', content: invalid}))
        .mockResolvedValueOnce(JSON.stringify({path: '/actions.ts', content: corrected}));
    const validateFile = jest.fn(file => {
        if (file.content === invalid) throw new Error('Duplicate declaration "JSONInspectorPlugin"');
        return [];
    });
    const result = await generateStagedWorkspace({prompt: 'Build action wrapper', request, validateFile,
        workspaceFiles: [{path: '/logic.ts', content: 'export class JSONInspectorPlugin {}'}]});
    expect(result).toContain(corrected);
    expect(request.mock.calls[2][0].prompt).toContain('Import binding');
    expect(validateFile).not.toHaveBeenCalledWith({path: '/actions.ts', content: invalid});
});

test('validated staged work resumes without regenerating completed helpers or planning again', async () => {
    const a = {path: '/a.ts', contract: 'Export a(): number'};
    const b = {path: '/b.ts', contract: 'Import a and export b(): number'};
    const progress = [];
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [a, b]}))
        .mockResolvedValueOnce(file('/a.ts', 'export function a(): number { return 1; }'))
        .mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(generateStagedWorkspace({prompt: 'Build helper functions', request, workspaceFiles: [], onCheckpoint: async value => progress.push(value)})).rejects.toThrow('Provider unavailable');
    const checkpoint = progress.at(-1);
    expect(checkpoint.completed.map(item => item.path)).toEqual(['/a.ts']);
    const resumeRequest = jest.fn().mockResolvedValue(file('/b.ts', 'import {a} from "./a"; export function b(): number {return a() + 1;}'));
    const validation = jest.fn(() => []);
    const result = await generateStagedWorkspace({prompt: 'Build helper functions', request: resumeRequest, workspaceFiles: [], resumeCheckpoint: checkpoint, validateFile: validation});
    expect(resumeRequest).toHaveBeenCalledTimes(1);
    expect(resumeRequest.mock.calls[0][0].workspaceStep).toBe('/b.ts');
    expect(result).toContain('function a()');
    expect(result).toContain('function b()');
    expect(validation).toHaveBeenCalledWith(expect.objectContaining({path: '/a.ts'}));
});

test('smaller scope reuses only standalone helpers with an unchanged contract', async () => {
    const a = {path: '/a.ts', contract: 'Export a(): number', content: 'export function a(): number { return 1; }'};
    const b = {path: '/b.ts', contract: 'Export b(): number'};
    const checkpoint = {completed: [a]};
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: a.path, contract: a.contract}, b]}))
        .mockResolvedValueOnce(file(b.path, 'export function b(): number {return 2;}'));
    const result = await generateStagedWorkspace({prompt: 'Build smaller helper set', request, workspaceFiles: [], reuseCheckpoint: checkpoint});
    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toContain('function a()');
    const regenerate = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: a.path, contract: 'Export a(): string'}]}))
        .mockResolvedValueOnce(file(a.path, 'export function a(): string {return "new";}'));
    expect(await generateStagedWorkspace({prompt: 'Change helper behavior', request: regenerate, workspaceFiles: [], reuseCheckpoint: checkpoint})).toContain('return "new"');
    expect(regenerate).toHaveBeenCalledTimes(2);
});

test('resume reviews the saved guide and rejects changed approval before generating implementations', async () => {
    const guide = {path: '/SKILL.md', contract: 'Guide', content: '# Plugin guide\nUse pure functions.'};
    const checkpoint = {completed: [guide], pending: [{path: '/a.ts', contract: 'Export a'}]};
    const reviewSkill = jest.fn(async file => file.content + '\nChanged scope.');
    const request = jest.fn();
    await expect(generateStagedWorkspace({prompt: 'Build helpers', workspaceFiles: [], request, resumeCheckpoint: checkpoint, reviewSkill})).rejects.toThrow('saved guide was edited');
    expect(reviewSkill).toHaveBeenCalledWith({path: '/SKILL.md', content: guide.content});
    expect(request).not.toHaveBeenCalled();
});

test('cancellation after a validated file preserves a resumable pending checkpoint', async () => {
    let cancelled = false, checkpoint;
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/a.ts', contract: 'Export a'}, {path: '/b.ts', contract: 'Export b'}]}))
        .mockResolvedValueOnce(file('/a.ts', 'export const a = 1;'));
    await expect(generateStagedWorkspace({prompt: 'Build helpers', workspaceFiles: [], request,
        assertActive: () => {if (cancelled) throw new Error('Cancelled');},
        onCheckpoint: async progress => {checkpoint = progress; if (progress.completed.length === 1) cancelled = true;},
    })).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledTimes(2);
    expect(checkpoint.completed).toEqual([expect.objectContaining({path: '/a.ts', content: 'export const a = 1;'})]);
    expect(checkpoint.pending.map(file => file.path)).toEqual(['/b.ts']);
});

test('scoped guide migration reviews the guide first even when implementation paths were supplied first', async () => {
    const guide = '# Guide\n<!-- fdo-acceptance -->\n~~~json\n[{"id":"proof","description":"Keep behavior","testFile":"/proof.test.ts","testName":"proof"}]\n~~~';
    let approve, shown;
    const started = new Promise(resolve => {shown = resolve;});
    const request = jest.fn(async options => {
        if (options.workspaceStep === '/SKILL.md') return JSON.stringify({path:'/SKILL.md',content:guide});
        return file('/logic.ts','export const value = 2;');
    });
    const result = generateStagedWorkspace({prompt:'Repair',request,sdkFingerprint:'a'.repeat(64),
        repairPaths:['/logic.ts','/SKILL.md'],workspaceFiles:[{path:'/logic.ts',content:'export const value = 1;'},{path:'/SKILL.md',content:guide}],
        reviewSkill: entry => {shown(); return new Promise(resolve => {approve = () => resolve(entry.content);});}});
    await started;
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].workspaceStep).toBe('/SKILL.md');
    approve();
    expect(await result).toContain('export const value = 2;');
});

test('stale guide reports a transport-safe recovery action without starting generation',async()=>{
    const request = jest.fn();
    await expect(generateStagedWorkspace({prompt:'Repair',request,sdkFingerprint:'a'.repeat(64),repairPaths:['/logic.ts'],
        workspaceFiles:[{path:'/SKILL.md',content:'# Old'},{path:'/logic.ts',content:'export const value = 1;'}]}))
        .rejects.toMatchObject({guideRecovery:{schemaVersion:'1.0.0',code:'PLUGIN_GUIDE_SDK_REVIEW_REQUIRED',path:'/SKILL.md',workspaceChanged:false}});
    expect(request).not.toHaveBeenCalled();
});

test('guide migration retains the full existing workspace and product requirements in proposal context',async()=>{
    const guide = '# Product guide\nInspect JSON locally and show nested values.';
    const request = jest.fn(async options => {
        expect(options.prompt).toContain('/retained.test.ts');
        expect(options.prompt).toContain('Inspect JSON locally and show nested values.');
        throw new Error('Stop proposal fixture');
    });
    await expect(generateStagedWorkspace({prompt:'Repair current diagnostics',request,sdkFingerprint:'a'.repeat(64),
        repairPaths:['/logic.ts','/SKILL.md'],workspaceFiles:[{path:'/SKILL.md',content:guide},
            {path:'/logic.ts',content:'export const value = 1;'}, {path:'/retained.test.ts',content:'export {};'}],
        guideProposalOptions:{requirements:'Repair current diagnostics',validateSection:async()=>[]}}))
        .rejects.toThrow('Stop proposal fixture');
    expect(request).toHaveBeenCalledTimes(1);
});

test('cancelling scoped guide approval prevents implementation generation',async()=>{
    const guide = '# Guide\n<!-- fdo-acceptance -->\n~~~json\n[{"id":"proof","description":"Keep behavior","testFile":"/proof.test.ts","testName":"proof"}]\n~~~';
    const request = jest.fn(async () => JSON.stringify({path:'/SKILL.md',content:guide}));
    await expect(generateStagedWorkspace({prompt:'Repair',request,sdkFingerprint:'a'.repeat(64),
        repairPaths:['/logic.ts','/SKILL.md'],workspaceFiles:[{path:'/SKILL.md',content:guide},{path:'/logic.ts',content:'export const value = 1;'}],
        reviewSkill:async()=>{throw new Error('User stopped approval');}})).rejects.toThrow('User stopped approval');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].workspaceStep).toBe('/SKILL.md');
});
