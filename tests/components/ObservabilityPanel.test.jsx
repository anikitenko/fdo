import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import ObservabilityPanel from '../../src/components/settings/panels/ObservabilityPanel';
const initial = {localTracing: false, captureContent: false, retention: {runtimeDays: 7, diagnosticsDays: 30, traceDays: 30, usageDays: 365},
    langfuse: {enabled: false, host: '', publicKey: '', environment: 'production', release: '', hasSecretKey: true},
    effectiveLangfuse: {enabled: false, overridden: []}, counts: {}, traces: [], startups: []};
beforeEach(() => {
    window.electron.settings.observability = {get: jest.fn(async () => initial), save: jest.fn(async () => initial), test: jest.fn(async () => ({message: 'Connection verified.'})), retry: jest.fn()};
});
test('keeps saved secrets out of fields and saves explicit capture and retention preferences', async () => {
    render(<ObservabilityPanel/>);
    await screen.findByLabelText('Record AI traces locally');
    expect(screen.getByLabelText('Secret key')).toHaveValue('');
    fireEvent.click(screen.getByLabelText('Record AI traces locally'));
    fireEvent.change(screen.getByLabelText('Server URL'), {target: {value: 'https://cloud.langfuse.com'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save observability settings'}));
    await waitFor(() => expect(window.electron.settings.observability.save).toHaveBeenCalledWith(expect.objectContaining({localTracing: true, captureContent: false,
        langfuse: expect.objectContaining({secretKey: '', clearSecret: false})})));
    expect(await screen.findByText('Observability settings saved.')).toBeVisible();
});
test('tests without saving and reports readable connection errors', async () => {
    window.electron.settings.observability.test.mockRejectedValueOnce(new Error("Error invoking remote method 'settings:observability:test': Error: Connection failed (HTTP 401)."));
    render(<ObservabilityPanel/>);
    fireEvent.click(await screen.findByRole('button', {name: 'Test connection'}));
    expect(await screen.findByText('Connection failed (HTTP 401).')).toBeVisible();
    expect(window.electron.settings.observability.save).not.toHaveBeenCalled();
});
