export const RESULT_DISPLAYS=[{value:'json',label:'Full response · formatted JSON'},{value:'text',label:'Returned text · text'},{value:'length',label:'Text length · length'}];
export const JSON_RESULT_DISPLAYS=[RESULT_DISPLAYS[0],{value:'summary',label:'JSON summary · summary'},{value:'valueType',label:'Value type · valueType'},{value:'itemCount',label:'Top-level item count · itemCount'},{value:'topLevelKeys',label:'Top-level keys · topLevelKeys'}];
export const resultDisplays=(preset='text')=>preset === 'inspect-json' ? JSON_RESULT_DISPLAYS : RESULT_DISPLAYS;
export const validResultDisplay=(value,preset='text')=>resultDisplays(preset).some(item=>item.value===value);
