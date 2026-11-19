/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {app, safeStorage} from 'electron';
import {settings} from '../../src/utils/persistence/store';
import {initializeCertificateStorage, certificateStorage, closeCertificateStorage, previewSigningCertificates} from '../../src/utils/persistence/certificateStorage';
import {certificateFixture} from '../helpers/certificateFixture.cjs';

jest.mock('electron', () => ({app: {isReady: jest.fn(() => true)}, safeStorage: {
    isEncryptionAvailable: jest.fn(), getSelectedStorageBackend: jest.fn(), encryptString: jest.fn(), decryptString: jest.fn(),
}}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(), delete: jest.fn()}}));
let directory, root;
beforeAll(async () => {root = await certificateFixture();});
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-certificate-storage-'));
    settings.path = path.join(directory, 'settings.json');
    settings.get.mockReturnValue({root: [root]}); settings.delete.mockClear();
    safeStorage.encryptString.mockClear();
});
afterEach(() => {closeCertificateStorage(); fs.rmSync(directory, {recursive: true, force: true});});

test.each([[false, 'unknown'], [true, 'basic_text']])('refuses insecure key storage (available=%s, backend=%s) and retains settings', (available, backend) => {
    safeStorage.isEncryptionAvailable.mockReturnValue(available);
    safeStorage.getSelectedStorageBackend.mockReturnValue(backend);
    expect(() => initializeCertificateStorage()).toThrow('OS credential store');
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(settings.delete).not.toHaveBeenCalled();
});

test('requires app readiness before touching certificate storage', () => {
    app.isReady.mockReturnValueOnce(false);
    expect(() => certificateStorage.list()).toThrow('Electron to be ready');
    expect(fs.existsSync(path.join(directory, 'certificates.sqlite'))).toBe(false);
});

test('preview reads legacy public metadata without migrating or encrypting keys', () => {
    expect(previewSigningCertificates()).toEqual([{...root, key: undefined, hasPrivateKey: true}]);
    expect(settings.delete).not.toHaveBeenCalled();
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(directory, 'certificates.sqlite'))).toBe(false);
});

test.each(['registry', 'org'])('public %s anchors do not migrate legacy signing keys', scope => {
    let legacy = {root: [root]};
    settings.get.mockImplementation(() => legacy);
    settings.delete.mockImplementation(() => {legacy = undefined;});
    safeStorage.isEncryptionAvailable.mockReturnValue(true);
    safeStorage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    safeStorage.encryptString.mockImplementation(value => Buffer.from(value));
    safeStorage.decryptString.mockImplementation(value => value.toString());
    const {key, ...anchor} = {...root, id: 'public-anchor', kind: 'anchor'};

    certificateStorage.put(anchor, scope);
    expect(certificateStorage.list(scope)).toMatchObject([{id: 'public-anchor', hasPrivateKey: false}]);
    expect(certificateStorage.list('root')).toMatchObject([{id: root.id, hasPrivateKey: true}]);
    expect(settings.delete).not.toHaveBeenCalled();
    expect(safeStorage.encryptString).not.toHaveBeenCalled();

    certificateStorage.put({...root, id: 'new-signer'}, 'root');
    expect(settings.delete).toHaveBeenCalledWith('certificates');
    expect(certificateStorage.privateKey(root.id)).toBe(key);
});

test('a public anchor matching a legacy record still migrates before replacement', () => {
    let legacy = {registry: [{...root, kind: 'anchor'}]};
    settings.get.mockImplementation(() => legacy);
    settings.delete.mockImplementation(() => {legacy = undefined;});
    safeStorage.isEncryptionAvailable.mockReturnValue(true);
    safeStorage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    safeStorage.encryptString.mockImplementation(value => Buffer.from(value));
    safeStorage.decryptString.mockImplementation(value => value.toString());
    const {key, ...anchor} = {...root, kind: 'anchor', label: 'updated'};

    certificateStorage.put(anchor, 'registry');
    expect(settings.delete).toHaveBeenCalledWith('certificates');
    expect(certificateStorage.list('registry')).toMatchObject([{id: root.id, label: 'updated', hasPrivateKey: false}]);
});
