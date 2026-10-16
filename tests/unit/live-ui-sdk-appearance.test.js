/** @jest-environment node */
import fs from 'node:fs';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const contract = JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const render = files => createStaticUiPreview(files,sdk,contract);
const filesFor = (extra='',creator='createDialog') => ({'/index.ts':`import {DOM,${creator}} from '@anikitenko/fdo-sdk/ui'; class P {render(){const dom=new DOM().collectStylesFrom(); return dom.renderHTML(${creator}(dom,{id:'first',title:'First'${extra}}) + ${creator}(dom,{id:'second',title:'Second'}));}}`});
const edit = async (files,request) => {
    const preview = await render(files);
    expect(preview.status === 'ready' ? null : preview).toBeNull();
    const element = preview.elements.find(item=>item.sdkComponent);
    const patch = planVisualSourceEdit(files,preview.elements,{kind:'component-appearance',elementId:element.id,...request});
    return {...files,[patch.file]:patch.after};
};
test.each(['',",options:{classes:['existing']}",",options:{style:{color:'purple','& > p':{margin:0}}}"])('appearance inserts only missing containers and preserves neighboring components: %s',async extra=>{
    const files = filesFor(extra);
    const changed = await edit(files,{property:'--fdo-ui-background',value:'#123456'});
    const result = await render(changed);
    expect(result.status).toBe('ready'); expect(result.html).toContain('--fdo-ui-background:#123456');
    expect(result.elements[0].sdkComponent.appearance.find(item=>item.name==='--fdo-ui-background')).toMatchObject({value:'#123456',overridden:true});
    expect(result.elements[1].sdkComponent.appearance.find(item=>item.name==='--fdo-ui-background').overridden).toBe(false);
    if(extra.includes('classes')) expect(result.html).toContain('existing');
    if(extra.includes('purple')) {expect(result.html).toContain('color:purple');expect(result.html).toContain('margin:0');}
});
test('existing literal overrides reset without losing other fields, and undo restores source exactly',async()=>{
    const files = filesFor(",options:{style:{'--fdo-ui-radius':'6px',color:'purple'}}");
    const changed = await edit(files,{property:'--fdo-ui-radius',value:'18px'});
    expect(changed['/index.ts']).toContain("color:'purple'");
    const reset = await edit(changed,{property:'--fdo-ui-radius',action:'reset'});
    const result = await render(reset);
    expect(result.html).not.toContain('--fdo-ui-radius:18px');
    expect(result.elements[0].sdkComponent.appearance.find(item=>item.name==='--fdo-ui-radius')).toMatchObject({overridden:false,value:''});
    const preview = await render(files);
    const base = {revision:'appearance',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'component-appearance',elementId:preview.elements[0].id,property:'--fdo-ui-radius',value:'18px'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
});
test.each([",options:theme",",options:{style:shared}",",options:{style:{...shared}}",",options:{style:{'--fdo-ui-radius':size}}"] )('computed/shared style inputs are read-only: %s',async extra=>{
    const files=filesFor(extra);
    files['/index.ts']=files['/index.ts'].replace('class P',"const shared={color:'purple'};const theme={style:shared};const size='6px';class P");
    await expect(edit(files,{property:'--fdo-ui-radius',value:'12px'})).rejects.toThrow('editable appearance');
});
test.each(['red;display:block','url(https://example.invalid)','red/*comment*/','<style>','red\nblue','u\\72l(test)'])('host rejects unsafe value %s',async value=>{
    await expect(edit(filesFor(),{property:'--fdo-ui-background',value})).rejects.toThrow('one CSS value');
});
test('component-specific controls omit unused hooks and protect controller-owned style',async()=>{
    const preview=await render(filesFor('','createPopover'));
    expect(preview.elements[0].sdkComponent.appearance.map(item=>item.name)).not.toContain('--fdo-ui-backdrop');
    await expect(edit(filesFor(),{property:'display',value:'block'})).rejects.toThrow('editable appearance');
});
