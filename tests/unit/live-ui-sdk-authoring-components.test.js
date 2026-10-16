/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const cases=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-previews.json'),'utf8')).cases;
const filesFor=(create,options)=>({'/index.ts':`import {DOM,${create}} from '@anikitenko/fdo-sdk/ui'; class Plugin {render(){const dom=new DOM().collectStylesFrom();return dom.renderHTML(dom.createElement('main',{},${create}(dom,${JSON.stringify(options)})));}} export const plugin=new Plugin();`});
const render=files=>createStaticUiPreview(files,sdk,contract);

test.each(cases.map(item=>[item.id,item]))('published preview %s builds in the restricted interpreter without absent ARIA values',async(_id,item)=>{
    const definition=contract.components.find(component=>component.identity===item.identity);
    const preview=await render(filesFor(definition.create,item.properties));
    expect(preview.status==='ready' ? null : preview).toBeNull();
    expect(preview.elements.some(element=>element.sdkComponent?.identity===item.identity)).toBe(true);
    expect(preview.html).not.toMatch(/aria-[\w-]+="(?:undefined|null)"/);
});

test.each([
    ['createProgressBar',{id:'progress',label:'Progress',value:30},'value',null],
    ['createProgressBar',{id:'progress',label:'Progress',value:30},'max',200],
    ['createInlineAlert',{id:'alert',message:'Saved'},'variant','warning'],
    ['createInlineAlert',{id:'alert',message:'Saved'},'visible',false],
    ['createDisclosure',{id:'details',title:'More',body:''},'open',true],
    ['createAsyncActionButton',{id:'action',label:'Run',disabled:true},'successLabel','Done'],
    ['createTabs',{id:'tabs',label:'Settings',items:[{key:'one',label:'One',body:''}]},'orientation','vertical'],
    ['createAccordion',{id:'sections',label:'Sections',items:[{key:'one',title:'One',body:''}]},'multiple',true],
])('%s edits typed %s through valid source and typechecks',async(create,options,property,value)=>{
    const files=filesFor(create,options),preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
    const edit=planVisualSourceEdit(files,preview.elements,{kind:'component-property',elementId:element.id,property,value});
    const updated={...files,[edit.file]:edit.after},next=await render(updated);
    expect(next.status==='ready' ? null : next).toBeNull();
    expect(next.elements.find(item=>item.sdkComponent).sdkComponent.properties.find(item=>item.name===property).value).toBe(value);
    expect(typecheckPluginWorkspace(updated,path.resolve('node_modules')).diagnostics).toEqual([]);
    expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'component-property',elementId:element.id,property,value:[]})).toThrow('declared type');
});

test('ESM default remains the CommonJS SDK identity and public named exports remain available',()=>{
    const source=`import sdk,* as esm from '@anikitenko/fdo-sdk';import {createRequire} from 'node:module';const cjs=createRequire(import.meta.url)('@anikitenko/fdo-sdk');if(sdk!==cjs)throw Error('default identity');for(const key of Object.keys(cjs))if(key!=='default' && esm[key]!==cjs[key])throw Error('export '+key);`;
    expect(()=>execFileSync(process.execPath,['--input-type=module','-e',source],{cwd:process.cwd(),stdio:'pipe'})).not.toThrow();
});

test('omitted inline-alert visibility is displayed as its SDK default, and can be explicitly hidden',async()=>{
    const preview=await render(filesFor('createInlineAlert',{id:'alert',message:'Ready'}));
    expect(preview.elements.find(item=>item.sdkComponent).sdkComponent.properties.find(item=>item.name==='visible')).toMatchObject({present:false,value:true});
});
