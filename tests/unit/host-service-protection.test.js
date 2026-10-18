/** @jest-environment node */
const {expect, jest: mock, test} = require('@jest/globals');
const {createProtection} = require('../../src/utils/hostServices/protection.cjs');
const backend = (selected, available = true) => ({getSelectedStorageBackend: () => selected, isEncryptionAvailable: () => available,
    encryptString: mock.fn(value => value), decryptString: mock.fn(value => value)});
test.each(['basic_text', 'unknown', ''])('Linux rejects %s even when Electron reports availability', selected => {
    const storage = backend(selected), protection = createProtection(storage, 'linux');
    expect(() => protection.check()).toThrow(expect.objectContaining({code: 'UNAVAILABLE'}));
    expect(() => protection.encrypt('credential')).toThrow();
    expect(storage.encryptString).not.toHaveBeenCalled();
});
test.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])('Linux accepts unlocked %s only', selected => {
    expect(createProtection(backend(selected), 'linux').encrypt('credential')).toBe('credential');
    expect(() => createProtection(backend(selected, false), 'linux').check()).toThrow(expect.objectContaining({code: 'LOCKED'}));
});
test.each(['win32', 'darwin'])('%s uses OS availability and suppresses provider errors', platform => {
    const storage = backend('unknown'); storage.encryptString.mockImplementation(() => {throw new Error('credential-bearing provider detail');});
    expect(() => createProtection(storage, platform).encrypt('secret'))
        .toThrow(expect.objectContaining({message: 'Host service request failed.', code: 'LOCKED'}));
});
