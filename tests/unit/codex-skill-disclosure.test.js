import {explicitCodexSkillNames, withCodexSkillDisclosure, codexSkillCatalog} from '../../src/utils/ai/codex/codexSkillDisclosure';
const skills = [{name: 'team-review', description: 'Review changes', content: 'REVIEW_BODY_CANARY'},
    {name: 'team-style', description: 'Style guidelines', content: 'STYLE_BODY_CANARY'}];
test('explicit selection ignores quoted skills, code and ordinary variables', () => {
    expect(explicitCodexSkillNames('Use $team-review with $HOME and ${NAME}, but keep `$team-style` literal.', skills)).toEqual(['team-review']);
    expect(explicitCodexSkillNames('"$team-review" and \\$team-style and $team-review_extra', skills)).toEqual([]);
});
test('metadata-only task uses one request and no full instructions', async () => {
    const run = jest.fn().mockResolvedValue({success: true, content: 'Plain explanation'});
    const setActiveSkills = jest.fn();
    const result = await withCodexSkillDisclosure({prompt: 'Explain the plugin.', skills, run, setActiveSkills});
    expect(result.content).toBe('Plain explanation');
    expect(run).toHaveBeenCalledTimes(1);
    expect(setActiveSkills).toHaveBeenCalledWith([]);
    expect(run.mock.calls[0][0]).toContain('Review changes');
    expect(run.mock.calls[0][0]).not.toMatch(/REVIEW_BODY_CANARY|STYLE_BODY_CANARY|\$team-review|\$team-style/);
});
test('loads only requested instructions, hides the control envelope, and resets loading on a new workspace step', async () => {
    const run = jest.fn().mockResolvedValueOnce({success: true, content: '{"fdoSkillRequests":["team-review"]}'})
        .mockResolvedValueOnce({success: true, content: 'Complete code'});
    const setActiveSkills = jest.fn(), onLoad = jest.fn();
    const result = await withCodexSkillDisclosure({prompt: 'Review code.', skills, run, setActiveSkills, onLoad});
    expect(result.content).toBe('Complete code');
    expect(setActiveSkills.mock.calls).toEqual([[[]], [['team-review']]]);
    expect(run.mock.calls[1][0]).toContain('$team-review');
    expect(run.mock.calls[1][0]).not.toContain('$team-style');
    expect(onLoad).toHaveBeenCalledWith(['team-review']);
    const next = jest.fn().mockResolvedValue({success: true, content: 'CSS'});
    await withCodexSkillDisclosure({prompt: 'Create CSS.', skills, run: next, setActiveSkills});
    expect(setActiveSkills.mock.lastCall).toEqual([[]]);
    expect(next.mock.calls[0][0]).not.toContain('$team-review');
});
test('a named skill loads directly without an extra selection request', async () => {
    const run = jest.fn().mockResolvedValue({success: true, content: 'Done'}), setActiveSkills = jest.fn();
    await withCodexSkillDisclosure({prompt: 'Task', skills, explicitNames: ['team-review'], run, setActiveSkills});
    expect(run).toHaveBeenCalledTimes(1);
    expect(setActiveSkills).toHaveBeenCalledWith(['team-review']);
    expect(run.mock.calls[0][0]).toContain('$team-review');
});
test.each(['{"fdoSkillRequests":["unassigned"]}', '{"fdoSkillRequests":["../SKILL.md"]}', '{"fdoSkillRequests":[]}',
    '{"fdoSkillRequests":["team-review","team-review"]}', '{"fdoSkillRequests":["team-review"],"code":"bad"}'])('invalid request %s never hydrates any skill', async content => {
    const setActiveSkills = jest.fn();
    await expect(withCodexSkillDisclosure({prompt: 'Task', skills, setActiveSkills, run: async () => ({success: true, content})})).rejects.toThrow('invalid skill');
    expect(setActiveSkills.mock.calls).toEqual([[[]]]);
});
test('repeat requests stop rather than replaying a step forever', async () => {
    const run = jest.fn().mockResolvedValue({success: true, content: '{"fdoSkillRequests":["team-review"]}'});
    await expect(withCodexSkillDisclosure({prompt: 'Task', skills, run, setActiveSkills: jest.fn()})).rejects.toThrow('already loaded');
    expect(run).toHaveBeenCalledTimes(2);
});
test('new skill requests cannot bypass the two-load limit', async () => {
    const many = [...skills, {name: 'team-extra', description: 'Extra', content: 'EXTRA_BODY'}];
    const run = jest.fn().mockResolvedValueOnce({success: true, content: '{"fdoSkillRequests":["team-review"]}'})
        .mockResolvedValueOnce({success: true, content: '{"fdoSkillRequests":["team-style"]}'})
        .mockResolvedValueOnce({success: true, content: '{"fdoSkillRequests":["team-extra"]}'});
    const setActiveSkills = jest.fn();
    await expect(withCodexSkillDisclosure({prompt: 'Task', skills: many, run, setActiveSkills})).rejects.toThrow('bounded skill-loading');
    expect(run).toHaveBeenCalledTimes(3);
    expect(setActiveSkills.mock.lastCall).toEqual([['team-review', 'team-style']]);
});
test('cancelled or failed steps do not trigger instruction loading or expose a partial response', async () => {
    const setActiveSkills = jest.fn(), run = jest.fn().mockResolvedValue({success: false, cancelled: true, content: ''});
    expect((await withCodexSkillDisclosure({prompt: 'Task', skills, run, setActiveSkills})).cancelled).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(withCodexSkillDisclosure({prompt: 'Task', skills, run, setActiveSkills, assertActive: () => {throw new Error('Stopped');}})).rejects.toThrow('Stopped');
    expect(run).toHaveBeenCalledTimes(1);
});
test('catalog size is bounded and contains no instruction bodies', () => {
    const many = Array.from({length: 50}, (_, index) => ({name: `skill-${index}`, description: 'x'.repeat(1024), content: 'PRIVATE_BODY'}));
    const catalog = JSON.stringify(codexSkillCatalog(many));
    expect(catalog.length).toBeLessThan(8000);
    expect(catalog).not.toContain('PRIVATE_BODY');
});
