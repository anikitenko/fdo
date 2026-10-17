import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import GitOpsBadge from '../../src/components/plugin/GitOpsBadge';

const plugin = {id: 'gitops_source_cute-calculator', name: 'Cute Calculator', gitops: {
    sourceId: 'source', declaredId: 'cute-calculator', repository: 'https://github.com/acme/calculator',
    targetRevision: 'v1.0.0', path: '/plugin', commit: 'a'.repeat(40),
}};
const collection = {id: 'source', url: 'https://github.com/acme/collection', targetRevision: 'main', revisionType: 'branch',
    manifestPath: 'plugins.yaml', commit: 'b'.repeat(40), checkIntervalMinutes: 90, autoSync: false,
    lastCheckedAt: '2026-10-17T12:00:00Z', lastSyncedAt: '2026-10-17T11:00:00Z',
    manifest: {metadata: {name: 'team-tools', displayName: 'Team Tools', version: '1.2.0'}, spec: {plugins: [{name: 'cute-calculator', targetRevision: 'v1.1.0'}]}},
    encryptedCredentials: 'PRIVATE_CIPHERTEXT', password: 'PRIVATE_PASSWORD',
    pluginStatuses: [{name: 'cute-calculator', state: 'error', error: 'The declared version is unavailable. Contact the collection maintainer.'}],
};
beforeEach(() => {
    window.electron = {settings: {gitops: {list: jest.fn(async () => ({success: true, repositories: [collection]})),
        sync: jest.fn(), save: jest.fn(), remove: jest.fn()}}, system: {openExternal: jest.fn()}};
});

test('opens a prominent GitOps button with read-only installed, collection and signing information', async () => {
    render(<GitOpsBadge plugin={plugin} verification={{success: true, signer: {label: 'root', key: 'PRIVATE_KEY'}}}/>);
    const badge = screen.getByRole('button', {name: 'View GitOps details for Cute Calculator'});
    expect(badge).toHaveTextContent(/^GitOps$/);
    expect(badge).toHaveClass('bp6-intent-primary');
    expect(window.electron.settings.gitops.list).not.toHaveBeenCalled();
    fireEvent.click(badge);
    const popup = await screen.findByRole('dialog', {name: 'GitOps details'});
    await within(popup).findByText('Team Tools');
    for (const value of [plugin.id, plugin.gitops.commit, collection.commit, 'v1.0.0', 'v1.1.0', 'root', 'Verified', 'Paused', '1h 30m']) {
        expect(within(popup).getByText(value, {exact: true})).toBeInTheDocument();
    }
    expect(within(popup).getByText(/Contact the collection maintainer/)).toBeInTheDocument();
    expect(popup.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(popup.textContent).not.toMatch(/PRIVATE_CIPHERTEXT|PRIVATE_PASSWORD|PRIVATE_KEY/);
    expect(window.electron.settings.gitops.sync).not.toHaveBeenCalled();
    expect(window.electron.settings.gitops.save).not.toHaveBeenCalled();
    expect(window.electron.settings.gitops.remove).not.toHaveBeenCalled();
    const link = within(popup).getByRole('link', {name: plugin.gitops.repository});
    fireEvent.click(link);
    expect(window.electron.system.openExternal).toHaveBeenCalledWith(plugin.gitops.repository);
    fireEvent.click(within(popup).getAllByRole('button', {name: 'Close', exact: true}).at(-1));
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'GitOps details'})).not.toBeInTheDocument());
});

test('keeps recorded provenance visible when collection details cannot be loaded', async () => {
    window.electron.settings.gitops.list.mockRejectedValue(new Error('unavailable'));
    render(<GitOpsBadge plugin={plugin} verification={{success: false, error: 'Signature mismatch'}}/>);
    fireEvent.click(screen.getByRole('button', {name: /View GitOps details/}));
    expect(await screen.findByText(/Collection details are currently unavailable/)).toBeInTheDocument();
    expect(screen.getByText(plugin.gitops.commit)).toBeInTheDocument();
    expect(screen.getByText('Signature mismatch')).toBeInTheDocument();
    expect(screen.getByText('Verification failed')).toBeInTheDocument();
});

test('does not show a GitOps badge for a local plugin', () => {
    render(<GitOpsBadge plugin={{id: 'local', name: 'Local Plugin'}}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(window.electron.settings.gitops.list).not.toHaveBeenCalled();
});
