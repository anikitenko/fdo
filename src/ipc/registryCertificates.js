import {registryIdentityLifecycle} from '../utils/system/registryIdentity';
import {officialRegistry} from '../utils/system/officialRegistry';
import {BrowserWindow, dialog, ipcMain} from 'electron';
import {certificateStorage} from '../utils/persistence/certificateStorage';
import {importDeveloperCertificateFiles} from '../utils/system/certificateImports';
import {SettingsChannels} from './channels';

export async function importDeveloperIdentity(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    const selected = await dialog.showOpenDialog(window || undefined, {
        title: 'Select developer certificate chain and private key',
        buttonLabel: 'Import developer certificate', properties: ['openFile', 'multiSelections'],
        filters: [{name: 'Certificates and private keys', extensions: ['pem', 'crt', 'cert', 'key']}],
    });
    if (selected.canceled || !selected.filePaths.length) return {success: true, canceled: true};
    return importDeveloperCertificateFiles(selected.filePaths);
}

export function registerRegistryCertificateHandlers() {
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_LIST, () => certificateStorage.list('registry').filter(entry => entry.kind === 'developer'));
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_STATUS, async () => {
        try {
            const anchor = await officialRegistry.ensureAnchor();
            const developers=await Promise.all(certificateStorage.list('registry').filter(entry=>entry.kind==='developer').map(async entry=>{try{return {...await registryIdentityLifecycle.ensureIdentity(entry),lifecycleStatus:'active'};}catch(error){return {...entry,lifecycleStatus:error.lifecycleStatus || (Date.parse(entry.expiresAt) <= Date.now() ? 'expired' : 'unavailable'),lifecycleError:error.message};}}));
            return {available:true,anchor,developers};
        } catch (error) {return {available: false, configured: officialRegistry.configured(), error: error.message, developers: certificateStorage.list('registry').filter(entry => entry.kind === 'developer').map(entry => ({...entry, lifecycleStatus: 'unavailable', lifecycleError: error.message}))};}
    });
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_REMOVE, (_, id) => {
        if (certificateStorage.list('registry').some(entry => entry.id === id && entry.kind === 'developer')) {
            for (const entry of certificateStorage.list('registry').filter(item=>item.kind==='renewal-pending'&&item.previousId===id)) certificateStorage.remove(entry.id,'registry');
            certificateStorage.remove(id, 'registry');
        }
    });
    ipcMain.handle(SettingsChannels.certificates.REGISTRY_IMPORT, async (event, options = {}) => {
        if (options.kind !== 'developer') return {success: false, error: 'The official registry certificate is obtained automatically.'};
        try {
            return await importDeveloperIdentity(event);
        } catch (error) {return {success:false,error:error.message};}
    });
}
