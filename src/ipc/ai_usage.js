import {ipcMain, BrowserWindow} from 'electron';
import {settings} from '../utils/store';
import {AiUsageChannels} from './channels';
import {configureUsageLedger, usageLedger} from '../utils/aiBilling/ledger';
import {PRICING_CATALOG, PRICING_SOURCES} from '../utils/aiBilling/catalog';
import {rateKey, validateRate} from '../utils/aiBilling/pricing';

export function registerAiUsageHandlers() {
    configureUsageLedger({entries: settings.get('ai.usageLedger', []), rates: settings.get('ai.usageRates', {}), save: (entries, rates) => {
        settings.set('ai.usageLedger', entries);
        settings.set('ai.usageRates', rates);
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
                try { window.webContents.send(AiUsageChannels.UPDATED); } catch { /* Closing windows do not invalidate saved accounting. */ }
            }
        }
    }});
    usageLedger.changed();
    ipcMain.handle(AiUsageChannels.GET, (_event, filter = {}) => usageLedger.snapshot({surface: filter.surface, sessionId: filter.sessionId}));
    ipcMain.handle(AiUsageChannels.RATES, () => ({catalog: PRICING_CATALOG, overrides: usageLedger.rates, sources: PRICING_SOURCES}));
    ipcMain.handle(AiUsageChannels.SAVE_RATE, (_event, {provider, model, rate}) => {
        if (!['openai', 'anthropic', 'gemini', 'cloudflare'].includes(provider) || typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Choose an API provider and model.');
        const key = rateKey(provider, model.trim());
        if (rate === null) delete usageLedger.rates[key];
        else usageLedger.rates[key] = {...validateRate(rate), source: 'Custom rate', verifiedAt: new Date().toISOString().slice(0, 10)};
        usageLedger.changed();
        if (usageLedger.persistenceError) throw new Error('The rate could not be saved.');
        return true;
    });
}
