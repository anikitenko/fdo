import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {SdkToastProgressEditor} from '../../src/components/live-ui/SdkToastProgressEditor';
const progress={present:true,editable:true,removable:true,value:{label:'Upload',value:20,max:100},properties:['label','value','max'].map(name=>({name,editable:true}))};
const element={structure:{unique:true},sdkComponent:{toastProgress:progress}};
test('adds optional progress, updates numbers together and preserves zero versus indeterminate',()=>{
    const onPropose=jest.fn(),{rerender}=render(<SdkToastProgressEditor element={{...element,sdkComponent:{toastProgress:{...progress,present:false,canAdd:true}}}} onPropose={onPropose}/>);
    fireEvent.click(screen.getByRole('button',{name:'Add toast progress'}));expect(onPropose).toHaveBeenLastCalledWith({kind:'toast-progress',action:'add'});
    rerender(<SdkToastProgressEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Progress value'),{target:{value:'0'}});
    fireEvent.change(screen.getByLabelText('Progress maximum'),{target:{value:'10'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview progress settings'}));expect(onPropose).toHaveBeenLastCalledWith({kind:'toast-progress',action:'update',value:{label:'Upload',value:0,max:10}});
    fireEvent.change(screen.getByLabelText('Progress value'),{target:{value:''}});
    fireEvent.click(screen.getByRole('button',{name:'Preview progress settings'}));expect(onPropose).toHaveBeenLastCalledWith({kind:'toast-progress',action:'update',value:{label:'Upload',value:null,max:10}});
    fireEvent.click(screen.getByRole('button',{name:'Remove toast progress'}));expect(onPropose).toHaveBeenLastCalledWith({kind:'toast-progress',action:'remove'});
});
test('invalid ranges and referenced progress have actionable feedback; computed fields remain read-only',()=>{
    const onPropose=jest.fn();
    render(<SdkToastProgressEditor element={{...element,sdkComponent:{toastProgress:{...progress,removable:false,removeReason:'Progress updates are referenced. Review them in the IDE.',properties:progress.properties.map(field=>({...field,editable:field.name!=='value'}))}}}} onPropose={onPropose}/>);
    expect(screen.getByLabelText('Progress value')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Progress maximum'),{target:{value:'10'}});
    expect(screen.getByText(/Value must be between zero/)).toBeVisible();
    expect(screen.getByRole('button',{name:'Preview progress settings'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Remove toast progress'})).toBeDisabled();
    expect(screen.getByText('Progress updates are referenced. Review them in the IDE.')).toBeVisible();expect(onPropose).not.toHaveBeenCalled();
});
