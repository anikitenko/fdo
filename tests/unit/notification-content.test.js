import {pluginDisplayName, failureNotification, diagnosticText, operationError} from '../../src/utils/desktop/notificationContent';
import {notificationMetadata, notificationPreferences} from '../../src/utils/desktop/notificationModel';

test('uses display names and strips GitOps aliases when metadata is unavailable', () => {
    const id = 'gitops_ebc22207-edaf-49d1-9ff5-5dbac1384f29_cute-calculator';
    expect(pluginDisplayName({id, metadata: {name: 'Rose Calculator'}})).toBe('Rose Calculator');
    expect(pluginDisplayName({id})).toBe('cute-calculator');
    expect(pluginDisplayName(null)).toBe('Plugin');
});
test('keeps the outcome and recovery step separate from technical diagnostics', () => {
    const notice = failureNotification({source: 'builds', title: 'Calculator: build failed', message: 'Review compiler output and build again.', error: new Error('Syntax error'), details: 'Workspace: Calculator'});
    expect(notice.message).toBe('Review compiler output and build again.');
    expect(notice.details).toContain('Syntax error'); expect(notice.details).toContain('Workspace: Calculator');
    expect(operationError('Could not save', new Error("Error invoking remote method 'save': Error: Disk full"))).toContain('Could not save: Disk full');
});
test('redacts credential-bearing URLs, authorization headers and private keys from persistent diagnostics', () => {
    const text = diagnosticText('https://user:secret@example.com/repo?token=private-token\nAuthorization: Bearer private-bearer\napi_key=private-api\n-----BEGIN RSA PRIVATE KEY-----\nprivate-pem\n-----END RSA PRIVATE KEY-----');
    for (const secret of ['user:secret', 'private-token', 'private-bearer', 'private-api', 'private-pem']) expect(text).not.toContain(secret);
    expect(text).toContain('example.com');
});
test('allows only known settings destinations and honors preferences for new sources', () => {
    expect(notificationMetadata({actions: [{kind: 'view-settings', tab: 'certificates'}, {kind: 'view-settings', tab: 'arbitrary-code'}, {kind: 'execute', script: 'bad'}]}).actions).toEqual([{kind: 'view-settings', tab: 'certificates'}]);
    expect(notificationPreferences({mutedSources: ['ai', 'observability', 'security', 'arbitrary']})).toMatchObject({mutedSources: ['security', 'ai', 'observability']});
});
