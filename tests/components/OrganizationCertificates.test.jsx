import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import OrganizationCertificates from '../../src/components/settings/panels/OrganizationCertificates';

const connection = {id: 'org-' + 'a'.repeat(24), name: 'Acme Engineering', url: 'https://plugins.acme.test', rootFingerprint256: 'b'.repeat(64)};
const developer = {id: `${connection.id}/fingerprint`, scope: 'org', registryId: connection.id, registryName: connection.name,
    label: 'CN=Alice,O=Acme', kind: 'developer', imported: true, expiresAt: new Date(Date.now() + 365 * 86400000).toISOString()};
let api;
beforeEach(() => {
    api = {listOrganizations: jest.fn().mockResolvedValue([]), addOrganization: jest.fn().mockResolvedValue({success: true, connection}),
        organizationStatus: jest.fn().mockResolvedValue({available: true, developers: []}),
        importOrganization: jest.fn().mockResolvedValue({success: true}), removeOrganizationCertificate: jest.fn().mockResolvedValue(),
        removeOrganization: jest.fn().mockResolvedValue()};
    window.electron = {settings: {certificates: api}, system: {openExternal: jest.fn()}};
});
async function openForm() {
    render(<OrganizationCertificates/>);
    await screen.findByText('No private registries connected');
    fireEvent.click(screen.getByRole('button', {name: 'Connect private registry'}));
    fireEvent.change(screen.getByLabelText('Organization name'), {target: {value: connection.name}});
    fireEvent.change(screen.getByLabelText('Registry HTTPS address'), {target: {value: connection.url}});
    fireEvent.change(screen.getByLabelText('Root certificate SHA-256 fingerprint'), {target: {value: connection.rootFingerprint256}});
}
test('connects only after verifying the supplied public configuration and preserves errors for correction', async () => {
    api.addOrganization.mockResolvedValueOnce({success: false, error: 'Registry root fingerprint does not match'});
    await openForm();
    fireEvent.click(screen.getByRole('button', {name: 'Verify and connect'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('fingerprint does not match');
    expect(screen.getByLabelText('Organization name')).toHaveValue(connection.name);
    expect(api.addOrganization).toHaveBeenCalledWith({name: connection.name, url: connection.url, rootFingerprint256: connection.rootFingerprint256});
    api.listOrganizations.mockResolvedValue([connection]);
    fireEvent.click(screen.getByRole('button', {name: 'Verify and connect'}));
    expect(await screen.findByRole('region', {name: 'Acme Engineering signing certificates'})).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.organizationStatus).toHaveBeenCalledWith(connection.id);
});
test('cancels onboarding without changing connections and disables malformed fingerprints', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Root certificate SHA-256 fingerprint'), {target: {value: 'untrusted'}});
    expect(screen.getByRole('button', {name: 'Verify and connect'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    expect(api.addOrganization).not.toHaveBeenCalled();
});
test('reuses scoped import and removal and keeps revoked identities visible with their account recovery link', async () => {
    api.listOrganizations.mockResolvedValue([connection]);
    api.organizationStatus.mockResolvedValue({available: true, developers: [{...developer, lifecycleStatus: 'revoked', lifecycleError: 'Revoked by Acme'}]});
    render(<OrganizationCertificates/>);
    expect(await screen.findByText('Revoked — signing blocked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Import developer certificate'}));
    await waitFor(() => expect(api.importOrganization).toHaveBeenCalledWith(connection.id));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Delete'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
    await waitFor(() => expect(api.removeOrganizationCertificate).toHaveBeenCalledWith(connection.id, developer.id));
    fireEvent.click(screen.getAllByRole('button', {name: 'Open registry account'})[0]);
    expect(window.electron.system.openExternal).toHaveBeenCalledWith(connection.url + '/profile');
});
test('requires explicit confirmation before removing a registry and its local keys', async () => {
    api.listOrganizations.mockResolvedValue([connection]);
    render(<OrganizationCertificates/>);
    fireEvent.click(await screen.findByRole('button', {name: 'Disconnect registry'}));
    expect(api.removeOrganization).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation).toHaveTextContent('running plugins will stop');
    api.listOrganizations.mockResolvedValue([]);
    fireEvent.click(within(confirmation).getByRole('button', {name: 'Disconnect registry'}));
    await waitFor(() => expect(api.removeOrganization).toHaveBeenCalledWith(connection.id));
    expect(await screen.findByText('No private registries connected')).toBeInTheDocument();
});
test('a failed inventory load is recoverable', async () => {
    api.listOrganizations.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<OrganizationCertificates/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    expect(await screen.findByText('No private registries connected')).toBeInTheDocument();
});
test('a successful connection remains visible when reloading the inventory fails', async () => {
    await openForm();
    api.listOrganizations.mockRejectedValueOnce(new Error('Storage busy'));
    fireEvent.click(screen.getByRole('button', {name: 'Verify and connect'}));
    expect(await screen.findByRole('region', {name: 'Acme Engineering signing certificates'})).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Registry connected. Could not refresh the list: Storage busy');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
