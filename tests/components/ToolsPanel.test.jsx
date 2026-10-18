import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import ToolsPanel from '../../src/components/settings/panels/ToolsPanel';
beforeEach(() => {
    window.electron.toolSettings={inspect:jest.fn(async () => ({success:true,inventory:{platform:'darwin',checkedAt:Date.now(),x11:{label:'XQuartz / X11',supported:true,xauthFound:false,note:'Start an authenticated display.',url:'https://www.xquartz.org/',command:'brew install --cask xquartz'},tools:[
        {id:'az',label:'Azure CLI',status:'missing',executable:'',paths:['/opt/homebrew/bin/az'],categories:['Cloud'],capabilities:['system.process.scope.azure-cli'],installation:{label:'Azure CLI',url:'https://learn.microsoft.com/cli/azure/install-azure-cli/',command:'brew install azure-cli'}},
        {id:'git',label:'Git',status:'found',executable:'/usr/bin/git',paths:['/usr/bin/git'],categories:['Source Control'],capabilities:['system.process.scope.git'],installation:null},
    ]}}))};
    window.electron.system.openExternal=jest.fn();
    Object.defineProperty(navigator,'clipboard',{value:{writeText:jest.fn(async () => {})},configurable:true});
});
test('shows detection, filters missing tools and rechecks after guided installation', async () => {
    render(<ToolsPanel/>);
    await screen.findByText('Azure CLI');
    expect(screen.getByText('Git')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Only missing or unavailable tools'));
    expect(screen.queryByText('Git')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search tools'),{target:{value:'azure-cli'}});
    expect(screen.queryByText('XQuartz / X11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Install / setup instructions'}));
    expect(window.electron.system.openExternal).toHaveBeenCalledWith('https://learn.microsoft.com/cli/azure/install-azure-cli/');
    fireEvent.click(screen.getByRole('button',{name:'Copy install command for Azure CLI'}));
    await screen.findByText('Copied. Run in your terminal.');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('brew install azure-cli');
    fireEvent.click(screen.getByRole('button',{name:'Recheck tools'}));
    await waitFor(() => expect(window.electron.toolSettings.inspect).toHaveBeenCalledTimes(2));
});
test('reports inspection errors and allows retry', async () => {
    window.electron.toolSettings.inspect.mockRejectedValueOnce(new Error('offline'));
    render(<ToolsPanel/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not inspect local tools');
    fireEvent.click(screen.getByRole('button',{name:'Recheck tools'}));
    await screen.findByText('Azure CLI');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
