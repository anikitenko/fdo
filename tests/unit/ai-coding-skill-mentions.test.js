import {detectCodexSkillMention, getCodexSkillMentionItems, applyCodexSkillMention} from '../../src/components/editor/utils/aiCodingSkillMentions';
const assistant = {id: 'one', provider: 'codex-cli'};
const skills = [{name: 'team-review', description: 'Use $HOME literally in examples.', enabled: true, assistantIds: ['one']},
    {name: 'team-style', description: 'Style', enabled: true, assistantIds: ['other']},
    {name: 'team-disabled', description: 'Disabled', enabled: false, assistantIds: ['one']}];
test('offers only enabled assigned Codex skills with their descriptions', () => {
    const mention = detectCodexSkillMention('Explain $te');
    expect(mention).toEqual({kind: 'skill', query: 'te', start: 8, end: 11});
    expect(getCodexSkillMentionItems(skills, assistant, mention.query)).toEqual([
        {type: 'skill', token: '$team-review', insertText: '$team-review', title: '$team-review', subtitle: 'Use $HOME literally in examples.'}]);
    expect(getCodexSkillMentionItems(skills, {...assistant, provider: 'openrouter'}, '')).toEqual([]);
    expect(getCodexSkillMentionItems(skills, assistant, 'HOME')).toEqual([]);
});
test.each(['$HOME', '$someVariable', '$my_variable', '${NAME}', '$<variable>', '$(command)', '$$team', '\\$team',
    '`$team`', '```sh\n$team', '~~~sh\n$team', '"use $team', "'use $team", 'path/$team', '$1', 'budget $100', '$te\n'])('literal variable or code %s is never an active completion', value => {
    expect(detectCodexSkillMention(value)).toBeNull();
});
test('editing within an existing variable does not complete its prefix', () => {
    expect(detectCodexSkillMention('$teamVariable', 3)).toBeNull();
    expect(detectCodexSkillMention('${NAME}', 1)).toBeNull();
    expect(detectCodexSkillMention('$<variable>', 1)).toBeNull();
    expect(detectCodexSkillMention("Let's use $te")?.query).toBe('te');
    expect(detectCodexSkillMention('`$HOME` then $te')?.query).toBe('te');
});
test('insertion replaces only the deliberate completion and preserves surrounding variables', () => {
    const text = 'Keep $HOME literal; use $te after ${NAME}';
    const cursor = text.indexOf(' after');
    const mention = detectCodexSkillMention(text, cursor);
    const items = getCodexSkillMentionItems(skills, assistant, 'te');
    expect(applyCodexSkillMention(text, mention, '$team-review', items).value).toBe('Keep $HOME literal; use $team-review after ${NAME}');
    expect(applyCodexSkillMention(text, mention, '$unassigned', items).value).toBe(text);
});
