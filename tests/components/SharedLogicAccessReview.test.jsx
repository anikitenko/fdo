import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import SharedLogicAccessReview from '../../src/components/plugin/SharedLogicAccessReview';
const request = {id:'review-1',providerId:'example-provider',name:'checks',version:2,capability:'plugins.shared.call.example-provider.checks.v2'};
const service = {providerId:'installed-provider',providerName:'Provider',name:'checks',version:2,available:true};
beforeEach(() => {
    window.electron.plugin.listSharedLogic = jest.fn(async () => ({success:true,services:[service]}));
    window.electron.plugin.getAll = jest.fn(async () => ({plugins:[{id:'consumer',capabilities:['plugins.shared.use',request.capability],sharedLogicRequests:[request]}, {id:'installed-provider',metadata:{name:'Provider'}}]}));
    window.electron.plugin.reviewSharedLogicAccess = jest.fn(async () => ({success:true,capabilities:['plugins.shared.use',request.capability]}));
    window.electron.plugin.grantSharedLogicAccess = jest.fn(async () => ({success:true,capabilities:['plugins.shared.use',request.capability]}));
    window.electron.plugin.requestSharedLogicAccess = jest.fn();
});
test('service selection persists and explicit Add grants access directly with a visible consumer binding', async () => {
    const approved = jest.fn();
    const {rerender} = render(<SharedLogicAccessReview pluginId="consumer" onApproved={approved}/>);
    const select = await screen.findByLabelText('Installed shared service');
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select,{target:{value:'installed-provider/checks/v2'}});
    expect(select).toHaveValue('installed-provider/checks/v2');
    expect(screen.getByLabelText('Consumer provider ID')).toHaveValue('example-provider');
    expect(screen.getByText(/will use installed provider/)).toBeVisible();
    rerender(<SharedLogicAccessReview pluginId="consumer" onApproved={approved}/>);
    expect(select).toHaveValue('installed-provider/checks/v2');
    fireEvent.click(screen.getByRole('button',{name:'Add shared-service access',exact:true}));
    await waitFor(() => expect(window.electron.plugin.grantSharedLogicAccess).toHaveBeenCalledWith('consumer',{providerId:'example-provider',name:'checks',version:2},'installed-provider'));
    expect(approved).toHaveBeenCalled();
    expect(window.electron.plugin.requestSharedLogicAccess).not.toHaveBeenCalled();
    expect(window.electron.plugin.reviewSharedLogicAccess).not.toHaveBeenCalled();
});
test('requests from plugins require explicit approval and can choose an installed provider', async () => {
    render(<SharedLogicAccessReview pluginId="consumer"/>);
    const button = await screen.findByRole('button',{name:'Approve shared-service access'});
    expect(window.electron.plugin.grantSharedLogicAccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Provider for checks request')).toHaveValue('installed-provider');
    fireEvent.click(button);
    await waitFor(() => expect(window.electron.plugin.reviewSharedLogicAccess).toHaveBeenCalledWith('consumer','review-1','approve','installed-provider'));
});
test('a fresh manual grant uses the consumer declaration to propose its logical target', async () => {
    window.electron.plugin.getAll.mockResolvedValue({plugins:[{id:'consumer',capabilities:[],sharedLogicRequests:[]},{id:'installed-provider'}]});
    render(<SharedLogicAccessReview pluginId="consumer" declaredCapabilities={[request.capability]}/>);
    const select = screen.getByLabelText('Installed shared service');
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select,{target:{value:'installed-provider/checks/v2'}});
    expect(screen.getByLabelText('Consumer provider ID')).toHaveValue('example-provider');
    expect(window.electron.plugin.grantSharedLogicAccess).not.toHaveBeenCalled();
});
test('dismissal grants nothing and unsaved capability changes block approval and direct adding', async () => {
    render(<SharedLogicAccessReview pluginId="consumer" disabled/>);
    expect(await screen.findByRole('button',{name:'Approve shared-service access'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Dismiss shared-service request'}));
    await waitFor(() => expect(window.electron.plugin.reviewSharedLogicAccess).toHaveBeenCalledWith('consumer','review-1','dismiss'));
    expect(window.electron.plugin.grantSharedLogicAccess).not.toHaveBeenCalled();
});
test('manual target access is added without creating a request', async () => {
    render(<SharedLogicAccessReview pluginId="consumer"/>);
    fireEvent.click(screen.getByRole('button',{name:'Enter a service manually'}));
    fireEvent.change(screen.getByLabelText('Shared provider plugin ID'),{target:{value:'future-provider'}});
    fireEvent.change(screen.getByLabelText('Shared service name'),{target:{value:'future-service'}});
    fireEvent.click(screen.getByRole('button',{name:'Add shared-service access',exact:true}));
    await waitFor(() => expect(window.electron.plugin.grantSharedLogicAccess).toHaveBeenCalledWith('consumer',{providerId:'future-provider',name:'future-service',version:1},'future-provider'));
    expect(window.electron.plugin.requestSharedLogicAccess).not.toHaveBeenCalled();
});
