import {previewDocument, createPreviewSurface} from '../../src/components/live-ui/utils/previewDocument';

test('static preview retains emitted CSS but removes active content and navigation attributes', () => {
    const source = previewDocument('<style>.panel {color: red}</style><script>alert(1)</script><iframe src="https://example.com"></iframe><a href="https://example.com" onclick="alert(1)">Link</a><form action="https://example.com"><button formaction="https://example.com">Save</button></form><meta http-equiv="refresh" content="0; url=https://example.com">');
    const document = new DOMParser().parseFromString(source, 'text/html');
    expect(document.querySelector('script,iframe')).toBeNull();
    expect(document.querySelector('[onclick],a[href],[action],[formaction]')).toBeNull();
    expect([...document.querySelectorAll('[href]')].map(node=>node.getAttribute('href'))).toEqual(['static://assets/css/pure-min.css']);
    expect(document.querySelector('style').textContent).toBeTruthy();
    expect(document.querySelector('[inert]')).toBeTruthy();
    expect(document.querySelector('meta').content).toContain("default-src 'none'");
    expect(document.querySelectorAll('meta')).toHaveLength(1);
});

test('selection mode permits only the fixed host bridge and rejects duplicate source markers', () => {
    const token = 'a'.repeat(32);
    const source = previewDocument('<script>fetch("https://bad.invalid")</script><button data-fdo-ui-id="element-1" onclick="alert(1)">One</button><div data-fdo-ui-id="element-1">Spoof</div>', {token, elementIds: ['element-1']});
    const document = new DOMParser().parseFromString(source, 'text/html');
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(document.querySelector('script').getAttribute('nonce')).toBe(token);
    expect(document.querySelector('script').textContent).not.toContain('bad.invalid');
    expect(document.querySelector('[onclick],[data-fdo-ui-id]')).toBeNull();
    expect(document.querySelector('meta').content).toContain("script-src 'nonce-" + token + "'");
});

test('forced-state CSS handles only class-state combinations and preserves selector literals and conditions', () => {
    const {statePreviewCss} = require('../../src/components/live-ui/utils/previewDocument');
    const css = '.a:hover {color:red} .a:focus-visible {outline:2px solid blue} [title=":hover"] {color:pink} .a:hover:focus {color:yellow} @media (max-width:400px) {.a:focus {color:green}}';
    const next = statePreviewCss(css);
    expect(next).toContain('.a:is(:hover,[data-fdo-ui-state~="hover"])');
    expect(next).toContain('.a:is(:focus-visible,[data-fdo-ui-state~="focus-visible"])');
    expect(next).toContain('[title=":hover"]');
    expect(next).toContain('.a:hover:focus, .a:is(:hover,[data-fdo-ui-state~="hover"]):is(:focus,[data-fdo-ui-state~="focus"]) {color:yellow}');
    expect(next).toContain('@media (max-width:400px) {.a:focus, .a:is(:focus,[data-fdo-ui-state~="focus"])');
    const document = new DOMParser().parseFromString(previewDocument('<div data-fdo-selected data-fdo-ui-state="hover">Fake</div>'), 'text/html');
    expect(document.querySelector('[data-fdo-ui-state],[data-fdo-selected]')).toBeNull();
});

test('state preview excludes complex selectors and keeps one specificity unit per interaction', () => {
    const {statePreviewCss} = require('../../src/components/live-ui/utils/previewDocument');
    const untouched = '.a:hover .b {color:red} .a:not(:hover) {color:blue} .a:hover:hover {color:pink}';
    expect(statePreviewCss(untouched)).toBe(untouched);
    const next = statePreviewCss('.a:focus:hover {color:green}');
    expect(next).toContain('.a:is(:focus,[data-fdo-ui-state~="focus"]):is(:hover,[data-fdo-ui-state~="hover"])');
});

test('surface maps eligible dialog ancestry while excluding nested and unmapped dialog controls', () => {
    const elements = ['outer', 'child', 'nested', 'nested-child', 'outside'].map(id => ({id, tag: ['outer', 'nested'].includes(id) ? 'dialog' : 'button'}));
    const surface = createPreviewSurface({elements, html: '<dialog data-fdo-ui-id="outer" open><button data-fdo-ui-id="child">Child</button><dialog data-fdo-ui-id="nested"><button data-fdo-ui-id="nested-child">Nested</button></dialog></dialog><dialog>Unmapped</dialog><button data-fdo-ui-id="outside">Outside</button>'});
    expect(surface.dialogs.map(item => item.id)).toEqual(['outer']);
    expect(surface.tree.find(item => item.id === 'child').dialogId).toBe('outer');
    expect(surface.tree.find(item => item.id === 'nested-child').dialogId).toBe('');
    expect(surface.tree.find(item => item.id === 'outside').dialogId).toBe('');
    expect(new DOMParser().parseFromString(surface.document, 'text/html').querySelector('dialog[open]')).toBeNull();
});

test('fixed dialog bridge requires the parent and token, restores tab order and handles native cancellation without plugin actions', () => {
    const token = 'a'.repeat(32);
    const source = previewDocument('<button data-fdo-ui-id="outside">Outside</button><dialog data-fdo-ui-id="dialog"><input tabindex="2"><button data-fdo-ui-id="cancel" onclick="throw Error()">Cancel</button></dialog><dialog>Unmapped</dialog>', {token, elementIds: ['dialog', 'outside', 'cancel']});
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const modal = doc.querySelector('dialog'), input = doc.querySelector('input');
    modal.showModal = jest.fn(() => modal.setAttribute('open', ''));
    modal.close = jest.fn(() => modal.removeAttribute('open'));
    const parent = {postMessage: jest.fn()};
    let receive;
    const win = {addEventListener: (name, callback) => {if (name === 'message') receive = callback;}};
    new Function('document', 'window', 'parent', doc.querySelector('script').textContent)(doc, win, parent);
    const send = (id, extras = {}) => receive({source: parent, data: {type: 'fdo-ui-dialog', token, id}, ...extras});
    expect(input.tabIndex).toBe(-1);
    send('dialog', {source: {}});
    send('dialog', {data: {type: 'fdo-ui-dialog', token: 'wrong', id: 'dialog'}});
    send('outside'); send('unknown');
    expect(modal.showModal).not.toHaveBeenCalled();
    send('dialog');
    expect(modal.showModal).toHaveBeenCalledTimes(1);
    expect(input.tabIndex).toBe(2);
    send('dialog');
    expect(modal.showModal).toHaveBeenCalledTimes(1);
    const escape = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
    modal.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    const cancel = new Event('cancel', {cancelable: true});
    modal.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(modal.close).toHaveBeenCalledTimes(1);
    expect(input.tabIndex).toBe(-1);
    expect(parent.postMessage).toHaveBeenCalledWith({type: 'fdo-ui-dialog-closed', token, id: 'dialog'}, '*');
    send('dialog'); send('');
    expect(modal.hasAttribute('open')).toBe(false);
    expect(doc.querySelector('[onclick]')).toBeNull();
});

test('discovers custom dialog and popover roots, retaining kinds and excluding nested overlay ancestry', () => {
    const elements = ['custom', 'title', 'popup', 'popup-child', 'nested'].map(id => ({id, tag: id === 'title' ? 'h2' : 'div'}));
    const surface = createPreviewSurface({elements, html: '<div data-fdo-ui-id="custom" role="dialog"><h2 data-fdo-ui-id="title">Title</h2><div popover data-fdo-ui-id="nested"></div></div><div popover="auto" data-fdo-ui-id="popup"><span data-fdo-ui-id="popup-child">Popup</span></div>'});
    expect(surface.dialogs.map(item => [item.id, item.overlayKind])).toEqual([['custom', 'custom-dialog'], ['popup', 'popover']]);
    expect(surface.tree.find(item => item.id === 'title').dialogId).toBe('custom');
    expect(surface.tree.find(item => item.id === 'popup-child').dialogId).toBe('popup');
    expect(surface.tree.find(item => item.id === 'nested').dialogId).toBe('');
});

test('custom preview preserves authored styles, reveals only the root and closes on Escape without persisting attributes', () => {
    const token = 'a'.repeat(32);
    const html = '<div role="dialog" aria-modal="true" aria-hidden="true" hidden class="closed" style="display:none;position:fixed;top:12px" data-fdo-ui-id="custom"><button data-fdo-ui-id="child">Cancel</button></div>';
    const doc = new DOMParser().parseFromString(previewDocument(html, {token, elementIds: ['custom', 'child']}), 'text/html');
    const root = doc.querySelector('[role="dialog"]');
    const parent = {postMessage: jest.fn()}; let receive;
    new Function('document', 'window', 'parent', doc.querySelector('script').textContent)(doc, {addEventListener: (type, callback) => {if (type === 'message') receive = callback;}}, parent);
    expect(root.hidden).toBe(true);
    receive({source: parent, data: {type: 'fdo-ui-dialog', token, id: 'custom'}});
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.style.display).toBe('block');
    expect(root.style.position).toBe('fixed');
    expect(root.style.top).toBe('12px');
    expect(root.className).toBe('closed');
    root.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    expect(root.hidden).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.style.top).toBe('12px');
    expect(parent.postMessage).toHaveBeenCalledWith({type: 'fdo-ui-dialog-closed', token, id: 'custom'}, '*');
    expect(html).toContain('aria-hidden="true" hidden class="closed"');
});

test('popover bridge uses native methods with manual preview mode and restores its authored mode on close', () => {
    const token = 'b'.repeat(32);
    const doc = new DOMParser().parseFromString(previewDocument('<aside popover="auto" hidden style="position:fixed" data-fdo-ui-id="popup"><button data-fdo-ui-id="child">Action</button></aside>',
        {token, elementIds: ['popup', 'child']}), 'text/html');
    const popup = doc.querySelector('aside'); let open = false;
    const matches = popup.matches.bind(popup);
    popup.matches = selector => selector === ':popover-open' ? open : matches(selector);
    popup.showPopover = jest.fn(() => {open = true;}); popup.hidePopover = jest.fn(() => {open = false;});
    const parent = {postMessage: jest.fn()}; let receive;
    new Function('document', 'window', 'parent', doc.querySelector('script').textContent)(doc, {addEventListener: (type, callback) => {if (type === 'message') receive = callback;}}, parent);
    const send = id => receive({source: parent, data: {type: 'fdo-ui-dialog', token, id}});
    send('child'); expect(popup.showPopover).not.toHaveBeenCalled();
    send('popup');
    expect(popup.showPopover).toHaveBeenCalledTimes(1);
    expect(popup.getAttribute('popover')).toBe('manual');
    expect(popup.hidden).toBe(false);
    send('unknown'); expect(popup.hidePopover).not.toHaveBeenCalled();
    send('');
    expect(popup.hidePopover).toHaveBeenCalledTimes(1);
    expect(popup.getAttribute('popover')).toBe('auto');
    expect(popup.style.position).toBe('fixed');
    expect(popup.hidden).toBe(true);
});

test('local simulator authenticates messages, writes inert text and resets authored text without changing source',()=>{
    const text = /* language=TEXT */ '</script><img src=x onerror="bad()">\nNext line';
    const html = '<button data-fdo-ui-id="run">Run</button><pre class="result" data-fdo-ui-id="result">Authored text</pre>';
    const token = 'a'.repeat(32);
    const source = previewDocument(html,{token,elementIds:['run','result'],localActions:[{kind:'set-text',id:'run',targetId:'result',text}]});
    const doc = new DOMParser().parseFromString(source,'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    const parent = {postMessage:jest.fn()};
    let receive;
    new Function('document','window','parent',doc.querySelector('script').textContent)(doc,{addEventListener:(type,handler)=>{if(type==='message') receive=handler;}},parent);
    const send = (data,source=parent)=>receive({source,data:{token,...data}});
    const target = doc.querySelector('pre');
    send({type:'fdo-ui-run-local',id:'run'},{});
    send({type:'fdo-ui-run-local',id:'run',token:'wrong'});
    send({type:'fdo-ui-run-local',id:'unknown'});
    expect(target.textContent).toBe('Authored text');
    send({type:'fdo-ui-run-local',id:'run'});
    expect(target.textContent).toBe(text);
    expect(target.children).toHaveLength(0);
    expect(target.className).toBe('result');
    expect(target.getAttribute('data-fdo-ui-id')).toBe('result');
    send({type:'fdo-ui-reset-local'});
    expect(target.textContent).toBe('Authored text');
    send({type:'fdo-ui-run-local',id:'run'});
    expect(target.textContent).toBe(text);
    expect(parent.postMessage).toHaveBeenCalledWith({type:'fdo-ui-local-result',token,id:'run',status:'ran'},'*');
    expect(html).toContain('Authored text');
});

test('local simulator rejects missing, duplicate, non-leaf and active control targets',()=>{
    const token = 'b'.repeat(32);
    for (const content of ['<pre data-fdo-ui-id="result"><span>Nested</span></pre>','<input data-fdo-ui-id="result">','<pre data-fdo-ui-id="result">One</pre><pre data-fdo-ui-id="result">Two</pre>','']) {
        const source = previewDocument('<button data-fdo-ui-id="run">Run</button>'+content,{token,elementIds:['run','result'],localActions:[{kind:'set-text',id:'run',targetId:'result',text:'Unsafe'}]});
        const doc = new DOMParser().parseFromString(source,'text/html');
        expect(doc.querySelector('script').textContent).toContain('const localActions = [];');
    }
});

test('preview strips autofocus without changing authored source or allowing automatic focus',()=>{
    const html = '<input autofocus value="Keep me"><textarea AUTOFOCUS>Text</textarea><dialog autofocus><button autofocus>OK</button></dialog>';
    const doc = new DOMParser().parseFromString(previewDocument(html,{token:'a'.repeat(32)}),'text/html');
    expect(doc.querySelector('[autofocus]')).toBeNull();
    expect(doc.querySelector('input').value).toBe('Keep me');
    expect(doc.querySelector('textarea').textContent).toBe('Text');
    expect(html).toContain('autofocus');
});

test('mock bridge shows loading/success/error, validates data, and cancels pending writes on Reset or rerun',()=>{
    jest.useFakeTimers();
    try {
        const token='a'.repeat(32);
        const html='<button data-fdo-ui-id="run">Run</button><pre data-fdo-ui-id="result" aria-busy="false">Authored</pre>';
        const doc=new DOMParser().parseFromString(previewDocument(html,{token,elementIds:['run','result'],localActions:[{kind:'set-text',id:'run',targetId:'result',text:'Local'}]}),'text/html');
        const parent={postMessage:jest.fn()};let receive;
        new Function('document','window','parent',doc.querySelector('script').textContent)(doc,{addEventListener:(type,fn)=>{if(type==='message') receive=fn;}},parent);
        const send=(type,scenario,overrides={})=>receive({source:parent,data:{type,token,id:'run',scenario,...overrides}});
        const target=doc.querySelector('pre');
        const scenario={outcome:'success',latencyMs:500,loadingText:'Waiting',responseText:'{"value":"</script><b>text</b>"}'};
        send('fdo-ui-run-mock',scenario,{token:'wrong'});
        send('fdo-ui-run-mock',scenario,{id:'unknown'});
        for(const invalid of [{...scenario,latencyMs:10001},{...scenario,latencyMs:-1},{...scenario,latencyMs:0.5},{...scenario,responseText:'invalid'},{...scenario,loadingText:''}]) send('fdo-ui-run-mock',invalid);
        expect(target.textContent).toBe('Authored');expect(jest.getTimerCount()).toBe(0);
        send('fdo-ui-run-mock',scenario);
        expect(target.textContent).toBe('Waiting');expect(target.getAttribute('aria-busy')).toBe('true');
        expect(target.getAttribute('data-fdo-simulation-state')).toBe('loading');
        jest.advanceTimersByTime(499);expect(target.textContent).toBe('Waiting');
        jest.advanceTimersByTime(1);expect(target.textContent).toBe(JSON.stringify(JSON.parse(scenario.responseText),null,2));
        expect(target.children).toHaveLength(0);expect(target.getAttribute('aria-busy')).toBe('false');
        expect(target.getAttribute('data-fdo-simulation-state')).toBe('success');
        send('fdo-ui-run-mock',{outcome:'error',latencyMs:100,loadingText:'Retrying',errorText:/* language=TEXT */ '<img src=x> Offline'});
        jest.advanceTimersByTime(100);expect(target.textContent).toBe(/* language=TEXT */ '<img src=x> Offline');
        expect(target.getAttribute('data-fdo-simulation-state')).toBe('error');expect(target.children).toHaveLength(0);
        send('fdo-ui-run-mock',scenario);send('fdo-ui-reset-local');
        jest.runAllTimers();expect(target.textContent).toBe('Authored');
        expect(target.hasAttribute('data-fdo-simulation-state')).toBe(false);expect(target.getAttribute('aria-busy')).toBe('false');
        send('fdo-ui-run-mock',scenario);send('fdo-ui-run-local');
        jest.runAllTimers();expect(target.textContent).toBe('Local');
        send('fdo-ui-run-mock',scenario);
        send('fdo-ui-run-mock',{...scenario,latencyMs:0,responseText:'{"latest":true}'});
        jest.runAllTimers();expect(target.textContent).toBe('{\n  "latest": true\n}');
        expect(parent.postMessage).toHaveBeenCalledWith({type:'fdo-ui-local-result',token,id:'run',status:'error'},'*');
        expect(jest.getTimerCount()).toBe(0);
    } finally {jest.useRealTimers();}
});

test('backend action descriptors support mocks only and cannot run through the local action command',()=>{
    jest.useFakeTimers();
    try {
        const token='a'.repeat(32),parent={postMessage:jest.fn()};let receive;
        const doc=new DOMParser().parseFromString(previewDocument('<button data-fdo-ui-id="run">Run</button><pre data-fdo-ui-id="result">Authored</pre>',{
            token,elementIds:['run','result'],localActions:[{kind:'backend-request',id:'run',targetId:'result',text:'Request',display:'text'}],
        }),'text/html');
        new Function('document','window','parent',doc.querySelector('script').textContent)(doc,{addEventListener:(type,fn)=>{if(type==='message') receive=fn;}},parent);
        const send=data=>receive({source:parent,data:{token,id:'run',...data}});
        send({type:'fdo-ui-run-local'});expect(doc.querySelector('pre').textContent).toBe('Authored');
        expect(parent.postMessage).toHaveBeenCalledTimes(1);
        expect(parent.postMessage).toHaveBeenCalledWith({type:'fdo-ui-ready',token},'*');
        send({type:'fdo-ui-run-mock',scenario:{outcome:'success',latencyMs:0,loadingText:'Waiting',display:'length',responseText:'{"success":true,"text":"Mock"}'}});
        jest.runAllTimers();expect(doc.querySelector('pre').textContent).toBe('Mock');
        send({type:'fdo-ui-reset-local'});expect(doc.querySelector('pre').textContent).toBe('Authored');
    } finally {jest.useRealTimers();}
});

test('mock response mapping preserves empty/zero fields and reports missing fields instead of falling back',()=>{
    const {normalizeMockBackendScenario:normalize}=require('../../src/components/live-ui/utils/mockBackendScenario');
    const scenario={outcome:'success',latencyMs:0,loadingText:'Wait',responseText:'{"text":"","length":0}'};
    expect(normalize({...scenario,display:'text'}).text).toBe('');
    expect(normalize({...scenario,display:'length'}).text).toBe('0');
    expect(normalize({...scenario,display:'text',responseText:'{}'})).toMatchObject({outcome:'error',text:'Missing or invalid response field: text.'});
    expect(normalize({...scenario,display:'length',responseText:'{"length":"3"}'}).outcome).toBe('error');
    expect(normalize({...scenario,display:'__proto__'})).toBeNull();
    expect(normalize({...scenario,display:'text',responseText:/* language=TEXT */ '{"text":"<img src=x>"}'}).text).toBe(/* language=TEXT */ '<img src=x>');
});

test('multi-output mock updates atomically, resets all outputs and cancels overlapping pending requests',()=>{
    jest.useFakeTimers();
    try {
        const token='a'.repeat(32),parent={postMessage:jest.fn()};let receive;
        const doc=new DOMParser().parseFromString(previewDocument('<button data-fdo-ui-id="run">Run</button><button data-fdo-ui-id="other">Other</button><pre data-fdo-ui-id="first">First</pre><pre data-fdo-ui-id="second">Second</pre>',{token,elementIds:['run','other','first','second'],localActions:[
            {kind:'backend-request',id:'run',targetId:'first',text:'',display:'text',outputs:[{targetId:'second',display:'length'}]},
            {kind:'set-text',id:'other',targetId:'second',text:'Local'},
        ]}),'text/html');
        new Function('document','window','parent',doc.querySelector('script').textContent)(doc,{addEventListener:(type,fn)=>{if(type==='message') receive=fn;}},parent);
        const send=(type,id='run',responseText='{"text":"<b>value</b>","length":12}')=>receive({source:parent,data:{token,type,id,scenario:{outcome:'success',latencyMs:100,loadingText:'Loading',responseText}}});
        const [first,second]=doc.querySelectorAll('pre');
        send('fdo-ui-run-mock');jest.runAllTimers();expect(first.textContent).toBe('<b>value</b>');expect(second.textContent).toBe('12');expect(first.children).toHaveLength(0);
        send('fdo-ui-reset-local');expect(first.textContent).toBe('First');expect(second.textContent).toBe('Second');
        send('fdo-ui-run-mock','run','{"text":"incomplete"}');jest.runAllTimers();expect(first.textContent).toContain('Missing or invalid');expect(second.textContent).toBe('Second');
        send('fdo-ui-run-mock');send('fdo-ui-run-local','other');jest.runAllTimers();expect(first.textContent).toBe('First');expect(first.hasAttribute('aria-busy')).toBe(false);expect(second.textContent).toBe('Local');
        send('fdo-ui-run-mock');send('fdo-ui-reset-local');jest.runAllTimers();expect(first.textContent).toBe('First');expect(second.textContent).toBe('Second');
    } finally {jest.useRealTimers();}
});

test('SDK state previews require trusted component descriptors, parent and token; reset restores authored markup',()=>{
    const token='b'.repeat(32),html='<div id="toast" hidden data-fdo-component="fdo.toast" data-fdo-state="closed" data-fdo-ui-id="toast"><span>Message</span></div><progress data-fdo-component="fdo.progress-bar" data-fdo-ui-id="progress" value="20" max="100"></progress>';
    const source=previewDocument(html,{token,elementIds:['toast','progress'],sdkComponents:[{id:'toast',identity:'fdo.toast',states:['closed','open']},{id:'progress',identity:'fdo.progress-bar',states:['determinate','indeterminate']}]});
    const doc=new DOMParser().parseFromString(source,'text/html'),parent={postMessage:jest.fn()};let receive;
    new Function('document','window','parent',doc.querySelector('script').textContent)(doc,{addEventListener:(name,fn)=>{if(name==='message') receive=fn;}},parent);
    const send=(id,state,extras={})=>receive({source:parent,data:{type:'fdo-ui-component-state',token,id,state},...extras});
    send('toast','open',{source:{}});expect(doc.querySelector('#toast').hidden).toBe(true);
    send('toast','open',{data:{type:'fdo-ui-component-state',token:'bad',id:'toast',state:'open'}});expect(doc.querySelector('#toast').hidden).toBe(true);
    send('toast','open');expect(doc.querySelector('#toast').hidden).toBe(false);
    send('toast','destroyed');expect(doc.querySelector('#toast').hidden).toBe(false);
    send('toast','authored');expect(doc.querySelector('#toast').hidden).toBe(true);
    send('progress','indeterminate');expect(doc.querySelector('progress').hasAttribute('value')).toBe(false);
    send('progress','authored');expect(doc.querySelector('progress').value).toBe(20);
    expect(doc.querySelector('#toast span').textContent).toBe('Message');
});

test('collection previews reveal only allowed own panels/sections and inspection reveals hidden content without mounting',()=>{
    const token='c'.repeat(32),html='<div data-fdo-component="fdo.tabs" data-fdo-ui-id="tabs"><button data-fdo-tab="one" aria-selected="true">One</button><button data-fdo-tab="two" aria-selected="false">Two</button><div data-fdo-panel="one">First</div><div data-fdo-panel="two" hidden><p data-fdo-ui-id="child">Second</p></div></div><section data-fdo-component="fdo.accordion" data-fdo-ui-id="accordion" data-fdo-multiple="false"><div data-fdo-item="one"><details open><summary>First</summary></details></div><div data-fdo-item="two"><details><summary>Second</summary><p data-fdo-ui-id="detail-child">Body</p></details></div></section>';
    const source=previewDocument(html,{token,elementIds:['tabs','child','accordion','detail-child'],sdkCollections:[{id:'tabs',identity:'fdo.tabs',keys:['one','two']},{id:'accordion',identity:'fdo.accordion',keys:['one','two']}]});
    const doc=new DOMParser().parseFromString(source,'text/html'),parent={postMessage:jest.fn()};let receive;
    doc.querySelectorAll('[data-fdo-ui-id]').forEach(node=>{node.scrollIntoView=jest.fn();});
    new Function('document','window','parent',doc.querySelector('script').textContent)(doc,{addEventListener:(type,fn)=>{if(type==='message') receive=fn;}},parent);
    const send=(id,key,extra={})=>receive({source:parent,data:{type:'fdo-ui-collection-item',token,id,key},...extra});
    const panel=doc.querySelector('[data-fdo-panel="two"]');panel.scrollIntoView=jest.fn();
    send('tabs','two',{source:{}});expect(panel.hidden).toBe(true);
    send('tabs','two',{data:{type:'fdo-ui-collection-item',token:'wrong',id:'tabs',key:'two'}});expect(panel.hidden).toBe(true);
    send('tabs','unknown');expect(panel.hidden).toBe(true);expect(panel.scrollIntoView).not.toHaveBeenCalled();
    send('tabs','two');expect(panel.hidden).toBe(false);expect(panel.scrollIntoView).toHaveBeenCalledWith({block:'nearest',inline:'nearest',container:'nearest'});expect(doc.querySelector('[data-fdo-panel="one"]').hidden).toBe(true);
    expect(doc.querySelector('[data-fdo-tab="two"]').getAttribute('aria-selected')).toBe('true');
    send('tabs','one');
    receive({source:parent,data:{type:'fdo-ui-highlight',token,id:'child',state:'base'}});expect(panel.hidden).toBe(false);
    receive({source:parent,data:{type:'fdo-ui-highlight',token,id:'detail-child',state:'base'}});
    expect(doc.querySelector('[data-fdo-item="one"] details').open).toBe(false);expect(doc.querySelector('[data-fdo-item="two"] details').open).toBe(true);
});

test('collection navigation derives item context from the owning SDK root, ignoring nested lookalike markers',()=>{
    const elements=[{id:'tabs',sdkComponent:{identity:'fdo.tabs',collection:{items:[{key:'one'},{key:'two'}]}}},{id:'child'},{id:'unrelated'}];
    const surface=createPreviewSurface({elements,html:'<div data-fdo-component="fdo.tabs" data-fdo-ui-id="tabs"><div data-fdo-panel="one"><div data-fdo-panel="two"><p data-fdo-ui-id="child">Nested body</p></div></div></div><p data-fdo-ui-id="unrelated" data-fdo-panel="two">Outside</p>'});
    expect(surface.tree.find(item=>item.id==='child')).toMatchObject({componentId:'tabs',collectionKey:'one'});
    expect(surface.tree.find(item=>item.id==='tabs').collectionKey).toBe('');
    expect(surface.tree.find(item=>item.id==='unrelated').collectionKey).toBe('');
});

test('mock bridge accepts verified enabled SDK async roots and rejects unverified or nested controls',()=>{
    const token='a'.repeat(32);
    const root=body=>`<div data-fdo-ui-id="run" data-fdo-component="fdo.async-action-button" data-fdo-component-version="1.0.0">${body}</div><pre data-fdo-ui-id="result">Original</pre>`;
    const action={kind:'backend-request',id:'run',targetId:'result',text:'Request',sdkAsync:true};
    const component={id:'run',identity:'fdo.async-action-button',states:['idle','pending','success']};
    const source=(body,components=[component])=>new DOMParser().parseFromString(previewDocument(root(body),{token,elementIds:['run','result'],sdkComponents:components,localActions:[action]}),'text/html').querySelector('script').textContent;
    expect(source('<button data-fdo-action="run">Run</button>')).toContain('"kind":"backend-request"');
    expect(source('<button data-fdo-action="run">Run</button>',[])).toContain('const localActions = [];');
    expect(source('<button data-fdo-action="run" disabled>Run</button>')).toContain('const localActions = [];');
    expect(source('<div data-fdo-component="fdo.async-action-button"><button data-fdo-action="run">Nested</button></div>')).toContain('const localActions = [];');
});
