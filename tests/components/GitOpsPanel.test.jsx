import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import GitOpsPanel from '../../src/components/settings/panels/GitOpsPanel';

const repository = {id: 'one', url: 'https://github.com/acme/tools', authType: 'basic', hasCredentials: true,
    manifestPath: 'plugins.yaml', revisionType: 'branch', targetRevision: 'main', commit: 'a'.repeat(40), verifiedAt: '2026-10-17T12:00:00Z',
    manifest: {metadata: {name: 'tools', displayName: 'Team Tools', version: '1.0.0', maintainers: [{github: 'anikitenko'}]}, spec: {plugins: [{name: 'example', repository: 'https://github.com/acme/example', targetRevision: 'v1.0.0', path: '/'}]}}};
beforeEach(() => {
    window.electron = {system: {openExternal: jest.fn()}, settings: {gitops: {
        list: jest.fn(async () => ({success: true, repositories: []})),
        save: jest.fn(async () => ({success: true, repositories: [repository]})),
        verify: jest.fn(async () => ({success: true, repositories: [repository]})),
        remove: jest.fn(async () => ({success: true, repositories: []})),
        sync: jest.fn(async () => ({success: true, repositories: [repository]})),
        syncPlugin: jest.fn(async () => ({success: true, repositories: [repository]})),
        setInterval: jest.fn(async () => ({success: true, repositories: [{...repository, checkIntervalMinutes: 90}]})),
        setAutoSync: jest.fn(async () => ({success: true, repositories: [{...repository, autoSync: false}]})),
    }}};
});
const open = async () => {
    await waitFor(() => expect(screen.getByRole('button', {name: 'Add Git Repository'})).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', {name: 'Add Git Repository'}));
    await screen.findByLabelText('Repository URL');
};

test('adds a repository with its own credentials, manifest path and release tag', async () => {
    render(<GitOpsPanel/>);
    await open();
    fireEvent.change(screen.getByLabelText('Repository URL'), {target: {value: repository.url}});
    fireEvent.change(screen.getByLabelText('Revision type'), {target: {value: 'tag'}});
    fireEvent.change(screen.getByLabelText('Tag name'), {target: {value: 'v1.0.0'}});
    fireEvent.change(screen.getByLabelText('Manifest path'), {target: {value: 'collections/tools.yaml'}});
    fireEvent.change(screen.getByLabelText('Authentication'), {target: {value: 'basic'}});
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'alice'}});
    fireEvent.change(screen.getByLabelText('Access token / password'), {target: {value: 'token'}});
    expect(screen.getByLabelText('Access token / password')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByText('Verify and save'));
    await waitFor(() => expect(window.electron.settings.gitops.save).toHaveBeenCalledWith(expect.objectContaining({url: repository.url, revisionType: 'tag', targetRevision: 'v1.0.0', manifestPath: 'collections/tools.yaml', username: 'alice', password: 'token'})));
    expect(await screen.findByText('Team Tools')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('Access token / password')).not.toBeInTheDocument());
});

test('keeps the form open and displays verification failures', async () => {
    window.electron.settings.gitops.save.mockResolvedValue({success: false, error: 'kind must be PluginCollection.'});
    render(<GitOpsPanel/>);
    await open();
    fireEvent.change(screen.getByLabelText('Repository URL'), {target: {value: repository.url}});
    fireEvent.click(screen.getByText('Verify and save'));
    expect(await screen.findByText('kind must be PluginCollection.')).toBeInTheDocument();
    expect(screen.getByLabelText('Repository URL')).toHaveValue(repository.url);
});

test('edits without loading secrets into the form and allows removal and re-verification', async () => {
    window.electron.settings.gitops.list.mockResolvedValue({success: true, repositories: [repository]});
    render(<GitOpsPanel/>);
    await screen.findByText('Team Tools');
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByLabelText('Access token / password')).toHaveValue('');
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByLabelText('Repository URL')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Verify repository'));
    await waitFor(() => expect(window.electron.settings.gitops.verify).toHaveBeenCalledWith('one', undefined));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Remove'})).not.toBeDisabled());
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(screen.queryByText('Team Tools')).not.toBeInTheDocument());
});

test('uses Blueprint empty state', async () => {
    const {container} = render(<GitOpsPanel/>);
    await screen.findByRole('heading', {name: 'No Git repositories'});
    expect(container.querySelector('.bp6-non-ideal-state')).toBeInTheDocument();
});

test('links maintainer usernames to real GitHub profiles and uses singular plugin', async () => {
    window.electron.settings.gitops.list.mockResolvedValue({success: true, repositories: [repository]});
    render(<GitOpsPanel/>);
    const link = await screen.findByRole('link', {name: '@anikitenko'});
    expect(link).toHaveAttribute('href', 'https://github.com/anikitenko');
    fireEvent.click(link);
    expect(window.electron.system.openExternal).toHaveBeenCalledWith('https://github.com/anikitenko');
    expect(screen.getByText('1 plugin', {exact: true})).toBeInTheDocument();
    expect(screen.queryByText('1 plugins', {exact: true})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Sync now'}));
    await waitFor(() => expect(window.electron.settings.gitops.sync).toHaveBeenCalledWith('one', undefined));
    await waitFor(() => expect(screen.getByRole('checkbox', {name: 'Automatic synchronization'})).not.toBeDisabled());
    fireEvent.click(screen.getByRole('checkbox', {name: 'Automatic synchronization'}));
    await waitFor(() => expect(window.electron.settings.gitops.setAutoSync).toHaveBeenCalledWith('one', false));
});

test('shows contextual plugin errors in a collapsible list and checks just that plugin', async () => {
    const failed = {...repository, syncError: '1 plugin needs attention.', pluginStatuses: [{name: 'example', state: 'error',
        error: 'The version “v1.0.0” is unavailable. Retry later or contact the collection maintainer.'}]};
    window.electron.settings.gitops.list.mockResolvedValue({success: true, repositories: [failed]});
    render(<GitOpsPanel/>);
    const toggle = await screen.findByRole('button', {name: /Plugins \(1\)/});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', {name: 'Check for updates'})).not.toBeInTheDocument();
    fireEvent.click(toggle);
    const plugin = await screen.findByRole('region', {name: 'Plugin example'});
    expect(within(plugin).getByText(/contact the collection maintainer/)).toBeInTheDocument();
    expect(within(plugin).getByRole('link')).toHaveAttribute('href', 'https://github.com/acme/example');
    fireEvent.click(within(plugin).getByRole('button', {name: 'Check for updates'}));
    await waitFor(() => expect(window.electron.settings.gitops.syncPlugin).toHaveBeenCalledWith('one', 'example'));
});

test('uses the native Blueprint time picker to save an interval duration', async () => {
    window.electron.settings.gitops.list.mockResolvedValue({success: true, repositories: [repository]});
    render(<GitOpsPanel/>);
    const group = await screen.findByRole('group', {name: 'Check interval for Team Tools'});
    const hours = within(group).getByRole('spinbutton', {name: /hours/});
    const minutes = within(group).getByRole('spinbutton', {name: 'minutes'});
    fireEvent.change(hours, {target: {value: '1'}}); fireEvent.blur(hours);
    fireEvent.change(minutes, {target: {value: '30'}}); fireEvent.blur(minutes);
    fireEvent.click(within(group).getByRole('button', {name: 'Save interval'}));
    await waitFor(() => expect(window.electron.settings.gitops.setInterval).toHaveBeenCalledWith('one', 90));
});

test('multiple repositories have independent collapsible summaries', async () => {
    const second = {...repository, id: 'two', url: 'https://github.com/work/tools', manifest: {...repository.manifest,
        metadata: {...repository.manifest.metadata, displayName: 'Work Tools'}}};
    window.electron.settings.gitops.list.mockResolvedValue({success: true, repositories: [repository, second]});
    render(<GitOpsPanel/>);
    const first = await screen.findByRole('button', {name: /Team Tools repository/});
    const work = screen.getByRole('button', {name: /Work Tools repository/});
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(work).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute('aria-expanded', 'true'));
    expect(work).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('button', {name: 'Sync now'})).toHaveLength(1);
});
