import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {BackendResultEditor} from '../../src/components/live-ui/BackendResultEditor';
test('mapping requires a change and submits a supported target/field selection',()=>{
    const onPropose=jest.fn();const element={backendResultMapping:{targetId:'first',display:'json',targets:[{id:'first',label:'First',file:'/render.ts',line:1},{id:'second',label:'Second',file:'/render.ts',line:2}]}};
    const {rerender}=render(<BackendResultEditor element={element} onPropose={onPropose}/>);
    expect(screen.getByRole('button',{name:'Preview result mapping'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mapped result element'),{target:{value:'second'}});
    fireEvent.change(screen.getByLabelText('Mapped result display'),{target:{value:'text'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview result mapping'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'backend-result',targetId:'second',display:'text'});
    rerender(<BackendResultEditor element={element} onPropose={onPropose} disabled/>);
    expect(screen.getByRole('button',{name:'Preview result mapping'})).toBeDisabled();
});

test('adds and removes a secondary output with a distinct target and field',()=>{
    const onPropose=jest.fn();render(<BackendResultEditor element={{backendResultMapping:{targetId:'first',display:'json',targets:[{id:'first',label:'First'},{id:'second',label:'Second'}]}}} onPropose={onPropose}/>);
    fireEvent.click(screen.getByRole('button',{name:'Add result output'}));
    expect(screen.getByRole('button',{name:'Preview result mapping'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Output 2 element'),{target:{value:'second'}});
    fireEvent.change(screen.getByLabelText('Output 2 display'),{target:{value:'length'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview result mapping'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'backend-result',targetId:'first',display:'json',outputs:[{targetId:'second',display:'length'}]});
    fireEvent.click(screen.getByRole('button',{name:'Remove output 2'}));expect(screen.queryByLabelText('Output 2 element')).toBeNull();
});
