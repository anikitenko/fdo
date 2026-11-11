import {findWorkspaceText} from '../../src/components/editor/utils/findWorkspaceText';
const files = {'/index.ts':'const value = 1;\n// VALUE valueExtra\n', '/shared/ui.ts':'value value', '/node_modules/lib.d.ts':'value'};
test('searches contents across all files with exact navigation coordinates', () => {
    const result = findWorkspaceText(files,'value');
    expect(result.matches).toHaveLength(6);
    expect(result.matches[0]).toMatchObject({filePath:'/index.ts',line:1,column:7,length:5,text:'value'});
    expect(result.matches.some(match => match.filePath.includes('node_modules'))).toBe(true);
});
test('supports case, whole word, optional source scope and bounded results', () => {
    expect(findWorkspaceText(files,'value',{matchCase:true,wholeWord:true,includeDependencies:false}).matches).toHaveLength(3);
    expect(findWorkspaceText(files,'value',{limit:2})).toMatchObject({truncated:true,matches:expect.any(Array)});
    expect(findWorkspaceText(files,'value',{limit:2}).matches).toHaveLength(2);
    expect(findWorkspaceText(files,'absent').matches).toEqual([]);
});
