module.exports=()=>({
    '/package.json':JSON.stringify({name:'web-counter',version:'1.0.0',source:'index.ts'}),
    '/index.ts':`import {DOM,FDO_SDK,PluginRegistry,defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
export default class Counter extends FDO_SDK {
 get metadata(){return {name:'Web counter',version:'1.0.0',author:'FDO',description:'Standalone conversion fixture',icon:'code'};}
 declareCapabilities(){return ['storage','storage.json','secrets.use','secrets.set','secrets.get','secrets.delete','secrets.list'];}
 init(){
  const store=PluginRegistry.useStore('json');
  PluginRegistry.registerHandler('counter.increment',()=>{const value=Number(store.get('count') || 0)+1;store.set('count',value);return {value};});
  PluginRegistry.registerHandler('counter.current',()=>({value:Number(store.get('count') || 0)}));
  PluginRegistry.registerHandler('credentials.save',async(data:any)=>{await this.secrets.set('fixture-token',data.value);return {saved:true};});
  PluginRegistry.registerHandler('credentials.read',async()=>({value:await this.secrets.get('fixture-token')}));
 }
 render(){const dom=new DOM();return dom.renderHTML(dom.createElement('section',{style:'padding: 20px; color: rgb(20, 30, 40)'},
  dom.createElement('h1',{},'Standalone counter'),dom.createElement('output',{id:'value'},'0'),dom.createElement('button',{id:'increment',type:'button'},'Increment')));}
 renderOnLoad(){return defineRenderOnLoadActions({strict:true,handlers:{increment:async({document})=>{
  const result=await window.createBackendReq('UI_MESSAGE',{handler:'counter.increment',content:{}});
  const output=document.getElementById('value');if(output)output.textContent=String(result.value);
 }},bindings:[{selector:'#increment',event:'click',handler:'increment'}]});}
}
new Counter();`,
});
