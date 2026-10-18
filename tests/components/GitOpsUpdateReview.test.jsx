import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import GitOpsUpdateReview from '../../src/components/settings/panels/GitOpsUpdateReview';
const pending={name:'remote-commands',reviewId:'review',currentVersion:'1.0.0',version:'2.0.0',currentCommit:'a'.repeat(40),commit:'b'.repeat(40),repository:'https://github.com/acme/plugin',targetRevision:'main',addedCapabilities:['ssh.status.watch','secrets.consume'],removedCapabilities:[],inspectionError:''};

test('requires an explicit selection for every additional grant and submits only the reviewed version',async()=>{
 const onDecision=jest.fn(async()=>({success:true}));render(<GitOpsUpdateReview pending={pending} onDecision={onDecision} busy={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Review permissions'}));
 const approve=screen.getByRole('button',{name:'Grant listed permissions and update'});expect(approve).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:/Monitor SSH connection status/}));expect(approve).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:/Use credential references/}));expect(approve).toBeEnabled();
 fireEvent.click(approve);await waitFor(()=>expect(onDecision).toHaveBeenCalledWith({pluginName:pending.name,reviewId:'review',decision:'approve',capabilities:pending.addedCapabilities}));
});
test('decline needs no grants and failed approval stays visible without hiding its reason',async()=>{
 const onDecision=jest.fn(async()=>({success:false,error:'This review was replaced.'}));render(<GitOpsUpdateReview pending={pending} onDecision={onDecision} busy={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Review permissions'}));fireEvent.click(screen.getByRole('button',{name:'Decline this version'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('This review was replaced.'));
 expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({decision:'decline',capabilities:[]}));
});
test('uninspectable declarations cannot be approved',()=>{
 render(<GitOpsUpdateReview pending={{...pending,inspectionError:'Use a static declaration.'}} onDecision={jest.fn()} busy={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Review permissions'}));expect(screen.getByRole('button',{name:'Grant listed permissions and update'})).toBeDisabled();
 expect(screen.getByText('Use a static declaration.')).toBeVisible();
});
