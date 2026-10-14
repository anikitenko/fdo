import {parseCodexSkill, selectedCodexSkills, validateCodexSkillAssignments, codexSkillInvocation} from '../../src/utils/ai/codex/codexSkills';
const content = '---\nname: team-review\ndescription: >\n  Review team code\n  consistently.\n---\nPrefer clear names and executable behavior tests.\n';
const assistants = [{id: 'a', provider: 'codex-cli'}, {id: 'b', provider: 'codex-cli'}, {id: 'c', provider: 'openrouter'}];
const skill = () => ({...parseCodexSkill(content), id: 'skill', enabled: true, assistantIds: ['a', 'b']});
test('imports folded YAML metadata and selects only enabled skills assigned to an assistant', () => {
    expect(parseCodexSkill(content).description).toBe('Review team code consistently.');
    expect(selectedCodexSkills([skill()], 'a')).toHaveLength(1);
    expect(selectedCodexSkills([skill()], 'b')).toHaveLength(1);
    expect(selectedCodexSkills([skill()], 'c')).toEqual([]);
    expect(selectedCodexSkills([{...skill(), enabled: false}], 'a')).toEqual([]);
    expect(codexSkillInvocation(['team-review'])).toContain('$team-review');
    expect(codexSkillInvocation([])).toBe('');
});
test.each(['name: ../outside\ndescription: Unsafe', 'name: review\ndescription: !!js/function function(){}', 'name: review\ndescription: [array]'])('rejects unsupported metadata without accepting executable YAML: %s', metadata => {
    expect(() => parseCodexSkill(`---\n${metadata}\n---\nInstructions`)).toThrow();
});
test('validates multi-assistant assignments, duplicate names and instruction budgets', () => {
    expect(() => validateCodexSkillAssignments([skill()], assistants)).not.toThrow();
    expect(() => validateCodexSkillAssignments([{...skill(), assistantIds: ['c']}], assistants)).toThrow('existing Codex');
    expect(() => validateCodexSkillAssignments([skill(), skill()], assistants)).toThrow('unique');
    const large = Array.from({length: 5}, (_, index) => {
        const source = `---\nname: skill-${index}\ndescription: Test\n---\n` + 'x'.repeat(15000);
        return {...parseCodexSkill(source), id: String(index), enabled: true, assistantIds: ['a']};
    });
    expect(() => validateCodexSkillAssignments(large, assistants)).toThrow('64000');
    expect(() => selectedCodexSkills(large, 'a')).toThrow('budget');
});
