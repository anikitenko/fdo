import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {SdkToastActionEditor} from '../../src/components/live-ui/SdkToastActionEditor';
test('toast editor submits explicit limits, preserves zero and honors shared settings',()=>{
    const onPropose=jest.fn(),target={regionId:'region',toastId:'toast',label:'Notifications → Saved',visible:1,queued:0,locked:true};
    const element={id:'button',toastAction:{editable:true,status:'available',targets:[target],visible:3,queued:50,duration:0}};
    render(<SdkToastActionEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Toast to enqueue'),{target:{value:'region/toast'}});
    expect(screen.getByLabelText('Visible toast limit')).toBeDisabled();expect(screen.getByLabelText('Queued toast limit')).toHaveValue(0);
    fireEvent.click(screen.getByRole('button',{name:'Preview toast connection'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'connect-toast-action',regionId:'region',toastId:'toast',visible:1,queued:0,duration:0});
    fireEvent.change(screen.getByLabelText('Toast auto-dismiss (ms)'),{target:{value:''}});
    expect(screen.getByRole('button',{name:'Preview toast connection'})).toBeDisabled();
});
