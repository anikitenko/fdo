import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import CredentialsPanel from '../../src/components/settings/panels/CredentialsPanel';
let api, data;
beforeEach(() => {
    localStorage.removeItem('credentialsSSH.selectedPlugin');
    data = {success: true, available: true, gitProfileMode: false, entries: [{key: 'work-key', updatedAt: '2026-10-17T00:00:00Z'}], profiles: []};
    api = {fetchHostKey: jest.fn(async (id, host, port) => ({success: true, candidate: {host, port, keyType: 'ssh-ed25519', fingerprint: 'SHA256:' + 'B'.repeat(42) + 'A'}})), state: jest.fn(async () => data), saveProfile: jest.fn(async (id, profile) => {data = {...data, profiles: [profile]}; return {success: true};}), setGitEnabled: jest.fn(), saveSecret: jest.fn(), deleteSecret: jest.fn(), deleteProfile: jest.fn()};
    window.electron.credentialSettings = api;
    window.electron.plugin.getAll = jest.fn(async () => [{id: 'plugin', metadata: {name: 'Example plugin'}}]);
});
async function choosePlugin() {
    render(<CredentialsPanel/>);
    await screen.findByRole('option', {name: 'Example plugin'});
    fireEvent.change(screen.getByLabelText('Plugin'), {target: {value: 'plugin'}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'New SSH profile'})).toBeEnabled());
}
test('unrestricted command access is opt-in, survives editing, and can return to the saved exact allowlist', async () => {
    data.profiles = [{id:'work',label:'Work',host:'server.example',port:22,username:'user',trustedHostKey:'SHA256:' + 'A'.repeat(43),
        authentication:{type:'password',passwordRef:{kind:'secret',key:'work-key'}}, policy:{consumers:['ssh.exec'],commands:['uptime']}}];
    await choosePlugin(); fireEvent.click(screen.getByRole('button', {name:'Edit SSH profile Work'}));
    let dialog = await screen.findByRole('dialog', {name:'Edit SSH profile'});
    const all = within(dialog).getByLabelText('Allow all shell commands (dangerous)');
    expect(all).not.toBeChecked(); fireEvent.click(all);
    expect(within(dialog).getByLabelText('Allowed commands (one exact shell command per line)')).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', {name:'Save SSH profile'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.saveProfile).toHaveBeenLastCalledWith('plugin',expect.objectContaining({policy:expect.objectContaining({allowAllCommands:true,commands:['uptime']})}),true);
    expect(screen.getByText('All shell commands')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'Edit SSH profile Work'}));
    dialog = await screen.findByRole('dialog', {name:'Edit SSH profile'});
    expect(within(dialog).getByLabelText('Allow all shell commands (dangerous)')).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText('Allow all shell commands (dangerous)'));
    expect(within(dialog).getByLabelText('Allowed commands (one exact shell command per line)')).toBeEnabled();
    expect(within(dialog).getByLabelText('Allowed commands (one exact shell command per line)')).toHaveValue('uptime');
    fireEvent.click(within(dialog).getByRole('button', {name:'Save SSH profile'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.saveProfile.mock.calls.at(-1)[1].policy.allowAllCommands).toBeUndefined();
});
test('starts with an empty state and opens an explicit profile editor with Save and Cancel', async () => {
    await choosePlugin();
    expect(screen.getByText('No SSH profiles yet')).toBeVisible();
    expect(screen.queryByLabelText('Profile ID')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'New SSH profile'}));
    const dialog = await screen.findByRole('dialog', {name: 'New SSH profile'});
    expect(within(dialog).getByRole('button', {name: 'Save SSH profile'})).toBeVisible();
    expect(within(dialog).getByRole('button', {name: 'Save SSH profile'})).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save SSH profile'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Profile ID');
    expect(within(dialog).getByLabelText('Profile ID')).toHaveFocus();
    expect(api.saveProfile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.saveProfile).not.toHaveBeenCalled();
});
test('keeps save failures in the dialog, then closes on success and shows a profile card', async () => {
    await choosePlugin(); fireEvent.click(screen.getByRole('button', {name: 'New SSH profile'}));
    const dialog = await screen.findByRole('dialog', {name: 'New SSH profile'});
    for (const [label, value] of [['Profile ID', 'work'], ['Display name', 'Work server'], ['Hostname or IP address', 'server.example'], ['SSH username', 'git']]) fireEvent.change(within(dialog).getByLabelText(label), {target: {value}});
    fireEvent.change(within(dialog).getByLabelText('Trusted host-key fingerprint'), {target: {value: 'SHA256:' + 'A'.repeat(43)}});
    fireEvent.change(within(dialog).getByLabelText('Credential reference'), {target: {value: 'work-key'}});
    fireEvent.click(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel'));
    api.saveProfile.mockResolvedValueOnce({success: false, code: 'INVALID_REQUEST'});
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save SSH profile'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Check the names');
    expect(within(dialog).getByLabelText('Display name')).toHaveValue('Work server');
    await waitFor(() => expect(within(dialog).getByRole('button', {name: 'Save SSH profile'})).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save SSH profile'}));
    expect(await screen.findByRole('list', {name: 'SSH profiles'})).toHaveTextContent('Work server');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', {name: 'Edit SSH profile Work server'}));
    expect(await screen.findByRole('dialog', {name: 'Edit SSH profile'})).toBeVisible();
    expect(screen.getByLabelText('Profile ID')).toBeDisabled();
    expect(screen.getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel')).toBeChecked();
});

test('closes after a successful write without making a second list read a prerequisite', async () => {
    await choosePlugin(); fireEvent.click(screen.getByRole('button', {name: 'New SSH profile'}));
    const dialog = await screen.findByRole('dialog', {name: 'New SSH profile'});
    for (const [label, value] of [['Profile ID', ' work '], ['Display name', 'Work server'], ['Hostname or IP address', ' server.example '], ['SSH username', 'git'], ['Credential reference', 'work-key'], ['Trusted host-key fingerprint', '256 SHA256:' + 'A'.repeat(43) + ' git@server (ED25519)']]) fireEvent.change(within(dialog).getByLabelText(label), {target: {value}});
    fireEvent.click(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel'));
    api.state.mockRejectedValue(new Error('Refresh is unavailable'));
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save SSH profile'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('list', {name: 'SSH profiles'})).toHaveTextContent('Work server');
    expect(api.saveProfile).toHaveBeenCalledWith('plugin', expect.objectContaining({id: 'work', host: 'server.example', trustedHostKey: 'SHA256:' + 'A'.repeat(43)}), true);
    expect(api.state).toHaveBeenCalledTimes(1);
});

test('server field errors remain visible next to Save and focus the affected field', async () => {
    await choosePlugin(); fireEvent.click(screen.getByRole('button', {name: 'New SSH profile'}));
    const dialog = await screen.findByRole('dialog', {name: 'New SSH profile'});
    for (const [label, value] of [['Profile ID', 'work'], ['Display name', 'Work server'], ['Hostname or IP address', 'server.example'], ['SSH username', 'git'], ['Credential reference', 'work-key'], ['Trusted host-key fingerprint', 'SHA256:' + 'A'.repeat(43)]]) fireEvent.change(within(dialog).getByLabelText(label), {target: {value}});
    fireEvent.click(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel'));
    api.saveProfile.mockResolvedValueOnce({success: false, code: 'INVALID_REQUEST', fieldErrors: {credential: 'The selected credential no longer exists.'}});
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save SSH profile'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The selected credential no longer exists');
    await waitFor(() => expect(within(dialog).getByLabelText('Credential reference')).toHaveFocus());
    expect(within(dialog).getByLabelText('Display name')).toHaveValue('Work server');
});


test('fetching presents an unverified candidate without replacing the pin or confirming trust', async () => {
    await choosePlugin(); fireEvent.click(screen.getByRole('button', {name: 'New SSH profile'}));
    const dialog = await screen.findByRole('dialog', {name: 'New SSH profile'});
    fireEvent.change(within(dialog).getByLabelText('Hostname or IP address'), {target: {value: 'server.example'}});
    fireEvent.change(within(dialog).getByLabelText('Trusted host-key fingerprint'), {target: {value: 'SHA256:' + 'A'.repeat(43)}});
    fireEvent.click(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel'));
    fireEvent.click(within(dialog).getByRole('button', {name: 'Fetch host key'}));
    expect(await within(dialog).findByText('Fetched host key — not verified')).toBeVisible();
    expect(within(dialog).getByLabelText('Trusted host-key fingerprint')).toHaveValue('SHA256:' + 'A'.repeat(43));
    expect(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel')).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Use this fingerprint'}));
    expect(within(dialog).getByLabelText('Trusted host-key fingerprint')).toHaveValue('SHA256:' + 'B'.repeat(42) + 'A');
    expect(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel')).not.toBeChecked();
    expect(api.saveProfile).not.toHaveBeenCalled();
});

test('restores the last selected installed plugin after remount and forgets uninstalled selections', async () => {
    const view = render(<CredentialsPanel/>);
    await screen.findByRole('option', {name: 'Example plugin'});
    fireEvent.change(screen.getByLabelText('Plugin'), {target: {value: 'plugin'}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'New SSH profile'})).toBeEnabled());
    view.unmount();
    const reopened = render(<CredentialsPanel/>);
    await waitFor(() => expect(screen.getByLabelText('Plugin')).toHaveValue('plugin'));
    reopened.unmount(); api.state.mockClear();
    window.electron.plugin.getAll.mockResolvedValue([]);
    render(<CredentialsPanel/>);
    await screen.findByText('Choose a plugin');
    await waitFor(() => expect(localStorage.getItem('credentialsSSH.selectedPlugin')).toBeNull());
    expect(api.state).not.toHaveBeenCalled();
});

test.each([
    ['Hostname or IP address', 'other.example'],
    ['Port', '2222'],
    ['Trusted host-key fingerprint', 'SHA256:' + 'B'.repeat(42) + 'A'],
])('preserves saved trust for policy edits but clears it when changing %s', async (label, value) => {
    data.profiles = [{id: 'work', label: 'Work', host: 'server.example', port: 22, username: 'git', trustedHostKey: 'SHA256:' + 'A'.repeat(43), authentication: {type: 'privateKey', privateKeyRef: {kind: 'secret', key: 'work-key'}}, policy: {consumers: ['ssh.exec'], commands: ['uptime']}}];
    await choosePlugin(); fireEvent.click(screen.getByRole('button', {name: 'Edit SSH profile Work'}));
    const dialog = await screen.findByRole('dialog', {name: 'Edit SSH profile'});
    const checkbox = within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel');
    expect(checkbox).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText('Display name'), {target: {value: 'Updated work'}});
    fireEvent.change(within(dialog).getByLabelText('Allowed commands (one exact shell command per line)'), {target: {value: 'uptime\nwhoami'}});
    expect(checkbox).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText(label), {target: {value}});
    expect(checkbox).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save SSH profile'}));
    expect(api.saveProfile).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('verified');
});

test('offers a Git setup flow without authorizing credentials, commands or trust automatically', async () => {
    await choosePlugin();
    fireEvent.click(screen.getByRole('button', {name: 'New Git SSH profile'}));
    const dialog = await screen.findByRole('dialog', {name: 'New Git SSH profile'});
    expect(within(dialog).getByLabelText('SSH username')).toHaveValue('git');
    expect(within(dialog).getByLabelText('Authentication', {selector: 'select'})).toHaveValue('privateKey');
    expect(within(dialog).getByLabelText('Authorize Git to consume this profile’s credential references')).not.toBeChecked();
    expect(within(dialog).getByLabelText('Authorize this plugin to use this profile for SSH commands and profile discovery')).not.toBeChecked();
    expect(within(dialog).getByLabelText('I verified this endpoint and host-key fingerprint through a trusted channel')).not.toBeChecked();
    expect(within(dialog).getByText('git@github.com:anikitenko/fdo.git')).toBeVisible();
    expect(within(dialog).getByText('ssh://git@github.com/anikitenko/fdo.git')).toBeVisible();
    expect(within(dialog).queryByText(/SSH command access is off/)).not.toBeInTheDocument();
    expect(api.saveProfile).not.toHaveBeenCalled();
    expect(api.setGitEnabled).not.toHaveBeenCalled();
});

test('shows Git-only repository authorization without prompting users to enable shell access', async () => {
    data.profiles = [{id: 'work', label: 'Work Git', host: 'github.com', port: 22, username: 'git',
        authentication: {type: 'privateKey'}, policy: {consumers: ['git'], commands: [], repositories: [{path: 'anikitenko/fdo.git', operations: ['ls-remote']}]}}];
    await choosePlugin();
    const cards = screen.getByRole('list', {name: 'SSH profiles'});
    expect(within(cards).getByText('Git only')).toBeVisible();
    expect(within(cards).getByText('anikitenko/fdo.git')).toBeVisible();
    expect(cards).toHaveTextContent('Read');
    expect(cards).not.toHaveTextContent('SSH command access off');
    expect(cards).not.toHaveTextContent('enable command access');
});


test('reports timestamped local X11 availability and keeps untrusted consent independent',async()=>{
 api.checkX11=jest.fn(async()=>({success:true,availability:{checkedAt:'2026-10-18T00:00:00Z',trusted:{available:true},untrusted:{available:false,code:'X11_UNSUPPORTED'}}}));
 data.profiles=[{id:'work',label:'Work',host:'server.example',port:22,username:'user',trustedHostKey:'SHA256:'+'A'.repeat(43),authentication:{type:'password',passwordRef:{kind:'secret',key:'work-key'}},policy:{consumers:['ssh.terminal.open'],commands:[],x11Modes:['untrusted']}}];
 await choosePlugin();fireEvent.click(screen.getByRole('button',{name:'Check local X11 support'}));
 expect(await screen.findByText('Untrusted: Unavailable')).toBeVisible();expect(screen.getByText('Trusted: Verified')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Edit SSH profile Work'}));const dialog=await screen.findByRole('dialog',{name:'Edit SSH profile'});
 expect(within(dialog).getByLabelText('Authorize untrusted X11 forwarding (requires verified X SECURITY)')).toBeChecked();
 expect(within(dialog).getByLabelText('Authorize trusted X11 forwarding (dangerous)')).not.toBeChecked();
 fireEvent.click(within(dialog).getByRole('button',{name:'Save SSH profile'}));
 await waitFor(()=>expect(api.saveProfile).toHaveBeenCalledWith('plugin',expect.objectContaining({policy:expect.objectContaining({x11Modes:['untrusted']})}),true));
});
