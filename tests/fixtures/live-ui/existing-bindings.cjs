module.exports = () => ({
    '/index.ts': `import {FDO_SDK,PluginRegistry} from '@anikitenko/fdo-sdk';
import {createActions} from './features/actions';
import {render} from './view';
export default class Plugin extends FDO_SDK {
 get metadata(){return {name:'Availability bindings',version:'1.0.0',author:'FDO',description:'Binding fixture',icon:'link'};}
 init(){} render(){return render();} renderOnLoad(){return createActions();}
}
PluginRegistry.registerPlugin(new Plugin());`,
    '/features/actions.ts': `import {defineRenderOnLoadActions as defineActions} from '@anikitenko/fdo-sdk';
export function createActions() {
 const actions: Parameters<typeof defineActions>[0] = {
  lifecycleKey:'availability.actions', strict:true,
  handlers:{
   command:({element})=>{if(element)element.dispatchEvent(new CustomEvent('availability-command'));},
   alternative:({element})=>{if(element)element.textContent='Requested';},
  },
  bindings:[
   /* refresh binding retained */ {selector:'#refresh',event:'click',handler:'command'},
   {selector:'#save',event:'click',handler:'command'},
   {selector:'#query',event:'input',handler:'command'},
  ],
  setup:()=>{throw new Error('Preview must not execute setup');},
 };
 return Object.assign(defineActions(actions),actions);
}`,
    '/view.ts': `import {DOM} from '@anikitenko/fdo-sdk';
function command(dom:DOM,id:string,label:string,busy=false){return dom.createElement('button',{
 id,type:'button',class:'command','data-domain':'availability',...{disabled:busy},
},label);}
export function render(){const dom=new DOM();return dom.renderHTML(dom.createElement('main',{},
 command(dom,'refresh','Check availability'),command(dom,'save','Save credentials'),
 dom.createElement('input',{id:'query',type:'search'})));
}`,
});
