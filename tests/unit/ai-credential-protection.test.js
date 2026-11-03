jest.mock('electron', () => ({app: {}, safeStorage: {}}));
import {createAiCredentialProtection} from '../../src/utils/persistence/aiCredentialProtection';

const storage = backend => ({
    getSelectedStorageBackend: () => backend,
    isEncryptionAvailable: jest.fn(() => true),
    encryptString: jest.fn(value => Buffer.from('protected:' + value)),
    decryptString: jest.fn(bytes => bytes.toString().slice('protected:'.length)),
});
test.each(['basic_text', 'unknown', undefined])('refuses Linux backend %s without invoking encryption', backend => {
    const provider = storage(backend);
    const protection = createAiCredentialProtection({platform:'linux',application:{isReady:()=>true},storage:provider});
    expect(() => protection.encrypt('synthetic')).toThrow('OS credential store');
    expect(provider.encryptString).not.toHaveBeenCalled();
});
test('uses the OS provider and rejects a locked store or access before Electron is ready', () => {
    const provider = storage('gnome_libsecret');
    const protection = createAiCredentialProtection({platform:'linux',application:{isReady:()=>true},storage:provider});
    expect(protection.decrypt(protection.encrypt('synthetic'))).toBe('synthetic');
    provider.isEncryptionAvailable.mockReturnValue(false);
    expect(() => protection.decrypt(Buffer.from('data'))).toThrow('locked');
    const early = createAiCredentialProtection({platform:'win32',application:{isReady:()=>false},storage:provider});
    expect(() => early.encrypt('synthetic')).toThrow('ready');
});
