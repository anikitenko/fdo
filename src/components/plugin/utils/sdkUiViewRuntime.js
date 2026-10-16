// Self-contained: serialized into the trusted iframe module, never workspace
// source. Each view owns only its roots, controllers and declarative cleanups.
export function createSdkUiViewRuntime(ui, getRoot, target = window) {
    let disposed = false, markupBound = false;
    const currentControllers = new Map();
    const controllers = new Set(), cleanups = new Set(), actionCleanups = new Map();
    const report = error => target.console?.error('FDO frontend cleanup failed', error);
    const registry = () => target[Symbol.for('fdo.renderOnLoad.cleanup')];
    const runCleanup = cleanup => {
        try {const result = cleanup(); if (result && typeof result.then === 'function') Promise.resolve(result).catch(report);}
        catch (error) {report(error);}
    };
    const keepCleanup = cleanup => {
        if (typeof cleanup !== 'function') return;
        if (disposed) runCleanup(cleanup);
        else cleanups.add(cleanup);
    };
    const api = {...ui};
    for (const name of ['mountDialog', 'mountConfirmationDialog', 'mountPopover', 'mountProgressBar', 'mountToast', 'mountInlineAlert', 'mountToastRegion', 'mountAsyncActionButton', 'mountTabs', 'mountDisclosure', 'mountAccordion']) {
        if (typeof ui[name] !== 'function') continue;
        api[name] = (root, options) => {
            if (disposed) throw new Error('This plugin view has been disposed. Load the UI module again in the current view.');
            const scope = getRoot();
            if (!scope || !root || !scope.contains(root)) throw new Error('SDK UI roots must belong to the current plugin view.');
            if (name === 'mountPopover' && (!options?.anchor || !scope.contains(options.anchor))) throw new Error('SDK popover anchors must belong to the current plugin view.');
            const controller = ui[name](root, options);
            controllers.add(controller);
            currentControllers.set(root, controller);
            return controller;
        };
    }
    const bindToastButtons=()=>{
        const scope=getRoot(),groups=new Map(),claimed=new Set();
        if(!scope) return;
        const buttons=scope.querySelectorAll('button[data-fdo-ui-toast-region]');
        // Validate against one snapshot before mounting controllers mutates the
        // DOM. Keep every match so duplicate IDs still fail validation.
        const identities=new Map();
        if(buttons.length) for(const node of scope.querySelectorAll('[id]')) {
            const matches=identities.get(node.id) || [];
            matches.push(node);identities.set(node.id,matches);
        }
        const find=id=>identities.get(id) || [];
        for(const button of buttons) {
            // Validation failures intentionally share this boundary with operation failures.
            try {
                const read=name=>button.getAttribute('data-fdo-ui-toast-'+name);
                const regionId=read('region'),toastId=read('id'),raw=[read('visible'),read('queued'),read('duration')];
                if(button.type!=='button' || button.disabled || button.hasAttribute('data-fdo-ui-open') || button.hasAttribute('data-fdo-action') || ![regionId,toastId].every(id=>/^[A-Za-z][\w-]{0,120}$/.test(id || '')) || raw.some(value=>!/^(0|[1-9]\d*)$/.test(value || ''))) {
                    //noinspection ExceptionCaughtLocallyJS
                    throw new Error('Toast buttons need explicit identities and integer queue limits.');
                }
                const [visible,queued,duration]=raw.map(Number),regions=find(regionId),toasts=find(toastId),region=regions[0],toast=toasts[0];
                if(visible<1 || visible>20 || queued>100 || duration>600000 || regions.length!==1 || toasts.length!==1
                    || region.getAttribute('data-fdo-component')!=='fdo.toast-region' || toast.getAttribute('data-fdo-component')!=='fdo.toast'
                    || ![region,toast].every(node=>/^1\.\d+\.\d+$/.test(node.getAttribute('data-fdo-component-version') || ''))
                    || toast.parentElement?.closest('[data-fdo-component]')!==region || region.contains(button) || claimed.has(toast)) {
                        //noinspection ExceptionCaughtLocallyJS
                        throw new Error('Toast queue targets must be unique SDK components in the current view, with one button per toast.');
                    }
                const group=groups.get(region) || {region,visible,queued,buttons:[],invalid:false};
                if(group.visible!==visible || group.queued!==queued) {group.invalid=true;
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Toast buttons in one region must use identical queue limits.');}
                groups.set(region,group);claimed.add(toast);group.buttons.push({button,toast,duration});
            } catch(error) {report(error);}
        }
        for(const group of groups.values()) {
            if(group.invalid) continue;
            // Validation failures intentionally share this boundary with operation failures.
            try {
                if(currentControllers.has(group.region)) {
                    //noinspection ExceptionCaughtLocallyJS
                    throw new Error('This toast region already has a controller. Preserve its existing setup.');
                }
                for(const entry of group.buttons) {
                    const {button}=entry,initialTitle=button.getAttribute('title'),initialDisabled=button.disabled;
                    const status=button.ownerDocument.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
                    button.after(status);entry.status=status;
                    cleanups.add(()=>{status.remove();button.disabled=initialDisabled;if(initialTitle===null) button.removeAttribute('title');else button.setAttribute('title',initialTitle);});
                }
                const update=state=>{
                    if(disposed) return;
                    for(const entry of group.buttons) {
                        const item=state.entries.find(item=>item.key===entry.toast.id);
                        entry.button.disabled=!!item;
                        entry.status.textContent=item?.status==='queued' ? 'Notification queued.' : item ? 'Notification visible.' : '';
                    }
                };
                const controller=api.mountToastRegion(group.region,{maxVisible:group.visible,maxQueued:group.queued,onStateChange:update});
                for(const entry of group.buttons) {
                    const enqueue=()=>{
                        if(disposed || entry.button.disabled || controller.getState().destroyed) return;
                        try {if(!controller.enqueue(entry.toast,{key:entry.toast.id,duration:entry.duration})) entry.status.textContent='Notification queue is full.';}
                        catch(error) {entry.status.textContent='Could not enqueue notification.';report(error);}
                    };
                    entry.button.addEventListener('click',enqueue);cleanups.add(()=>entry.button.removeEventListener('click',enqueue));
                }
            } catch(error) {report(error);}
        }
    };
    return {
        api: Object.freeze(api),
        bindMarkupOpeners() {
            if(disposed || markupBound) return;
            markupBound=true;
            const scope=getRoot();
            if(!scope) return;
            const used=new Set();
            for(const button of scope.querySelectorAll('button[data-fdo-ui-open]')) {
                // Validation failures intentionally share this boundary with operation failures.
                try {
                    const id=button.getAttribute('data-fdo-ui-open');
                    const roots=Array.from(scope.querySelectorAll('[data-fdo-component][id]')).filter(root=>root.id===id);
                    if(!id || button.type!=='button' || roots.length!==1 || used.has(roots[0])) {
                        //noinspection ExceptionCaughtLocallyJS
                        throw new Error('An overlay opener needs one unique SDK root and one button per root.');
                    }
                    const root=roots[0], identity=root.getAttribute('data-fdo-component');
                    if(!/^1\.\d+\.\d+$/.test(root.getAttribute('data-fdo-component-version') || '') || !['fdo.dialog','fdo.popover','fdo.confirmation-dialog'].includes(identity) || root.contains(button)) {
                        //noinspection ExceptionCaughtLocallyJS
                        throw new Error('Only compatible SDK overlay roots outside their opener support declarative opening.');
                    }
                    let onConfirm;
                    if(identity==='fdo.confirmation-dialog') {
                        const selector=button.getAttribute('data-fdo-ui-confirm-selector'),text=button.getAttribute('data-fdo-ui-confirm-text');
                        if(!/^\[data-fdo-result="visual-result-\d+"]$/.test(selector || '') || text===null || text.length>2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
                            //noinspection ExceptionCaughtLocallyJS
                            throw new Error('Confirmation opening requires an explicit plain-text result action.');
                        }
                        const results=scope.querySelectorAll(selector);
                        const result=results[0];
                        if(results.length!==1 || !['P','PRE','SPAN','OUTPUT'].includes(result.tagName) || result.children.length) {
                            //noinspection ExceptionCaughtLocallyJS
                            throw new Error('Confirmation needs one text/result element in the current view.');
                        }
                        onConfirm=({signal})=>{if(!disposed && !signal.aborted) {if(!scope.contains(result)) throw new Error('The confirmation result is no longer in this view.');result.textContent=text;}};
                    }
                    used.add(root);
                    if(!currentControllers.has(root)) {
                        if(identity==='fdo.confirmation-dialog') api.mountConfirmationDialog(root,{onConfirm});
                        else if(identity==='fdo.dialog') api.mountDialog(root);
                        else api.mountPopover(root,{anchor:button});
                    }
                    const open=()=>{const controller=currentControllers.get(root);if(!disposed && !controller?.getState?.().destroyed) controller?.open(button);};
                    button.addEventListener('click',open);
                    cleanups.add(()=>button.removeEventListener('click',open));
                } catch(error) {report(error);}
            }
            bindToastButtons();
        },
        runOnLoad(fn) {
            if (disposed) return Promise.resolve();
            const before = new Map(registry() || []);
            let result;
            try {result = fn();}
            finally {
                for (const [key, cleanup] of registry() || []) if (before.get(key) !== cleanup) actionCleanups.set(key, cleanup);
            }
            return Promise.resolve(result).then(keepCleanup);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const [key, cleanup] of actionCleanups) {
                if (registry()?.get(key) === cleanup) runCleanup(cleanup);
            }
            for (const cleanup of cleanups) runCleanup(cleanup);
            for (const controller of controllers) runCleanup(() => controller.destroy());
            actionCleanups.clear(); cleanups.clear(); controllers.clear(); currentControllers.clear();
        },
    };
}
