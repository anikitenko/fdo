import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {SdkAsyncActionEditor} from '../../src/components/live-ui/SdkAsyncActionEditor';
test('creates and disconnects explicitly, and protects blocked actions',()=>{
    const onPropose=jest.fn();
    const element={asyncAction:{editable:true,status:'available',targets:[{id:'result',label:'Result panel'}]}};
    const {rerender}=render(<SdkAsyncActionEditor element={element} onPropose={onPropose}/>);
    expect(screen.getByRole('button',{name:'Preview async action'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Async result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Async result text'),{target:{value:'Saved'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview async action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'create-sdk-async-action',targetId:'result',text:'Saved'});
    rerender(<SdkAsyncActionEditor element={{asyncAction:{...element.asyncAction,status:'connected'}}} onPropose={onPropose}/>);
    fireEvent.click(screen.getByRole('button',{name:'Disconnect async action'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'disconnect-sdk-async-action'});
    rerender(<SdkAsyncActionEditor element={{asyncAction:{editable:false,reason:'Custom setup stays in code.'}}} onPropose={onPropose}/>);
    expect(screen.getByText('Custom setup stays in code.')).toBeVisible();
    expect(screen.queryByRole('button',{name:'Preview async action'})).toBeNull();
});

test('backend preset collects input and result display without a fixed-text request',()=>{
    const onPropose=jest.fn();
    const element={asyncAction:{editable:true,status:'available',backend:{},targets:[{id:'result',label:'Result'}],inputs:[{id:'input',label:'JSON input'}]}};
    render(<SdkAsyncActionEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Async action preset'),{target:{value:'inspect-json'}});
    fireEvent.change(screen.getByLabelText('Async result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Async request source'),{target:{value:'input'}});
    expect(screen.getByRole('button',{name:'Preview async action'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Async request input'),{target:{value:'input'}});
    fireEvent.change(screen.getByLabelText('Async result display'),{target:{value:'summary'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview async action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'create-sdk-async-action',targetId:'result',inputId:'input',preset:'inspect-json',display:'summary'});
});
