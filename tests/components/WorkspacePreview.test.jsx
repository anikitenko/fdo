import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {WorkspacePreview} from '../../src/components/live-ui/WorkspacePreview';

let update;
const state = revision => ({name: 'Test workspace', workspaceId: 'test', snapshot: 'blue', revision});
beforeEach(() => {
    window.electron.liveUi = {
        subscribe: jest.fn(callback => {update = callback; return jest.fn();}),
        read: jest.fn(async () => state('revision-a')),
        preview: jest.fn(async (_session, revision) => ({status: 'ready', html: `<main>${revision}</main>`, revision})),
        focusIde: jest.fn(async () => ({success: true})),
        discardDraft: jest.fn(async () => ({status: 'discarded'})),
        restoreDraft: jest.fn(),
        editWithAi: jest.fn(async () => ({success: true})),
    };
    window.electron.system.getFdoSdkDomMetadata = jest.fn(async () => ({success: true, metadata: [], sdkVersion: '1.5.2'}));
});

test('a slow preview from an old revision cannot replace the current preview', async () => {
    let oldPreview;
    window.electron.liveUi.preview.mockImplementationOnce(() => new Promise(resolve => {oldPreview = resolve;}));
    const {unmount} = render(<WorkspacePreview sessionId="session"/>);
    await waitFor(() => expect(window.electron.liveUi.preview).toHaveBeenCalledTimes(1));
    act(() => update(state('revision-b')));
    await waitFor(() => expect(screen.getByTitle('Plugin UI preview').srcdoc).toContain('revision-b'));
    await act(async () => oldPreview({status: 'ready', html: '<main>stale</main>', revision: 'revision-a'}));
    expect(screen.getByTitle('Plugin UI preview').srcdoc).not.toContain('stale');
    window.electron.liveUi.preview.mockImplementationOnce(() => new Promise(() => {}));
    act(() => update(state('revision-c')));
    await waitFor(() => expect(window.electron.liveUi.preview).toHaveBeenCalledTimes(3));
    act(() => update({...state('revision-c'), disconnected: true}));
    expect(screen.getByText('IDE disconnected')).toBeVisible();
    expect(screen.getByTitle('Plugin UI preview').srcdoc).toContain('revision-b');
    expect(screen.getByRole('button', {name: 'Refresh preview'})).toBeDisabled();
    const unsubscribe = window.electron.liveUi.subscribe.mock.results[0].value;
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
});

test('SDK metadata errors have an explicit retry without blocking source preview', async () => {
    window.electron.system.getFdoSdkDomMetadata.mockResolvedValueOnce({success: false, error: 'SDK unavailable'});
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByText('SDK catalog'));
    expect(await screen.findByText('SDK metadata unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Retry metadata'}));
    expect(await screen.findByText('No SDK helpers available')).toBeVisible();
    expect(await screen.findByTitle('Plugin UI preview')).toBeVisible();
});

const mappedPreview = (revision = 'revision-a', text = 'Inspect JSON') => ({status: 'ready', revision, html: '<button data-fdo-ui-id="element-1">' + text + '</button>', elements: [{id: 'element-1', tag: 'button', label: 'button · ' + text, location: {path: '/render.tsx', line: 4, column: 5, endLine: 4, endColumn: 70}, text: {value: text}, styles: []}]});

test('hands the selected committed element to AI and reports stale selection errors', async () => {
    window.electron.liveUi.preview.mockResolvedValue(mappedPreview());
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.click(screen.getByRole('button', {name: 'Edit with AI'}));
    expect(window.electron.liveUi.editWithAi).toHaveBeenCalledWith('session', 'revision-a', 'element-1');
    window.electron.liveUi.editWithAi.mockRejectedValueOnce(new Error('Refresh this selection before editing with AI.'));
    fireEvent.click(screen.getByRole('button', {name: 'Edit with AI'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh this selection');
});

test('a visual draft must be applied or discarded before AI handoff', async () => {
    window.electron.liveUi.preview.mockResolvedValue(mappedPreview());
    window.electron.liveUi.propose = jest.fn(async () => ({status: 'ready', id: 'draft', revision: 'revision-a', selectedId: 'element-1',
        preview: mappedPreview('revision-a', 'Draft label'), patches: [{file: '/render.tsx', removed: 'Inspect JSON', added: 'Draft label'}]}));
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.change(screen.getByLabelText('Text'), {target: {value: 'Draft label'}});
    fireEvent.click(screen.getByRole('button', {name: 'Preview change'}));
    await screen.findByLabelText('Source diff');
    expect(screen.getByRole('button', {name: 'Edit with AI'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Edit with AI'})).toHaveAttribute('title', 'Apply or discard the draft before editing with AI');
    expect(window.electron.liveUi.editWithAi).not.toHaveBeenCalled();
});

test('saved drafts need explicit restore and expose recovered history without applying', async () => {
    window.electron.liveUi.read.mockResolvedValue({...state('revision-a'), recovery: {status: 'available', message: 'Saved changes are available.'}});
    window.electron.liveUi.preview.mockResolvedValue(mappedPreview());
    window.electron.liveUi.restoreDraft.mockResolvedValue({status: 'ready', id: 'restored', revision: 'revision-a', canUndo: true, canRedo: true,
        patches: [{file: '/render.tsx', removed: 'old', added: 'new'}], changedFileCount: 1, preview: mappedPreview('revision-a', 'Recovered'), durability: {saved: true}});
    render(<WorkspacePreview sessionId="session"/>);
    expect(await screen.findByText('Saved visual draft found')).toBeVisible();
    expect(window.electron.liveUi.restoreDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Restore visual draft'}));
    expect(await screen.findByLabelText('Source diff')).toHaveTextContent('new');
    expect(screen.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Redo', exact: true})).toBeEnabled();
    expect(screen.queryByText('Saved visual draft found')).not.toBeInTheDocument();
});

test('incompatible recovery cannot restore, and failed discard keeps the warning visible', async () => {
    window.electron.liveUi.read.mockResolvedValue({...state('revision-a'), recovery: {status: 'conflict', message: 'The SDK changed.'}});
    window.electron.liveUi.discardDraft.mockRejectedValueOnce(new Error('Could not delete saved draft'));
    render(<WorkspacePreview sessionId="session"/>);
    expect(await screen.findByRole('button', {name: 'Restore visual draft'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Discard saved draft'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete saved draft');
    expect(screen.getByText('Saved draft needs attention')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Discard saved draft'}));
    await waitFor(() => expect(screen.queryByText('Saved draft needs attention')).not.toBeInTheDocument());
});

test('simulation waits for the current isolated frame bridge and rejects forged readiness', async () => {
    const result = mappedPreview();
    result.elements[0].localActionSimulation = {kind: 'local', targetId: 'result', text: 'Preview text'};
    window.electron.liveUi.preview.mockResolvedValue(result);
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    const frame = screen.getByTitle('Plugin UI preview');
    const token = /nonce-([a-f0-9]{32})/.exec(frame.srcdoc)[1];
    const run = screen.getByRole('button', {name: 'Run local action'});
    expect(run).toBeDisabled();
    act(() => window.dispatchEvent(new MessageEvent('message', {source: window, origin: 'null', data: {type: 'fdo-ui-ready', token}})));
    act(() => window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, origin: 'null', data: {type: 'fdo-ui-ready', token: 'old'}})));
    expect(run).toBeDisabled();
    act(() => window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, origin: 'null', data: {type: 'fdo-ui-ready', token}})));
    expect(run).toBeEnabled();
});

test('a late edit response preserves a newer explicit selection using the host source map', async () => {
    const result = mappedPreview();
    Object.assign(result.elements[0].text, {file: '/render.tsx', start: 10});
    result.html = '<main data-fdo-ui-id="main">' + result.html + '</main>';
    result.elements.push({id: 'main', tag: 'main', label: 'main', location: result.elements[0].location, styles: []});
    window.electron.liveUi.preview.mockResolvedValue(result);
    let complete;
    window.electron.liveUi.propose = jest.fn(() => new Promise(resolve => {complete = resolve;}));
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    const frame = screen.getByTitle('Plugin UI preview');
    const token = /nonce-([a-f0-9]{32})/.exec(frame.srcdoc)[1];
    fireEvent.change(screen.getByLabelText('Text', {exact: true}), {target: {value: 'Edited'}});
    act(() => {
        fireEvent.click(screen.getByRole('button', {name: 'Preview change'}));
        // The selection event was dispatched before React committed its busy
        // state. The in-flight response must not override that newer intent.
        window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, origin: 'null', data: {type: 'fdo-ui-select', token, id: 'main'}}));
    });
    await act(async () => complete({status: 'ready', id: 'draft', revision: 'revision-a', selectedId: 'element-1',
        selectionMap: {main: 'main'}, patches: [], preview: result}));
    expect(screen.getByRole('button', {name: 'main', exact: true})).toHaveClass('bp6-active');
    expect(screen.getByRole('button', {name: 'button · Inspect JSON'})).not.toHaveClass('bp6-active');
});

test('custom dialog roots use explicit overlay controls and explain visibility-only behavior', async () => {
    const result = mappedPreview();
    result.html = '<div role="dialog" hidden data-fdo-ui-id="element-1">Inspect JSON</div>';
    result.elements[0].tag = 'div'; result.elements[0].label = 'div · custom';
    window.electron.liveUi.preview.mockResolvedValue(result);
    render(<WorkspacePreview sessionId="session"/>);
    const select = await screen.findByLabelText('Overlay preview');
    expect(screen.getByRole('option', {name: /Custom dialog/})).toBeInTheDocument();
    fireEvent.change(select, {target: {value: 'element-1'}});
    expect(screen.getByText(/authored positioning is retained/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Close overlay preview'}));
    expect(select).toHaveValue('');
});

test('dialog controls reveal selected children and synchronize authenticated Escape notifications without draft operations', async () => {
    const location = {path: '/render.tsx', line: 4, column: 5, endLine: 4, endColumn: 70};
    window.electron.liveUi.propose = jest.fn();
    window.electron.liveUi.preview.mockResolvedValue({status: 'ready', revision: 'revision-a',
        html: '<main data-fdo-ui-id="main"><dialog data-fdo-ui-id="modal"><h2 data-fdo-ui-id="title">Dialog title</h2></dialog></main>',
        elements: [{id: 'main', tag: 'main', label: 'main', location, styles: []},
            {id: 'modal', tag: 'dialog', label: 'dialog', location, styles: []},
            {id: 'title', tag: 'h2', label: 'h2 · Dialog title', text: {value: 'Dialog title', file: '/render.tsx', start: 40}, location, styles: []}]});
    render(<WorkspacePreview sessionId="session"/>);
    const frame = await screen.findByTitle('Plugin UI preview');
    const token = /nonce-([a-f0-9]{32})/.exec(frame.srcdoc)[1];
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', {name: 'h2 · Dialog title'}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('modal');
    const notify = extras => window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, origin: 'null',
        data: {type: 'fdo-ui-dialog-closed', token, id: 'modal'}, ...extras}));
    act(() => notify({source: window}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('modal');
    act(() => notify({data: {type: 'fdo-ui-dialog-closed', token: 'wrong', id: 'modal'}}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('modal');
    act(() => notify({}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('');
    expect(screen.getByLabelText('Text', {exact: true})).toHaveValue('Dialog title');
    fireEvent.click(screen.getByRole('button', {name: 'h2 · Dialog title'}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('modal');
    fireEvent.click(screen.getByRole('button', {name: 'main', exact: true}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Dialog preview'), {target: {value: 'modal'}});
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('modal');
    fireEvent.click(screen.getByRole('button', {name: 'Close dialog preview'}));
    expect(screen.getByLabelText('Dialog preview')).toHaveValue('');
    expect(window.electron.liveUi.propose).not.toHaveBeenCalled();
});

test('literal edits are reviewed as a draft and stale revisions disable Apply', async () => {
    window.electron.liveUi.preview.mockImplementation(async (_session, revision) => mappedPreview(revision));
    window.electron.liveUi.propose = jest.fn(async () => ({status: 'ready', id: 'draft', revision: 'revision-a', patch: {description: 'Change button text', file: '/render.tsx', affected: 1, removed: '"Inspect JSON"', added: '"Check JSON"'}, preview: mappedPreview('revision-a', 'Check JSON')}));
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.change(screen.getByLabelText('Text', {exact: true}), {target: {value: 'Check JSON'}});
    fireEvent.click(screen.getByRole('button', {name: 'Preview change'}));
    expect(await screen.findByLabelText('Source diff')).toHaveTextContent('Check JSON');
    expect(screen.getByRole('button', {name: 'Apply to workspace'})).toBeEnabled();
    act(() => update(state('revision-b')));
    expect(await screen.findByText('Source changed', {exact: true})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Apply to workspace'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Discard draft'}));
    await waitFor(() => expect(screen.queryByLabelText('Source diff')).not.toBeInTheDocument());
});
test('selection messages require the current opaque iframe, token and mapped element', async () => {
    window.electron.liveUi.preview.mockResolvedValue(mappedPreview());
    render(<WorkspacePreview sessionId="session"/>);
    const iframe = await screen.findByTitle('Plugin UI preview');
    const token = /nonce-([a-f0-9]{32})/.exec(iframe.srcdoc)[1];
    act(() => window.dispatchEvent(new MessageEvent('message', {source: window, origin: 'null', data: {type: 'fdo-ui-select', token, id: 'element-1'}})));
    expect(screen.queryByLabelText('Text', {exact: true})).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new MessageEvent('message', {source: iframe.contentWindow, origin: 'null', data: {type: 'fdo-ui-select', token, id: 'element-1'}})));
    expect(screen.getByLabelText('Text', {exact: true})).toHaveValue('Inspect JSON');
});

test('Blueprint movement hotkeys work outside the list, ignore text inputs and reject untrusted frame messages', async () => {
    const movable = () => {
        const result = mappedPreview();
        result.elements[0].structure = {position: {up: true, down: true, index: 1, count: 3}};
        return result;
    };
    window.electron.liveUi.preview.mockResolvedValue(movable());
    window.electron.liveUi.propose = jest.fn(async () => ({status: 'ready', id: 'draft', revision: 'revision-a',
        preview: movable(), selectedId: 'element-1', editCount: 1, patches: [], canUndo: true}));
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.keyDown(document, {key: 'ArrowDown', code: 'ArrowDown', altKey: true});
    await waitFor(() => expect(window.electron.liveUi.propose).toHaveBeenCalledTimes(1));
    await screen.findByText('No unapplied changes');
    fireEvent.keyDown(screen.getByLabelText('Text', {exact: true}), {key: 'ArrowUp', code: 'ArrowUp', altKey: true});
    expect(window.electron.liveUi.propose).toHaveBeenCalledTimes(1);
    const iframe = screen.getByTitle('Plugin UI preview');
    const token = /nonce-([a-f0-9]{32})/.exec(iframe.srcdoc)[1];
    act(() => window.dispatchEvent(new MessageEvent('message', {source: window, origin: 'null', data: {type: 'fdo-ui-hotkey', token, key: 'ArrowUp'}})));
    act(() => window.dispatchEvent(new MessageEvent('message', {source: iframe.contentWindow, origin: 'null', data: {type: 'fdo-ui-hotkey', token: 'wrong', key: 'ArrowUp'}})));
    expect(window.electron.liveUi.propose).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new MessageEvent('message', {source: iframe.contentWindow, origin: 'null', data: {type: 'fdo-ui-hotkey', token, key: 'ArrowUp'}})));
    await waitFor(() => expect(window.electron.liveUi.propose).toHaveBeenCalledTimes(2));
});

test('CSS scope defaults to the selected element and shared edits require an explicit choice', async () => {
    const result = mappedPreview();
    const style = {file: '/styles.css', key: 'button', selector: '.button', canAddDeclarations: true, presentProperties: ['color'], declarations: [{property: 'color', value: 'red'}], isolationReason: ''};
    result.elements[0].styles = [style];
    result.elements.push({...result.elements[0], id: 'element-2', label: 'button · Other', text: {value: 'Other'}});
    result.html += '<button data-fdo-ui-id="element-2">Other</button>';
    window.electron.liveUi.preview.mockResolvedValue(result);
    window.electron.liveUi.propose = jest.fn(async () => ({status: 'ready', id: 'draft', revision: 'revision-a', preview: result, selectedId: 'element-1', patches: []}));
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.change(screen.getByLabelText('Edit', {exact: true}), {target: {value: 'css'}});
    expect(screen.getByLabelText('Apply CSS to')).toHaveValue('element');
    expect(screen.getByText(/The first change copies this class/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Apply CSS to'), {target: {value: 'shared'}});
    expect(screen.getByText('Editing a shared class')).toBeVisible();
    expect(screen.getByText(/including uses outside this preview/)).toHaveTextContent('2 elements are visible here');
    fireEvent.click(screen.getByRole('button', {name: 'button · Other'}));
    fireEvent.change(screen.getByLabelText('Edit', {exact: true}), {target: {value: 'css'}});
    expect(screen.getByLabelText('Apply CSS to')).toHaveValue('element');
    expect(screen.queryByText('Editing a shared class')).not.toBeInTheDocument();
});

test('class name errors explain the correction, describe the input and clear when fixed', async () => {
    const result = mappedPreview();
    result.elements[0].styleAssignment = {file: '/render.tsx'};
    result.elements[0].styleSheets = [{file: '/styles.css', binding: 'styles'}];
    window.electron.liveUi.preview.mockResolvedValue(result);
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.click(screen.getByText('Create a new class', {exact: true}));
    const input = screen.getByLabelText('New class name', {exact: true});
    fireEvent.change(input, {target: {value: '.button'}});
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('visual-new-style-error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Leave out the leading dot');
    expect(screen.getByRole('button', {name: 'Create and edit class'})).toBeDisabled();
    fireEvent.change(input, {target: {value: 'primary-button'}});
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Create and edit class'})).toBeEnabled();
});

test('an imported read-only base can still expose editable state variants without an empty base picker', async () => {
    const result = mappedPreview();
    result.elements[0].styles = [{file: '/styles.css', key: 'button', selector: '.button', canAddDeclarations: false, presentProperties: [], declarations: [], reason: 'Base rules are imported; edit them in the IDE.',
        states: [{state: 'hover', selector: '.button:hover', canCreateRule: true, canAddDeclarations: true, presentProperties: [], declarations: []}]}];
    window.electron.liveUi.preview.mockResolvedValue(result);
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button', {name: 'button · Inspect JSON'}));
    fireEvent.change(screen.getByLabelText('Edit', {exact: true}), {target: {value: 'css'}});
    expect(screen.getByText('Base rules are imported; edit them in the IDE.')).toBeVisible();
    expect(screen.queryByRole('combobox', {name: 'CSS property'})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('CSS state'), {target: {value: 'hover'}});
    expect(screen.getByRole('combobox', {name: 'CSS property'})).toBeEnabled();
});

test('a selected SDK child offers navigation to its component content without a workspace edit', async () => {
    const location = {path:'/render.tsx',line:4,column:1};
    window.electron.liveUi.preview.mockResolvedValue({status:'ready',revision:'revision-a',html:'<dialog data-fdo-component="fdo.dialog" data-fdo-component-version="1.0.0" data-fdo-ui-id="overlay"><p data-fdo-ui-id="child">Inside</p></dialog>',elements:[
        {id:'overlay',tag:'dialog',label:'Dialog · Settings',location,styles:[],structure:{unique:true},sdkComponent:{name:'Dialog',properties:[],slots:[{name:'body',editable:true,children:[]},{name:'footer',editable:true,children:[]}]}},
        {id:'child',tag:'p',label:'p · Inside',location,styles:[],structure:{unique:true}},
    ]});
    window.electron.liveUi.propose = jest.fn();
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button',{name:'p · Inside',exact:true}));
    expect(screen.queryByLabelText('Component slot')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Edit Dialog content'}));
    expect(screen.getByLabelText('Component slot')).toBeVisible();
    expect(screen.getByText('Dialog content')).toBeVisible();
    expect(window.electron.liveUi.propose).not.toHaveBeenCalled();
});

test('HTML sibling arrangement disables protected positions and submits the chosen position',async()=>{
    const result = mappedPreview();
    result.html = '<main data-fdo-ui-id="main"><button data-fdo-ui-id="element-1">Inspect JSON</button></main>';
    result.elements[0].htmlLiteral = true;
    result.elements[0].structure = {unique:true,position:{parentId:'main',index:1,count:4,allowedIndices:[1,2],up:false,down:true}};
    window.electron.liveUi.preview.mockResolvedValue(result);
    window.electron.liveUi.propose = jest.fn(async()=>({status:'error',message:'No workspace mutation in this fixture'}));
    render(<WorkspacePreview sessionId="session"/>);
    fireEvent.click(await screen.findByRole('button',{name:'button · Inspect JSON',exact:true}));
    const positions = screen.getByLabelText('Position in container');
    expect(positions.options[0]).toBeDisabled(); expect(positions.options[3]).toBeDisabled();
    expect(screen.getByRole('button',{name:'Move up',exact:true})).toBeDisabled();
    fireEvent.change(positions,{target:{value:'2'}});
    await waitFor(()=>expect(window.electron.liveUi.propose).toHaveBeenCalledWith('session',expect.objectContaining({kind:'move',elementId:'element-1',index:2})));
});

test('nested child navigation restores its item and component memory survives source-offset and preview-ID changes',async()=>{
    const result=(revision,suffix='',start=10)=>{
        const location={path:'/render.tsx',line:4,column:1};
        const item=key=>({key,label:key==='one' ? 'General' : 'Advanced',flag:false,labelTarget:{start:1,end:2},flagTarget:{start:3,end:4},removable:false});
        return {status:'ready',revision,html:`<div data-fdo-component="fdo.tabs" data-fdo-ui-id="tabs${suffix}"><div data-fdo-panel="one"><p>General</p></div><div data-fdo-panel="two" hidden><div data-fdo-ui-id="wrapper${suffix}"><p data-fdo-ui-id="child${suffix}">Second body</p></div></div></div>`,elements:[
            {id:'tabs'+suffix,tag:'div',label:'Tabs · Settings',location,styles:[],structure:{unique:true,file:'/render.tsx',start},sdkComponent:{identity:'fdo.tabs',instanceId:'settings',instanceIdLiteral:true,name:'Tabs',properties:[],slots:[],collection:{editable:true,items:[item('one'),item('two')]}}},
            {id:'wrapper'+suffix,tag:'div',label:'div · Wrapper',location,styles:[],structure:{unique:true}},
            {id:'child'+suffix,tag:'p',label:'p · Second body',location,styles:[],structure:{unique:true},text:{value:'Second body',file:'/render.tsx',start:300}},
        ]};
    };
    window.electron.liveUi.preview.mockImplementation(async(_session,revision)=>result(revision,revision==='revision-a' ? '' : '-new',revision==='revision-a' ? 10 : 150));
    window.electron.liveUi.propose=jest.fn();
    render(<WorkspacePreview sessionId="context"/>);
    fireEvent.click(await screen.findByRole('button',{name:'p · Second body',exact:true}));
    expect(screen.getByText('Return to Advanced in Tabs.')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Edit Tabs content'}));
    expect(screen.getByLabelText('Collection item')).toHaveValue('two');
    fireEvent.change(screen.getByLabelText('Collection item'),{target:{value:'one'}});
    fireEvent.click(screen.getByRole('button',{name:'div · Wrapper',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:'Edit Tabs content'}));
    expect(screen.getByLabelText('Collection item')).toHaveValue('two');
    fireEvent.change(screen.getByLabelText('Collection item'),{target:{value:'one'}});
    act(()=>update(state('revision-b')));
    await waitFor(()=>expect(screen.getByTitle('Plugin UI preview').srcdoc).toContain('tabs-new'));
    fireEvent.click(screen.getByRole('button',{name:'Tabs · Settings',exact:true}));
    expect(screen.getByLabelText('Collection item')).toHaveValue('one');
    expect(window.electron.liveUi.propose).not.toHaveBeenCalled();
});
