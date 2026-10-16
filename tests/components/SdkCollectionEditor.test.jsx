import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {SdkCollectionEditor} from '../../src/components/live-ui/SdkCollectionEditor';
const row=(key,label,extra={})=>({key,label,flag:false,labelTarget:{start:1,end:2},flagTarget:{start:3,end:4},removable:true,...extra});
const element={structure:{unique:true},sdkComponent:{identity:'fdo.tabs',collection:{editable:true,items:[row('one','First'),row('two','Second',{removable:false,reason:'Contains authored content.'})]}}};
test('collection controls rename, reorder, protect authored content and select newly added rows',()=>{
    const onPropose=jest.fn(),{rerender}=render(<SdkCollectionEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Item label'),{target:{value:'Settings'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview item label'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-collection',key:'one',action:'label',value:'Settings'});
    expect(screen.getByRole('button',{name:'Move item up'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Move item down'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-collection',key:'one',action:'down'});
    fireEvent.change(screen.getByLabelText('Collection item'),{target:{value:'two'}});
    expect(screen.getByRole('button',{name:'Remove item'})).toBeDisabled();
    expect(screen.getByText('Contains authored content.')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Add tab'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-collection',key:'two',action:'add'});
    rerender(<SdkCollectionEditor element={{...element,sdkComponent:{...element.sdkComponent,collection:{...element.sdkComponent.collection,items:[...element.sdkComponent.collection.items,row('new','New tab')]}}}} onPropose={onPropose}/>);
    expect(screen.getByLabelText('Collection item')).toHaveValue('new');
    expect(screen.getByLabelText('Item label')).toHaveValue('New tab');
    fireEvent.click(screen.getByRole('button',{name:'Remove item'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-collection',key:'new',action:'remove'});
});
test('shared collection explains why editing is blocked and disabled controls remain inert',()=>{
    const onPropose=jest.fn();
    render(<SdkCollectionEditor element={{...element,sdkComponent:{...element.sdkComponent,collection:{editable:false,reason:'Shared items stay in code.',items:[]}}}} onPropose={onPropose}/>);
    expect(screen.getByText('Shared items stay in code.')).toBeVisible();
    expect(screen.getByRole('button',{name:'Add tab'})).toBeDisabled();expect(onPropose).not.toHaveBeenCalled();
});

test('item content reuses SDK block operations and preview is independent of source edits',()=>{
    const onPropose=jest.fn(),onInspect=jest.fn(),onPreviewItem=jest.fn();
    const current={...element,sdkComponent:{...element.sdkComponent,collection:{...element.sdkComponent.collection,items:[row('one','First',{slot:{name:'item:one',label:'First · Body',editable:true,children:[{start:1,id:'child',label:'p · Item text',movable:true,removable:true,duplicable:true}]}}),element.sdkComponent.collection.items[1]]}}};
    render(<SdkCollectionEditor element={current} onPropose={onPropose} onInspect={onInspect} onPreviewItem={onPreviewItem}/>);
    fireEvent.click(screen.getByRole('button',{name:'Preview item',exact:true}));expect(onPreviewItem).toHaveBeenCalledWith('one');expect(onPropose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Inspect p · Item text'}));expect(onInspect).toHaveBeenCalledWith('child');
    fireEvent.change(screen.getByLabelText('Add to slot'),{target:{value:'result'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview slot addition'}));expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot',slot:'item:one',component:'result'});
    fireEvent.click(screen.getByRole('button',{name:'remove p · Item text'}));expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'item:one',childId:'child',action:'remove'});
});

test('transfer picker targets another editable item and follows only successful moves',async()=>{
    const child={start:1,id:'action',label:'button · Run',movable:true,removable:false,duplicable:false,transferable:true};
    const current={...element,sdkComponent:{...element.sdkComponent,collection:{editable:true,items:[row('one','First',{slot:{name:'item:one',label:'First · Body',editable:true,children:[child]}}),row('two','Second',{slot:{name:'item:two',label:'Second · Body',editable:true,children:[]}}),row('three','Shared',{slot:{name:'item:three',label:'Shared · Body',editable:false,children:[]}})]}}};
    const onPropose=jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<SdkCollectionEditor element={current} onPropose={onPropose}/>);
    const picker=screen.getByLabelText('Move content to');
    expect([...picker.options].map(option=>option.textContent)).toEqual(['Second · Body']);
    fireEvent.click(screen.getByRole('button',{name:'Move button · Run to Second · Body'}));
    await waitFor(()=>expect(onPropose).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Collection item')).toHaveValue('one');
    fireEvent.click(screen.getByRole('button',{name:'Move button · Run to Second · Body'}));
    await waitFor(()=>expect(screen.getByLabelText('Collection item')).toHaveValue('two'));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-slot-arrange',slot:'item:one',childId:'action',action:'transfer',destinationSlot:'item:two'});
});

test('restores a valid remembered item and reports explicit item changes without source edits',()=>{
    const onItemSelect=jest.fn(),onPropose=jest.fn();
    const {unmount}=render(<SdkCollectionEditor element={element} rememberedItemKey="two" onItemSelect={onItemSelect} onPropose={onPropose}/>);
    expect(screen.getByLabelText('Collection item')).toHaveValue('two');
    fireEvent.change(screen.getByLabelText('Collection item'),{target:{value:'one'}});
    expect(onItemSelect).toHaveBeenCalledWith('one');expect(onPropose).not.toHaveBeenCalled();
    unmount();
    render(<SdkCollectionEditor element={element} rememberedItemKey="deleted" onItemSelect={onItemSelect} onPropose={onPropose}/>);
    expect(screen.getByLabelText('Collection item')).toHaveValue('one');
});

test('default tab picker separates saved selection from item preview and protects disabled/computed choices',()=>{
    const onPropose=jest.fn(),onPreviewItem=jest.fn();
    const current={...element,sdkComponent:{...element.sdkComponent,collection:{...element.sdkComponent.collection,activeKey:null,activeTarget:{editable:true},items:[element.sdkComponent.collection.items[0],row('two','Second',{flag:true})]}}};
    const {rerender}=render(<SdkCollectionEditor element={current} onPropose={onPropose} onPreviewItem={onPreviewItem}/>);
    expect(screen.getByLabelText('Default tab')).toHaveValue('');
    expect([...screen.getByLabelText('Default tab').options].find(option=>option.value==='two').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Default tab'),{target:{value:'one'}});
    expect(onPropose).toHaveBeenLastCalledWith({kind:'component-collection',key:'one',action:'default-tab',value:'one'});
    expect(onPreviewItem).not.toHaveBeenCalled();
    rerender(<SdkCollectionEditor element={{...current,sdkComponent:{...current.sdkComponent,collection:{...current.sdkComponent.collection,activeKey:'one',activeTarget:{editable:false}}}}} onPropose={onPropose} onPreviewItem={onPreviewItem}/>);
    expect(screen.getByLabelText('Default tab')).toBeDisabled();
    expect(screen.getByText('Shared or computed activeKey stays in the IDE.')).toBeVisible();
});
