/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const render=files=>createStaticUiPreview(files,sdk);
let base,draft,preview;
const propose=async request=>{draft=await prepareVisualDraft({base,previous:draft,preview,request,render,acceptFiles:files=>files});expect(draft.status).not.toBe('error');preview=draft.preview;};
beforeEach(async()=>{base={revision:'basics',files:createPluginTemplateFiles({name:'basics',template:'utility'})};draft=null;preview=await render(base.files);});
test('custom class names preserve SDK classes through edits, isolation, Undo/Redo and removal',async()=>{
    let button=preview.elements.find(item=>item.tag==='button');
    const original=base.files['/render.tsx'];
    await propose({kind:'class-names',elementId:button.id,value:'pure-button pure-button-primary pure-button'});
    button=preview.elements.find(item=>item.id===draft.selectedId);
    expect(button.classNameAssignment.value).toBe('pure-button pure-button-primary');
    expect(button.styles.length).toBeGreaterThan(0);
    expect(preview.html).toContain('pure-button pure-button-primary');
    const after=draft.files;
    await propose({kind:'undo'});expect(draft.files['/render.tsx']).toBe(original);
    await propose({kind:'redo'});expect(draft.files).toEqual(after);
    button=preview.elements.find(item=>item.id===draft.selectedId);
    await propose({kind:'css',elementId:button.id,styleFile:'/styles.css',styleKey:button.styles[0].key,property:'color',value:'#123456'});
    button=preview.elements.find(item=>item.id===draft.selectedId);
    expect(button.classNameAssignment.value).toBe('pure-button pure-button-primary');
    await propose({kind:'style',elementId:button.id,styleFile:'/styles.css',styleKey:'muted'});
    button=preview.elements.find(item=>item.id===draft.selectedId);
    expect(button.classNameAssignment.value).toBe('pure-button pure-button-primary');
    await propose({kind:'class-names',elementId:button.id,value:''});
    expect(preview.html).not.toContain('pure-button');
    expect(preview.elements.find(item=>item.id===draft.selectedId).styles.length).toBeGreaterThan(0);
});
test('adds a single-line input and changes its type; empty textarea conversion preserves attributes',async()=>{
    const main=preview.elements.find(item=>item.tag==='main');
    await propose({kind:'insert',elementId:main.id,component:'singleLineInput'});
    let input=preview.elements.find(item=>item.inputKind?.current==='text');
    expect(input).toBeDefined();
    await propose({kind:'input-kind',elementId:input.id,value:'email'});
    input=preview.elements.find(item=>item.id===draft.selectedId);expect(input.inputKind.current).toBe('email');
    await propose({kind:'input-kind',elementId:input.id,value:'textarea'});
    input=preview.elements.find(item=>item.id===draft.selectedId);expect(input.tag).toBe('textarea');
    await propose({kind:'input-kind',elementId:input.id,value:'text'});
    input=preview.elements.find(item=>item.id===draft.selectedId);expect(input.tag).toBe('input');
    expect(preview.html).toContain('New text input');
});

test('invalid class selectors and unsafe input conversions are rejected without changes',async()=>{
    const button=preview.elements.find(item=>item.tag==='button');
    const {planVisualSourceEdit}=require('../../src/utils/plugins/authoring/liveUi/sourceEdits');
    for(const value of ['.pure-button','a > b','" onclick="bad','x'.repeat(501)]) expect(()=>planVisualSourceEdit(base.files,preview.elements,{kind:'class-names',elementId:button.id,value})).toThrow();
    const main=preview.elements.find(item=>item.tag==='main');
    await propose({kind:'insert',elementId:main.id,component:'input'});
    let input=preview.elements.find(item=>item.inputKind?.current==='textarea');
    await propose({kind:'text',elementId:input.id,value:'Keep this text'});
    input=preview.elements.find(item=>item.id===draft.selectedId);
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'input-kind',elementId:input.id,value:'text'})).toThrow('empty, unbound');
});
