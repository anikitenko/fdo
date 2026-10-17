import {ipcMain, BrowserWindow} from 'electron';
import {settings} from '../utils/persistence/store';
import {loadUsageEntries, saveUsageEntry} from '../utils/persistence/observabilityStorage';
import {AiUsageChannels} from './channels';
import {configureUsageLedger, usageLedger} from '../utils/ai/billing/ledger';
import {PRICING_CATALOG, PRICING_SOURCES} from '../utils/ai/billing/catalog';
import {rateKey, validateRate} from '../utils/ai/billing/pricing';
import {createIncidentReporter} from '../utils/desktop/backgroundNotifications';

export async function registerAiUsageHandlers() {
    const incident = createIncidentReporter({source: 'ai', groupKey: 'ai-usage-storage', title: 'AI usage history could not be saved',
        message: 'A request’s usage or cost record could not be stored. Totals may be incomplete. Check disk space and observability storage before relying on this history.',
        recoveredTitle: 'AI usage recording resumed', recoveredMessage: 'New usage records can be saved again. Earlier failed records may still need to be verified.',
        actions: [{kind: 'view-settings', tab: 'observability'}]});
    const entries = await loadUsageEntries();
    let savedRates = JSON.stringify(settings.get('ai.usageRates', {}));
    configureUsageLedger({entries, rates: settings.get('ai.usageRates', {}), save: async (_entries, rates, entry) => {
        if (entry) {
            try {await saveUsageEntry(entry); incident.recover();}
            catch (error) {incident.fail(error); throw error;}
        }
        const serialized = JSON.stringify(rates);
        if (serialized !== savedRates) {settings.set('ai.usageRates', rates); savedRates = serialized;}
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
                try { window.webContents.send(AiUsageChannels.UPDATED); } catch { /* Closing windows do not invalidate saved accounting. */ }
            }
        }
    }});
    for (const entry of usageLedger.entries) if (entry.status === 'interrupted') usageLedger.changed(entry);
    await usageLedger.flush();
    ipcMain.handle(AiUsageChannels.GET, async (_event, filter = {}) => {try {await usageLedger.flush();} catch { /* The snapshot exposes persistenceError. */ } return usageLedger.snapshot({surface: filter.surface, sessionId: filter.sessionId});});
    ipcMain.handle(AiUsageChannels.RATES, () => ({catalog: PRICING_CATALOG, overrides: usageLedger.rates, sources: PRICING_SOURCES}));
    ipcMain.handle(AiUsageChannels.SAVE_RATE, async (_event, {provider, model, rate}) => {
        if (!['openai', 'anthropic', 'gemini', 'cloudflare', 'opencode', 'openrouter', 'cursor'].includes(provider) || typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Choose an API provider and model.');
        const key = rateKey(provider, model.trim());
        if (rate === null) delete usageLedger.rates[key];
        else usageLedger.rates[key] = {...validateRate(rate), source: 'Custom rate', verifiedAt: new Date().toISOString().slice(0, 10)};
        usageLedger.changed();
        await usageLedger.flush();
        if (usageLedger.persistenceError) throw new Error('The rate could not be saved.');
        return true;
    });
}
