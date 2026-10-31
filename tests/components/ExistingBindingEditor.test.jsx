import React from 'react';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {ExistingBindingEditor} from '../../src/components/live-ui/ExistingBindingEditor';

const flags={preventDefault:false,stopPropagation:false,once:false,passive:false,capture:false,required:true};
const source={location:{path:'/actions.ts',line:10},code:'command: ({element}) => update(element)'};
const element=()=>({id:'button',tag:'button',sdkBindings:{reason:'',connect:{selector:'#save'},unresolved:[],setup:source,
    handlers:[{name:'command',uses:3,...source},{name:'alternative',uses:0,...source}],
    items:[{id:'binding',selector:'#save',event:'click',handler:'command',editable:true,matches:1,options:flags,...source}],
}});

test('reviews imported handler/setup source and proposes only the chosen binding settings',()=>{
    const onPropose=jest.fn(),onReveal=jest.fn();
    render(<ExistingBindingEditor element={element()} onPropose={onPropose} onReveal={onReveal}/>);
    const binding=within(screen.getByRole('region',{name:'Binding click #save'}));
    expect(binding.getByText(/Handler used by 3 bindings/)).toBeVisible();
    fireEvent.change(binding.getByLabelText('Handler'),{target:{value:'alternative'}});
    fireEvent.click(binding.getByText('Listener options'));
    fireEvent.click(binding.getByLabelText('Prevent default event'));
    fireEvent.click(binding.getByRole('button',{name:'Preview binding change'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'sdk-binding',action:'update',bindingId:'binding',event:'click',handler:'alternative',
        options:{...flags,preventDefault:true},confirmShared:false});
    fireEvent.click(binding.getByText('Handler source'));
    fireEvent.click(binding.getByRole('button',{name:'Show handler in code'}));
    expect(onReveal).toHaveBeenCalledWith({kind:'handler',name:'alternative'});
});

test('shared binding operations stay disabled until their scope is acknowledged',()=>{
    const target=element();target.sdkBindings.items[0].matches=3;
    const onPropose=jest.fn();render(<ExistingBindingEditor element={target} onPropose={onPropose}/>);
    expect(screen.getByRole('button',{name:'Disconnect binding'})).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Change this binding for all matching controls'));
    fireEvent.click(screen.getByRole('button',{name:'Disconnect binding'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'sdk-binding',action:'remove',bindingId:'binding',confirmShared:true});
});

test('conflicting listener flags block the draft and a new connection cannot duplicate an existing event',()=>{
    render(<ExistingBindingEditor element={element()} onPropose={jest.fn()}/>);
    fireEvent.click(screen.getByText('Listener options'));
    fireEvent.click(screen.getByLabelText('Passive listener'));
    fireEvent.click(screen.getByLabelText('Prevent default event'));
    expect(screen.getByRole('alert')).toHaveTextContent('passive');
    expect(screen.getByRole('button',{name:'Preview binding change'})).toBeDisabled();
    fireEvent.click(screen.getByText('Connect an existing handler'));
    fireEvent.change(screen.getByLabelText('Existing handler'),{target:{value:'command'}});
    expect(screen.getByRole('button',{name:'Preview new binding'})).toBeDisabled();
});
