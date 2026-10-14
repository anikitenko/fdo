describe("live AI test request budget", () => {
    let reserve, assertAvailable;
    beforeEach(() => {
        jest.resetModules();
        reserve = require("../../src/utils/ai/testing/liveAiTestBudget").reserveLiveAiTestRequest;
        assertAvailable = require("../../src/utils/ai/testing/liveAiTestBudget").assertLiveAiTestRequestsAvailable;
    });
    test("does not change normal application behavior", () => {
        for (let i = 0; i < 60; i++) reserve({FDO_E2E: "0", FDO_E2E_LIVE_AI: "1"});
        assertAvailable(60, {FDO_E2E: "0", FDO_E2E_LIVE_AI: "1"});
    });
    test('preserves adaptive mode through CLI and reliability configuration', () => {
        const {readLiveAiConfig} = require('../../scripts/lib/live-ai-config.cjs');
        const {createReliabilityPlan} = require('../../scripts/lib/live-ai-reliability.cjs');
        const {liveAiBudgetPolicy} = require('../../src/utils/ai/testing/liveAiTestPolicy.cjs');
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_PROVIDER: 'ollama', FDO_TEST_AI_MODEL: 'local'};
        expect(readLiveAiConfig(env)).toMatchObject({limit: 50, requestBudgetMode: 'adaptive', maximumRequestLimit: 86, requestProgressAllowance: 36});
        expect(createReliabilityPlan([{provider: 'ollama', model: 'local'}], {env})[0]).toMatchObject({requestLimit: 50, maximumRequestLimit: 86, requestBudgetMode: 'adaptive'});
        expect(liveAiBudgetPolicy(env).envValue).toBe('auto');
        const fixed = {...env, FDO_TEST_AI_MAX_REQUESTS: '20'};
        expect(readLiveAiConfig(fixed)).toMatchObject({limit: 20, requestBudgetMode: 'fixed', maximumRequestLimit: 20, requestProgressAllowance: 0});
        expect(createReliabilityPlan([{provider: 'ollama', model: 'local'}], {env: fixed})[0]).toMatchObject({requestLimit: 20, requestBudgetMode: 'fixed'});
    });
    test('checks affordability without reserving requests or changing explicit caps', () => {
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '12'};
        reserve(env);
        expect(() => assertAvailable(12, env)).toThrow('12 requests needed, 11 remaining (1/12 used)');
        assertAvailable(11, env);
        assertAvailable(11, env);
        for (let i = 0; i < 11; i++) reserve(env);
        expect(() => assertAvailable(1, env)).toThrow('0 remaining (12/12 used)');
    });
    test("blocks requests after the configured limit", () => {
        const env = {FDO_E2E: "1", FDO_E2E_LIVE_AI: "1", FDO_TEST_AI_MAX_REQUESTS: "2"};
        reserve(env);
        reserve(env);
        expect(() => reserve(env)).toThrow("limit reached (2)");
    });
    test.each(["0", "51", "NaN", "1.5"])("rejects invalid limit %s", limit => {
        expect(() => reserve({FDO_E2E: "1", FDO_E2E_LIVE_AI: "1", FDO_TEST_AI_MAX_REQUESTS: limit})).toThrow("integer from 1 to 50");
    });
    test('raises the ceiling and every derived bound from the environment', () => {
        const {readLiveAiConfig} = require('../../scripts/lib/live-ai-config.cjs');
        const {createReliabilityPlan} = require('../../scripts/lib/live-ai-reliability.cjs');
        const {liveAiBudgetPolicy} = require('../../src/utils/ai/testing/liveAiTestPolicy.cjs');
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_PROVIDER: 'ollama', FDO_TEST_AI_MODEL: 'local',
            FDO_TEST_AI_REQUEST_CEILING: '80'};
        expect(liveAiBudgetPolicy(env)).toMatchObject({mode: 'adaptive', limit: 80, ceiling: 80});
        expect(readLiveAiConfig({...env, FDO_TEST_AI_MAX_REQUESTS: '65'})).toMatchObject({limit: 65, requestBudgetMode: 'fixed'});
        expect(createReliabilityPlan([{provider: 'ollama', model: 'local'}], {env, requestLimit: 65})[0]).toMatchObject({requestLimit: 65});
        // The raised ceiling replaces the default in validation and in advice.
        expect(() => liveAiBudgetPolicy({...env, FDO_TEST_AI_MAX_REQUESTS: '81'})).toThrow('integer from 1 to 80');
        expect(() => createReliabilityPlan([{provider: 'ollama', model: 'local'}], {env, requestLimit: 81}))
            .toThrow('Request limit must be an integer from 1 to 80.');
    });
    test.each(['0', '-1', 'many', '2.5'])('rejects invalid ceiling %s', ceiling => {
        const {liveAiBudgetPolicy} = require('../../src/utils/ai/testing/liveAiTestPolicy.cjs');
        expect(() => liveAiBudgetPolicy({FDO_TEST_AI_REQUEST_CEILING: ceiling}))
            .toThrow('FDO_TEST_AI_REQUEST_CEILING must be a positive integer.');
    });
    test('resolves repair attempts from the environment and rejects invalid values', () => {
        const {liveAiRepairAttempts, DEFAULT_LIVE_AI_REPAIR_ATTEMPTS} = require('../../src/utils/ai/testing/liveAiTestPolicy.cjs');
        expect(liveAiRepairAttempts({})).toBe(DEFAULT_LIVE_AI_REPAIR_ATTEMPTS);
        expect(liveAiRepairAttempts({FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS: ''})).toBe(DEFAULT_LIVE_AI_REPAIR_ATTEMPTS);
        expect(liveAiRepairAttempts({FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS: '6'})).toBe(6);
        expect(liveAiRepairAttempts({FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS: '1'})).toBe(1);
        for (const invalid of ['0', '-2', '1.5', 'lots']) {
            expect(() => liveAiRepairAttempts({FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS: invalid}))
                .toThrow('FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS must be a positive integer.');
        }
    });
});



test('allocates from actual plan size, grows for repairs, and does not charge checks', () => {
    jest.resetModules();
    const {reserveLiveAiTestRequest: reserve, assertLiveAiTestRequestsAvailable: check, getLiveAiTestBudget: state} = require('../../src/utils/ai/testing/liveAiTestBudget');
    const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: 'auto'};
    check(2, env);
    expect(state(env)).toMatchObject({used: 0, allocated: 2, ceiling: 50, mode: 'adaptive'});
    reserve(env);
    check(12, env); // Validated file inventory, no file calls yet.
    check(12, env);
    expect(state(env)).toMatchObject({used: 1, allocated: 13});
    for (let i = 0; i < 13; i++) reserve(env); // Files and repair inventory.
    check(12, env);
    expect(state(env)).toMatchObject({used: 14, allocated: 26});
    expect(() => check(12, {...env, FDO_TEST_AI_MAX_REQUESTS: '20'})).toThrow('12 requests needed, 6 remaining (14/20 used)');
    expect(state(env)).toMatchObject({used: 14, allocated: 26});
});

test('adaptive admission cannot extend capacity without validated progress', () => {
    jest.resetModules();
    const {reserveLiveAiTestRequest: reserve, assertLiveAiTestRequestsAvailable: check, getLiveAiTestBudget: state} = require('../../src/utils/ai/testing/liveAiTestBudget');
    const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1'};
    for (let i = 0; i < 49; i++) reserve(env);
    expect(() => check(2, env)).toThrow('progress-backed safety ceiling');
    expect(state(env)).toMatchObject({used: 49, allocated: 49});
    reserve(env);
    expect(() => reserve(env)).toThrow('limit reached (50)');
});

test('repairs cannot renew the run deadline', () => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(1000);
    try {
        const {reserveLiveAiTestRequest: reserve, assertLiveAiTestRequestsAvailable: check, getLiveAiTestBudget: state} = require('../../src/utils/ai/testing/liveAiTestBudget');
        const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_E2E_LIVE_AI_TIMEOUT_MS: '1800000'};
        reserve(env);
        const deadline = state(env).deadline;
        jest.setSystemTime(deadline - 1);
        check(12, env);
        expect(state(env).deadline).toBe(deadline);
        jest.setSystemTime(deadline);
        expect(() => check(1, env)).toThrow('deadline reached');
        expect(() => reserve(env)).toThrow('deadline reached');
        expect(state(env).used).toBe(1);
    } finally { jest.useRealTimers(); }
});

test.each(['auto', '20'])('staged generation and a repair share the %s run budget', async mode => {
    jest.resetModules();
    const {generateStagedWorkspace} = require('../../src/utils/ai/generation/codingWorkspaceGeneration');
    const {reserveLiveAiTestRequest: reserve, assertLiveAiTestRequestsAvailable: check, getLiveAiTestBudget: state} = require('../../src/utils/ai/testing/liveAiTestBudget');
    const env = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: mode};
    const files = Array.from({length: 12}, (_, index) => ({path: `/features/module${index}.ts`, contract: `Export feature${index}()`}));
    const request = jest.fn(async ({responseSchema}) => {
        reserve(env);
        if (responseSchema.properties.files) return JSON.stringify({files});
        const path = responseSchema.properties.path.enum[0];
        return JSON.stringify({path, content: 'export const value = 1;'});
    });
    const generate = () => generateStagedWorkspace({prompt: 'Implement the requested workspace files', request, assertBudget: required => check(required, env)});
    await expect(generate()).resolves.toContain('### File: /features/module11.ts');
    expect(state(env).used).toBe(13);
    if (mode === 'auto') {
        await expect(generate()).resolves.toContain('### File: /features/module11.ts');
        expect(state(env)).toMatchObject({used: 26, allocated: 26});
        expect(request).toHaveBeenCalledTimes(26);
    } else {
        await expect(generate()).rejects.toThrow('12 requests needed, 6 remaining (14/20 used)');
        expect(state(env).used).toBe(14);
        expect(request).toHaveBeenCalledTimes(14);
    }
});

describe('validated progress in automatic live budgeting', () => {
    let reserve, check, record, state;
    const auto = {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: 'auto'};
    beforeEach(() => {
        jest.resetModules();
        const budget = require('../../src/utils/ai/testing/liveAiTestBudget');
        reserve = budget.reserveLiveAiTestRequest;
        check = budget.assertLiveAiTestRequestsAvailable;
        record = budget.recordLiveAiTestValidatedFile;
        state = budget.getLiveAiTestBudget;
    });
    test('admits the recorded 39-used, 12-pending run only after actual validated file progress', () => {
        for (let i = 0; i < 39; i++) reserve(auto);
        expect(() => check(12, auto)).toThrow('12 requests needed, 11 remaining');
        for (let i = 0; i < 24; i++) record(`/feature${i}.ts`, auto);
        const before = state(auto);
        check(12, auto);
        check(12, auto);
        expect(state(auto)).toMatchObject({used: 39, ceiling: 74, baseCeiling: 50, maximumCeiling: 86, validatedFiles: 24, allocated: 51});
        expect(state(auto).deadline).toBe(before.deadline);
        for (let i = 0; i < 12; i++) reserve(auto);
        expect(state(auto).used).toBe(51);
    });
    test('repeated files and case aliases cannot earn more capacity across transactions', () => {
        reserve(auto);
        record('/panel.ts', auto);
        record('/panel.ts', auto);
        reserve(auto);
        record('/panel.ts', auto);
        record('/PANEL.ts', auto);
        expect(state(auto)).toMatchObject({validatedFiles: 1, ceiling: 51});
    });
    test.each([{FDO_TEST_AI_MAX_REQUESTS: '50'}, {FDO_TEST_AI_REQUEST_CEILING: '50'}, {FDO_TEST_AI_REQUEST_CEILING: '65'}])('respects explicit caps even with validated progress: %j', override => {
        const env = {...auto, ...override};
        for (let i = 0; i < 39; i++) { reserve(env); record(`/feature${i}.ts`, env); }
        expect(state(env).progressAllowance).toBe(0);
        expect(state(env).ceiling).toBe(Number(override.FDO_TEST_AI_REQUEST_CEILING || override.FDO_TEST_AI_MAX_REQUESTS));
    });
    test('growth stops at one workspace worth of credits, then failed requests exhaust the final ceiling', () => {
        const {MAX_WORKSPACE_FILES} = require('../../src/utils/ai/generation/codingRequestPolicy.cjs');
        for (let i = 0; i < MAX_WORKSPACE_FILES + 3; i++) { reserve(auto); record(`/f${i}.ts`, auto); }
        expect(state(auto)).toMatchObject({validatedFiles: MAX_WORKSPACE_FILES, ceiling: 50 + MAX_WORKSPACE_FILES});
        while (state(auto).used < state(auto).ceiling) reserve(auto);
        expect(() => reserve(auto)).toThrow(`limit reached (${50 + MAX_WORKSPACE_FILES})`);
    });
    test('validation cannot renew the deadline or credit unsafe paths', () => {
        jest.useFakeTimers().setSystemTime(1000);
        try {
            reserve(auto);
            expect(() => record('/../outside.ts', auto)).toThrow('approved workspace path');
            const deadline = state(auto).deadline;
            jest.setSystemTime(deadline);
            expect(() => record('/valid.ts', auto)).toThrow('deadline reached');
            expect(state(auto).validatedFiles).toBe(0);
        } finally { jest.useRealTimers(); }
    });
    test('the generator credits accepted files only, never its plan or rejected source', async () => {
        const {generateStagedWorkspace} = require('../../src/utils/ai/generation/codingWorkspaceGeneration');
        const replies = [JSON.stringify({files: [{path: '/a.ts', contract: 'A'}, {path: '/b.ts', contract: 'B'}]}),
            JSON.stringify({path: '/a.ts', lines: ['export const a = 1;']}),
            JSON.stringify({path: '/b.ts', lines: ['export const b = ;']})];
        const request = jest.fn(async () => {
            reserve(auto);
            if (!replies.length) throw new Error('Stop after rejection');
            return replies.shift();
        });
        await expect(generateStagedWorkspace({prompt: 'Build', request, workspaceFiles: [],
            assertBudget: count => check(count, auto), onFileValidated: path => record(path, auto)})).rejects.toThrow('Stop after rejection');
        expect(state(auto)).toMatchObject({validatedFiles: 1, ceiling: 51});
    });
});
