/** @jest-environment node */
import {parseDeepLink, createDeepLinkQueue} from '../../src/utils/system/deepLinks';
const link = 'fdo-fiddle://registry/plugins/example/1.2.3';
test('accepts only a registry identity and exact semver', () => {
    expect(parseDeepLink(link)).toEqual({id:'example',version:'1.2.3'});
    expect(parseDeepLink(link.replace('1.2.3','1.2.3-beta.1%2Bbuild.2')).version).toBe('1.2.3-beta.1+build.2');
});
test('private links reference only a previously connected registry ID without introducing an endpoint or pin', () => {
    const registryId = 'org-' + 'a'.repeat(24);
    expect(parseDeepLink(link.replace('registry/plugins/', `registry/${registryId}/plugins/`))).toEqual({id: 'example', version: '1.2.3', registryId});
    expect(() => parseDeepLink(link.replace('registry/plugins/', 'registry/https%3A%2F%2Fevil.test/plugins/'))).toThrow();
});
test('identical releases from different private registries are not coalesced', async () => {
    const handle = jest.fn().mockResolvedValue({});
    const queue = createDeepLinkQueue({handle, report: jest.fn()});
    queue.enqueue(link.replace('registry/plugins/', `registry/org-${'a'.repeat(24)}/plugins/`));
    queue.enqueue(link.replace('registry/plugins/', `registry/org-${'b'.repeat(24)}/plugins/`));
    queue.start(); await new Promise(setImmediate);
    expect(handle).toHaveBeenCalledTimes(2);
});
test.each([
    'https://registry/plugins/example/1.2.3', link+'?url=https://evil.test',link+'#x',
    link.replace('registry/','registry.evil/'),link.replace('example','%2e%2e'),
    link.replace('example','one%2ftwo'), link.replace('1.2.3','latest'),
    link.replace('1.2.3','v1.2.3'),link.replace('1.2.3','%ZZ'), link+'/extra',
    'fdo-fiddle://user@registry/plugins/example/1.2.3',
])('rejects unsafe or unsupported route %s', value => expect(() => parseDeepLink(value)).toThrow());
test('queues before readiness and deduplicates while an installation is open', async () => {
    let finish;
    const handle = jest.fn(() => new Promise(resolve => {finish=resolve;}));
    const report = jest.fn();
    const queue = createDeepLinkQueue({handle,report});
    queue.enqueue(link); queue.enqueue(link);
    expect(handle).not.toHaveBeenCalled();
    queue.start(); queue.enqueue(link); queue.enqueue(link.replace('example','another'));
    expect(handle).toHaveBeenCalledTimes(1);
    finish(); await new Promise(setImmediate);
    expect(handle).toHaveBeenCalledTimes(2);
    finish(); await new Promise(setImmediate);
    expect(report).not.toHaveBeenCalled();
});
test('failures do not prevent the next queued installation', async () => {
    const handle = jest.fn().mockRejectedValueOnce(new Error('revoked')).mockResolvedValueOnce({});
    const report = jest.fn();
    const queue = createDeepLinkQueue({handle,report,limit:2});
    queue.enqueue(link); queue.enqueue(link.replace('example','next')); queue.enqueue(link.replace('example','overflow'));
    queue.start(); await new Promise(setImmediate);
    expect(handle).toHaveBeenCalledTimes(2); expect(report).toHaveBeenCalledTimes(2);
});
