import React from 'react';
import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {HandlerManager} from '../../src/components/live-ui/HandlerManager';

const target=()=>({handlerContainer:{names:['command','unused','commandCopy']},handlers:[
    {name:'command',uses:3,referencesComplete:true,location:{path:'/actions.ts',line:4},code:'command: () => {}',functionSource:'() => {}'},
    {name:'unused',uses:0,referencesComplete:true,location:{path:'/actions.ts',line:5},code:'unused: () => {}',functionSource:'() => {}'},
]});
const mount=(props={})=>render(<HandlerManager target={target()} selection="command" onSelectionChange={jest.fn()} open onToggle={jest.fn()} onPropose={jest.fn()} {...props}/>);
const dialog=()=>within(screen.getByRole('dialog'));

test('editing a shared callback requires scope acknowledgement and submits its complete code',async()=>{
    const onPropose=jest.fn().mockResolvedValue({status:'ready'});mount({onPropose});
    expect(screen.getByRole('button',{name:'Remove unused handler'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Edit handler code'}));
    const modal=dialog(),submit=modal.getByRole('button',{name:'Preview handler change'});
    fireEvent.change(modal.getByLabelText('Handler function'),{target:{value:'({element}) => { element?.focus(); }'}});
    expect(submit).toBeDisabled();
    fireEvent.click(modal.getByLabelText('Apply this handler change to all its bindings'));
    fireEvent.click(submit);
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onPropose).toHaveBeenCalledWith({kind:'sdk-handler',action:'update',handler:'command',code:'({element}) => { element?.focus(); }',confirmSharedHandler:true});
});

test('host validation errors retain the dialog and entered code with an inline actionable error',async()=>{
    const onPropose=jest.fn().mockResolvedValue({status:'error',message:"Error invoking remote method 'live-ui:propose': Error: Handler syntax: Unexpected token"});
    mount({onPropose});fireEvent.click(screen.getByRole('button',{name:'New click handler'}));
    const modal=dialog();
    expect(modal.queryByText(/Supply a handler name/)).not.toBeInTheDocument();
    fireEvent.change(modal.getByLabelText('Handler name'),{target:{value:'newClick'}});
    fireEvent.change(modal.getByLabelText('Handler function'),{target:{value:'() => {'}});
    fireEvent.click(modal.getByRole('button',{name:'Preview handler change'}));
    await waitFor(()=>expect(modal.getByRole('alert')).toHaveTextContent('Handler syntax: Unexpected token'));
    expect(modal.getByRole('alert')).not.toHaveTextContent('Error invoking remote');
    expect(modal.getByLabelText('Handler function')).toHaveValue('() => {');
    expect(onPropose).toHaveBeenCalledWith({kind:'sdk-handler',action:'create',name:'newClick',code:'() => {',confirmSharedHandler:false});
});

test('rename updates selection after a successful draft, and duplicate suggests an available name',async()=>{
    const onSelectionChange=jest.fn(),onPropose=jest.fn().mockResolvedValue({status:'ready'});mount({onSelectionChange,onPropose});
    fireEvent.click(screen.getByRole('button',{name:'Rename handler'}));
    expect(dialog().getByRole('button',{name:'Preview handler change'})).toBeDisabled();
    fireEvent.change(dialog().getByLabelText('Handler name'),{target:{value:'availability'}});
    fireEvent.click(dialog().getByLabelText('Apply this handler change to all its bindings'));
    fireEvent.click(dialog().getByRole('button',{name:'Preview handler change'}));
    await waitFor(()=>expect(onSelectionChange).toHaveBeenCalledWith('availability'));
    expect(onPropose).toHaveBeenCalledWith({kind:'sdk-handler',action:'rename',handler:'command',name:'availability',confirmSharedHandler:true});
    fireEvent.click(screen.getByRole('button',{name:'Duplicate handler'}));
    expect(dialog().getByLabelText('Handler name')).toHaveValue('commandCopy2');
});

test('unused removal is available while dynamic references keep destructive changes protected',()=>{
    const {unmount}=mount({selection:'unused'});
    fireEvent.click(screen.getByRole('button',{name:'Remove unused handler'}));
    expect(dialog().getByText(/Undo restores its code/)).toBeVisible();
    unmount();const dynamic=target();dynamic.handlers[1].referencesComplete=false;
    mount({target:dynamic,selection:'unused'});
    expect(screen.getByRole('button',{name:'Remove unused handler'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Rename handler'})).toBeDisabled();
});
