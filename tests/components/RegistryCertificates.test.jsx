import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import RegistryCertificates from '../../src/components/settings/panels/RegistryCertificates';
import configuration from '../../src/config/officialRegistry.json';
beforeEach(() => {window.electron = {settings: {certificates: {registryStatus: jest.fn(), removeRegistry: jest.fn(), importRegistry: jest.fn().mockResolvedValue({success: true})}}};});
const certificate = {id: 'fingerprint', label: 'Developer', expiresAt: new Date(Date.now() + 86400000 * 365).toISOString()};
test('an unconfigured certificate URL still renders the unavailable state', async () => {
    const previous = configuration.certificateUrl;
    configuration.certificateUrl = '';
    try {
        window.electron.settings.certificates.registryStatus.mockResolvedValue({available: false, configured: false, developers: []});
        render(<RegistryCertificates/>);
        expect(await screen.findByText('Registry unavailable')).toBeInTheDocument();
    } finally {configuration.certificateUrl = previous;}
});
test('uses Blueprint empty state before the official registry is available', async () => {
    window.electron.settings.certificates.registryStatus.mockResolvedValue({available: false, configured: false, developers: []});
    render(<RegistryCertificates/>);
    expect(await screen.findByText('Registry unavailable')).toBeInTheDocument();
    expect(screen.getByText('Registry unavailable').closest('.bp6-non-ideal-state')).not.toBeNull();
    expect(screen.getByRole('button', {name: 'Import developer certificate'})).toBeInTheDocument();
});
test('uses an explicit developer import button and refreshes after import', async () => {
    const api = window.electron.settings.certificates;
    api.registryStatus.mockResolvedValue({available: true, anchor: certificate, developers: []});
    render(<RegistryCertificates/>);
    expect(await screen.findByText('No developer certificate')).toBeInTheDocument();
    expect(screen.getByText('fingerprint')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Import developer certificate'})).toBeInTheDocument();
    api.registryStatus.mockResolvedValue({available: true, anchor: certificate, developers: [{...certificate, id: 'developer-id'}]});
    fireEvent.click(screen.getByRole('button', {name: 'Import developer certificate'}));
    await waitFor(() => expect(api.importRegistry).toHaveBeenCalledWith({kind: 'developer'}));
    expect(await screen.findByText('developer-id')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
    await waitFor(() => expect(api.removeRegistry).toHaveBeenCalledWith('developer-id'));
});
test('revocation takes precedence over a future expiry and recovery guidance is below the certificate row',async()=>{
    window.electron.settings.certificates.registryStatus.mockResolvedValue({available:true,anchor:certificate,developers:[{...certificate,id:'revoked-dev',kind:'developer',lifecycleStatus:'revoked',lifecycleError:'Developer certificate was revoked. Recover it in your registry account.'}]});
    render(<RegistryCertificates/>);
    const status=await screen.findByText('Revoked — signing blocked');
    const card=status.closest('.bp6-card');
    expect(card.textContent).not.toContain('Valid —');
    const row=screen.getByRole('button',{name:'Delete'}).parentElement;
    expect(row.contains(status)).toBe(true);
    expect(row.contains(screen.getByText('Developer certificate was revoked. Recover it in your registry account.'))).toBe(false);
    expect(screen.getByRole('button',{name:'Open registry account'})).toBeInTheDocument();
});
test('an offline registry keeps imported identities visible and blocks signing without claiming revocation',async()=>{
    window.electron.settings.certificates.registryStatus.mockResolvedValue({available:false,configured:true,developers:[{...certificate,id:'offline-dev',kind:'developer',lifecycleStatus:'unavailable',lifecycleError:'DNS lookup failed'}]});
    render(<RegistryCertificates/>);
    expect(await screen.findByText('Status unavailable — signing blocked')).toBeInTheDocument();
    expect(screen.getByText('offline-dev')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Retry status check'})).toBeInTheDocument();
    expect(screen.queryByText('Revoked — signing blocked')).not.toBeInTheDocument();
});
