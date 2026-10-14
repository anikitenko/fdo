/** @jest-environment node */
import {validateCodexHook, selectedCodexHooks, publicCodexHook, hookMatcher} from '../../src/utils/ai/codex/codexHooks';
const assistants=[{id:'one',provider:'codex-cli'},{id:'api',provider:'openai'}];
const hook={id:'test',name:'Team context',event:'UserPromptSubmit',toolPattern:'',command:'node',args:['/path with spaces/hook.js'],cwd:'',environment:{TEAM_TOKEN:'secret'},timeoutSeconds:10,enabled:true,assistantIds:['one']};
test('assigns only enabled hooks to saved Codex models and hides environment values',()=>{
    expect(selectedCodexHooks([hook,{...hook,id:'off',enabled:false}],'one')).toEqual([hook]);
    expect(selectedCodexHooks([hook],'api')).toEqual([]);
    expect(publicCodexHook(hook).environmentKeys).toEqual(['TEAM_TOKEN']);expect(JSON.stringify(publicCodexHook(hook))).not.toContain('secret');
    expect(()=>validateCodexHook(hook,assistants)).not.toThrow();
    expect(()=>validateCodexHook({...hook,assistantIds:['api']},assistants)).toThrow('Codex');
});
test('validates command and lifecycle contracts before persisting hooks',()=>{
    expect(()=>validateCodexHook({...hook,event:'PreToolUse',toolPattern:'mcp__*'},assistants)).not.toThrow();
    for(const patch of [{event:'MadeUp'},{timeoutSeconds:0},{timeoutSeconds:61},{event:'Interrupt',timeoutSeconds:4},{command:'node && echo hi'},{args:[{}]},{environment:{TOKEN:3}}])expect(()=>validateCodexHook({...hook,...patch},assistants)).toThrow();
});
test('tool patterns match literal names and bounded wildcards rather than arbitrary regex',()=>{
    const match=new RegExp(hookMatcher({...hook,event:'PreToolUse',toolPattern:'mcp__docs__search.*'}));
    expect(match.test('mcp__docs__search.actual')).toBe(true);expect(match.test('mcp__docs__searchXactual')).toBe(false);
    expect(hookMatcher({...hook,toolPattern:'*'})).toBeUndefined();
});
