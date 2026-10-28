import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {PluginSupportEditor} from '../../src/components/live-ui/PluginSupportEditor';
import {workspaceAuthoringContract} from '../../src/utils/sdk/pluginAuthoringContract';

function futureHost(declaration) {
    const host = {fdo: '3.4.5', sdk: '7.8.9', api: '2.3.4', features: {futureHostFeature: true}};
    const context = workspaceAuthoringContract({'/package.json': JSON.stringify({name: 'tools', ...(declaration ? {fdo: {compatibility: declaration}} : {})})}, host);
    context.contract = {...context.contract, apiVersion: host.api, featureFlags: host.features};
    return context;
}

test('version defaults and feature choices come from the connected host, not UI literals', async () => {
    const onReview = jest.fn(async () => ({status: 'ready'}));
    render(<PluginSupportEditor context={futureHost()} onReview={onReview}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Adjust supported versions'}));
    expect(screen.getByLabelText('Supported FDO range')).toHaveValue('>=3.4.5 <4.0.0');
    expect(screen.getByLabelText('Supported SDK range')).toHaveValue('>=7.8.9 <8.0.0');
    expect(screen.getByLabelText('Supported host API range')).toHaveValue('^2.3.4');
    expect(screen.getByLabelText('futureHostFeature')).toBeVisible();
    expect(screen.queryByLabelText('pluginDoctorReport')).toBeNull();
    fireEvent.click(screen.getByLabelText('futureHostFeature'));
    fireEvent.click(screen.getByRole('button', {name: 'Preview support changes'}));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({kind: 'compatibility', requirements: {
        fdo: '>=3.4.5 <4.0.0', sdk: '>=7.8.9 <8.0.0', api: '^2.3.4', features: ['futureHostFeature']}}));
});

test('adding missing fields asks the host to fill them without submitting replacement sources', async () => {
    const onReview = jest.fn(async () => ({status: 'ready'}));
    render(<PluginSupportEditor context={futureHost({fdo: '>=3 <4'})} onReview={onReview}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Add missing support fields'}));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({kind: 'compatibility', mode: 'missing'}));
});

test('invalid ranges cannot be previewed and host defaults do not remove selected required features', () => {
    render(<PluginSupportEditor context={futureHost({fdo: '^3', sdk: '^7', api: '^2', features: ['futureHostFeature']})} onReview={jest.fn()}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Adjust supported versions'}));
    fireEvent.change(screen.getByLabelText('Supported FDO range'), {target: {value: 'latest'}});
    expect(screen.getByRole('button', {name: 'Preview support changes'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Use current host defaults'}));
    expect(screen.getByLabelText('Supported FDO range')).toHaveValue('>=3.4.5 <4.0.0');
    expect(screen.getByLabelText('futureHostFeature')).toBeChecked();
});

test('an unchanged request shows an inline informational message without a dialog or Inspector instruction', async () => {
    const onReview = jest.fn(async () => ({status: 'unchanged', message: 'These support settings already match. No changes were added.'}));
    render(<PluginSupportEditor context={futureHost()} onReview={onReview}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Add missing support fields'}));
    expect(await screen.findByRole('status')).toHaveTextContent('These support settings already match. No changes were added.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
});

test('support errors stay next to the action and can be retried', async () => {
    const onReview = jest.fn().mockResolvedValueOnce({status: 'error', message: 'Reconnect to the IDE to change support settings.'})
        .mockResolvedValueOnce({status: 'ready'});
    render(<PluginSupportEditor context={futureHost()} onReview={onReview}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Add missing support fields'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect to the IDE to change support settings.');
    fireEvent.click(screen.getByRole('button', {name: 'Add missing support fields'}));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onReview).toHaveBeenCalledTimes(2);
});

test('transport errors show their reason inside the open editor and preserve input', async () => {
    const onReview = jest.fn(async () => {throw new Error("Error invoking remote method 'live-ui:propose': Error: The IDE disconnected. Reconnect and try again.");});
    render(<PluginSupportEditor context={futureHost()} onReview={onReview}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Adjust supported versions'}));
    fireEvent.change(screen.getByLabelText('Supported FDO range'), {target: {value: '>=3.5 <4'}});
    fireEvent.click(screen.getByRole('button', {name: 'Preview support changes'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^The IDE disconnected. Reconnect and try again\.$/);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Supported FDO range')).toHaveValue('>=3.5 <4');
});
