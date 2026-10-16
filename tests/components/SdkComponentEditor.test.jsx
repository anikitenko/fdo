import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {SdkComponentEditor} from '../../src/components/live-ui/SdkComponentEditor';
const element = {structure:{unique:true},sdkComponent:{name:'Dialog',properties:[{name:'title',value:'Settings',editable:true}],slots:[{name:'body',editable:true},{name:'footer',editable:true}]}};
test('property and slot controls submit explicit operations and honor read-only state', () => {
    const onPropose = jest.fn();
    const {rerender} = render(<SdkComponentEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Property value'),{target:{value:'Team settings'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview component property'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'component-property',property:'title',value:'Team settings'});
    fireEvent.change(screen.getByLabelText('Component slot'),{target:{value:'footer'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview slot addition'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot',slot:'footer',component:'text'});
    rerender(<SdkComponentEditor element={{...element,structure:{unique:false}}} onPropose={onPropose}/>);
    expect(screen.getByRole('button',{name:'Preview slot addition'})).toBeDisabled();
    expect(screen.getByLabelText('Property value')).toBeDisabled();
});

test('slot controls expose ordering and protect action targets', () => {
    const onPropose = jest.fn();
    const arranged = {...element,sdkComponent:{...element.sdkComponent,slots:[{name:'body',editable:true,children:[
        {start:10,id:'first',label:'First paragraph',movable:true,removable:true},
        {start:50,id:'save',label:'Save button',movable:true,removable:false,reason:'Action targets stay in code.'},
    ]}]}};
    render(<SdkComponentEditor element={arranged} onPropose={onPropose}/>);
    expect(screen.getByRole('button',{name:'up First paragraph'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'down Save button'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'remove Save button'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'down First paragraph'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'body',childId:'first',action:'down'});
    fireEvent.click(screen.getByRole('button',{name:'remove First paragraph'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'body',childId:'first',action:'remove'});
});

test('content is a separate named section with empty-state guidance and cross-slot controls', () => {
    const onPropose = jest.fn();
    const arranged = {...element,sdkComponent:{...element.sdkComponent,slots:[{name:'body',editable:true,children:[
        {start:10,id:'first',label:'First paragraph',movable:true,removable:true,transferable:true},
    ]},{name:'footer',editable:true,children:[]}]}};
    render(<SdkComponentEditor element={arranged} onPropose={onPropose}/>);
    expect(screen.getByRole('region',{name:'Component content'})).toBeVisible();
    expect(screen.getByText('Dialog content')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Move First paragraph to footer'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'body',childId:'first',action:'transfer',destinationSlot:'footer'});
    fireEvent.change(screen.getByLabelText('Component slot'),{target:{value:'footer'}});
    expect(screen.getByText('Empty footer')).toBeVisible();
});

test('slot blocks can be inspected, duplicated and positioned directly without applying', () => {
    const onPropose = jest.fn(), onInspect = jest.fn();
    const arranged = {...element,sdkComponent:{...element.sdkComponent,slots:[{name:'body',editable:true,children:[
        {start:10,id:'first',label:'First',movable:true,duplicable:true},
        {start:30,id:'custom',label:'Custom',movable:false,duplicable:false},
        {start:60,id:'third',label:'Third',movable:true,duplicable:true},
        {start:90,id:'fourth',label:'Fourth',movable:true,duplicable:true},
    ]}]}};
    const {rerender} = render(<SdkComponentEditor element={arranged} onPropose={onPropose} onInspect={onInspect}/>);
    fireEvent.click(screen.getByRole('button',{name:'Inspect Third'}));
    expect(onInspect).toHaveBeenCalledWith('third');
    expect(onPropose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Duplicate Third'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'body',childId:'third',action:'duplicate'});
    expect(screen.getByRole('button',{name:'Duplicate Custom'})).toBeDisabled();
    const position = screen.getByLabelText('Position of Third');
    expect(position.options[0]).toBeDisabled(); expect(position.options[1]).toBeDisabled();
    fireEvent.change(position,{target:{value:'3'}});
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'body',childId:'third',action:'position',index:3});
    rerender(<SdkComponentEditor element={arranged} disabled onPropose={onPropose} onInspect={onInspect}/>);
    expect(screen.getByRole('button',{name:'Duplicate Third'})).toBeDisabled();
    expect(screen.getByLabelText('Position of Third')).toBeDisabled();
});

test('typed component controls submit booleans, enums and null progress; state preview is separate from source edits',()=>{
    const onPropose=jest.fn(),onPreviewState=jest.fn();
    const typed={structure:{unique:true},sdkComponent:{name:'Inline Alert',previewStates:['visible','hidden'],slots:[],properties:[{name:'visible',kind:'boolean',value:true,editable:true},{name:'variant',kind:'enum',choices:['info','error'],value:'info',editable:true},{name:'value',kind:'number-or-null',value:20,editable:true}]}};
    const {rerender}=render(<SdkComponentEditor element={typed} onPropose={onPropose} onPreviewState={onPreviewState}/>);
    fireEvent.change(screen.getByLabelText('Property value'),{target:{value:'false'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview component property'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-property',property:'visible',value:false});
    fireEvent.change(screen.getByLabelText('Component property'),{target:{value:'variant'}});
    fireEvent.change(screen.getByLabelText('Property value'),{target:{value:'error'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview component property'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-property',property:'variant',value:'error'});
    fireEvent.change(screen.getByLabelText('Component property'),{target:{value:'value'}});
    fireEvent.change(screen.getByLabelText('Property value'),{target:{value:''}});
    fireEvent.click(screen.getByRole('button',{name:'Preview component property'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-property',property:'value',value:null});
    onPropose.mockClear();
    fireEvent.change(screen.getByLabelText('Preview state'),{target:{value:'hidden'}});
    expect(onPreviewState).toHaveBeenCalledWith('hidden');expect(onPropose).not.toHaveBeenCalled();
    rerender(<SdkComponentEditor element={{...typed,sdkComponent:{...typed.sdkComponent}}} onPropose={onPropose} onPreviewState={onPreviewState}/>);
    expect(screen.getByLabelText('Preview state')).toHaveValue('authored');
});

test('components without authored HTML slots do not show unusable content controls',()=>{
    render(<SdkComponentEditor element={{structure:{unique:true},sdkComponent:{name:'Progress Bar',properties:[],slots:[]}}} onPropose={jest.fn()}/>);
    expect(screen.queryByLabelText('Component slot')).toBeNull();
    expect(screen.queryByRole('button',{name:'Preview slot addition'})).toBeNull();
});

test('Toast Region offers scoped toast insertion and explains runtime queue wiring',()=>{
    const onPropose=jest.fn();
    const region={structure:{unique:true},sdkComponent:{name:'Toast Region',properties:[],slots:[{name:'body',editable:true,sdkInsertions:[{identity:'fdo.toast',name:'Toast'}]}]}};
    const {rerender}=render(<SdkComponentEditor element={region} onPropose={onPropose}/>);
    fireEvent.click(screen.getByRole('button',{name:'Add toast to region'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'insert-sdk-slot-component',slot:'body',component:'fdo.toast'});
    expect(screen.getByText(/Enqueue SDK toast section for runtime queueing/)).toBeVisible();
    rerender(<SdkComponentEditor element={region} onPropose={onPropose} disabled/>);
    expect(screen.getByRole('button',{name:'Add toast to region'})).toBeDisabled();
});
