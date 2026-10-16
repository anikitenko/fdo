import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {SdkComponentCatalog} from '../../src/components/live-ui/SdkComponentCatalog';
const components=[{identity:'fdo.dialog',name:'Dialog',create:'createDialog',mount:'mountDialog',slots:['body','footer'],supported:true}];
test('catalog shows discoverable components, explains prerequisites and selects existing instances',()=>{
    const onAdd=jest.fn(),onSelect=jest.fn();
    const props={components,elements:[{id:'dialog-1',label:'Dialog · Settings',sdkComponent:{identity:'fdo.dialog'}}],query:'dialog',onAdd,onSelect};
    const {rerender}=render(<SdkComponentCatalog {...props}/>);
    expect(screen.getByRole('button',{name:'Add Dialog'})).toBeDisabled();
    expect(screen.getByText(/Select main or a supported nested SDK layout container in Elements/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Inspect Dialog · Settings'}));
    expect(onSelect).toHaveBeenCalledWith('dialog-1');
    rerender(<SdkComponentCatalog {...props} selected={{label:'section · Settings',sdkInsertions:[{identity:'fdo.dialog'}]}}/>);
    expect(screen.getByText('Adds inside section · Settings. Review the draft before applying.')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Add Dialog'}));
    expect(onAdd).toHaveBeenCalledWith('fdo.dialog');
    rerender(<SdkComponentCatalog {...props} query="missing"/>);
    expect(screen.queryByRole('region',{name:'SDK components'})).toBeNull();
});
