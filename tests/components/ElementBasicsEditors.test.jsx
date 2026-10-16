import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {ClassNamesEditor,InputKindEditor} from '../../src/components/live-ui/ElementBasicsEditors';
test('class form validates tokens and previews plain space-separated names',()=>{
    const onPropose=jest.fn();
    render(<ClassNamesEditor element={{classNameAssignment:{value:''}}} onPropose={onPropose}/>);
    fireEvent.click(screen.getByText('Class names',{selector:'span'}));
    fireEvent.change(screen.getByLabelText('Class names'),{target:{value:'.pure-button'}});
    expect(screen.getByRole('button',{name:'Preview class names'})).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('without dots');
    fireEvent.change(screen.getByLabelText('Class names'),{target:{value:'pure-button pure-button-primary'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview class names'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'class-names',value:'pure-button pure-button-primary'});
});
test('input type picker exposes conversion for empty controls and limits bound input types',()=>{
    const onPropose=jest.fn();
    const {rerender}=render(<InputKindEditor element={{inputKind:{current:'textarea',canConvert:true,bound:false}}} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Input type'),{target:{value:'text'}});
    expect(onPropose).toHaveBeenCalledWith({kind:'input-kind',value:'text'});
    rerender(<InputKindEditor element={{inputKind:{current:'text',canConvert:false,bound:true}}} onPropose={onPropose}/>);
    expect([...screen.getByLabelText('Input type').options].map(item=>item.value)).toEqual(['text','search']);
});
