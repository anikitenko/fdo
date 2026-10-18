import {inspectToolPrerequisites} from '../utils/system/toolPrerequisites';
import {validateSettingsProfile, validateSSHEndpoint} from '../utils/hostServices/profileValidation';
import {getHostServices, scanSSHHostKey} from '../utils/hostServices/runtime';
import {failure, record, text} from '../utils/hostServices/contracts.cjs';
import {HostServiceSettingsChannels as channels} from './channels';

export function registerHostServiceSettings({ipcMain, getMainWindow, getPlugins, services = getHostServices, scanHostKey = scanSSHHostKey}) {
    const viewOwners=new Set();
    const handle = (channel, action) => ipcMain.handle(channel, async (event, input) => {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return {success: false, code: 'ACCESS_DENIED'};
        try {return {success: true, ...await action(input, event)};}
        catch (error) {return {success: false, code: failure(error?.code).code};}
    });
    let toolInspection;
    handle(channels.TOOLS_STATE, async input => {
        record(input, []);
        // Coalesce simultaneous refreshes; no persistent availability cache.
        if (!toolInspection) toolInspection = inspectToolPrerequisites().finally(() => {toolInspection = null;});
        return {inventory: await toolInspection};
    });
    const owner = input => {
        text(input.pluginId, 256);
        if (!getPlugins().some(plugin => plugin.id === input.pluginId)) throw failure('ACCESS_DENIED');
        return input.pluginId;
    };
    handle(channels.TERMINAL_VIEW,(input,event)=>{
        record(input,['pluginId','leaseId','active']);const id=owner(input);
        if(typeof input.active!=='boolean')throw failure('INVALID_REQUEST');
        const service=services().service, sender=event.sender;
        service.viewLease(sender.id,id,input.leaseId,input.active);
        if(!viewOwners.has(sender.id)){
            viewOwners.add(sender.id);const release=()=>{service.releaseViews(sender.id);viewOwners.delete(sender.id);};
            sender.once('destroyed',release);sender.once('render-process-gone',release);
            sender.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument)release();});
        }
        return {};
    });
    handle(channels.CHECK_X11,async input=>{record(input,['pluginId']);owner(input);const availability=await services().service.checkX11();owner(input);return {availability};});
    handle(channels.STATE, input => {
        record(input, ['pluginId']); const id = owner(input);
        const {vault, check} = services();
        let available = true, code = '';
        try {check();} catch (error) {available = false; code = failure(error.code).code;}
        return {available, code, terminalReadiness:services().service.readiness?.(), gitProfileMode: vault.gitEnabled(id), entries: available ? vault.list(id) : [], profiles: available ? vault.profiles(id) : []};
    });
    handle(channels.FETCH_HOST_KEY, async (input, event) => {
        record(input, ['pluginId', 'host', 'port']); const id = owner(input);
        const {endpoint, fieldErrors} = validateSSHEndpoint(input);
        if (Object.keys(fieldErrors).length) return {success: false, code: 'INVALID_REQUEST', fieldErrors};
        const controller = new AbortController();
        const abort = () => controller.abort();
        const navigation = details => {if (details.isMainFrame && !details.isSameDocument) abort();};
        event.sender.once?.('destroyed', abort);
        event.sender.once?.('render-process-gone', abort);
        event.sender.on?.('did-start-navigation', navigation);
        try {const candidate = await scanHostKey(id, endpoint, controller.signal); owner(input); return {candidate};}
        finally {event.sender.removeListener?.('destroyed', abort); event.sender.removeListener?.('render-process-gone', abort); event.sender.removeListener?.('did-start-navigation', navigation);}
    });
    handle(channels.SET_GIT_ENABLED, input => {
        record(input, ['pluginId', 'enabled']); services().service.setGitEnabled(owner(input), input.enabled); return {};
    });
    handle(channels.SAVE_SECRET, input => {
        record(input, ['pluginId', 'key', 'value']);
        return services().service.saveSecret(owner(input), input.key, input.value);
    });
    handle(channels.DELETE_SECRET, input => {
        record(input, ['pluginId', 'key']);
        return services().service.deleteSecret(owner(input), input.key);
    });
    handle(channels.SAVE_PROFILE, input => {
        record(input, ['pluginId', 'profile', 'trustConfirmed']);
        if (input.trustConfirmed !== true) throw failure('INVALID_REQUEST');
        const id = owner(input);
        const {profile, fieldErrors} = validateSettingsProfile(input.profile);
        if (Object.keys(fieldErrors).length) return {success: false, code: 'INVALID_REQUEST', fieldErrors};
        const {service, vault} = services();
        const savedKeys = new Set(vault.list(id).map(entry => entry.key));
        for (const [name, reference] of [['credential', profile.authentication.passwordRef || profile.authentication.privateKeyRef], ['passphrase', profile.authentication.passphraseRef]]) {
            if (reference && !savedKeys.has(reference.key)) fieldErrors[name] = 'The selected credential no longer exists for this plugin. Refresh saved credentials and select another one.';
        }
        if (Object.keys(fieldErrors).length) return {success: false, code: 'INVALID_REQUEST', fieldErrors};
        service.saveProfile(id, profile); return {profile};
    });
    handle(channels.DELETE_PROFILE, input => {
        record(input, ['pluginId', 'id']); services().service.deleteProfile(owner(input), input.id); return {};
    });
}
