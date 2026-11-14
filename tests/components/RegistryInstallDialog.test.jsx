import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import RegistryInstallDialog from '../../src/components/plugin/RegistryInstallDialog';
let receive, unsubscribe;
const status = (phase,revision=1,extra={})=>({id:'release-console',version:'1.0.0',phase,revision,...extra});
beforeEach(()=>{
    unsubscribe=jest.fn();
    window.electron={registryInstall:{getStatus:jest.fn(async()=>({phase:'idle',revision:0})),onProgress:jest.fn(callback=>{receive=callback;return unsubscribe;})}};
});
test('shows an in-progress snapshot when mounted after the link was received',async()=>{
    window.electron.registryInstall.getStatus.mockResolvedValue(status('checking'));
    render(<RegistryInstallDialog/>);
    expect(await screen.findByRole('dialog',{name:'Install plugin'})).toBeInTheDocument();
    expect(screen.getByText('Checking release and publisher…')).toBeInTheDocument();
    expect(screen.getByLabelText('Plugin installation')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Close'})).not.toBeInTheDocument();
});
test('progress events replace the stage, then show a persistent error',async()=>{
    const view=render(<RegistryInstallDialog/>);
    act(()=>receive(status('downloading')));
    expect(screen.getByText('Downloading plugin…')).toBeInTheDocument();
    act(()=>receive(status('error',2,{error:'The signing certificate was revoked.'})));
    expect(screen.getByText('The signing certificate was revoked.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Plugin installation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    view.unmount();expect(unsubscribe).toHaveBeenCalled();
});
test('a delayed initial snapshot cannot overwrite newer progress',async()=>{
    let resolve;
    window.electron.registryInstall.getStatus.mockReturnValue(new Promise(done=>{resolve=done;}));
    render(<RegistryInstallDialog/>);
    act(()=>receive(status('verifying',4)));
    await act(async()=>resolve(status('checking',1)));
    expect(screen.getByText('Verifying signed source…')).toBeInTheDocument();
    expect(screen.queryByText('Checking release and publisher…')).not.toBeInTheDocument();
});
test('success explains inactive installation and a new link reopens the dialog',async()=>{
    render(<RegistryInstallDialog/>);
    act(()=>receive(status('complete')));
    expect(screen.getByText(/Installed inactive/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
    act(()=>receive(status('queued',2)));
    expect(await screen.findByText('Preparing FDO…')).toBeInTheDocument();
});

test('shows the human name instead of an internal plugin ID',async()=>{
    render(<RegistryInstallDialog/>);
    act(()=>receive(status('downloading',1,{name:'Website Availability Provider'})));
    expect(screen.getByText('Website Availability Provider')).toBeInTheDocument();
    expect(screen.queryByText('release-console')).not.toBeInTheDocument();
});
test('uses a loading label while the actual name is being resolved',async()=>{
    render(<RegistryInstallDialog/>);
    act(()=>receive(status('checking')));
    expect(screen.getByText('Loading plugin details…')).toBeInTheDocument();
    expect(screen.queryByText('release-console')).not.toBeInTheDocument();
});
test('blocked releases explain revocation and same-version installs have a successful no-op outcome',async()=>{
    render(<RegistryInstallDialog/>);
    act(()=>receive(status('blocked',1,{error:'Publisher certificate was revoked.'})));
    expect(screen.getByText('Release unavailable')).toBeInTheDocument();
    expect(screen.getByText('Publisher certificate was revoked.')).toBeInTheDocument();
    act(()=>receive(status('already-installed',2)));
    expect(screen.getByText('Already installed')).toBeInTheDocument();
    expect(screen.getByText(/No changes were made/)).toBeInTheDocument();
});
