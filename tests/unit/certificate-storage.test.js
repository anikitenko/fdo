/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {app, safeStorage} from 'electron';
import {settings} from '../../src/utils/persistence/store';
import {initializeCertificateStorage, certificateStorage, closeCertificateStorage} from '../../src/utils/persistence/certificateStorage';
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
