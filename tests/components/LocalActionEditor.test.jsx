import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {LocalActionEditor} from '../../src/components/live-ui/LocalActionEditor';
const element = {localActionCreation:{targets:[{id:'result',label:'pre · Results',file:'/render.ts',line:12}]}};

test('local action creation requires a deliberate result target and sends plain text unchanged',()=>{
    const onPropose = jest.fn();
    const {rerender} = render(<LocalActionEditor element={element} onPropose={onPropose}/>);
    expect(screen.getByRole('button',{name:'Preview new action'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Result text'),{target:{value:'<b>${literal}</b>\nLine two'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview new action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'create-local-action',targetId:'result',text:'<b>${literal}</b>\nLine two'});
    rerender(<LocalActionEditor element={element} onPropose={onPropose} disabled/>);
    expect(screen.getByRole('button',{name:'Preview new action'})).toBeDisabled();
});

test('explains missing result targets and stays hidden for already connected or unsupported buttons',()=>{
    const {rerender} = render(<LocalActionEditor element={{localActionCreation:{targets:[]}}} onPropose={jest.fn()}/>);
    expect(screen.getByText(/Add a Text or Result panel first/)).toBeVisible();
    expect(screen.queryByRole('button',{name:'Preview new action'})).toBeNull();
    rerender(<LocalActionEditor element={{}} onPropose={jest.fn()}/>);
    expect(screen.queryByText('Create local action')).toBeNull();
});
