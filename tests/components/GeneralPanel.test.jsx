import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {GeneralPanel} from '../../src/components/settings/panels/GeneralPanel';
import {AppToaster} from '../../src/components/AppToaster';
jest.mock('../../src/components/AppToaster', () => ({AppToaster:{show:jest.fn()}}));
beforeEach(() => {
    window.electron = {system:{isFdoInPath:jest.fn().mockResolvedValue({success:true,path:'/old/bin/fdo'}),addFdoInPath:jest.fn().mockResolvedValue({success:true,path:'/new/bin/fdo'}),removeFdoFromPath:jest.fn().mockResolvedValue({success:true})}};
    AppToaster.show.mockClear();
});
test('repairs an existing command and shows the new location', async () => {
    render(<GeneralPanel/>);
    fireEvent.click(await screen.findByRole('button',{name:'Repair command'}));
    await screen.findByText('/new/bin/fdo');
    expect(window.electron.system.addFdoInPath).toHaveBeenCalledTimes(1);
    expect(window.electron.system.removeFdoFromPath).not.toHaveBeenCalled();
});
test('reports installer errors without marking the command uninstalled', async () => {
    window.electron.system.addFdoInPath.mockResolvedValue({success:false,error:'Not an FDO wrapper'});
    render(<GeneralPanel/>);fireEvent.click(await screen.findByRole('button',{name:'Repair command'}));
    await waitFor(()=>expect(AppToaster.show).toHaveBeenCalledWith(expect.objectContaining({intent:'danger'})));
    expect(screen.getByRole('checkbox')).toBeChecked();
});
