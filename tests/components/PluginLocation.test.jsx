import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import PluginLocation from '../../src/components/plugin/PluginLocation';

test('copies the exact installed path and reports success', async () => {
    const writeText = jest.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText}});
    const path = '/Users/test/Library/Application Support/FDO/plugins/gitops_azure-finops';
    render(<PluginLocation path={path}/>);
    fireEvent.click(screen.getByRole('button',{name:'Copy plugin path'}));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(path));
    expect(screen.getByRole('status')).toHaveTextContent('Path copied to clipboard.');
    expect(screen.getByRole('button',{name:'Copy plugin path'})).toHaveTextContent(path);
});

test('a clipboard failure keeps the path selectable and offers manual copying', async () => {
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:jest.fn(async () => {throw new Error('Denied');})}});
    render(<PluginLocation path="/plugins/tool"/>);
    fireEvent.click(screen.getByRole('button',{name:'Copy plugin path'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select it and copy it manually.');
    expect(screen.getByText('/plugins/tool')).toBeVisible();
});
