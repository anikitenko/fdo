import {buildExecutablePlanRetryPrompt, buildProblemsRepairPlanPrompt, buildValidationRepairPlanPrompt, getProblemsRepairPaths, getValidationRepairPaths, mergeValidationRepairResponse} from "../../src/components/editor/utils/aiCodingAgentPlanRepair.js";
import {parseAiWorkspacePlanResponse} from '../../src/components/editor/utils/aiCodingAgentPlanResponse';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';

test('repairs a workspace foundation failure while retaining every other generated file', () => {
    const files = [{path: '/ui/cards.tsx', content: 'export const cards = `<input><button>Run</button>`;'},
        ...Array.from({length: 20}, (_, i) => ({path: `/feature${i}.ts`, content: `export const value = ${i};`}))];
    const errors = validateGeneratedPluginFiles(files).errors;
    const paths = getValidationRepairPaths(errors, files);
    expect(paths).toEqual(['/ui/cards.tsx']);
    const prompt = buildValidationRepairPlanPrompt({validationErrors: errors, repairPaths: paths, invalidResponse: 'OLD FULL RESPONSE'});
    expect(prompt).toContain('Do not replan the workspace');
    expect(prompt).not.toContain('OLD FULL RESPONSE');
    const repaired = '### File: /ui/cards.tsx\n```typescript\nexport const cards = `<form class="pure-form pure-form-stacked"><input><button class="pure-button pure-button-primary">Run</button></form>`;\n```';
    const merged = parseAiWorkspacePlanResponse(mergeValidationRepairResponse(files, repaired, paths)).files;
    expect(merged).toHaveLength(21);
    expect(merged.slice(1).map(({path, content}) => ({path, content}))).toEqual(files.slice(1));
    expect(validateGeneratedPluginFiles(merged).errors).toEqual([]);
});

test('does not infer repair scope from paths mentioned in diagnostic prose', () => {
    expect(getValidationRepairPaths(['Unknown failure mentions /ui/cards.tsx'], [{path: '/ui/cards.tsx'}])).toEqual([]);
});

test('runtime test repairs order authorized implementations before their tests without expanding scope', () => {
    const files = ['/render.test.ts', '/test/styles.spec.mjs', '/__tests__/tools.ts', '/render.tsx', '/image.ts', '/unrelated.ts']
        .map(path => ({path}));
    const errors = [
        '/render.test.ts: Generated tests failed (1). See /unrelated.ts for context.',
        '/test/styles.spec.mjs: Generated tests failed (1).',
        '/__tests__/tools.ts: Generated tests failed (2).',
        '/render.tsx: Implementation referenced by a failing test or its stack',
        '/image.ts: Implementation referenced by a failing test or its stack',
        '/render.tsx: Another diagnostic',
    ];
    expect(getValidationRepairPaths(errors, files)).toEqual([
        '/render.tsx', '/image.ts', '/render.test.ts', '/test/styles.spec.mjs', '/__tests__/tools.ts',
    ]);
    expect(getValidationRepairPaths([...errors, '/missing.ts: Unknown owner'], files)).toEqual([]);
    expect(getValidationRepairPaths(['/render.test.ts: Missing import', '/render.tsx: Missing export'], files))
        .toEqual(['/render.test.ts', '/render.tsx']);
});

test.each(['', '### File: /unrelated.ts\n```typescript\nexport {};\n```'])(
    'rejects missing or out-of-scope validation repair files', response => {
        expect(() => mergeValidationRepairResponse([{path: '/ui/cards.tsx', content: 'original'}], response, ['/ui/cards.tsx']))
            .toThrow('exactly the requested files');
    });

describe("ai coding agent plan repair prompt", () => {
    test("forces executable workspace file sections after a prose-only plan", () => {
        const prompt = buildExecutablePlanRetryPrompt({
            originalPrompt: "Create a production-grade plugin implementation plan",
            invalidResponse: "Here is a nice overview with bullets and architecture notes.",
        });

        expect(prompt).toContain("IMPORTANT RETRY INSTRUCTION");
        expect(prompt).toContain("did not return executable workspace file sections");
        expect(prompt).toContain("### File: /path/to/file");
        expect(prompt).toContain("Do not return prose");
        expect(prompt).toContain("bullets and architecture notes");
    });
});

test('Problems repair uses the current snapshot and puts repair before the original build request', () => {
    const workspaceFiles = [{path: '/index.ts', content: 'export const hello = "stub";'},
        {path: '/render.tsx', content: 'export const render = () => "current";'}];
    const prompt = buildProblemsRepairPlanPrompt({originalPrompt: 'Create all features', previousResponse: 'stale code',
        problemsContext: '/render.tsx:1:1 [8] Missing export', workspaceFiles});
    expect(prompt).toContain('Host-selected repair files: ["/render.tsx"]');
    expect(prompt).not.toContain('export const hello');
    expect(prompt).not.toContain('export const render');
    expect(prompt).not.toContain('stale code');
    expect(prompt.indexOf('IMPORTANT REPAIR')).toBeLessThan(prompt.indexOf('Create all features'));
    expect(prompt).toContain('NOT a request to rebuild');
});

describe("ai coding agent validation repair prompt", () => {
    test("includes concrete validation failures and FDO plugin test constraints", () => {
        const prompt = buildValidationRepairPlanPrompt({
            originalPrompt: "Build a hosts plugin",
            invalidResponse: "### File: /tests/unit/ai-coding-agent-execution-intent.test.js",
            validationErrors: [
                "/tests/unit/ai-coding-agent-execution-intent.test.js:4: plugin code must not import FDO host/editor implementation files",
                "/tests/unit/ai-coding-agent-execution-intent.test.js:6: plugin tests use describe(...) without importing from node:test",
            ],
        });

        expect(prompt).toContain("failed FDO plugin validation");
        expect(prompt).toContain("Validation errors:");
        expect(prompt).toContain("must not import FDO host/editor implementation files");
        expect(prompt).toContain("Plugin tests must use node:test imports and node:assert/strict assertions.");
        expect(prompt).toContain("Do not use Jest/Vitest globals or expect().");
        expect(prompt).toContain("### File: /path/to/file");
    });
});

test("builds a complete-file repair request from Problems panel diagnostics", () => {
    const prompt = buildProblemsRepairPlanPrompt({
        originalPrompt: "Create a JSON Inspector",
        previousResponse: "### File: /render.tsx\n```typescript\nbroken\n```",
        problemsContext: "Current editor problems:\n/render.tsx:14:10 [8] Expected > but found className",
    });
    expect(prompt).toContain("Problems panel now reports errors");
    expect(prompt).toContain("Expected > but found className");
    expect(prompt).toContain("Return ONLY complete executable workspace file sections");
    expect(prompt).toContain("node:assert/strict");
});


test('Problems repairs retain later modules and use focused workspace execution mode', () => {
    const previousResponse = '### File: /styles.css\n```css\n' + '.shell {}\n'.repeat(600)
        + '\n```\n### File: /ui/workspace.ts\n```ts\nexport const workspace = () => "complete view";\n```';
    const prompt = buildProblemsRepairPlanPrompt({originalPrompt: 'Build the workbench', previousResponse,
        problemsContext: '/render.tsx: missing export from /ui/workspace.ts'});
    expect(prompt).toMatch(/^EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION/);
    expect(prompt).toContain(previousResponse);
    expect(prompt).not.toContain('[truncated]');
    expect(prompt).toContain('Return only files that must change');
    expect(prompt).toContain('supersedes older context');
    expect(prompt).toContain('/render.tsx: missing export');
});


test('Problems repair targets only existing diagnostic owners, deduplicated in diagnostic order', () => {
    const workspace = [{path: '/index.ts'}, {path: '/render.tsx'}, {path: '/styles.css'}];
    const diagnostics = "Current editor problems:\n/index.ts:10:20 [8] Duplicate metadata\n/index.ts:19:7 [8] Duplicate metadata\n/index.ts:45:10 [8] Property renderOnLoadActions does not exist; see /styles.css\n/missing.ts:1:1 [8] Missing\n/../index.ts:1:1 [8] Unsafe\n/render.tsx:2:1 [8] Invalid render";
    expect(getProblemsRepairPaths(diagnostics, workspace)).toEqual(['/index.ts', '/render.tsx']);
    expect(getProblemsRepairPaths('Unknown diagnostic', workspace)).toEqual([]);
});
