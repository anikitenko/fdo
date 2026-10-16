import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {SdkComponentMotion} from '../../src/components/live-ui/SdkComponentMotion';
const element={structure:{unique:true},sdkComponent:{motion:{editable:true,preset:'none',duration:180,easing:'ease-out'}}};
test('motion settings validate duration and submit a bounded preset',()=>{
    const onPropose=jest.fn();render(<SdkComponentMotion element={element} onPropose={onPropose}/>);
    fireEvent.click(screen.getByText('Component motion'));
    fireEvent.change(screen.getByLabelText('Motion preset'),{target:{value:'slide'}});
    fireEvent.change(screen.getByLabelText('Duration (ms)'),{target:{value:'20'}});
    expect(screen.getByRole('button',{name:'Preview motion'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Duration (ms)'),{target:{value:'240'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview motion'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'component-motion',preset:'slide',duration:240,easing:'ease-out'});
});
