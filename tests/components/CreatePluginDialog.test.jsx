import React from 'react';
import {fireEvent, render, screen, waitFor, act} from '@testing-library/react';
import {CreatePluginDialog} from '../../src/components/CreatePluginDialog';

beforeEach(() => {
    localStorage.clear();
    window.electron.plugin = {...window.electron.plugin, getAll: jest.fn(async () => ({success: true, plugins: []}))};
    window.electron.system = {...window.electron.system, openEditorWindow: jest.fn()};
});

test('requires a name and passes the selected starter to the real creation bridge', async () => {
    window.electron.system = {...window.electron.system, openEditorWindow: jest.fn()};
    const close = jest.fn();
    const {rerender} = render(<CreatePluginDialog show close={close}/>);
    expect(screen.getByRole('button', {name: 'Open editor · Blank'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: '  Team Tools  '}});
    fireEvent.click(screen.getByRole('button', {name: 'Service monitor template'}));
    expect(screen.getByRole('button', {name: 'Service monitor template'})).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('button', {name: 'Open editor · Service monitor'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Open editor · Service monitor'}));
    await waitFor(() => expect(window.electron.system.openEditorWindow).toHaveBeenCalledWith({name: 'Team Tools', template: 'service'}));
    expect(close).toHaveBeenCalledTimes(1);
    rerender(<CreatePluginDialog show={false} close={close}/>);
    rerender(<CreatePluginDialog show close={close}/>);
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByRole('button', {name: 'Blank template'})).toHaveAttribute('aria-pressed', 'true');
});

test('shows inline format and normalized duplicate errors while typing', async () => {
    window.electron.plugin.getAll.mockResolvedValue({success: true, plugins: [{id: 'team-tools', metadata: {name: 'Team Tools'}}]});
    render(<CreatePluginDialog show close={() => {}}/>);
    const name = screen.getByLabelText('Name');
    fireEvent.change(name, {target: {value: '../bad'}});
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Start with a letter or number');
    fireEvent.change(name, {target: {value: 'TEAM.Tools'}});
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('already uses this name'));
    expect(screen.getByRole('button', {name: 'Open editor · Blank'})).toBeDisabled();
    fireEvent.change(name, {target: {value: 'Fresh Tools'}});
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Name is available'));
    expect(screen.getByRole('status')).toHaveTextContent('Plugin ID: fresh-tools');
    expect(screen.getByRole('button', {name: 'Open editor · Blank'})).toBeEnabled();
});
test('saved workspace cannot be overwritten but can be explicitly resumed', async () => {
    localStorage.setItem('sandbox_saved-tools', 'existing-work');
    render(<CreatePluginDialog show close={() => {}}/>);
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Saved Tools'}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Resume saved workspace'})).toBeEnabled());
    expect(screen.getByRole('button', {name: 'Open editor · Blank'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Resume saved workspace'}));
    await waitFor(() => expect(window.electron.system.openEditorWindow).toHaveBeenCalledWith({name: 'Saved Tools'}));
    expect(localStorage.getItem('sandbox_saved-tools')).toBe('existing-work');
});
test('failed checks are retryable and the submit recheck catches a newly installed collision', async () => {
    window.electron.plugin.getAll.mockRejectedValueOnce(new Error('offline'));
    render(<CreatePluginDialog show close={() => {}}/>);
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'New Tools'}});
    fireEvent.click(await screen.findByRole('button', {name: 'Retry name check'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Open editor · Blank'})).toBeEnabled());
    window.electron.plugin.getAll.mockResolvedValue({success: true, plugins: [{id: 'new-tools'}]});
    fireEvent.click(screen.getByRole('button', {name: 'Open editor · Blank'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Open existing plugin'})).toBeVisible());
    expect(window.electron.system.openEditorWindow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Open existing plugin'}));
    await waitFor(() => expect(window.electron.system.openEditorWindow).toHaveBeenCalledWith({name: 'new-tools'}));
});
test('a late check cannot open an editor after the dialog closes', async () => {
    render(<CreatePluginDialog show close={() => {}}/>);
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'New Tools'}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Open editor · Blank'})).toBeEnabled());
    let finish;
    window.electron.plugin.getAll.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', {name: 'Open editor · Blank'}));
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    await act(async () => finish({success: true, plugins: []}));
    expect(window.electron.system.openEditorWindow).not.toHaveBeenCalled();
});
