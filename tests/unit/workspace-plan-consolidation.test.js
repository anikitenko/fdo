import {createWorkspacePlanConsolidation} from '../../src/utils/plugins/validation/workspacePlanConsolidation';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
const files = Array.from({length: 29}, (_, i) => ({path: `/feature${i}.ts`, contract: `Implement required behavior ${i}.`, visualReference: false}));
const groups = files.slice(0, 24).map((file, i) => ({path: file.path, contract: file.contract,
    members: [file.path, ...(i < 5 ? [files[i + 24].path] : [])]}));
test('consolidation preserves every original responsibility and image requirement', () => {
    const responsibilities = new Map();
    const repair = createWorkspacePlanConsolidation(files.map((file, i) => i === 24 ? {...file, visualReference: true} : file), 24, responsibilities);
    const result = JSON.parse(repair.decode(JSON.stringify({groups})));
    expect(result.files).toHaveLength(24);
    expect(result.files[0].visualReference).toBe(true);
    expect(responsibilities.get('/feature0.ts').map(file => file.contract)).toEqual([files[0].contract, files[24].contract]);
});
test.each(['omitted', 'duplicate', 'unknown', 'oversized', 'new destination'])('rejects %s grouping without committing responsibility context', failure => {
    const proposal = JSON.parse(JSON.stringify(groups));
    if (failure === 'omitted') proposal.pop();
    if (failure === 'duplicate') proposal[0].members.push(files[1].path);
    if (failure === 'unknown') proposal[0].members.push('/unknown.ts');
    if (failure === 'oversized') proposal.push(proposal[0]);
    if (failure === 'new destination') proposal[0].path = '/new.ts';
    const responsibilities = new Map();
    expect(() => createWorkspacePlanConsolidation(files, 24, responsibilities).decode(JSON.stringify({groups: proposal}))).toThrow('consolidation rejected');
    expect(responsibilities.size).toBe(0);
});
test.each(['/styles.css', '/tools.test.ts', '/SKILL.md'])('does not merge code with %s', path => {
    const proposal = [{path: '/logic.ts', contract: 'Logic'}, {path, contract: 'Other'}];
    expect(() => createWorkspacePlanConsolidation(proposal, 1, new Map()).decode(JSON.stringify({groups: [
        {path: '/logic.ts', contract: 'Combined', members: ['/logic.ts', path]},
    ]}))).toThrow('must remain separate');
});
test.each(['success', 'invalid grouping', 'budget exhausted'])('29-file plan receives one bounded consolidation attempt: %s', async outcome => {
    let plans = 0;
    const request = jest.fn(async options => {
        if (options.planStage) {
            if (++plans <= 2) return JSON.stringify({files});
            return JSON.stringify({groups: outcome === 'invalid grouping' ? groups.slice(1) : groups});
        }
        expect(options.prompt).toContain('HOST-OWNED CONSOLIDATION MAP');
        if (options.workspaceStep === files[0].path) expect(options.prompt).toContain(files[24].contract);
        return JSON.stringify({path: options.workspaceStep, content: 'export {};'});
    });
    const completed = jest.fn();
    const result = generateStagedWorkspace({prompt: 'Build all behaviors', request, onFileCompleted: completed,
        assertBudget: () => { if (outcome === 'budget exhausted' && plans === 2) throw new Error('Budget exhausted'); }});
    if (outcome === 'success') {
        expect(await result).toContain('/feature0.ts');
        expect(completed).toHaveBeenCalledTimes(24);
        expect(request).toHaveBeenCalledTimes(27);
    } else {
        await expect(result).rejects.toThrow(outcome === 'budget exhausted' ? 'Budget exhausted' : 'consolidation rejected');
        expect(completed).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(outcome === 'budget exhausted' ? 2 : 3);
    }
    if (outcome !== 'budget exhausted') expect(request.mock.calls[2][0].responseSchema.properties.groups.maxItems).toBe(24);
});
