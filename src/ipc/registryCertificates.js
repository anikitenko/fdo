import {registryIdentityLifecycle} from '../utils/system/registryIdentity';
import {officialRegistry} from '../utils/system/officialRegistry';
import {BrowserWindow, dialog, ipcMain} from 'electron';
import {certificateStorage} from '../utils/persistence/certificateStorage';
import {importDeveloperCertificateFiles} from '../utils/system/certificateImports';
import {SettingsChannels} from './channels';
import {organizationRegistries} from '../utils/system/organizationRegistries';

export async function importDeveloperIdentity(event, registryId) {
    if (registryId) organizationRegistries.get(registryId);
    const window = BrowserWindow.fromWebContents(event.sender);
    const selected = await dialog.showOpenDialog(window || undefined, {
        title: 'Select developer certificate chain and private key',
        buttonLabel: 'Import developer certificate', properties: ['openFile', 'multiSelections'],
        filters: [{name: 'Certificates and private keys', extensions: ['pem', 'crt', 'cert', 'key']}],
    });
    if (selected.canceled || !selected.filePaths.length) return {success: true, canceled: true};
    return importDeveloperCertificateFiles(selected.filePaths, registryId);
}

export async function registryCertificateStatus({registry = officialRegistry, lifecycle = registryIdentityLifecycle, scope = 'registry', connection} = {}) {
    const entries = () => certificateStorage.list(scope).filter(entry => entry.kind === 'developer' && (!connection || entry.registryId === connection.id));
    try {
        const anchor = await registry.ensureAnchor();
        const developers = await Promise.all(entries().map(async entry => {
            try {return {...await lifecycle.ensureIdentity(entry), lifecycleStatus: 'active'};}
            catch (error) {return {...entry, lifecycleStatus: error.lifecycleStatus || (Date.parse(entry.expiresAt) <= Date.now() ? 'expired' : 'unavailable'), lifecycleError: error.message};}
        }));
        return {available: true, anchor, developers};
    } catch (error) {
        return {available: false, configured: registry.configured(), error: error.message,
            developers: entries().map(entry => ({...entry, lifecycleStatus: 'unavailable', lifecycleError: error.message}))};
    }
}

function removeIdentity(id, scope = 'registry', registryId) {
    if (!certificateStorage.list(scope).some(entry => entry.id === id && entry.kind === 'developer' && entry.registryId === registryId))
        throw new Error('This signing certificate is no longer available.');
    for (const entry of certificateStorage.list(scope).filter(item => item.kind === 'renewal-pending' && item.previousId === id)) certificateStorage.remove(entry.id, scope);
    certificateStorage.remove(id, scope);
}

export function registerRegistryCertificateHandlers() {
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_LIST, () => certificateStorage.list('registry').filter(entry => entry.kind === 'developer'));
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_STATUS, () => registryCertificateStatus());
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_REMOVE, (_, id) => removeIdentity(id));
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_IMPORT, async (event, options = {}) => {
        if (options.kind !== 'developer') return {success: false, error: 'The official registry certificate is obtained automatically.'};
        try {
            return await importDeveloperIdentity(event);
        } catch (error) {return {success:false,error:error.message};}
    });
    ipcMain.handle(SettingsChannels.certificates.ORGANIZATION_LIST, () => organizationRegistries.list());
    ipcMain.handle(SettingsChannels.certificates.ORGANIZATION_STATUS, (_, id) => registryCertificateStatus(organizationRegistries.get(id)));
    ipcMain.handle(SettingsChannels.certificates.ORGANIZATION_ADD, async (_, input) => {
        try {return {success: true, connection: await organizationRegistries.add(input)};}
        catch (error) {return {success: false, error: error.message};}
    });
    ipcMain.handle(SettingsChannels.certificates.ORGANIZATION_REMOVE, (_, id) => organizationRegistries.remove(id));
    ipcMain.handle(SettingsChannels.certificates.ORGANIZATION_IMPORT, async (event, id) => {
        if (!id || id === 'official') return {success: false, error: 'Choose a connected private registry.'};
        try {
            return await importDeveloperIdentity(event, id);
        } catch (error) {return {success: false, error: error.message};}
    });
    ipcMain.handle(SettingsChannels.certificates.ORGANIZATION_REMOVE_CERTIFICATE, (_, registryId, id) => {
        const {scope, connection} = organizationRegistries.get(registryId);
        if (!connection) throw new Error('Choose a connected private registry.');
        removeIdentity(id, scope, connection.id);
    });
}
