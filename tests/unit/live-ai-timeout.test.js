const {liveAiTimeoutPolicy, liveAiTimeoutDuration} = require('../../src/utils/ai/testing/liveAiTestPolicy.cjs');
const {createLiveAiTimeoutMonitor, waitForAssistantUiToSettle} = require('../e2e/helpers/assistantRequestWait.cjs');

test('timeout policy earns bounded time for validated files and preserves fixed mode', () => {
    const policy = liveAiTimeoutPolicy({FDO_E2E_LIVE_AI_TIMEOUT_MS: '1800000'});
    expect(liveAiTimeoutDuration(policy, 24)).toBe(4680000);
    expect(liveAiTimeoutDuration(policy, 1000)).toBe(6120000);
    expect(liveAiTimeoutDuration({...policy, maximumMs: 2400000}, 24)).toBe(2400000);
    expect(liveAiTimeoutDuration(liveAiTimeoutPolicy({FDO_E2E_LIVE_AI_TIMEOUT_MODE: 'fixed'}), 24)).toBe(600000);
    expect(() => liveAiTimeoutPolicy({FDO_E2E_LIVE_AI_TIMEOUT_MODE: 'unknown'})).toThrow('adaptive or fixed');
    expect(() => liveAiTimeoutPolicy({FDO_E2E_LIVE_AI_MAX_TIMEOUT_MS: '100'})).toThrow('at least');
});

test.each(['adaptive', 'fixed'])('backend %s deadline is run-scoped and cannot be renewed by retries or repeated files', mode => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(1000);
    try {
        const {reserveLiveAiTestRequest: reserve, recordLiveAiTestValidatedFile: record, getLiveAiTestBudget: state} = require('../../src/utils/ai/testing/liveAiTestBudget');
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_E2E_LIVE_AI_TIMEOUT_MS: '1800000', FDO_E2E_LIVE_AI_TIMEOUT_MODE: mode};
        reserve(env);
        const original = state(env).deadline;
        record('/first.ts', env);
        const extension = mode === 'adaptive' ? 120000 : 0;
        expect(state(env)).toMatchObject({deadline: original + extension, timeoutExtensionMs: extension});
        reserve(env);
        record('/FIRST.ts', env);
        expect(state(env).deadline).toBe(original + extension);
        jest.setSystemTime(original);
        if (extension) expect(() => reserve(env)).not.toThrow();
        jest.setSystemTime(original + extension);
        expect(() => reserve(env)).toThrow('deadline reached');
        expect(() => record('/second.ts', env)).toThrow('deadline reached');
    } finally { jest.useRealTimers(); }
});

test('Playwright and UI waits share earned time without resetting the clock for repairs', async () => {
    const testInfo = {timeout: 1800000,
        setTimeout: jest.fn(ms => { testInfo.timeout = ms; })};
    const budget = {timeoutExtensionMs: 240000, validatedFiles: 2};
    const readBudget = jest.fn(async () => budget);
    const monitor = createLiveAiTimeoutMonitor({testInfo, readBudget, initialTimeout: 1800000, startedAt: 1000, now: () => 1801000});
    expect(await monitor()).toBe(240000);
    expect(testInfo.setTimeout).toHaveBeenCalledWith(2040000);
    await monitor();
    expect(testInfo.setTimeout).toHaveBeenCalledTimes(1);
    const repair = createLiveAiTimeoutMonitor({testInfo, readBudget, initialTimeout: 1800000, startedAt: 1000, now: () => 1901000});
    expect(await repair()).toBe(140000);
});

test('UI polling refreshes deadlines and propagates transport errors', async () => {
    const initial = {jsonValue: async () => 'running', dispose: jest.fn()};
    const settled = {jsonValue: async () => true, dispose: jest.fn()};
    const timeout = Object.assign(new Error('poll window elapsed'), {name: 'TimeoutError'});
    const page = {waitForFunction: jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(timeout).mockResolvedValueOnce(settled)};
    const remainingMs = jest.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(120000);
    await waitForAssistantUiToSettle(page, 100, {remainingMs});
    expect(remainingMs).toHaveBeenCalledTimes(2);
    expect(page.waitForFunction.mock.calls[2][2].timeout).toBe(5000);
    expect(settled.dispose).toHaveBeenCalled();
    page.waitForFunction.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Target page closed'));
    await expect(waitForAssistantUiToSettle(page, 100, {remainingMs: async () => 1000})).rejects.toThrow('Target page closed');
    page.waitForFunction.mockResolvedValueOnce(initial);
    await expect(waitForAssistantUiToSettle(page, 100, {remainingMs: async () => 0})).rejects.toThrow('deadline');
});

test('live approval stops promptly on an invalid guide proposal', async () => {
    const initial = {jsonValue: async () => 'running', dispose: jest.fn()};
    const page = {waitForFunction: jest.fn().mockResolvedValueOnce(initial).mockImplementation(async (callback, args) => callback(args))};
    const spy = jest.spyOn(document, 'querySelector').mockImplementation(selector => selector.includes('guide-proposal-recovery') ? document.createElement('p') : null);
    try {
        await expect(waitForAssistantUiToSettle(page, 1000, {approvePluginGuide: true})).rejects.toThrow('cannot approve an invalid proposal');
    } finally { spy.mockRestore(); }
});


test.each([true, false])('live guide retry is bounded and only approves a valid replacement: %s', async succeeds => {
    const initial = {jsonValue: async () => 'running', dispose: jest.fn()};
    let retries = 0, approvals = 0;
    const showRecovery = () => {
        document.body.innerHTML = '<button>Stop</button><p data-testid="guide-proposal-recovery"></p><button>Retry failed step</button>';
        document.querySelectorAll('button')[1].onclick = () => { retries++; };
    };
    showRecovery();
    const page = {waitForFunction: jest.fn().mockResolvedValueOnce(initial).mockImplementation(async (callback, args) => {
        const value = callback(args);
        if (value === 'guide-retry') {
            // Polling the same dialog again must not send a duplicate retry.
            expect(callback({...args, guideRetries: 1})).toBe(false);
            if (succeeds) {
                document.body.innerHTML = '<button>Stop</button><button data-testid="approve-plugin-guide">Approve</button>';
                document.querySelectorAll('button')[1].onclick = () => { approvals++; document.body.innerHTML = ''; };
            } else showRecovery();
        }
        return {jsonValue: async () => value, dispose: jest.fn()};
    })};
    try {
        const pending = waitForAssistantUiToSettle(page, 1000, {approvePluginGuide: true});
        if (succeeds) await pending;
        else await expect(pending).rejects.toThrow('cannot approve an invalid proposal');
        expect(retries).toBe(1);
        expect(approvals).toBe(succeeds ? 1 : 0);
    } finally { document.body.innerHTML = ''; }
});
