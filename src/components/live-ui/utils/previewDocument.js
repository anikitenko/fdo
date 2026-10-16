import postcss from 'postcss';
import {normalizeMockBackendScenario} from './mockBackendScenario';
import {CSS_STATES, parseStateSelector, previewStateTokens} from '../../../utils/plugins/authoring/liveUi/cssStates';

const OVERLAY_SELECTOR = 'dialog,[role="dialog"],[role="alertdialog"],[popover]';

export function statePreviewCss(css) {
    try {
        const root = postcss.parse(css);
        root.walkRules(rule => {
            const forced = rule.selectors.flatMap(selector => {
                const parsed = parseStateSelector(selector);
                if (!parsed || parsed.state === 'base') return [];
                // Each :is retains one pseudo-class of specificity and supports
                // both forced and native interactions in a combined state.
                return ['.' + parsed.classKey + parsed.tokens.map(token =>
                    `:is(:${token},[data-fdo-ui-state~="${token}"])`).join('')];
            });
            if (forced.length) rule.selector += ', ' + forced.join(', ');
        });
        return root.toString();
    } catch {return css;}
}

export function previewDocument(html, {token = '', elementIds = [], localActions = [], sdkComponents = [], sdkCollections = []} = {}) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('script,iframe,frame,object,embed,base,meta,link').forEach(node => node.remove());
    document.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
            if (/^on/i.test(attribute.name) || /^(href|src|srcset|action|formaction|target|ping|xlink:href|autofocus|data-fdo-simulation-state|data-fdo-ui-state|data-fdo-selected)$/i.test(attribute.name)) node.removeAttribute(attribute.name);
        }
    });
    const selectable = /^[a-f0-9]{32}$/.test(token);
    if (selectable) document.querySelectorAll('style').forEach(style => {style.textContent = statePreviewCss(style.textContent);});
    const allowed = new Set(elementIds);
    const nodes = [...document.querySelectorAll('[data-fdo-ui-id]')];
    const counts = new Map();
    for (const node of nodes) {const id = node.getAttribute('data-fdo-ui-id'); counts.set(id, (counts.get(id) || 0) + 1);}
    for (const node of nodes) {
        const id = node.getAttribute('data-fdo-ui-id');
        if (!allowed.has(id) || counts.get(id) !== 1) node.removeAttribute('data-fdo-ui-id');
    }
    const nodeFor = id => nodes.find(node=>node.getAttribute('data-fdo-ui-id') === id && allowed.has(id) && counts.get(id) === 1);
    const eligibleTarget = id => {const target=nodeFor(id);return target && ['P','PRE','SPAN','OUTPUT'].includes(target.tagName) && !target.children.length;};
    const actions = localActions.filter(action => {
        const button = nodeFor(action.id), target = nodeFor(action.targetId);
        const asyncRoot=action.sdkAsync===true && button?.getAttribute('data-fdo-component')==='fdo.async-action-button'
            && /^1\.\d+\.\d+$/.test(button.getAttribute('data-fdo-component-version') || '')
            && sdkComponents.some(item=>item.id===action.id && item.identity==='fdo.async-action-button')
            && [...button.querySelectorAll('button[data-fdo-action="run"]')].some(control=>!control.disabled && control.closest('[data-fdo-component]')===button);
        return ['set-text','backend-request'].includes(action.kind) && (button?.tagName === 'BUTTON' && !button.disabled || asyncRoot)
            && target && eligibleTarget(action.targetId)
            && (!action.outputs || Array.isArray(action.outputs) && action.outputs.length<=3 && action.outputs.every(output=>eligibleTarget(output.targetId) && ['json','text','length','summary','valueType','itemCount','topLevelKeys'].includes(output.display)) && new Set([action.targetId,...action.outputs.map(output=>output.targetId)]).size===action.outputs.length+1)
            && typeof action.text === 'string' && action.text.length <= 2000;
    }).map(({id,targetId,text,kind,display,preset,outputs})=>({id,targetId,text,kind,outputs:(outputs || []).map(({targetId,display})=>({targetId,display})),preset:preset === 'inspect-json' ? preset : 'text',display:['text','length','summary','valueType','itemCount','topLevelKeys'].includes(display) ? display : 'json'}));
    // User text is data inside the fixed script, including closing script tags.
    const actionData = JSON.stringify(actions).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    if (selectable) document.querySelectorAll('dialog').forEach(node => node.removeAttribute('open'));
    const components = sdkComponents.filter(item=>nodeFor(item.id)?.getAttribute('data-fdo-component') === item.identity).map(({id,identity,states})=>({id,identity,states}));
    const collections=sdkCollections.filter(item=>['fdo.tabs','fdo.accordion'].includes(item.identity) && nodeFor(item.id)?.getAttribute('data-fdo-component')===item.identity).map(({id,identity,keys})=>({id,identity,keys}));
    const collectionData=JSON.stringify(collections).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
    const componentData=JSON.stringify(components).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
    const csp = `default-src 'none'; style-src 'unsafe-inline' static://assets/css/pure-min.css; ${selectable ? `script-src 'nonce-${token}';` : ''} base-uri 'none'; form-action 'none';`;
    // Only this fixed host selection bridge executes. Workspace scripts and
    // event handlers have been removed, and the opaque frame has no preload.
    const bridge = selectable ? `<script nonce="${token}">(() => {
        const token = "${token}";
        const states = ${JSON.stringify(Object.fromEntries(CSS_STATES.map(item => [item.value, previewStateTokens(item.value)])))};
        const localActions = ${actionData};
        const components = ${componentData};
        const collections = ${collectionData};
        const nodeFor = id => Array.from(document.querySelectorAll('[data-fdo-ui-id]')).find(node=>node.getAttribute('data-fdo-ui-id') === id);
        const componentOriginals = new Map(components.map(item=>{const node=nodeFor(item.id);return [item.id,{html:node.innerHTML,attributes:Array.from(node.attributes).map(attr=>[attr.name,attr.value])}];}));
        const revealCollection=(id,key)=>{
            const descriptor=collections.find(item=>item.id===id && item.keys.includes(key)),root=descriptor && nodeFor(id);
            if(!root) return;
            let revealed=null;
            if(descriptor.identity==='fdo.tabs') {
                const own=node=>node.closest('[data-fdo-component="fdo.tabs"]')===root;
                const tabs=Array.from(root.querySelectorAll('[data-fdo-tab]')).filter(own),tab=tabs.find(node=>node.getAttribute('data-fdo-tab')===key);
                if(!tab) return;
                tabs.forEach(node=>{const active=node===tab;node.setAttribute('aria-selected',String(active));node.tabIndex=active && !node.disabled ? 0 : -1;});
                Array.from(root.querySelectorAll('[data-fdo-panel]')).filter(own).forEach(node=>{node.hidden=node.getAttribute('data-fdo-panel')!==key;if(!node.hidden) revealed=node;});
            } else {
                const items=Array.from(root.querySelectorAll('[data-fdo-item]')).filter(node=>node.closest('[data-fdo-component="fdo.accordion"]')===root);
                items.forEach(node=>{const details=node.firstElementChild;if(details?.tagName!=='DETAILS') return;
                    if(node.getAttribute('data-fdo-item')===key) {details.open=true;revealed=details;}
                    else if(root.getAttribute('data-fdo-multiple')!=='true') details.open=false;
                    details.setAttribute('data-fdo-state',details.open ? 'open' : 'closed');
                });
                root.setAttribute('data-fdo-state','open');
            }
            revealed?.scrollIntoView?.({block:'nearest',inline:'nearest',container:'nearest'});
        };
        const targetIds=[...new Set(localActions.flatMap(action=>[action.targetId,...action.outputs.map(output=>output.targetId)]))];
        const originalText = new Map(targetIds.map(id=>[id,nodeFor(id).textContent]));
        const originalBusy = new Map(targetIds.map(id=>[id,nodeFor(id).getAttribute('aria-busy')]));
        const pending = new Map();
        const normalizeScenario = ${normalizeMockBackendScenario.toString()};
        const cancelPending = targetId => {for(const [id,job] of pending) if(job.targets.includes(targetId)) {clearTimeout(job.timer);pending.delete(id);job.targets.forEach(id=>{nodeFor(id).textContent=originalText.get(id);restoreBusy(id);nodeFor(id).removeAttribute('data-fdo-simulation-state');});}};
        const restoreBusy = targetId => {const value=originalBusy.get(targetId),node=nodeFor(targetId);if(value === null) node.removeAttribute('aria-busy');else node.setAttribute('aria-busy',value);};
        let forcedState = 'base';
        let activeDialog = null, returnFocus = null, replayGeneration = 0;
        const overlaySelector = ${JSON.stringify(OVERLAY_SELECTOR)};
        const dialogs = Array.from(document.querySelectorAll(overlaySelector)).filter(node => node.hasAttribute('data-fdo-ui-id') && !node.parentElement.closest(overlaySelector));
        const originals = new Map(dialogs.map(node => [node, Object.fromEntries(['style','hidden','aria-hidden','popover','tabindex'].map(name => [name, node.getAttribute(name)]))]));
        const kind = node => node.tagName === 'DIALOG' ? 'native' : node.hasAttribute('popover') ? 'popover' : 'custom';
        const restoreRoot = node => Object.entries(originals.get(node)).forEach(([name, value]) => {
            if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
        });
        const conceal = node => {
            restoreRoot(node);
            node.setAttribute('hidden', ''); node.setAttribute('aria-hidden', 'true');
            node.style.setProperty('display', 'none', 'important');
        };
        dialogs.filter(node => kind(node) !== 'native').forEach(conceal);
        const closingCycles = new WeakMap();
        const tabIndexes = new Map();
        const focusable = 'input,select,textarea,button,a,[contenteditable],[tabindex]';
        document.querySelectorAll(focusable).forEach(node => tabIndexes.set(node, node.getAttribute('tabindex')));
        const restoreTabs = dialog => dialog.querySelectorAll(focusable).forEach(node => {
            const original = tabIndexes.get(node);
            if (original == null) node.removeAttribute('tabindex'); else node.setAttribute('tabindex', original);
        });
        const hideDialog = () => {
            replayGeneration++;
            const previous = activeDialog;
            activeDialog = null;
            if (previous) {
                if (kind(previous) === 'native') previous.close();
                else {
                    if (kind(previous) === 'popover' && previous.matches(':popover-open')) previous.hidePopover();
                    const cycle = (closingCycles.get(previous) || 0) + 1;
                    closingCycles.set(previous, cycle);
                    const transitions = previous.getAttribute('data-fdo-component') === 'fdo.popover'
                        ? previous.getAnimations().filter(animation => ['opacity','transform','display','overlay'].includes(animation.transitionProperty) && animation.effect?.getTiming().duration <= 2000)
                        : [];
                    if (transitions.length) {
                        previous.setAttribute('aria-hidden', 'true');
                        Promise.allSettled(transitions.map(animation => animation.finished)).then(() => {
                            if (activeDialog !== previous && closingCycles.get(previous) === cycle) conceal(previous);
                        });
                    } else conceal(previous);
                }
                previous.querySelectorAll(focusable).forEach(node => node.setAttribute('tabindex', '-1'));
                if (returnFocus?.isConnected) returnFocus.focus();
            }
        };
        const showDialog = id => {
            const next = dialogs.find(node => node.getAttribute('data-fdo-ui-id') === id);
            if (id !== '' && !next) return;
            if (next && next === activeDialog) return;
            hideDialog();
            if (next) {
                returnFocus = document.activeElement;
                activeDialog = next;
                closingCycles.set(next, (closingCycles.get(next) || 0) + 1);
                restoreTabs(next);
                if (kind(next) === 'native') next.showModal();
                else {
                    restoreRoot(next);
                    next.removeAttribute('hidden'); next.setAttribute('aria-hidden', 'false');
                    if (kind(next) === 'popover') {next.setAttribute('popover', 'manual'); next.showPopover();}
                    if (getComputedStyle(next).display === 'none') next.style.setProperty('display', 'block', 'important');
                    next.setAttribute('tabindex', '-1');
                    (Array.from(next.querySelectorAll(focusable)).find(node => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length) || next).focus();
                }
            }
        };
        const replayDialog = id => {
            const next = dialogs.find(node => node.getAttribute('data-fdo-ui-id') === id);
            if (!next || next !== activeDialog) return;
            hideDialog();
            next.getAnimations({subtree:true}).forEach(animation => {try {animation.finish();} catch {animation.cancel();}});
            const generation = ++replayGeneration;
            requestAnimationFrame(() => requestAnimationFrame(() => {if(generation === replayGeneration) showDialog(id);}));
        };
        dialogs.forEach(dialog => {
            dialog.addEventListener('cancel', event => {
                event.preventDefault();
                if (activeDialog !== dialog) return;
                const id = dialog.getAttribute('data-fdo-ui-id');
                hideDialog();
                parent.postMessage({type:'fdo-ui-dialog-closed', token, id}, '*');
            });
        });
        const select = (id, state = forcedState) => {
            forcedState = state;
            document.querySelectorAll('[data-fdo-selected],[data-fdo-ui-state]').forEach(node => {node.removeAttribute('data-fdo-selected'); node.removeAttribute('data-fdo-ui-state');});
            const node = Array.from(document.querySelectorAll('[data-fdo-ui-id]')).find(node => node.getAttribute('data-fdo-ui-id') === id);
            if (node) {
                for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement) {
                    if(ancestor.hasAttribute('data-fdo-panel')) {const root=ancestor.closest('[data-fdo-component="fdo.tabs"]');if(root) revealCollection(root.getAttribute('data-fdo-ui-id'),ancestor.getAttribute('data-fdo-panel'));}
                    if(ancestor.hasAttribute('data-fdo-item')) {const root=ancestor.closest('[data-fdo-component="fdo.accordion"]');if(root) revealCollection(root.getAttribute('data-fdo-ui-id'),ancestor.getAttribute('data-fdo-item'));}
                }
                node.setAttribute('data-fdo-selected', 'true');
                if (state !== 'base') node.setAttribute('data-fdo-ui-state', states[state]);
                node.scrollIntoView({block: 'nearest', inline: 'nearest', container: 'nearest'});
            }
        };
        document.addEventListener('pointerdown', event => {
            event.preventDefault(); event.stopImmediatePropagation();
            const node = event.target.closest?.('[data-fdo-ui-id]');
            if (node) { const id = node.getAttribute('data-fdo-ui-id'); select(id); parent.postMessage({type:'fdo-ui-select', token, id}, '*'); }
        }, true);
        document.addEventListener('click', event => {event.preventDefault(); event.stopImmediatePropagation();}, true);
        document.addEventListener('submit', event => event.preventDefault(), true);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && activeDialog) {
                if (kind(activeDialog) === 'native') return;
                event.preventDefault();
                const id = activeDialog.getAttribute('data-fdo-ui-id');
                hideDialog(); parent.postMessage({type:'fdo-ui-dialog-closed', token, id}, '*'); return;
            }
            if (event.key === 'Tab' && activeDialog && kind(activeDialog) === 'custom' && activeDialog.getAttribute('aria-modal') === 'true') {
                const items = Array.from(activeDialog.querySelectorAll(focusable)).filter(node => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length);
                const current = document.activeElement;
                if (!items.length || !activeDialog.contains(current) || current === activeDialog || (event.shiftKey ? current === items[0] : current === items.at(-1))) {
                    event.preventDefault(); (items.length ? (event.shiftKey ? items.at(-1) : items[0]) : activeDialog).focus();
                }
            }
            if (event.key !== 'Tab') event.preventDefault();
            if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat && ['ArrowUp','ArrowDown'].includes(event.key)) {
                parent.postMessage({type:'fdo-ui-hotkey', token, key:event.key}, '*');
            }
        }, true);
        document.querySelectorAll('input,select,textarea,button,a,[contenteditable]').forEach(node => {node.setAttribute('tabindex','-1'); node.setAttribute('contenteditable','false');});
        window.addEventListener('message', event => {
            if (event.source === parent && event.data?.token === token) {
                if (event.data.type === 'fdo-ui-ready-check') {parent.postMessage({type:'fdo-ui-ready',token},'*'); return;}
                if (event.data.type === 'fdo-ui-run-local') {
                    const action = localActions.find(item=>item.id === event.data.id);
                    if (action?.kind === 'set-text') {
                        cancelPending(action.targetId);restoreBusy(action.targetId);
                        nodeFor(action.targetId).removeAttribute('data-fdo-simulation-state');
                        nodeFor(action.targetId).textContent = action.text;
                        parent.postMessage({type:'fdo-ui-local-result',token,id:action.id,status:'ran'},'*');
                    }
                }
                if (event.data.type === 'fdo-ui-run-mock') {
                    const action = localActions.find(item=>item.id === event.data.id);
                    let scenario = normalizeScenario({...event.data.scenario,display:action?.display || 'json',preset:action?.preset || 'text'});
                    const outputs=action?.outputs.map(output=>({...output,result:normalizeScenario({...event.data.scenario,display:output.display,preset:action.preset})})) || [];
                    if(outputs.some(output=>!output.result)) return;
                    if(scenario?.outcome === 'success' && outputs.some(output=>output.result.outcome === 'error')) scenario=outputs.find(output=>output.result.outcome === 'error').result;
                    if (action && scenario) {
                        const target = nodeFor(action.targetId);
                        const targets=[action.targetId,...action.outputs.map(output=>output.targetId)];
                        targets.forEach(cancelPending);
                        target.textContent = scenario.loadingText;
                        target.setAttribute('aria-busy','true');
                        target.setAttribute('data-fdo-simulation-state','loading');
                        parent.postMessage({type:'fdo-ui-local-result',token,id:action.id,status:'loading'},'*');
                        const job={targets,timer:null};
                        job.timer = setTimeout(()=>{
                            if (pending.get(action.targetId) !== job) return;
                            pending.delete(action.targetId);restoreBusy(action.targetId);
                            target.textContent = scenario.text;
                            target.setAttribute('data-fdo-simulation-state',scenario.outcome);
                            if(scenario.outcome === 'success') outputs.forEach(output=>{nodeFor(output.targetId).textContent=output.result.text;nodeFor(output.targetId).setAttribute('data-fdo-simulation-state','success');});
                            parent.postMessage({type:'fdo-ui-local-result',token,id:action.id,status:scenario.outcome},'*');
                        },scenario.latencyMs);
                        pending.set(action.targetId,job);
                    }
                }
                if (event.data.type === 'fdo-ui-reset-local') {
                    originalText.forEach((text,id)=>{cancelPending(id);restoreBusy(id);nodeFor(id).textContent=text;nodeFor(id).removeAttribute('data-fdo-simulation-state');});
                    parent.postMessage({type:'fdo-ui-local-result',token,status:'reset'},'*');
                }
            }
            if(event.source===parent && event.data?.type==='fdo-ui-collection-item' && event.data.token===token) revealCollection(event.data.id,event.data.key);
            if(event.source===parent && event.data?.type==='fdo-ui-component-state' && event.data.token===token) {
                const descriptor=components.find(item=>item.id===event.data.id),state=event.data.state;
                if(descriptor && (state==='authored' || descriptor.states.includes(state))) {
                    const node=nodeFor(descriptor.id),original=componentOriginals.get(descriptor.id);
                    for(const attr of Array.from(node.attributes)) if(!['data-fdo-selected','data-fdo-ui-state'].includes(attr.name)) node.removeAttribute(attr.name);
                    for(const [name,value] of original.attributes) node.setAttribute(name,value);
                    node.innerHTML=original.html;
                    if(state!=='authored') {
                        node.setAttribute('data-fdo-state',state);
                        if(['fdo.toast','fdo.inline-alert'].includes(descriptor.identity)) node.hidden=['closed','hidden'].includes(state);
                        if(descriptor.identity==='fdo.disclosure') node.open=state==='open';
                        if(descriptor.identity==='fdo.accordion') node.querySelectorAll('details').forEach((child,index)=>{child.open=state==='open' && (index===0 || node.getAttribute('data-fdo-multiple')==='true');child.setAttribute('data-fdo-state',child.open ? 'open' : 'closed');});
                        if(descriptor.identity==='fdo.progress-bar') {if(state==='indeterminate') node.removeAttribute('value');else node.setAttribute('value',original.attributes.find(([name])=>name==='value')?.[1] || '0');}
                        if(descriptor.identity==='fdo.async-action-button') {
                            const run=node.querySelector('[data-fdo-action="run"]'),cancel=node.querySelector('[data-fdo-action="cancel"]'),status=node.querySelector('[data-fdo-slot="status"]'),error=node.querySelector('[data-fdo-slot="error"]');
                            run.disabled=state==='pending' || run.disabled;cancel.hidden=state!=='pending';node.setAttribute('aria-busy',String(state==='pending'));
                            run.textContent=run.getAttribute(state==='pending' ? 'data-fdo-pending-label' : state==='success' ? 'data-fdo-success-label' : 'data-fdo-idle-label');
                            status.hidden=!['pending','success','cancelled'].includes(state);status.textContent=state==='cancelled' ? 'Cancelled (preview)' : run.textContent;
                            error.hidden=state!=='error';error.textContent='Example failure (preview)';
                        }
                    }
                }
            }
            if (event.source === parent && event.data?.type === 'fdo-ui-replay-overlay'  && event.data.token === token && typeof event.data.id === 'string') replayDialog(event.data.id);
            if (event.source === parent && event.data?.type === 'fdo-ui-dialog' && event.data.token === token && typeof event.data.id === 'string') showDialog(event.data.id);
            if (event.source === parent && event.data?.type === 'fdo-ui-highlight' && event.data.token === token && typeof event.data.id === 'string' &&
                Object.hasOwn(states, event.data.state ?? 'base')) select(event.data.id, event.data.state ?? 'base');
        });
        parent.postMessage({type:'fdo-ui-ready',token},'*');
    })();</script>` : '';
    return /* language=TEXT */ `<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" data-fdo-preview-host-style href="static://assets/css/pure-min.css"><style>body{margin:0;background:#101820}*{box-sizing:border-box}[data-fdo-simulation-state="loading"]{box-shadow:inset 0 0 0 2px #d99e0b}[data-fdo-simulation-state="success"]{box-shadow:inset 0 0 0 2px #3dcc91}[data-fdo-simulation-state="error"]{box-shadow:inset 0 0 0 2px #ff7373}[data-fdo-selected]:not([data-fdo-ui-state]){outline:3px solid #78b7ff!important;outline-offset:2px!important}</style></head><body><div ${selectable ? '' : 'inert'}>${document.head.innerHTML}${document.body.innerHTML}</div>${bridge}</body></html>`;
}

export function createPreviewSurface(result) {
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
    const elements = result.elements || [];
    const source = previewDocument(result.html || '', {token, elementIds: elements.map(item => item.id), sdkCollections:elements.filter(item=>item.sdkComponent?.collection?.editable).map(item=>({id:item.id,identity:item.sdkComponent.identity,keys:item.sdkComponent.collection.items.map(row=>row.key)})), sdkComponents:elements.filter(item=>item.sdkComponent?.previewStates?.length).map(item=>({id:item.id,identity:item.sdkComponent.identity,states:item.sdkComponent.previewStates})), localActions: elements.filter(item=>item.localActionSimulation).map(item=>({id:item.id,sdkAsync:item.asyncAction?.editable && item.asyncAction.status==='connected',...item.localActionSimulation}))});
    const document = new DOMParser().parseFromString(source, 'text/html');
    const byId = new Map(elements.map(item => [item.id, item]));
    const tree = [...document.querySelectorAll('[data-fdo-ui-id]')].map(node => {
        let depth = 0, parent = node.parentElement;
        while (parent) {if (parent.hasAttribute('data-fdo-ui-id')) depth++; parent = parent.parentElement;}
        const nearest = node.closest(OVERLAY_SELECTOR);
        const dialog = nearest?.hasAttribute('data-fdo-ui-id') && !nearest.parentElement.closest(OVERLAY_SELECTOR) ? nearest : null;
        const component=node.closest('[data-fdo-component][data-fdo-ui-id]');
        const owner=component && byId.get(component.getAttribute('data-fdo-ui-id'));
        let item=node;
        while(item && item.parentElement!==component) item=item.parentElement;
        const key=item?.getAttribute('data-fdo-panel') ?? item?.getAttribute('data-fdo-item');
        const collectionKey=item?.closest('[data-fdo-component][data-fdo-ui-id]')===component && owner?.sdkComponent?.collection?.items.some(row=>row.key===key) ? key : '';

        return {collectionKey,componentId:component && byId.get(component.getAttribute('data-fdo-ui-id'))?.sdkComponent ? component.getAttribute('data-fdo-ui-id') : '', ...byId.get(node.getAttribute('data-fdo-ui-id')), depth, dialogId: dialog?.getAttribute('data-fdo-ui-id') || '',
            overlayKind: node === dialog ? (node.tagName === 'DIALOG' ? 'native-dialog' : node.hasAttribute('popover') ? 'popover' : 'custom-dialog') : undefined};
    });
    return {document: source, token, tree, dialogs: tree.filter(item => item.overlayKind)};
}
