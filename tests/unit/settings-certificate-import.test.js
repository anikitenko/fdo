/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dialog} from 'electron';
import {importDeveloperIdentity} from '../../src/ipc/registryCertificates';
import {importRootCertificate} from '../../src/utils/system/certificateImports';
import {officialRegistry} from '../../src/utils/system/officialRegistry';
import {certificateStorage} from '../../src/utils/persistence/certificateStorage';
import {Certs} from '../../src/utils/system/certs';
import {registryLifecycleFixture} from '../helpers/registryLifecycleFixture';
jest.mock('electron', () => ({ipcMain: {handle: jest.fn()}, dialog: {showOpenDialog: jest.fn()}, BrowserWindow: {fromWebContents: () => undefined}}));
jest.mock('../../src/utils/system/registryIdentity', () => ({registryIdentityLifecycle: {}}));
jest.mock('../../src/utils/system/officialRegistry', () => ({officialRegistry: {ensureAnchor: jest.fn(), trust: jest.fn(), certificateStatus: jest.fn()}}));
jest.mock('../../src/utils/persistence/certificateStorage', () => ({certificateStorage: {put: jest.fn()}}));
jest.mock('../../src/utils/system/certs', () => ({Certs: {import: jest.fn()}}));
let fixture, directory, file;
const event = {sender: {}};
beforeAll(async () => {fixture = await registryLifecycleFixture();});
beforeEach(async () => {
    jest.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-import-'));
    file = path.join(directory, 'certificate.pem');
    officialRegistry.ensureAnchor.mockResolvedValue({id: 'official'});
    officialRegistry.trust.mockResolvedValue({anchors: [fixture.root]});
    officialRegistry.certificateStatus.mockResolvedValue({status: 'active'});
});
afterEach(async () => {await fs.rm(directory, {recursive: true, force: true});});
test('keeps root imports on the existing certificate path', async () => {
    await fs.writeFile(file, fixture.root);
    Certs.import.mockResolvedValue({success: true});
    expect(await importRootCertificate(file)).toEqual({success: true});
    expect(Certs.import).toHaveBeenCalledWith(file);
    expect(officialRegistry.ensureAnchor).not.toHaveBeenCalled();
});
test('root import rejects developer certificates without changing import paths', async () => {
    await fs.writeFile(file, fixture.chainPem);
    expect(await importRootCertificate(file)).toMatchObject({success: false, error: expect.stringContaining('root CA')});
    expect(Certs.import).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});

test('developer import accepts chain and key in one multi-file selection regardless of file order', async () => {
    await fs.writeFile(file, fixture.issuer + '\n' + fixture.leaf);
    const keyFile = path.join(directory, 'developer.key');
    await fs.writeFile(keyFile, fixture.key);
    dialog.showOpenDialog.mockResolvedValue({canceled: false, filePaths: [keyFile, file]});
    expect(await importDeveloperIdentity(event)).toEqual({success: true});
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(undefined, expect.objectContaining({properties: ['openFile', 'multiSelections']}));
    const [saved, scope] = certificateStorage.put.mock.calls[0];
    expect(scope).toBe('registry');
    expect(saved.chainPem).not.toContain('PRIVATE KEY');
    expect(saved.chainPem.indexOf(fixture.leaf.trim())).toBe(0);
    expect(Certs.import).not.toHaveBeenCalled();
});

test('developer import supports a combined PEM file in one selection', async () => {
    await fs.writeFile(file, fixture.chainPem + '\n' + fixture.key);
    dialog.showOpenDialog.mockResolvedValue({canceled: false, filePaths: [file]});
    expect(await importDeveloperIdentity(event)).toEqual({success: true});
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(certificateStorage.put).toHaveBeenCalledTimes(1);
});

test('developer import cancels without selecting another file or saving', async () => {
    dialog.showOpenDialog.mockResolvedValue({canceled: true, filePaths: []});
    expect(await importDeveloperIdentity(event)).toEqual({success: true, canceled: true});
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(certificateStorage.put).not.toHaveBeenCalled();
});

test('developer import reports missing keys without opening a second file dialog', async () => {
    await fs.writeFile(file, fixture.chainPem);
    dialog.showOpenDialog.mockResolvedValue({canceled: false, filePaths: [file]});
    await expect(importDeveloperIdentity(event)).rejects.toThrow('exactly one matching private key');
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(certificateStorage.put).not.toHaveBeenCalled();
});

test('developer import cannot accept a shared root as a developer identity', async () => {
    await fs.writeFile(file, fixture.root + '\n' + fixture.key);
    dialog.showOpenDialog.mockResolvedValue({canceled: false, filePaths: [file]});
    await expect(importDeveloperIdentity(event)).rejects.toThrow('one developer certificate');
    expect(certificateStorage.put).not.toHaveBeenCalled();
    expect(Certs.import).not.toHaveBeenCalled();
});
