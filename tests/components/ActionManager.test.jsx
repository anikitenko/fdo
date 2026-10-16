import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {ActionManager} from '../../src/components/live-ui/ActionManager';
test('lists disconnected actions, protects shared entries and submits a reversible removal',()=>{
    const onPropose=jest.fn();render(<ActionManager actions={[{name:'visualRequest1',kind:'Text backend',uses:0,removable:true},{name:'visualSetText1',kind:'Local action',uses:2,removable:false,reason:'Shared'}]} onPropose={onPropose}/>);
    fireEvent.click(screen.getByText('Actions',{exact:true}));
    fireEvent.change(screen.getByLabelText('Generated action'),{target:{value:'visualSetText1'}});
    expect(screen.getByRole('button',{name:'Remove generated action'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Generated action'),{target:{value:'visualRequest1'}});
    fireEvent.click(screen.getByRole('button',{name:'Remove generated action'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'remove-action',actionName:'visualRequest1'});
    fireEvent.change(screen.getByLabelText('Filter generated actions'),{target:{value:'Local'}});
    expect(screen.getByRole('button',{name:'Remove generated action'})).toBeDisabled();
});
