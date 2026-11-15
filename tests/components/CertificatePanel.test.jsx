import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {CertificatePanel} from '../../src/components/settings/panels/CertificatePanel';
jest.mock('../../src/components/AppToaster', () => ({AppToaster: {show: jest.fn()}}));
beforeEach(() => {
    window.electron = {
        system: {openFileDialog: jest.fn()},
        settings: {certificates: {
            getRoot: jest.fn().mockResolvedValue([]),
            registryStatus: jest.fn().mockResolvedValue({available: false, configured: false, developers: []}),
            listOrganizations: jest.fn().mockResolvedValue([]),
            import: jest.fn().mockResolvedValue({success: true}),
        }},
    };
});
test('root import refreshes root certificates after the import completes', async () => {
    const api = window.electron.settings.certificates;
    window.electron.system.openFileDialog.mockResolvedValue('/root.pem');
    let finishImport;
    api.import.mockReturnValue(new Promise(resolve => {finishImport = resolve;}));
    render(<CertificatePanel/>);
    await screen.findByText('Registry unavailable');
    expect(screen.getAllByRole('button', {name: 'Import root certificate'})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', {name: 'Import root certificate'}));
    await waitFor(() => expect(api.import).toHaveBeenCalledWith('/root.pem'));
    expect(api.registryStatus).toHaveBeenCalledTimes(1);
    finishImport({success: true});
    await waitFor(() => expect(api.getRoot).toHaveBeenCalledTimes(2));
    expect(api.getRoot).toHaveBeenCalledTimes(2);
});
test('canceling file selection leaves certificate inventories unchanged', async () => {
    window.electron.system.openFileDialog.mockResolvedValue(null);
    render(<CertificatePanel/>);
    await screen.findByText('Registry unavailable');
    fireEvent.click(screen.getByRole('button', {name: 'Import root certificate'}));
    await waitFor(() => expect(window.electron.system.openFileDialog).toHaveBeenCalledTimes(1));
    expect(window.electron.settings.certificates.import).not.toHaveBeenCalled();
});
