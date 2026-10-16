import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {BackendActionEditor} from '../../src/components/live-ui/BackendActionEditor';
const element={localActionCreation:{backend:{initInsert:100},targets:[{id:'result',label:'pre · Result',file:'/render.ts',line:10}]}};

test('backend preset requires an explicit output and submits bounded request text unchanged',()=>{
    const onPropose=jest.fn();
    const {rerender}=render(<BackendActionEditor element={element} onPropose={onPropose}/>);
    fireEvent.click(screen.getByText('Create backend action',{exact:true}));
    expect(screen.getByRole('button',{name:'Preview backend action'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Backend result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Backend request text'),{target:{value:'<b>literal</b>\nRequest'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview backend action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'create-backend-action',targetId:'result',text:'<b>literal</b>\nRequest'});
    rerender(<BackendActionEditor element={element} onPropose={onPropose} disabled/>);
    expect(screen.getByRole('button',{name:'Preview backend action'})).toBeDisabled();
});

test('explains unsupported initialization and stays hidden for already wired buttons',()=>{
    const {rerender}=render(<BackendActionEditor element={{localActionCreation:{backend:null,targets:[]}}} onPropose={jest.fn()}/>);
    expect(screen.getByText(/Backend creation requires/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Preview backend action'})).toBeNull();
    rerender(<BackendActionEditor element={{}} onPropose={jest.fn()}/>);
    expect(screen.queryByText('Create backend action')).toBeNull();
});

test('input binding requires a deliberate selection and sends only the chosen input identity',()=>{
    const onPropose=jest.fn();
    render(<BackendActionEditor element={{localActionCreation:{...element.localActionCreation,inputs:[{id:'input',label:'textarea · Request',file:'/render.ts',line:11}]}}} onPropose={onPropose}/>);
    fireEvent.click(screen.getByText('Create backend action',{exact:true}));
    fireEvent.change(screen.getByLabelText('Backend result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Request text source'),{target:{value:'input'}});
    expect(screen.queryByLabelText('Backend request text')).toBeNull();
    expect(screen.getByRole('button',{name:'Preview backend action'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Backend request input'),{target:{value:'input'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview backend action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'create-backend-action',targetId:'result',inputId:'input'});
});

test('JSON preset offers its own contract fields and submits the chosen summary mapping',()=>{
    const onPropose=jest.fn();render(<BackendActionEditor element={element} onPropose={onPropose}/>);
    fireEvent.click(screen.getByText('Create backend action',{exact:true}));
    fireEvent.change(screen.getByLabelText('Backend preset'),{target:{value:'inspect-json'}});
    fireEvent.change(screen.getByLabelText('Backend result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Result display'),{target:{value:'summary'}});
    expect([...screen.getByLabelText('Result display').options].map(item=>item.value)).toEqual(['json','summary','valueType','itemCount','topLevelKeys']);
    fireEvent.click(screen.getByRole('button',{name:'Preview backend action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'create-backend-action',preset:'inspect-json',display:'summary',targetId:'result',text:'{"hello":"world"}'});
});
