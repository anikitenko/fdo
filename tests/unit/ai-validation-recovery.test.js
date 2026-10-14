import {assertValidationRecoveryCurrent, retainValidationRecovery} from '../../src/components/editor/utils/aiValidationRecovery';

const workspaceFiles = [{path: '/retained.ts', content: 'export const retained = true;'}];
const capture = (content, previous) => retainValidationRecovery({previous, workspaceFiles,
    files: [{path: '/logic.ts', content}], diagnostics: ['/logic.ts: Type error'], originalPrompt: 'Implement the tool.', workspace: 'demo', revision: 0});
test('retains newer candidates and diagnostics across unlimited user-requested attempts', () => {
    let recovery = capture('export const value = 0;');
    for (let attempt = 1; attempt <= 5; attempt++) {
        recovery = capture(`export const value = ${attempt};`, {...recovery, attempts: attempt});
        expect(recovery.attempts).toBe(attempt);
        expect(recovery.candidate.find(file => file.path === '/logic.ts').content).toContain(`= ${attempt}`);
        expect(recovery.candidate.find(file => file.path === '/retained.ts').content).toBe(workspaceFiles[0].content);
    }
});
test('recovery rejects changed workspace contents, restored snapshots and other plugins', () => {
    const recovery = capture('export const value = 1;');
    const state = {files: workspaceFiles, workspace: 'demo', revision: 0};
    expect(() => assertValidationRecoveryCurrent(recovery, state)).not.toThrow();
    for (const change of [{files: []}, {workspace: 'other'}, {revision: 1}]) {
        expect(() => assertValidationRecoveryCurrent(recovery, {...state, ...change})).toThrow('workspace changed');
    }
    expect(() => assertValidationRecoveryCurrent({...recovery, repairScope: ['/retained.ts']}, state)).toThrow('outside the original repair scope');
});
