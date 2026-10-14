import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import AIExtensionsPanel from '../../src/components/settings/panels/AIExtensionsPanel';
let inventory, api;
const skill = {id: 'skill', name: 'team-review', description: 'Team conventions', content: '---\nname: team-review\ndescription: Team conventions\n---\nUse clear names.', enabled: true, assistantIds: []};
beforeEach(() => {
    inventory = {skills: [skill], assistants: [{id: 'one', name: 'Codex primary', model: 'model-one'}, {id: 'two', name: 'Codex alternate', model: 'model-two'}]};
    api = {getExtensions: jest.fn(async () => inventory), importCodexSkill: jest.fn(async () => inventory),
        updateCodexSkill: jest.fn(async patch => {inventory = {...inventory, skills: [{...skill, ...patch}]}; return inventory;}),
        removeCodexSkill: jest.fn(async () => ({...inventory, skills: []})), on: {updated: jest.fn()}, off: {updated: jest.fn()}};
    window.electron.settings.ai = api;
});
test('assigns a skill to multiple saved model entries and persists enable and remove actions', async () => {
    render(<AIExtensionsPanel onOpenAssistants={jest.fn()}/>);
    const first = await screen.findByLabelText('Codex primary · model-one');
    fireEvent.click(first); fireEvent.click(screen.getByLabelText('Codex alternate · model-two'));
    fireEvent.click(screen.getByRole('button', {name: 'Save assignments'}));
    await waitFor(() => expect(api.updateCodexSkill).toHaveBeenCalledWith({id: 'skill', enabled: true, assistantIds: ['one', 'two']}));
    expect(await screen.findByText('Assignments saved. They take effect on the next request.')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Enable team-review'));
    fireEvent.click(screen.getByRole('button', {name: 'Save assignments'}));
    await waitFor(() => expect(api.updateCodexSkill.mock.lastCall[0].enabled).toBe(false));
    await waitFor(() => expect(screen.getByText('Disabled')).toBeVisible());
    fireEvent.click(screen.getByRole('button', {name: 'Remove skill'}));
    expect(await screen.findByText(/No skills imported yet/)).toBeVisible();
});
test('clearly distinguishes instruction-only skills, remote MCP and unavailable hooks', async () => {
    render(<AIExtensionsPanel onOpenAssistants={jest.fn()}/>);
    expect(await screen.findByText('Instruction-only skills')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', {name: 'MCP Tools'}));
    expect(screen.getByText(/HTTP and command servers/)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', {name: 'Hooks'}));
    expect(screen.getByText('Trusted commands')).toBeVisible();
});
test('import errors are actionable and repeated import clicks do not open multiple dialogs', async () => {
    let reject;
    api.importCodexSkill.mockImplementationOnce(() => new Promise((_resolve, rejectImport) => {reject = rejectImport;}));
    render(<AIExtensionsPanel onOpenAssistants={jest.fn()}/>);
    const button = await screen.findByRole('button', {name: 'Import SKILL.md'});
    fireEvent.click(button); fireEvent.click(button);
    expect(api.importCodexSkill).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('SKILL.md needs YAML front matter.')));
    expect(screen.getByRole('alert')).toHaveTextContent('SKILL.md needs YAML front matter.');
    expect(button).toBeEnabled();
});
test('assistant removal refreshes assignment choices and cleans up its listener', async () => {
    const {unmount} = render(<AIExtensionsPanel onOpenAssistants={jest.fn()}/>);
    await screen.findByLabelText('Codex alternate · model-two');
    inventory = {...inventory, assistants: [inventory.assistants[0]]};
    const listener = api.on.updated.mock.calls[0][0];
    await act(async () => listener());
    expect(screen.queryByLabelText('Codex alternate · model-two')).toBeNull();
    unmount(); expect(api.off.updated).toHaveBeenCalledWith(listener);
});

test('tests and adds MCP servers, enables only selected tools and assistants, retests and removes', async () => {
    const server = {id: 'mcp', name: 'Docs', url: 'https://docs.example.com/mcp', hasBearerToken: true, checkedAt: '2026-10-13T00:00:00Z', enabled: false, assistantIds: [], enabledTools: [], tools: [{name: 'search_docs', description: 'Find documentation'}]};
    api.checkCodexMcp = jest.fn(async () => ({...inventory, mcpServers: [server]}));
    api.updateCodexMcp = jest.fn(async patch => ({...inventory, mcpServers: [{...server, ...patch}]}));
    api.removeCodexMcp = jest.fn(async () => ({...inventory, mcpServers: []}));
    render(<AIExtensionsPanel onOpenAssistants={jest.fn()}/>);
    await screen.findByText('Instruction-only skills');
    fireEvent.click(screen.getByRole('tab', {name: 'MCP Tools'}));
    fireEvent.change(screen.getByLabelText('Server name'), {target: {value: 'Docs'}});
    fireEvent.change(screen.getByLabelText('MCP endpoint'), {target: {value: server.url}});
    fireEvent.change(screen.getByLabelText('Bearer token (optional)'), {target: {value: 'fixture-secret'}});
    fireEvent.click(screen.getByRole('button', {name: 'Test and add server'}));
    expect(await screen.findByText(/MCP connection succeeded/)).toBeVisible();
    expect(api.checkCodexMcp).toHaveBeenCalledWith(expect.objectContaining({name: 'Docs', url: server.url, bearerToken: 'fixture-secret', transport: 'http', authMode: 'bearer'}));
    expect(screen.getByLabelText('Bearer token (optional)')).toHaveValue('');
    fireEvent.click(screen.getByLabelText('Enable Docs'));
    fireEvent.click(screen.getByRole('button', {name: 'Tools and settings for Docs'}));
    fireEvent.click(screen.getByLabelText('search_docs'));
    fireEvent.click(screen.getByLabelText('Codex primary · model-one'));
    fireEvent.click(screen.getByRole('button', {name: 'Save MCP permissions'}));
    await waitFor(() => expect(api.updateCodexMcp).toHaveBeenCalledWith({id: 'mcp', enabled: true, enabledTools: ['search_docs'], assistantIds: ['one']}));
    expect(await screen.findByText('1 tools enabled')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Check connection'}));
    expect(await screen.findByText(/Connection checked: Docs/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Remove server'}));
    expect(await screen.findByText('No MCP servers connected yet')).toBeVisible();
});

test('command form sends literal arguments and environment without HTTP credentials', async () => {
    api.checkCodexMcp = jest.fn(async () => ({...inventory, mcpServers: []}));
    render(<AIExtensionsPanel/>); await screen.findByText('Instruction-only skills');
    fireEvent.click(screen.getByRole('tab', {name: 'MCP Tools'}));
    fireEvent.change(screen.getByLabelText('Transport'), {target: {value: 'stdio'}});
    fireEvent.change(screen.getByLabelText('Server name'), {target: {value: 'Local'}});
    fireEvent.change(screen.getByLabelText('Installed command or executable path'), {target: {value: 'node'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add argument'}));
    fireEvent.change(screen.getByLabelText('Argument 1'), {target: {value: '/path with spaces/server.js'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add argument'}));
    fireEvent.change(screen.getByLabelText('Argument 2'), {target: {value: '--flag'}});
    fireEvent.click(screen.getByRole('button', {name: 'Move argument 2 up'}));
    fireEvent.click(screen.getByRole('button', {name: 'Add environment variable'}));
    fireEvent.change(screen.getByLabelText('Environment variable name 1'), {target: {value: 'SERVICE_TOKEN'}});
    fireEvent.change(screen.getByLabelText('Environment variable value 1'), {target: {value: 'secret'}});
    fireEvent.click(screen.getByRole('button', {name: 'Test and add server'}));
    await waitFor(() => expect(api.checkCodexMcp).toHaveBeenCalledWith(expect.objectContaining({transport: 'stdio', command: 'node', args: ['--flag', '/path with spaces/server.js'], environment: {SERVICE_TOKEN: 'secret'}, url: '', bearerToken: '', authMode: 'none'})));
});

test('OAuth form saves a draft and opens sign-in before discovery', async () => {
    api.checkCodexMcp = jest.fn(async () => ({...inventory, mcpServers: [{id:'oauth',name:'Private'}]}));
    api.signInMcp = jest.fn(async () => ({...inventory,mcpServers:[]}));
    render(<AIExtensionsPanel/>); await screen.findByText('Instruction-only skills');
    fireEvent.click(screen.getByRole('tab', {name: 'MCP Tools'}));
    fireEvent.change(screen.getByLabelText('Authentication'), {target: {value: 'oauth'}});
    fireEvent.change(screen.getByLabelText('Server name'), {target: {value: 'Private'}});
    fireEvent.change(screen.getByLabelText('MCP endpoint'), {target: {value: 'https://private.example/mcp'}});
    fireEvent.change(screen.getByLabelText('OAuth client ID (optional)'), {target: {value: 'public-client'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add server and sign in'}));
    await waitFor(() => expect(api.signInMcp).toHaveBeenCalledWith('oauth'));
    expect(api.checkCodexMcp).toHaveBeenCalledWith(expect.objectContaining({authMode:'oauth',oauthClientId:'public-client',bearerToken:''}));
});


test('header rows reject duplicates without losing input and preserve literal string values', async () => {
    api.checkCodexMcp=jest.fn(async()=>({...inventory,mcpServers:[]}));
    render(<AIExtensionsPanel/>);await screen.findByText('Instruction-only skills');
    fireEvent.click(screen.getByRole('tab',{name:'MCP Tools'}));
    fireEvent.change(screen.getByLabelText('Server name'),{target:{value:'Headers'}});
    fireEvent.change(screen.getByLabelText('MCP endpoint'),{target:{value:'https://example.com/mcp'}});
    fireEvent.click(screen.getByRole('button',{name:'Add header'}));
    fireEvent.change(screen.getByLabelText('Header name 1'),{target:{value:' X-Team '}});
    fireEvent.change(screen.getByLabelText('Header value 1'),{target:{value:'literal "quoted" $TOKEN true'}});
    expect(screen.getByLabelText('Header value 1')).toHaveAttribute('type','password');
    fireEvent.click(screen.getByRole('button',{name:'Show header values'}));
    expect(screen.getByLabelText('Header value 1')).toHaveAttribute('type','text');
    fireEvent.click(screen.getByRole('button',{name:'Add header'}));
    fireEvent.change(screen.getByLabelText('Header name 2'),{target:{value:'x-team'}});
    fireEvent.click(screen.getByRole('button',{name:'Test and add server'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('is repeated');
    expect(api.checkCodexMcp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Remove header 2'}));
    fireEvent.click(screen.getByRole('button',{name:'Test and add server'}));
    await waitFor(()=>expect(api.checkCodexMcp).toHaveBeenCalledWith(expect.objectContaining({headers:{'X-Team':'literal "quoted" $TOKEN true'}})));
});

test('adds a disabled hook using literal argument rows and assigns several Codex models',async()=>{
    let added;
    api.addCodexHook=jest.fn(async config=>{added={...config,id:'hook',enabled:false,assistantIds:[],environmentKeys:[]};return {...inventory,hooks:[added]};});
    api.updateCodexHook=jest.fn(async patch=>({...inventory,hooks:[{...added,...patch}]}));
    render(<AIExtensionsPanel/>);await screen.findByText('Instruction-only skills');fireEvent.click(screen.getByRole('tab',{name:'Hooks'}));
    fireEvent.change(screen.getByLabelText('Hook name'),{target:{value:'Team context'}});
    fireEvent.change(screen.getByLabelText('Installed hook command or executable path'),{target:{value:'node'}});
    fireEvent.click(screen.getByRole('button',{name:'Add argument'}));fireEvent.change(screen.getByLabelText('Argument 1'),{target:{value:'/path with spaces/hook.js'}});
    fireEvent.click(screen.getByRole('button',{name:'Add hook'}));
    await waitFor(()=>expect(api.addCodexHook).toHaveBeenCalledWith(expect.objectContaining({event:'UserPromptSubmit',command:'node',args:['/path with spaces/hook.js'],timeoutSeconds:10})));
    fireEvent.click(screen.getByRole('button',{name:'Hook settings for Team context'}));
    fireEvent.click(screen.getByLabelText('Codex primary · model-one'));fireEvent.click(screen.getByLabelText('Codex alternate · model-two'));
    fireEvent.click(screen.getByLabelText('Enable Team context'));fireEvent.click(screen.getByRole('button',{name:'Save hook assignments'}));
    await waitFor(()=>expect(api.updateCodexHook).toHaveBeenCalledWith({id:'hook',enabled:true,assistantIds:['one','two']}));
});
