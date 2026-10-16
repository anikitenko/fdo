/** @jest-environment node */
import fs from 'node:fs';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
const contract = JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'), 'utf8'));
const filesFor = (creator, options = "{id:'overlay',title:'Original',body:dom.createElement('p',{},'Body')}") => ({'/index.ts': `import {DOM,${creator}} from '@anikitenko/fdo-sdk/ui'; class P {render(){const dom = new DOM().collectStylesFrom(); return dom.renderHTML(${creator}(dom,${options}));}}`});
test.each(['createDialog', 'createConfirmationDialog', 'createPopover'])('%s maps properties and editable slots without executing mounts', async creator => {
    const files = filesFor(creator);
    const render = files => createStaticUiPreview(files, sdk, contract);
    const preview = await render(files);
    expect(preview.status === 'ready' ? null : preview).toBeNull();
    const element = preview.elements.find(item => item.sdkComponent);
    expect(preview.html).toContain(`data-fdo-ui-id="${element.id}"`);
    expect(element.structure.unique).toBe(true);
    const property = planVisualSourceEdit(files, preview.elements, {kind: 'component-property', elementId: element.id, property: 'title', value: '<Edited & title>'});
    const changed = {...files, [property.file]: property.after};
    const next = await render(changed);
    expect(next.html).toContain('&lt;Edited &amp; title&gt;');
    const current = next.elements.find(item => item.sdkComponent);
    const slot = planVisualSourceEdit(changed, next.elements, {kind: 'component-slot', elementId: current.id, slot: 'footer', component: 'text'});
    const added = await render({...changed, [slot.file]: slot.after});
    expect(added.status).toBe('ready'); expect(added.html).toContain('New text');
    expect(added.elements.find(item => item.text?.value === 'New text')).toBeTruthy();
    expect(() => planVisualSourceEdit(files, preview.elements, {kind: 'component-property', elementId: element.id, property: 'id', value: 'changed'})).toThrow('editable');
});
test('computed options are visible but read-only; callbacks, mounts and unknown contracts are rejected', async () => {
    const computed = filesFor('createDialog', 'options');
    computed['/index.ts'] = computed['/index.ts'].replace('class P', "const options = {id:'overlay',title:'Shared'}; class P");
    const result = await createStaticUiPreview(computed, sdk, contract);
    expect(result.status).toBe('ready');
    expect(result.elements[0].sdkComponent.reason).toContain('literal');
    const callbacks = await createStaticUiPreview(filesFor('createDialog', "{id:'x',body:()=> 'unsafe'}"), sdk, contract);
    expect(callbacks.status).toBe('unsupported');
    const mount = jest.fn();
    const mounted = await createStaticUiPreview(filesFor('mountDialog'), {...sdk, mountDialog: mount}, contract);
    expect(mounted.status).toBe('unsupported'); expect(mount).not.toHaveBeenCalled();
    const unknown = await createStaticUiPreview(filesFor('createDialog'), sdk, {...contract, contractVersion:'2.0.0'});
    expect(unknown.status).toBe('unsupported');
});

test('component edits use existing draft history and preserve source bytes on undo', async () => {
    const {prepareVisualDraft} = require('../../src/utils/plugins/authoring/liveUi/draftEdits');
    const files = filesFor('createDialog');
    const base = {revision:'component-base',files};
    const render = files => createStaticUiPreview(files, sdk, contract);
    const preview = await render(files);
    let draft = await prepareVisualDraft({base,preview,request:{kind:'component-property',elementId:preview.elements.find(item=>item.sdkComponent).id,property:'description',value:'Added description'},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    const changed = draft.files['/index.ts'];
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files['/index.ts']).toBe(changed);
});

test('slot arrangement preserves comments, nested concatenation and exact draft undo', async () => {
    const {prepareVisualDraft} = require('../../src/utils/plugins/authoring/liveUi/draftEdits');
    const files = filesFor('createDialog', `{id:'overlay',title:'Test overlay',body:(dom.createElement('p',{},'First') + /* keep */ dom.createElement('p',{},'Second')) + dom.createElement('p',{},'Third'),footer:dom.createElement('button',{type:'button',id:'save'},'Save')}`);
    const render = files => createStaticUiPreview(files, sdk, contract);
    const preview = await render(files);
    expect(preview.status === 'ready' ? null : preview).toBeNull();
    const root = preview.elements.find(item => item.sdkComponent);
    const body = root.sdkComponent.slots.find(item => item.name === 'body');
    expect(body.children).toHaveLength(3);
    expect(body.children.every(item => item.movable && item.removable)).toBe(true);
    const base = {revision:'slots-base', files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:body.children[1].id,action:'up'},render,acceptFiles:files=>files});
    expect(draft.preview.html.indexOf('Second')).toBeLessThan(draft.preview.html.indexOf('First'));
    expect(draft.files['/index.ts']).toContain('/* keep */');
    const reordered = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(reordered);
    const current = draft.preview.elements.find(item => item.sdkComponent);
    const first = current.sdkComponent.slots.find(item => item.name === 'body').children[0];
    const edit = planVisualSourceEdit(draft.files, draft.preview.elements,{kind:'component-slot-arrange',elementId:current.id,slot:'body',childId:first.id,action:'remove'});
    const removed = await render({...draft.files,[edit.file]:edit.after});
    expect(removed.status).toBe('ready');
    expect(removed.html).not.toContain('Second');
    expect(edit.after).toContain('/* keep */');
    expect(removed.elements.find(item => item.sdkComponent).sdkComponent.slots.find(item => item.name === 'body').children).toHaveLength(2);
    const footer = root.sdkComponent.slots.find(item => item.name === 'footer');
    expect(footer.children[0].removable).toBe(false);
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'footer',childId:footer.children[0].id,action:'remove'})).toThrow();
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:body.children[0].id,action:'up'})).toThrow();
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'footer',childId:body.children[0].id,action:'remove'})).toThrow();
});

test('named slot fragments can reorder but cannot leave unused declarations on removal', async () => {
    const files = filesFor('createPopover', `{id:'overlay',title:'Test overlay',body:first + dom.createElement('p',{},'Last')}`);
    files['/index.ts'] = files['/index.ts'].replace('return dom.renderHTML', "const first = dom.createElement('p',{},'First'); return dom.renderHTML");
    const preview = await createStaticUiPreview(files,sdk,contract);
    expect(preview.status === 'ready' ? null : preview).toBeNull();
    const root = preview.elements.find(item => item.sdkComponent);
    const child = root.sdkComponent.slots[0].children[0];
    expect(child.movable).toBe(true); expect(child.removable).toBe(false);
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:root.sdkComponent.slots[0].name,childId:child.id,action:'remove'})).toThrow('declaration');
});

test.each([
    ["body:dom.createElement('p',{},'Move me')",'body','footer'],
    ["footer:dom.createElement('p',{},'Move me')",'footer','body'],
    ["body:dom.createElement('p',{},'Move me'),footer:dom.createElement('p',{},'Keep me')",'body','footer'],
    ["footer:dom.createElement('p',{},'Move me'),body:dom.createElement('p',{},'Keep me')",'footer','body'],
])('cross-slot movement preserves source and exact history: %s', async (fields, from, to) => {
    const {prepareVisualDraft} = require('../../src/utils/plugins/authoring/liveUi/draftEdits');
    const files = filesFor('createDialog', `{id:'overlay',title:'Transfer', /* retain */ ${fields}}`);
    const render = files => createStaticUiPreview(files,sdk,contract);
    const preview = await render(files);
    const root = preview.elements.find(item => item.sdkComponent);
    const child = root.sdkComponent.slots.find(item => item.name === from).children[0];
    expect(child.transferable).toBe(true);
    const base = {revision:'transfer-base',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'component-slot-arrange',elementId:root.id,slot:from,childId:child.id,action:'transfer',destinationSlot:to},render,acceptFiles:files=>files});
    expect(draft.status).not.toBe('error');
    const updated = draft.preview.elements.find(item => item.sdkComponent);
    expect(updated.sdkComponent.slots.find(item => item.name === from).children).toHaveLength(0);
    expect(updated.sdkComponent.slots.find(item => item.name === to).children).toHaveLength(fields.includes('Keep me') ? 2 : 1);
    expect(draft.files['/index.ts']).toContain('/* retain */');
    expect(draft.preview.html.match(/Move me/g)).toHaveLength(1);
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:from,childId:child.id,action:'transfer',destinationSlot:from})).toThrow('destination');
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:from,childId:child.id,action:'transfer',destinationSlot:'actions'})).toThrow('destination');
});

test('transferring an action target keeps its identity and attributes intact', async () => {
    const files = filesFor('createPopover', `{id:'overlay',title:'Transfer',body:dom.createElement('button',{type:'button',id:'existing-action'},'Action')}`);
    const preview = await createStaticUiPreview(files,sdk,contract);
    const root = preview.elements.find(item => item.sdkComponent);
    const child = root.sdkComponent.slots.find(item => item.name === 'body').children[0];
    expect(child.removable).toBe(false); expect(child.transferable).toBe(true);
    const edit = planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:child.id,action:'transfer',destinationSlot:'footer'});
    const updated = await createStaticUiPreview({...files,[edit.file]:edit.after},sdk,contract);
    expect(updated.status).toBe('ready');
    expect(updated.html.match(/id="existing-action"/g)).toHaveLength(1);
    expect(edit.after).toContain("{type:'button',id:'existing-action'}");
});

test('direct slot positioning crosses several mapped blocks and preserves comments and history', async () => {
    const {prepareVisualDraft} = require('../../src/utils/plugins/authoring/liveUi/draftEdits');
    const files = filesFor('createDialog', `{id:'overlay',title:'Positions',body:dom.createElement('p',{},'First') + /* keep separator */ (dom.createElement('p',{},'Second') + dom.createElement('p',{},'Third'))}`);
    const render = files => createStaticUiPreview(files,sdk,contract);
    const preview = await render(files);
    const root = preview.elements.find(item => item.sdkComponent);
    const first = root.sdkComponent.slots.find(item => item.name === 'body').children[0];
    const base = {revision:'positions',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:first.id,action:'position',index:2},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.preview.elements.filter(item => item.tag === 'p').map(item => item.text.value)).toEqual(['Second','Third','First']);
    expect(draft.files['/index.ts']).toContain('/* keep separator */');
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
    const current = draft.preview.elements.find(item => item.sdkComponent);
    const last = current.sdkComponent.slots.find(item => item.name === 'body').children.at(-1);
    const back = planVisualSourceEdit(draft.files,draft.preview.elements,{kind:'component-slot-arrange',elementId:current.id,slot:'body',childId:last.id,action:'position',index:0});
    expect(back.after).toBe(files['/index.ts']);
    for (const index of [-1,3,1.5,'2',0]) expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:first.id,action:'position',index})).toThrow('position');
});

test('duplicated slot content has independent source mapping and exact Undo/Redo', async () => {
    const {prepareVisualDraft} = require('../../src/utils/plugins/authoring/liveUi/draftEdits');
    const files = filesFor('createPopover');
    const render = files => createStaticUiPreview(files,sdk,contract);
    const preview = await render(files);
    const root = preview.elements.find(item => item.sdkComponent);
    const child = root.sdkComponent.slots.find(item => item.name === 'body').children[0];
    expect(child.duplicable).toBe(true);
    const base = {revision:'duplicate',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:child.id,action:'duplicate'},render,acceptFiles:files=>files});
    const copies = draft.preview.elements.filter(item => item.tag === 'p');
    expect(copies).toHaveLength(2);
    expect(copies[0].id).not.toBe(copies[1].id);
    expect(copies.every(item => item.structure.unique)).toBe(true);
    const edit = planVisualSourceEdit(draft.files,draft.preview.elements,{kind:'text',elementId:copies[1].id,value:'Edited copy'});
    const edited = await render({...draft.files,[edit.file]:edit.after});
    expect(edited.elements.filter(item => item.tag === 'p').map(item => item.text.value)).toEqual(['Body','Edited copy']);
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
});

test('opaque fragments block positional moves and action identities cannot be duplicated', async () => {
    const files = filesFor('createDialog', `{id:'overlay',title:'Protected',body:dom.createElement('p',{},'First') + '<em>Opaque</em>' + dom.createElement('button',{type:'button',id:'action'},'Action')}`);
    const preview = await createStaticUiPreview(files,sdk,contract);
    const root = preview.elements.find(item => item.sdkComponent);
    const children = root.sdkComponent.slots.find(item => item.name === 'body').children;
    expect(children[1].movable).toBe(false);
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:children[0].id,action:'position',index:2})).toThrow('cannot be crossed');
    expect(children[2].duplicable).toBe(false);
    expect(() => planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:root.id,slot:'body',childId:children[2].id,action:'duplicate'})).toThrow();
});
