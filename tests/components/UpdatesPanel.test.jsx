import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {UpdatesPanel} from '../../src/components/settings/panels/UpdatesPanel';

const availableUpdate = {
    success: true, currentVersion: '1.0.0', latestVersion: '1.1.0', hasUpdate: true,
    channel: 'stable', platform: 'mac-arm64', releaseName: 'FDO 1.1.0',
    releaseNotes: '## Improvements\n\nA useful update.',
    releaseUrl: 'https://github.com/anikitenko/fdo/releases/tag/v1.1.0',
    downloads: [{name: 'fdo-1.1.0-mac-arm64.dmg', url: 'https://github.com/anikitenko/fdo/releases/download/v1.1.0/fdo-1.1.0-mac-arm64.dmg'}],
};

let updatesApi;
beforeEach(() => {
    updatesApi = {
        getPreferences: jest.fn().mockResolvedValue({autoCheck: false, channel: 'stable'}),
        savePreferences: jest.fn().mockResolvedValue({success: true}),
        check: jest.fn().mockResolvedValue(availableUpdate),
    };
    window.electron = {settings: {updates: updatesApi}, system: {openExternal: jest.fn()}};
});

test('shows release notes and opens the matching platform installer', async () => {
    render(<UpdatesPanel/>);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Check for Updates'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Check for Updates'}));
    expect(await screen.findByText('Version 1.1.0 is available')).toBeVisible();
    expect(screen.getByRole('heading', {name: 'Release Notes'})).toBeVisible();
    expect(screen.getByText('A useful update.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Download for mac-arm64'}));
    expect(window.electron.system.openExternal).toHaveBeenCalledWith(availableUpdate.downloads[0].url);
});

test('persists the selected release channel and uses it for a manual check', async () => {
    render(<UpdatesPanel/>);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'prerelease'}});
    await waitFor(() => expect(updatesApi.savePreferences).toHaveBeenCalledWith({autoCheck: false, channel: 'prerelease'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Check for Updates'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Check for Updates'}));
    await waitFor(() => expect(updatesApi.check).toHaveBeenCalledWith('prerelease'));
});

test('checks automatically when enabled and the Updates page opens', async () => {
    updatesApi.getPreferences.mockResolvedValue({autoCheck: true, channel: 'prerelease'});
    render(<UpdatesPanel/>);
    await waitFor(() => expect(updatesApi.check).toHaveBeenCalledWith('prerelease'));
});

test('the app menu request opens the page and starts a check even when automatic checks are off', async () => {
    render(<UpdatesPanel checkOnOpen checkRequestId={42}/>);
    await waitFor(() => expect(updatesApi.check).toHaveBeenCalledWith('stable'));
});
