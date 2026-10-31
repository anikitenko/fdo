const fs=require('node:fs');
const path=require('node:path');
const {parse}=require('@babel/parser');
const source=fs.readFileSync(path.join(__dirname,'../../../src/utils/plugins/authoring/pluginActionGuidance.js'),'utf8');
const declaration=parse(source,{sourceType:'module'}).program.body.find(node=>node.declaration?.declarations?.[0]?.id.name==='PLUGIN_ACTION_EXAMPLE').declaration.declarations[0];
const example=declaration.init.quasis[0].value.cooked;

const render=buttonType=>`import {DOM} from '@anikitenko/fdo-sdk';
export function render():string {
 const dom=new DOM();
 return dom.renderHTML(dom.createElement('form',{id:'command',class:'pure-form pure-form-stacked'},
  dom.createElement('input',{type:'text','data-input':'value','aria-label':'Value',value:'Azure'}),
  dom.createElement('button',{'data-action':'run',class:'pure-button pure-button-primary'${buttonType}},'Run'),
  dom.createElement('output',{'data-output':'result'},'Ready'),
  dom.createElement('textarea',{'aria-label':'Notes'},'')));
}`;
const bad=render('')+`
import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
export function createViewActions(){return defineRenderOnLoadActions({strict:true,lifecycleKey:'example.main',
 handlers:{run:async({window})=>{await window.createBackendReq('UI_MESSAGE',{handler:'run',content:{value:'Azure'}});}},
 bindings:[{selector:'[data-action="run"]',event:'click',handler:'run',required:true}]});}`;
const good=render(",type:'button'")+'\n'+example;
const index=`import {FDO_SDK,PluginRegistry} from '@anikitenko/fdo-sdk';import {render,createViewActions} from './view';
export default class Plugin extends FDO_SDK {
 get metadata(){return {name:'Form fixture',version:'1.0.0',author:'Tests',description:'Sandbox form repair',icon:'cog'};}
 init():void{PluginRegistry.registerHandler('run',()=>({message:'Saved'}));}
 render():string{return render();}renderOnLoad(){return createViewActions();}
}new Plugin();`;
module.exports={bad,good,index};
