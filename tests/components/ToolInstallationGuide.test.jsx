import React from 'react';
import {render, screen, fireEvent, within, waitFor} from '@testing-library/react';
import ContainerToolSetup, {ToolInstallationGuide} from '../../src/components/plugin/ToolInstallationGuide';

test('the compact editor bar keeps detailed instructions in a separate, dismissible guide', async () => {
    render(<ContainerToolSetup/>);
    const bar = screen.getByRole('region', {name: 'Container tool setup'});
    expect(within(bar).queryByText('Finish and verify')).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', {name: 'Installation guide'}));
    expect(screen.getByRole('dialog', {name: 'Container tool installation guide'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Close guide'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(within(bar).getByRole('button', {name: 'Hide tool setup guidance'}));
    expect(screen.queryByRole('region', {name: 'Container tool setup'})).not.toBeInTheDocument();
});

test('custom installer guidance includes explicit templates, persistent workflow and copy feedback', async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    render(<ToolInstallationGuide/>);
    fireEvent.click(screen.getByRole('button', {name: 'Installation guide'}));
    const dialog = screen.getByRole('dialog');
    const method = within(dialog).getByLabelText('How is the tool distributed?');
    fireEvent.change(method, {target: {value: 'apt'}});
    expect(within(dialog).getByText(/Repositories must already be configured/)).toBeVisible();
    fireEvent.change(method, {target: {value: 'artifact'}});
    expect(within(dialog).getByText(/Template: replace the example URL and hash/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Copy example'}));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(JSON.parse(writeText.mock.calls[0][0]).fdo.deployment.tools[0].installer.platforms['linux/amd64'].format).toBe('tar.gz');
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Example copied');
    fireEvent.change(method, {target: {value: 'image'}});
    expect(within(dialog).getByText(/Shell installer snippets are not accepted/)).toBeVisible();
    expect(within(dialog).getByText(/commit the declaration to its source repository/)).toBeVisible();
    expect(within(dialog).getByText('docker compose exec application node tools.cjs check')).toBeVisible();
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
});
