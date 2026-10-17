import {notificationMetadata, notificationPreferences, notificationSource, shouldAlert} from '../../src/utils/desktop/notificationModel';

test('infers sources for legacy history and normalizes preferences', () => {
    expect(notificationSource({title: 'Build success'})).toBe('builds');
    expect(notificationSource({title: 'Error rendering plugin'})).toBe('plugins');
    expect(notificationSource({title: 'Plugin updated via GitOps'})).toBe('gitops');
    expect(notificationPreferences({retentionDays: -1, mutedSources: ['gitops', 'unknown'], successToasts: false})).toMatchObject({retentionDays: 0, mutedSources: ['gitops'], successToasts: false});
    expect(shouldAlert({source: 'gitops', type: 'danger'}, notificationPreferences({mutedSources: ['gitops']}))).toBe(false);
});

test('only recognizes safe navigation actions and bounded metadata', () => {
    const metadata = notificationMetadata({source: 'plugins', details: 'a'.repeat(40000), actions: [
        {kind: 'execute', command: 'bad'}, {kind: 'open-repository', url: 'javascript:alert(1)'}, {kind: 'open-repository', url: 'https://github.com/acme/plugin'},
    ]});
    expect(metadata.details).toHaveLength(30000);
    expect(metadata.actions).toEqual([{kind: 'open-repository', url: 'https://github.com/acme/plugin'}]);
});

test('presents historical ready handshakes with display names and the Plugins source', () => {
    const {notificationPresentation} = require('../../src/utils/desktop/notificationModel');
    const id = 'gitops_ebc22207-edaf-49d1-9ff5-5dbac1384f29_cute-calculator';
    const original = {id: 'notice', title: `${id} is ready`, message: '', source: 'builds'};
    const shown = notificationPresentation(original, [{id, metadata: {name: 'Rose Calculator'}}]);
    expect(shown).toMatchObject({id: 'notice', title: 'Rose Calculator started', source: 'plugins'});
    expect(shown.details).toContain(id);
    expect(original.title).toContain('is ready');
    expect(notificationPresentation(original).title).toBe('cute-calculator started');
    expect(notificationSource({title: 'Build plugin stopped', source: 'plugins'})).toBe('plugins');
});
