import {readWorkspaceRepairScope} from '../../src/utils/plugins/validation/workspaceRepairScope';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
const {workbenchTestRepairPaths} = require('../e2e/helpers/workbenchRepairScope.cjs');
const {buildWorkbenchConvergencePrompt} = require('../e2e/helpers/workbenchConvergence.cjs');
const recorded = require('../fixtures/ai/workbench-test-repair-scope.json');
const files = Object.entries(recorded.files).map(([path, content]) => ({path, content}));

test('recorded tests-only failure scopes seven implementation files rather than regenerating the workspace', () => {
    const paths = workbenchTestRepairPaths(recorded);
    expect(paths).toHaveLength(7);
    expect(paths).toContain('/features/tools/logic.ts');
    expect(paths).toContain('/features/dashboard/render.ts');
    expect(paths).not.toContain('/index.ts');
    expect(paths.every(path => !/test|actions|\.css$/.test(path))).toBe(true);
    expect(readWorkspaceRepairScope(buildWorkbenchConvergencePrompt(recorded), files)).toEqual(paths);
});

test.each(['build', 'rubric', 'unknown owner', 'no failures'])('does not guess a tests-only scope for %s', defect => {
    const state = JSON.parse(JSON.stringify(recorded));
    if (defect === 'build') state.compiled.success = false;
    if (defect === 'rubric') state.rubric.passed = false;
    if (defect === 'unknown owner') state.testRun.output = 'test at missing.test.js:1:1\nfailed';
    if (defect === 'no failures') state.testRun.success = true;
    expect(workbenchTestRepairPaths(state)).toEqual([]);
});

test.each(['[]', '["/missing.ts"]', '["/../index.ts"]', '["/index.ts","/index.ts"]', 'not json'])(
    'rejects invalid explicit repair scope %s', value => {
        expect(() => readWorkspaceRepairScope(`WORKSPACE_REPAIR_PATHS: ${value}`, files)).toThrow(/WORKSPACE_REPAIR_PATHS/);
    });
test('does not treat a quoted directive later in ordinary prose as a repair constraint', () => {
    expect(readWorkspaceRepairScope('Explain this log:\nWORKSPACE_REPAIR_PATHS: ["/index.ts"]', files)).toBeUndefined();
});

test('recorded scope is admitted with 14 requests left at 59/73 and never requests a new inventory', async () => {
    let used = 59;
    const prompt = buildWorkbenchConvergencePrompt(recorded);
    const paths = readWorkspaceRepairScope(prompt, files);
    const request = jest.fn(async step => {
        expect(step.responseSchema.properties.path.enum).toHaveLength(1);
        const path = step.responseSchema.properties.path.enum[0];
        used++;
        return JSON.stringify({path, content: recorded.files[path]});
    });
    await generateStagedWorkspace({prompt, workspaceFiles: files, repairPaths: paths, request,
        assertBudget: required => { if (required > 73 - used) throw new Error('Request budget exceeded'); }});
    expect(used).toBe(66);
    expect(request).toHaveBeenCalledTimes(7);
});
