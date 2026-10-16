/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const filesFor = body=>({'/index.ts':`class Plugin {render(){return \`<main>${body}</main>\`;}}`});
const render = files=>createStaticUiPreview(files,sdk);
const move = (files,preview,element,request)=>planVisualSourceEdit(files,preview.elements,{kind:'move',elementId:element.id,...request});

test('literal siblings move directly while preserving comments, IDs, nested content and selected source',async()=>{
    const files = filesFor('<header><p id="first">First</p>\n<!-- keep separator -->\n<h1 id="title" style="color:red">Title <em>nested</em></h1>\n<p>Last</p></header>');
    const preview = await render(files), heading = preview.elements.find(item=>item.tag==='h1');
    expect(heading.structure.position).toMatchObject({index:1,count:3,up:true,down:true,allowedIndices:[0,1,2]});
    const base = {revision:'literal-order',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'move',elementId:heading.id,index:0},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.files['/index.ts']).toContain('<header><h1 id="title" style="color:red">Title <em>nested</em></h1>\n<!-- keep separator -->\n<p id="first">First</p>');
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).tag).toBe('h1');
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
    const current = draft.preview.elements.find(item=>item.tag==='h1');
    const back = move(draft.files,draft.preview,current,{direction:'down'});
    expect(back.after).toBe(files['/index.ts']);
});

test('moving several sibling slots rotates exact fragments and retains button binding targets',async()=>{
    const files = filesFor('<div><p>One</p> <!--a--> <button id="action" data-run type="button">Run</button> <!--b--> <p>Three</p></div>');
    const preview = await render(files), first = preview.elements.find(item=>item.text?.value==='One');
    const patch = move(files,preview,first,{index:2});
    expect(patch.after).toContain('<div><button id="action" data-run type="button">Run</button> <!--a--> <p>Three</p> <!--b--> <p>One</p>');
    const updated = await render({...files,[patch.file]:patch.after});
    expect(updated.status).toBe('ready');
    expect(updated.elements.find(item=>item.tag==='button').text.value).toBe('Run');
    for (const index of [-1,3,1.5,'1',0]) expect(()=>move(files,preview,first,{index})).toThrow('sibling position');
    expect(()=>move(files,preview,first,{destinationId:'unrelated'})).toThrow('sibling position');
});

test('significant text, script/style regions and implicit closing tags are movement barriers',async()=>{
    for (const middle of ['significant text','<script>throw new Error("never run")</script>','<style>p{color:red}</style>','<p>Implicit']) {
        const files = filesFor('<header><p>One</p>' + middle + '<h1>Title</h1><p>Last</p></header>');
        const preview = await render(files), first = preview.elements.find(item=>item.text?.value==='One');
        expect(first.structure.position.allowedIndices).toEqual([0]);
        expect(first.structure.position.down).toBe(false);
        expect(()=>move(files,preview,first,{index:2})).toThrow('sibling position');
    }
});

test('render replacements protect the entire affected sibling container',async()=>{
    const files = {'/index.ts':`class Plugin {render(){return '<main><p>First</p><p>Second</p></main>'.replace('First','Changed');}}`};
    const preview = await render(files);
    const second = preview.elements.find(item=>item.text?.value==='Second');
    expect(second.structure.position).toBeUndefined();
    expect(()=>move(files,preview,second,{direction:'up'})).toThrow('sibling position');
});

test('blocks containing unrepresented script/style or foreign markup cannot bypass barriers',async()=>{
    for(const content of ['<style>p{color:red}</style>','<script>throw new Error("never execute")</script>','<svg><text>Foreign</text></svg>']) {
        const files = filesFor('<header><div>' + content + '<p>Inside</p></div><h1>Title</h1></header>');
        const preview = await render(files), heading = preview.elements.find(item=>item.tag==='h1');
        expect(heading.structure.position.up).toBe(false);
        expect(()=>move(files,preview,heading,{direction:'up'})).toThrow('sibling position');
    }
});

test('duplicating passive literal text selects the copy and supports independent edits and exact undo',async()=>{
    const files = filesFor('<p class="note" style="color:red">First &amp; only</p>');
    const preview = await render(files), original = preview.elements.find(item=>item.tag==='p');
    expect(original.structure.duplicable).toBe(true);
    const base = {revision:'duplicate',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'duplicate',elementId:original.id},render,acceptFiles:files=>files});
    expect(draft.files['/index.ts']).toContain('<p class="note" style="color:red">First &amp; only</p>'.repeat(2));
    const selected = draft.preview.elements.find(item=>item.id===draft.selectedId);
    const copies = draft.preview.elements.filter(item=>item.tag==='p');
    expect(selected.structure.start).toBe(copies[1].structure.start);
    const patch = planVisualSourceEdit(draft.files,draft.preview.elements,{kind:'text',elementId:selected.id,value:'Second'});
    expect(patch.after).toContain('First &amp; only</p><p class="note" style="color:red">Second</p>');
    const duplicated = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(duplicated);
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).structure.start).toBe(copies[1].structure.start);
});

test('literal duplication rejects identity, action hooks, references, controls and nested markup',async()=>{
    for (const body of ['<p id="identity">Text</p>','<p data-action="run">Text</p>','<p onclick="run()">Text</p>',
        '<p aria-labelledby="label">Text</p>','<button>Run</button>','<p>Text <em>nested</em></p>']) {
        const files = filesFor(body), preview = await render(files);
        const element = preview.elements.find(item=>['p','button'].includes(item.tag));
        expect(element.structure.duplicable).not.toBe(true);
        expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'duplicate',elementId:element.id})).toThrow('without identity or bindings');
    }
});
