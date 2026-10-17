import {SettingsChannels} from './channels';
import {publicObservabilityConfig, langfuseConfig, validateObservabilityConfig, exportDestination, storedObservabilityConfig} from '../utils/persistence/observabilityConfig';
import {observabilityRequest, observabilityStorageStatus, getTrace} from '../utils/persistence/observabilityStorage';
import {decryptDiagnostic} from '../utils/persistence/osProtection';
import {createLangfuseExporter} from './ai/langfuseExporter';
import {NotificationCenter} from '../utils/desktop/NotificationCenter';
import {createIncidentReporter} from '../utils/desktop/backgroundNotifications';

async function verifyConnectionResponse(response) {
    if (!response.ok) throw new Error(`Connection failed (HTTP ${response.status}). Check the server URL and project keys.`);
    const result = await response.json();
    if (!Array.isArray(result.data) || !result.data.length) throw new Error('The server did not return a Langfuse project. Check the base URL and keys.');
}

export function registerObservabilityHandlers({ipcMain, fetchImpl = (input, init) => fetch(input, init)}) {
    const exporter = createLangfuseExporter({request: observabilityRequest, config: langfuseConfig, decrypt: decryptDiagnostic, fetchImpl, report: notification => {void NotificationCenter.addNotification(notification);}});
    const accessIncident = createIncidentReporter({source: 'observability', groupKey: 'observability-export-access', title: 'Langfuse export is paused by a storage or credential error',
        message: 'Pending traces remain on this device. Unlock the OS credential store and check storage access, then retry exports from Observability settings.',
        recoveredTitle: 'Langfuse export access restored', recoveredMessage: 'The export queue can be accessed again. Check Observability settings for any traces still waiting.',
        actions: [{kind: 'view-settings', tab: 'observability'}]});
    let lastExportError = null, pruning = false;
    const run = () => exporter.run().then(() => {if (langfuseConfig({decrypt: false}).enabled) accessIncident.recover(); lastExportError = null;}, error => {accessIncident.fail(error); lastExportError = 'Export is paused. Check the OS credential store and Langfuse configuration.';});
    const timer = setInterval(run, 15000); timer.unref?.();
    const pruneTimer = setInterval(() => {
        if (pruning) return;
        pruning = true;
        observabilityRequest('prune', storedObservabilityConfig().retention).catch(() => {}).finally(() => {pruning = false;});
    }, 3600000); pruneTimer.unref?.();
    void run();
    const channels = SettingsChannels.observability;
    const snapshot = async () => ({...publicObservabilityConfig(), storage: observabilityStorageStatus(), lastExportError, ...await observabilityRequest('overview')});
    ipcMain.handle(channels.GET, snapshot);
    ipcMain.handle(channels.SAVE, async (_event, input) => {
        validateObservabilityConfig(input, {save: true});
        await observabilityRequest('prune', storedObservabilityConfig().retention);
        void run();
        return snapshot();
    });
    ipcMain.handle(channels.TEST, async (_event, input) => {
        const candidate = validateObservabilityConfig(input);
        const config = langfuseConfig({candidate});
        if (!config.host || !config.publicKey || !config.secretKey) throw new Error('Provide a Langfuse URL, public key, and secret key to test the connection');
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetchImpl(`${config.host}/api/public/projects`, {redirect: 'error', signal: controller.signal,
                headers: {authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`}});
            await verifyConnectionResponse(response);
            return {message: 'Connection verified. Your keys can access a Langfuse project.'};
        } catch (error) {
            if (error.message?.startsWith('Connection failed') || error.message?.startsWith('The server')) throw error;
            throw new Error('Could not reach Langfuse. Check the server URL and network connection.');
        } finally {clearTimeout(timeout);}
    });
    ipcMain.handle(channels.RETRY, async () => {
        const config = langfuseConfig();
        if (!config.enabled) throw new Error('Enable Langfuse export before retrying');
        await observabilityRequest('retry', {destination: exportDestination(config)});
        await run();
        return snapshot();
    });
    ipcMain.handle(channels.TRACE, (_event, id) => {
        if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid trace ID');
        return getTrace(id);
    });
    return {async stop() {clearInterval(timer); clearInterval(pruneTimer); await exporter.stop();}};
}
