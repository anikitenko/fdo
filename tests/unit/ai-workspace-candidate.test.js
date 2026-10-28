import {validateAiWorkspaceCandidate} from '../../src/components/editor/utils/validateAiWorkspaceCandidate';
import {getValidationRepairPaths} from '../../src/components/editor/utils/aiCodingAgentPlanRepair';

function context(overrides = {}) {
    const workspaceFiles = [{path: '/logic.ts', content: 'export const value = 1;'},
        {path: '/render.ts', content: 'import {value} from "./logic"; export const render = () => value;'}];
    return {workspaceFiles, files: [{path: '/logic.ts', content: 'export const value = 2;'}],
        typecheck: jest.fn(async () => ({success: true})), readWorkspace: () => workspaceFiles, assertActive: jest.fn(), build: jest.fn(async () => ({success: true})), ...overrides};
}

test('final merged AI candidates cannot discard the declared support policy before application', async () => {
    const original = {path: '/package.json', content: JSON.stringify({fdo: {compatibility: {fdo: '^1.0.0'}}})};
    const args = context({workspaceFiles: [original], files: [{path: '/package.json', content: '{}'}]});
    args.readWorkspace = () => args.workspaceFiles;
    expect((await validateAiWorkspaceCandidate(args)).join('\n')).toContain('AI cannot remove fdo.compatibility');
    expect(args.build).not.toHaveBeenCalled();
});

test('compiles the merged workspace without altering retained or generated source', async () => {
    const args = context();
    const before = JSON.stringify([args.workspaceFiles, args.files]);
    await expect(validateAiWorkspaceCandidate(args)).resolves.toEqual([]);
    expect(args.build).toHaveBeenCalledWith({latestContent: {
        '/logic.ts': 'export const value = 2;', '/render.ts': args.workspaceFiles[1].content,
    }});
    expect(JSON.stringify([args.workspaceFiles, args.files])).toBe(before);
});

test('rejects a changed export that breaks a retained consumer before compilation', async () => {
    const args = context({files: [{path: '/logic.ts', content: 'export const other = 2;'}]});
    expect((await validateAiWorkspaceCandidate(args)).join('\n')).toContain('does not export value');
    expect(args.build).not.toHaveBeenCalled();
});

test('rejects unresolved SDK constructors and mismatched renderer calls before a syntax-only build', async () => {
    const args = context({files: [{path: '/render.ts', content: 'import {view} from "./view"; export const render = () => new DOM().renderHTML(view("unused"));'}],
        workspaceFiles: [{path: '/view.ts', content: 'export const view = () => "markup";'}]});
    args.readWorkspace = () => args.workspaceFiles;
    const errors = await validateAiWorkspaceCandidate(args);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('DOM is not defined');
    expect(errors.join('\n')).toContain('zero parameters');
    expect(args.build).not.toHaveBeenCalled();
});

test('rejects duplicate paths and missing imports', async () => {
    const args = context();
    args.files.push(args.files[0]);
    expect((await validateAiWorkspaceCandidate(args))[0]).toContain('Duplicate');
    args.files = [{path: '/logic.ts', content: 'export {value} from "./missing";'}];
    expect((await validateAiWorkspaceCandidate(args)).join('\n')).toContain('missing');
    expect(args.build).not.toHaveBeenCalled();
});

test.each([undefined, {success: false, error: 'Circular CSS import'}, {}])('fails closed on compiler result %j', async result => {
    expect((await validateAiWorkspaceCandidate(context({build: async () => result})))[0]).toContain('build failed');
});

test.each([
    ['/logic.ts:3:2: Unexpected token', ['/logic.ts']],
    ['virtual:/logic.ts:3:2: Unexpected token', ['/logic.ts']],
    ['See /logic.ts:3:2 for an example', []],
    ['/logic.ts:3:2: Invalid\n/outside.ts:1:1: Invalid', []],
])('compiler diagnostics retain only explicit workspace owners: %s', async (error, expected) => {
    const args = context({build: async () => ({success: false, error})});
    const errors = await validateAiWorkspaceCandidate(args);
    expect(getValidationRepairPaths(errors, [...args.workspaceFiles, ...args.files])).toEqual(expected);
    expect(errors.join('\n')).toContain('Candidate workspace build failed');
});

test.each(['stop', 'edit', 'snapshot'])('discards candidate when %s happens during compilation', async reason => {
    const args = context();
    args.build.mockImplementation(async () => {
        if (reason === 'edit') args.readWorkspace = () => [];
        else args.assertActive.mockImplementation(() => { throw new Error(reason); });
        return {success: true};
    });
    const readWorkspace = () => args.readWorkspace();
    await expect(validateAiWorkspaceCandidate({...args, readWorkspace})).rejects.toThrow(reason === 'edit' ? 'Workspace changed' : reason);
});

test('compiler failure or missing bridge never authorizes writes', async () => {
    await expect(validateAiWorkspaceCandidate(context({build: undefined}))).rejects.toThrow('compiler is unavailable');
    await expect(validateAiWorkspaceCandidate(context({build: async () => {throw new Error('IPC disconnected');}}))).rejects.toThrow('IPC disconnected');
});

function testContext(runTests) {
    return context({files: [{path: '/logic.test.ts', content: 'import {value} from "./logic"; export const actual = value;'}], runTests});
}
test('runs the merged candidate tests before authorizing application', async () => {
    const runTests = jest.fn().mockResolvedValue({success: true});
    const args = testContext(runTests);
    await expect(validateAiWorkspaceCandidate(args)).resolves.toEqual([]);
    expect(runTests).toHaveBeenCalledWith(args.build.mock.calls[0][0]);
});
test('maps failing compiled tests and their implementation to bounded repair owners', async () => {
    const args = testContext(async () => ({success: false, output: 'Error: bridge unavailable\n\ntest at /tmp/run/compiled/logic.test.js:1:1\nAssertionError: 1 !== 2'}));
    const errors = await validateAiWorkspaceCandidate(args);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^\/logic.test.ts: Generated tests failed/);
    expect(errors[0]).toContain('bridge unavailable');
    expect(errors[1]).toMatch(/^\/logic.ts:/);
});
test.each([undefined, {success: true, skipped: true}, {success: false, error: 'runner failed'}])('does not accept absent, skipped or failed tests: %j', async result => {
    const args = testContext(async () => result);
    expect((await validateAiWorkspaceCandidate(args)).join('\n')).toContain('tests failed');
});
test('requires a test runner when candidate contains tests', async () => {
    await expect(validateAiWorkspaceCandidate(testContext())).rejects.toThrow('test runner is unavailable');
});
test.each(['edit', 'stop'])('discards candidate after %s during tests', async reason => {
    const args = testContext(async () => {
        if (reason === 'edit') args.workspaceFiles.push({path: '/new.ts', content: ''});
        else args.assertActive.mockImplementation(() => {throw new Error('stopped');});
        return {success: true};
    });
    await expect(validateAiWorkspaceCandidate(args)).rejects.toThrow(reason === 'edit' ? 'Workspace changed' : 'stopped');
});

test('reports CSS cycle owners before the compiler can wrap them in host diagnostics', async () => {
    const args = context({files: [
        {path: '/styles/main.css', content: '@import "./panels.css";'},
        {path: '/styles/panels.css', content: '@import "./alerts.css"; .panel {display:block;}'},
        {path: '/styles/alerts.css', content: '@import "./panels.css"; .alert {color:red;}'},
    ]});
    const errors = await validateAiWorkspaceCandidate(args);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^\/styles\/panels.css: Circular CSS import:/);
    expect(errors[1]).toMatch(/^\/styles\/alerts.css: Circular CSS import:/);
    expect(args.build).not.toHaveBeenCalled();
});

test('verification report separates passed checks from checks that never ran', async () => {
    const reports = [];
    await validateAiWorkspaceCandidate(context({onVerification: report => reports.push(report)}));
    const last = reports.at(-1);
    expect(last.changedPaths).toEqual(['/logic.ts']);
    expect(Object.fromEntries(last.checks.map(check => [check.id, check.status]))).toEqual({
        contracts: 'passed', build: 'passed', tests: 'not-run', types: 'passed', acceptance: 'not-run', security: 'not-run',
    });
    expect(reports[0].checks[0].status).toBe('pending');
});

test('failed verification blocks subsequent checks and preserves repair diagnostics', async () => {
    const reports = [];
    const args = context({build: async () => ({success: false, error: 'Missing SDK export'}), onVerification: report => reports.push(report)});
    expect((await validateAiWorkspaceCandidate(args))[0]).toContain('Missing SDK export');
    expect(reports.at(-1).checks.find(check => check.id === 'build').status).toBe('failed');
    expect(reports.at(-1).checks.find(check => check.id === 'tests').status).toBe('blocked');
});

test('verification reports cannot change validation decisions', async () => {
    await expect(validateAiWorkspaceCandidate(context({onVerification: () => {throw new Error('observer failure');}}))).resolves.toEqual([]);
});

test('type errors block build, tests and application with concrete repair owners', async () => {
    const args = context({typecheck: async () => ({success: false, diagnostics: [{path: '/logic.ts', line: 1, column: 1, code: 2322, message: 'Type mismatch'}]})});
    expect(await validateAiWorkspaceCandidate(args)).toEqual(['/logic.ts:1:1: TS2322: Type mismatch']);
    expect(args.build).not.toHaveBeenCalled();
});

test.each([true, false])('acceptance criteria require passing named execution evidence: %s', async evidence => {
    const criteria = [{id: 'value', description: 'Returns expected value', testFile: '/logic.test.ts', testName: 'value is correct'}];
    const args = context({files: [
        {path: '/SKILL.md', content: '<!-- fdo-acceptance -->\n~~~json\n' + JSON.stringify(criteria) + '\n~~~'},
        {path: '/logic.test.ts', content: 'import {test} from "node:test"; import assert from "node:assert/strict"; test("value is correct", () => assert.equal(1, 1));'},
    ], runTests: async () => ({success: true, results: evidence ? [{file: '/logic.test.ts', name: 'value is correct', passed: true}] : []})});
    const errors = await validateAiWorkspaceCandidate(args);
    expect(errors.length).toBe(evidence ? 0 : 1);
    if (!evidence) expect(errors[0]).toContain('no passing execution evidence');
});

test('collects retained import and compiler owners together before the bounded repair', async () => {
    const reports = [];
    const args = context({files: [{path: '/logic.ts', content: 'export const other = 2;'}],
        typecheck: jest.fn(async () => ({success: false, diagnostics: [
            {path: '/logic.ts', line: 1, column: 1, code: 6133, message: 'Unused declaration'},
            {path: '/actions.ts', line: 12, column: 5, code: 2717, message: 'Conflicting SDK bridge declaration'},
        ]})), onVerification: report => reports.push(report)});
    const errors = await validateAiWorkspaceCandidate(args);
    expect(errors.some(error => error.startsWith('/render.ts:') && error.includes('does not export value'))).toBe(true);
    expect(errors.some(error => error.startsWith('/logic.ts:') && error.includes('TS6133'))).toBe(true);
    expect(errors.some(error => error.startsWith('/actions.ts:') && error.includes('TS2717'))).toBe(true);
    expect(args.typecheck).toHaveBeenCalledTimes(1);
    expect(args.build).not.toHaveBeenCalled();
    expect(reports.at(-1).checks.filter(check => check.status === 'failed').map(check => check.id)).toEqual(['contracts', 'types']);
});

test('malformed acceptance criteria do not prevent collecting compiler diagnostics', async () => {
    const args = context({files: [{path: '/SKILL.md', content: '<!-- fdo-acceptance -->\n~~~json\n['}],
        typecheck: async () => ({success: false, diagnostics: [{path: '/logic.ts', line: 1, column: 1, code: 2322, message: 'Type mismatch'}]})});
    const errors = await validateAiWorkspaceCandidate(args);
    expect(errors.some(error => error.startsWith('/SKILL.md:'))).toBe(true);
    expect(errors.some(error => error.includes('TS2322'))).toBe(true);
    expect(args.build).not.toHaveBeenCalled();
});

test('source failures can request static diagnostics without starting build or tests', async () => {
    const args = context({staticOnly: true, runTests: jest.fn()});
    await expect(validateAiWorkspaceCandidate(args)).resolves.toEqual([]);
    expect(args.typecheck).toHaveBeenCalledTimes(1);
    expect(args.build).not.toHaveBeenCalled();
    expect(args.runTests).not.toHaveBeenCalled();
});
