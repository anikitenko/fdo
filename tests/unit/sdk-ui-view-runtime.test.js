/** @jest-environment jsdom */
import {createSdkUiViewRuntime} from '../../src/components/plugin/utils/sdkUiViewRuntime';

function fixture() {
    document.body.innerHTML = '<main><dialog></dialog><button></button></main><aside></aside>';
    const root = document.querySelector('main');
    const destroy = jest.fn();
    const ui = {mountDialog: jest.fn(() => ({destroy})), mountConfirmationDialog: jest.fn(() => ({destroy})), mountPopover: jest.fn(() => ({destroy}))};
    const target = {console: {error: jest.fn()}};
    return {view: createSdkUiViewRuntime(ui, () => root, target), ui, destroy, target, root};
}
test('controllers belong to their view and are destroyed exactly once before markup replacement', async () => {
    const {view, ui, destroy, root} = fixture();
    view.api.mountDialog(root.firstChild);
    expect(() => view.api.mountDialog(document.querySelector('aside'))).toThrow('current plugin view');
    expect(() => view.api.mountPopover(root.firstChild)).toThrow('anchors');
    expect(ui.mountPopover).not.toHaveBeenCalled();
    const cleanup = jest.fn(() => expect(root.firstChild).not.toBeNull());
    await view.runOnLoad(() => cleanup);
    view.dispose(); view.dispose();
    expect(destroy).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1);
    root.replaceChildren();
    expect(() => view.api.mountDialog(root)).toThrow('disposed');
});
test('late async setups are cleaned up; replacement lifecycle owners remain intact', async () => {
    const {view, target} = fixture();
    const registry = target[Symbol.for('fdo.renderOnLoad.cleanup')] = new Map();
    const owned = jest.fn(), replacement = jest.fn(), late = jest.fn();
    let resolve;
    const run = view.runOnLoad(() => {registry.set('key', owned); return new Promise(done => {resolve = done;});});
    registry.set('key', replacement);
    view.dispose(); resolve(late); await run;
    expect(late).toHaveBeenCalledTimes(1); expect(owned).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled();
});
test('cleanup failure does not prevent controller disposal or SDK lifecycle cleanup', async () => {
    const {view, target, root, destroy} = fixture();
    const cleanup = jest.fn();
    const registry = target[Symbol.for('fdo.renderOnLoad.cleanup')] = new Map();
    await view.runOnLoad(() => {registry.set('key', cleanup); return () => {throw new Error('cleanup');};});
    view.api.mountDialog(root.firstChild); view.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalledTimes(1); expect(target.console.error).toHaveBeenCalledTimes(1);
});

test.each(['1.0.0','1.2.0'])('declarative openers mount compatible %s roots, preserve focus and dispose listeners',version=>{
    const {view,root,ui,destroy}=fixture();
    root.innerHTML='<dialog id="settings" data-fdo-component="fdo.dialog" data-fdo-component-version="' + version + '"></dialog><button type="button" data-fdo-ui-open="settings">Open</button>';
    const open=jest.fn();ui.mountDialog.mockReturnValue({open,destroy,getState:()=>({destroyed:false})});
    view.bindMarkupOpeners();view.bindMarkupOpeners();
    const button=root.querySelector('button');button.click();
    expect(ui.mountDialog).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledWith(button);
    view.dispose();button.click();expect(open).toHaveBeenCalledTimes(1);expect(destroy).toHaveBeenCalledTimes(1);
});
test('declarative openers reject foreign/missing targets and implicit confirmation callbacks',()=>{
    const {view,root,ui,target}=fixture();
    root.innerHTML='<button type="button" data-fdo-ui-open="outside">Invalid</button><dialog id="confirm" data-fdo-component="fdo.confirmation-dialog" data-fdo-component-version="1.0.0"></dialog><button type="button" data-fdo-ui-open="confirm">Confirm</button>';
    view.bindMarkupOpeners();expect(ui.mountDialog).not.toHaveBeenCalled();expect(ui.mountConfirmationDialog).not.toHaveBeenCalled();expect(target.console.error).toHaveBeenCalledTimes(2);
});

test.each(['mountProgressBar','mountToast','mountInlineAlert','mountToastRegion','mountAsyncActionButton','mountTabs','mountDisclosure','mountAccordion'])('%s enforces view ownership and releases its controller', name=>{
    const {root,target}=fixture();
    const destroy=jest.fn(),ui={[name]:jest.fn(()=>({destroy}))};
    const view=createSdkUiViewRuntime(ui,()=>root,target);
    expect(()=>view.api[name](document.querySelector('aside'))).toThrow('current plugin view');
    view.api[name](root.firstChild,{onAction:()=>Promise.resolve()});
    view.dispose();view.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(()=>view.api[name](root.firstChild)).toThrow('disposed');
});

test('confirmation openers require a unique passive result and honor disposal and abort',()=>{
    const {view,root,ui,destroy}=fixture();
    root.innerHTML='<dialog id="confirm" data-fdo-component="fdo.confirmation-dialog" data-fdo-component-version="1.0.0"></dialog><button type="button" data-fdo-ui-open="confirm" data-fdo-ui-confirm-selector=\'[data-fdo-result="visual-result-1"]\' data-fdo-ui-confirm-text="&lt;safe&gt;">Open</button><pre data-fdo-result="visual-result-1">Original</pre>';
    const open=jest.fn();ui.mountConfirmationDialog.mockReturnValue({open,destroy,getState:()=>({destroyed:false})});
    view.bindMarkupOpeners();const button=root.querySelector('button');button.click();
    expect(open).toHaveBeenCalledWith(button);
    const confirm=ui.mountConfirmationDialog.mock.calls[0][1].onConfirm;
    confirm({signal:{aborted:true}});expect(root.querySelector('pre').textContent).toBe('Original');
    confirm({signal:{aborted:false}});expect(root.querySelector('pre').textContent).toBe('<safe>');
    expect(root.querySelector('pre').children).toHaveLength(0);
    view.dispose();root.querySelector('pre').textContent='Disposed';confirm({signal:{aborted:false}});button.click();
    expect(root.querySelector('pre').textContent).toBe('Disposed');expect(open).toHaveBeenCalledTimes(1);expect(destroy).toHaveBeenCalledTimes(1);
});
test.each(['<pre data-fdo-result="visual-result-1">One</pre><pre data-fdo-result="visual-result-1">Two</pre>','<pre data-fdo-result="visual-result-1"><button>Active</button></pre>','<div data-fdo-result="visual-result-1">Wrong kind</div>'])('confirmation rejects ambiguous or active result markup',markup=>{
    const {view,root,ui,target}=fixture();
    root.innerHTML='<dialog id="confirm" data-fdo-component="fdo.confirmation-dialog" data-fdo-component-version="1.0.0"></dialog><button type="button" data-fdo-ui-open="confirm" data-fdo-ui-confirm-selector=\'[data-fdo-result="visual-result-1"]\' data-fdo-ui-confirm-text="Done">Open</button>'+markup;
    view.bindMarkupOpeners();expect(ui.mountConfirmationDialog).not.toHaveBeenCalled();expect(target.console.error).toHaveBeenCalledTimes(1);
});

function toastQueueFixture() {
    const {root,target}=fixture();
    root.innerHTML='<section id="notices" data-fdo-component="fdo.toast-region" data-fdo-component-version="1.0.0"><div id="toast" data-fdo-component="fdo.toast" data-fdo-component-version="1.0.0"></div></section><button type="button" title="Enqueue toast" data-fdo-ui-toast-region="notices" data-fdo-ui-toast-id="toast" data-fdo-ui-toast-visible="1" data-fdo-ui-toast-queued="0" data-fdo-ui-toast-duration="0">Notify</button>';
    let update;const state={entries:[],destroyed:false};
    const controller={enqueue:jest.fn(()=>true),getState:()=>state,destroy:jest.fn()};
    const ui={mountToastRegion:jest.fn((_root,options)=>{update=options.onStateChange;return controller;})};
    const view=createSdkUiViewRuntime(ui,()=>root,target);
    return {root,target,controller,ui,view,update:entries=>{state.entries=entries;update(state);}};
}
test('declarative toast queues report capacity, prevent duplicates and clean listeners/status/controllers',()=>{
    const {root,controller,ui,view,update}=toastQueueFixture(),button=root.querySelector('button');
    view.bindMarkupOpeners();view.bindMarkupOpeners();
    expect(ui.mountToastRegion).toHaveBeenCalledTimes(1);
    expect(ui.mountToastRegion.mock.calls[0][1]).toMatchObject({maxVisible:1,maxQueued:0});
    button.click();expect(controller.enqueue).toHaveBeenCalledWith(root.querySelector('#toast'),{key:'toast',duration:0});
    update([{key:'toast',status:'queued'}]);expect(button.disabled).toBe(true);expect(root.querySelector('[role="status"]').textContent).toBe('Notification queued.');
    button.click();expect(controller.enqueue).toHaveBeenCalledTimes(1);
    update([]);controller.enqueue.mockReturnValue(false);button.click();expect(root.querySelector('[role="status"]').textContent).toBe('Notification queue is full.');
    view.dispose();button.click();expect(controller.enqueue).toHaveBeenCalledTimes(2);expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[role="status"]')).toBeNull();expect(button.disabled).toBe(false);expect(button.title).toBe('Enqueue toast');
});
test('toast queue runtime rejects conflicting limits for an entire region',()=>{
    const {root,ui,view,target}=toastQueueFixture();
    const toast=root.querySelector('#toast').cloneNode(true);toast.id='other';root.querySelector('section').append(toast);
    const button=root.querySelector('button').cloneNode(true);button.setAttribute('data-fdo-ui-toast-id','other');button.setAttribute('data-fdo-ui-toast-visible','2');root.append(button);
    view.bindMarkupOpeners();expect(ui.mountToastRegion).not.toHaveBeenCalled();expect(target.console.error).toHaveBeenCalledTimes(1);
});
test.each(['foreign','nested','unsupported'])('toast queue runtime rejects %s components',mode=>{
    const {root,ui,view,target}=toastQueueFixture();
    const toast=root.querySelector('#toast');
    if(mode==='unsupported') toast.setAttribute('data-fdo-component-version','2.0.0');
    if(mode==='foreign') document.querySelector('aside').append(toast);
    if(mode==='nested') {const wrapper=document.createElement('div');wrapper.setAttribute('data-fdo-component','custom');toast.before(wrapper);wrapper.append(toast);}
    view.bindMarkupOpeners();expect(ui.mountToastRegion).not.toHaveBeenCalled();expect(target.console.error).toHaveBeenCalledTimes(1);
});

test('large toast queues scan identities once while preserving each button target',()=>{
    const {root,target}=fixture();
    root.innerHTML='<section id="notices" data-fdo-component="fdo.toast-region" data-fdo-component-version="1.0.0">'
        + Array.from({length:100},(_,i)=>`<div id="toast-${i}" data-fdo-component="fdo.toast" data-fdo-component-version="1.0.0"></div>`).join('')+'</section>'
        + Array.from({length:100},(_,i)=>`<button type="button" data-fdo-ui-toast-region="notices" data-fdo-ui-toast-id="toast-${i}" data-fdo-ui-toast-visible="1" data-fdo-ui-toast-queued="100" data-fdo-ui-toast-duration="0">Toast ${i}</button>`).join('');
    const controller={enqueue:jest.fn(()=>true),getState:()=>({destroyed:false}),destroy:jest.fn()};
    const ui={mountToastRegion:jest.fn(()=>controller)};
    const query=jest.spyOn(root,'querySelectorAll');
    const view=createSdkUiViewRuntime(ui,()=>root,target);
    view.bindMarkupOpeners();
    expect(query.mock.calls.filter(([selector])=>selector==='[id]')).toHaveLength(1);
    expect(ui.mountToastRegion).toHaveBeenCalledTimes(1);
    expect(target.console.error).not.toHaveBeenCalled();
    const buttons=root.querySelectorAll('button');
    buttons[0].click();buttons[99].click();
    expect(controller.enqueue.mock.calls.map(([toast])=>toast.id)).toEqual(['toast-0','toast-99']);
    view.dispose();
});

test('toast identity indexing still rejects duplicate targets before mounting',()=>{
    const {root,ui,view,target}=toastQueueFixture();
    root.append(root.querySelector('#toast').cloneNode(true));
    view.bindMarkupOpeners();
    expect(ui.mountToastRegion).not.toHaveBeenCalled();
    expect(target.console.error).toHaveBeenCalledTimes(1);
});
