/** @jest-environment node */
import {normalizePluginDoctorPresentation} from '../../src/ipc/pluginDoctorPresentation';
import {getSdkHandshake} from '@anikitenko/fdo-sdk';

test('normalizes real SDK 1.5.2 diagnostics in Node without renderer module loading', () => {
    const diagnostics = {
        pluginId: 'local-json-validator', apiVersion: '1.0.0',
        handshake: getSdkHandshake(),
        health: {status: 'healthy', errorCount: 0, initCount: 1, renderCount: 2, handlerCount: 0},
        capabilities: {registeredHandlers: ['refreshStatus'], registeredStores: ['default', 'json'],
            declaration: {declared: [], missing: [], undeclaredGranted: []},
            permissions: {granted: [], usageCount: {}, deniedCount: {}}},
        notifications: {count: 0, capacity: 100, recent: []},
    };
    const presentation = normalizePluginDoctorPresentation(diagnostics, {includeInfo: true});
    expect(presentation.mode).toBe('doctor');
    expect(presentation.handshakeOptions.expectedCapabilitySchemaVersion).toBe('1.0.0');
    expect(presentation.handshakeCompatibility.status).toBe('compatible');
    expect(presentation.panelModel).toBeTruthy();
    expect(presentation.report.findings.some(f => f.code === 'HANDSHAKE_CAPABILITY_SCHEMA_MISMATCH')).toBe(false);
});
