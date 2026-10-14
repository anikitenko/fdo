/** @jest-environment node */
import {ipcMain} from 'electron';
import {settings} from '../../src/utils/persistence/store';
import {registerAiUsageHandlers} from '../../src/ipc/ai_usage';
import {AiUsageChannels} from '../../src/ipc/channels';
import {usageLedger} from '../../src/utils/ai/billing/ledger';
import {rateKey} from '../../src/utils/ai/billing/pricing';
jest.mock('electron', () => ({ipcMain: {handle: jest.fn()}, BrowserWindow: {getAllWindows: () => []}}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn((_key, fallback) => fallback), set: jest.fn()}}));
test('Cursor rates can be saved, persisted, used and reset through the real usage IPC handler', () => {
    registerAiUsageHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiUsageChannels.SAVE_RATE)[1];
    expect(handler({}, {provider: 'cursor', model: 'composer-fixture', rate: {input: 2, output: 10, cached: .2}})).toBe(true);
    expect(settings.set).toHaveBeenCalledWith('ai.usageRates', expect.objectContaining({[rateKey('cursor', 'composer-fixture')]: expect.objectContaining({input: 2})}));
    usageLedger.begin('cursor', 'composer-fixture').finish('completed', {input_tokens: 1000, output_tokens: 100, cached_input_tokens: 200}, {completeUsage: true});
    expect(usageLedger.snapshot().entries[0].cost).toMatchObject({status: 'estimated', totalCost: .00264});
    handler({}, {provider: 'cursor', model: 'composer-fixture', rate: null});
    expect(usageLedger.rates[rateKey('cursor', 'composer-fixture')]).toBeUndefined();
});
