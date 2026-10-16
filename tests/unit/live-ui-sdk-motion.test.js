/** @jest-environment node */
import fs from 'node:fs';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const render=files=>createStaticUiPreview(files,sdk,contract);
const filesFor=(creator='createDialog',extra='')=>({'/index.ts':`import {DOM,${creator}} from '@anikitenko/fdo-sdk/ui';class P {render(){const dom=new DOM().collectStylesFrom();return dom.renderHTML(${creator}(dom,{id:'a',title:'A'${extra}}) + ${creator}(dom,{id:'b',title:'B'}));}}`});
const edit=async(files,request)=>{const preview=await render(files);expect(preview.status).toBe('ready');const patch=planVisualSourceEdit(files,preview.elements,{kind:'component-motion',elementId:preview.elements[0].id,...request});return {...files,[patch.file]:patch.after};};
test.each(['createDialog','createConfirmationDialog','createPopover'])('%s emits scoped motion and reduced-motion CSS, preserves appearance and can remove its preset',async creator=>{
    const files=filesFor(creator,",options:{style:{'--fdo-ui-color':'purple'}}");
    const changed=await edit(files,{preset:'scale',duration:240,easing:'ease-out'});
    const result=await render(changed);
    expect(result.elements[0].sdkComponent.motion).toMatchObject({preset:'scale',duration:240,easing:'ease-out',managed:true,editable:true});
    expect(result.elements[1].sdkComponent.motion.managed).toBe(false);
    expect(result.html).toContain('@starting-style');expect(result.html).toContain('prefers-reduced-motion: reduce');expect(result.html).toContain('--fdo-ui-color:purple');
    expect(result.html).toContain(creator==='createPopover' ? ':popover-open' : '[open]');
    const removed=await edit(changed,{preset:'none'}),reset=await render(removed);
    expect(reset.elements[0].sdkComponent.motion).toMatchObject({preset:'none',managed:false,editable:true});
    expect(reset.html).not.toContain('@starting-style');expect(reset.html).toContain('--fdo-ui-color:purple');
});
test.each([",options:{style:{'&':{opacity:0.5}}}",",options:{style:{transition:'all 1s'}}",",options:{style:{'&[open]':{transform:'rotate(5deg)'}}}",",options:shared"] )('custom motion stays read-only: %s',async extra=>{
    const files=filesFor('createDialog',extra);files['/index.ts']=files['/index.ts'].replace('class P',"const shared={style:{color:'red'}};class P");
    await expect(edit(files,{preset:'fade',duration:180,easing:'ease'})).rejects.toThrow(/Custom animation/);
});
test.each([{preset:'unknown',duration:180,easing:'ease'},{preset:'slide',duration:0,easing:'ease'},{preset:'fade',duration:2200,easing:'ease'},{preset:'fade',duration:180,easing:'bad'}])('rejects unsupported motion settings %j',async request=>{await expect(edit(filesFor(),request)).rejects.toThrow('Choose fade');});
