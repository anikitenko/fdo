/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const filesFor = source=>({'/index.ts':`class Plugin {render(){return ${source};}}`});
const render = files=>createStaticUiPreview(files,sdk);
const edit = (files,preview,element,request)=>planVisualSourceEdit(files,preview.elements,{kind:'html-inline-style',elementId:element.id,...request});

test.each(['`','"',"'"])('local override and reset preserve the enclosing %s literal and sibling classes', async quote=>{
    const files = filesFor(quote + '<main><h1 class=shared>First</h1><p class=shared>Neighbor</p></main>' + quote);
    const preview = await render(files), heading = preview.elements.find(item=>item.tag==='h1');
    expect(heading.inlineStyle.editable).toBe(true);
    const patch = edit(files,preview,heading,{property:'color',value:'#123456'});
    const changed = {...files,[patch.file]:patch.after}, result = await render(changed);
    const target = result.elements.find(item=>item.tag==='h1');
    expect(target.inlineStyle.declarations).toEqual([{property:'color',value:'#123456',important:false}]);
    expect(result.elements.find(item=>item.tag==='p').inlineStyle.declarations).toEqual([]);
    expect(patch.after).toContain('class=shared>Neighbor');
    const reset = edit(changed,result,target,{property:'color',action:'remove'});
    expect((await render({...changed,[reset.file]:reset.after})).elements.find(item=>item.tag==='h1').inlineStyle.declarations).toEqual([]);
    expect(reset.after).not.toContain('style=');
});
test('updating one declaration preserves comments, priority and unrelated declarations', async()=>{
    const files = filesFor('`<main><h1 style="color: red !important; /* keep */ padding: 12px;">Text</h1></main>`');
    const preview = await render(files), heading = preview.elements.find(item=>item.tag==='h1');
    const patch = edit(files,preview,heading,{property:'color',value:'blue'});
    expect(patch.after).toContain('color: blue !important; /* keep */ padding: 12px;');
    const next = await render({...files,[patch.file]:patch.after});
    expect(next.elements.find(item=>item.tag==='h1').inlineStyle.declarations).toContainEqual({property:'color',value:'blue',important:true});
});
test('inline styling uses exact draft history without modifying embedded CSS or other elements', async()=>{
    const files = filesFor('`<style>.shared{color:red}</style><main><h1 class=shared>Text</h1></main>`');
    const preview = await render(files), heading = preview.elements.find(item=>item.tag==='h1'), base = {revision:'inline',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'html-inline-style',elementId:heading.id,property:'padding',value:'20px'},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.files['/index.ts']).toContain('<style>.shared{color:red}</style>');
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
});
test('invalid declaration lists and transformed tags remain read-only', async()=>{
    for (const style of ['color:red;color:blue','color:red}aside{display:none','@import url(x)']) {
        const preview = await render(filesFor('`<main style="' + style + '">Text</main>`'));
        expect(preview.elements[0].inlineStyle.editable).toBe(false);
    }
    const files = filesFor("'<main title=before>Text</main>'.replace('before','after')"), preview = await render(files);
    expect(preview.elements[0].inlineStyle.editable).toBe(false);
    expect(()=>edit(files,preview,preview.elements[0],{property:'color',value:'red'})).toThrow('shared or transformed');
});
test('host rejects declaration/selector injection and preserves JS literal syntax in CSS values', async()=>{
    const files = filesFor('`<main>Text</main>`'), preview = await render(files), target = preview.elements[0];
    for (const value of ['red;display:none','red}aside{color:red','red!important','red\n']) {
        expect(()=>edit(files,preview,target,{property:'color',value})).toThrow();
    }
    expect(()=>edit(files,preview,target,{property:'bad;property',value:'red'})).toThrow();
    expect(()=>edit(files,preview,target,{property:'color',action:'remove'})).toThrow('not present');
    const patch = edit(files,preview,target,{property:'--label',value:'"` ${sample} \\ text"'});
    const result = await render({...files,[patch.file]:patch.after});
    expect(result.status).toBe('ready');
    expect(result.elements[0].inlineStyle.declarations[0].value).toBe('"` ${sample} \\ text"');
});

test('new overrides serialize as a compact multi-property style attribute', async()=>{
    let files = filesFor('`<main><h1>Text</h1></main>`'), preview = await render(files);
    for (const [property,value] of [['text-align','right'],['color','#123456'],['padding','12px']]) {
        const target = preview.elements.find(item=>item.tag==='h1');
        const patch = edit(files,preview,target,{property,value});
        expect(patch.after).not.toMatch(/&#(?:10|13|9);/);
        files = {...files,[patch.file]:patch.after}; preview = await render(files);
    }
    expect(files['/index.ts']).toContain('style="text-align: right; color: #123456; padding: 12px"');
    const target = preview.elements.find(item=>item.tag==='h1');
    expect(target.inlineStyle.declarations.map(item=>item.property)).toEqual(['text-align','color','padding']);
    const patch = edit(files,preview,target,{property:'color',action:'remove'});
    expect(patch.after).toContain('style="text-align: right; padding: 12px"');
});
test('editing a previously formatted override removes formatting entities but preserves CSS string values and comments', async()=>{
    const files = filesFor(/* language=TEXT */ '`<main style="&#10;    text-align: right; /* keep */ --label: &quot;line&#10;break&quot;; color:red">Text</main>`');
    const preview = await render(files);
    const patch = edit(files,preview,preview.elements[0],{property:'color',value:'blue'});
    expect(patch.after).not.toContain('style="&#10;');
    expect(patch.after).toContain('/* keep */');
    expect(patch.after).toContain('line&#10;break');
    const updated = await render({...files,[patch.file]:patch.after});
    expect(updated.elements[0].inlineStyle.declarations.find(item=>item.property==='--label').value).toBe('"line\nbreak"');
});
