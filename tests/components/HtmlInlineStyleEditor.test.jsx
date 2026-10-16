import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {HtmlInlineStyleEditor} from '../../src/components/live-ui/HtmlInlineStyleEditor';
const element = {inlineStyle:{editable:true,declarations:[{property:'color',value:'red',important:true}],presentProperties:['color'],canAddDeclarations:true}};
test('inline property selection, preview and reset use semantic operations',async()=>{
    const onPropose = jest.fn();
    render(<HtmlInlineStyleEditor element={element} properties={['color','padding']} onPropose={onPropose}/>);
    const picker = screen.getByRole('combobox',{name:'CSS property'});
    fireEvent.focus(picker); fireEvent.change(picker,{target:{value:'color'}});
    await screen.findByRole('option',{name:/color/});
    fireEvent.keyDown(picker,{key:'Enter',code:'Enter',keyCode:13}); fireEvent.keyUp(picker,{key:'Enter',code:'Enter',keyCode:13});
    await waitFor(()=>expect(screen.getByLabelText('Inline CSS value')).toHaveValue('red'));
    expect(screen.getByLabelText('Inline CSS value')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Inline CSS value'),{target:{value:'blue'}});
    fireEvent.keyDown(screen.getByLabelText('Inline CSS value'),{key:'Enter'});
    expect(onPropose).toHaveBeenLastCalledWith({kind:'html-inline-style',action:'set',property:'color',value:'blue'});
    fireEvent.click(screen.getByRole('button',{name:'Reset style override'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'html-inline-style',action:'remove',property:'color',value:'blue'});
});
test('protected styles explain why controls are unavailable',()=>{
    render(<HtmlInlineStyleEditor element={{inlineStyle:{editable:false,reason:'Duplicate inline declarations'}}} properties={[]} onPropose={jest.fn()}/>);
    expect(screen.getByText('Duplicate inline declarations')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('multiple overrides are listed with direct edit/remove and a fresh-property action',async()=>{
    const onPropose = jest.fn();
    const multiple = {inlineStyle:{...element.inlineStyle,declarations:[{property:'color',value:'red'},{property:'text-align',value:'right'}],presentProperties:['color','text-align']}};
    render(<HtmlInlineStyleEditor element={multiple} properties={['color','text-align','padding']} onPropose={onPropose}/>);
    expect(screen.getByRole('list',{name:'Current style overrides'})).toBeVisible();
    expect(screen.getByText('2 local overrides')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Edit text-align override'}));
    await waitFor(()=>expect(screen.getByLabelText('Inline CSS value')).toHaveValue('right'));
    expect(screen.getByLabelText('Inline CSS value')).toHaveFocus();
    fireEvent.click(screen.getByRole('button',{name:'Remove color override'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'html-inline-style',action:'remove',property:'color'});
    fireEvent.click(screen.getByRole('button',{name:'Add another override'}));
    expect(screen.getByRole('combobox',{name:'CSS property'})).toHaveFocus();
    expect(screen.getByRole('combobox',{name:'CSS property'})).toHaveValue('');
    expect(screen.getByLabelText('Inline CSS value')).toHaveValue('');
});
