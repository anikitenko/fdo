import {installWorkspaceDiagnostics} from '../../src/components/editor/utils/workspaceDiagnostics';

let workspace, monaco, worker, listeners, markerListeners, stored, models, support;
const uri = path => ({path,toString:()=>`file://${path}`});
function model(path) {
    return {uri:uri(path),version:1,disposed:false,getVersionId(){return this.version;},getLanguageId:()=> 'typescript',
        isDisposed(){return this.disposed;},getPositionAt:offset=>({lineNumber:1,column:offset+1})};
}
function emit(event,value) {for(const callback of listeners.get(event) || [])callback(value);}
async function settle() {await jest.advanceTimersByTimeAsync(301);}
beforeEach(()=>{
    jest.useFakeTimers();stored=new Map();listeners=new Map();markerListeners=new Set();
    models={'/index.ts':model('/index.ts'),'/shared/ui.ts':model('/shared/ui.ts'),'/node_modules/sdk/index.d.ts':model('/node_modules/sdk/index.d.ts')};
    workspace={sandboxName:'sandbox',fs:{snapshotSwitchRevision:0},files:Object.fromEntries(Object.entries(models).map(([path,model])=>[path,{model}])),
        notifications:{subscribe(event,callback){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(callback);return()=>listeners.get(event).delete(callback);}},
        tabs:{list:[{id:'/index.ts',markers:[]}],get(){return this.list;},
            addMarkers(id,markers){this.list.find(tab=>tab.id===id).markers=markers;emit('fileTabs',this.list);},
            removeMarkers(id){this.list.find(tab=>tab.id===id).markers=[];emit('fileTabs',this.list);}}};
    worker={getSyntacticDiagnostics:jest.fn(async()=>[]),getSuggestionDiagnostics:jest.fn(async()=>[]),
        getSemanticDiagnostics:jest.fn(async file=>file==='file:///index.ts'?[{category:1,code:2322,start:2,length:3,messageText:'Number is not assignable to string.'}]:[])};
    monaco={Uri:{file:uri,parse:name=>uri(name.replace(/^file:\/\//,''))},MarkerSeverity:{Error:8,Warning:4,Info:2,Hint:1},MarkerTag:{Unnecessary:1,Deprecated:2},
        typescript:{typescriptDefaults:{getDiagnosticsOptions:()=>({}),setCompilerOptions:jest.fn()},getTypeScriptWorker:jest.fn(async()=>async()=>worker)},
        editor:{getModel:resource=>models[resource.path],
            getModelMarkers:({resource})=>[...stored.values()].filter(entry=>entry.path===resource.path).flatMap(entry=>entry.markers),
            setModelMarkers:jest.fn((model,owner,markers)=>{stored.set(`${model.uri.path}:${owner}`,{path:model.uri.path,markers});for(const callback of markerListeners)callback([model.uri]);}),
            onDidChangeMarkers(callback){markerListeners.add(callback);return{dispose:()=>markerListeners.delete(callback)};}}};
});
afterEach(()=>{support?.dispose();support=null;jest.clearAllTimers();jest.useRealTimers();});

test('helper edits refresh importer errors and Problems, preserving unrelated marker owners',async()=>{
    monaco.editor.setModelMarkers(models['/index.ts'],'fdo-capability',[{code:'FDO_MISSING_CAPABILITY',message:'Permission missing'}]);
    support=installWorkspaceDiagnostics(monaco,workspace);
    await settle();
    expect(workspace.tabs.list[0].markers.map(marker=>marker.code)).toEqual(['FDO_MISSING_CAPABILITY','2322']);
    const calls=worker.getSemanticDiagnostics.mock.calls.flat();
    expect(calls).toContain('file:///index.ts');
    expect(calls.some(path=>path.includes('node_modules'))).toBe(false);
    worker.getSemanticDiagnostics.mockResolvedValue([]);
    models['/shared/ui.ts'].version++;emit('fileContentChanged','/shared/ui.ts');
    await settle();
    expect(workspace.tabs.list[0].markers.map(marker=>marker.code)).toEqual(['FDO_MISSING_CAPABILITY']);
    expect(monaco.typescript.typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled();
});

test('typing is coalesced and disposal removes timers and listeners',async()=>{
    support=installWorkspaceDiagnostics(monaco,workspace);await settle();
    monaco.typescript.getTypeScriptWorker.mockClear();
    for(let i=0;i<3;i++) {models['/shared/ui.ts'].version++;emit('fileContentChanged','/shared/ui.ts');await jest.advanceTimersByTimeAsync(100);}
    expect(monaco.typescript.getTypeScriptWorker).not.toHaveBeenCalled();
    await settle();
    expect(monaco.typescript.getTypeScriptWorker).toHaveBeenCalledTimes(1);
    emit('fileContentChanged','/shared/ui.ts');support.dispose();
    await settle();
    expect(monaco.typescript.getTypeScriptWorker).toHaveBeenCalledTimes(1);
    expect(markerListeners.size).toBe(0);
    expect([...listeners.values()].every(set=>set.size===0)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
});

test('an in-flight diagnostic response cannot overwrite a newer project revision',async()=>{
    let resolveOld;
    worker.getSemanticDiagnostics.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
    support=installWorkspaceDiagnostics(monaco,workspace);
    await jest.advanceTimersByTimeAsync(301);
    models['/shared/ui.ts'].version++;emit('fileContentChanged','/shared/ui.ts');
    resolveOld([{category:1,code:2306,start:0,length:1,messageText:'Stale not a module error'}]);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
    worker.getSemanticDiagnostics.mockResolvedValue([]);
    await settle();
    expect(workspace.tabs.list[0].markers).toEqual([]);
});

test('a stopped worker with an unresolved request cannot block diagnostics for a newer revision',async()=>{
    worker.getSemanticDiagnostics.mockImplementationOnce(()=>new Promise(()=>{}));
    support=installWorkspaceDiagnostics(monaco,workspace);
    await jest.advanceTimersByTimeAsync(301);
    worker.getSemanticDiagnostics.mockResolvedValue([]);
    models['/shared/ui.ts'].version++;emit('fileContentChanged','/shared/ui.ts');
    await settle();
    expect(monaco.editor.setModelMarkers).toHaveBeenCalled();
    expect(workspace.tabs.list[0].markers).toEqual([]);
});
