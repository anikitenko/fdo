import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {SdkComponentAppearance} from '../../src/components/live-ui/SdkComponentAppearance';
const fields = [{name:'--fdo-ui-background',label:'Background',cssProperty:'background-color',kind:'color',value:'#112233',overridden:true,editable:true}, {name:'--fdo-ui-width',label:'Maximum width',cssProperty:'width',kind:'length',value:'32rem',editable:true}];
const element = {structure:{unique:true},sdkComponent:{appearance:fields}};
test('color picker updates a local appearance request, and reset is explicit',()=>{
    const onPropose = jest.fn();
    render(<SdkComponentAppearance element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Color'),{target:{value:'#445566'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview appearance'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-appearance',property:'--fdo-ui-background',action:'set',value:'#445566'});
    fireEvent.click(screen.getByRole('button',{name:'Reset appearance override'}));
    expect(onPropose).toHaveBeenLastCalledWith(expect.objectContaining({action:'reset',property:'--fdo-ui-background'}));
    fireEvent.change(screen.getByLabelText('Appearance property'),{target:{value:'--fdo-ui-width'}});
    expect(screen.getByLabelText('Length')).toHaveValue(32);
    expect(screen.getByRole('button',{name:'Reset appearance override'})).toBeDisabled();
});
test('invalid CSS values have actionable feedback; shared style maps stay read-only',()=>{
    const onPropose=jest.fn();
    const {rerender}=render(<SdkComponentAppearance element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Appearance value'),{target:{value:'red;display:block'}});
    expect(screen.getByRole('alert')).toHaveTextContent('one CSS value');
    expect(screen.getByRole('button',{name:'Preview appearance'})).toBeDisabled();
    rerender(<SdkComponentAppearance element={{...element,sdkComponent:{appearance:[{...fields[0],editable:false,reason:'Shared style map: use the IDE.'}]}}} onPropose={onPropose}/>);
    expect(screen.getByLabelText('Appearance value')).toBeDisabled();
    expect(screen.getByText('Shared style map: use the IDE.')).toBeVisible();
    expect(onPropose).not.toHaveBeenCalled();
});
