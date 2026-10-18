import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// UI-only VT emulation. No SSH, clipboard writes, local sockets or credential API.
export function installTerminalRenderer(target=window) {
 const instances=new Set();
 target.FDOTerminal=Object.freeze({ready:true,create(element,{term='xterm-256color',rows=24,columns=80}={}){
  if(!(element instanceof target.HTMLElement)||instances.size>=4)throw new Error('Terminal renderer unavailable.');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9+._-]{0,63}$/.test(term))throw new Error('Invalid terminal type.');
  if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>1000||columns>1000)throw new Error('Invalid terminal size.');
  const terminal=new Terminal({rows,cols:columns,screenReaderMode:true,scrollback:2000,allowProposedApi:false,windowOptions:{},linkHandler:{activate:()=>{},hover:()=>{},leave:()=>{}}});
  const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(element);
  element.setAttribute('aria-label',element.getAttribute('aria-label')||'Remote SSH terminal');
  const denyClipboard=terminal.parser.registerOscHandler(52,()=>true),denyLinks=terminal.parser.registerOscHandler(8,()=>true);
  let disposed=false,frame=0,pending=0;
  const observer=new ResizeObserver(()=>{if(frame||disposed)return;frame=requestAnimationFrame(()=>{frame=0;if(!disposed&&element.clientWidth>0&&element.clientHeight>0)fit.fit();});});observer.observe(element);
  const session={
   write(data,consumed=()=>{}){if(disposed)throw new Error('Terminal renderer closed.');if(!(data instanceof Uint8Array)||data.byteLength>32768||pending+data.byteLength>65536)throw new Error('Terminal renderer backpressure.');const copy=new Uint8Array(data);pending+=copy.length;terminal.write(copy,()=>{pending-=copy.length;consumed();});},
   onData:callback=>terminal.onData(callback),onResize:callback=>terminal.onResize(size=>callback({rows:size.rows,columns:size.cols})),
   focus:()=>{if(!disposed)terminal.focus();},getSize:()=>({rows:terminal.rows,columns:terminal.cols}),reset:()=>{if(!disposed)terminal.reset();},
   dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();denyClipboard.dispose();denyLinks.dispose();terminal.dispose();instances.delete(session);},
  };
  instances.add(session);return session;
 }});
 target.addEventListener('pagehide',()=>{for(const instance of instances)instance.dispose();},{once:true});
}
