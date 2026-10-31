import React from 'react';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import DeploymentRequirements from '../../src/components/plugin/DeploymentRequirements';
import {workspaceDeployment} from '../../src/utils/plugins/deployment/workspaceDeployment';
const source={'/package.json':JSON.stringify({name:'cloud',source:'index.ts'}),'/index.ts':"createScopedProcessExecActionRequest('cloud',{command:'/usr/bin/az',args:[]});"};
const context=()=>workspaceDeployment(source);

test('engineers can review source-detected tools while installation and cloud identity remain explicitly unverified',async()=>{
    const review=jest.fn().mockResolvedValue({status:'ready'});
    render(<DeploymentRequirements context={context()} onReview={review}/>);
    expect(screen.getByText('Installation: not run here')).toBeVisible();expect(screen.getByText('Cloud sign-in / roles: not verified')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Review detected tools'}));
    const dialog=screen.getByRole('dialog',{name:'Manage deployment requirements'});
    expect(within(dialog).getByText('azure-cli',{exact:true})).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Version constraint for azure-cli'),{target:{value:'^2.91.0'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Preview deployment changes'}));
    await waitFor(()=>expect(review).toHaveBeenCalledWith({kind:'deployment',declaration:{schemaVersion:1,tools:[{id:'azure-cli',version:'^2.91.0'}]}}));
});

test('custom binary trust must be supplied before preview, without downloading or authentication',()=>{
    render(<DeploymentRequirements context={context()} onReview={jest.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Manage deployment requirements'}));
    const dialog=screen.getByRole('dialog',{name:'Manage deployment requirements'});
    fireEvent.click(within(dialog).getByRole('button',{name:'Add custom tool'}));
    expect(within(dialog).getByRole('button',{name:'Preview deployment changes'})).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Installation'),{target:{value:'artifact'}});
    expect(within(dialog).getByLabelText('Public HTTPS artifact URL')).toBeVisible();expect(within(dialog).getByLabelText('Publisher-verified SHA-256')).toBeVisible();
    expect(within(dialog).getByRole('button',{name:'Preview deployment changes'})).toBeDisabled();
});

test('AI view offers an explicit handoff and a prepared review without pretending to run deployment checks',()=>{
    const manage=jest.fn(),ask=jest.fn();render(<DeploymentRequirements context={context()} onManage={manage} onAsk={ask}/>);
    fireEvent.click(screen.getByRole('button',{name:'Manage in Live UI'}));expect(manage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Prepare AI deployment review'}));expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button',{name:/login|authenticate|install/i})).not.toBeInTheDocument();
});

test('a workspace update cannot silently replace a declaration from an old open dialog',()=>{
    const review=jest.fn();const component=render(<DeploymentRequirements context={context()} onReview={review}/>);
    fireEvent.click(screen.getByRole('button',{name:'Manage deployment requirements'}));
    const changed=workspaceDeployment({...source,'/package.json':JSON.stringify({name:'cloud',source:'index.ts',fdo:{deployment:{schemaVersion:1,tools:[{id:'jq'}]}}})});
    component.rerender(<DeploymentRequirements context={changed} onReview={review}/>);
    expect(screen.getByText(/workspace declaration changed/)).toBeVisible();expect(screen.getByRole('button',{name:'Preview deployment changes'})).toBeDisabled();
});
